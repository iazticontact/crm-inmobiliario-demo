// Shared Google Calendar sync engine.
//
// Used by:
//   - /api/integrations/google/calendar/import-events  (manual + UI-triggered)
//   - /api/integrations/google/calendar/save-selected-calendars (auto after save)
//   - /api/integrations/google/calendar/callback (initial sync after OAuth)
//   - /api/integrations/google/calendar/webhook (when push notifications arrive in prod)
//
// Contract:
//   - Strictly user-level: takes (workspaceId, userId, refresh_token, selected_calendar_ids,
//     existing incremental_sync_tokens). Tokens never leave this module.
//   - Per calendar: tries incremental sync with stored syncToken; on 410 GONE falls
//     back to a full sync over [-30d, +90d] (singleEvents=true, orderBy=startTime).
//   - Paginates with nextPageToken.
//   - **No PostgREST upsert.** `calendar_events` has only a partial unique index
//     `uq_calendar_events_google ... WHERE google_event_id IS NOT NULL`, so
//     `INSERT ... ON CONFLICT (workspace_id, google_calendar_id, google_event_id)`
//     fails with 42P10 (no unique or exclusion constraint matching). Instead we
//     read `existingMap` up front, INSERT new rows directly, and on the race-case
//     23505 we fall back to SELECT + UPDATE for that row.
//   - Soft-cancels rows for Google events that come back with status='cancelled'.
//   - **Per-calendar critical-failure gate:** if ANY DB write (insert/update/cancel)
//     fails for a calendar, that calendar's `nextSyncToken` is NOT persisted. This
//     way Google will replay those changes on the next sync — we never lose events
//     by advancing the cursor past a write we couldn't commit.
//   - `last_sync_at` is the timestamp of the last sync ATTEMPT (not the last clean
//     run). When `partialFailure` is true, callers must surface it in the UI; the
//     timestamp alone must never be treated as proof of success.

import type { SupabaseClient } from '@supabase/supabase-js'

const CONNECTIONS_TABLE = 'google_calendar_connections'
const EVENTS_TABLE = 'calendar_events'
const FULL_SYNC_WINDOW_PAST_DAYS = 30
const FULL_SYNC_WINDOW_FUTURE_DAYS = 90
const PAGE_SIZE = 250
const MAX_PAGES_PER_CALENDAR = 8

type GoogleEvent = {
  id?: string
  summary?: string
  description?: string
  location?: string
  status?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  recurringEventId?: string
}

type CalendarListEntry = {
  id?: string
  summary?: string
  summaryOverride?: string
  primary?: boolean
  accessRole?: string
  backgroundColor?: string
}

export type CalendarSyncSummary = {
  id: string
  summary?: string
  imported: number
  updated: number
  cancelled: number
  fullResync: boolean
  hadSyncToken: boolean
  criticalFailure: boolean
  error?: string
}

export type RunSyncSummary = {
  ok: true
  lastSyncAt: string
  imported: number
  updated: number
  cancelled: number
  skipped: number
  skippedAllDay: number
  calendars: CalendarSyncSummary[]
  partialFailure: boolean
  failedCalendars: string[]
}

export type RunSyncFailure = {
  ok: false
  reason: 'token_refresh_failed' | 'no_calendars' | 'no_refresh_token'
  error?: string
}

export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json() as { access_token?: string; error?: string }
  if (!res.ok || !data.access_token) {
    console.error('[calendar/sync-engine] Token refresh failed:', data.error)
    return null
  }
  return data.access_token
}

async function fetchCalendarsMetadata(accessToken: string): Promise<Record<string, CalendarListEntry>> {
  const out: Record<string, CalendarListEntry> = {}
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false&minAccessRole=reader', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return out
    const data = await res.json() as { items?: CalendarListEntry[] }
    for (const item of data.items ?? []) {
      if (item.id) out[String(item.id)] = item
    }
  } catch {
    /* metadata is non-critical */
  }
  return out
}

function parseSelectedCalendarIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0)
    } catch { /* ignore */ }
  }
  return []
}

function parseSyncTokens(value: unknown): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v
    }
    return out
  }
  return {}
}

function googleEventToInsertRow(
  gEvent: GoogleEvent,
  workspaceId: string,
  calendarId: string,
  isReadOnly: boolean,
): Record<string, unknown> | null {
  const startDt = gEvent.start?.dateTime
  const endDt = gEvent.end?.dateTime
  if (!startDt || !endDt || !gEvent.id) return null

  const startDate = new Date(startDt)
  const endDate = new Date(endDt)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null

  const madridStartStr = startDate.toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' })
  const [datePart, timePart] = madridStartStr.split(' ')
  const [hourStr = '10', minuteStr = '00'] = (timePart ?? '').split(':')
  const date = datePart ?? startDt.slice(0, 10)
  const startHour = Math.max(0, Math.min(23, parseInt(hourStr, 10) || 0))
  const startMinute = Math.max(0, Math.min(59, parseInt(minuteStr, 10) || 0))
  const duration = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60_000))

  return {
    workspace_id: workspaceId,
    title: String(gEvent.summary || 'Evento de Google Calendar'),
    description: gEvent.description ? String(gEvent.description).slice(0, 1000) : null,
    location: gEvent.location ? String(gEvent.location).slice(0, 500) : null,
    date,
    start_at: startDt,
    end_at: endDt,
    start_hour: startHour,
    start_minute: startMinute,
    duration,
    type: 'meeting',
    status: 'scheduled',
    sync_source: 'google',
    google_event_id: String(gEvent.id),
    google_calendar_id: calendarId,
    last_synced_at: new Date().toISOString(),
    is_read_only: isReadOnly,
    google_sync_status: 'synced',
  }
}

type FetchPageResult =
  | { ok: true; items: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }
  | { ok: false; statusCode: number; reason: 'gone' | 'forbidden' | 'rate_limited' | 'other'; message?: string }

async function fetchEventsPage(
  accessToken: string,
  calendarId: string,
  params: URLSearchParams,
): Promise<FetchPageResult> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (res.status === 410) {
      return { ok: false, statusCode: 410, reason: 'gone', message: 'sync_token_expired' }
    }
    const data = await res.json().catch(() => ({})) as {
      items?: GoogleEvent[]
      nextPageToken?: string
      nextSyncToken?: string
      error?: { message?: string }
    }
    if (!res.ok) {
      if (res.status === 403) return { ok: false, statusCode: 403, reason: 'forbidden', message: data.error?.message }
      if (res.status === 429) return { ok: false, statusCode: 429, reason: 'rate_limited', message: data.error?.message }
      return { ok: false, statusCode: res.status, reason: 'other', message: data.error?.message }
    }
    return {
      ok: true,
      items: data.items ?? [],
      nextPageToken: data.nextPageToken,
      nextSyncToken: data.nextSyncToken,
    }
  } catch (err) {
    return { ok: false, statusCode: 0, reason: 'other', message: err instanceof Error ? err.message : 'network_error' }
  }
}

function buildBaseParams(syncToken?: string): URLSearchParams {
  if (syncToken) {
    return new URLSearchParams({
      syncToken,
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: String(PAGE_SIZE),
    })
  }
  const timeMin = new Date(Date.now() - FULL_SYNC_WINDOW_PAST_DAYS * 86_400_000).toISOString()
  const timeMax = new Date(Date.now() + FULL_SYNC_WINDOW_FUTURE_DAYS * 86_400_000).toISOString()
  return new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin,
    timeMax,
    showDeleted: 'true',
    maxResults: String(PAGE_SIZE),
  })
}

type ExistingEventRow = { id: string; google_event_id: string | null; google_calendar_id: string | null }

async function loadExistingEventIds(
  serviceClient: SupabaseClient,
  workspaceId: string,
  calendarIds: string[],
): Promise<Map<string, string>> {
  const { data } = await serviceClient
    .from(EVENTS_TABLE)
    .select('id, google_event_id, google_calendar_id')
    .eq('workspace_id', workspaceId)
    .in('google_calendar_id', calendarIds)
    .not('google_event_id', 'is', null)
  const map = new Map<string, string>()
  for (const row of (data ?? []) as ExistingEventRow[]) {
    if (!row.google_event_id) continue
    const cid = row.google_calendar_id ?? 'primary'
    map.set(`${cid}|${row.google_event_id}`, String(row.id))
  }
  return map
}

const PG_UNIQUE_VIOLATION = '23505'

// Inserts one Google event. On the race-condition partial-index duplicate (23505),
// looks up the existing row and converts the operation into an UPDATE so we don't
// drop the change. Returns the mode used so callers can keep accurate counters.
async function insertOrReconcileEvent(
  serviceClient: SupabaseClient,
  row: Record<string, unknown>,
  existingMap: Map<string, string>,
): Promise<{ ok: true; mode: 'inserted' | 'updated' } | { ok: false; error: string }> {
  const insertRes = await serviceClient
    .from(EVENTS_TABLE)
    .insert(row)
    .select('id, google_event_id, google_calendar_id')
    .single()

  if (!insertRes.error && insertRes.data) {
    const cid = String(insertRes.data.google_calendar_id ?? row.google_calendar_id ?? 'primary')
    const gid = String(insertRes.data.google_event_id ?? row.google_event_id ?? '')
    if (gid) existingMap.set(`${cid}|${gid}`, String(insertRes.data.id))
    return { ok: true, mode: 'inserted' }
  }

  const code = String(insertRes.error?.code ?? '')
  if (code !== PG_UNIQUE_VIOLATION) {
    return { ok: false, error: insertRes.error?.message ?? 'insert_failed' }
  }

  // Race: someone else inserted in between our existingMap load and this call.
  // Resolve the row and switch to UPDATE so the change is not lost.
  const lookup = await serviceClient
    .from(EVENTS_TABLE)
    .select('id')
    .eq('workspace_id', row.workspace_id as string)
    .eq('google_calendar_id', row.google_calendar_id as string)
    .eq('google_event_id', row.google_event_id as string)
    .maybeSingle()
  if (lookup.error || !lookup.data?.id) {
    return { ok: false, error: lookup.error?.message ?? 'duplicate_but_not_found' }
  }
  const localId = String(lookup.data.id)
  const cid = String(row.google_calendar_id ?? 'primary')
  const gid = String(row.google_event_id ?? '')
  if (gid) existingMap.set(`${cid}|${gid}`, localId)

  const updateFields = Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'workspace_id'))
  const updateRes = await serviceClient
    .from(EVENTS_TABLE)
    .update(updateFields)
    .eq('id', localId)
    .eq('workspace_id', row.workspace_id as string)
  if (updateRes.error) return { ok: false, error: updateRes.error.message }
  return { ok: true, mode: 'updated' }
}

type SyncOptions = {
  workspaceId: string
  userId: string
  serviceClient: SupabaseClient
  refreshToken: string
  selectedCalendarIds: string[]
  incrementalSyncTokens: Record<string, string>
}

export async function runIncrementalSync(opts: SyncOptions): Promise<RunSyncSummary | RunSyncFailure> {
  if (!opts.refreshToken) return { ok: false, reason: 'no_refresh_token' }
  const calendarIds = opts.selectedCalendarIds.filter((v) => typeof v === 'string' && v.length > 0)
  if (calendarIds.length === 0) return { ok: false, reason: 'no_calendars' }

  const accessToken = await refreshAccessToken(opts.refreshToken)
  if (!accessToken) return { ok: false, reason: 'token_refresh_failed' }

  const metadata = await fetchCalendarsMetadata(accessToken)
  const existingMap = await loadExistingEventIds(opts.serviceClient, opts.workspaceId, calendarIds)

  // Start from the stored map of tokens. For every calendar that finishes WITHOUT
  // a critical failure we will overwrite/insert its new nextSyncToken; for every
  // calendar that fails mid-write we leave its previous token untouched so the
  // next sync replays the missed changes.
  const newSyncTokens: Record<string, string> = { ...opts.incrementalSyncTokens }

  let totalImported = 0
  let totalUpdated = 0
  let totalCancelled = 0
  let totalSkipped = 0
  let totalSkippedAllDay = 0
  const perCalendar: CalendarSyncSummary[] = []
  const failedCalendars: string[] = []

  for (const calendarId of calendarIds) {
    const meta = metadata[calendarId]
    const accessRole = String(meta?.accessRole ?? 'reader')
    const isReadOnly = accessRole === 'reader' || accessRole === 'freeBusyReader'
    const summary = meta?.summaryOverride || meta?.summary

    let calImported = 0
    let calUpdated = 0
    let calCancelled = 0
    let hadSyncToken = Boolean(opts.incrementalSyncTokens[calendarId])
    let fullResync = !hadSyncToken
    let criticalFailure = false
    let calError: string | undefined

    let pageToken: string | undefined
    let nextSyncToken: string | undefined

    for (let page = 0; page < MAX_PAGES_PER_CALENDAR; page++) {
      const params = buildBaseParams(hadSyncToken ? opts.incrementalSyncTokens[calendarId] : undefined)
      if (pageToken) params.set('pageToken', pageToken)

      const result = await fetchEventsPage(accessToken, calendarId, params)

      if (!result.ok) {
        if (result.reason === 'gone') {
          // 410: syncToken invalidated → drop it, restart with full sync window.
          // We do NOT mark this as a critical failure — Google explicitly tells us
          // to re-fetch with no token, and we comply.
          hadSyncToken = false
          fullResync = true
          delete newSyncTokens[calendarId]
          pageToken = undefined
          continue
        }
        calError = result.reason === 'forbidden' ? 'forbidden'
          : result.reason === 'rate_limited' ? 'rate_limited'
          : `http_${result.statusCode}`
        criticalFailure = true
        break
      }

      for (const gEvent of result.items) {
        if (!gEvent.id) { totalSkipped++; continue }
        const key = `${calendarId}|${gEvent.id}`
        const existingLocalId = existingMap.get(key)

        // Cancelled in Google → soft-cancel locally (only if we have a row).
        if (gEvent.status === 'cancelled') {
          if (!existingLocalId) { totalSkipped++; continue }
          const { error } = await opts.serviceClient
            .from(EVENTS_TABLE)
            .update({
              status: 'cancelled',
              google_sync_status: 'deleted_from_google',
              last_synced_at: new Date().toISOString(),
            })
            .eq('id', existingLocalId)
            .eq('workspace_id', opts.workspaceId)
          if (error) {
            calError = `cancel_failed: ${error.message?.slice(0, 60) ?? 'unknown'}`
            criticalFailure = true
            break
          }
          calCancelled++
          continue
        }

        const row = googleEventToInsertRow(gEvent, opts.workspaceId, calendarId, isReadOnly)
        if (!row) {
          if (gEvent.start?.date && !gEvent.start?.dateTime) totalSkippedAllDay++
          else totalSkipped++
          continue
        }

        if (existingLocalId) {
          // UPDATE in place. No upsert, so no 42P10.
          const updateFields = Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'workspace_id'))
          const { error } = await opts.serviceClient
            .from(EVENTS_TABLE)
            .update(updateFields)
            .eq('id', existingLocalId)
            .eq('workspace_id', opts.workspaceId)
          if (error) {
            calError = `update_failed: ${error.message?.slice(0, 60) ?? 'unknown'}`
            criticalFailure = true
            break
          }
          calUpdated++
        } else {
          // INSERT with race-safe fallback (no upsert; the partial index would
          // refuse to participate in ON CONFLICT inference).
          const op = await insertOrReconcileEvent(opts.serviceClient, row, existingMap)
          if (!op.ok) {
            calError = `insert_failed: ${op.error.slice(0, 60)}`
            criticalFailure = true
            break
          }
          if (op.mode === 'inserted') calImported++
          else calUpdated++
        }
      }

      if (criticalFailure) break

      if (result.nextPageToken) {
        pageToken = result.nextPageToken
        continue
      }
      if (result.nextSyncToken) {
        nextSyncToken = result.nextSyncToken
      }
      break
    }

    // Per-calendar gate: only advance syncToken if every write for this calendar
    // succeeded. Otherwise Google replays the same delta on the next call.
    if (!criticalFailure && nextSyncToken) {
      newSyncTokens[calendarId] = nextSyncToken
    }
    if (criticalFailure) failedCalendars.push(calendarId)

    totalImported += calImported
    totalUpdated += calUpdated
    totalCancelled += calCancelled
    perCalendar.push({
      id: calendarId,
      summary,
      imported: calImported,
      updated: calUpdated,
      cancelled: calCancelled,
      fullResync,
      hadSyncToken,
      criticalFailure,
      ...(calError ? { error: calError } : {}),
    })
  }

  // last_sync_at = last ATTEMPT. partialFailure is the source of truth for "did
  // we actually catch everything". We also persist incremental_sync_tokens whether
  // partial or not — failed calendars kept their previous token, so the gate is
  // already enforced by which keys we mutated above.
  const lastSyncAt = new Date().toISOString()
  await opts.serviceClient
    .from(CONNECTIONS_TABLE)
    .update({
      last_sync_at: lastSyncAt,
      incremental_sync_tokens: newSyncTokens,
      updated_at: lastSyncAt,
    })
    .eq('workspace_id', opts.workspaceId)
    .eq('user_id', opts.userId)

  return {
    ok: true,
    lastSyncAt,
    imported: totalImported,
    updated: totalUpdated,
    cancelled: totalCancelled,
    skipped: totalSkipped,
    skippedAllDay: totalSkippedAllDay,
    calendars: perCalendar,
    partialFailure: failedCalendars.length > 0,
    failedCalendars,
  }
}

export function parseConnectionForSync(row: Record<string, unknown>): {
  refreshToken: string | null
  selectedCalendarIds: string[]
  incrementalSyncTokens: Record<string, string>
} {
  const refreshToken = typeof row.refresh_token_enc === 'string' && row.refresh_token_enc.length > 0
    ? row.refresh_token_enc
    : null
  let selectedCalendarIds = parseSelectedCalendarIds(row.selected_calendar_ids)
  if (selectedCalendarIds.length === 0) {
    const legacy = typeof row.calendar_id === 'string' && row.calendar_id ? row.calendar_id : 'primary'
    selectedCalendarIds = [legacy]
  }
  return {
    refreshToken,
    selectedCalendarIds,
    incrementalSyncTokens: parseSyncTokens(row.incremental_sync_tokens),
  }
}
