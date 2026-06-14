-- ============================================================================
-- Fase 2E-1H - Hardening de los WARN del Security Advisor
-- ----------------------------------------------------------------------------
-- Cierra los avisos de seguridad detectados tras 2E-1 APPLY, SIN romper RLS,
-- policies ni triggers, y SIN tocar datos / seed / Auth / Storage / API keys.
--
-- WARN atacados:
--   0011 function_search_path_mutable
--        -> public.set_updated_at (no fijaba search_path).
--   0028 anon_security_definer_function_executable
--        -> helpers SECURITY DEFINER ejecutables por `anon` (via PUBLIC).
--
-- WARN aceptado por diseno (NO se elimina):
--   0029 authenticated_security_definer_function_executable
--        -> los helpers DEBEN ser ejecutables por `authenticated` porque las RLS
--        policies los invocan en contexto del usuario autenticado. Filtran
--        internamente por auth.uid(), asi que no exponen datos de otros tenants.
--        Quitar EXECUTE a `authenticated` romperia las policies
--        (permission denied for function). Riesgo aceptado y documentado.
--
-- Idempotente: CREATE OR REPLACE + REVOKE/GRANT son re-ejecutables.
-- NO EJECUTAR contra proyectos legacy. Solo crm-inmobiliario-demo
-- (ref ylhdbawrllqygfvllhdo).
-- ============================================================================

-- 1) set_updated_at: fijar search_path vacio (cierra 0011) manteniendo su
--    contrato (trigger function, NEW.updated_at = now(), return NEW). Los
--    triggers existentes conservan el mismo OID -> no hay que recrearlos.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- set_updated_at solo se invoca desde triggers; la ejecucion de un trigger NO
-- comprueba el privilegio EXECUTE del rol que dispara el evento, por lo que
-- nadie necesita EXECUTE directo. Revocar cierra la superficie de RPC.
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.set_updated_at() from anon;
revoke execute on function public.set_updated_at() from authenticated;

-- 2) Helpers RLS SECURITY DEFINER: quitar EXECUTE a PUBLIC y anon (cierra 0028).
--    Mantener EXECUTE a `authenticated` (necesario para evaluar las RLS
--    policies; ver nota 0029 arriba). NO se concede a anon ni a service_role.
revoke execute on function public.current_workspace_ids()      from public, anon;
revoke execute on function public.is_workspace_admin(uuid)     from public, anon;
revoke execute on function public.current_workspace_role(uuid) from public, anon;

grant execute on function public.current_workspace_ids()      to authenticated;
grant execute on function public.is_workspace_admin(uuid)     to authenticated;
grant execute on function public.current_workspace_role(uuid) to authenticated;

-- ============================================================================
-- FIN 2E-1H. No toca tablas, datos, seed, Auth, Storage ni API keys.
-- ============================================================================
