# FASE P36D — Facturación FINAL LOCKDOWN: UI simple, papelera/restauración, borrado seguro, dashboard fiscal

> **Fecha:** 2026-07-02 · Cierre del módulo **extra premium** de Facturación: **UI simplificada** (5 vistas),
> **papelera universal** (mover a papelera / restaurar / eliminar definitivamente con confirmación fuerte),
> **mini dashboard fiscal/financiero** para la inmobiliaria, PDF refinado y ciclo de vida profesional.
> **Aislado del Asistente IA** (P35 intacto). Sin n8n, sin emails/notificaciones, sin OCR, sin import/export,
> sin service_role en frontend. Una **migración additiva y segura** (política SELECT para la papelera).

---

## 35. Diagnóstico
La UI acumulaba ruido: **7 pestañas** de estado, muchos iconos por fila y KPIs de más. Faltaba poder
**eliminar cualquier factura** de forma segura (solo había soft-delete de borradores) y no había **papelera**
ni **restaurar**. El PDF (v2, P36C) ya era bueno pero mejorable en aire/equilibrio. **Bloqueo técnico
detectado en auditoría:** la política RLS `invoices_select` filtraba `deleted_at is null`, así que una vista
de **Papelera era imposible** (los soft-deleted no se podían leer). El `invoices_delete` solo permite
borrado a **admin + borrador** (correcto para trazabilidad fiscal).

## 36. Simplificación de la UI
- **5 vistas** (antes 7): **Todas · Borradores · Pendientes · Pagadas · Papelera**, cada una con **recuento**.
  «Pendientes» agrupa emitidas/enviadas (incl. vencidas); «Vencida» se muestra como estado calculado dentro
  de Pendientes/Todas (badge rojo), no como pestaña. Canceladas viven dentro de «Todas».
- **KPIs reducidos a 4**: Pendiente de cobro · Vencido · Facturado (mes) · Borradores. El detalle fiscal se
  mueve al **Resumen** (toggle «Ver resumen financiero»), para no recargar la vista.
- **Acciones por fila**: 1–2 principales visibles (Ver/Editar · Descargar/Emitir · Restaurar en papelera) y
  el resto en un **menú «Más acciones» (⋯)**. Fin del muro de iconos.
- **Copy profesional**: «Mover a papelera», «Restaurar factura», «Eliminar definitivamente», «Marcar
  cobrada», «Marcar enviada», «Anular factura», «Esta acción no se puede deshacer».

## 37. Vistas finales (estados reales vs calculados vs vistas)
- **Estados reales** (BD): draft · issued · sent · paid · cancelled/void.
- **Calculado**: overdue/vencida = (issued|sent) con `due_date < hoy`, no pagada/cancelada/eliminada.
- **Vistas UI**: Todas (activas) · Borradores (draft) · Pendientes (issued|sent) · Pagadas (paid) ·
  Papelera (`deleted_at not null`). Los borradores/canceladas nunca aparecen en Papelera salvo que se
  muevan allí.

## 38. Eliminación / papelera / restauración
- **Mover a papelera** (`moveToTrash`): disponible para **cualquier** factura (cualquier estado). Soft delete
  vía `deleted_at`; **reversible**, **no rompe la numeración**, y desaparece de las vistas normales y de los
  KPIs/dashboard.
- **Papelera**: vista propia con número, cliente, estado original, total y **fecha de eliminación**; acciones
  Restaurar / (si procede) Eliminar definitivamente. No cuenta en KPIs.
- **Restaurar** (`restoreInvoice`): `deleted_at = null`; conserva número, estado y PDF; no regenera nada.

## 39. Eliminación definitiva y permisos
- **`hardDeleteInvoice`**: solo **borradores** y solo **administradores** (lo impone la RLS `invoices_delete`
  = `is_workspace_admin AND status='draft'`, y se refuerza en el cliente). Las líneas se borran en cascada.
- Las **facturas emitidas/enviadas/pagadas/canceladas NO se eliminan de la base** (trazabilidad fiscal):
  pueden moverse a papelera y mantenerse o restaurarse, pero **no** hay hard delete. La UI lo explica.
- **Confirmación fuerte** para el borrado definitivo: modal que exige escribir **ELIMINAR**, con aviso de que
  se borran las líneas, que no se recupera y que la numeración no se reutiliza.
- **Actividad**: se registra `invoice`-activity en mover a papelera, restaurar y eliminar definitivamente
  (además de emitir/enviar/cobrar/anular), sin romper constraints (activities.type='invoice').

## 40. Ciclo de vida de factura (resumen)
Borrador → editar · emitir · **mover a papelera**. · Emitida → descargar · marcar enviada · marcar cobrada ·
anular · mover a papelera. · Enviada → cobrar · anular · mover a papelera. · Pagada/Cancelada → descargar ·
mover a papelera. · Papelera → **restaurar** · (borradores, admin) **eliminar definitivamente**.

## 41. PDF refinado
Refinado sobre el PDF v2 (sin rehacer): más aire en tarjetas emisor/cliente, filas de tabla con más altura
mínima, bloque **TOTAL** más grande y destacado. Se mantiene: banda de metadatos, tarjetas, importes a la
derecha, notas/condiciones, footer al pie, acentos/€ correctos, multipágina y degradación elegante (sin «No
consta»).

## 42. Preview / editor
- **Preview** (P36C) sigue reflejando el PDF (metadatos, tarjetas, panel de totales, notas, footer).
- **Editor**: acciones **según estado** — draft (guardar/emitir/mover a papelera), emitida (descargar/
  regenerar/mover a papelera), papelera (restaurar / eliminar definitivamente si admin+borrador). Guardrails
  de emisión intactos (cliente/líneas/total/emisor). Dos paneles con vista previa; en móvil, toggle.

## 43. IVA / fiscalidad UX
IVA **21% por defecto** en cada línea nueva, **totalmente editable**; `datalist` con tipos habituales (IVA
21/10/4/0, IRPF 0/7/15/19) — sugerencias, sin bloqueo. Descuento 0 por defecto. Cálculo en vivo (base/IVA/
IRPF/total). IVA incluido/excluido/exento lo resuelve el parser (P36B/C) con coherencia.

## 44. Dashboard fiscal/financiero (ADDENDUM)
Zona **«Resumen fiscal y financiero»** (toggle) con selector de periodo **Mes · Trimestre · Año · Todo** y:
- **KPIs de cobro**: Facturado · Cobrado · Pendiente · Vencido.
- **KPIs fiscales**: Base imponible · IVA repercutido · IRPF retenido · Neto orientativo (base − IRPF).
- **Gráficos sin dependencias** (CSS/SVG): estado de cobro (barra segmentada cobrado/pendiente/vencido),
  facturación últimos 6 meses (barras), facturación por estado y **top clientes**.
- **Reglas** (en `invoice-summary.ts`, puras/testeadas): borradores no cuentan como facturado; canceladas y
  **papelera** excluidas; cobrado=pagadas; pendiente=emitidas/enviadas no vencidas; vencido=due<hoy;
  base/IVA/IRPF sobre el set facturado.
- **Aviso visible**: «Resumen orientativo basado en tus facturas. Revísalo con tu asesor fiscal antes de
  presentar impuestos.» **No es una declaración fiscal oficial.**

## 45. Mobile
Vistas/menú/modales/editor usables en móvil: inputs a 16px (sin auto-zoom), pestañas y KPIs en scroll/grid,
menú «Más» y modal de borrado accesibles, dashboard responsive, sin overflow horizontal.

## 46. Asistente IA / n8n aislados
`git diff` confirma que **no** se tocó `agent-tool-readers.ts` ni `assistant/`. Sin `crm_read_query` de
facturas, sin `prepare_invoice`, sin `preparedAction`; `get_invoices_summary` sigue `not_available`. **n8n
intacto.**

## 47. Tests / evals / verificación
- **Evals puros (tsx)**: `invoicing.evals` (calc), `invoice-parse.evals`, `invoice-pdf.evals`,
  **`invoice-summary.evals`** (facturado/cobrado/pendiente/vencido/base/IVA/IRPF/neto, exclusión de
  papelera/borradores/canceladas, filtros de periodo, top clientes, `inPeriod`) → **PASS**.
- **RLS E2E (transacción con ROLLBACK, sin tocar datos reales)** como usuario autenticado del workspace:
  (1) soft-delete de una factura **emitida** → **visible en papelera** (nueva política SELECT); (2) hard
  delete de esa emitida → **bloqueado por RLS** (sigue existiendo); (3) hard delete de un **borrador** →
  **permitido**; (4) restaurar → OK. Todo revertido.

## 48. Validaciones
`npx tsc --noEmit` **OK** · `npm run lint -- --max-warnings=0` **OK** · `npm run build` **OK** ·
`node --check scripts/check-agent-deploy.mjs` **OK** · evals **PASS** · PDF smoke **PASS** · escaneo de
secretos/service_role **sin hallazgos** · `git status` limpio tras commit.

## 49. Archivos tocados
**Nuevos**: `src/lib/invoicing/invoice-summary.ts`, `src/components/invoicing/InvoiceDashboard.tsx`,
`src/lib/invoicing/__evals__/invoice-summary.evals.ts`, `docs/supabase/p36d_invoices_trash.sql`.
**Modificados**: `src/lib/invoicing/invoice-repo.ts` (papelera/restaurar/hard delete + row fields +
`listInvoices({trashed})`), `src/app/(saas)/facturacion/page.tsx` (5 vistas, KPIs, menú, papelera, dashboard,
modal de borrado), `src/components/invoicing/InvoiceEditor.tsx` (acciones por estado), `src/lib/invoicing/
invoice-pdf.ts` (refinado).

## 50. Migraciones
**Una, additiva y verificada** (`p36d_invoices_select_include_trashed`, aplicada a `ylhdbawrllqygfvllhdo`):
la política `invoices_select` pasa de `workspace + deleted_at is null` a `workspace` para poder **leer la
papelera**. INSERT/UPDATE/DELETE **sin cambios** (borrado definitivo sigue limitado a admin + borrador). SQL
en `docs/supabase/p36d_invoices_trash.sql`.

## 51. Qué NO se hizo (fuera de alcance / decisiones)
- **No** hard delete de facturas emitidas/pagadas (trazabilidad; se archivan en papelera). Decidido y
  documentado.
- **No** campos `deleted_by/deletion_reason/restored_at` (se usa `deleted_at` + actividad; evitamos migración
  extra). Ampliable en el futuro.
- **No** rango de fechas personalizado en el dashboard (Mes/Trimestre/Año/Todo cubren el caso; documentado).
- **No** desglose ventas/alquileres/comisiones por tipo: el modelo no marca el tipo de operación en la
  factura; se ofrece «Top clientes» y «por estado» en su lugar (no se inventan datos).
- **No** emails/notificaciones/OCR/import-export/n8n/Asistente.

## 52. Commit / 53. Push
Ver `feat(p36d)` en `main` (push a `origin/main`). Detalle tras publicar.

## 53. Pendientes honestos
- Verificación **visual** del PDF: automatizada hasta bytes/estructura; el «se ve premium» requiere abrir un
  PDF (no puedo renderizarlo aquí).
- **Parser multi-concepto**: sigue 1 línea por propuesta (el editor permite añadir más a mano).
- **Regenerar PDF** no borra el PDF anterior en Storage (puntero actualizado; huérfano inocuo).
- Dashboard: sin desglose por tipo de operación (limitación del modelo, ver §51).

## 54. Veredicto
**P36D COMPLETADO — FACTURACIÓN FINAL LOCKDOWN: UI SIMPLE (5 VISTAS), PAPELERA/RESTAURACIÓN TOTAL,
ELIMINACIÓN SEGURA (BORRADO DEFINITIVO SOLO BORRADORES+ADMIN, CONFIRMACIÓN FUERTE), DASHBOARD FISCAL/
FINANCIERO ORIENTATIVO, PDF PREMIUM REFINADO Y MÓDULO EXTRA CERRADO. ASISTENTE IA AISLADO, N8N INTACTO, TODO
COMPILA Y PASA VALIDACIONES.**
