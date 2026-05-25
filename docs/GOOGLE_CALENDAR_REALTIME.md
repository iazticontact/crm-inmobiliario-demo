# Google Calendar real-time sync (production phase)

What is **already implemented** vs **left as a skeleton** for near real-time
bidirectional sync between NowCRM and Google Calendar.

## What's live right now

| Direction | Trigger | Mechanism | Latency |
|---|---|---|---|
| NowCRM → Google (create) | User saves event in `/calendar` | `POST /api/integrations/google/calendar/sync-event` and local metadata confirmation | < 2 s |
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

The engine keeps token access and connection metadata on the server-side
`service_role` client, but writes `calendar_events` through the current
authenticated Supabase session. That matches the real RLS/grant model: tokens
stay server-only while event rows are still written as the user who owns the
workspace session.

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

If ANY DB write or recoverable Google error for a calendar fails (insert/update/cancel,
403 forbidden, 404 not found, 429 rate-limit, network error, second consecutive 410),
the engine:
- marks that calendar's `criticalFailure = true`
- breaks out of the page loop for that calendar
- **does NOT persist its new `nextSyncToken`** — Google will replay the same delta on
  the next sync, so the missed change is not silently dropped
- writes a `lastSyncError` marker into `google_calendar_connections.calendar_metadata[calendarId]`
  with `{ code, reason, at }` so the UI can show a "Revisar" badge next to that calendar
  without an extra roundtrip
- when a calendar recovers on the next sync, the engine deletes its `lastSyncError`
  marker — the badge clears automatically

`runIncrementalSync` returns:
- `partialFailure: boolean`
- `failedCalendars: { id, summary, errorCode, reason, retryable, failedEventTitle?, dbErrorCode?, dbErrorMessage? }[]`
- `safeWriteFailures[]` with sanitized event/write diagnostics for runtime support

Where `errorCode` is one of `'forbidden' | 'not_found' | 'rate_limited' |
'sync_token_irrecoverable' | 'db_write' | 'network' | 'http_error' | 'unknown'`.
The `reason` field is the Spanish copy ready to render in toasts/banners; `retryable`
tells the UI whether to suggest "Actualizar ahora" vs "Quitar de sincronización".

Callers MUST surface `partialFailure` in the UI; `last_sync_at` is the timestamp of
the last sync ATTEMPT and is NOT proof of success on its own.

### Mirror invariant: only synced AND visible events render

The grid, Agenda and "Próximos eventos" sidebar **only** show events whose
`google_calendar_id` is:

1. Currently in the saved `selected_calendar_ids` (alias-aware), AND
2. NOT in the user's local `hiddenCalendarIds` set (alias-aware).

Pure CRM events (no `google_calendar_id`) bypass gate 1 and always render
unless explicitly cancelled.

**Strict empty-selection rule.** When `selected_calendar_ids` is empty
(disconnected, freshly-connected, or all calendars desynced), **no Google
events render at all** — not even cached rows from a previous selection.
A fallback "if we don't know the selection, show everything" was the source
of the bug where ghosts from a former selection leaked into the grid; the
filter no longer has that escape hatch. The UI surfaces this state with the
violet "Selecciona calendarios de Google" banner + "Elegir calendarios" CTA.

This means:

- A calendar removed from sync stops showing its events **immediately**, even
  though its rows remain in `calendar_events` for audit / cheap recovery if
  the user re-syncs.
- Hiding a calendar via the sidebar widget filters the same calendar
  regardless of whether its events were stored with `google_calendar_id="primary"`
  or with the email-id.
- The legend / chip counts derive from `googleCalendars.filter(...).length`,
  never from `Set.size`, so stale alias entries can't inflate the count.

### `syncedVisibleCalendars` is derived, not snapshotted

The sidebar's "Mis calendarios" widget computes `syncedVisibleCalendars` from
`googleSelectedCalendarIds` (the saved state, alias-aware) — NOT from
`cal.selected` returned by `/list-calendars`. The latter is a snapshot of
what was selected when that route was last called; after "Guardar y
sincronizar" the saved selection updates instantly via `/status` but the
calendar list isn't necessarily reloaded. Deriving from the saved state
keeps the sidebar checkboxes in sync with reality without a manual refresh.

### Duplicate-key recovery (23505 / uq_calendar_events_google)

The engine's `insertOrReconcileEvent` no longer surfaces the partial unique
violation as a critical sync failure when it can be reconciled. Three
hardenings:

1. **Fingerprint detection** — `isDuplicateKeyError` matches on the SQLSTATE
   (`23505`) AND on the message body (`duplicate key`, `uq_calendar_events_google`,
   `23505`). Some Supabase client builds emit the error without `code`
   populated; without the message fallback the engine treated those as
   generic write failures and dropped the calendar.

2. **Alias-aware SELECT** — the fallback lookup uses
   `IN(...alias_variants_of_google_calendar_id)` instead of equality and
   `.limit(5)` (not 2) so it can see more than the inferred winner. A
   conflicting row stored under `"primary"` (legacy) is still found when
   the engine tries to insert under the canonical email-id (or vice versa).

3. **Deterministic merge of duplicate alias rows** — when the lookup returns
   MORE than one row (e.g. legacy row A under `google_calendar_id="primary"`
   AND legacy row B under `google_calendar_id="user@gmail.com"` for the same
   `google_event_id`), the engine no longer picks a winner and walks away.
   The other row would still render — visibleEvents is alias-aware — and we'd
   report `partialFailure=false` while the grid keeps a duplicate. The
   `resolveDuplicateAliasRows` helper instead:
   - Picks the keeper by **raw `google_calendar_id` comparison** —
     canonicalising both sides before the comparison would tie `"primary"`
     and the email-id, and the older code could then pick the `"primary"`
     row, try to migrate it to email, and re-trigger 23505 against the
     active email row. Order:
       1. Row at exactly the canonical id (active OR cancelled).
       2. Row at the real primary id (active OR cancelled).
       3. ACTIVE row at the literal `"primary"` alias.
       4. Any other active row.
       5. Lowest `id` lexicographically — covers the all-cancelled edge case.
     The first two priorities accept a CANCELLED keeper deliberately: that
     row owns the partial unique index slot, so anything else would have to
     migrate INTO an occupied slot and 23505. Reviving the cancelled keeper
     via the UPDATE payload (`status='scheduled'`) is safe because Google is
     the source of truth for whether the event is active.
   - `UPDATE`s the keeper with the fresh payload. **Conditionally** migrates
     `google_calendar_id` to canonical: only when no OTHER candidate (active
     or cancelled) still occupies that slot in the partial unique index.
     When migration would conflict the keeper stays at its existing alias
     and `loadExistingEventIds` still resolves it via canonical-keyed lookup.
   - Soft-cancels every OTHER **active** duplicate (`status='cancelled'`,
     `google_sync_status='duplicate_alias_merged'`). When the column type
     rejects the marker (older schemas) it retries with just `status` —
     mirroring the same fallback `cancel-event/route.ts` uses. Rows that
     were already cancelled in a prior merge are left alone.
   - Rewrites `existingMap` so every alias key for this `google_event_id`
     points at the keeper — never at the soft-cancelled rows.
   - Counts the operation as `updated`.
   - On ANY write failure during the merge → critical failure, syncToken does
     NOT advance, Google replays the same delta next time.

4. **`loadExistingEventIds` filters cancelled and tracks gcal-per-id** — the
   upfront map that powers the "is this event already in the DB?" check is
   now built from rows where `status <> 'cancelled'` only, AND it returns a
   sibling `gcalByLocalId` map so the main loop knows each row's current DB
   `google_calendar_id`. The cancelled filter prevents the map from pointing
   at a soft-cancelled duplicate (the partial unique index keeps cancelled
   rows in their slot — there is no `WHERE status <> 'cancelled'` clause —
   so loading them would mean UPDATEing the wrong id or reviving a merged
   loser). If two ACTIVE rows still share a canonical key (a duplicate that
   never went through the merge yet) we deliberately leave the key OUT of
   the map, forcing the next iteration into the INSERT → 23505 →
   `resolveDuplicateAliasRows` path that reconciles them properly.

5. **`reconcileAliasedRow` guards the normal UPDATE path** — without it, the
   most common variant of the bug bypassed the merge entirely: a single
   active row at `gcal="primary"` and a cancelled sibling at the email-id
   would still leave the map pointing at the active primary row, and the
   plain UPDATE that follows sets `google_calendar_id=email` (the payload's
   canonical target) → 23505 against the cancelled row's slot. The main
   loop now compares `gcalByLocalId.get(existingLocalId)` to the payload's
   gcal; only when they MATCH does it issue the plain UPDATE. When they
   differ — i.e. the UPDATE would migrate the column — it dispatches to
   `reconcileAliasedRow`, which SELECTs every alias candidate (active AND
   cancelled), then:
   - 0 candidates → defensive UPDATE by id WITHOUT migrating gcal.
   - 1 candidate → migration is safe (no other row), plain UPDATE.
   - > 1 candidates → hand off to `resolveDuplicateAliasRows` for the merge.

   This is the path that fixes the "primary active + email cancelled" case:
   the SELECT returns 2 candidates, the keeper-election picks the cancelled
   email row (priority 1, canonical wins), the UPDATE payload revives it
   with `status='scheduled'`, and the active primary row gets soft-cancelled
   — net result is ONE active row at canonical, no 23505, no fake success.

The engine only surfaces a `db_write` partial failure when the SELECT genuinely
finds no matching row (something extra strange — a corrupt index, a unique
constraint we don't know about, a different table). In that case the
syncToken is NOT advanced and the user sees "Revisar calendario" with the
specific event title in the diagnostics.

The same hardening applies to the per-event iteration: `existingMap` is
probed with both the canonical key AND the `"primary"`/email-id alias keys
before the engine even tries to insert, so race-conditions and legacy alias
rows resolve via UPDATE instead of triggering the conflict path at all.

### User-facing reason is sanitised

The `failedCalendars[].reason` field shown in the modal/banner contains only
the friendly Spanish copy from `reasonForCode`. The raw Postgres message
(`duplicate key value violates unique constraint…`, `23505`, etc.) is
stripped at the **wire boundary** — `sanitizeFailedCalendarForWire` and
`sanitizeWriteFailureForWire` in `_sync-engine.ts` drop `dbErrorMessage`
before the response leaves the server. Only the short `dbErrorCode`
(`23505`, `db_write`, `duplicate_alias_merged`, etc.) is sent to the
client. Full Postgres detail stays in the server logs (the engine's
`console.warn` already emits a tokens-free JSON line per failed calendar).

`calendar_metadata[id].lastSyncError` follows the same rule: the engine
writes the short code + friendly reason + event title/start, but never
`dbErrorMessage`. `list-calendars` defensively re-sanitises on read with
`sanitizeLastSyncError` so legacy rows that may still carry the field
don't leak it back to the UI.

### Auto-load calendars: single attempt, no retry loop

Calendars are loaded eagerly **once** per Google-connection cycle via a ref
guard (`initialCalendarLoadAttemptedRef`). If `/list-calendars` returns `[]`
or fails, we do NOT retry automatically — the user can explicitly press
"Calendarios" to retry. The ref resets when the workspace changes or when
the user disconnects/reconnects Google, so a fresh connection always gets
its eager load.

This replaces a previous `googleCalendars.length === 0` dependency that
would re-fire on every render any time Google returned an empty list.

### Surface in the UI

- `/calendar` header shows `Revisar 1 calendario` (clickable → opens calendars panel)
  whenever `partialFailure` is true.
- A persistent amber banner with `[Actualizar ahora]` and `[Ver calendarios]` buttons
  appears at the top of the page.
- The calendar panel shows a **Revisar** badge and a `Quitar` action button on each
  failing calendar so the user can take it out of the sync in one click. The action
  is available **regardless of accessRole** — owner, writer, reader, freeBusyReader,
  or even calendars Google no longer returns at all (see "Ghost calendars" below).

### Ghost calendars

When `selected_calendar_ids` contains a calendar ID that Google's `calendarList.list`
no longer returns (deleted, permission revoked, shared calendar untrusted), the
`list-calendars` route synthesises a "ghost" entry with:

- `unavailable: true`
- `canSync: false`
- `summary` from the cached `calendar_metadata[id].summary` if available, else
  "Calendario no disponible"
- `lastSyncError` from the cached marker or a synthetic `not_found` payload
  with the Spanish reason

The UI renders these in a "No disponibles" section at the top of the modal with
the **Quitar** action enabled — the user MUST be able to remove a calendar they
can no longer access, even if Google itself has lost track of it. This is the
recovery path for the `partialFailure` produced by a forbidden/not_found calendar.

### Single applySyncResult helper

The frontend has ONE place that maps a `sync` payload to UI state
(`failedCalendars`, `partialFailure`, `googleLastSync`). It's called from every
code path that produces a sync result:

- Manual "Actualizar ahora" (`/api/integrations/google/calendar/import-events`)
- "Guardar y sincronizar" in the calendars modal
- "Quitar de sincronización" inline action
- Silent auto-sync on `/calendar` open

This guarantees chip and banner never show a stale `failedCalendars` list from a
previous request when a newer response says "all good now".

### Primary alias handling

Google exposes the user's main calendar under TWO different identifiers — the
literal string `"primary"` (alias accepted by every Google Calendar API
endpoint) AND the real id (typically the user's email, `user@gmail.com`,
returned by `calendarList.list`). Both refer to the same calendar but are
trivially mistaken for two distinct ones, which historically caused:

- `selected_calendar_ids` ending up as `["primary", "user@gmail.com"]`
- the sync engine iterating the same calendar twice
- `calendar_events` rows with `google_calendar_id="primary"` AND rows with
  `google_calendar_id="user@gmail.com"` for the same Google event (the partial
  unique index allows both because different `google_calendar_id` values are
  distinct tuples)
- the sidebar's "Mis calendarios" toggle hiding only one of the two variants

**Single source of truth: [`src/lib/calendar-primary.ts`](../src/lib/calendar-primary.ts).**

It exports:

- `getPrimaryCalendarRealId(calendars)` — locates the real id from a calendar list
- `getPrimaryRealIdFromMetadata(metadata)` — same, but for the engine's
  `Record<id, {primary?: boolean}>` map
- `isPrimaryAlias(id, primaryRealId)` — true for `"primary"` OR the email-id
- `canonicalCalendarId(id, primaryRealId)` — collapses any alias to the canonical
  form (prefers the real email-id when known; falls back to `"primary"`)
- `areSameCalendarId(a, b, primaryRealId)` — alias-aware equality
- `dedupeCalendarIds(ids, primaryRealId)` — order-preserving canonical dedupe

These are used in three layers, each acting as a defence:

1. **Frontend** ([calendar/page.tsx](../src/app/%28saas%29/calendar/page.tsx)):
   - `loadGoogleCalendars` canonicalises the initial set right when the modal
     opens, so a legacy DB selection of `["primary", "user@gmail.com"]`
     immediately shows ONE checkbox marked.
   - `toggleCalendarInSelection` removes every alias variant on deselect and
     adds only the canonical form on select.
   - `toggleCalendarVisibility` does the same for `hiddenCalendarIds` so hiding
     the primary suppresses both `google_calendar_id="primary"` and
     `google_calendar_id="user@gmail.com"` rows.
   - `visibleEvents` filter compares with `areSameCalendarId`.
   - "Mis calendarios" visible-count is **derived** from the canonical-aware
     filter (`syncedVisibleCalendars.filter(isCalendarHidden).length`), never
     from `hiddenCalendarIds.size`, because Set size can grow past the actual
     calendar count when stale alias entries linger.

2. **Backend** ([save-selected-calendars](../src/app/api/integrations/google/calendar/save-selected-calendars/route.ts)):
   final defensive normalisation before persisting. Even if a stale tab or a
   third-party caller sends `["primary", "user@gmail.com"]`, the route
   dedupes to a single canonical entry and strips the legacy `"primary"` key
   from `calendar_metadata` when the real id is known.

3. **Sync engine** ([_sync-engine.ts](../src/app/api/integrations/google/calendar/_sync-engine.ts)):
   `getPrimaryRealIdFromMetadata(metadata)` resolves the real id from Google's
   `calendarList.list` response, `dedupeCalendarIds` runs over
   `selectedCalendarIds` before the iteration starts, and the per-event
   `existingMap` is loaded by querying BOTH alias variants and keying the map
   by canonical id. Legacy rows with `google_calendar_id="primary"` are
   recognised when the canonical is now the email-id; the UPDATE path
   rewrites the column to canonical, so the database migrates itself on the
   next clean sync.

4. **list-calendars** never returns a ghost for `"primary"` when Google
   already returned a calendar with `primary: true` (would duplicate the
   "Principal" row).

Net effect on **new writes**: the alias never duplicates anywhere
downstream. Net effect on **legacy data** (rows stored before this
hardening with `google_calendar_id="primary"` AND a parallel row with the
email-id for the same `google_event_id`): the next sync that touches the
event triggers `resolveDuplicateAliasRows`, which merges the pair into
one canonical keeper row and soft-cancels the rest — so the database
self-heals on the next clean sync, no manual migration needed.

### Rollback on remove failure

`removeCalendarFromSync` captures `previousSelection` before the optimistic
update. If the request or network fails, the local selection is restored so the
modal never lies about state. On success, it re-fetches `list-calendars` to
re-render any new ghost entries that may have appeared.

### Other invariants

- Per calendar, uses stored `incremental_sync_tokens[calendarId]` when present; otherwise
  full sync over `[-30d, +90d]` with `singleEvents=true`, `orderBy=startTime`.
- On HTTP `410 GONE`, drops the syncToken and restarts that calendar with a full sync — Google
  has expired the token. Not counted as critical failure (Google is explicitly asking).
- Paginates via `nextPageToken` up to `MAX_PAGES_PER_CALENDAR=8`.
- Soft-cancels Google events that come back with `status='cancelled'`
  (sets `status='cancelled'`, `google_sync_status='deleted_from_google'`).
- Returns `{ imported, updated, cancelled, skipped, skippedAllDay, lastSyncAt, calendars[],
  partialFailure, failedCalendars, safeWriteFailures }`.

## NowCRM to Google integrity

Create/edit/cancel from `/calendar` is not fire-and-forget:

- New CRM events are inserted locally, then pushed to Google, then the same local row is
  confirmed with `google_event_id`, `google_calendar_id`, `sync_source='crm'`, and
  `google_sync_status='synced'`.
- If Google create succeeds but the local confirmation fails, `sync-event` attempts to
  delete the just-created Google event and returns `local_update_failed`; the UI does
  not show success.
- Existing Google-linked events are patched in Google before the UI shows success. If
  the Google sync fails, the UI rolls back the local edit when it still has the previous
  row in memory.
- Google-linked cancellations do not fall back to local-only cancellation when Google is
  disconnected or server credentials are missing. The event remains active so CRM and
  Google do not drift silently.
- Local CRM-only events can still be created/edited/cancelled without Google when the
  user is disconnected.

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
