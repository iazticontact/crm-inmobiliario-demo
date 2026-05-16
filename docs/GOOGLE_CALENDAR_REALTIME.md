# Google Calendar real-time sync (production phase)

This document explains what is **already implemented** vs **left as a skeleton** for near
real-time bidirectional sync between NowCRM and Google Calendar.

## What's live right now

| Direction | Trigger | Mechanism | Latency |
|---|---|---|---|
| NowCRM → Google (create) | User saves event in `/calendar` or NowLabs AI confirms | `POST /api/integrations/google/calendar/sync-event` (fire-and-forget) | < 2 s |
| NowCRM → Google (update) | User edits event in `/calendar` modal or reschedules via NowLabs AI | `PATCH` via `sync-event` (idempotent) or `update-event` | < 2 s |
| NowCRM → Google (cancel) | User cancels in modal or NowLabs AI cancels | `DELETE` via `cancel-event` | < 2 s |
| Google → NowCRM (import) | User clicks **Sincronizar** in `/calendar` header | `POST /api/integrations/google/calendar/import-events` — loops over selected calendars, soft-cancels events Google reports as `cancelled` | manual |
| Google → NowCRM (auto) | — | **Not implemented yet** (skeleton — see below) | — |

## Multi-calendar

- The user selects which Google calendars to sync from `/calendar` (panel "Calendarios").
- Selection is persisted in `google_calendar_connections.selected_calendar_ids` (jsonb array).
- `import-events` loops over every selected calendar and dedupes per `(workspace, google_calendar_id, google_event_id)`.
- If the schema has not been updated yet, the code falls back to the legacy single-calendar
  mode (`calendar_id` column). See `docs/google-calendar-multi-calendar.sql`.

## Read-only calendars

- Google `calendarList.list` returns each calendar's `accessRole` (`owner` / `writer` / `reader` / `freeBusyReader`).
- `import-events` flags each imported event as `is_read_only = true` when the source calendar
  is `reader` or `freeBusyReader`.
- The UI hides "Editar" / "Cancelar" actions for read-only events and shows a tooltip:
  *"Este evento viene de un calendario solo lectura en Google."*
- NowLabs AI can still see these events for conflict detection but does not attempt to
  edit/cancel them — it tells the user that the source calendar is read-only.

## Why not real-time today?

Google Calendar uses [push notifications](https://developers.google.com/calendar/api/guides/push)
("watch channels"). Requirements:

1. **Public HTTPS URL** — Google refuses HTTP and IP-based addresses.
2. **Domain verification** — the receiving domain must be verified in Google Cloud Console
   under the same project as the OAuth client.
3. **Watch renewal** — each watch expires after at most ~7 days, so a cron is needed.

For local development (`localhost:3000`) none of these are satisfiable, so we ship a
**skeleton** that returns 503 by default. Enabling it on a production deploy involves:

### Activation steps (production)

1. Deploy NowCRM behind a verified HTTPS domain.
2. Add env vars:
   ```
   GOOGLE_CALENDAR_WEBHOOK_URL=https://app.nowcrm.io/api/integrations/google/calendar/webhook
   GOOGLE_CALENDAR_WEBHOOK_TOKEN=<long-random-string>   # we verify it via X-Goog-Channel-Token
   ```
3. Run the SQL in `docs/google-calendar-multi-calendar.sql` (adds `webhook_channel_id`,
   `webhook_resource_id`, `webhook_expires_at`, `incremental_sync_tokens` to
   `google_calendar_connections`).
4. After each workspace connects (or daily via cron), for every selected calendar:
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
   Persist the returned `id` and `resourceId` in `webhook_channel_id` / `webhook_resource_id`.
5. The skeleton handler in `src/app/api/integrations/google/calendar/webhook/route.ts` already:
   - Returns 503 in non-production / when env vars are missing.
   - Validates `X-Goog-Channel-Token`.
   - Logs minimal headers.
   - Has TODO comments where the production handler should:
     - Look up the workspace by `channel_id`.
     - Call `events.list?syncToken=<stored>` to fetch incremental changes.
     - Upsert / soft-cancel local rows.
     - Persist `nextSyncToken` into `incremental_sync_tokens[calendarId]`.
6. Set up a daily cron that renews any watch whose `webhook_expires_at` is within 24 hours.

**Do not enable the webhook in development.** Without HTTPS, Google will not register the
watch and you will burn API quota on failed `watch` calls.

## Until real-time is enabled

The pragmatic stand-in is the **Sincronizar** button. It:

- Reads the latest events from every selected calendar (within a –30 / +90 day window).
- Inserts new events, updates existing ones, soft-cancels events Google reports as cancelled.
- Updates `last_sync_at` on the connection so the UI can show "Sincronizado hace X min".

This covers ~95% of practical use cases (the user usually wants Google → NowCRM only when
they actively go to look at the calendar).

For NowCRM → Google there is no latency problem — every create/edit/cancel pushes
immediately as a server-side fire-and-forget call.
