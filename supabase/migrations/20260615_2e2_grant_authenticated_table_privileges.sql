-- ============================================================================
-- Fase 2E-2 H6B/H6C - GRANT de privilegios de tabla al rol `authenticated`
-- ----------------------------------------------------------------------------
-- CAUSA RAIZ (documentada en docs/PHASE_2E2_H6B_LOGIN_ROOT_CAUSE_GRANTS.md):
--   Las migraciones de 2E-1/2E-2 crearon tablas + RLS + policies y concedieron
--   EXECUTE de los helpers RLS a `authenticated`, PERO nunca hicieron GRANT de
--   DML (SELECT/INSERT/UPDATE/DELETE) sobre las TABLAS a `authenticated`.
--   RLS solo se evalua DESPUES del privilegio de tabla: sin este GRANT, toda
--   consulta de un usuario autenticado falla con `42501 permission denied`
--   ANTES de mirar las policies. Efecto: AuthGate lee profileError y manda a
--   /login?error=no_profile ("usuario sin workspace"); y todo el CRM real
--   (dashboard, clientes, ficha, etc.) queda inoperable para usuarios reales.
--   No se detecto antes porque auth.users estuvo vacio (ningun login real).
--
-- FIX: conceder DML a `authenticated` en las tablas del producto. RLS SIGUE
--   limitando filas por workspace (policies con auth.uid() / current_workspace_ids
--   / is_workspace_admin). NO se concede nada a `anon`. service_role no se toca
--   (ya bypassa RLS y se usa solo server-side).
--
-- Idempotente: GRANT y ALTER DEFAULT PRIVILEGES son re-ejecutables.
-- NO toca schema, datos, seed, Auth, Storage ni API keys.
-- NO EJECUTAR contra proyectos legacy. Solo crm-inmobiliario-demo
-- (ref ylhdbawrllqygfvllhdo).
--
-- NOTA: este GRANT ya se aplico manualmente (server-side, via MCP) al proyecto
-- en runtime el 2026-06-15. Esta migracion lo VERSIONA para que un proyecto
-- Supabase nuevo (staging / produccion cliente) recreado desde migraciones no
-- reproduzca el bug.
-- ============================================================================

-- 1) DML sobre las tablas actuales del producto para `authenticated`.
--    (RLS activo en todas; estas concesiones NO saltan RLS.)
grant select, insert, update, delete on
  public.workspaces,
  public.profiles,
  public.workspace_members,
  public.clients,
  public.properties,
  public.opportunities,
  public.service_cases,
  public.tasks,
  public.calendar_events,
  public.activities
to authenticated;

-- 2) `anon` NO recibe DML. (Pre-login el navegador usa la publishable/anon key;
--    el CRM real exige sesion. Dejar anon sin DML evita exposicion accidental;
--    ademas las policies usan auth.uid(), que es NULL para anon.)
revoke select, insert, update, delete on
  public.workspaces,
  public.profiles,
  public.workspace_members,
  public.clients,
  public.properties,
  public.opportunities,
  public.service_cases,
  public.tasks,
  public.calendar_events,
  public.activities
from anon;

-- 3) Default privileges para TABLAS FUTURAS del schema public creadas por el
--    rol que ejecuta las migraciones: que `authenticated` reciba DML
--    automaticamente (y asi no se vuelva a olvidar el GRANT). RLS seguira
--    aplicando por tabla. Idempotente.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- ============================================================================
-- FIN 2E-2 H6B/H6C. RLS intacto; anon sin DML; solo se concede a authenticated.
-- ============================================================================
