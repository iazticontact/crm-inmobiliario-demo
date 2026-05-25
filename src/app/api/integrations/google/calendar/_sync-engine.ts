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
import {
  canonicalCalendarId,
  dedupeCalendarIds,
  getPrimaryRealIdFromMetadata,
  isPrimaryAlias,
} from '@/lib/calendar-primary'

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

/** Stable, UI-safe codes the engine maps Google/DB errors to. Spanish copy lives
 *  in `reasonForCode` so server logs stay terse and the wire payload is small. */
export type CalendarSyncErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'sync_token_irrecoverable'
  | 'db_write'
  | 'network'
  | 'http_error'
  | 'unknown'

export type CalendarSyncSummary = {
  id: string
  summary?: string
  imported: number
  updated: number
  cancelled: number
  fullResync: boolean
  hadSyncToken: boolean
  criticalFailure: boolean
  errorCode?: CalendarSyncErrorCode
  reason?: string
  retryable?: boolean
  /** server-side detail; safe to log but kept short and tokens-free */
  errorDetail?: string
  writeFailures?: CalendarWriteFailure[]
}

export type FailedCalendar = {
  id: string
  summary?: string
  errorCode: CalendarSyncErrorCode
  reason: string
  retryable: boolean
  operation?: 'insert' | 'update' | 'cancel'
  failedEventId?: string
  failedEventTitle?: string
  failedEventStart?: string
  dbErrorCode?: string
  dbErrorMessage?: string
}

export type CalendarWriteFailure = {
  calendarId: string
  calendarSummary?: string
  operation: 'insert' | 'update' | 'cancel'
  googleEventId?: string
  title?: string
  start?: string
  end?: string
  dbErrorCode?: string
  dbErrorMessage?: string
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
  failedCalendars: FailedCalendar[]
  safeWriteFailures: CalendarWriteFailure[]
}

function reasonForCode(code: CalendarSyncErrorCode): { reason: string; retryable: boolean } {
  switch (code) {
    case 'forbidden':
      return { reason: 'No tenemos permisos para leer este calendario.', retryable: false }
    case 'not_found':
      return { reason: 'Este calendario ya no está disponible en Google.', retryable: false }
    case 'rate_limited':
      return { reason: 'Google limitó temporalmente la sincronización. Reintentaremos en breve.', retryable: true }
    case 'sync_token_irrecoverable':
      return { reason: 'Google pidió reiniciar la sincronización de este calendario. Lo reintentaremos.', retryable: true }
    case 'db_write':
      return { reason: 'No se pudo guardar uno de los eventos. Lo reintentaremos en la próxima sincronización.', retryable: true }
    case 'network':
      return { reason: 'No se pudo contactar con Google. Lo reintentaremos en breve.', retryable: true }
    case 'http_error':
      return { reason: 'Google respondió con un error temporal. Lo reintentaremos.', retryable: true }
    default:
      return { reason: 'No se pudo sincronizar este calendario. Lo reintentaremos.', retryable: true }
  }
}

function sanitizeErrorMessage(message?: string | null): string | undefined {
  if (!message) return undefined
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/refresh_token[=:]\s*[^,\s)]+/gi, 'refresh_token=[redacted]')
    .replace(/access_token[=:]\s*[^,\s)]+/gi, 'access_token=[redacted]')
    .slice(0, 180)
}

function makeWriteFailure(args: {
  calendarId: string
  calendarSummary?: string
  operation: CalendarWriteFailure['operation']
  event?: GoogleEvent
  dbErrorCode?: string | null
  dbErrorMessage?: string | null
}): CalendarWriteFailure {
  return {
    calendarId: args.calendarId,
    calendarSummary: args.calendarSummary,
    operation: args.operation,
    googleEventId: args.event?.id,
    title: args.event?.summary ? String(args.event.summary).slice(0, 120) : undefined,
    start: args.event?.start?.dateTime ?? args.event?.start?.date,
    end: args.event?.end?.dateTime ?? args.event?.end?.date,
    dbErrorCode: args.dbErrorCode ? String(args.dbErrorCode).slice(0, 24) : undefined,
    dbErrorMessage: sanitizeErrorMessage(args.dbErrorMessage),
  }
}

export type RunSyncFailure = {
  ok: false
  reason: 'token_refresh_failed' | 'no_calendars' | 'no_refresh_token'
  error?: string
}

/** Wire-safe view of a failed calendar: drops `dbErrorMessage` so the raw
 *  Postgres text (which can contain SQL fragments like
 *  `duplicate key value violates unique constraint "uq_..."`) never reaches the
 *  client. The friendly `reason` and the short `dbErrorCode` are enough for the
 *  UI; full diagnostics remain in server logs. */
export function sanitizeFailedCalendarForWire(f: FailedCalendar): Omit<FailedCalendar, 'dbErrorMessage'> {
  const { dbErrorMessage: _drop, ...rest } = f
  void _drop
  return rest
}

/** Wire-safe view of a write failure — same rationale as `sanitizeFailedCalendarForWire`. */
export function sanitizeWriteFailureForWire(f: CalendarWriteFailure): Omit<CalendarWriteFailure, 'dbErrorMessage'> {
  const { dbErrorMessage: _drop, ...rest } = f
  void _drop
  return rest
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

function getCalendarMetadata(metadata: Record<string, CalendarListEntry>, calendarId: string): CalendarListEntry | undefined {
  const direct = metadata[calendarId]
  if (direct) return direct
  if (calendarId === 'primary') {
    return Object.values(metadata).find((item) => item.primary === true)
  }
  return undefined
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

type ExistingEventRow = {
  id: string
  google_event_id: string | null
  google_calendar_id: string | null
  status: string | null
}

type LoadedExistingEvents = {
  /** canonical|gid → active localId. Skips canonical keys with > 1 active row
   *  so the merge path resolves them on the next write. */
  existingMap: Map<string, string>
  /** Per-localId: the current `google_calendar_id` value stored in the DB.
   *  Used by the main UPDATE path to detect when a payload would migrate the
   *  column to a slot already occupied by another (active OR cancelled) row,
   *  in which case we dispatch to `reconcileAliasedRow` instead of issuing
   *  the plain UPDATE that would 23505. */
  gcalByLocalId: Map<string, string>
}

async function loadExistingEventIds(
  eventClient: SupabaseClient,
  workspaceId: string,
  calendarIds: string[],
  primaryRealId: string | null,
): Promise<LoadedExistingEvents> {
  // Build the lookup id set including BOTH "primary" and the real primary id
  // when one of them is in scope. Without this, a row written long ago with
  // `google_calendar_id="primary"` would be invisible to the engine on the
  // next sync and we'd insert a duplicate keyed by the email-id instead of
  // updating the existing row.
  const lookupIds = new Set<string>()
  for (const id of calendarIds) {
    lookupIds.add(id)
    if (id === 'primary' && primaryRealId) lookupIds.add(primaryRealId)
    if (primaryRealId && id === primaryRealId) lookupIds.add('primary')
  }
  // Exclude cancelled rows from the in-batch lookup map. After a successful
  // alias merge the loser is soft-cancelled but still carries its original
  // google_calendar_id + google_event_id. If we loaded it the keyed map
  // could end up pointing at the cancelled row instead of the active keeper.
  // Cancelled rows STILL occupy the partial unique index slot though — the
  // index has no `WHERE status <> 'cancelled'` clause — so the main UPDATE
  // path re-detects them on demand via `reconcileAliasedRow` and routes the
  // merge before the plain UPDATE can 23505.
  const { data } = await eventClient
    .from(EVENTS_TABLE)
    .select('id, google_event_id, google_calendar_id, status')
    .eq('workspace_id', workspaceId)
    .in('google_calendar_id', Array.from(lookupIds))
    .not('google_event_id', 'is', null)
    .neq('status', 'cancelled')

  // Group active rows by canonical|gid first so we can detect — and skip —
  // any canonical key that still has MULTIPLE active rows (legacy duplicate
  // alias rows that never went through the merge path). Including them would
  // overwrite the map with whichever row was loaded last, the main UPDATE
  // path would patch only that one, and the other active duplicate would
  // keep rendering. Leaving the key OUT forces the next iteration into the
  // INSERT → 23505 → resolveDuplicateAliasRows path that actually merges
  // them.
  const grouped = new Map<string, ExistingEventRow[]>()
  for (const row of (data ?? []) as ExistingEventRow[]) {
    if (!row.google_event_id) continue
    const rawCid = row.google_calendar_id ?? 'primary'
    const canonical = canonicalCalendarId(rawCid, primaryRealId)
    const key = `${canonical}|${row.google_event_id}`
    const list = grouped.get(key) ?? []
    list.push(row)
    grouped.set(key, list)
  }
  const existingMap = new Map<string, string>()
  const gcalByLocalId = new Map<string, string>()
  for (const [key, rows] of grouped) {
    if (rows.length === 1) {
      const r = rows[0]
      const id = String(r.id)
      existingMap.set(key, id)
      gcalByLocalId.set(id, String(r.google_calendar_id ?? ''))
    }
    // rows.length > 1 → skip; merge path will reconcile on next write attempt.
  }
  return { existingMap, gcalByLocalId }
}

const PG_UNIQUE_VIOLATION = '23505'

/** Postgres error fingerprints we treat as "this row already exists, reconcile
 *  via UPDATE instead of bouncing the whole calendar's sync". Some Supabase
 *  client builds occasionally surface unique-violation errors without a
 *  populated `code` field, so we also match on the message body to be safe. */
function isDuplicateKeyError(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false
  const code = String(err.code ?? '')
  if (code === PG_UNIQUE_VIOLATION) return true
  const message = String(err.message ?? '').toLowerCase()
  return (
    message.includes('duplicate key') ||
    message.includes('uq_calendar_events_google') ||
    message.includes('23505')
  )
}

// Inserts one Google event. On unique-violation duplicates (race against a
// parallel sync OR an alias-mismatched legacy row Google now returns under
// the canonical id), looks up the existing row by triplet — trying BOTH the
// canonical and the `"primary"` alias variants of the calendar id — and
// converts the operation into an UPDATE so the change is never lost. Returns
// the mode used so callers can keep accurate counters.
async function insertOrReconcileEvent(
  eventClient: SupabaseClient,
  row: Record<string, unknown>,
  existingMap: Map<string, string>,
  primaryRealId: string | null,
): Promise<{ ok: true; mode: 'inserted' | 'updated' } | { ok: false; error: string; code?: string }> {
  const insertRes = await eventClient
    .from(EVENTS_TABLE)
    .insert(row)
    .select('id, google_event_id, google_calendar_id')
    .single()

  // Helper to populate existingMap under every alias key that could be used
  // to look this row up later in the same sync run.
  const stashAllAliases = (cid: string, gid: string, localId: string) => {
    if (!gid) return
    const canonical = canonicalCalendarId(cid, primaryRealId)
    existingMap.set(`${canonical}|${gid}`, localId)
    if (canonical !== cid) existingMap.set(`${cid}|${gid}`, localId)
    if (isPrimaryAlias(canonical, primaryRealId)) {
      existingMap.set(`primary|${gid}`, localId)
      if (primaryRealId) existingMap.set(`${primaryRealId}|${gid}`, localId)
    }
  }

  if (!insertRes.error && insertRes.data) {
    const cid = String(insertRes.data.google_calendar_id ?? row.google_calendar_id ?? 'primary')
    const gid = String(insertRes.data.google_event_id ?? row.google_event_id ?? '')
    stashAllAliases(cid, gid, String(insertRes.data.id))
    return { ok: true, mode: 'inserted' }
  }

  if (!isDuplicateKeyError(insertRes.error)) {
    return {
      ok: false,
      code: String(insertRes.error?.code ?? ''),
      error: insertRes.error?.message ?? 'insert_failed',
    }
  }

  // Conflict path — the partial unique index already has this triplet. Try to
  // find the existing row across ALL alias variants of the calendar id; the
  // conflict could come from "primary" vs email-id legacy rows, a race, or a
  // previous sync that migrated the column partially.
  const rowGcalId = String(row.google_calendar_id ?? 'primary')
  const canonicalRowGcalId = canonicalCalendarId(rowGcalId, primaryRealId)
  const aliasIds = new Set<string>([canonicalRowGcalId])
  if (canonicalRowGcalId !== rowGcalId) aliasIds.add(rowGcalId)
  if (isPrimaryAlias(canonicalRowGcalId, primaryRealId)) {
    aliasIds.add('primary')
    if (primaryRealId) aliasIds.add(primaryRealId)
  }
  const gid = String(row.google_event_id ?? '')
  const wsId = row.workspace_id as string

  const { data: candidates, error: lookupError } = await eventClient
    .from(EVENTS_TABLE)
    .select('id, google_calendar_id, status')
    .eq('workspace_id', wsId)
    .in('google_calendar_id', Array.from(aliasIds))
    .eq('google_event_id', gid)
    .limit(5)

  if (lookupError) {
    return {
      ok: false,
      code: String(lookupError.code ?? PG_UNIQUE_VIOLATION),
      error: lookupError.message,
    }
  }
  if (!candidates || candidates.length === 0) {
    return {
      ok: false,
      code: PG_UNIQUE_VIOLATION,
      error: 'duplicate_but_not_found',
    }
  }

  // Single match: race-safe reconcile — UPDATE the existing row with the fresh
  // payload and stash every alias key so the next event in this batch hits the
  // cache instead of taking the conflict path again.
  if (candidates.length === 1) {
    const localId = String(candidates[0].id)
    stashAllAliases(rowGcalId, gid, localId)
    const updateFields = Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'workspace_id'))
    const updateRes = await eventClient
      .from(EVENTS_TABLE)
      .update(updateFields)
      .eq('id', localId)
      .eq('workspace_id', wsId)
    if (updateRes.error) {
      return { ok: false, code: String(updateRes.error.code ?? ''), error: updateRes.error.message }
    }
    return { ok: true, mode: 'updated' }
  }

  // Multiple candidates: legacy duplicate alias rows for the same Google event
  // (e.g. one row under "primary" and another under the email-id). Picking one
  // and leaving the other alive would let visibleEvents — which is alias-aware —
  // render BOTH copies. That's fake success: the engine reports OK while the
  // grid keeps showing a duplicate. Resolve deterministically.
  return resolveDuplicateAliasRows({
    eventClient,
    candidates,
    canonicalRowGcalId,
    primaryRealId,
    row,
    workspaceId: wsId,
    googleEventId: gid,
    stashAllAliases,
  })
}

/** Resolves legacy duplicate rows for the same Google event living under
 *  different alias variants of `google_calendar_id`. Picks ONE keeper
 *  deterministically, UPDATEs it with the fresh row payload, soft-cancels
 *  every OTHER active row, and rewrites `existingMap` so every alias key
 *  points to the keeper. Any write failure → critical, so `syncToken` does
 *  NOT advance and Google replays the same delta on the next sync.
 *
 *  Keeper preference (first match wins). Compares the RAW
 *  `google_calendar_id` (canonicalising both sides would tie "primary" and
 *  the email-id and let the wrong row win, after which migrating it to
 *  canonical would re-trigger the unique violation). The first two priorities
 *  accept a CANCELLED keeper on purpose: the canonical row owns the partial
 *  unique index slot, so picking any other row would mean migrating into a
 *  slot that's already taken. Reviving the cancelled keeper via the UPDATE
 *  payload (which sets `status='scheduled'`) is safe because Google is the
 *  source of truth for whether the event is still active.
 *    1. Row at exactly `canonicalRowGcalId` (active OR cancelled).
 *    2. Row at `primaryRealId` (active OR cancelled).
 *    3. ACTIVE row at the literal `"primary"` alias.
 *    4. Any other active row.
 *    5. Lowest `id` lexicographically — stable across runs, covers the
 *       all-cancelled edge case where Google is replaying a previously
 *       fully-cancelled event.
 */
async function resolveDuplicateAliasRows(args: {
  eventClient: SupabaseClient
  candidates: { id: string; google_calendar_id: string | null; status: string | null }[]
  canonicalRowGcalId: string
  primaryRealId: string | null
  row: Record<string, unknown>
  workspaceId: string
  googleEventId: string
  /** Closure over `existingMap` so rewriting alias keys here also updates the
   *  caller's map. Avoids passing the map twice. */
  stashAllAliases: (cid: string, gid: string, localId: string) => void
}): Promise<{ ok: true; mode: 'updated' } | { ok: false; error: string; code?: string }> {
  const {
    eventClient,
    candidates,
    canonicalRowGcalId,
    primaryRealId,
    row,
    workspaceId,
    googleEventId,
    stashAllAliases,
  } = args

  const sorted = [...candidates].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const isActive = (c: { status: string | null }) => String(c.status ?? '') !== 'cancelled'

  const keeper =
    sorted.find((c) => String(c.google_calendar_id ?? '') === canonicalRowGcalId)
    ?? (primaryRealId ? sorted.find((c) => String(c.google_calendar_id ?? '') === primaryRealId) : undefined)
    ?? sorted.find((c) => isActive(c) && String(c.google_calendar_id ?? '') === 'primary')
    ?? sorted.find(isActive)
    ?? sorted[0]
  const keeperId = String(keeper.id)
  // Soft-cancel ONLY active duplicates. Rows that were already cancelled in a
  // prior merge stay cancelled — no point re-cancelling, and we promised the
  // critical-failure gate would only fire on real writes.
  const duplicates = sorted.filter((c) => String(c.id) !== keeperId && isActive(c))

  // 1) UPDATE the keeper with the fresh payload. We'd like to migrate its
  //    `google_calendar_id` to canonical so future syncs converge on one
  //    column value, BUT only if doing so wouldn't 23505 against another
  //    candidate that still occupies that slot in the partial unique index.
  //    Cancelled rows still hold their slot — the index has no `WHERE
  //    status <> 'cancelled'` clause. When migration would conflict we keep
  //    the keeper under its existing alias; `loadExistingEventIds` still
  //    resolves it via the canonical key map.
  const updateFields = Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'workspace_id'))
  const wouldConflictAtCanonical = sorted.some((c) =>
    String(c.id) !== keeperId &&
    String(c.google_calendar_id ?? '') === canonicalRowGcalId,
  )
  updateFields.google_calendar_id = wouldConflictAtCanonical
    ? String(keeper.google_calendar_id ?? canonicalRowGcalId)
    : canonicalRowGcalId
  const updateRes = await eventClient
    .from(EVENTS_TABLE)
    .update(updateFields)
    .eq('id', keeperId)
    .eq('workspace_id', workspaceId)
  if (updateRes.error) {
    return { ok: false, code: String(updateRes.error.code ?? 'db_write'), error: updateRes.error.message }
  }

  // 2) Soft-cancel each duplicate. Try the marker first; if the column rejects
  //    the value, fall back to plain status='cancelled' (which is already the
  //    canonical soft-cancel pattern in cancel-event/route.ts). Any failure
  //    after the fallback aborts the merge so we never leave the grid with a
  //    visible duplicate while reporting success.
  const nowIso = new Date().toISOString()
  for (const dup of duplicates) {
    const dupId = String(dup.id)
    const markerRes = await eventClient
      .from(EVENTS_TABLE)
      .update({
        status: 'cancelled',
        google_sync_status: 'duplicate_alias_merged',
        last_synced_at: nowIso,
      })
      .eq('id', dupId)
      .eq('workspace_id', workspaceId)
    if (markerRes.error) {
      const fallback = await eventClient
        .from(EVENTS_TABLE)
        .update({ status: 'cancelled', last_synced_at: nowIso })
        .eq('id', dupId)
        .eq('workspace_id', workspaceId)
      if (fallback.error) {
        return {
          ok: false,
          code: String(fallback.error.code ?? 'db_write'),
          error: fallback.error.message,
        }
      }
    }
  }

  // 3) Rewrite existingMap so every alias key points at the keeper — and never
  //    at a row we just soft-cancelled. We deliberately overwrite the canonical
  //    key (the old stash may have pointed at a duplicate).
  stashAllAliases(canonicalRowGcalId, googleEventId, keeperId)

  return { ok: true, mode: 'updated' }
}

/** Run during the main loop's UPDATE path when the existing row's stored
 *  `google_calendar_id` differs from the payload's canonical target. A plain
 *  UPDATE there would migrate the column to the canonical alias and 23505
 *  against any other row (active or cancelled — the partial unique index
 *  ignores status) already at that slot. This helper looks up ALL alias
 *  candidates for the gid, then dispatches:
 *
 *    - 0 candidates → defensive: UPDATE the originally-targeted row WITHOUT
 *      migrating its gcal. Practically unreachable (we got here precisely
 *      because existingMap had a row for this key), but a single SELECT can
 *      race with a concurrent delete.
 *    - 1 candidate → only one row exists across every alias variant; migration
 *      is safe, do a plain UPDATE with the full payload.
 *    - > 1 candidates → real conflict, hand off to `resolveDuplicateAliasRows`
 *      which picks an alias-aware keeper (incl. cancelled-canonical) and
 *      soft-cancels the duplicates.
 *
 *  Same critical-failure semantics as the rest of the engine: any DB error
 *  bubbles up as critical so the calendar's syncToken does NOT advance.
 */
async function reconcileAliasedRow(args: {
  eventClient: SupabaseClient
  row: Record<string, unknown>
  primaryRealId: string | null
  existingLocalId: string
  existingMap: Map<string, string>
  gcalByLocalId: Map<string, string>
}): Promise<{ ok: true; mode: 'updated' } | { ok: false; error: string; code?: string }> {
  const { eventClient, row, primaryRealId, existingLocalId, existingMap, gcalByLocalId } = args

  const rowGcalId = String(row.google_calendar_id ?? 'primary')
  const canonicalRowGcalId = canonicalCalendarId(rowGcalId, primaryRealId)
  const aliasIds = new Set<string>([canonicalRowGcalId])
  if (canonicalRowGcalId !== rowGcalId) aliasIds.add(rowGcalId)
  if (isPrimaryAlias(canonicalRowGcalId, primaryRealId)) {
    aliasIds.add('primary')
    if (primaryRealId) aliasIds.add(primaryRealId)
  }
  const gid = String(row.google_event_id ?? '')
  const wsId = row.workspace_id as string

  // SELECT every row (active AND cancelled) for this gid under any alias
  // variant. Cancelled rows matter because they still occupy the partial
  // unique index slot — we need to see them to decide whether migration
  // would conflict.
  const { data: candidates, error: lookupError } = await eventClient
    .from(EVENTS_TABLE)
    .select('id, google_calendar_id, status')
    .eq('workspace_id', wsId)
    .in('google_calendar_id', Array.from(aliasIds))
    .eq('google_event_id', gid)
    .limit(5)

  if (lookupError) {
    return { ok: false, code: String(lookupError.code ?? 'db_read'), error: lookupError.message }
  }

  // Same alias-stashing closure the INSERT-conflict path uses so subsequent
  // iterations in this run resolve via the cached lookup.
  const stashAllAliases = (cid: string, gid2: string, localId: string) => {
    if (!gid2) return
    const canonical = canonicalCalendarId(cid, primaryRealId)
    existingMap.set(`${canonical}|${gid2}`, localId)
    if (canonical !== cid) existingMap.set(`${cid}|${gid2}`, localId)
    if (isPrimaryAlias(canonical, primaryRealId)) {
      existingMap.set(`primary|${gid2}`, localId)
      if (primaryRealId) existingMap.set(`${primaryRealId}|${gid2}`, localId)
    }
  }

  if (!candidates || candidates.length === 0) {
    // Defensive: existingLocalId came from existingMap, but the row is no
    // longer there (deleted between load and now). Update by id WITHOUT
    // migrating gcal to avoid 23505 against any stray row we might miss.
    const safe = Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'workspace_id' && k !== 'google_calendar_id'))
    const u = await eventClient
      .from(EVENTS_TABLE)
      .update(safe)
      .eq('id', existingLocalId)
      .eq('workspace_id', wsId)
    if (u.error) return { ok: false, code: String(u.error.code ?? 'db_write'), error: u.error.message }
    return { ok: true, mode: 'updated' }
  }

  if (candidates.length === 1) {
    // Only one row across all alias variants — migration is safe.
    const localId = String(candidates[0].id)
    const updateFields = Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'workspace_id'))
    const u = await eventClient
      .from(EVENTS_TABLE)
      .update(updateFields)
      .eq('id', localId)
      .eq('workspace_id', wsId)
    if (u.error) return { ok: false, code: String(u.error.code ?? 'db_write'), error: u.error.message }
    stashAllAliases(rowGcalId, gid, localId)
    gcalByLocalId.set(localId, canonicalRowGcalId)
    return { ok: true, mode: 'updated' }
  }

  // > 1 candidates: legacy alias duplicates. Could be (active primary + active
  // email), (active primary + cancelled email), (active email + cancelled
  // primary), or all cancelled. `resolveDuplicateAliasRows` picks the right
  // keeper for each shape — including the case where the canonical/email row
  // is cancelled but still owns the unique index slot.
  return resolveDuplicateAliasRows({
    eventClient,
    candidates,
    canonicalRowGcalId,
    primaryRealId,
    row,
    workspaceId: wsId,
    googleEventId: gid,
    stashAllAliases,
  })
}

type SyncOptions = {
  workspaceId: string
  userId: string
  serviceClient: SupabaseClient
  eventsClient?: SupabaseClient
  refreshToken: string
  selectedCalendarIds: string[]
  incrementalSyncTokens: Record<string, string>
}

export async function runIncrementalSync(opts: SyncOptions): Promise<RunSyncSummary | RunSyncFailure> {
  if (!opts.refreshToken) return { ok: false, reason: 'no_refresh_token' }
  const rawCalendarIds = opts.selectedCalendarIds.filter((v) => typeof v === 'string' && v.length > 0)
  if (rawCalendarIds.length === 0) return { ok: false, reason: 'no_calendars' }

  const accessToken = await refreshAccessToken(opts.refreshToken)
  if (!accessToken) return { ok: false, reason: 'token_refresh_failed' }

  const eventsClient = opts.eventsClient ?? opts.serviceClient
  const metadata = await fetchCalendarsMetadata(accessToken)
  // Resolve the real primary id from Google's calendarList. With it we can
  // collapse the legacy `"primary"` alias and the email-id into a single
  // calendar — otherwise we iterate twice, double-write events, and inflate
  // sync stats.
  const primaryRealId = getPrimaryRealIdFromMetadata(metadata)
  const calendarIds = dedupeCalendarIds(rawCalendarIds, primaryRealId)
  if (calendarIds.length === 0) return { ok: false, reason: 'no_calendars' }
  const { existingMap, gcalByLocalId } = await loadExistingEventIds(eventsClient, opts.workspaceId, calendarIds, primaryRealId)

  // Start from the stored map of tokens. For every calendar that finishes WITHOUT
  // a critical failure we will overwrite/insert its new nextSyncToken; for every
  // calendar that fails mid-write we leave its previous token untouched so the
  // next sync replays the missed changes.
  // Also merge any stale alias key (`"primary"` token when the canonical is the
  // email, or vice versa) so we keep momentum across calendar id migrations.
  const newSyncTokens: Record<string, string> = { ...opts.incrementalSyncTokens }
  if (primaryRealId) {
    const aliasToken = opts.incrementalSyncTokens['primary']
    if (aliasToken && !newSyncTokens[primaryRealId]) newSyncTokens[primaryRealId] = aliasToken
    const realToken = opts.incrementalSyncTokens[primaryRealId]
    if (realToken && newSyncTokens['primary'] && newSyncTokens['primary'] !== realToken) {
      delete newSyncTokens['primary']
    } else if (realToken) {
      delete newSyncTokens['primary']
    }
  }

  let totalImported = 0
  let totalUpdated = 0
  let totalCancelled = 0
  let totalSkipped = 0
  let totalSkippedAllDay = 0
  const perCalendar: CalendarSyncSummary[] = []
  const failedCalendars: FailedCalendar[] = []
  const safeWriteFailures: CalendarWriteFailure[] = []
  // Per-calendar error markers that we'll merge into calendar_metadata at the end.
  // When a calendar later syncs cleanly, we delete the marker so the UI's
  // "needs review" badge clears automatically.
  const metaErrorUpdates: Record<string, ({
    code: CalendarSyncErrorCode
    reason: string
    at: string
  } & Partial<CalendarWriteFailure>) | null> = {}

  for (const calendarId of calendarIds) {
    const meta = getCalendarMetadata(metadata, calendarId)
    const accessRole = String(meta?.accessRole ?? 'reader')
    const isReadOnly = accessRole === 'reader' || accessRole === 'freeBusyReader'
    const summary = meta?.summaryOverride || meta?.summary

    let calImported = 0
    let calUpdated = 0
    let calCancelled = 0
    let hadSyncToken = Boolean(opts.incrementalSyncTokens[calendarId])
    let fullResync = !hadSyncToken
    let criticalFailure = false
    let calErrorCode: CalendarSyncErrorCode | undefined
    let calErrorDetail: string | undefined
    let firstWriteFailure: CalendarWriteFailure | undefined
    const calWriteFailures: CalendarWriteFailure[] = []
    // Count how many times we recovered from 410 on this calendar. After 2
    // attempts we stop spinning and surface the failure.
    let goneRetries = 0

    let pageToken: string | undefined
    let nextSyncToken: string | undefined

    for (let page = 0; page < MAX_PAGES_PER_CALENDAR; page++) {
      const params = buildBaseParams(hadSyncToken ? opts.incrementalSyncTokens[calendarId] : undefined)
      if (pageToken) params.set('pageToken', pageToken)

      const result = await fetchEventsPage(accessToken, calendarId, params)

      if (!result.ok) {
        if (result.reason === 'gone') {
          if (goneRetries >= 2) {
            calErrorCode = 'sync_token_irrecoverable'
            calErrorDetail = 'gone_after_retry'
            criticalFailure = true
            break
          }
          goneRetries++
          hadSyncToken = false
          fullResync = true
          delete newSyncTokens[calendarId]
          pageToken = undefined
          continue
        }
        if (result.reason === 'forbidden') {
          // Distinguish "calendar deleted" (404 hidden as 403 in some accounts) from
          // "lost access". Both are non-retryable in the same way for our purposes.
          calErrorCode = result.statusCode === 404 ? 'not_found' : 'forbidden'
        } else if (result.reason === 'rate_limited') {
          calErrorCode = 'rate_limited'
        } else if (result.statusCode === 404) {
          calErrorCode = 'not_found'
        } else if (result.statusCode === 0) {
          calErrorCode = 'network'
        } else {
          calErrorCode = 'http_error'
        }
        calErrorDetail = `http_${result.statusCode}${result.message ? `: ${result.message.slice(0, 60)}` : ''}`
        criticalFailure = true
        break
      }

      for (const gEvent of result.items) {
        if (!gEvent.id) { totalSkipped++; continue }
        // existingMap is keyed by canonical calendar id (see loadExistingEventIds).
        // `calendarId` here is already canonical because we deduped at the top.
        // We ALSO probe the `"primary"` and email-id aliases so a legacy row
        // stored under either alias resolves correctly without falling through
        // to insert + 23505 fallback.
        const lookupKeys = [`${calendarId}|${gEvent.id}`]
        if (isPrimaryAlias(calendarId, primaryRealId)) {
          lookupKeys.push(`primary|${gEvent.id}`)
          if (primaryRealId) lookupKeys.push(`${primaryRealId}|${gEvent.id}`)
        }
        let existingLocalId: string | undefined
        for (const k of lookupKeys) {
          const found = existingMap.get(k)
          if (found) { existingLocalId = found; break }
        }

        // Cancelled in Google → soft-cancel locally (only if we have a row).
        if (gEvent.status === 'cancelled') {
          if (!existingLocalId) { totalSkipped++; continue }
          const { error } = await eventsClient
            .from(EVENTS_TABLE)
            .update({
              status: 'cancelled',
              google_sync_status: 'deleted_from_google',
              last_synced_at: new Date().toISOString(),
            })
            .eq('id', existingLocalId)
            .eq('workspace_id', opts.workspaceId)
          if (error) {
            calErrorCode = 'db_write'
            const failure = makeWriteFailure({
              calendarId,
              calendarSummary: summary,
              operation: 'cancel',
              event: gEvent,
              dbErrorCode: String(error.code ?? ''),
              dbErrorMessage: error.message,
            })
            firstWriteFailure = failure
            calWriteFailures.push(failure)
            safeWriteFailures.push(failure)
            calErrorDetail = `cancel: ${failure.dbErrorCode ?? 'db'} ${failure.dbErrorMessage ?? 'unknown'}`
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
          // Before issuing a plain UPDATE: would it migrate the row's
          // `google_calendar_id` column to a slot already occupied by another
          // row? The partial unique index has no `WHERE status <> 'cancelled'`
          // clause, so a previously soft-cancelled sibling at the canonical
          // slot still blocks migration with 23505. When the existing row's
          // gcal differs from the payload target we route through
          // `reconcileAliasedRow`, which SELECTs every alias candidate (active
          // AND cancelled) and dispatches to the merge path when needed.
          const currentGcal = gcalByLocalId.get(existingLocalId) ?? ''
          const payloadGcal = String(row.google_calendar_id ?? 'primary')
          const wouldMigrateGcal = currentGcal !== '' && currentGcal !== payloadGcal

          let updateError: { code?: string | null; message?: string | null } | null = null
          if (wouldMigrateGcal) {
            const op = await reconcileAliasedRow({
              eventClient: eventsClient,
              row,
              primaryRealId,
              existingLocalId,
              existingMap,
              gcalByLocalId,
            })
            if (!op.ok) updateError = { code: op.code, message: op.error }
          } else {
            const updateFields = Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'workspace_id'))
            const { error } = await eventsClient
              .from(EVENTS_TABLE)
              .update(updateFields)
              .eq('id', existingLocalId)
              .eq('workspace_id', opts.workspaceId)
            if (error) updateError = error
          }

          if (updateError) {
            calErrorCode = 'db_write'
            const failure = makeWriteFailure({
              calendarId,
              calendarSummary: summary,
              operation: 'update',
              event: gEvent,
              dbErrorCode: String(updateError.code ?? ''),
              dbErrorMessage: updateError.message ?? undefined,
            })
            firstWriteFailure = failure
            calWriteFailures.push(failure)
            safeWriteFailures.push(failure)
            calErrorDetail = `update: ${failure.dbErrorCode ?? 'db'} ${failure.dbErrorMessage ?? 'unknown'}`
            criticalFailure = true
            break
          }
          calUpdated++
        } else {
          // INSERT with race-safe fallback (no upsert; the partial index would
          // refuse to participate in ON CONFLICT inference).
          const op = await insertOrReconcileEvent(eventsClient, row, existingMap, primaryRealId)
          if (!op.ok) {
            calErrorCode = 'db_write'
            const failure = makeWriteFailure({
              calendarId,
              calendarSummary: summary,
              operation: 'insert',
              event: gEvent,
              dbErrorCode: op.code,
              dbErrorMessage: op.error,
            })
            firstWriteFailure = failure
            calWriteFailures.push(failure)
            safeWriteFailures.push(failure)
            calErrorDetail = `insert: ${failure.dbErrorCode ?? 'db'} ${failure.dbErrorMessage ?? 'unknown'}`
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

    const { reason: errorReason, retryable } = calErrorCode
      ? reasonForCode(calErrorCode)
      : { reason: '', retryable: true }

    // user-facing reason: friendly only. The raw DB message (`23505`,
    // `duplicate key value violates unique constraint…`) stays in the
    // structured fields `dbErrorCode`/`dbErrorMessage` for support/debug,
    // never leaks into the modal banner.
    const userReason = errorReason

    if (criticalFailure && calErrorCode) {
      failedCalendars.push({
        id: calendarId,
        summary,
        errorCode: calErrorCode,
        reason: userReason,
        retryable,
        ...(firstWriteFailure ? {
          operation: firstWriteFailure.operation,
          failedEventId: firstWriteFailure.googleEventId,
          failedEventTitle: firstWriteFailure.title,
          failedEventStart: firstWriteFailure.start,
          dbErrorCode: firstWriteFailure.dbErrorCode,
          dbErrorMessage: firstWriteFailure.dbErrorMessage,
        } : {}),
      })
      // Persisted to calendar_metadata so the next list-calendars call can show a
      // "Revisar" badge without a roundtrip. Strip the raw DB message — the
      // friendly `reason` is the only thing the UI surfaces and the raw text
      // would leak SQL fragments back to the client on future reads.
      const metaWriteFailure = firstWriteFailure
        ? (() => {
            const rest: Partial<CalendarWriteFailure> = { ...firstWriteFailure }
            delete rest.dbErrorMessage
            return rest
          })()
        : undefined
      metaErrorUpdates[calendarId] = {
        code: calErrorCode,
        reason: userReason,
        at: new Date().toISOString(),
        ...(metaWriteFailure ?? {}),
      }
      // Server-side trace — no tokens or PII. Keeps the cause discoverable even
      // when the client only shows the friendly reason.
      console.warn('[calendar/sync-engine] calendar failed ' + JSON.stringify({
        calendarId,
        summary,
        errorCode: calErrorCode,
        detail: calErrorDetail,
        failedEventTitle: firstWriteFailure?.title,
        failedEventStart: firstWriteFailure?.start,
        dbErrorCode: firstWriteFailure?.dbErrorCode,
        dbErrorMessage: firstWriteFailure?.dbErrorMessage,
      }))
    } else if (!criticalFailure) {
      // Clear any previous error marker so the UI's "Revisar" badge goes away
      // when a calendar recovers on its own.
      metaErrorUpdates[calendarId] = null
      console.info('[calendar/sync-engine] calendar ok ' + JSON.stringify({
        calendarId,
        summary,
        imported: calImported,
        updated: calUpdated,
        cancelled: calCancelled,
        fullResync,
        hadSyncToken,
      }))
    }

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
      ...(calErrorCode ? {
        errorCode: calErrorCode,
        reason: errorReason,
        retryable,
        ...(calErrorDetail ? { errorDetail: calErrorDetail } : {}),
        ...(calWriteFailures.length ? { writeFailures: calWriteFailures } : {}),
      } : {}),
    })
  }

  // last_sync_at = last ATTEMPT. partialFailure is the source of truth for "did
  // we actually catch everything". We also persist incremental_sync_tokens whether
  // partial or not — failed calendars kept their previous token, so the gate is
  // already enforced by which keys we mutated above.
  //
  // For per-calendar error markers we merge into the existing calendar_metadata:
  //   - Successful calendar → drop its `lastSyncError` key (if any).
  //   - Failed calendar → set/refresh its `lastSyncError`.
  // We do this with a read-modify-write because supabase-js doesn't expose
  // jsonb_set; the cost is one extra SELECT per sync, which is negligible.
  const { data: currentRow } = await opts.serviceClient
    .from(CONNECTIONS_TABLE)
    .select('calendar_metadata')
    .eq('workspace_id', opts.workspaceId)
    .eq('user_id', opts.userId)
    .maybeSingle()
  const currentMetadata = (currentRow?.calendar_metadata && typeof currentRow.calendar_metadata === 'object' && !Array.isArray(currentRow.calendar_metadata))
    ? (currentRow.calendar_metadata as Record<string, Record<string, unknown>>)
    : {}
  const updatedMetadata: Record<string, Record<string, unknown>> = { ...currentMetadata }
  for (const [calendarId, marker] of Object.entries(metaErrorUpdates)) {
    const previous = updatedMetadata[calendarId] && typeof updatedMetadata[calendarId] === 'object'
      ? { ...updatedMetadata[calendarId] }
      : {}
    if (marker === null) {
      delete previous.lastSyncError
    } else {
      previous.lastSyncError = marker
    }
    if (Object.keys(previous).length === 0) delete updatedMetadata[calendarId]
    else updatedMetadata[calendarId] = previous
  }

  const lastSyncAt = new Date().toISOString()
  await opts.serviceClient
    .from(CONNECTIONS_TABLE)
    .update({
      last_sync_at: lastSyncAt,
      incremental_sync_tokens: newSyncTokens,
      calendar_metadata: updatedMetadata,
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
    safeWriteFailures,
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
