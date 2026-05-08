-- NowCRM optional migrations for advanced n8n logging.
-- Optional: execute only if you want persistent webhook execution logs.
-- Review names/RLS before running in production.

alter table if exists public.n8n_flows
  add column if not exists last_test_at timestamptz,
  add column if not exists last_status text,
  add column if not exists last_error text,
  add column if not exists last_response jsonb;

create table if not exists public.n8n_trigger_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flow_id uuid references public.n8n_flows(id) on delete set null,
  event_type text not null,
  status text not null check (status in ('ok', 'simulated', 'skipped', 'error')),
  mode text not null check (mode in ('demo', 'real')),
  webhook_url text,
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.n8n_trigger_logs enable row level security;

create policy "n8n trigger logs are visible to workspace members"
on public.n8n_trigger_logs
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.workspace_id = n8n_trigger_logs.workspace_id
      and p.user_id = auth.uid()
  )
);

create policy "n8n trigger logs can be inserted by workspace members"
on public.n8n_trigger_logs
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.workspace_id = n8n_trigger_logs.workspace_id
      and p.user_id = auth.uid()
  )
);

create table if not exists public.agent_action_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid,
  tool text not null,
  status text not null check (status in ('prepared', 'confirmed', 'skipped', 'error')),
  input jsonb,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.agent_action_logs enable row level security;

create policy "agent action logs are visible to workspace members"
on public.agent_action_logs
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.workspace_id = agent_action_logs.workspace_id
      and p.user_id = auth.uid()
  )
);

create policy "agent action logs can be inserted by workspace members"
on public.agent_action_logs
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.workspace_id = agent_action_logs.workspace_id
      and p.user_id = auth.uid()
  )
);

create index if not exists idx_n8n_trigger_logs_workspace_created
on public.n8n_trigger_logs (workspace_id, created_at desc);

create index if not exists idx_agent_action_logs_workspace_created
on public.agent_action_logs (workspace_id, created_at desc);

create index if not exists idx_clients_workspace_updated
on public.clients (workspace_id, updated_at desc);

create index if not exists idx_invoices_workspace_due
on public.invoices (workspace_id, due_date);

create index if not exists idx_calendar_events_workspace_date
on public.calendar_events (workspace_id, date);

alter table if exists public.messages
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists metadata jsonb;

create index if not exists idx_messages_workspace_conversation_created
on public.messages (workspace_id, conversation_id, created_at);

-- Optional backfill if messages already exist and conversations have workspace_id.
update public.messages m
set workspace_id = c.workspace_id
from public.conversations c
where m.conversation_id = c.id
  and m.workspace_id is null;

-- Review existing RLS before adding these policies.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'messages are visible to workspace members'
  ) then
    create policy "messages are visible to workspace members"
    on public.messages
    for select
    using (
      exists (
        select 1
        from public.profiles p
        where p.workspace_id = messages.workspace_id
          and p.user_id = auth.uid()
      )
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'messages can be inserted by workspace members'
  ) then
    create policy "messages can be inserted by workspace members"
    on public.messages
    for insert
    with check (
      exists (
        select 1
        from public.profiles p
        where p.workspace_id = messages.workspace_id
          and p.user_id = auth.uid()
      )
    );
  end if;
end $$;

-- Recommended updated_at trigger helper. Review if your project already has one.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_n8n_flows_updated_at on public.n8n_flows;
create trigger set_n8n_flows_updated_at
before update on public.n8n_flows
for each row execute function public.set_updated_at();

-- Optional document index table for Supabase Storage.
-- Buckets to create manually in Supabase Storage:
-- client-files, invoice-pdfs, proposal-pdfs, conversation-attachments, workspace-assets.
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  type text not null check (type in ('client_file', 'invoice_pdf', 'proposal_pdf', 'conversation_attachment', 'workspace_asset')),
  storage_bucket text not null,
  storage_path text not null,
  mime_type text,
  size bigint,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.documents enable row level security;

create index if not exists idx_documents_workspace_created
on public.documents (workspace_id, created_at desc);

create index if not exists idx_documents_client_created
on public.documents (client_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'documents'
      and policyname = 'documents are visible to workspace members'
  ) then
    create policy "documents are visible to workspace members"
    on public.documents
    for select
    using (
      exists (
        select 1
        from public.profiles p
        where p.workspace_id = documents.workspace_id
          and p.user_id = auth.uid()
      )
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'documents'
      and policyname = 'documents can be inserted by workspace members'
  ) then
    create policy "documents can be inserted by workspace members"
    on public.documents
    for insert
    with check (
      exists (
        select 1
        from public.profiles p
        where p.workspace_id = documents.workspace_id
          and p.user_id = auth.uid()
      )
    );
  end if;
end $$;
