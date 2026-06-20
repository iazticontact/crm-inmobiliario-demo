-- ============================================================================
-- Fase N2.7 - GRANT de privilegios de tabla al rol `service_role`
-- ----------------------------------------------------------------------------
-- CAUSA RAIZ (documentada en docs/PHASE_N2_7_CRM_AGENT_TOOL_503_FIX_REPORT.md):
--   La migracion 20260615_2e2_grant_authenticated_table_privileges.sql concedio
--   DML a `authenticated` PERO dejo `service_role` sin tocar, asumiendo que
--   "ya bypassa RLS". Ese supuesto es FALSO: `service_role` salta las POLICIES
--   (RLS) pero NO los PRIVILEGIOS de tabla (GRANT). Sin GRANT, toda consulta de
--   service_role falla con `42501 permission denied for table ...` ANTES de
--   evaluar RLS.
--   Efecto: el unico consumidor de service_role, el endpoint server-to-server
--   `POST /api/agent/tool` (usado por el Agent V2 de n8n), fallaba en la primera
--   query (lookup de workspace) -> el route devolvia HTTP 503
--   `workspace_lookup_failed`. El resto del CRM (anon/authenticated + RLS) no se
--   veia afectado, por eso no se detecto antes (ningun otro path usa service_role).
--
-- FIX: restaurar los privilegios estandar de `service_role` en el schema public
--   (lo que Supabase concede por defecto y que aqui faltaba). NO cambia ninguna
--   tabla, schema, policy RLS, dato, seed, Auth, Storage ni API key. El endpoint
--   sigue siendo read-only por codigo (mutaciones -> 410) y workspace-scoped.
--
-- Idempotente: GRANT y ALTER DEFAULT PRIVILEGES son re-ejecutables.
-- NO EJECUTAR contra proyectos legacy. Solo crm-inmobiliario-demo
-- (ref ylhdbawrllqygfvllhdo).
--
-- NOTA: ya aplicado en runtime (via MCP) al proyecto el 2026-06-20. Esta
-- migracion lo VERSIONA para que un proyecto recreado desde migraciones
-- (staging / produccion cliente) no reproduzca el bug.
-- ============================================================================

grant usage on schema public to service_role;

-- Privilegios estandar de service_role sobre los objetos actuales del schema.
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- Objetos FUTUROS creados por el rol que ejecuta las migraciones.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- ============================================================================
-- FIN N2.7. RLS intacto; anon sin DML; se restauran los GRANT de service_role.
-- ============================================================================
