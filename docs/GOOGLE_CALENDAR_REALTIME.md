# Google Calendar real-time sync (production phase)

What is **already implemented** vs **left as a skeleton** for near real-time
bidirectional sync between NowCRM and Google Calendar.

## What's live right now

| Direction | Trigger | Mechanism | Latency |
|---|---|---|---|
| NowCRM → Google (create) | User saves event in `/calendar` | `POST /api/integrations/google/calendar/sync-event` (fire-and-forget) | < 2 s |
| NowCRM → Google (update) | User edits event in `/calendar` | `PATCH` via `sync-event` (idempotent) or `update-event` | < 2 s |
| NowCRM → Google (cancel) | User cancels in modal | `DELETE` via `cancel-event` | < 2 s |
| Google → NowCRM (initial sync) | OAuth callback finishes | `runIncrementalSync` called inline in `/callback` | sync — user lands on `/settings` with events already in BD |
| Google → NowCRM (calendar selection) | User saves the calendar selection panel | `save-selected-calendars` runs `runIncrementalSync` in the same request | sync, response carries `imported/updated/cancelled` summary |
| Google → NowCRM (page open) | `/calendar` mounts and connection is stale (> 2 min) | `/import-events` fires in background, BD-first render means events show instantly | < 1 s perceived |
| Google → NowCRM (manual) | User presses **Actualizar ahora** | `/import-events` (forces incremental sync) | < 2 s |
| Google → NowCRM (push) | — | **Skeleton** — see below | — |

## Shared sync engine

`src/app/api/integrations/google/calendar/_sync-engine.ts` exposes `runIncrementalSync(opts)`.
Every Google → NowCRM path goes through it so behavior is consistent.

### Why we don't use PostgREST upsert

`calendar_events` has a **partial** unique index:

```sql
CREATE UNIQUE INDEX uq_calendar_events_google
  ON public.calendar_events (workspace_id, google_calendar_id, google_event_id)
  WHERE google_event_id IS NOT NULL;
```

Postgres rejects `ON CONFLICT (workspace_id, google_calendar_id, google_event_id)` against
a partial unique index that doesn't expose its `WHERE` predicate to the inference clause
— it returns `42P10 there is no unique or exclusion constraint matching the ON CONFLICT
specification`. PostgREST (and supabase-js) don't let us pass the predicate.

So the engine reads `existingMap` up front (one `SELECT` per sync), then for each Google
event:
- if it's in the map → `UPDATE` by `id`
- if not → plain `INSERT`
- if that `INSERT` raises `23505` (race: someone else inserted in between) → `SELECT` the
  row by triplet, `UPDATE` it, count as `updated` (not `imported`)

This keeps the partial index doing dedup work and avoids the 42P10.

### Per-calendar critical-failure gate

If ANY DB write for a calendar fails (insert/update/cancel), the engine:
- marks that calendar's `criticalFailure = true`
- breaks out of the page loop for that calendar
- **does NOT persist its new `nextSyncToken`** — Google will replay the same delta on
  the next sync, so the missed change is not silently dropped

`runIncrementalSync` returns `partialFailure: boolean` and `failedCalendars: string[]`.
Callers MUST surface `partialFailure` in the UI; `last_sync_at` is the timestamp of the
last sync ATTEMPT and is NOT proof of success on its own.

### Other invariants

- Per calendar, uses stored `incremental_sync_tokens[calendarId]` when present; otherwise
  full sync over `[-30d, +90d]` with `singleEvents=true`, `orderBy=startTime`.
- On HTTP `410 GONE`, drops the syncToken and restarts that calendar with a full sync — Google
  has expired the token. Not counted as critical failure (Google is explicitly asking).
- Paginates via `nextPageToken` up to `MAX_PAGES_PER_CALENDAR=8`.
- Soft-cancels Google events that come back with `status='cancelled'`
  (sets `status='cancelled'`, `google_sync_status='deleted_from_google'`).
- Returns `{ imported, updated, cancelled, skipped, skippedAllDay, lastSyncAt, calendars[],
  partialFailure, failedCalendars }`.

## Multi-calendar

- Each user selects which Google calendars to sync from `/calendar` ("Calendarios" panel).
- Selection is persisted in `google_calendar_connections.selected_calendar_ids` (jsonb array),
  scoped strictly by `(workspace_id, user_id)`.
- The engine loops over every selected calendar and partial-fails per calendar — a failed
  calendar appears in `calendars[].error` but does not break the others.

## Read-only calendars

- Google `calendarList.list` returns each calendar's `accessRole`.
- The sync engine flags each imported row as `is_read_only=true` when the source calendar
  is `reader` or `freeBusyReader`.
- The UI hides edit/cancel actions for read-only events and shows a tooltip.

## Why not push-based real-time today?

Google Calendar [push notifications](https://developers.google.com/calendar/api/guides/push)
("watch channels") require:

1. Public HTTPS URL (Google refuses HTTP and IP-based addresses).
2. Domain verification in Google Cloud Console under the same project as the OAuth client.
3. Watch renewal via cron — each watch expires after at most ~7 days.

In local development (`localhost:3000`) none of these are satisfiable, so the webhook route
returns 503 by default. The stand-in is:

- **Initial sync** when the user finishes OAuth.
- **Auto-sync** when they save a calendar selection.
- **Auto-sync on stale open** (`/calendar` triggers `/import-events` in background if
  `last_sync_at > 2 min`).
- **Manual "Actualizar ahora"** for power users.

In practice the visible latency for Google → NowCRM changes is bounded by the page open
time, which is acceptable for the CRM use case.

## Activation steps (production)

1. Deploy NowCRM behind a verified HTTPS domain.
2. Add env vars:
   ```
   GOOGLE_CALENDAR_WEBHOOK_URL=https://app.nowcrm.io/api/integrations/google/calendar/webhook
   GOOGLE_CALENDAR_WEBHOOK_TOKEN=<long-random-string>   # verified via X-Goog-Channel-Token
   ```
3. After each user connects (or daily via cron), for every selected calendar:
   ```http
   POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/watch
   {
     "id": "<uuid>",
     "type": "web_hook",
     "address": "$GOOGLE_CALENDAR_WEBHOOK_URL",
     "token": "$GOOGLE_CALENDAR_WEBHOOK_TOKEN",
     "expiration": "<unix-ms-7-days-from-now>"
   }
   ```
   Persist the returned `id` and `resourceId` in `webhook_channel_id` /
   `webhook_resource_id` on `google_calendar_connections`.
4. The skeleton in `src/app/api/integrations/google/calendar/webhook/route.ts`:
   - Returns 503 outside production / when env vars are missing.
   - Validates `X-Goog-Channel-Token`.
   - **Activation work needed**: look up the connection by `webhook_channel_id`, then call
     `runIncrementalSync(...)` from `_sync-engine.ts`. The engine already does the right
     thing — it reuses the stored syncToken or recovers from 410.
5. Set up a daily cron (Vercel Cron / VPS cron / n8n) that:
   - Queries connections where `webhook_expires_at < now() + interval '24 hours'`.
   - Re-registers the watch and updates `webhook_channel_id` / `webhook_resource_id` /
     `webhook_expires_at`.
6. **Do not enable in development.** Without HTTPS, Google refuses to register the watch
   and you will burn API quota on failed `watch` calls.

## Until push is enabled

The combination of (initial sync + auto-sync after save + auto-sync on stale open +
manual "Actualizar ahora") covers ~95% of practical use cases — the user usually wants
Google → NowCRM when they actively look at the calendar, and that path now syncs without
asking.

For NowCRM → Google there is no latency problem — every create/edit/cancel pushes
immediately server-side.
