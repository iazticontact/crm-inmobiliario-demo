-- ============================================================================
-- Fase N4 - Memoria de trabajo del Agent V2 (active entities / preferencias)
-- ----------------------------------------------------------------------------
-- Capa de "memoria de trabajo" PERSISTENTE para el asistente: recuerda la
-- entidad activa del hilo (este cliente / el anterior), preferencias y reglas
-- de workspace, mas alla de la Window Memory en memoria de n8n.
--
-- PRIVACIDAD: NO duplica PII sensible. Para clientes guarda SOLO una REFERENCIA
-- (entity_id + label de display), nunca DNI/email/telefono (esos viven en las
-- tablas CRM y se leen en tiempo real por tools). `metadata` es para banderas no
-- sensibles. La escritura la hace el SERVIDOR (/api/assistant/v2, autenticado),
-- NUNCA el LLM; el LLM solo lee la entidad activa que el servidor le pasa.
--
-- Seguridad: RLS por workspace (helper current_workspace_ids()) y por usuario
-- (auth.uid()) — la memoria es personal del usuario. DML a `authenticated`
-- (leccion H6B) y a `service_role`; `anon` sin DML. Idempotente. Solo
-- crm-inmobiliario-demo (ref ylhdbawrllqygfvllhdo). No toca core/seed/Auth/Storage.
-- ============================================================================

create table if not exists public.assistant_agent_memory (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  thread_id     uuid references public.assistant_threads(id) on delete cascade,
  memory_type   text not null check (memory_type in ('active_entity','previous_entity','preference','rule','summary')),
  entity_type   text check (entity_type in ('client','opportunity','service_case','task','calendar_event','property','document')),
  entity_id     uuid,
  label         text,
  summary       text,
  metadata      jsonb not null default '{}'::jsonb,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_agent_mem_thread
  on public.assistant_agent_memory (thread_id, memory_type, updated_at desc);
create index if not exists idx_agent_mem_ws_user
  on public.assistant_agent_memory (workspace_id, user_id, memory_type);
-- One active entity per (thread,user) -> the server upserts via delete+insert.
create unique index if not exists uq_agent_mem_active
  on public.assistant_agent_memory (thread_id, user_id)
  where memory_type = 'active_entity';

alter table public.assistant_agent_memory enable row level security;

drop policy if exists aam_select on public.assistant_agent_memory;
drop policy if exists aam_insert on public.assistant_agent_memory;
drop policy if exists aam_update on public.assistant_agent_memory;
drop policy if exists aam_delete on public.assistant_agent_memory;
create policy aam_select on public.assistant_agent_memory for select
  using (workspace_id in (select current_workspace_ids()) and user_id = auth.uid());
create policy aam_insert on public.assistant_agent_memory for insert
  with check (workspace_id in (select current_workspace_ids()) and user_id = auth.uid());
create policy aam_update on public.assistant_agent_memory for update
  using (workspace_id in (select current_workspace_ids()) and user_id = auth.uid())
  with check (workspace_id in (select current_workspace_ids()) and user_id = auth.uid());
create policy aam_delete on public.assistant_agent_memory for delete
  using (workspace_id in (select current_workspace_ids()) and user_id = auth.uid());

drop trigger if exists trg_agent_mem_updated on public.assistant_agent_memory;
create trigger trg_agent_mem_updated
  before update on public.assistant_agent_memory
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.assistant_agent_memory to authenticated;
grant select, insert, update, delete on public.assistant_agent_memory to service_role;
revoke select, insert, update, delete on public.assistant_agent_memory from anon;

-- ============================================================================
-- FIN N4. RLS por workspace+usuario; anon sin DML; sin PII sensible; sin tocar
-- core/seed/Auth/Storage.
-- ============================================================================
