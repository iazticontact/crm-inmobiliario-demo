# FASE P36B — Facturación PRO: rediseño total, PDF profesional real, emisor por defecto y logo

> **Fecha:** 2026-07-02 · Rediseño integral del módulo **extra premium** de Facturación: motor PDF vectorial
> nuevo (factura A4 de verdad, con logo y acentos), **corrección del emisor por defecto**, datos fiscales
> reales en Configuración, **editor a pantalla completa con vista previa en vivo**, estados/listado/KPIs
> mejores y guardrails de emisión. **Aislado del Asistente IA** (P35 intacto). Sin n8n, sin emails, sin OCR,
> sin service_role, **sin dependencias nuevas** y **sin migraciones** (solo metadata additiva).

> **Nota de recuperación:** una caída de conexión interrumpió P36B durante la auditoría. Recuperación segura:
> `git status` limpio, último commit `2d2eaaf` (P36A), **cero archivos parciales/rotos** en disco. Se
> retomó desde base limpia con la auditoría ya hecha. No hubo trabajo que descartar ni imports rotos.

---

## 1. Diagnóstico (qué estaba mal y por qué)
1. **Bug crítico del emisor.** `loadIssuerSnapshot` leía `metadata.email` / `billing_email`, pero la
   Configuración de empresa guarda el email como `contact_email` → **el email del emisor salía siempre
   "No consta"**.
2. **Faltaban datos fiscales.** La Configuración de empresa **no tenía** NIF/CIF, dirección fiscal, CP,
   ciudad, provincia ni país → el PDF los mostraba como "No consta" por todas partes.
3. **PDF inaceptable.** `simple-pdf.ts` es un generador de **texto plano** que **elimina los acentos**
   (á→a), **sin tabla, sin columnas, sin importes alineados, sin logo, sin gráficos**. Parecía un informe,
   no una factura.
4. **Sin vista previa.** El usuario no veía la factura antes de emitir; el editor era un drawer básico.
5. **Estados/listado pobres.** Fila mínima ("emitida <fecha>"), sin vencidas, sin acciones por estado
   claras, KPIs limitados.

## 2. Decisiones de rediseño
- **Motor PDF vectorial propio, sin dependencias** (`src/lib/pdf/pdf-doc.ts`): texto con color/negrita/
  alineación, rectángulos y líneas (tablas, cajas), **imagen JPEG** (logo) y **codificación WinAnsi/CP1252**
  → acentos y € correctos. A4, multipágina, coordenadas top-left.
- **Layout de factura profesional** (`invoice-pdf.ts`) reescrito sobre el motor.
- **Preview HTML que refleja el PDF** (`InvoicePreview.tsx`) reutilizada en un **editor a pantalla completa
  de dos paneles** (`InvoiceEditor.tsx`).
- **Emisor real**: fix del mapeo + nuevos campos fiscales en Configuración (metadata additiva, **sin
  migración**) + **logo real** incrustado en el PDF.
- **Degradación elegante**: si falta un dato, no se pinta la línea (se acabó el "No consta" en cascada).

## 3. Página principal / listado
- **Hero premium** (Módulo extra · PRO) + CTA. **6 KPIs útiles**: Borradores, Emitidas, Pagadas,
  **Vencidas** (en rojo), **Pendiente de cobro** (€), **Facturado (mes)** (€) — calculados sobre TODAS las
  facturas.
- **Banner de aviso** si faltan datos fiscales del emisor, con enlace a Configuración.
- **Listado enriquecido**: número, estado (marca **Vencida** si `dueDate < hoy`), etiqueta **PDF**, cliente,
  fecha de emisión, vencimiento (resaltado si vencida), importe, y **acciones por estado** (editar/emitir en
  borradores; ver/descargar/pagar/anular en emitidas). Fila clicable → abre el editor.
- **Empty states** distintos para "sin facturas" y "sin resultados".

## 4. Generador por texto/audio
Se mantiene (`InvoicePromptBuilder`, Web Speech API, local/determinista, aislado del Asistente). Ahora la
propuesta abre directamente el **editor con vista previa**, con avisos de warnings/campos faltantes.

## 5. Parser — mejoras reales
- **IVA incluido/excluido**: distingue "IVA incluido" / "impuestos incluidos" (retrocede la base con aviso)
  de "más IVA" / "+ IVA" / "IVA aparte" / "base imponible" (la base queda intacta).
- **Exento / IVA 0%** → 0%.
- **Notas** visibles: "Nota: …" → `draft.notes`.
- Se mantiene: cliente real bajo RLS (sin inventar; ambiguo/inexistente → aviso + pendiente), importe es-ES,
  IRPF, descuento, vencimiento (días / fin de mes), serie, concepto, confianza y campos faltantes.
- **Límite honesto**: sigue siendo **un concepto por propuesta** (multi-línea documentado como pendiente);
  el editor permite añadir todas las líneas manualmente.

## 6. Editor — rediseño total (`InvoiceEditor.tsx`)
Pantalla completa, **dos paneles** (formulario | vista previa en vivo); en móvil alterna **Editar / Vista
previa**. Secciones: **A Cabecera** (cliente, serie, moneda, fechas), **B Emisor** (resumen + aviso fiscal
con enlace a Configuración), **C Facturar a** (snapshot del cliente), **D Conceptos** (líneas con total por
línea), **E Totales** (base/IVA/IRPF/total en vivo), **F Notas** (visibles + internas). Acciones: Guardar
borrador · **Guardar y emitir** · (en emitidas) **Descargar PDF** / **Regenerar PDF**. Inputs a 16px en
móvil (sin auto-zoom iOS).

## 7. Emisor por defecto + logo
- **Fix** del email (`contact_email`) y lectura de los nuevos campos fiscales.
- **Configuración de empresa** (`WorkspaceProfileCard`) gana un bloque **"Datos fiscales · Facturación"**:
  NIF/CIF, dirección fiscal, CP, ciudad, provincia, país (metadata additiva).
- **Logo real**: `image-to-jpeg.ts` carga el logo (bucket público), lo aplana sobre blanco y lo convierte a
  JPEG; el PDF lo incrusta (DCTDecode) manteniendo proporción. **Fallback** elegante al nombre de la empresa
  si no hay logo o falla CORS.
- Al **emitir** se **refresca el emisor** desde Configuración (por si se completó tras crear el borrador).

## 8. PDF — rediseño completo (nivel profesional)
Factura A4 con: **cabecera** (logo o nombre) + **FACTURA** + Nº + **pill de estado** + fechas; bloques
**DE / FACTURAR A**; **tabla de conceptos** (Descripción · Cant. · Precio · IVA · Importe) con **zebra** e
**importes alineados a la derecha**, descripción con wrap y sub-línea de descuento/IRPF; **caja de totales**
(descuentos, base, IVA, IRPF y **TOTAL destacado** en indigo); **notas**; **footer** con datos del emisor.
**Acentos correctos**, sin "???", **sin "No consta"** en cascada, paginación si hay muchas líneas.

## 9. Estados y flujo
`draft → issued → (sent) → paid` y `cancelled/void`; **overdue** se representa visualmente cuando
`dueDate < hoy` (issued/sent). El editor en modo **solo lectura** para no-borradores; acciones permitidas por
estado tanto en el listado como en el editor.

## 10. Responsive / móvil
Editor de dos paneles → una columna con toggle Editar/Vista previa; inputs a **16px** en móvil (sin
auto-zoom iOS); listado, filtros, hero y KPIs adaptables; preview scrollable.

## 11. Guardrails (no salen facturas rotas)
Al emitir (en `emitInvoice`): **borrador**, **≥1 línea**, **cliente válido** (id + nombre), **total
coherente** (finito ≥ 0) y **nombre fiscal del emisor** configurado (si no, se bloquea con mensaje claro).
NIF/dirección faltantes → **aviso visible** (banner) en editor y página. El PDF nunca se genera con
placeholders cutres.

## 12. Aislamiento del Asistente IA (P35 intacto)
**No** se tocó `agent-tool-readers.ts` ni `assistant/page.tsx` (verificado por `git diff --name-only`). Sin
`crm_read_query` de facturas, sin `prepare_invoice`, sin `preparedAction`, sin n8n. `get_invoices_summary`
sigue devolviendo `not_available`. El módulo es **manual, premium e integrado, pero separado del bot**.

## 13. Validaciones
- `npx tsc --noEmit` → **OK**.
- `npm run lint -- --max-warnings=0` → **OK** (0 warnings).
- `npm run build` → **OK** (`/facturacion` y `/settings` prerenderizadas).
- **Evals** (`invoicing.evals` + `invoice-parse.evals` + `invoice-pdf.evals`, runner temporal con `tsx`) →
  **PASS** (calc, IVA incluido/excluido/exento, IRPF, descuento, vencimiento, cliente único/ambiguo/
  inexistente, notas; PDF válido con acentos/€, sin "???", sin "No consta", degradación con emisor vacío).
- **Smoke PDF** → PDF válido de ~5,3 KB con `%PDF…%%EOF`, streams, bytes de acento (0xF3) y € (0x80).
- `node --check scripts/check-agent-deploy.mjs` → **OK**. Escaneo de secretos → **sin hallazgos**.

## 14. Archivos
**Nuevos**
- `src/lib/pdf/pdf-doc.ts` — motor PDF vectorial (texto WinAnsi, rects/líneas, imagen JPEG, A4, multipágina).
- `src/lib/pdf/image-to-jpeg.ts` — logo (URL) → bytes JPEG + dimensiones (canvas, SSR-safe, fallback).
- `src/components/invoicing/InvoicePreview.tsx` — vista previa que refleja el PDF.
- `src/components/invoicing/InvoiceEditor.tsx` — editor a pantalla completa con preview en vivo.
- `src/lib/invoicing/__evals__/invoice-pdf.evals.ts` — evals del PDF.

**Modificados**
- `src/lib/invoicing/invoice-pdf.ts` — layout de factura profesional (reescrito sobre el motor).
- `src/lib/invoicing/invoice-repo.ts` — fix emisor + campos fiscales + logo en PDF + `buildAndStorePdf` +
  guardrails de emisión + `regeneratePdf` + listado enriquecido (series/updated_at).
- `src/lib/invoicing/types.ts` — `IssuerSnapshot` con CP/ciudad/provincia/país.
- `src/lib/invoicing/invoice-parse.ts` — IVA incluido/excluido/exento + notas.
- `src/lib/invoicing/__evals__/invoice-parse.evals.ts` — casos nuevos.
- `src/components/WorkspaceProfileCard.tsx` — bloque de datos fiscales del emisor.
- `src/app/(saas)/facturacion/page.tsx` — hero/KPIs/listado/estados + integración del editor.

## 15. Migraciones
**Ninguna.** Los datos fiscales del emisor se guardan en `workspace_settings.metadata` (JSONB, additivo).
Las columnas `invoices.series` y `invoices.updated_at` ya existían (P33). No hay cambios de esquema.

## 16. Qué NO se hizo (límites respetados / pendientes honestos)
- **No** n8n, **no** emails/notificaciones, **no** OCR/IA leyendo contenido, **no** Verifactu/TicketBAI/
  firma, **no** pasarela de pago, **no** service_role en frontend, **no** dependencias nuevas.
- **No** se integró Facturación con el Asistente IA general (sigue aislado).
- **Pendiente honesto:** parser **multi-concepto** (hoy una línea por propuesta; el editor permite añadir
  más manualmente). Regenerar PDF **no** borra el PDF anterior en Storage (puntero actualizado; limpieza de
  huérfanos pendiente, impacto nulo para el usuario). Logo por CORS: si el bucket no sirviera CORS, se usa el
  nombre como fallback.

---

**Veredicto:** **P36B COMPLETADO — FACTURACIÓN PRO RECUPERADA Y CERRADA TRAS CORTE, CON PDF PROFESIONAL
REAL, EMISOR Y LOGO REALES, PREVIEW Y EDITOR PREMIUM, ESTADOS/LISTADO MEJORES Y ASISTENTE IA AISLADO.**
