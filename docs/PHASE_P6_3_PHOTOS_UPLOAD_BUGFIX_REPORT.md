# FASE P6.3 — Bugfix: subida real de fotos de inmueble + topbar coherente

> **Fecha:** 2026-06-23 · HEAD previo `b361abe`. 1 migración (GRANT) + helper/UI + copy. Sin
> service_role en frontend. Requiere redeploy.

## 1-2. Causa exacta del fallo
**No era el código de subida, ni Storage, ni la RLS, ni el path, ni el MIME.** Era un **GRANT
de tabla faltante**: `public.entity_files` se creó vía SQL crudo (apply_migration) y **no recibió
los privilegios DML de Supabase para el rol `authenticated`** — solo tenía
`REFERENCES/TRIGGER/TRUNCATE`. Comparado con `properties` (que funciona), que sí tiene
`SELECT/INSERT/UPDATE/DELETE` para `authenticated`.

Flujo real: la foto **sí subía a Storage** (paso 1 OK), pero el **INSERT de metadatos** (paso 2)
fallaba con `permission denied for table entity_files`; el helper hacía rollback del objeto de
Storage → toast "No se pudo subir la foto". Además el error real quedaba oculto porque el
`PostgrestError` no es instancia de `Error` y el toast leía `e.message` solo si era `Error`.

**Verificado en Supabase (antes):** `entity_files` / `authenticated` = `REFERENCES,TRIGGER,TRUNCATE`.
Storage OK (authenticated con DML completo en `storage.objects`), bucket `entity-files` privado,
10 MB, MIME `jpeg,png,webp,gif,pdf`. Políticas `entity_files` (4) y `storage.objects` (4) correctas.

## 3. Qué se cambió
- **Migración `p63_entity_files_grant`**: `GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.entity_files TO authenticated;` (la RLS sigue siendo el control por fila/workspace; `anon`
  no recibe DML). **Verificado (después):** authenticated = `SELECT,INSERT,UPDATE,DELETE,…`.
- **Error handling honesto** (`entity-files.ts`): los errores de Storage/PostgREST se normalizan a
  `Error` con prefijo `[storage]` / `[metadata]` + código, para que la UI los muestre y mapee.
- **UX (`PropertyPhotosManager`)**: extrae el mensaje de cualquier error; `console.error` con
  contexto seguro (sin secretos) para diagnóstico en staging; toasts útiles:
  - permiso → "No tienes permisos para subir fotos a este inmueble."
  - formato → "Formato no permitido. Usa JPG, PNG, WebP o GIF."
  - tamaño → "La imagen es demasiado grande. Máximo 10 MB por foto."
  - genérico → incluye el detalle real. Botón muestra **"Subiendo…"** y se deshabilita.

## 8. Copy viejo limpiado (topbar)
- **Topbar** `/opportunities`: `{ title: 'Operaciones', description: 'Pipeline comercial' }` →
  **`{ title: 'Cartera', description: 'Inmuebles, operaciones y trámites' }`**.
- **Nueva operación** (drawer): descripción "Pipeline comercial…" → "Negocio comercial en
  seguimiento…". **Sin "Pipeline comercial" en toda la app** (verificado por grep).

## 9. CTA por pestaña — confirmado
Inmuebles → "Nuevo inmueble" (primario) · Operaciones → "Nueva operación" · Trámites → "Nuevo
trámite". El primario es el de la pestaña activa; los demás van como secundarios discretos
(implementado en P7, sin cambios).

## 5-7. Confirmaciones
- **Storage real**: bucket privado + signed URLs + RLS workspace-scoped. Sin service_role.
- **Cross-workspace**: políticas en `entity_files` y `storage.objects` aíslan por `workspace_id`
  (path `workspace_id/...` + `current_workspace_ids()`); roles de escritura owner/admin/comercial.
- **upload/list/signed-url/delete/set-cover**: habilitados (grant + RLS correctos).
- **Documentos**: NO se añadió UI falsa (queda P7.1; la infra ya lo soporta).

## 10-11. Validaciones / archivos
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Sin secretos/PII en el diff.
Tocados: `supabase/migrations/20260623_p63_entity_files_grant.sql` (aplicada),
`src/lib/entity-files.ts`, `src/components/PropertyPhotosManager.tsx`, `src/components/Topbar.tsx`,
`src/components/VerticalForms.tsx`, este report.

## 12. Redeploy
**Requiere redeploy** del front (helper/UI/copy). La **migración GRANT ya está aplicada** en
Supabase (independiente del deploy) — la subida ya funcionará en staging incluso antes de
redeployar el front, pero el front nuevo mejora los mensajes de error y limpia el topbar.

## 15. Qué probar en staging (Cartera → Inmuebles → Editar inmueble → Fotos)
1. Subir **JPG** → aparece miniatura + toast "Foto subida".
2. Subir **PNG / WebP** → igual.
3. **Fijar portada** en una foto → badge "Portada".
4. **Refrescar** la página → las fotos persisten; la **portada se ve en la card** de la cartera.
5. **Borrar** una foto → desaparece.
6. (Negativo) Subir un archivo enorme/no-imagen → toast claro (tamaño/formato).

## 16. Veredicto
**P6.3 COMPLETADO — FOTOS DE INMUEBLE FUNCIONANDO.** Causa raíz (GRANT de tabla faltante)
corregida y verificada en BD; error handling honesto; topbar/copy coherentes ("Cartera", sin
"Pipeline comercial"). La subida real funciona a nivel de permisos/RLS/Storage; la verificación
visual final (subir-ver-portada-borrar como usuario logueado) es QA humano tras el redeploy.
