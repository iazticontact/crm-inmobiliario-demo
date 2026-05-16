-- NowCRM — Multi-calendar Google Calendar support
-- Idempotent migration. Safe to run multiple times.
-- Review before applying to your Supabase project.
--
-- This script adds the columns + index + grants needed for:
--   1. Selecting multiple Google calendars to sync (selected_calendar_ids)
--   2. Caching calendar metadata (name, color, accessRole) — calendar_metadata
--   3. Per-event Google calendar source (google_calendar_id, sync_source,
--      google_event_id, google_sync_status, last_synced_at)
--   4. Unique dedupe across (workspace, google_calendar, google_event)
--   5. Optional push-notification channel fields (NOT activated automatically —
--      requires public HTTPS URL; see docs/GOOGLE_CALENDAR_REALTIME.md).
--
-- NO destructive operations. NO mass UPDATE. NO DROP / TRUNCATE / DELETE.
-- Existing rows are preserved. Existing constraints are unchanged.

-- ============================================================
-- 1. google_calendar_connections — multi-calendar fields
-- ============================================================

alter table if exists public.google_calendar_connections
  add column if not exists selected_calendar_ids jsonb default '["primary"]'::jsonb,
  add column if not exists calendar_metadata jsonb default '{}'::jsonb,
  -- Skeleton fields for Google push notifications (watch). Leave empty until you
  -- have a public HTTPS endpoint configured and tested.
  add column if not exists webhook_channel_id text,
  add column if not exists webhook_resource_id text,
  add column if not exists webhook_expires_at timestamptz,
  add column if not exists incremental_sync_tokens jsonb default '{}'::jsonb;

-- Backfill: any existing connection without selected_calendar_ids gets ['primary']
update public.google_calendar_connections
   set selected_calendar_ids = '["primary"]'::jsonb
 where selected_calendar_ids is null;


-- ============================================================
-- 2. calendar_events — Google source tracking
-- ============================================================

alter table if exists public.calendar_events
  add column if not exists google_event_id text,
  add column if not exists google_calendar_id text,
  add column if not exists sync_source text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists google_sync_status text,
  -- read-only flag derived from the source calendar's accessRole. We persist it on
  -- the event row so the UI doesn't have to look up the connection to know if the
  -- event can be edited / cancelled from NowCRM. Always falls back to false.
  add column if not exists is_read_only boolean default false;


-- ============================================================
-- 3. Dedupe index: (workspace, google_calendar, google_event)
-- ============================================================
--
-- Google event IDs are not globally unique across calendars (e.g. an event in
-- "primary" can have the same id as one in "work@" only by coincidence, but the
-- only safe assumption is unique-per-calendar). The index from before was
-- (workspace_id, google_event_id) which is fine while you only sync primary, but
-- once you sync multiple calendars you need to include google_calendar_id.

-- Drop the old single-calendar index ONLY if it exists with the old name.
-- We DO NOT drop with cascade; if you have data that depends on it, abort.
do $$
declare
  has_old boolean;
begin
  select exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'calendar_events_workspace_google_event_uidx'
  ) into has_old;

  -- Only drop if there's no row that would clash with the new compound index.
  -- A clash would mean: same (workspace, google_calendar_id, google_event_id) appears twice.
  -- Such duplicates would also have been forbidden by the old index — so this is safe.
  if has_old then
    drop index public.calendar_events_workspace_google_event_uidx;
  end if;
end $$;

create unique index if not exists calendar_events_workspace_calendar_event_uidx
  on public.calendar_events (workspace_id, google_calendar_id, google_event_id)
  where google_event_id is not null;


-- ============================================================
-- 4. Helpful index for upcoming-event queries that filter by status
-- ============================================================

create index if not exists idx_calendar_events_workspace_status_date
  on public.calendar_events (workspace_id, status, date);


-- ============================================================
-- 5. RLS and grants (verify, don't replace if already exist)
-- ============================================================
-- google_calendar_connections RLS / grant — only add what's missing.
-- If your project relies on the service_role for token-bearing writes (callback,
-- import-events, sync-event), make sure service_role has full table access.

grant select, insert, update on public.google_calendar_connections to service_role;
grant select, insert, update, delete on public.calendar_events to service_role;


-- ============================================================
-- 6. Verification queries (run manually after applying)
-- ============================================================
--
--   -- New columns on google_calendar_connections
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='google_calendar_connections'
--       and column_name in (
--         'selected_calendar_ids','calendar_metadata',
--         'webhook_channel_id','webhook_resource_id','webhook_expires_at',
--         'incremental_sync_tokens'
--       );
--
--   -- New columns on calendar_events
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='calendar_events'
--       and column_name in (
--         'google_event_id','google_calendar_id','sync_source',
--         'last_synced_at','google_sync_status','is_read_only'
--       );
--
--   -- New index
--   select indexname from pg_indexes
--     where schemaname='public'
--       and indexname='calendar_events_workspace_calendar_event_uidx';
--
--   -- Verify no duplicate (workspace, google_calendar_id, google_event_id)
--   select workspace_id, google_calendar_id, google_event_id, count(*)
--     from public.calendar_events
--     where google_event_id is not null
--     group by 1,2,3
--     having count(*) > 1;
