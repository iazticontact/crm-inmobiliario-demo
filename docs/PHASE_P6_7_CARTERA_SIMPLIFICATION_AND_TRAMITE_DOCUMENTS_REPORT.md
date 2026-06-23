# FASE P6.7 — Simplificación global de Cartera + documentos reales en Trámites

> **Fecha:** 2026-06-23 · HEAD previo `a50e4af`. UI (edit drawers + nuevo gestor de documentos) +
> helper. **Sin migración** (`entity_files` ya soporta `entity_type='service_case'` +
> `category='document'`; RLS/Storage workspace-scoped). Requiere redeploy.

## 1-4. Diagnóstico (audit de opciones)
P6.5/P6.6 simplificaron los **drawers de creación**, pero los **drawers de EDICIÓN**
(`VerticalEditForms.tsx`) seguían con lo viejo: "Editar **expediente**", "Cerrar expediente",
toasts "Expediente actualizado", **selector Vertical** siempre visible, **tipos de `CASE_TYPES`
de extranjería (NIE)**, y un set de **estados antiguo** (6, con "Resuelto/Presentado"). El tablero
ya tenía "Nuevo lead" (corregido a "Nueva" en P6.6).

## 5. Opciones finales (creación + edición alineadas)
- **Tipo de operación** (7): Venta · Alquiler · Captación · Compra · Valoración · Inversión · Otro.
- **Origen** (7): Web · Portal inmobiliario · WhatsApp · Llamada · Oficina · Referido · Otro.
- **Etapas** (labels P6.6, claves intactas): Nueva · Contactado · Cualificado · Visita · Oferta ·
  Negociación · Reserva · Cerrada · Perdida.
- **Tipo de trámite** (8 + Otro): Nota simple · Contrato / arras · Reserva · Tasación · Certificado
  energético · Financiación / hipoteca · Escritura / notaría · Documentación · Otro.
- **Estado de trámite** (5): Abierto · En revisión · Pendiente de documentación · Bloqueado ·
  Completado. (El edit drawer ahora usa estos mismos, con fallback al valor actual si fuese antiguo.)
- **Prioridad**: Baja · Normal · Alta · Urgente.

## 3-4. Labels/palabras eliminadas (UI visible)
"expediente" → **trámite** (títulos, botones, toasts de los edit drawers); "Vertical" oculto salvo
workspace mixto (`showVerticalSelect`); "Cerrar expediente" → **"Marcar completado"** (`resolved`);
"Cambia datos del **pipeline**" → "Cambia los datos de la operación"; "Valor (€)" → **"Valor
potencial (€)"**; sin "lead"/"Nuevo lead"/"NIE"/"Extranjería" por defecto. Edición de tipo de
trámite ya no usa `CASE_TYPES` de extranjería.

## 6-8. Documentos reales en Trámites (lo nuevo)
Nuevo componente **`EntityDocumentsManager`** (reutilizable: client/property/opportunity/service_case)
montado en el **drawer de Editar trámite**:
- **Subir** PDF/imagen (múltiple), **listar**, **abrir/descargar** (signed URL en pestaña nueva),
  **borrar**. Previsualización "Subiendo…", errores claros por archivo, empty state elegante.
- **Sin recargar**: la lista se actualiza al subir/borrar; el indicador **"N documentos"** en la
  card del trámite se actualiza al instante vía `onDocCountChange` (y se carga en lote con
  `documentCountsForEntities`, sin N+1).
- **Decisión** (sección 8): los documentos se adjuntan **al editar** el trámite (no en la creación,
  para no fragilizar el flujo). El toast de creación lo indica: *"Trámite creado. Puedes adjuntar
  documentos al editarlo."*

## 8b. entity_type / category
- `entity_type = 'service_case'` (coincide con la tabla `service_cases` y el CHECK de `entity_files`).
- `category = 'document'`. Path: `workspace_id/service_case/<caseId>/<uuid>-<archivo>`.
- **UI: "trámite" / DB: service_case** (documentado, consistente).

## 9. Storage / RLS / seguridad (confirmado, sin cambios)
Se reutiliza la infra de P6.3/P6.4: bucket privado `entity-files`, **RLS de `entity_files`**
(SELECT por `current_workspace_ids()`; INSERT/UPDATE/DELETE por rol owner/admin/comercial) y
**policies de `storage.objects`** (aislamiento por `workspace_id` en el path) — **no son
específicas de imágenes**, así que documentos de `service_case` quedan cubiertos sin migración.
GRANTs de `authenticated` ya concedidos (P6.3). **Sin service_role en frontend.** Signed URLs
efímeras (no se guardan en BD). No cross-workspace.

## 10. Fotos de inmueble — intactas
`PropertyPhotosManager` y la portada en la card **no se tocaron**. Las imágenes de inmueble usan
`entity_type='property'`+`category='image'`; los documentos de trámite usan otro entity/category →
**no se mezclan**.

## 11. Compatibilidad de datos
Sin migración. Estados antiguos (`submitted`/`closed`/`signature_pending`) y tipos antiguos
("Venta de vivienda"…) se muestran bien (helper `serviceCaseStatusLabel` + fallback al valor actual
en los selects). Claves de etapa intactas.

## 12. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Sin "expediente"/"Pipeline"/"lead"/"NIE"
visibles; sin secretos.

## 13. Archivos
**Nuevo** `src/components/EntityDocumentsManager.tsx`; `src/components/VerticalEditForms.tsx`
(edit drawers alineados + documentos); `src/components/VerticalForms.tsx` (export TRAMITE_TYPE +
toast); `src/lib/entity-files.ts` (`documentCountsForEntities`); `src/app/(saas)/opportunities/page.tsx`
(showVerticalSelect a edit drawers + conteo/indicador de documentos); este report.

## 16. Checklist de prueba
1. **Editar operación**: no aparece "Vertical"; etapa con labels simples + "Reserva"; "Valor potencial".
2. **Editar trámite**: dice "Editar trámite" (no expediente); tipo (8) + estado (5); "Marcar
   completado".
3. **Documentos**: en Editar trámite → **Subir documento** (PDF) → aparece sin recargar → abrir
   en pestaña nueva → borrar. Cerrar drawer → card muestra **"N documentos"** sin F5. Refrescar →
   persiste. Otro trámite no muestra esos documentos.
4. **Fotos de inmueble** siguen funcionando (no se rompen).

## Veredicto
**P6.7 COMPLETADO — CARTERA SIMPLE + DOCUMENTOS EN TRÁMITES.** Opciones cortas y profesionales en
creación **y** edición, sin "expediente"/"pipeline"/"lead"/Extranjería por defecto, y **documentos
reales** en Trámites sobre Storage real (RLS, signed URLs, sin service_role, sin migración).
Requiere redeploy.
