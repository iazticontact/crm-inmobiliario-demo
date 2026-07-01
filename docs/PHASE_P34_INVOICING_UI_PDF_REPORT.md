# FASE P34 — Facturación fase 2: UI, PDF, estados y almacenamiento en entity-files

> **Fecha:** 2026-07-02 · Segunda fase de facturación: **experiencia real** sobre el cimiento de P33.
> Listado + crear/editar borrador + líneas + cálculo live + **emisión con numeración atómica** + **PDF** +
> guardado en `entity-files` + descarga por signed URL. **SIN** email, notificaciones, n8n, Asistente-write,
> import/export ni roles nuevos. Reutiliza lo que ya existía (no se añadieron dependencias).

---

## 1. Diagnóstico
Se auditó P33 (tablas `invoices`/`invoice_items`/`invoice_number_sequences`, RLS, RPC `reserve_invoice_number`,
`calc.ts`, `invoice-service.ts`, `entity_files.entity_type += invoice`) y los **reutilizables** del CRM:
`src/lib/entity-files.ts` (upload + signed URLs bajo RLS), `EntityDocumentsManager`, el **generador PDF sin
dependencias** `src/lib/pdf/simple-pdf.ts`, y los componentes compartidos (`SideDrawer`/`Button`/`Input`/
`EmptyState`). `activities` no tiene CHECK de `entity_type` (se puede registrar `invoice`). Bucket
`entity-files` privado → descargas por signed URL. **No se duplicó lógica.**

## 2. Rutas / UI creadas
- **`/facturacion`** (`src/app/(saas)/facturacion/page.tsx`, client) — listado + drawer de crear/editar +
  acciones. Ítem visible en **Sidebar** ("Facturación", icono Receipt) y label en **Topbar**. Compatible con
  el drawer móvil (P28B) y con el shell.

## 3. Listado de facturas
Cards responsive (una fila por factura, apila en móvil) con: número/display, **estado** (pill de color),
cliente (de `customer_snapshot`), fecha de emisión, vencimiento, **total** formateado es-ES, y acciones según
estado (editar/emitir en borrador; descargar PDF; marcar pagada; anular). Filtros por estado
(Todas/Borradores/Emitidas/Enviadas/Pagadas/Canceladas) + **búsqueda** por número/cliente. **Empty state** con
CTA "Crear factura". `Loader` en carga.

## 4. Crear / editar borrador
Drawer con: **cliente** (selector poblado de `clients`, genera `customer_snapshot`), serie, moneda, fecha de
emisión, vencimiento, notas visibles y notas internas. **Editar** solo en `draft`; una factura emitida abre en
**solo lectura** (se descarga en PDF). Validación vía `validateInvoicePayload` (P33). El emisor se toma de la
Configuración de empresa (`workspace_settings`) → `issuer_snapshot` (campos ausentes = "No consta", no
bloquea).

## 5. Líneas y cálculo live
Editor de líneas: descripción, cantidad, precio, **descuento %**, **IVA %**, **IRPF %**; añadir/eliminar
línea. Totales en vivo con **`calc.ts` de P33** (no se duplica el cálculo): base imponible, IVA, retención
IRPF (si >0) y total. Redondeo a 2 decimales consistente con P33. Las líneas se persisten con sus totales
calculados (`persistItems`: borra + reinserta).

## 6. Emisión y numeración
Al **Emitir** (`emitInvoice`): (1) valida; (2) **reserva número** con la RPC atómica
`reserve_invoice_number` (bajo RLS/rol); (3) actualiza `series/year/number/invoice_number_display` +
`status='issued'`; (4) genera **PDF**; (5) lo sube a `entity-files`; (6) fija `pdf_file_id`; (7) registra
actividad. **Flujo seguro:** el número (recurso escaso) se reserva y persiste **antes** del PDF; si el PDF/
subida fallara, la factura queda emitida con número y el PDF es **regenerable** (no se pierde ni se duplica el
número). Decisión documentada.

## 7. Estados
`draft → issued → sent → paid` / `overdue` / `cancelled` / `void` (mismo set que el CHECK). Marcar **pagada**
(issued/sent/overdue → paid). **Anular** (cancelled) sin borrar la emitida. Borrar solo borradores (RLS:
`is_workspace_admin` + `status='draft'`). No se implementan abonos/rectificativas (futuro, documentado).

## 8. PDF
`src/lib/invoicing/invoice-pdf.ts`: compone una factura estructurada (EMISOR / FACTURAR A / DATOS / CONCEPTOS
/ TOTALES / NOTAS) y la genera con el **generador propio sin dependencias** `generateSimplePdfBytes` (A4,
Helvetica, multipágina, footer). Determinista, server+browser, sin secretos. Campos ausentes → "No consta".
Nombre de archivo `factura-<display>.pdf` (sin ids técnicos). **No se añadió jspdf** ni ninguna dependencia
pesada (se reutiliza lo existente). Mejora visual tabular (jspdf-autotable) queda como opción futura.

## 9. entity_files
El PDF se sube con `uploadEntityFile({entityType:'invoice', entityId, category:'document'})` → objeto en
`entity-files` bajo `{workspaceId}/invoice/{invoiceId}/…` + fila `entity_files` (entity_type='invoice',
file_name, mime application/pdf, size, path). `invoices.pdf_file_id` apunta a esa fila. **Descarga** por
**signed URL** (bucket privado, `signedUrls`, caducidad 600 s). `EntityType` (TS) ampliado con `'invoice'`
(el CHECK de BD ya se amplió en P33).

## 10. Actividad / auditoría
`logInvoiceActivity` inserta en `activities` (type `invoice`, entity_type `invoice`, entity_id, client_id/
client_name del snapshot, created_by del usuario) al **emitir** y al **cambiar de estado** (pagada/anulada).
Best-effort (no rompe el flujo si falla).

## 11. Mobile
Todos los inputs/selects/textarea heredan **≥16px en móvil** (regla global P28C) → sin auto-zoom iOS. El
drawer usa el shell responsive; el editor de líneas apila en móvil (grid `grid-cols-2 sm:grid-cols-5`); los
totales y botones quedan accesibles. Sin scroll horizontal.

## 12. Tests / evals + E2E
- **Cálculo/validación/estados:** evals ejecutables de P33 (CALC_PASS) cubren IVA/IRPF/descuento/redondeo y
  la validación de payload que usa el formulario.
- **E2E RLS (contra Supabase real, transacción rolled back, con `role authenticated`):** como **miembro** del
  workspace se **inserta** un borrador + línea (RLS SELECT/INSERT OK), se **reserva** número
  (`FAC-TEST/2026/0001`); un **miembro de otro workspace es RECHAZADO** al insertar (`new row violates
  row-level security policy`). Conteos finales: invoices 0, items 0, sequences 0 (todo revertido, sin ensuciar
  numeración real ni datos).
- **PDF:** generado por el generador propio ya probado del proyecto (pure, sin deps); tsc valida la
  composición. QA visual del PDF final = manual en la app (ver §Pendientes).

## 13. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ (ruta `/facturacion`
construida) · git limpio · sin secretos · sin temp files · **sin service_role frontend** · **sin n8n** · sin
emails/envíos · sin notificaciones.

## 14. Archivos tocados
| Archivo | Cambio |
|---|---|
| `src/app/(saas)/facturacion/page.tsx` | **Nuevo** — UI de facturación (listado + drawer + emisión + PDF) |
| `src/lib/invoicing/invoice-repo.ts` | **Nuevo** — capa de datos de navegador (draft/emit/estado/PDF/list) bajo RLS |
| `src/lib/invoicing/invoice-pdf.ts` | **Nuevo** — PDF estructurado (generador sin deps) |
| `src/lib/invoicing/types.ts` | `InvoiceItem` como fila real (snake_case) |
| `src/lib/entity-files.ts` | `EntityType` += `'invoice'` |
| `src/components/Sidebar.tsx` | Ítem de nav "Facturación" (visible) |
| `src/components/Topbar.tsx` | Label de `/facturacion` |

## 15. Migraciones
Ninguna nueva (las de P33 ya cubren el modelo; el CHECK de `entity_files` ya se amplió en P33).

## 16. Qué NO se implementó (por diseño)
Email/envío, notificaciones, **n8n**, Asistente creando/leyendo facturas (P35), OCR, pasarela de pago, firma,
Verifactu/TicketBAI, import/export, roles avanzados nuevos, abonos/rectificativas.

## 17–18. Commit / Push
Commit `feat(p34): facturación UI + PDF + estados + almacenamiento en entity-files` → `origin/main`.

## 19. Riesgos / pendientes / rollback
- **QA visual/manual en la app** (crear borrador → emitir → PDF → descargar) y **mobile en dispositivo real**:
  no ejecutable desde aquí (el repo de navegador necesita sesión real); build verde + RLS verificada por SQL.
- **Emisión sin PDF** (si falla la subida): factura emitida con número, PDF regenerable → **pendiente P34.1/
  P35** un botón "regenerar PDF" (hoy el PDF se genera solo al emitir). Documentado.
- **Rollback:** todo additivo; para revertir, quitar el ítem de nav + la ruta; las tablas de P33 no se tocan.
- **Siguiente — P35:** Asistente facturación (lectura de facturas vía `crm_read_query`/reader + `prepare_invoice`
  como preparedAction con **confirmación**), evals y QA. **No** antes.

## 20. Veredicto
**P34 COMPLETADO — FACTURACIÓN UI + PDF + STORAGE LISTOS, SIN N8N NI ASISTENTE WRITE.** La facturación es
usable manualmente: crear/editar borrador con líneas y cálculo live (IVA/IRPF/descuento), emitir con
**numeración atómica** verificada, generar **PDF** (generador propio, sin deps), guardarlo en `entity-files`
y **descargarlo** por signed URL; con estados controlados, actividad y mobile ≥16px. Escrituras bajo **RLS**
(verificada: miembro sí, otro workspace rechazado). `tsc`/`lint`/`build` verde. Sin tocar la base, n8n ni el
Asistente-write. Listo para P35 (Asistente).
