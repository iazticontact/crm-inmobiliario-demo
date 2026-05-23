-- =============================================================================
-- calendar_user_level_service_role_grants_fix.sql
-- Aplicado en costadelsol-crm (ref ktsgfukjgldeylfzrayr) el 2026-05-23.
-- =============================================================================
-- Por qué:
--   Tras aplicar `calendar_user_level_v1.sql`, el `service_role` se quedó
--   sin SELECT/INSERT/UPDATE/DELETE sobre `public.google_calendar_connections`
--   y sin SELECT sobre la vista `public.vw_google_calendar_status`. La vista
--   tuvo que recrearse con DROP+CREATE para reordenar columnas, y al recrear
--   se perdieron los grants previos para service_role.
--
--   Las rutas server-side de Google Calendar (callback, status, disconnect,
--   list-calendars, save-selected-calendars, import-events, sync-event,
--   update-event, cancel-event, team-status) usan service_role para
--   leer/escribir tokens. Sin estos grants devolvían:
--     "permission denied for table google_calendar_connections"
--
-- Qué hace este script (idempotente, no destructivo):
--   1. Restituye los privilegios DML de service_role sobre la tabla base.
--   2. Restituye SELECT de service_role sobre la vista pública segura.
--   3. Re-aplica (idempotente) SELECT a authenticated sobre la vista,
--      coincidiendo con la definición original del schema base.
--
-- Qué NO hace:
--   - No relaja la RLS. La tabla base sigue admin-only para `authenticated`.
--   - No expone refresh_token_enc al cliente. La vista sigue proyectando
--     `has_refresh_token boolean` en su lugar.
--   - No toca Storage, documents, team users, WhatsApp, n8n ni Meta.
-- =============================================================================

grant select, insert, update, delete
  on table public.google_calendar_connections
  to service_role;

grant select
  on table public.vw_google_calendar_status
  to service_role;

grant select
  on table public.vw_google_calendar_status
  to authenticated;


-- =============================================================================
-- Verification queries (ejecutar manualmente)
-- =============================================================================
-- 1) service_role debe tener al menos SELECT/INSERT/UPDATE/DELETE sobre la tabla base:
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema='public'
--     and table_name='google_calendar_connections'
--     and grantee='service_role'
--   order by privilege_type;
--
-- 2) service_role y authenticated deben tener SELECT sobre la vista:
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema='public'
--     and table_name='vw_google_calendar_status'
--     and grantee in ('service_role','authenticated')
--   order by grantee, privilege_type;
--
-- 3) authenticated NO debe tener SELECT directo sobre la tabla base
--    (la RLS no concede esa lectura; los miembros leen la vista):
--   select privilege_type
--   from information_schema.role_table_grants
--   where table_schema='public'
--     and table_name='google_calendar_connections'
--     and grantee='authenticated'
--     and privilege_type='SELECT';
--   -- Debe devolver 0 filas.
