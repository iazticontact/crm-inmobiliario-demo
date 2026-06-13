-- ============================================================================
-- Fase 2E-1 · Core multi-tenant
-- ----------------------------------------------------------------------------
-- Crea los cimientos del CRM real: workspaces (tenant), profiles (extiende
-- auth.users) y workspace_members (N:N con roles de negocio). Incluye helpers
-- RLS SECURITY DEFINER (sin recursion) y RLS activada en las 3 tablas.
--
-- NO EJECUTAR contra ningun proyecto legacy (nowcrm-demo / costadelsol-crm /
-- proyecto-costadelsolrealhomes). Solo en el proyecto Supabase NUEVO y vacio.
--
-- Idempotente donde es razonable (IF NOT EXISTS / OR REPLACE). El seed va en
-- archivo separado: 20260613_2e1_seed_demo_workspace.sql
-- ============================================================================

-- Extensiones ---------------------------------------------------------------
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- Trigger reutilizable updated_at -------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Tabla: workspaces  (el tenant / la inmobiliaria)
-- ============================================================================
create table if not exists public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique,
  vertical      text not null default 'real_estate',
  plan          text not null default 'starter',
  trial_ends_at timestamptz,
  branding      jsonb not null default '{}'::jsonb,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_workspaces_updated on public.workspaces;
create trigger trg_workspaces_updated
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Tabla: profiles  (extiende auth.users)
-- profiles.role conserva los valores LEGACY que el codigo actual ya espera
-- (nowlabs_admin / client_admin / member). Los roles de NEGOCIO nuevos viven
-- en workspace_members.role (owner/admin/comercial/solo_lectura).
-- ============================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  email        text,
  full_name    text,
  role         text not null default 'member'
                 check (role in ('nowlabs_admin', 'client_admin', 'member')),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_profiles_workspace on public.profiles(workspace_id);
create index if not exists idx_profiles_email on public.profiles(lower(email));

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Tabla: workspace_members  (membresia N:N con rol de negocio por workspace)
-- ============================================================================
create table if not exists public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'comercial'
                 check (role in ('owner', 'admin', 'comercial', 'solo_lectura')),
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists idx_members_user on public.workspace_members(user_id);
create index if not exists idx_members_workspace on public.workspace_members(workspace_id);

-- ============================================================================
-- Helpers RLS  (SECURITY DEFINER + search_path fijo)
-- ----------------------------------------------------------------------------
-- CLAVE ANTI-RECURSION: estas funciones son SECURITY DEFINER, por lo que se
-- ejecutan con privilegios del owner y BYPASEAN la RLS de workspace_members al
-- consultarla. Asi, una policy de workspace_members que las invoque NO vuelve a
-- disparar la RLS de workspace_members -> sin recursion. Nunca hacer subquery
-- directa a workspace_members dentro de una policy de la propia tabla.
-- ============================================================================

-- Workspaces a los que pertenece el usuario actual.
create or replace function public.current_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select wm.workspace_id
  from public.workspace_members wm
  where wm.user_id = auth.uid()
$$;

-- True si el usuario actual es owner/admin del workspace indicado.
create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin')
  )
$$;

-- Rol del usuario actual en el workspace indicado (o null si no es miembro).
create or replace function public.current_workspace_role(target_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace_id
    and wm.user_id = auth.uid()
  limit 1
$$;

-- Las funciones se evaluan dentro de las policies como el rol que consulta;
-- garantizamos que authenticated puede ejecutarlas.
grant execute on function public.current_workspace_ids() to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;
grant execute on function public.current_workspace_role(uuid) to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.workspaces        enable row level security;
alter table public.profiles          enable row level security;
alter table public.workspace_members enable row level security;

-- --- workspaces -------------------------------------------------------------
-- SELECT: miembros del workspace. UPDATE: owner/admin.
-- INSERT/DELETE: se hacen en backend/onboarding con service_role (no hay policy
-- de creacion para el cliente; el primer owner se bootstrapa server-side).
drop policy if exists ws_select on public.workspaces;
create policy ws_select on public.workspaces
  for select using (id in (select public.current_workspace_ids()));

drop policy if exists ws_update on public.workspaces;
create policy ws_update on public.workspaces
  for update using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));

-- --- profiles ---------------------------------------------------------------
-- SELECT: el propio perfil o perfiles del mismo workspace.
-- INSERT/UPDATE: solo el propio perfil (campos basicos). Los cambios de rol y
-- la gestion de otros perfiles se hacen server-side (rutas team/users con
-- service_role), igual que el contrato actual.
drop policy if exists pr_select on public.profiles;
create policy pr_select on public.profiles
  for select using (
    id = auth.uid()
    or workspace_id in (select public.current_workspace_ids())
  );

drop policy if exists pr_insert_self on public.profiles;
create policy pr_insert_self on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists pr_update_self on public.profiles;
create policy pr_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- --- workspace_members ------------------------------------------------------
-- SELECT: tus propias membresias, o cualquiera de un workspace donde eres
-- owner/admin (via is_workspace_admin, SECURITY DEFINER -> sin recursion).
-- INSERT/UPDATE/DELETE: solo owner/admin del workspace. El primer owner se
-- inserta server-side con service_role durante el onboarding (no recae en estas
-- policies, que requieren un admin ya existente).
drop policy if exists wm_select on public.workspace_members;
create policy wm_select on public.workspace_members
  for select using (
    user_id = auth.uid()
    or public.is_workspace_admin(workspace_id)
  );

drop policy if exists wm_insert on public.workspace_members;
create policy wm_insert on public.workspace_members
  for insert with check (public.is_workspace_admin(workspace_id));

drop policy if exists wm_update on public.workspace_members;
create policy wm_update on public.workspace_members
  for update using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

drop policy if exists wm_delete on public.workspace_members;
create policy wm_delete on public.workspace_members
  for delete using (public.is_workspace_admin(workspace_id));

-- ============================================================================
-- FIN 2E-1 core. El seed del workspace demo va en archivo separado.
-- ============================================================================
