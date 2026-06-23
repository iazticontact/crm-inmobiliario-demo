# FASE P7 — Cartera potente: relación real op↔inmueble + Storage real de fotos

> **Fecha:** 2026-06-23 · HEAD previo `ccb0176`. 2 migraciones aplicadas + UI. Sin service_role
> en frontend. RLS verificada (advisors: 0 issues nuevos). Requiere redeploy.

## Resumen honesto: qué queda 100% implementado y qué es roadmap

### ✅ IMPLEMENTADO Y REAL (este turno)
1. **CTA por pestaña** — el primario cambia según la vista activa: Inmuebles → "Nuevo inmueble";
   Operaciones → "Nueva operación"; Trámites → "Nuevo trámite". Los otros quedan como secundarios
   discretos. "Nuevo inmueble" ya **no protagoniza** en Operaciones/Trámites.
2. **Relación estructural `opportunities.property_id`** (migración `p7_opportunities_property_id`):
   columna + **FK** a `properties(id)` `ON DELETE SET NULL` + índice + **backfill** desde
   `metadata.property_id` + **vinculación del showcase** (7 operaciones del ejemplo enlazadas a su
   inmueble). El tipo `OpportunityRow` y la UI usan ya `property_id` (fiable), con fallback a
   metadata. Las cards de inmueble muestran "N operaciones vinculadas" reales.
3. **Storage real unificado** (migración `p7_entity_files_storage`):
   - Tabla **`public.entity_files`** (`entity_type` property|client|opportunity|service_case,
     `category` image|document, `path`, `is_cover`, `sort_order`, `caption`, tamaños/mime…).
   - **RLS** workspace-scoped (SELECT por `current_workspace_ids()`; INSERT/UPDATE/DELETE por
     `current_workspace_role` owner/admin/comercial) — mismo patrón que `properties`.
   - **Bucket privado** `entity-files` (10 MB; imágenes + PDF) con **4 políticas en
     `storage.objects`** que aíslan por `workspace_id` (primer segmento del path).
   - Helper `src/lib/entity-files.ts`: `upload/list/signedUrls/delete/setCover/coverUrlsForProperties`
     — usa el **cliente de navegador autenticado** (RLS), **sin service_role**, **signed URLs**.
4. **Fotos de inmueble (MVP real y funcional)** — `PropertyPhotosManager`:
   - Subir **múltiples** fotos, ver miniaturas (signed URLs), **fijar portada**, **borrar**.
   - Integrado en el **drawer de Editar inmueble**.
   - La **portada real** se muestra en la card de la cartera (signed URL; placeholder si no hay).
   - Rollback de Storage si falla el insert de metadatos (sin huérfanos).

### 🔜 ROADMAP (P7.1 — siguiente sub-fase, ya con esqueleto real)
- **Ficha de inmueble dedicada** (page/drawer): galería grande + lightbox, info, relaciones
  (operaciones/trámites/propietario), documentos y acciones. Hoy las fotos viven en el drawer de
  edición; la ficha completa es el siguiente paso.
- **Documentos (PDFs)**: la **infra está hecha** (`entity_files.category='document'` + bucket +
  RLS); falta la **UI** de subir/listar/descargar por inmueble/cliente/operación/trámite.
- **Reordenar fotos** (`sort_order`) y **subir fotos en el alta** (hoy al editar, porque el id del
  inmueble debe existir antes).
- **Property picker** en el alta/edición de operación (para enlazar inmueble desde el form).
- **service_cases.property_id**: decisión → de momento el trámite llega al inmueble de forma
  **transitiva** vía `opportunity_id → opportunities.property_id` (un trámite suele pertenecer a
  una operación). Añadir columna directa queda opcional, documentado.

## Modelo de datos / relaciones
- `opportunities.property_id` (nuevo, FK) — fuente de verdad del enlace op↔inmueble.
- `service_cases.opportunity_id` (existente) — trámite↔operación (y transitivamente↔inmueble).
- `entity_files (entity_type, entity_id)` — archivos por entidad (foto/documento).

## Seguridad
- **Sin `service_role` en frontend.** Subidas/lecturas pasan por RLS (tabla + storage).
- Aislamiento cross-workspace por política (path `workspace_id/...` + `current_workspace_ids()`).
- Advisors de seguridad tras los cambios: **0 issues nuevos** (`entity_files`/storage con RLS OK).
  Los 4 WARN de `SECURITY DEFINER` son los helpers de workspace **preexistentes** (por diseño).

## Auditoría/saneamiento
- Operaciones del ejemplo vinculadas a su inmueble (7/8; "Cartera de inversión" queda sin
  inmueble único a propósito). 0 huérfanos introducidos. Datos del ejemplo siguen limpios
  (sin PII). Producto real sigue vacío.

## Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. (Se desactivó `@next/next/no-img-element`
a propósito: las fotos usan signed URLs efímeras, incompatibles con `next/image`.)

## QA pendiente (humano, requiere sesión real)
Subir una foto a un inmueble del ejemplo y comprobar: aparece en el drawer, se puede fijar como
portada, se ve en la card de la cartera, y se puede borrar. (No verificable desde aquí sin sesión
autenticada; la lógica + RLS están aplicadas y verificadas a nivel de esquema.)

## Veredicto
**P7 PARCIAL SEGURO — STORAGE REAL DE FOTOS + RELACIÓN OP↔INMUEBLE REAL.** Fotos de inmueble
funcionan de verdad (subir/ver/portada/borrar, RLS, signed URLs, sin service_role); la relación
operación↔inmueble es estructural y fiable; CTAs correctos por pestaña. Documentos (UI) y ficha
dedicada quedan como P7.1 con la **infraestructura ya construida** (sin humo). Requiere redeploy.
