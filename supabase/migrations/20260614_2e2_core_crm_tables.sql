-- ============================================================================
-- Fase 2E-2 - Core CRM (7 tablas operativas) + RLS por workspace
-- ----------------------------------------------------------------------------
-- Crea las tablas operativas del CRM inmobiliario sobre el nucleo multi-tenant
-- de 2E-1 (workspaces / profiles / workspace_members). Todas:
--   * llevan workspace_id NOT NULL -> workspaces(id) on delete cascade
--   * created_at / updated_at (updated_at por trigger public.set_updated_at)
--   * RLS activada con policies workspace-scoped usando los helpers de 2E-1:
--       public.current_workspace_ids()      (miembros del workspace)
--       public.current_workspace_role(uuid) (rol del usuario en ese workspace)
--       public.is_workspace_admin(uuid)     (owner/admin)
--   * indices por workspace_id y por campos de filtro/listado.
--
-- Modelo de acceso (roles de workspace_members):
--   SELECT  -> cualquier miembro (incluye solo_lectura)
--   INSERT  -> owner / admin / comercial
--   UPDATE  -> owner / admin / comercial
--   DELETE  -> owner / admin (datos criticos)
--   anon    -> nada (los helpers no son ejecutables por anon; ademas
--              current_workspace_ids() no devuelve nada sin auth.uid()).
--   service_role -> bypass de RLS (backend), implicito.
--
-- Soft delete (deleted_at) en entidades con valor historico: clients,
-- properties, opportunities, service_cases. Sus policies SELECT filtran
-- deleted_at is null. tasks / calendar_events / activities no usan soft delete.
--
-- Columnas: las que el codigo de hoy ya espera (ver docs/PHASE_2_CODE_SUPABASE_AUDIT.md)
-- + campos forward-looking de 2E-2 (FASE D) como NULLABLE aditivo, de modo que
-- NO rompen el frontend actual (selects/inserts existentes siguen validos).
--
-- NO EJECUTAR contra proyectos legacy. Solo crm-inmobiliario-demo
-- (ref ylhdbawrllqygfvllhdo). Idempotente (IF NOT EXISTS / OR REPLACE /
-- drop policy if exists). El seed va en archivo separado.
-- ============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ============================================================================
-- 1) clients  (leads / clientes de la inmobiliaria)
-- ============================================================================
create table if not exists public.clients (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  company      text,
  email        text,
  phone        text,
  channel      text check (channel in ('web','whatsapp','instagram','email','crm')),
  status       text not null default 'lead'
                 check (status in ('active','lead','inactive','churned')),
  lead_score   int not null default 0,
  notes        text,
  assigned_to  uuid references auth.users(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_clients_workspace        on public.clients(workspace_id);
create index if not exists idx_clients_ws_status         on public.clients(workspace_id, status);
create index if not exists idx_clients_ws_name           on public.clients(workspace_id, lower(name));
create index if not exists idx_clients_assigned          on public.clients(assigned_to);

drop trigger if exists trg_clients_updated on public.clients;
create trigger trg_clients_updated before update on public.clients
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2) properties  (inmuebles)
-- client_id = cliente propietario/lead asociado (opcional).
-- bedrooms/bathrooms/area_m2/reference = campos forward-looking (FASE D).
-- ============================================================================
create table if not exists public.properties (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  client_id      uuid references public.clients(id) on delete set null,
  title          text not null,
  reference      text,
  property_type  text,
  operation_type text,                                  -- venta / alquiler / ...
  status         text not null default 'available',
  city           text,
  area           text,                                  -- zona / barrio
  address        text,
  price          numeric(12,2),
  currency       text not null default 'EUR',
  bedrooms       int,
  bathrooms      int,
  area_m2        numeric(10,2),
  owner_name     text,
  owner_phone    text,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists idx_properties_workspace      on public.properties(workspace_id);
create index if not exists idx_properties_ws_status      on public.properties(workspace_id, status);
create index if not exists idx_properties_ws_operation   on public.properties(workspace_id, operation_type);
create index if not exists idx_properties_client         on public.properties(client_id);

drop trigger if exists trg_properties_updated on public.properties;
create trigger trg_properties_updated before update on public.properties
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3) opportunities  (pipeline comercial)
-- property_id promovido a columna real (antes vivia en metadata.property_id).
-- stage/pipeline = texto libre (configurable por vertical), sin CHECK rigido.
-- ============================================================================
create table if not exists public.opportunities (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  client_id           uuid references public.clients(id) on delete set null,
  property_id         uuid references public.properties(id) on delete set null,
  title               text not null,
  vertical            text,
  pipeline            text,
  stage               text,
  status              text,
  value               numeric(12,2),
  probability         int,
  currency            text not null default 'EUR',
  source              text,
  assigned_to         uuid references auth.users(id) on delete set null,
  expected_close_date date,
  notes               text,
  created_by          uuid references auth.users(id) on delete set null,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index if not exists idx_opportunities_workspace   on public.opportunities(workspace_id);
create index if not exists idx_opportunities_ws_stage    on public.opportunities(workspace_id, stage);
create index if not exists idx_opportunities_ws_assigned on public.opportunities(workspace_id, assigned_to);
create index if not exists idx_opportunities_client      on public.opportunities(client_id);
create index if not exists idx_opportunities_property    on public.opportunities(property_id);

drop trigger if exists trg_opportunities_updated on public.opportunities;
create trigger trg_opportunities_updated before update on public.opportunities
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 4) service_cases  (expedientes / gestiones)
-- case_type/status/priority = texto libre (configurable por vertical).
-- ============================================================================
create table if not exists public.service_cases (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  client_id      uuid references public.clients(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  property_id    uuid references public.properties(id) on delete set null,
  case_type      text,
  vertical       text,
  title          text not null,
  status         text,
  priority       text,
  due_date       date,
  assigned_to    uuid references auth.users(id) on delete set null,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists idx_cases_workspace           on public.service_cases(workspace_id);
create index if not exists idx_cases_ws_status           on public.service_cases(workspace_id, status);
create index if not exists idx_cases_client              on public.service_cases(client_id);
create index if not exists idx_cases_opportunity         on public.service_cases(opportunity_id);

drop trigger if exists trg_cases_updated on public.service_cases;
create trigger trg_cases_updated before update on public.service_cases
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 5) tasks  (tareas operativas)
-- client_name denormalizado (lo usa el codigo actual). property_id/
-- opportunity_id/case_id = forward-looking (FASE D), nullable.
-- ============================================================================
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  title          text not null,
  status         text not null default 'pending' check (status in ('pending','done')),
  priority       text,
  due_date       date,
  client_id      uuid references public.clients(id) on delete set null,
  client_name    text,
  property_id    uuid references public.properties(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  case_id        uuid references public.service_cases(id) on delete set null,
  assigned_to    uuid references auth.users(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_tasks_ws_status          on public.tasks(workspace_id, status);
create index if not exists idx_tasks_ws_due             on public.tasks(workspace_id, due_date);
create index if not exists idx_tasks_assigned           on public.tasks(assigned_to);
create index if not exists idx_tasks_client             on public.tasks(client_id);

drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 6) calendar_events  (agenda; sync con Google opcional)
-- Conserva las columnas exactas que usa el sync (start_at/end_at, date,
-- start_hour/start_minute/duration, google_*). property_id/opportunity_id/
-- case_id = forward-looking (FASE D), nullable.
-- ============================================================================
create table if not exists public.calendar_events (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  client_id         uuid references public.clients(id) on delete set null,
  property_id       uuid references public.properties(id) on delete set null,
  opportunity_id    uuid references public.opportunities(id) on delete set null,
  case_id           uuid references public.service_cases(id) on delete set null,
  title             text not null,
  type              text not null default 'meeting'
                      check (type in ('call','demo','meeting','follow-up')),
  start_at          timestamptz,
  end_at            timestamptz,
  date              date,
  start_hour        int,
  start_minute      int,
  duration          int,
  client_name       text,
  location          text,
  description       text,
  notes             text,
  status            text not null default 'active',
  google_event_id   text,
  google_calendar_id text,
  sync_source       text,
  last_synced_at    timestamptz,
  is_read_only      boolean not null default false,
  created_by        uuid references auth.users(id) on delete set null,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_events_ws_start          on public.calendar_events(workspace_id, start_at);
create index if not exists idx_events_client            on public.calendar_events(client_id);
-- Evita duplicados al importar desde Google (un event id por workspace).
create unique index if not exists uq_events_ws_google
  on public.calendar_events(workspace_id, google_event_id)
  where google_event_id is not null;

drop trigger if exists trg_events_updated on public.calendar_events;
create trigger trg_events_updated before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 7) activities  (timeline / log de actividad; NO soft delete, NO updated_at)
-- client_id/client_name = contrato del codigo; entity_type/entity_id =
-- enlace generico (FASE D). metadata.source = 'ui_manual' | 'nowlabs_agent'.
-- ============================================================================
create table if not exists public.activities (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type         text,
  title        text,
  description  text,
  client_id    uuid references public.clients(id) on delete set null,
  client_name  text,
  entity_type  text,
  entity_id    uuid,
  created_by   uuid references auth.users(id) on delete set null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_activities_ws_created    on public.activities(workspace_id, created_at desc);
create index if not exists idx_activities_client_created on public.activities(client_id, created_at desc);

-- ============================================================================
-- RLS + policies (workspace-scoped, via helpers de 2E-1, sin recursion)
-- ----------------------------------------------------------------------------
-- Patron por tabla de negocio:
--   SELECT  : workspace_id IN (current_workspace_ids())  [+ deleted_at is null]
--   INSERT  : current_workspace_role(workspace_id) IN ('owner','admin','comercial')
--   UPDATE  : idem (using + with check)
--   DELETE  : is_workspace_admin(workspace_id)
-- Los helpers son SECURITY DEFINER y NO consultan estas tablas -> sin recursion.
-- ============================================================================

-- ---- clients (soft delete) -------------------------------------------------
alter table public.clients enable row level security;
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select
  using (workspace_id in (select public.current_workspace_ids()) and deleted_at is null);
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update
  using (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'))
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete
  using (public.is_workspace_admin(workspace_id));

-- ---- properties (soft delete) ----------------------------------------------
alter table public.properties enable row level security;
drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select
  using (workspace_id in (select public.current_workspace_ids()) and deleted_at is null);
drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties for insert
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update
  using (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'))
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists properties_delete on public.properties;
create policy properties_delete on public.properties for delete
  using (public.is_workspace_admin(workspace_id));

-- ---- opportunities (soft delete) -------------------------------------------
alter table public.opportunities enable row level security;
drop policy if exists opportunities_select on public.opportunities;
create policy opportunities_select on public.opportunities for select
  using (workspace_id in (select public.current_workspace_ids()) and deleted_at is null);
drop policy if exists opportunities_insert on public.opportunities;
create policy opportunities_insert on public.opportunities for insert
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists opportunities_update on public.opportunities;
create policy opportunities_update on public.opportunities for update
  using (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'))
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists opportunities_delete on public.opportunities;
create policy opportunities_delete on public.opportunities for delete
  using (public.is_workspace_admin(workspace_id));

-- ---- service_cases (soft delete) -------------------------------------------
alter table public.service_cases enable row level security;
drop policy if exists service_cases_select on public.service_cases;
create policy service_cases_select on public.service_cases for select
  using (workspace_id in (select public.current_workspace_ids()) and deleted_at is null);
drop policy if exists service_cases_insert on public.service_cases;
create policy service_cases_insert on public.service_cases for insert
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists service_cases_update on public.service_cases;
create policy service_cases_update on public.service_cases for update
  using (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'))
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists service_cases_delete on public.service_cases;
create policy service_cases_delete on public.service_cases for delete
  using (public.is_workspace_admin(workspace_id));

-- ---- tasks (sin soft delete) -----------------------------------------------
alter table public.tasks enable row level security;
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (workspace_id in (select public.current_workspace_ids()));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'))
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete
  using (public.is_workspace_admin(workspace_id));

-- ---- calendar_events (sin soft delete) -------------------------------------
alter table public.calendar_events enable row level security;
drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events for select
  using (workspace_id in (select public.current_workspace_ids()));
drop policy if exists calendar_events_insert on public.calendar_events;
create policy calendar_events_insert on public.calendar_events for insert
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists calendar_events_update on public.calendar_events;
create policy calendar_events_update on public.calendar_events for update
  using (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'))
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_delete on public.calendar_events for delete
  using (public.is_workspace_admin(workspace_id));

-- ---- activities (log: SELECT miembros; INSERT owner/admin/comercial;
--      sin UPDATE; DELETE solo admin para limpieza puntual) -----------------
alter table public.activities enable row level security;
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select
  using (workspace_id in (select public.current_workspace_ids()));
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert
  with check (public.current_workspace_role(workspace_id) in ('owner','admin','comercial'));
drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities for delete
  using (public.is_workspace_admin(workspace_id));

-- ============================================================================
-- FIN 2E-2 core CRM. Seed demo en archivo separado
-- (20260614_2e2_seed_real_estate_demo_data.sql). Diferido a fases posteriores:
-- documents (+Storage) -> 2E-3 ; conversations/messages -> 2E-3 ;
-- invoices/invoice_items/invoice_sequences/billing_settings -> 2E-4.
-- ============================================================================
