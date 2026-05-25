// GET /api/integrations/google/calendar/list-calendars
//
// Lists the Google calendars visible to the CURRENT user, using that user's
// own refresh_token. Scope is strictly (workspace_id, user_id). Never leaks
// tokens to the browser.

import { NextResponse } from 'next/server'
import { getGoogleCalendarServiceClient } from '../server-utils'
import { resolveCalendarAuth, selectUserConnection } from '../_user-connection'

export const runtime = 'nodejs'

type LastSyncError = {
  code: string
  reason: string
  at: string
  operation?: string
  title?: string
  start?: string
  dbErrorCode?: string
}

/** Strips `dbErrorMessage` from any cached marker before sending it to the
 *  client. Old rows may still have the field even though the engine no longer
 *  writes it — sanitise on read so the wire payload stays clean regardless of
 *  the BD's history. */
function sanitizeLastSyncError(raw: unknown): LastSyncError | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.code !== 'string' || typeof r.reason !== 'string' || typeof r.at !== 'string') return undefined
  const out: LastSyncError = { code: r.code, reason: r.reason, at: r.at }
  if (typeof r.operation === 'string') out.operation = r.operation
  if (typeof r.title === 'string') out.title = r.title
  if (typeof r.start === 'string') out.start = r.start
  if (typeof r.dbErrorCode === 'string') out.dbErrorCode = r.dbErrorCode
  return out
}

type CalendarItem = {
  id: string
  summary: string
  primary: boolean
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader' | 'none' | string
  backgroundColor?: string
  foregroundColor?: string
  selected: boolean
  lastSyncError?: LastSyncError
  /** True when the calendar is in `selected_calendar_ids` but Google's calendarList
   *  did not return it on this call (deleted / lost access / permission revoked).
   *  The UI uses this to render a "Revisar / Quitar" affordance even when Google
   *  can no longer provide the calendar's metadata. */
  unavailable?: boolean
  /** False when the engine can no longer write or read this calendar (read-only
   *  access-role or unavailable). Used by the UI to decide whether removing it
   *  from the selection is the recommended action. */
  canSync?: boolean
}

type Result =
  | { ok: true; calendars: CalendarItem[]; defaultCalendarId: string; selectedCalendarIds: string[] }
  | { ok: true; calendars: []; reason: string }
  | { ok: false; error: string; reason?: string }

type GoogleCalendarListEntry = {
  id?: string
  summary?: string
  summaryOverride?: string
  primary?: boolean
  accessRole?: string
  backgroundColor?: string
  foregroundColor?: string
  selected?: boolean
  hidden?: boolean
  deleted?: boolean
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
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
    console.error('[list-calendars] Token refresh failed:', data.error)
    return null
  }
  return data.access_token
}

type ConnectionRow = {
  status: string | null
  calendar_id: string | null
  refresh_token_enc: string | null
  selected_calendar_ids: unknown
  calendar_metadata: unknown
}

export async function GET(): Promise<NextResponse<Result>> {
  const auth = await resolveCalendarAuth()
  if ('ok' in auth && auth.ok === false) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }
  if (!('userId' in auth)) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const admin = getGoogleCalendarServiceClient()
  if (!admin) return NextResponse.json({ ok: false, error: 'Service role no configurado' }, { status: 503 })

  let connection
  try {
    connection = await selectUserConnection<ConnectionRow>(
      admin,
      auth.workspaceId,
      auth.userId,
      'status, calendar_id, refresh_token_enc, selected_calendar_ids, calendar_metadata',
    )
  } catch (err) {
    console.error('[list-calendars] DB read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'No se pudo leer la conexión' }, { status: 500 })
  }

  if (connection.schemaPending) {
    return NextResponse.json({
      ok: false,
      reason: 'schema_pending_migration',
      error: 'Aplica la migración calendar_user_level_v1.sql para activar la conexión individual.',
    }, { status: 503 })
  }

  const connRow = connection.row
  if (!connRow || connRow.status !== 'connected' || !connRow.refresh_token_enc) {
    return NextResponse.json({ ok: true, calendars: [], reason: 'no_google_connection' })
  }

  const accessToken = await refreshAccessToken(connRow.refresh_token_enc)
  if (!accessToken) return NextResponse.json({ ok: true, calendars: [], reason: 'token_refresh_failed' })

  let items: GoogleCalendarListEntry[] = []
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false&minAccessRole=reader', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json() as { items?: GoogleCalendarListEntry[]; error?: { message?: string } }
    if (!res.ok) {
      console.error('[list-calendars] Google API error:', data.error?.message)
      return NextResponse.json({ ok: true, calendars: [], reason: 'google_api_error' })
    }
    items = data.items ?? []
  } catch (err) {
    console.error('[list-calendars] Fetch error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true, calendars: [], reason: 'google_fetch_error' })
  }

  let selectedIds: string[] = []
  const rawSelected = connRow.selected_calendar_ids
  if (Array.isArray(rawSelected)) {
    selectedIds = rawSelected.filter((v): v is string => typeof v === 'string')
  } else if (typeof rawSelected === 'string') {
    try {
      const parsed = JSON.parse(rawSelected)
      if (Array.isArray(parsed)) selectedIds = parsed.filter((v): v is string => typeof v === 'string')
    } catch { /* ignore */ }
  }
  if (selectedIds.length === 0) {
    const legacy = connRow.calendar_id ? String(connRow.calendar_id) : 'primary'
    selectedIds = [legacy]
  }

  // Map calendar_metadata[id].lastSyncError onto each item so the UI can show
  // a "Revisar" badge without a separate roundtrip. The metadata key for primary
  // is the literal string "primary" (that's what the engine syncs against) — we
  // also surface it on the user's email-id row when it's their primary calendar.
  const metadata = (connRow.calendar_metadata && typeof connRow.calendar_metadata === 'object' && !Array.isArray(connRow.calendar_metadata))
    ? (connRow.calendar_metadata as Record<string, { lastSyncError?: unknown }>)
    : {}

  const calendars: CalendarItem[] = []
  const returnedIds = new Set<string>()
  let defaultCalendarId = 'primary'
  let primaryEmailId: string | null = null
  for (const item of items) {
    if (!item.id || item.deleted) continue
    const id = String(item.id)
    returnedIds.add(id)
    if (item.primary) {
      defaultCalendarId = id
      primaryEmailId = id
    }
    const directError = sanitizeLastSyncError(metadata[id]?.lastSyncError)
    const primaryAliasError = item.primary ? sanitizeLastSyncError(metadata['primary']?.lastSyncError) : undefined
    const lastSyncError = directError ?? primaryAliasError
    const accessRole = String(item.accessRole ?? 'reader')
    const canSync = accessRole === 'owner' || accessRole === 'writer' || accessRole === 'reader' || accessRole === 'freeBusyReader'
    calendars.push({
      id,
      summary: String(item.summaryOverride || item.summary || id),
      primary: Boolean(item.primary),
      accessRole,
      backgroundColor: item.backgroundColor ? String(item.backgroundColor) : undefined,
      foregroundColor: item.foregroundColor ? String(item.foregroundColor) : undefined,
      selected: selectedIds.includes(id) || (selectedIds.includes('primary') && Boolean(item.primary)),
      canSync,
      ...(lastSyncError ? { lastSyncError } : {}),
    })
  }

  // Ghosts: selected calendars Google no longer returns (deleted, lost access,
  // permission revoked). The user MUST be able to see and remove them from the
  // modal, so we synthesise a row with whatever metadata we cached when sync
  // was last healthy. We never re-introduce the literal "primary" string if a
  // real primary calendar was returned by Google (otherwise the modal shows
  // two "Principal" rows).
  for (const selectedId of selectedIds) {
    if (returnedIds.has(selectedId)) continue
    if (selectedId === 'primary' && primaryEmailId) continue
    const cachedMeta = metadata[selectedId] as { summary?: string; accessRole?: string; backgroundColor?: string; primary?: boolean; lastSyncError?: unknown } | undefined
    const cachedError = sanitizeLastSyncError(cachedMeta?.lastSyncError)
    const lastSyncError: LastSyncError = cachedError ?? {
      code: selectedId === 'primary' ? 'unknown' : 'not_found',
      reason: 'Este calendario ya no está disponible o no tenemos permisos para leerlo.',
      at: new Date().toISOString(),
    }
    calendars.push({
      id: selectedId,
      summary: cachedMeta?.summary ?? (selectedId === 'primary' ? 'Calendario principal' : 'Calendario no disponible'),
      primary: selectedId === 'primary' || Boolean(cachedMeta?.primary),
      accessRole: cachedMeta?.accessRole ?? 'none',
      backgroundColor: cachedMeta?.backgroundColor,
      selected: true,
      canSync: false,
      unavailable: true,
      lastSyncError,
    })
  }

  // Sort: primary first, then selected+OK, then selected+error, then unselected,
  // then unavailable at the bottom. Within a band, alphabetical by summary.
  function rank(c: CalendarItem): number {
    if (c.primary) return 0
    if (c.unavailable) return 4
    if (c.selected && c.lastSyncError) return 2
    if (c.selected) return 1
    return 3
  }
  calendars.sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return a.summary.localeCompare(b.summary)
  })

  return NextResponse.json({ ok: true, calendars, defaultCalendarId, selectedCalendarIds: selectedIds })
}
