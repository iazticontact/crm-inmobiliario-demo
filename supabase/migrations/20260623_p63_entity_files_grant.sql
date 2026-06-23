-- P6.3 BUGFIX — Subida real de fotos fallaba ("No se pudo subir la foto").
-- Causa raíz: la tabla `entity_files` se creó vía SQL crudo (apply_migration) y NO recibió
-- los GRANTs de DML de Supabase para el rol `authenticated` (solo tenía REFERENCES/TRIGGER/
-- TRUNCATE). Storage y las políticas RLS eran correctos, pero el INSERT de metadatos fallaba
-- con "permission denied for table entity_files". `properties` (que sí funciona) tenía
-- SELECT/INSERT/UPDATE/DELETE para authenticated; entity_files no.
-- Fix: conceder DML a `authenticated`. La RLS (políticas existentes) sigue siendo el control
-- de acceso real por fila/workspace. `anon` NO recibe DML (solo authenticated).
-- Aplicada vía MCP el 2026-06-23. Idempotente. Rollback: REVOKE … FROM authenticated.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entity_files TO authenticated;
