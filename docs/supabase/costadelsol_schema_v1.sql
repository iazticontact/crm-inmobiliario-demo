-- =====================================================================
-- CostaDelSolRealHomesCRM — Supabase schema v1
-- =====================================================================
-- Project:        costadelsol-crm
-- Project ref:    ktsgfukjgldeylfzrayr
-- Organization:   NowLabs
-- Region:         eu-central-1
-- Author:         NowLabs CTO / architecture
-- Date:           2026-05-21
--
-- Status: REVIEW ONLY — DO NOT APPLY.
--
-- This file is the definitive blueprint for the Costa del Sol Real Homes
-- workspace database. It MUST be reviewed by ChatGPT and Oier before being
-- applied. Apply in order, one block at a time. Each block ends with a
-- COMMIT-friendly boundary so you can stop and verify state between blocks.
--
-- Design principles
-- -----------------
-- * Multi-tenant via workspace_id on every business table.
-- * RLS on every business table; service_role is the only path that bypasses.
-- * Column names in English to match the existing code in src/lib/*.
-- * UI strings are Spanish — the DB layer stays neutral.
-- * No enums — text columns with CHECK constraints, because the application
--   code normalizes statuses from many spellings (lead/Lead, paid/pagada…).
-- * No automatic auth.users → profiles trigger yet (invite flow comes later).
-- * No pg_cron / pg_net / Storage buckets in this file — documented separately.
--
-- Security contract for the IA assistant
-- --------------------------------------
-- The assistant runs server-side under the user's session (RLS active) or via
-- service_role for system actions. It reads from these *tables / views*:
--   clients, properties, opportunities, service_cases, documents,
--   calendar_events, conversations, messages, tasks, invoices, activities,
--   workspace_settings, integrations, workspace_templates,
--   inbox_agent_settings, vw_google_calendar_status, vw_whatsapp_status
-- It MUST NOT read:
--   google_calendar_connections.refresh_token_enc, any column called *_token*
--   or *_secret*, integrations.config secret payloads, n8n secrets, OpenAI
--   keys, Resend keys, service_role keys. These are environment variables and
--   are not stored in the database.
--
-- Apply order (one block at a time):
--   BLOQUE 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11
-- =====================================================================


-- =====================================================================
-- BLOQUE 00 — Preflight / neutralizar rls_auto_enable
-- =====================================================================
-- The previous Supabase project shipped with a SECURITY DEFINER function
-- public.rls_auto_enable() that anon and authenticated could execute over
-- RPC. We do NOT drop it (the user wants a paper trail), but we revoke
-- EXECUTE so it can never be called from the client.
--
-- The DO block makes the revoke idempotent: if the function does not exist
-- the script must not fail.
-- ---------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from anon';
    execute 'revoke execute on function public.rls_auto_enable() from authenticated';
    execute 'revoke execute on function public.rls_auto_enable() from public';
    raise notice '[preflight] revoked EXECUTE on public.rls_auto_enable() from anon/authenticated/public';
  else
    raise notice '[preflight] public.rls_auto_enable() does not exist — nothing to revoke';
  end if;
end $$;

-- Defense-in-depth: make sure anon cannot do anything by default with new
-- objects we create later in this file. We will GRANT what authenticated
-- needs table-by-table, and never grant anything to anon.
-- (No-op if the role doesn't exist.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema public from anon';
    execute 'grant usage on schema public to anon';
  end if;
end $$;


-- =====================================================================
-- BLOQUE 01 — Extensions + helpers
-- =====================================================================
-- pgcrypto is needed for gen_random_uuid(). It is already installed on most
-- Supabase projects, but we make it explicit so a fresh project also works.
-- ---------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Helper: set_updated_at()
-- ---------------------------------------------------------------------
-- Trigger function used by every business table that has updated_at.
-- Stamps NEW.updated_at = now() before write so the application code does
-- not have to remember it on every UPDATE.
--
-- Security: SECURITY INVOKER — runs with the caller's privileges, no
-- privilege escalation. The function body only touches NEW, never reads
-- other tables.
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to authenticated;
-- service_role can already call anything; no explicit grant needed.

-- ---------------------------------------------------------------------
-- Helper: current_workspace_id()
-- ---------------------------------------------------------------------
-- Returns the workspace_id of the currently authenticated user, by looking
-- it up in public.profiles. Returns NULL for anon or unprovisioned users.
--
-- SECURITY DEFINER on purpose: this function is called from RLS policies on
-- the very table it reads (public.profiles). Running it as SECURITY INVOKER
-- would re-enter those policies, either causing infinite recursion (Postgres
-- detects the cycle and errors) or returning NULL because the policy denies
-- the read while it is being evaluated. SECURITY DEFINER runs with the
-- function owner's privileges (postgres in Supabase), which bypasses RLS
-- on profiles for this single read. The function returns ONLY the
-- workspace_id of auth.uid() — it cannot be coerced to leak any other row.
--
-- STABLE so the planner can cache the result across multiple policy
-- evaluations within one statement.
--
-- search_path is pinned to pg_catalog, public to prevent search_path
-- attacks against a SECURITY DEFINER function.
-- ---------------------------------------------------------------------
create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.workspace_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

revoke all on function public.current_workspace_id() from public;
revoke all on function public.current_workspace_id() from anon;
grant execute on function public.current_workspace_id() to authenticated;

-- ---------------------------------------------------------------------
-- Helper: current_user_role()
-- ---------------------------------------------------------------------
-- Returns the role text of the currently authenticated user from
-- public.profiles. Returns NULL for anon. Used both inside RLS policies
-- and (sparingly) by application code to gate UI elements.
--
-- SECURITY DEFINER for the same reason as current_workspace_id(): policies
-- on public.profiles call this helper, and an INVOKER call would re-enter
-- those policies. The function only ever returns the role for auth.uid(),
-- so a malicious caller cannot enumerate other users' roles through it.
-- ---------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_role() from anon;
grant execute on function public.current_user_role() to authenticated;

-- ---------------------------------------------------------------------
-- Helper: is_nowlabs_admin()
-- ---------------------------------------------------------------------
-- True when the current user has the nowlabs_admin role. Used to grant
-- cross-workspace visibility to the NowLabs operations team.
--
-- SECURITY DEFINER so it can call current_user_role() without re-entering
-- the profiles RLS chain. The body is a single coalesce expression — no
-- way to coerce it into reading anything else.
-- ---------------------------------------------------------------------
create or replace function public.is_nowlabs_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(public.current_user_role() = 'nowlabs_admin', false);
$$;

revoke all on function public.is_nowlabs_admin() from public;
revoke all on function public.is_nowlabs_admin() from anon;
grant execute on function public.is_nowlabs_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Helper: is_workspace_admin()
-- ---------------------------------------------------------------------
-- True when the current user is client_admin OR nowlabs_admin. Used to
-- gate destructive operations like DELETE on business tables, and updates
-- on workspace-level settings.
--
-- SECURITY DEFINER for the same recursion reason as the helpers above.
-- ---------------------------------------------------------------------
create or replace function public.is_workspace_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(public.current_user_role() in ('client_admin', 'nowlabs_admin'), false);
$$;

revoke all on function public.is_workspace_admin() from public;
revoke all on function public.is_workspace_admin() from anon;
grant execute on function public.is_workspace_admin() to authenticated;


-- =====================================================================
-- BLOQUE 02 — Core tenancy: workspaces, profiles, workspace_settings
-- =====================================================================

-- ---------------------------------------------------------------------
-- Table: workspaces
-- ---------------------------------------------------------------------
-- One row per customer tenant. The slug is the public-safe identifier we
-- can show in URLs. The plan and status columns drive billing gates in
-- the app code.
-- ---------------------------------------------------------------------
create table if not exists public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  business_name   text,
  plan            text not null default 'pro'
                    check (plan in ('starter', 'pro', 'enterprise', 'internal')),
  status          text not null default 'active'
                    check (status in ('active', 'trialing', 'suspended', 'cancelled')),
  trial_status    text
                    check (trial_status is null or trial_status in ('active', 'expired', 'converted', 'cancelled')),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_workspaces_updated_at on public.workspaces;
create trigger trg_workspaces_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: profiles
-- ---------------------------------------------------------------------
-- One row per Supabase auth user. profiles.id MUST equal auth.users.id —
-- the application code joins via this equality and the frontend reads
-- supabase.auth.getUser().id then queries profiles by that id.
--
-- The fk on (id) → auth.users(id) is ON DELETE CASCADE: if an auth user
-- is deleted, their profile vanishes with them. This avoids dangling rows
-- and is the standard Supabase pattern.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  workspace_id    uuid references public.workspaces(id) on delete set null,
  email           text,
  full_name       text,
  role            text not null default 'member'
                    check (role in ('nowlabs_admin', 'client_admin', 'member')),
  trial_status    text
                    check (trial_status is null or trial_status in ('active', 'expired', 'converted', 'cancelled')),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: workspace_settings
-- ---------------------------------------------------------------------
-- One row per workspace. Holds the workspace-level preferences (vertical,
-- timezone, AI tone). The column name `default_language` MUST stay as-is
-- — src/lib/workspace-settings.ts reads it under that exact name.
--
-- The unique constraint on workspace_id enforces the single-row-per-
-- workspace contract the app relies on.
-- ---------------------------------------------------------------------
create table if not exists public.workspace_settings (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  vertical              text not null default 'general'
                          check (vertical in ('general', 'real_estate', 'immigration', 'professional_services', 'mixed')),
  business_name         text,
  default_language      text not null default 'es',
  timezone              text not null default 'Europe/Madrid',
  ai_tone               text not null default 'professional'
                          check (ai_tone in ('professional', 'friendly', 'concise', 'casual')),
  auto_reply_enabled    boolean not null default false,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint workspace_settings_workspace_unique unique (workspace_id)
);

drop trigger if exists trg_workspace_settings_updated_at on public.workspace_settings;
create trigger trg_workspace_settings_updated_at
before update on public.workspace_settings
for each row execute function public.set_updated_at();


-- =====================================================================
-- BLOQUE 03 — CRM business tables: clients, properties, opportunities,
--             service_cases
-- =====================================================================

-- ---------------------------------------------------------------------
-- Table: clients
-- ---------------------------------------------------------------------
-- The customer / lead entity. Columns and types match src/lib/supabase-
-- queries.ts CLIENT_COLUMNS exactly.
--
-- `channel` is the primary inbound channel for the client. The CHECK is
-- intentionally permissive because the app code normalizes a wide variety
-- of inbound strings — see normalizeChannelKey() in supabase-queries.ts.
--
-- `lead_score` is a 0..100 integer. The app uses 70+ as "hot lead".
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  name            text not null,
  company         text,
  email           text,
  phone           text,
  channel         text not null default 'web'
                    check (channel in ('whatsapp', 'email', 'web', 'instagram', 'crm', 'sms', 'internal', 'other')),
  status          text not null default 'lead'
                    check (status in ('lead', 'active', 'inactive', 'churned')),
  lead_score      integer not null default 50 check (lead_score between 0 and 100),
  notes           text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: properties
-- ---------------------------------------------------------------------
-- Real-estate listings managed by Costa del Sol Real Homes. The schema
-- matches src/lib/vertical-queries.ts PropertyRow exactly.
--
-- price is numeric(14,2) so we never lose cents and never overflow on
-- luxury Marbella listings.
-- ---------------------------------------------------------------------
create table if not exists public.properties (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  client_id         uuid references public.clients(id) on delete set null,
  title             text not null,
  property_type     text default 'apartment'
                      check (property_type is null or property_type in (
                        'apartment', 'house', 'villa', 'penthouse', 'townhouse',
                        'commercial', 'land', 'office', 'other'
                      )),
  operation_type    text default 'sale'
                      check (operation_type is null or operation_type in ('sale', 'rent', 'short_term_rent', 'transfer')),
  status            text not null default 'prospecting'
                      check (status in ('prospecting', 'listed', 'under_contract', 'sold', 'rented', 'withdrawn', 'archived')),
  city              text,
  area              text,
  address           text,
  price             numeric(14,2),
  currency          text default 'EUR',
  owner_name        text,
  owner_phone       text,
  notes             text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_properties_updated_at on public.properties;
create trigger trg_properties_updated_at
before update on public.properties
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: opportunities
-- ---------------------------------------------------------------------
-- Sales pipeline entries. One client can have several opportunities — for
-- example a buyer looking at three properties. The columns match
-- src/lib/vertical-queries.ts OpportunityRow exactly.
--
-- value/probability are nullable because the app supports partially
-- qualified opportunities (just title + stage).
-- ---------------------------------------------------------------------
create table if not exists public.opportunities (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  client_id             uuid references public.clients(id) on delete set null,
  title                 text not null,
  vertical              text not null default 'real_estate'
                          check (vertical in ('general', 'real_estate', 'immigration', 'professional_services', 'mixed')),
  pipeline              text not null default 'default',
  stage                 text not null default 'new'
                          check (stage in ('new', 'qualifying', 'proposal', 'negotiation', 'won', 'lost', 'on_hold')),
  value                 numeric(14,2),
  probability           integer check (probability is null or probability between 0 and 100),
  currency              text default 'EUR',
  source                text,
  assigned_to           uuid references public.profiles(id) on delete set null,
  expected_close_date   date,
  notes                 text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists trg_opportunities_updated_at on public.opportunities;
create trigger trg_opportunities_updated_at
before update on public.opportunities
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: service_cases
-- ---------------------------------------------------------------------
-- Gestoría / Extranjería case files. case_type is free-text on purpose:
-- the vertical packs define their own taxonomy (e.g. "residency_renewal",
-- "nie_application") and we do not want to lock that down at the DB
-- level. The check on status covers the canonical lifecycle.
-- ---------------------------------------------------------------------
create table if not exists public.service_cases (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  client_id         uuid references public.clients(id) on delete set null,
  opportunity_id    uuid references public.opportunities(id) on delete set null,
  case_type         text not null,
  vertical          text not null default 'immigration'
                      check (vertical in ('general', 'real_estate', 'immigration', 'professional_services', 'mixed')),
  title             text not null,
  status            text not null default 'open'
                      check (status in ('open', 'in_progress', 'waiting_client', 'waiting_admin', 'blocked', 'resolved', 'closed', 'cancelled')),
  priority          text not null default 'normal'
                      check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date          date,
  assigned_to       uuid references public.profiles(id) on delete set null,
  notes             text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_service_cases_updated_at on public.service_cases;
create trigger trg_service_cases_updated_at
before update on public.service_cases
for each row execute function public.set_updated_at();


-- =====================================================================
-- BLOQUE 04 — Inbox/conversations/messages
-- =====================================================================

-- ---------------------------------------------------------------------
-- Table: conversations
-- ---------------------------------------------------------------------
-- One conversation thread per channel × client. The Inbox UI defaults to
-- excluding channel='crm' (assistant copilot threads) — that filter is
-- enforced by the app code (src/app/api/inbox/conversations/route.ts) and
-- does NOT rely on RLS.
--
-- assistant_mode is stored both as an optional column and inside metadata
-- so the inferAssistantMode() helper in supabase-queries.ts keeps working
-- whether or not the column has been populated.
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  client_id         uuid references public.clients(id) on delete set null,
  client_name       text,
  client_avatar     text,
  channel           text not null default 'web'
                      check (channel in ('whatsapp', 'email', 'web', 'instagram', 'crm', 'sms', 'test', 'internal', 'other')),
  status            text not null default 'open'
                      check (status in ('open', 'pending', 'resolved', 'archived', 'deleted')),
  sentiment         text default 'neutral'
                      check (sentiment is null or sentiment in ('positive', 'neutral', 'negative', 'urgent')),
  intent            text,
  ai_summary        text,
  assistant_mode    text
                      check (assistant_mode is null or assistant_mode in ('inbox', 'copilot')),
  unread            boolean not null default false,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: messages
-- ---------------------------------------------------------------------
-- One row per inbound or outbound message. workspace_id is denormalized
-- (redundant with conversation.workspace_id) because the app filters by
-- it directly in many places — see src/lib/supabase-queries.ts
-- MESSAGE_COLUMNS — and we want the index to be a simple btree.
--
-- external_message_id is the Meta Cloud API message id (wamid…), used by
-- src/lib/whatsapp-inbound.ts to dedupe webhook deliveries. The column is
-- nullable because not every message has one (assistant-generated
-- messages don't), and unique only when present — see Block 07.
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  conversation_id         uuid not null references public.conversations(id) on delete cascade,
  sender                  text not null default 'client'
                            check (sender in ('client', 'agent', 'ai', 'system')),
  body                    text not null,
  is_ai                   boolean not null default false,
  external_message_id     text,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now()
);


-- =====================================================================
-- BLOQUE 05 — Calendar/documents/tasks/invoices/activities/notifications
-- =====================================================================

-- ---------------------------------------------------------------------
-- Table: calendar_events
-- ---------------------------------------------------------------------
-- Workspace-level calendar. The app currently treats events as workspace-
-- scoped (no per-user calendars yet). We leave assigned_to in the schema
-- so a later user-level migration can populate it without a schema change.
--
-- Both start_at/end_at (canonical) and date/start_hour/start_minute/
-- duration (legacy) are kept because:
--   * the new code in src/lib/supabase-queries.ts mapSupabaseCalendarEvent
--     prefers start_at when present, falls back to date+hour+minute,
--   * the Google Calendar import in src/app/api/integrations/google/calendar
--     /import-events/route.ts populates BOTH so existing rows still render.
-- start_at/end_at are NOT NULL because the app errors out without them.
--
-- google_sync_status is referenced by the import-events route when it
-- soft-cancels rows whose origin event was deleted from Google.
-- ---------------------------------------------------------------------
create table if not exists public.calendar_events (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  client_id             uuid references public.clients(id) on delete set null,
  client_name           text,
  title                 text not null,
  type                  text default 'meeting'
                          check (type is null or type in ('call', 'demo', 'meeting', 'follow-up', 'visit', 'consultation', 'other')),
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  date                  date,
  start_hour            integer check (start_hour is null or start_hour between 0 and 23),
  start_minute          integer check (start_minute is null or start_minute between 0 and 59),
  duration              integer check (duration is null or duration > 0),
  location              text,
  notes                 text,
  description           text,
  status                text not null default 'scheduled'
                          check (status in ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
  google_event_id       text,
  google_calendar_id    text,
  sync_source           text
                          check (sync_source is null or sync_source in ('google', 'manual', 'n8n', 'whatsapp', 'crm', 'import')),
  last_synced_at        timestamptz,
  google_sync_status    text
                          check (google_sync_status is null or google_sync_status in ('synced', 'pending', 'deleted_from_google', 'error')),
  is_read_only          boolean not null default false,
  assigned_to           uuid references public.profiles(id) on delete set null,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint calendar_events_end_after_start check (end_at >= start_at)
);

drop trigger if exists trg_calendar_events_updated_at on public.calendar_events;
create trigger trg_calendar_events_updated_at
before update on public.calendar_events
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: documents
-- ---------------------------------------------------------------------
-- Pointers to files stored in Supabase Storage. The type CHECK matches
-- normalizeDocumentType() in src/lib/supabase-queries.ts exactly — these
-- are the buckets the application code expects (documented in the
-- workspace onboarding notes but not yet auto-created).
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,
  title           text not null,
  type            text not null
                    check (type in ('client_file', 'invoice_pdf', 'proposal_pdf', 'conversation_attachment', 'workspace_asset')),
  storage_bucket  text not null,
  storage_path    text not null,
  mime_type       text,
  size            bigint check (size is null or size >= 0),
  created_by      uuid references public.profiles(id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Table: tasks
-- ---------------------------------------------------------------------
-- Internal to-do items, optionally linked to a client. The app reads/writes
-- these via src/lib/supabase-queries.ts createTask / listTasks /
-- getPendingTasks.
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,
  client_name     text,
  title           text not null,
  description     text,
  assigned_to     uuid references public.profiles(id) on delete set null,
  status          text not null default 'pending'
                    check (status in ('pending', 'in_progress', 'done', 'cancelled', 'blocked')),
  priority        text not null default 'normal'
                    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date        date,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: invoices
-- ---------------------------------------------------------------------
-- Both `invoice_number` and `number` exist because the existing code
-- writes both (see toInvoiceRow() in supabase-queries.ts) and falls back
-- if either is missing. Same logic for `concept` and `plan`. Do NOT
-- collapse them into one column — that would break compatibility.
--
-- client_name is denormalized for fast list queries and assistant-tool
-- lookups; the app falls back to the related clients row when missing.
-- ---------------------------------------------------------------------
create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,
  client_name     text,
  invoice_number  text,
  number          text,
  concept         text,
  plan            text,
  amount          numeric(12,2) not null default 0,
  currency        text not null default 'EUR',
  status          text not null default 'pending'
                    check (status in ('pending', 'paid', 'overdue', 'cancelled', 'draft')),
  issue_date      date,
  due_date        date,
  paid_at         timestamptz,
  notes           text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: activities
-- ---------------------------------------------------------------------
-- The workspace timeline. The application writes here from many places:
-- vertical-queries.ts logActivity(), whatsapp-inbound.ts
-- createActivityBestEffort(), and direct calls from the assistant. Type
-- is intentionally text without a CHECK because the set is open-ended
-- (e.g. "opportunity_created", "service_case_status_updated",
-- "whatsapp_message_inbound").
-- ---------------------------------------------------------------------
create table if not exists public.activities (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,
  client_name     text,
  type            text not null,
  title           text,
  description     text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Table: notifications
-- ---------------------------------------------------------------------
-- Per-user (per-profile) notifications, NOT per-workspace. The app reads
-- them via listNotifications(profileId) in supabase-queries.ts. RLS in
-- Block 08 scopes them by auth.uid().
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  workspace_id    uuid references public.workspaces(id) on delete cascade,
  title           text not null,
  message         text,
  link            text,
  category        text,
  read            boolean not null default false,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_notifications_updated_at on public.notifications;
create trigger trg_notifications_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();


-- =====================================================================
-- BLOQUE 06 — integrations / whatsapp / google / templates / agent / n8n
-- =====================================================================
-- IMPORTANT: do NOT store provider secrets (OAuth client secrets, API
-- keys, webhook verify tokens) in any of these tables. Secrets stay in
-- server env vars only. The only credential stored here is
-- google_calendar_connections.refresh_token_enc, which is read exclusively
-- by server routes using SUPABASE_SERVICE_ROLE_KEY. See the security note
-- on that table below.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Table: integrations
-- ---------------------------------------------------------------------
-- Per-workspace integration catalog (status, public-facing label). This
-- table is safe to expose to the IA assistant via RLS — see Block 08.
-- Do NOT put secrets in the config jsonb; the application doesn't, and
-- granting SELECT to authenticated would leak them if you did.
-- ---------------------------------------------------------------------
create table if not exists public.integrations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  provider        text not null,
  name            text not null,
  status          text not null default 'pending'
                    check (status in ('connected', 'demo_connected', 'demo_ready', 'disconnected', 'pending', 'pending_config', 'error')),
  config          jsonb not null default '{}'::jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint integrations_workspace_provider_unique unique (workspace_id, provider)
);

drop trigger if exists trg_integrations_updated_at on public.integrations;
create trigger trg_integrations_updated_at
before update on public.integrations
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: whatsapp_connections
-- ---------------------------------------------------------------------
-- Per-workspace Meta WhatsApp Cloud API binding. We deliberately DO NOT
-- store access tokens here — Meta tokens stay in env vars. The DB only
-- knows the public identifiers (phone_number_id, business ids, display
-- numbers) plus connection status and last-webhook timestamp.
--
-- The application code (src/lib/supabase-queries.ts getWhatsappConnection)
-- expects `connection_status`, NOT `status` — do NOT rename.
-- ---------------------------------------------------------------------
create table if not exists public.whatsapp_connections (
  id                              uuid primary key default gen_random_uuid(),
  workspace_id                    uuid not null references public.workspaces(id) on delete cascade,
  provider                        text not null default 'meta'
                                    check (provider in ('meta', 'twilio', '360dialog', 'test')),
  phone_number                    text,
  phone_number_id                 text,
  whatsapp_business_account_id    text,
  meta_business_id                text,
  connection_status               text not null default 'pending'
                                    check (connection_status in ('connected', 'pending', 'webhook_pending', 'pending_meta_business', 'disconnected', 'error')),
  webhook_url                     text,
  sync_enabled                    boolean not null default false,
  last_webhook_at                 timestamptz,
  last_test_at                    timestamptz,
  metadata                        jsonb not null default '{}'::jsonb,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint whatsapp_connections_workspace_unique unique (workspace_id)
);

drop trigger if exists trg_whatsapp_connections_updated_at on public.whatsapp_connections;
create trigger trg_whatsapp_connections_updated_at
before update on public.whatsapp_connections
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: google_calendar_connections
-- ---------------------------------------------------------------------
-- Per-workspace Google Calendar binding.
--
-- SECURITY NOTE — refresh_token_enc:
--   This column holds the OAuth refresh token. Today it is stored in
--   PLAINTEXT (the column name "_enc" is aspirational). The application
--   writes it via SUPABASE_SERVICE_ROLE_KEY in the callback route and the
--   import-events route. Workspace members can also see it through the
--   API status route (src/app/api/integrations/google/calendar/status/
--   route.ts) which only returns a boolean derived from its presence.
--
--   To avoid an information disclosure path through direct supabase-js,
--   Block 09 ships a vw_google_calendar_status VIEW with no token column
--   and Block 08 keeps RLS on the table itself locked to admins.
--   Regular workspace members can NOT read the table directly — they read
--   the view. The server routes that legitimately need the token use the
--   service_role key, which bypasses RLS.
--
--   TODO before production: encrypt refresh_token_enc at rest (pgsodium /
--   pgcrypto envelope), rotate the existing token, and document the
--   decryption path used by the server routes.
-- ---------------------------------------------------------------------
create table if not exists public.google_calendar_connections (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                uuid not null references public.workspaces(id) on delete cascade,
  status                      text not null default 'pending'
                                check (status in ('connected', 'pending', 'oauth_pending', 'token_expired', 'disconnected', 'error', 'not_configured')),
  calendar_id                 text,
  default_calendar_id         text,
  selected_calendar_ids       jsonb not null default '[]'::jsonb,
  calendar_metadata           jsonb not null default '{}'::jsonb,
  sync_enabled                boolean not null default false,
  last_sync_at                timestamptz,
  refresh_token_enc           text,
  token_expiry                timestamptz,
  webhook_channel_id          text,
  webhook_resource_id         text,
  webhook_expires_at          timestamptz,
  incremental_sync_tokens     jsonb not null default '{}'::jsonb,
  metadata                    jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint google_calendar_connections_workspace_unique unique (workspace_id)
);

drop trigger if exists trg_google_calendar_connections_updated_at on public.google_calendar_connections;
create trigger trg_google_calendar_connections_updated_at
before update on public.google_calendar_connections
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: workspace_templates
-- ---------------------------------------------------------------------
-- Per-workspace editable message / proposal / document_request templates.
-- Matches src/lib/workspace-templates.ts WorkspaceTemplate exactly.
-- ---------------------------------------------------------------------
create table if not exists public.workspace_templates (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  type            text not null
                    check (type in ('message', 'proposal', 'document_request', 'custom')),
  vertical        text not null default 'general'
                    check (vertical in ('general', 'real_estate', 'immigration', 'professional_services', 'mixed')),
  name            text not null,
  channel         text,
  content         text not null,
  status          text not null default 'active'
                    check (status in ('active', 'archived', 'draft')),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_workspace_templates_updated_at on public.workspace_templates;
create trigger trg_workspace_templates_updated_at
before update on public.workspace_templates
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: inbox_agent_settings
-- ---------------------------------------------------------------------
-- One row per workspace describing how the NowLabs Inbox Agent should
-- behave (tone, business context, auto-reply gate). business_context is
-- read by the WhatsApp agent — see src/app/api/inbox/agent/route.ts.
-- ---------------------------------------------------------------------
create table if not exists public.inbox_agent_settings (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  enabled               boolean not null default true,
  mode                  text not null default 'manual'
                          check (mode in ('manual', 'suggest', 'auto', 'shadow')),
  agent_name            text default 'NowLabs Agent',
  auto_reply_enabled    boolean not null default false,
  handoff_enabled       boolean not null default true,
  business_context      text,
  tone                  text default 'professional'
                          check (tone is null or tone in ('professional', 'friendly', 'concise', 'casual')),
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint inbox_agent_settings_workspace_unique unique (workspace_id)
);

drop trigger if exists trg_inbox_agent_settings_updated_at on public.inbox_agent_settings;
create trigger trg_inbox_agent_settings_updated_at
before update on public.inbox_agent_settings
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: automation_workflows
-- ---------------------------------------------------------------------
-- Workspace-level catalog of automations the operator has enabled in-app.
-- The app upserts by (workspace_id, name) — see src/lib/supabase-queries.ts
-- upsertAutomationWorkflow. We enforce that uniqueness here.
-- ---------------------------------------------------------------------
create table if not exists public.automation_workflows (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  name                text not null,
  description         text,
  trigger             text,
  enabled_in_app      boolean not null default false,
  n8n_event           text,
  status              text not null default 'active'
                        check (status in ('active', 'inactive', 'pending_config', 'error')),
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint automation_workflows_workspace_name_unique unique (workspace_id, name)
);

drop trigger if exists trg_automation_workflows_updated_at on public.automation_workflows;
create trigger trg_automation_workflows_updated_at
before update on public.automation_workflows
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: n8n_flows
-- ---------------------------------------------------------------------
-- Per-workspace n8n flow registry. The DB does NOT store the n8n webhook
-- secret — only the public webhook_url. Secrets stay in N8N_BASE_URL /
-- N8N_WEBHOOK_SECRET env vars.
--
-- The legacy boolean columns (requires_supabase, requires_whatsapp,
-- requires_payment_api) are preserved because the existing app code in
-- toN8nFlowRow() writes them. A future migration can collapse them into
-- a single `requires text[]` column.
-- ---------------------------------------------------------------------
create table if not exists public.n8n_flows (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  name                    text not null,
  trigger_event           text not null,
  description             text,
  webhook_url             text,
  status                  text not null default 'pending_config'
                            check (status in ('active', 'inactive', 'demo', 'pending_config', 'error')),
  requires_supabase       boolean not null default true,
  requires_whatsapp       boolean not null default false,
  requires_payment_api    boolean not null default false,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint n8n_flows_workspace_trigger_unique unique (workspace_id, trigger_event)
);

drop trigger if exists trg_n8n_flows_updated_at on public.n8n_flows;
create trigger trg_n8n_flows_updated_at
before update on public.n8n_flows
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Table: n8n_trigger_logs
-- ---------------------------------------------------------------------
-- Append-only audit trail of each n8n trigger. The app writes here
-- best-effort from createN8nTriggerLog(). Workspace members SHOULD NOT
-- read these — they are operator/forensic. RLS in Block 08 restricts
-- SELECT to workspace_admin and nowlabs_admin.
-- ---------------------------------------------------------------------
create table if not exists public.n8n_trigger_logs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  trigger         text not null,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Table: agent_action_logs
-- ---------------------------------------------------------------------
-- Append-only audit trail of every action the NowLabs AI agent takes
-- inside the workspace (create_invoice, schedule_event, send_reply…).
-- Same RLS treatment as n8n_trigger_logs.
-- ---------------------------------------------------------------------
create table if not exists public.agent_action_logs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  action          text not null,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);


-- =====================================================================
-- BLOQUE 07 — Indexes
-- =====================================================================
-- Only the indexes that the application actually queries on. No
-- full-text indexes in v1; we will add them when the dashboards demand
-- it. All workspace_id indexes are deliberately btree (good enough for
-- equality filters and ORDER BY created_at DESC).
-- ---------------------------------------------------------------------

-- profiles
create index if not exists idx_profiles_workspace_id on public.profiles(workspace_id);
create index if not exists idx_profiles_email_lower on public.profiles(lower(email));

-- clients
create index if not exists idx_clients_workspace_id on public.clients(workspace_id);
create index if not exists idx_clients_workspace_status on public.clients(workspace_id, status);
create index if not exists idx_clients_workspace_lead_score on public.clients(workspace_id, lead_score desc);
create index if not exists idx_clients_workspace_created_at on public.clients(workspace_id, created_at desc);
create index if not exists idx_clients_phone on public.clients(phone) where phone is not null;
create index if not exists idx_clients_email_lower on public.clients(lower(email)) where email is not null;

-- properties
create index if not exists idx_properties_workspace_id on public.properties(workspace_id);
create index if not exists idx_properties_workspace_status on public.properties(workspace_id, status);
create index if not exists idx_properties_client on public.properties(workspace_id, client_id) where client_id is not null;

-- opportunities
create index if not exists idx_opportunities_workspace_id on public.opportunities(workspace_id);
create index if not exists idx_opportunities_workspace_stage on public.opportunities(workspace_id, stage);
create index if not exists idx_opportunities_client on public.opportunities(workspace_id, client_id) where client_id is not null;
create index if not exists idx_opportunities_workspace_updated_at on public.opportunities(workspace_id, updated_at desc);

-- service_cases
create index if not exists idx_service_cases_workspace_id on public.service_cases(workspace_id);
create index if not exists idx_service_cases_workspace_status on public.service_cases(workspace_id, status);
create index if not exists idx_service_cases_client on public.service_cases(workspace_id, client_id) where client_id is not null;
create index if not exists idx_service_cases_due_date on public.service_cases(workspace_id, due_date) where due_date is not null;

-- conversations
create index if not exists idx_conversations_workspace_id on public.conversations(workspace_id);
create index if not exists idx_conversations_workspace_updated_at on public.conversations(workspace_id, updated_at desc);
create index if not exists idx_conversations_client on public.conversations(workspace_id, client_id) where client_id is not null;
create index if not exists idx_conversations_workspace_status on public.conversations(workspace_id, status);
-- GIN on metadata so the whatsapp-inbound resolver can use .contains({phone: …}).
create index if not exists idx_conversations_metadata_gin on public.conversations using gin (metadata jsonb_path_ops);

-- messages
create index if not exists idx_messages_workspace_id on public.messages(workspace_id);
create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at);
create index if not exists idx_messages_workspace_created_at on public.messages(workspace_id, created_at desc);
-- Partial unique index gives idempotent webhook dedupe by (workspace, external_message_id).
create unique index if not exists uq_messages_workspace_external
  on public.messages(workspace_id, external_message_id)
  where external_message_id is not null;
create index if not exists idx_messages_metadata_gin on public.messages using gin (metadata jsonb_path_ops);

-- calendar_events
create index if not exists idx_calendar_events_workspace_id on public.calendar_events(workspace_id);
create index if not exists idx_calendar_events_workspace_start_at on public.calendar_events(workspace_id, start_at);
create index if not exists idx_calendar_events_workspace_date on public.calendar_events(workspace_id, date);
create index if not exists idx_calendar_events_client on public.calendar_events(workspace_id, client_id) where client_id is not null;
-- Google dedupe key — (workspace, google_calendar_id, google_event_id) must be unique when set.
create unique index if not exists uq_calendar_events_google
  on public.calendar_events(workspace_id, google_calendar_id, google_event_id)
  where google_event_id is not null;

-- documents
create index if not exists idx_documents_workspace_id on public.documents(workspace_id);
create index if not exists idx_documents_workspace_client on public.documents(workspace_id, client_id) where client_id is not null;

-- tasks
create index if not exists idx_tasks_workspace_id on public.tasks(workspace_id);
create index if not exists idx_tasks_workspace_status on public.tasks(workspace_id, status);
create index if not exists idx_tasks_workspace_due_date on public.tasks(workspace_id, due_date) where due_date is not null;

-- invoices
create index if not exists idx_invoices_workspace_id on public.invoices(workspace_id);
create index if not exists idx_invoices_workspace_status on public.invoices(workspace_id, status);
create index if not exists idx_invoices_workspace_due_date on public.invoices(workspace_id, due_date) where due_date is not null;
create index if not exists idx_invoices_client on public.invoices(workspace_id, client_id) where client_id is not null;

-- activities
create index if not exists idx_activities_workspace_id on public.activities(workspace_id);
create index if not exists idx_activities_workspace_created_at on public.activities(workspace_id, created_at desc);

-- notifications
create index if not exists idx_notifications_profile on public.notifications(profile_id, created_at desc);
create index if not exists idx_notifications_profile_unread on public.notifications(profile_id) where read = false;

-- integrations
create index if not exists idx_integrations_workspace_id on public.integrations(workspace_id);

-- whatsapp_connections — phone_number_id lookup is the hot path for inbound resolution.
create index if not exists idx_whatsapp_connections_phone_number_id
  on public.whatsapp_connections(phone_number_id) where phone_number_id is not null;
create index if not exists idx_whatsapp_connections_phone_number
  on public.whatsapp_connections(phone_number) where phone_number is not null;

-- google_calendar_connections — workspace_unique already covers most lookups.

-- workspace_templates
create index if not exists idx_workspace_templates_workspace on public.workspace_templates(workspace_id);
create index if not exists idx_workspace_templates_vertical on public.workspace_templates(workspace_id, vertical);
create index if not exists idx_workspace_templates_type on public.workspace_templates(workspace_id, type);

-- inbox_agent_settings — unique on workspace_id covers it.

-- automation_workflows / n8n_flows
create index if not exists idx_automation_workflows_workspace on public.automation_workflows(workspace_id);
create index if not exists idx_n8n_flows_workspace on public.n8n_flows(workspace_id);

-- logs
create index if not exists idx_n8n_trigger_logs_workspace_created on public.n8n_trigger_logs(workspace_id, created_at desc);
create index if not exists idx_agent_action_logs_workspace_created on public.agent_action_logs(workspace_id, created_at desc);


-- =====================================================================
-- BLOQUE 08 — RLS: enable + policies + grants (expanded, table-by-table)
-- =====================================================================
-- Convention used here, applied table-by-table without shortcuts:
--   1. enable RLS + force RLS (force closes the "table owner sees all" hole)
--   2. drop the policies we are about to create (idempotent re-apply)
--   3. create per-action policies with explicit USING + WITH CHECK
--   4. grant the matching DML to authenticated; revoke from anon
--
-- Membership rule:
--   A user is a member of workspace W if there is a profile row with
--   profiles.id = auth.uid() and profiles.workspace_id = W. The helper
--   public.current_workspace_id() returns that W (NULL for non-members).
--
-- nowlabs_admin has cross-workspace SELECT/INSERT/UPDATE for support
-- purposes via public.is_nowlabs_admin(). It still cannot DELETE business
-- rows except where explicitly granted, and never sees workspaces that
-- are not in profiles at all (i.e. the helper only knows about workspaces
-- that someone has been provisioned into).
-- ---------------------------------------------------------------------

-- ------------ workspaces ---------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;

drop policy if exists workspaces_select on public.workspaces;
drop policy if exists workspaces_update on public.workspaces;
drop policy if exists workspaces_insert on public.workspaces;
drop policy if exists workspaces_delete on public.workspaces;

-- SELECT: workspace members OR nowlabs_admin.
create policy workspaces_select on public.workspaces
for select to authenticated
using (
  id = public.current_workspace_id() or public.is_nowlabs_admin()
);

-- UPDATE: client_admin of THIS workspace OR nowlabs_admin.
create policy workspaces_update on public.workspaces
for update to authenticated
using (
  (id = public.current_workspace_id() and public.is_workspace_admin())
  or public.is_nowlabs_admin()
)
with check (
  (id = public.current_workspace_id() and public.is_workspace_admin())
  or public.is_nowlabs_admin()
);

-- INSERT / DELETE: only nowlabs_admin. Customers must not create new
-- workspaces from the client; that happens via NowLabs onboarding.
create policy workspaces_insert on public.workspaces
for insert to authenticated
with check (public.is_nowlabs_admin());

create policy workspaces_delete on public.workspaces
for delete to authenticated
using (public.is_nowlabs_admin());

grant select, insert, update, delete on public.workspaces to authenticated;

-- ------------ profiles -----------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_workspace_admin on public.profiles;
drop policy if exists profiles_select_nowlabs_admin on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_update_admins on public.profiles;
drop policy if exists profiles_insert_admins on public.profiles;
drop policy if exists profiles_delete_admins on public.profiles;

-- SELECT: a user can read their own profile.
create policy profiles_select_self on public.profiles
for select to authenticated
using (id = auth.uid());

-- SELECT: client_admin can list profiles of their own workspace.
create policy profiles_select_workspace_admin on public.profiles
for select to authenticated
using (
  public.is_workspace_admin()
  and workspace_id = public.current_workspace_id()
);

-- SELECT: nowlabs_admin sees every profile.
create policy profiles_select_nowlabs_admin on public.profiles
for select to authenticated
using (public.is_nowlabs_admin());

-- UPDATE: a user can update their OWN profile row. Column-level grants
-- below restrict which columns the UPDATE can actually touch — the policy
-- only decides which ROW is in scope.
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- UPDATE: admins of the same workspace can update profile rows in their
-- workspace. nowlabs_admin can update any profile. Column-level grants
-- below still apply, so even admins acting through the user session
-- cannot change role / workspace_id from the client — those mutations
-- must go through a server route using SUPABASE_SERVICE_ROLE_KEY, which
-- bypasses both RLS and column grants.
create policy profiles_update_admins on public.profiles
for update to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
)
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

-- INSERT: kept as a defense-in-depth policy, but in v1 it is effectively
-- dead code from the client side — we revoke the INSERT grant on the
-- base table below, so even a client_admin cannot create profile rows
-- through the cookie session. Profile provisioning MUST go through a
-- server route using SUPABASE_SERVICE_ROLE_KEY (invite / onboarding
-- flows). The policy stays so that if a future migration restores the
-- INSERT grant, the role check still applies.
--
-- Why we are this strict: with both the grant and the policy in place,
-- a client_admin could craft an INSERT with role = 'nowlabs_admin' for
-- an existing auth.users.id and escalate themselves. By removing the
-- grant entirely we block that path.
create policy profiles_insert_admins on public.profiles
for insert to authenticated
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

-- DELETE: only nowlabs_admin. Removing a profile also revokes workspace
-- access via the auth.users cascade.
create policy profiles_delete_admins on public.profiles
for delete to authenticated
using (public.is_nowlabs_admin());

-- Base DML grants on profiles.
-- NOTE the deliberate absence of INSERT and UPDATE here:
--   - INSERT is granted to NOBODY in the authenticated role. Profile
--     creation goes exclusively through server routes that use
--     SUPABASE_SERVICE_ROLE_KEY. This closes the privilege-escalation
--     hole where a client_admin could otherwise insert a profile row
--     with role='nowlabs_admin' for an existing auth.users.id.
--   - UPDATE is granted column-by-column on the safe list below, so a
--     user (or even an admin acting through the cookie session) cannot
--     modify the sensitive columns from the client.
grant select, delete on public.profiles to authenticated;

-- Hard-revoke INSERT on profiles from authenticated. The previous line
-- intentionally omits it; this revoke makes the intent explicit and
-- survives a future, accidental "grant all on public.profiles to
-- authenticated" without silently giving the privilege back.
revoke insert on public.profiles from authenticated;

-- Column-level UPDATE grants: only the columns a user is allowed to edit
-- about themselves. Privilege escalation paths (role, workspace_id,
-- trial_status) are deliberately omitted; admin changes to those go
-- through service_role server-side.
--
-- id, created_at: never updatable from the client.
-- updated_at: writable so the set_updated_at() trigger can stamp it on
--   UPDATEs and so application code can do its optimistic-concurrency
--   refresh without a separate touch query.
revoke update on public.profiles from authenticated;
grant update (email, full_name, metadata, updated_at) on public.profiles to authenticated;

-- ------------ workspace_settings -------------------------------------
alter table public.workspace_settings enable row level security;
alter table public.workspace_settings force row level security;

drop policy if exists workspace_settings_select on public.workspace_settings;
drop policy if exists workspace_settings_insert on public.workspace_settings;
drop policy if exists workspace_settings_update on public.workspace_settings;
drop policy if exists workspace_settings_delete on public.workspace_settings;

create policy workspace_settings_select on public.workspace_settings
for select to authenticated
using (
  workspace_id = public.current_workspace_id() or public.is_nowlabs_admin()
);

-- INSERT: any member can create the settings row for their workspace
-- (the upsert path in the app does that on first load).
create policy workspace_settings_insert on public.workspace_settings
for insert to authenticated
with check (
  workspace_id = public.current_workspace_id() or public.is_nowlabs_admin()
);

create policy workspace_settings_update on public.workspace_settings
for update to authenticated
using (
  workspace_id = public.current_workspace_id() or public.is_nowlabs_admin()
)
with check (
  workspace_id = public.current_workspace_id() or public.is_nowlabs_admin()
);

create policy workspace_settings_delete on public.workspace_settings
for delete to authenticated
using (public.is_nowlabs_admin());

grant select, insert, update, delete on public.workspace_settings to authenticated;

-- ------------ clients -------------------------------------------------
alter table public.clients enable row level security;
alter table public.clients force row level security;

drop policy if exists clients_select on public.clients;
drop policy if exists clients_insert on public.clients;
drop policy if exists clients_update on public.clients;
drop policy if exists clients_delete on public.clients;

create policy clients_select on public.clients
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy clients_insert on public.clients
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy clients_update on public.clients
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy clients_delete on public.clients
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.clients to authenticated;

-- ------------ properties ----------------------------------------------
alter table public.properties enable row level security;
alter table public.properties force row level security;

drop policy if exists properties_select on public.properties;
drop policy if exists properties_insert on public.properties;
drop policy if exists properties_update on public.properties;
drop policy if exists properties_delete on public.properties;

create policy properties_select on public.properties
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy properties_insert on public.properties
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy properties_update on public.properties
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy properties_delete on public.properties
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.properties to authenticated;

-- ------------ opportunities -------------------------------------------
alter table public.opportunities enable row level security;
alter table public.opportunities force row level security;

drop policy if exists opportunities_select on public.opportunities;
drop policy if exists opportunities_insert on public.opportunities;
drop policy if exists opportunities_update on public.opportunities;
drop policy if exists opportunities_delete on public.opportunities;

create policy opportunities_select on public.opportunities
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy opportunities_insert on public.opportunities
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy opportunities_update on public.opportunities
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy opportunities_delete on public.opportunities
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.opportunities to authenticated;

-- ------------ service_cases -------------------------------------------
alter table public.service_cases enable row level security;
alter table public.service_cases force row level security;

drop policy if exists service_cases_select on public.service_cases;
drop policy if exists service_cases_insert on public.service_cases;
drop policy if exists service_cases_update on public.service_cases;
drop policy if exists service_cases_delete on public.service_cases;

create policy service_cases_select on public.service_cases
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy service_cases_insert on public.service_cases
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy service_cases_update on public.service_cases
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy service_cases_delete on public.service_cases
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.service_cases to authenticated;

-- ------------ conversations -------------------------------------------
alter table public.conversations enable row level security;
alter table public.conversations force row level security;

drop policy if exists conversations_select on public.conversations;
drop policy if exists conversations_insert on public.conversations;
drop policy if exists conversations_update on public.conversations;
drop policy if exists conversations_delete on public.conversations;

create policy conversations_select on public.conversations
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy conversations_insert on public.conversations
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy conversations_update on public.conversations
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

-- DELETE: admin-only. The "delete conversation permanently" UI in the
-- app today calls .delete() with a user cookie — non-admin users will
-- now hit the explicit RLS-blocked error message that
-- deleteConversationPermanently() already throws. Soft-delete via
-- status='archived' / 'deleted' remains available to every member through
-- the UPDATE policy above. See TODO_CODE_FOLLOWUP at the bottom of file.
create policy conversations_delete on public.conversations
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.conversations to authenticated;

-- ------------ messages ------------------------------------------------
alter table public.messages enable row level security;
alter table public.messages force row level security;

drop policy if exists messages_select on public.messages;
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_update on public.messages;
drop policy if exists messages_delete on public.messages;

create policy messages_select on public.messages
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy messages_insert on public.messages
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

-- Messages are usually immutable, but we allow UPDATE for delivery-status
-- patches and metadata enrichment.
create policy messages_update on public.messages
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

-- DELETE: admin-only. Same reasoning as conversations_delete — hard
-- deletes of inbox messages are destructive and audit-visible. The
-- service_role path used by webhook ingestion is unaffected.
create policy messages_delete on public.messages
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.messages to authenticated;

-- ------------ calendar_events ----------------------------------------
alter table public.calendar_events enable row level security;
alter table public.calendar_events force row level security;

drop policy if exists calendar_events_select on public.calendar_events;
drop policy if exists calendar_events_insert on public.calendar_events;
drop policy if exists calendar_events_update on public.calendar_events;
drop policy if exists calendar_events_delete on public.calendar_events;

create policy calendar_events_select on public.calendar_events
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy calendar_events_insert on public.calendar_events
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy calendar_events_update on public.calendar_events
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

-- DELETE: admin-only. The cancelCalendarEvent() helper in the app already
-- prefers an UPDATE to status='cancelled'; hard delete falls back only
-- when status doesn't exist. With this policy, non-admin users will
-- silently keep using the soft-cancel path (which is fine). Hard delete
-- requires client_admin or nowlabs_admin.
create policy calendar_events_delete on public.calendar_events
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.calendar_events to authenticated;

-- ------------ documents ----------------------------------------------
alter table public.documents enable row level security;
alter table public.documents force row level security;

drop policy if exists documents_select on public.documents;
drop policy if exists documents_insert on public.documents;
drop policy if exists documents_update on public.documents;
drop policy if exists documents_delete on public.documents;

create policy documents_select on public.documents
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy documents_insert on public.documents
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy documents_update on public.documents
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy documents_delete on public.documents
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.documents to authenticated;

-- ------------ tasks ---------------------------------------------------
alter table public.tasks enable row level security;
alter table public.tasks force row level security;

drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;

create policy tasks_select on public.tasks
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy tasks_insert on public.tasks
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy tasks_update on public.tasks
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

-- DELETE: admin-only. Soft-delete via status='cancelled' is still open
-- to every workspace member through the UPDATE policy.
create policy tasks_delete on public.tasks
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.tasks to authenticated;

-- ------------ invoices ------------------------------------------------
alter table public.invoices enable row level security;
alter table public.invoices force row level security;

drop policy if exists invoices_select on public.invoices;
drop policy if exists invoices_insert on public.invoices;
drop policy if exists invoices_update on public.invoices;
drop policy if exists invoices_delete on public.invoices;

create policy invoices_select on public.invoices
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy invoices_insert on public.invoices
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy invoices_update on public.invoices
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

-- Invoices are financial records. Hard-deletes only by client_admin or
-- nowlabs_admin. Soft-deletes (status='cancelled') are still available
-- to all members.
create policy invoices_delete on public.invoices
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.invoices to authenticated;

-- ------------ activities ---------------------------------------------
alter table public.activities enable row level security;
alter table public.activities force row level security;

drop policy if exists activities_select on public.activities;
drop policy if exists activities_insert on public.activities;
drop policy if exists activities_update on public.activities;
drop policy if exists activities_delete on public.activities;

create policy activities_select on public.activities
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy activities_insert on public.activities
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

-- Activities are an audit timeline. We do not expose UPDATE/DELETE to
-- regular members; if you really need to amend an entry, do it via the
-- service_role.
create policy activities_update on public.activities
for update to authenticated
using (public.is_nowlabs_admin())
with check (public.is_nowlabs_admin());

create policy activities_delete on public.activities
for delete to authenticated
using (public.is_nowlabs_admin());

grant select, insert on public.activities to authenticated;

-- ------------ notifications ------------------------------------------
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_insert on public.notifications;
drop policy if exists notifications_update on public.notifications;
drop policy if exists notifications_delete on public.notifications;

-- A user only ever sees their own notifications, nowlabs_admin sees all.
create policy notifications_select on public.notifications
for select to authenticated
using (profile_id = auth.uid() or public.is_nowlabs_admin());

-- INSERT: a user can create their own notifications (server routes
-- usually do this with service_role; we still allow user-side inserts
-- for self-marked reminders).
create policy notifications_insert on public.notifications
for insert to authenticated
with check (profile_id = auth.uid() or public.is_nowlabs_admin());

create policy notifications_update on public.notifications
for update to authenticated
using (profile_id = auth.uid() or public.is_nowlabs_admin())
with check (profile_id = auth.uid() or public.is_nowlabs_admin());

create policy notifications_delete on public.notifications
for delete to authenticated
using (profile_id = auth.uid() or public.is_nowlabs_admin());

grant select, insert, update, delete on public.notifications to authenticated;

-- ------------ integrations -------------------------------------------
alter table public.integrations enable row level security;
alter table public.integrations force row level security;

drop policy if exists integrations_select on public.integrations;
drop policy if exists integrations_insert on public.integrations;
drop policy if exists integrations_update on public.integrations;
drop policy if exists integrations_delete on public.integrations;

create policy integrations_select on public.integrations
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy integrations_insert on public.integrations
for insert to authenticated
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy integrations_update on public.integrations
for update to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
)
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy integrations_delete on public.integrations
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

-- Grants on integrations.
-- The `config` jsonb may, in the future, contain provider-side secrets
-- (webhook tokens, API keys). To avoid leaking them on a column-level
-- read, we do NOT grant SELECT on the base table to authenticated.
-- Workspace members read provider status via vw_integrations_status
-- (Block 09), which projects only the public-facing columns.
--
-- INSERT/UPDATE/DELETE remain grantable so admins can manage provider
-- entries through the user session (RLS still enforces admin gate), but
-- writes that touch sensitive config should be routed through service_role
-- server-side. See TODO_CODE_FOLLOWUP at the bottom of file.
grant insert, update, delete on public.integrations to authenticated;

-- ------------ whatsapp_connections -----------------------------------
-- Members of the workspace can SELECT (no secrets stored here besides
-- public ids and webhook url), but INSERT/UPDATE/DELETE are admin-only.
-- ---------------------------------------------------------------------
alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_connections force row level security;

drop policy if exists whatsapp_connections_select on public.whatsapp_connections;
drop policy if exists whatsapp_connections_insert on public.whatsapp_connections;
drop policy if exists whatsapp_connections_update on public.whatsapp_connections;
drop policy if exists whatsapp_connections_delete on public.whatsapp_connections;

create policy whatsapp_connections_select on public.whatsapp_connections
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy whatsapp_connections_insert on public.whatsapp_connections
for insert to authenticated
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy whatsapp_connections_update on public.whatsapp_connections
for update to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
)
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy whatsapp_connections_delete on public.whatsapp_connections
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.whatsapp_connections to authenticated;

-- ------------ google_calendar_connections ----------------------------
-- The token-bearing table. Workspace MEMBERS can NOT read it directly —
-- they read vw_google_calendar_status from Block 09. Only admins can see
-- the raw table from the client side. Server routes that legitimately
-- need the refresh_token (callback, import-events, disconnect) use
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
--
-- TODO security hardening: column-level encryption (pgsodium), token
-- rotation, audit logging on every read.
-- ---------------------------------------------------------------------
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_connections force row level security;

drop policy if exists google_calendar_connections_select on public.google_calendar_connections;
drop policy if exists google_calendar_connections_insert on public.google_calendar_connections;
drop policy if exists google_calendar_connections_update on public.google_calendar_connections;
drop policy if exists google_calendar_connections_delete on public.google_calendar_connections;

-- SELECT: admin only. Members go through vw_google_calendar_status.
create policy google_calendar_connections_select on public.google_calendar_connections
for select to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy google_calendar_connections_insert on public.google_calendar_connections
for insert to authenticated
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy google_calendar_connections_update on public.google_calendar_connections
for update to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
)
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy google_calendar_connections_delete on public.google_calendar_connections
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

-- Grants on google_calendar_connections.
-- We deliberately do NOT grant SELECT to authenticated, because the table
-- holds refresh_token_enc and (potentially) webhook channel/resource ids
-- that should not leak through a column-level read even if RLS already
-- restricts the row set to admins. All client-side reads MUST go through
-- vw_google_calendar_status (Block 09), which projects has_refresh_token
-- boolean instead of the token itself and omits webhook_channel_id /
-- webhook_resource_id.
--
-- INSERT/UPDATE/DELETE grants stay so admins can manage the row from a
-- server route with the user session if needed; RLS still gates those.
-- However, any route that genuinely needs to USE the refresh token
-- (callback, import-events, disconnect, sync) MUST use service_role —
-- see TODO_CODE_FOLLOWUP at the bottom of file.
grant insert, update, delete on public.google_calendar_connections to authenticated;

-- ------------ workspace_templates ------------------------------------
alter table public.workspace_templates enable row level security;
alter table public.workspace_templates force row level security;

drop policy if exists workspace_templates_select on public.workspace_templates;
drop policy if exists workspace_templates_insert on public.workspace_templates;
drop policy if exists workspace_templates_update on public.workspace_templates;
drop policy if exists workspace_templates_delete on public.workspace_templates;

create policy workspace_templates_select on public.workspace_templates
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy workspace_templates_insert on public.workspace_templates
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy workspace_templates_update on public.workspace_templates
for update to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin())
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy workspace_templates_delete on public.workspace_templates
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.workspace_templates to authenticated;

-- ------------ inbox_agent_settings -----------------------------------
alter table public.inbox_agent_settings enable row level security;
alter table public.inbox_agent_settings force row level security;

drop policy if exists inbox_agent_settings_select on public.inbox_agent_settings;
drop policy if exists inbox_agent_settings_insert on public.inbox_agent_settings;
drop policy if exists inbox_agent_settings_update on public.inbox_agent_settings;
drop policy if exists inbox_agent_settings_delete on public.inbox_agent_settings;

create policy inbox_agent_settings_select on public.inbox_agent_settings
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy inbox_agent_settings_insert on public.inbox_agent_settings
for insert to authenticated
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy inbox_agent_settings_update on public.inbox_agent_settings
for update to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
)
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy inbox_agent_settings_delete on public.inbox_agent_settings
for delete to authenticated
using (public.is_nowlabs_admin());

grant select, insert, update, delete on public.inbox_agent_settings to authenticated;

-- ------------ automation_workflows -----------------------------------
alter table public.automation_workflows enable row level security;
alter table public.automation_workflows force row level security;

drop policy if exists automation_workflows_select on public.automation_workflows;
drop policy if exists automation_workflows_insert on public.automation_workflows;
drop policy if exists automation_workflows_update on public.automation_workflows;
drop policy if exists automation_workflows_delete on public.automation_workflows;

create policy automation_workflows_select on public.automation_workflows
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy automation_workflows_insert on public.automation_workflows
for insert to authenticated
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy automation_workflows_update on public.automation_workflows
for update to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
)
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy automation_workflows_delete on public.automation_workflows
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.automation_workflows to authenticated;

-- ------------ n8n_flows ----------------------------------------------
alter table public.n8n_flows enable row level security;
alter table public.n8n_flows force row level security;

drop policy if exists n8n_flows_select on public.n8n_flows;
drop policy if exists n8n_flows_insert on public.n8n_flows;
drop policy if exists n8n_flows_update on public.n8n_flows;
drop policy if exists n8n_flows_delete on public.n8n_flows;

create policy n8n_flows_select on public.n8n_flows
for select to authenticated
using (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy n8n_flows_insert on public.n8n_flows
for insert to authenticated
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy n8n_flows_update on public.n8n_flows
for update to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
)
with check (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy n8n_flows_delete on public.n8n_flows
for delete to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

grant select, insert, update, delete on public.n8n_flows to authenticated;

-- ------------ n8n_trigger_logs ---------------------------------------
-- Append-only audit log. Members SHOULD NOT browse it; admins can.
-- INSERT is open to all members because the app writes here from many
-- workspace-scoped paths.
-- ---------------------------------------------------------------------
alter table public.n8n_trigger_logs enable row level security;
alter table public.n8n_trigger_logs force row level security;

drop policy if exists n8n_trigger_logs_select on public.n8n_trigger_logs;
drop policy if exists n8n_trigger_logs_insert on public.n8n_trigger_logs;
drop policy if exists n8n_trigger_logs_update on public.n8n_trigger_logs;
drop policy if exists n8n_trigger_logs_delete on public.n8n_trigger_logs;

create policy n8n_trigger_logs_select on public.n8n_trigger_logs
for select to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy n8n_trigger_logs_insert on public.n8n_trigger_logs
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

-- No UPDATE / no DELETE for members. Only nowlabs_admin can amend a log.
create policy n8n_trigger_logs_update on public.n8n_trigger_logs
for update to authenticated
using (public.is_nowlabs_admin())
with check (public.is_nowlabs_admin());

create policy n8n_trigger_logs_delete on public.n8n_trigger_logs
for delete to authenticated
using (public.is_nowlabs_admin());

grant select, insert on public.n8n_trigger_logs to authenticated;

-- ------------ agent_action_logs --------------------------------------
alter table public.agent_action_logs enable row level security;
alter table public.agent_action_logs force row level security;

drop policy if exists agent_action_logs_select on public.agent_action_logs;
drop policy if exists agent_action_logs_insert on public.agent_action_logs;
drop policy if exists agent_action_logs_update on public.agent_action_logs;
drop policy if exists agent_action_logs_delete on public.agent_action_logs;

create policy agent_action_logs_select on public.agent_action_logs
for select to authenticated
using (
  (public.is_workspace_admin() and workspace_id = public.current_workspace_id())
  or public.is_nowlabs_admin()
);

create policy agent_action_logs_insert on public.agent_action_logs
for insert to authenticated
with check (workspace_id = public.current_workspace_id() or public.is_nowlabs_admin());

create policy agent_action_logs_update on public.agent_action_logs
for update to authenticated
using (public.is_nowlabs_admin())
with check (public.is_nowlabs_admin());

create policy agent_action_logs_delete on public.agent_action_logs
for delete to authenticated
using (public.is_nowlabs_admin());

grant select, insert on public.agent_action_logs to authenticated;


-- =====================================================================
-- BLOQUE 09 — Safe public views for integration statuses
-- =====================================================================
-- These views give the Inbox UI and the IA assistant a read path that is
-- guaranteed not to leak refresh tokens or other secrets. They are
-- SECURITY INVOKER (default) so RLS on the underlying tables still
-- applies — but the underlying RLS for google_calendar_connections is
-- admin-only. We grant SELECT on the views explicitly to authenticated.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- View: vw_google_calendar_status
-- ---------------------------------------------------------------------
-- Public-safe projection of google_calendar_connections. Workspace
-- MEMBERS read this view (they have NO SELECT grant on the base table).
-- The view emits `has_refresh_token boolean` instead of the actual token.
--
-- DELIBERATELY OMITTED columns (must never leak through this view):
--   - refresh_token_enc          (OAuth refresh token — secret)
--   - webhook_channel_id         (Google push-channel id — can be
--                                  replayed by an attacker to hijack a
--                                  channel subscription)
--   - webhook_resource_id        (paired with channel id — same risk)
--   - incremental_sync_tokens    (resume tokens for incremental sync;
--                                  not strictly secret, but a malicious
--                                  caller could use them to enumerate
--                                  recent changes; keep them internal)
--
-- The view runs with security_invoker = false (i.e. as its OWNER,
-- typically postgres) so that the base-table RLS / grants are evaluated
-- as the owner. This is what lets workspace members read it even though
-- they have no direct SELECT on the base table. We re-enforce the
-- workspace gate in the WHERE clause below — the helper functions are
-- SECURITY DEFINER (Block 01) but they always resolve to the CALLER's
-- auth.uid(), so the filter is correct per user.
--
-- Owner expectation: when applying this file you must do so as a role
-- that owns the function chain (postgres in Supabase). The view inherits
-- that owner. Do NOT re-create the view from a less-privileged role.
-- ---------------------------------------------------------------------
create or replace view public.vw_google_calendar_status
with (security_invoker = false) as
select
  c.id,
  c.workspace_id,
  c.status,
  c.calendar_id,
  c.default_calendar_id,
  c.selected_calendar_ids,
  c.calendar_metadata,
  c.sync_enabled,
  c.last_sync_at,
  c.token_expiry,
  (c.refresh_token_enc is not null and length(c.refresh_token_enc) > 0) as has_refresh_token,
  c.webhook_expires_at,
  c.created_at,
  c.updated_at
from public.google_calendar_connections c
where c.workspace_id = public.current_workspace_id()
   or public.is_nowlabs_admin();

comment on view public.vw_google_calendar_status is
  'Safe projection of google_calendar_connections. Excludes refresh_token_enc, webhook_channel_id, webhook_resource_id, incremental_sync_tokens. Filters by current_workspace_id() or is_nowlabs_admin().';

revoke all on public.vw_google_calendar_status from public;
revoke all on public.vw_google_calendar_status from anon;
grant select on public.vw_google_calendar_status to authenticated;

-- ---------------------------------------------------------------------
-- View: vw_whatsapp_status
-- ---------------------------------------------------------------------
-- Public-safe projection of whatsapp_connections. No secret columns are
-- stored in the table today, but we still publish a deliberate, frozen
-- column list so future additions to whatsapp_connections (e.g. an
-- encrypted access token) don't accidentally leak.
-- ---------------------------------------------------------------------
create or replace view public.vw_whatsapp_status
with (security_invoker = true) as
select
  w.id,
  w.workspace_id,
  w.provider,
  w.phone_number,
  w.phone_number_id,
  w.whatsapp_business_account_id,
  w.meta_business_id,
  w.connection_status,
  w.webhook_url,
  w.sync_enabled,
  w.last_webhook_at,
  w.last_test_at,
  w.created_at,
  w.updated_at
from public.whatsapp_connections w
where w.workspace_id = public.current_workspace_id()
   or public.is_nowlabs_admin();

comment on view public.vw_whatsapp_status is
  'Safe projection of whatsapp_connections. Today the base table holds no secrets, but this frozen column list prevents future columns (e.g. encrypted access tokens) from being exposed by accident.';

revoke all on public.vw_whatsapp_status from public;
revoke all on public.vw_whatsapp_status from anon;
grant select on public.vw_whatsapp_status to authenticated;

-- ---------------------------------------------------------------------
-- View: vw_integrations_status
-- ---------------------------------------------------------------------
-- Public-safe projection of public.integrations. The base table has its
-- SELECT grant revoked for authenticated (Block 08), so workspace members
-- can ONLY read provider status through this view. The view deliberately
-- omits the `config` and `metadata` jsonb columns: even though the
-- application code today only writes description/category/info into
-- config, future iterations could store webhook secrets there, and we do
-- not want a one-line policy oversight to turn into a credential leak.
--
-- The view runs as DEFINER (security_invoker = false) so that members
-- with no SELECT on the base table can still read it; the workspace
-- filter is re-enforced in the WHERE clause.
-- ---------------------------------------------------------------------
create or replace view public.vw_integrations_status
with (security_invoker = false) as
select
  i.id,
  i.workspace_id,
  i.provider,
  i.name,
  i.status,
  i.created_at,
  i.updated_at
from public.integrations i
where i.workspace_id = public.current_workspace_id()
   or public.is_nowlabs_admin();

comment on view public.vw_integrations_status is
  'Safe projection of integrations. Excludes config (may contain secrets) and metadata. Filters by current_workspace_id() or is_nowlabs_admin().';

revoke all on public.vw_integrations_status from public;
revoke all on public.vw_integrations_status from anon;
grant select on public.vw_integrations_status to authenticated;


-- =====================================================================
-- BLOQUE 10 — Seeds mínimos
-- =====================================================================
-- Only the rows the user explicitly approved:
--   1. workspace "Costa del Sol Real Homes" (slug = costadelsol)
--   2. workspace_settings for that workspace (vertical = mixed)
--   3. n8n_flows in pending_config for the four flows agreed:
--        - Nuevo lead inmobiliaria
--        - Cita confirmada
--        - Factura vencida
--        - Re-engagement leads fríos
--
-- NO demo clients, NO demo invoices, NO OAuth tokens, NO Patricia/Fran
-- profiles, NO storage buckets, NO automation_workflows seeds.
-- ---------------------------------------------------------------------

-- Workspace ----------------------------------------------------------
insert into public.workspaces (slug, name, business_name, plan, status, metadata)
values (
  'costadelsol',
  'Costa del Sol Real Homes',
  'Costa del Sol Real Homes',
  'pro',
  'active',
  jsonb_build_object('client', 'costadelsol', 'origin', 'manual_seed_v1')
)
on conflict (slug) do nothing;

-- Workspace settings -------------------------------------------------
insert into public.workspace_settings (
  workspace_id,
  vertical,
  business_name,
  default_language,
  timezone,
  ai_tone,
  auto_reply_enabled,
  metadata
)
select
  w.id,
  'mixed',
  'Costa del Sol Real Homes',
  'es',
  'Europe/Madrid',
  'professional',
  false,
  jsonb_build_object('seed_version', 'v1')
from public.workspaces w
where w.slug = 'costadelsol'
on conflict (workspace_id) do nothing;

-- n8n_flows ---------------------------------------------------------
-- All four start in pending_config — operators wire the webhook URL
-- later from Settings → n8n. requires_supabase=true on all of them.
insert into public.n8n_flows (
  workspace_id, name, trigger_event, description, status,
  requires_supabase, requires_whatsapp, requires_payment_api
)
select w.id, t.name, t.trigger_event, t.description, 'pending_config',
       t.requires_supabase, t.requires_whatsapp, t.requires_payment_api
from public.workspaces w
cross join (values
  ('Nuevo lead inmobiliaria',
   'new_lead',
   'Notifica al equipo cuando entra un nuevo lead inmobiliario y crea una tarea de seguimiento.',
   true, true, false),
  ('Cita confirmada',
   'appointment_booked',
   'Envia confirmacion al cliente y al agente cuando se confirma una cita.',
   true, true, false),
  ('Factura vencida',
   'invoice_overdue',
   'Recordatorio automatico al cliente y al gestor cuando una factura supera la fecha de vencimiento.',
   true, false, true),
  ('Re-engagement leads frios',
   'reengagement_needed',
   'Reactiva leads sin actividad reciente con un mensaje contextualizado por canal.',
   true, true, false)
) as t(name, trigger_event, description, requires_supabase, requires_whatsapp, requires_payment_api)
where w.slug = 'costadelsol'
on conflict (workspace_id, trigger_event) do nothing;


-- =====================================================================
-- BLOQUE 11 — Verification queries
-- =====================================================================
-- Run these read-only queries AFTER applying blocks 01–10 to confirm
-- the database is in the expected shape. None of them mutate state.
--
-- Expected outcomes are written next to each query as comments.
-- ---------------------------------------------------------------------

-- 1) Confirm every business table exists in the public schema (count = 24).
--    Replace the constant if you add/remove tables.
-- select count(*) as table_count
-- from information_schema.tables
-- where table_schema = 'public'
--   and table_type = 'BASE TABLE'
--   and table_name in (
--     'workspaces','profiles','workspace_settings','clients','properties',
--     'opportunities','service_cases','documents','calendar_events',
--     'conversations','messages','tasks','invoices','activities',
--     'notifications','integrations','whatsapp_connections',
--     'google_calendar_connections','workspace_templates',
--     'inbox_agent_settings','automation_workflows','n8n_flows',
--     'n8n_trigger_logs','agent_action_logs'
--   );

-- 2) Confirm RLS is enabled on every business table (expect: each row true).
-- select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relkind = 'r'
--   and c.relname in (
--     'workspaces','profiles','workspace_settings','clients','properties',
--     'opportunities','service_cases','documents','calendar_events',
--     'conversations','messages','tasks','invoices','activities',
--     'notifications','integrations','whatsapp_connections',
--     'google_calendar_connections','workspace_templates',
--     'inbox_agent_settings','automation_workflows','n8n_flows',
--     'n8n_trigger_logs','agent_action_logs'
--   )
-- order by c.relname;

-- 3) Count policies per table (expect: at least 4 per business table —
--    select/insert/update/delete; profiles will have more).
-- select schemaname, tablename, count(*) as policy_count
-- from pg_policies
-- where schemaname = 'public'
-- group by schemaname, tablename
-- order by tablename;

-- 4) Confirm anon has no DML grants on business tables (expect: empty).
-- select grantee, table_schema, table_name, privilege_type
-- from information_schema.role_table_grants
-- where grantee = 'anon'
--   and table_schema = 'public'
--   and table_name not like 'vw\_%' escape '\';

-- 5) Confirm rls_auto_enable is no longer executable by anon/authenticated
--    (expect: empty result if the function exists, or NULL if it doesn't).
-- select grantee, privilege_type
-- from information_schema.role_routine_grants
-- where routine_schema = 'public'
--   and routine_name = 'rls_auto_enable'
--   and grantee in ('anon','authenticated','public');

-- 6) Confirm the Costa del Sol seed landed (expect: 1 row).
-- select id, slug, name, plan, status, created_at from public.workspaces where slug = 'costadelsol';

-- 7) Confirm workspace_settings row for Costa del Sol (expect: 1 row, vertical='mixed').
-- select ws.workspace_id, ws.vertical, ws.business_name, ws.default_language, ws.timezone, ws.ai_tone
-- from public.workspace_settings ws
-- join public.workspaces w on w.id = ws.workspace_id
-- where w.slug = 'costadelsol';

-- 8) Confirm the 4 n8n_flows for Costa del Sol (expect: 4 rows, all status='pending_config').
-- select f.trigger_event, f.name, f.status, f.requires_supabase, f.requires_whatsapp, f.requires_payment_api
-- from public.n8n_flows f
-- join public.workspaces w on w.id = f.workspace_id
-- where w.slug = 'costadelsol'
-- order by f.trigger_event;

-- 9) Confirm the safe views exist (expect: 3 rows).
-- select table_schema, table_name
-- from information_schema.views
-- where table_schema = 'public'
--   and table_name in ('vw_google_calendar_status','vw_whatsapp_status','vw_integrations_status');

-- 10) Confirm there are no profiles / no auth users yet (expect: 0 / 0).
-- select count(*) as profile_count from public.profiles;
-- select count(*) as auth_user_count from auth.users;

-- 11) Quick sanity index check on the hot paths.
-- select schemaname, tablename, indexname
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename in ('clients','messages','calendar_events','conversations','whatsapp_connections')
-- order by tablename, indexname;

-- 12) Confirm the four RLS helpers are SECURITY DEFINER with a pinned
--     search_path (expect: 4 rows, prosecdef = true, proconfig containing
--     'search_path=pg_catalog, public').
-- select n.nspname, p.proname, p.prosecdef, p.proconfig
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('current_workspace_id','current_user_role','is_nowlabs_admin','is_workspace_admin')
-- order by p.proname;

-- 13) Confirm anon has zero EXECUTE on any of the helpers and on
--     rls_auto_enable (expect: empty).
-- select r.routine_schema, r.routine_name, r.grantee, r.privilege_type
-- from information_schema.role_routine_grants r
-- where r.routine_schema = 'public'
--   and r.routine_name in (
--     'current_workspace_id','current_user_role','is_nowlabs_admin',
--     'is_workspace_admin','rls_auto_enable'
--   )
--   and r.grantee in ('anon','public');

-- 14) Confirm authenticated has NO direct SELECT on the tables with
--     secrets / sensitive jsonb (expect: empty result).
-- select grantee, table_schema, table_name, privilege_type
-- from information_schema.role_table_grants
-- where grantee = 'authenticated'
--   and table_schema = 'public'
--   and table_name in ('google_calendar_connections','integrations')
--   and privilege_type = 'SELECT';

-- 15) Confirm UPDATE on profiles is column-scoped (expect: only
--     email, full_name, metadata, updated_at — never id, role,
--     workspace_id, created_at, trial_status).
-- select column_name, privilege_type
-- from information_schema.column_privileges
-- where table_schema = 'public'
--   and table_name = 'profiles'
--   and grantee = 'authenticated'
--   and privilege_type = 'UPDATE'
-- order by column_name;

-- 16) Confirm the safe views do NOT expose any token / secret / key /
--     credential column name (expect: empty).
-- select table_schema, table_name, column_name
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in ('vw_google_calendar_status','vw_whatsapp_status','vw_integrations_status')
--   and (
--     column_name ilike '%token%'
--     or column_name ilike '%secret%'
--     or column_name ilike '%key%'
--     or column_name ilike '%credential%'
--     or column_name = 'config'
--   )
--   -- has_refresh_token is the explicit, intended exception (boolean only).
--   and column_name <> 'has_refresh_token';

-- 17) Confirm every DELETE policy on business tables either gates by
--     is_workspace_admin / is_nowlabs_admin, or belongs to the explicit
--     exception list. Expect: empty result.
-- with allowed as (
--   select unnest(array[
--     'notifications'         -- own-row delete by profile_id = auth.uid()
--   ]) as table_name
-- )
-- select pol.schemaname, pol.tablename, pol.policyname, pol.qual
-- from pg_policies pol
-- where pol.schemaname = 'public'
--   and pol.cmd = 'DELETE'
--   and pol.tablename not in (select table_name from allowed)
--   and not (
--     pol.qual ilike '%is_workspace_admin%'
--     or pol.qual ilike '%is_nowlabs_admin%'
--   );

-- 18) Confirm RLS + FORCE RLS are on for every business table (expect:
--     each row true / true).
-- select c.relname,
--        c.relrowsecurity      as rls_enabled,
--        c.relforcerowsecurity as force_rls
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relkind = 'r'
--   and c.relname in (
--     'workspaces','profiles','workspace_settings','clients','properties',
--     'opportunities','service_cases','documents','calendar_events',
--     'conversations','messages','tasks','invoices','activities',
--     'notifications','integrations','whatsapp_connections',
--     'google_calendar_connections','workspace_templates',
--     'inbox_agent_settings','automation_workflows','n8n_flows',
--     'n8n_trigger_logs','agent_action_logs'
--   )
-- order by c.relname;

-- 19) Confirm anon has zero DML grants anywhere in the public schema
--     (expect: empty).
-- select grantee, table_schema, table_name, privilege_type
-- from information_schema.role_table_grants
-- where grantee = 'anon'
--   and table_schema = 'public';

-- 20) Confirm authenticated has NO INSERT grant on public.profiles
--     (expect: empty). Profile provisioning is service_role-only in v1.
-- select grantee, table_schema, table_name, privilege_type
-- from information_schema.role_table_grants
-- where grantee = 'authenticated'
--   and table_schema = 'public'
--   and table_name = 'profiles'
--   and privilege_type = 'INSERT';

-- 21) Confirm the four SECURITY DEFINER helpers are owned by a
--     trustworthy role (expect: postgres or supabase_admin — never an
--     ad-hoc / per-user role). The owner's privileges are what the
--     helper inherits via SECURITY DEFINER, so this row matters as
--     much as prosecdef = true.
-- select n.nspname            as schema,
--        p.proname            as function,
--        r.rolname            as owner,
--        p.prosecdef          as is_definer,
--        p.proconfig          as config
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- join pg_authid r    on r.oid = p.proowner
-- where n.nspname = 'public'
--   and p.proname in ('current_workspace_id','current_user_role','is_nowlabs_admin','is_workspace_admin')
-- order by p.proname;

-- =====================================================================
-- TODO_CODE_FOLLOWUP — required application changes before this SQL is
-- applied to production
-- =====================================================================
-- Listed here, in the SQL file itself, so the audit trail stays in one
-- place. None of these are SQL changes — they are code changes that the
-- Next.js app MUST adopt because the hardened RLS / grants in this
-- migration intentionally break the cookie-session paths the current
-- code uses for these flows.
--
-- 1. Google Calendar — status route
--    File: src/app/api/integrations/google/calendar/status/route.ts
--    Current: reads from public.google_calendar_connections with the
--             user cookie session, selects refresh_token_enc to check
--             its presence.
--    Required: switch to SELECT from public.vw_google_calendar_status
--             and read has_refresh_token (boolean) instead of
--             refresh_token_enc. The view already filters by workspace.
--             No service_role needed for this route.
--
-- 2. Google Calendar — token-using routes
--    Files:
--      src/app/api/integrations/google/calendar/callback/route.ts
--      src/app/api/integrations/google/calendar/import-events/route.ts
--      src/app/api/integrations/google/calendar/disconnect/route.ts
--      src/app/api/integrations/google/calendar/sync-event/route.ts
--      src/app/api/integrations/google/calendar/update-event/route.ts
--      src/app/api/integrations/google/calendar/cancel-event/route.ts
--      src/app/api/integrations/google/calendar/save-selected-calendars/route.ts
--    Current: some use service_role when available with an SSR fallback.
--    Required: REMOVE the SSR fallback for any read/write that touches
--             refresh_token_enc, calendar_id, selected_calendar_ids
--             ON THE BASE TABLE. These routes must require
--             SUPABASE_SERVICE_ROLE_KEY to be configured; if missing,
--             return 503 instead of silently degrading to the user
--             session (which will now fail with permission_denied).
--             Always validate the session and workspace match BEFORE
--             using service_role.
--
-- 3. integrations — read path
--    Files:
--      src/lib/supabase-queries.ts getIntegrationSettings()
--      Settings UI surfaces that render integration cards.
--    Current: SELECT * from public.integrations on the browser client.
--    Required: switch to SELECT from public.vw_integrations_status.
--             Provider-side detail (description / category / info /
--             config jsonb) must come from a server route that validates
--             session and then queries the base table with service_role.
--             Never expose integrations.config to the browser.
--
-- 4. integrations — write path
--    Files:
--      src/lib/supabase-queries.ts upsertIntegrationSetting() / updateIntegrationSetting()
--    Current: writes to public.integrations from the browser client.
--    Required: when the write involves anything that could land in the
--             config jsonb beyond plain labels, route it through a
--             server endpoint that uses service_role. RLS still allows
--             plain INSERT/UPDATE via the user session for admins, so a
--             non-secret update (e.g. flipping status) keeps working —
--             but the safe long-term path is server-side.
--
-- 5. profiles — admin updates to role / workspace_id
--    Files: any future invite / role-management UI.
--    Current: not yet implemented.
--    Required: implement these mutations as server routes that use
--             SUPABASE_SERVICE_ROLE_KEY. The user session is blocked at
--             the column-grant level from touching profiles.role,
--             profiles.workspace_id, profiles.trial_status,
--             profiles.created_at, profiles.id.
--
-- 6. conversations / messages / calendar_events / tasks — hard delete
--    Files:
--      src/lib/supabase-queries.ts deleteConversationPermanently() / deleteCalendarEvent() / etc.
--      Any UI that calls these helpers.
--    Current: lets every workspace member hard-delete.
--    Required: gate the hard-delete UI behind is_workspace_admin (the
--             app already has the role on the client via profiles.role).
--             Soft-delete (status = 'archived' / 'cancelled') stays
--             open to every member and is the preferred path. The
--             existing deleteConversationPermanently() error message
--             ("La conversación no fue eliminada. Verifica que los
--             permisos de Supabase (RLS) permitan el borrado…") is
--             already correct for the new behaviour.
--
-- =====================================================================
-- END OF FILE — costadelsol_schema_v1.sql
-- =====================================================================
