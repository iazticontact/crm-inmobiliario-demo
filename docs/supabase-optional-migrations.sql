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
