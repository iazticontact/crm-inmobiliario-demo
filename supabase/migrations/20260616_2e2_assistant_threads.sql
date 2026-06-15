-- ============================================================================
-- Fase 2E-2 H8 - Persistencia dedicada del Copiloto interno del CRM
-- ----------------------------------------------------------------------------
-- Crea assistant_threads / assistant_messages para que las consultas internas
-- del asistente se guarden como un chat real (persisten tras refresh, se pueden
-- reabrir), SIN acoplarse a public.conversations / public.messages (esas son
-- Inbox/WhatsApp, fase futura, y no existen todavia).
--
-- Seguridad: RLS por workspace (reusa el helper current_workspace_ids()). DML
-- concedido SOLO a `authenticated` (leccion H6B: sin GRANT, RLS ni se evalua y
-- todo falla con 42501). `anon` no recibe DML. service_role no se toca.
--
-- Idempotente (create if not exists + drop policy/trigger if exists). NO toca
-- seeds, Auth, Storage, ni las tablas core. Solo crm-inmobiliario-demo
-- (ref ylhdbawrllqygfvllhdo).
-- ============================================================================

-- 1) Tablas ------------------------------------------------------------------
create table if not exists public.assistant_threads (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'Consulta interna',
  status          text not null default 'active' check (status in ('active','archived')),
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  thread_id       uuid not null references public.assistant_threads(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null default '',
  message_type    text not null default 'text',
  prepared_action jsonb,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_assistant_threads_ws_recent
  on public.assistant_threads (workspace_id, last_message_at desc);
create index if not exists idx_assistant_messages_thread
  on public.assistant_messages (thread_id, created_at);

-- 2) RLS ---------------------------------------------------------------------
alter table public.assistant_threads  enable row level security;
alter table public.assistant_messages enable row level security;

drop policy if exists at_select on public.assistant_threads;
drop policy if exists at_insert on public.assistant_threads;
drop policy if exists at_update on public.assistant_threads;
drop policy if exists at_delete on public.assistant_threads;
create policy at_select on public.assistant_threads for select
  using (workspace_id in (select current_workspace_ids()));
create policy at_insert on public.assistant_threads for insert
  with check (workspace_id in (select current_workspace_ids()) and user_id = auth.uid());
create policy at_update on public.assistant_threads for update
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));
create policy at_delete on public.assistant_threads for delete
  using (workspace_id in (select current_workspace_ids()));

drop policy if exists am_select on public.assistant_messages;
drop policy if exists am_insert on public.assistant_messages;
drop policy if exists am_delete on public.assistant_messages;
create policy am_select on public.assistant_messages for select
  using (workspace_id in (select current_workspace_ids()));
create policy am_insert on public.assistant_messages for insert
  with check (workspace_id in (select current_workspace_ids()));
create policy am_delete on public.assistant_messages for delete
  using (workspace_id in (select current_workspace_ids()));

-- 3) updated_at trigger (reusa public.set_updated_at) ------------------------
drop trigger if exists trg_assistant_threads_updated on public.assistant_threads;
create trigger trg_assistant_threads_updated
  before update on public.assistant_threads
  for each row execute function public.set_updated_at();

-- 4) GRANTS (solo authenticated; RLS sigue filtrando por workspace) ----------
grant select, insert, update, delete on public.assistant_threads  to authenticated;
grant select, insert, update, delete on public.assistant_messages to authenticated;
revoke select, insert, update, delete on public.assistant_threads  from anon;
revoke select, insert, update, delete on public.assistant_messages from anon;

-- ============================================================================
-- FIN H8. RLS por workspace; anon sin DML; sin tocar core/seed/Auth/Storage.
-- ============================================================================
