-- ============================================================================
-- Fase 2E-1U - PLANTILLA: vincular el primer usuario demo (owner) al workspace
-- ----------------------------------------------------------------------------
-- ESTO ES UNA PLANTILLA. NO se aplica automaticamente (vive fuera de
-- supabase/migrations/). Ejecutar MANUALMENTE *despues* de crear el usuario en
-- Supabase Dashboard -> Authentication -> Users.
--
-- ANTES de ejecutar, sustituye los placeholders por valores reales SOLO en una
-- copia temporal / editor SQL del dashboard. NO commitees UUID ni email reales.
--   {{AUTH_USER_ID}}    -> UUID de auth.users (el del usuario demo recien creado)
--   {{DEMO_USER_EMAIL}} -> email del usuario demo (opcional; pon null si no
--                          quieres guardarlo en profiles.email)
--
-- Workspace demo (FIJO, no cambiar): d0000000-0000-4000-8000-000000000001
--
-- Roles que deja:
--   public.profiles.role          = 'client_admin'  (rol legacy)
--   public.workspace_members.role = 'owner'         (rol de negocio)
--
-- Idempotente (on conflict). Solo toca el workspace demo. No crea tablas, no
-- toca Storage, ni API keys, ni runtime, ni otros workspaces.
-- ============================================================================

begin;

-- 0) Guardas: el workspace demo y el auth user deben existir ----------------
do $$
begin
  if not exists (
    select 1 from public.workspaces
    where id = 'd0000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Workspace demo d0000000-0000-4000-8000-000000000001 no existe. Aborta.';
  end if;

  if not exists (select 1 from auth.users where id = '{{AUTH_USER_ID}}') then
    raise exception 'auth.users % no existe. Crea el usuario en el dashboard primero.', '{{AUTH_USER_ID}}';
  end if;
end $$;

-- 1) profile (extiende auth.users; rol legacy client_admin) ------------------
insert into public.profiles (id, workspace_id, email, full_name, role)
values (
  '{{AUTH_USER_ID}}',
  'd0000000-0000-4000-8000-000000000001',
  '{{DEMO_USER_EMAIL}}',   -- pon null si no quieres guardar el email
  'Demo Owner',
  'client_admin'
)
on conflict (id) do update
  set workspace_id = excluded.workspace_id,
      email        = coalesce(excluded.email, public.profiles.email),
      full_name    = excluded.full_name,
      role         = excluded.role,
      updated_at   = now();

-- 2) membership (rol de negocio owner) --------------------------------------
-- Bootstrap del primer owner: las policies de workspace_members no permiten al
-- cliente crear su propia membresia, por eso se hace server-side / service_role.
insert into public.workspace_members (workspace_id, user_id, role)
values (
  'd0000000-0000-4000-8000-000000000001',
  '{{AUTH_USER_ID}}',
  'owner'
)
on conflict (workspace_id, user_id) do update
  set role = excluded.role;

-- 3) Verificacion en la misma transaccion -----------------------------------
do $$
declare
  v_profile_role text;
  v_member_role  text;
  v_member_ws    uuid;
begin
  select role into v_profile_role
    from public.profiles where id = '{{AUTH_USER_ID}}';

  select role, workspace_id into v_member_role, v_member_ws
    from public.workspace_members
    where workspace_id = 'd0000000-0000-4000-8000-000000000001'
      and user_id = '{{AUTH_USER_ID}}';

  if v_profile_role is distinct from 'client_admin' then
    raise exception 'profiles.role inesperado: % (esperado client_admin)', v_profile_role;
  end if;
  if v_member_role is distinct from 'owner' then
    raise exception 'workspace_members.role inesperado: % (esperado owner)', v_member_role;
  end if;
  if v_member_ws is distinct from 'd0000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'workspace_members.workspace_id inesperado: %', v_member_ws;
  end if;

  raise notice 'OK: profile=client_admin + member=owner vinculados al workspace demo.';
end $$;

commit;

-- ============================================================================
-- REVERTIR (si algo sale mal) - NO borra el workspace demo:
--   delete from public.workspace_members
--     where workspace_id = 'd0000000-0000-4000-8000-000000000001'
--       and user_id = '{{AUTH_USER_ID}}';
--   delete from public.profiles where id = '{{AUTH_USER_ID}}';
--   -- (borrar el auth user, si se quiere, se hace desde el dashboard)
-- ============================================================================
