# Fase 2D — Diseño de facturación funcional (módulo core)

> La facturación es **módulo core**, no secundario. Oier quiere controlar la facturación y, en el futuro, emitir facturas muy fácil — incluso por **audio/IA**.
> Diseño completo y aprobable. **No se implementa aquí.** Anclado en [PHASE_2_SCHEMA_DESIGN.md](PHASE_2_SCHEMA_DESIGN.md) (tablas) y [PHASE_2_STORAGE_PLAN.md](PHASE_2_STORAGE_PLAN.md) (PDF).

---

## 1. Funcionalidad inicial (v1 real)

Crear y gestionar facturas de forma manual y profesional:

- **Crear factura manual** con cliente asociado (`client_id`) o nombre suelto (`client_name`).
- **Conceptos/items** (`invoice_items`): descripción, cantidad, precio unitario, IVA por línea.
- **Base imponible** (`subtotal`) = suma de líneas.
- **IVA** (`tax_rate` / `tax_amount`) — por defecto 21% (configurable en `billing_settings`).
- **Total** = subtotal + IVA.
- **Estado:** `draft` → `sent` → `paid` / `overdue` / `cancelled`.
- **Vencimiento** (`due_date`) y **fecha de emisión** (`issue_date`).
- **Número de factura** correlativo (ver §2).
- **PDF generado** y guardado (ver §3).
- **Actividad registrada** (`activities`: «Factura creada/enviada/cobrada»).
- **Documentos asociados** (el PDF en `documents`, enlazado vía `invoices.pdf_document_id`).

**Cálculo (backend, fuente de verdad):** por cada línea `total_línea = quantity * unit_price`; `subtotal = Σ total_línea`; `tax_amount = subtotal * tax_rate/100`; `total = subtotal + tax_amount`. Nunca confiar en totales enviados por el cliente — recalcular en servidor.

---

## 2. Numeración

- **Por workspace**, serie y año: tabla `invoice_sequences` (`workspace_id`, `series`, `year`, `prefix`, `last_number`), `unique(workspace_id, series, year)`.
- **Prefijo configurable** en `billing_settings.invoice_prefix` (p. ej. `FAC`, `2026/`).
- **Formato sugerido:** `{prefix}{year}-{NNNN}` → `FAC2026-0042`.
- **Sin duplicados ni huecos:** la asignación del número se hace en **transacción atómica** en el backend:
  1. `UPDATE invoice_sequences SET last_number = last_number + 1 WHERE workspace_id=? AND series=? AND year=? RETURNING last_number` (o `INSERT ... ON CONFLICT`).
  2. Se compone el número con ese valor.
  3. Se inserta la `invoice` con `unique(workspace_id, invoice_number)` como red de seguridad.
- **El número solo se asigna al pasar de `draft` a `sent`/emitida** (los borradores no consumen numeración, práctica fiscal habitual). Decisión a confirmar con Oier.

---

## 3. PDF

- **Generación desde backend** (`api/reports/invoice`, runtime nodejs) con el generador actual (`generateInvoicePdfBytes` / `simple-pdf`). Footer ya usa `BRAND.appName` (Fase 1J); en real, usar **branding del workspace** (`billing_settings.legal_name`, `logo_path`, `invoice_footer`).
- **Guardado en Storage** bucket `facturas-pdf`, path `{workspace_id}/invoices/{invoice_id}/{numero}-{ts}.pdf`.
- **Registro en `documents`** (`type='invoice_pdf'`) y enlace `invoices.pdf_document_id`.
- **Descarga con signed URL** (10 min), nunca enlace público.
- **Regeneración:** si se edita una factura en `draft`, se regenera el PDF; una vez emitida (`sent`/`paid`), el PDF queda fijo (las correcciones se hacen con factura rectificativa, no editando — práctica fiscal).
- **Contenido del PDF:** datos fiscales del emisor (`billing_settings`), datos del cliente, número, fechas, líneas con IVA, subtotal/IVA/total, notas, footer/branding.

---

## 4. Pagos

- **v1 manual:** marcar factura como **pagada** → `status='paid'`, `paid_at=now()`, opcional `method` y `notes` en `metadata`.
- **Estados de cobro:** `pending`/`sent` → `paid` (cobrada) o `overdue` (vencida sin pago; se puede derivar por `due_date < today AND status != 'paid'`).
- **Pagos parciales / histórico:** tabla `invoice_payments` (futura) cuando se necesite. En v1 basta el marcado simple.
- **Futuro:** integración **Stripe / SEPA / Bizum** para cobro online — diseño aparte; el modelo `invoice_payments` ya lo soporta conceptualmente.

---

## 5. Facturación automática / IA (arquitectura futura — v1.5)

> Flujo objetivo: el comercial **dicta** y la factura queda lista para confirmar. **Nunca** se emite sin confirmación humana.

**Ejemplo:** el usuario dicta:
> *«Factura a Lucía Herrera 450 euros por reportaje fotográfico y gestión de visita.»*

**Pipeline:**
1. **Captura de audio** → se sube a Storage `audio-notes` (`{workspace_id}/audio/{user_id}/...`).
2. **Transcripción** (backend, OpenAI Whisper/equivalente) → texto.
3. **Extracción estructurada** (backend, OpenAI con tool/JSON schema): la IA extrae `client` (match contra `clients` del workspace), `items` (concepto + importe), `tax_rate` (default de `billing_settings`), `due_date` (si se menciona).
4. **`prepared_action`** tipo `create_invoice` con `payload` (borrador) y `missing_fields` (lo que falte: NIF del cliente, etc.). Estado `pending`.
5. **Confirmación del usuario** en la UI: revisa el borrador, completa lo que falte, confirma.
6. **Ejecución backend:** crea `invoice` + `invoice_items` (recalculando totales), asigna número (§2), genera PDF (§3), registra `activity`, marca `prepared_action` como `executed`.
7. **Nunca** se crea/emite una factura directamente desde la IA sin paso 5.

**Seguridad del flujo IA:** la extracción no ejecuta nada; solo propone una `prepared_action`. La creación real valida rol/workspace en backend. El match de cliente se confirma (evita facturar al cliente equivocado por un nombre ambiguo).

---

## 6. Seguridad

- **Solo roles autorizados** crean/editan/emiten facturas (p. ej. `owner`/`client_admin`/rol con permiso de facturación). Un `member` comercial podría crear borradores pero no emitir — **decisión de Oier** (ver preguntas).
- **RLS** en `invoices`, `invoice_items`, `invoice_sequences`, `billing_settings`, `invoice_payments`: aislamiento por `workspace_id`.
- **service_role solo backend** para generar/guardar PDF en Storage y para la asignación atómica de numeración si se opta por función server.
- **Recalcular totales en servidor** siempre (no confiar en el cliente).
- **Logs:** cada emisión/cambio de estado se registra en `activities` (y opcionalmente `agent_action_logs` si vino de IA).
- **Inmutabilidad post-emisión:** una factura emitida no se edita; se cancela (`cancelled`) o se rectifica. Cumple práctica fiscal española.

---

## 7. UI esperada

- **Listado de facturas:** número, cliente, fecha, vencimiento, total, estado (con color). Filtros por estado, cliente, rango de fechas.
- **Detalle de factura:** cabecera (emisor/cliente/fechas/número), líneas con IVA, totales, estado, botones (descargar PDF, marcar pagada, cancelar).
- **Crear/editar factura:** formulario con cliente (ClientPicker), líneas dinámicas (concepto/cantidad/precio/IVA), cálculo en vivo de subtotal/IVA/total, fecha de emisión y vencimiento.
- **Descargar PDF:** botón → signed URL.
- **Marcar pagada:** acción rápida desde listado/detalle.
- **Resumen de ingresos:** KPIs (facturado del mes, cobrado, pendiente, vencido) en el dashboard o cabecera de facturación.
- **(v1.5) Crear por voz:** botón de micrófono → graba → propuesta de factura para confirmar.

> Nota: hoy **Billing** está oculto tras `nowlabsInternal`. Para v1 real con facturación visible al cliente, habrá que **decidir el gating** (ver preguntas a Oier) y respetar el flag de feature por workspace/deploy.

---

## Resumen de tablas de facturación (de 2B)

| Tabla | Prioridad | Para qué |
|---|---|---|
| `invoices` (ampliada) | día 1 | cabecera: estados draft/sent/paid/overdue/cancelled, subtotal/IVA/total, numeración, pdf_document_id |
| `invoice_items` | día 1 | líneas con cantidad/precio/IVA |
| `invoice_sequences` | día 1 | numeración correlativa sin duplicados |
| `billing_settings` | día 1 | datos fiscales + IVA por defecto + branding factura |
| `invoice_payments` | futura | pagos parciales / histórico |
| `tax_rates` | futura | catálogo de IVA por workspace |

---

## Decisiones abiertas (para Oier — ver preguntas finales)

- ¿Facturación **visible al cliente** desde v1 real (quitar el gating `nowlabsInternal` para Billing)?
- ¿**Voz/IA** en v1 o queda como **v1.5**?
- ¿Qué **roles** pueden emitir (solo admin) vs crear borradores (comercial)?
- ¿Numeración: el borrador consume número o solo al emitir?
- ¿Necesitáis **factura rectificativa** y series múltiples desde el inicio, o basta una serie simple?
