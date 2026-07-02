# FASE P36E — Facturación final real: papelera sin bugs, eliminación definitiva controlada, resumen simple

> **Fecha:** 2026-07-02 · Cierre real del módulo tras prueba de usuario. Corrige el **bug de "Restaurar"
> duplicado**, implementa **eliminación definitiva controlada** desde la papelera (con decisión contable),
> añade **incluir/excluir del resumen financiero**, **simplifica el dashboard** (IRPF/base/neto al detalle) y
> da un **último polish al PDF**. **Aislado del Asistente IA**, **n8n intacto**, RLS y trazabilidad
> preservadas. Una **migración additiva** (dos columnas).

---

## 26. Diagnóstico
- **Restaurar duplicado:** en la papelera la fila tenía **botón «Restaurar»** y además el menú «Más» incluía
  «Restaurar factura» → dos accesos a la misma acción.
- **No se podía eliminar definitivamente:** el menú solo ofrecía «Eliminar definitivamente» para
  `draft + admin`, y la RLS `invoices_delete` bloquea el borrado de emitidas → las facturas emitidas en
  papelera **no tenían salida** de borrado permanente.
- **Dashboard demasiado técnico:** IRPF/base/neto como KPIs principales confundían a usuarios no técnicos.
- **Contabilidad tras borrado:** no había forma de decidir si una factura eliminada seguía contando; y una
  fila hard-deleted no puede seguir computando sin registro histórico.

## 27. Bug «Restaurar» duplicado
En la papelera: **«Restaurar» queda solo como botón principal**; el menú «Más» ya **no** lo incluye (solo
«Excluir/Incluir en el resumen» y «Eliminar definitivamente»). Validado en desktop y móvil, todos los estados.

## 28. Papelera final
Cada fila de papelera: **Restaurar** (botón) + menú «Más» con **incluir/excluir del resumen** (emitidas) y
**Eliminar definitivamente** (admin). Microcopy explicativa arriba: se pueden restaurar o eliminar
definitivamente; las emitidas se conservan por trazabilidad aunque se eliminen.

## 29. Eliminación definitiva
Acción **solo desde papelera** y **solo admin/owner** (UI + RLS), con **doble confirmación**: (1) elección de
tratamiento contable (solo emitidas), (2) escribir **ELIMINAR**. El modal explica consecuencias distintas
para borrador vs emitida y avisa de que **el número no se reutiliza**.

## 30. Decisión técnica: hard delete vs purga (tombstone)
- **Borrador** → **hard delete real** (RLS `admin + draft`): fila + líneas fuera (cascada). No tiene valor
  fiscal.
- **Emitida/enviada/pagada/cancelada** → **purga** (`purged_at`): la fila **se conserva** (trazabilidad
  fiscal, numeración intacta) pero **desaparece de toda la UI** (listados y papelera). El usuario lo percibe
  como eliminada de la gestión. Se eligió esta estrategia (Opción B del brief) por ser la **segura**: no se
  finge que una fila borrada siga contando; el histórico permanece.
- **PDF/entity_files:** en la purga no se toca el PDF (se conserva junto a la fila; queda inaccesible desde la
  UI). En el hard delete de borrador no hay PDF (los borradores no lo generan).

## 31. Incluir / excluir del resumen financiero
Nueva columna `accounting_excluded` (reversible). Desde el menú «Más» (facturas emitidas, activas o en
papelera): **«Excluir del resumen»** / **«Incluir en el resumen»**. Casos:
- Factura en papelera **no excluida** → **sigue contando** en el resumen.
- Factura en papelera **excluida** → **no cuenta**.
- Al **purgar**, el usuario elige: **excluir** (`accounting_excluded=true`) o **mantener como registro
  histórico** (`false`, sigue contando).
- Restaurar **mantiene** la decisión contable previa (documentado). Chip visible «fuera del resumen» en las
  filas excluidas.

## 32. Dashboard simplificado
Por defecto **4 KPIs**: **Facturado · Cobrado · Pendiente · IVA generado**. **Detalle fiscal** (Base
imponible · IRPF retenido · Neto orientativo · Vencido) **plegado** tras un desplegable, con nota: «IRPF/
retenciones solo aplica si lo usas…». Gráficos simples (estado de cobro, últimos 6 meses, por estado). Aviso
«Hay N facturas excluidas del resumen» si procede. Copy: «Resumen financiero» + «Datos orientativos… revísalos
con tu asesor fiscal».

## 33. IRPF / base / neto
Ya **no** son KPIs principales: viven en **Detalle fiscal** (secundario, plegable). El resumen por defecto es
apto para una inmobiliaria no técnica.

## 34. PDF — último polish
Ajuste tipográfico fino (panel de totales un poco más ancho para mejor equilibrio) sobre el PDF v2 aprobado.
Se mantiene: cabecera+logo, banda de metadatos, tarjetas EMISOR/CLIENTE, tabla con importes a la derecha,
TOTAL destacado, notas/condiciones, footer al pie, acentos/€, multipágina y degradación elegante.

## 35. Preview
El preview (`InvoicePreview`) sigue reflejando el PDF (metadatos, tarjetas, panel de totales, notas, footer).
Sin divergencias.

## 36. IVA
IVA **21% por defecto** por línea, editable, con `datalist` (21/10/4/0; IRPF 0/7/15/19). Sin ligar a país.

## 37. RLS / permisos
Sin cambios de política: SELECT workspace-scoped (P36D); UPDATE (mover a papelera/restaurar/**purgar**/
**excluir**) en owner/admin/comercial; DELETE (hard delete real) en **admin + draft**. La UI restringe la
eliminación definitiva a administradores. La numeración nunca se reutiliza.

## 38. Asistente / n8n aislados
`git status` confirma que **no** se tocó `agent-tool-readers.ts` ni `assistant/`; `get_invoices_summary`
sigue `not_available`; sin `crm_read_query`/`prepare_invoice`/`preparedAction`. **n8n intacto.**

## 39. Tests / evals
- **Evals puros (tsx)** → **PASS**: calc, parser, PDF y **summary** actualizado (cuenta por
  `accountingExcluded` y **no** por papelera; papelera no-excluida cuenta; **purgada retenida cuenta /
  purgada excluida no**; excluidas no computan; `excludedCount`; periodos).
- **RLS E2E (transacción con ROLLBACK, sin tocar datos reales)**: emitida → **purga** ⇒ `purged_at` fijado,
  **no** aparece en activas ni en papelera, fila conservada; toggle `accounting_excluded` OK. (P36D ya
  verificó: soft-delete visible, hard-delete de emitida bloqueado, hard-delete de borrador permitido.)

## 40. Validaciones
`npx tsc --noEmit` **OK** · `npm run lint -- --max-warnings=0` **OK** · `npm run build` **OK** ·
`node --check scripts/check-agent-deploy.mjs` **OK** · evals **PASS** · PDF smoke **PASS** · escaneo de
secretos/service_role **sin hallazgos** · `git status` limpio tras commit.

## 41. Archivos tocados
**Nuevos**: `docs/supabase/p36e_invoices_purge_accounting.sql`, este informe.
**Modificados**: `src/lib/invoicing/invoice-repo.ts` (scope `all`, `setAccountingExcluded`, `permanentDelete`
draft-hard/emitted-purge, campos `purgedAt`/`accountingExcluded`), `src/lib/invoicing/invoice-summary.ts`
(cuenta por `accountingExcluded` + `excludedCount`), `src/components/invoicing/InvoiceDashboard.tsx`
(simplificado + detalle fiscal + aviso), `src/app/(saas)/facturacion/page.tsx` (fetch único, fix restaurar,
modal doble confirmación, incluir/excluir, microcopy), `src/lib/invoicing/invoice-pdf.ts` (polish),
`src/lib/invoicing/__evals__/invoice-summary.evals.ts`.

## 42. Migraciones
**Una, additiva y verificada** (`p36e_invoices_purge_and_accounting`, aplicada a `ylhdbawrllqygfvllhdo`):
`invoices` += `purged_at timestamptz` y `accounting_excluded boolean not null default false` + índice. Sin
cambios de políticas RLS. SQL en `docs/supabase/p36e_invoices_purge_accounting.sql`.

## 43. Qué NO se hizo (decisiones / límites)
- **No** hard delete de emitidas (trazabilidad): se purgan y se conservan. Percibido como eliminación
  definitiva de la gestión.
- **No** tabla `invoice_accounting_snapshots` separada: se resolvió con `purged_at` + `accounting_excluded`
  sobre la propia fila (más simple y robusto; el histórico se conserva).
- **No** borrado del PDF en Storage al purgar (huérfano inocuo, inaccesible desde la UI).
- **No** rango de fechas personalizado; **no** emails/notificaciones/OCR/import-export/n8n/Asistente.

## 44. Commit / 45. Push
Ver `feat(p36e)` en `main` (push a `origin/main`). Detalle tras publicar.

## 46. Pendientes honestos
- Verificación **visual** del PDF (bytes/estructura automatizados; el diseño requiere abrir el PDF).
- **Parser multi-concepto**: 1 línea por propuesta (editor permite añadir más).
- **Restaurar** no re-pregunta por la decisión contable (mantiene la previa); ampliable si se desea.
- Purga no libera el PDF en Storage (limpieza de huérfanos pendiente, impacto nulo).

## 47. Veredicto
**P36E COMPLETADO — FACTURACIÓN FINAL REAL: PAPELERA SIN BUGS (RESTAURAR ÚNICO), ELIMINACIÓN DEFINITIVA
CONTROLADA (BORRADOR = HARD DELETE, EMITIDA = PURGA CON TRAZABILIDAD Y DOBLE CONFIRMACIÓN), INCLUIR/EXCLUIR
DEL RESUMEN, DASHBOARD SIMPLE (IRPF/BASE/NETO AL DETALLE) Y PDF PULIDO. ASISTENTE IA AISLADO, N8N INTACTO,
TODO COMPILA Y PASA VALIDACIONES.**
