// POST /api/integrations/google/calendar/sync-event
// Server-side only. Reads refresh_token from google_calendar_connections, obtains a fresh
// access_token from Google, inserts the event in Google Calendar, and patches the local
// calendar_events row with the resulting google_event_id.
// Never exposes tokens to the browser — the frontend only receives { synced, reason }.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getGoogleCalendarServiceClient } from '../server-utils'
import { selectUserConnection } from '../_user-connection'
import { areSameCalendarId, getPrimaryRealIdFromMetadata } from '@/lib/calendar-primary'

export const runtime = 'nodejs'

type SyncResult =
  | { ok: true; synced: true; googleEventId: string; calendarId: string }
  | { ok: true; synced: false; reason: string }
  | { ok: false; error: string }

function isUuid(value?: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    } catch {
      return []
    }
  }
  return []
}

type CalendarMetadataItem = {
  summary?: string
  accessRole?: string
  backgroundColor?: string
  primary?: boolean
}

function parseCalendarMetadata(value: unknown): Record<string, CalendarMetadataItem> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, CalendarMetadataItem>
}

function isWritableRole(role?: string | null): boolean {
  return role === 'owner' || role === 'writer'
}

// Calendar-id equivalence is delegated to `areSameCalendarId` from
// `@/lib/calendar-primary`. That helper resolves the "primary" alias against
// the user's actual primary id (derived from `calendar_metadata`) and never
// uses heuristics like `calendarId.includes('@')` — which previously let any
// email-shaped id pass when `"primary"` was in the selection, regardless of
// whether that email was actually selected. See PR audit "selected_calendar_ids
// bypass" for context.

async function rollbackGoogleCreate(accessToken: string, calendarId: string, googleEventId: string) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      console.error('[sync-event] Google rollback delete failed:', res.status)
    }
  } catch (err) {
    console.error('[sync-event] Google rollback fetch error:', err instanceof Error ? err.message : err)
  }
}

async function buildSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch { /* static render context */ }
      },
    },
  })
}

export async function POST(req: NextRequest): Promise<NextResponse<SyncResult>> {
  const supabase = await buildSupabase()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })
  }

  // Auth
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  // Workspace
  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })
  }

  const serviceSupabase = getGoogleCalendarServiceClient()
  if (!serviceSupabase) {
    return NextResponse.json({ ok: false, error: 'Service role no configurado' }, { status: 503 })
  }

  // Body
  let eventId: string
  let requestedCalendarId: string | undefined
  try {
    const body = await req.json() as { eventId?: unknown; calendarId?: unknown }
    eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
    const rawCalendarId = typeof body.calendarId === 'string' ? body.calendarId.trim() : ''
    requestedCalendarId = rawCalendarId || undefined
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 })
  }
  if (!eventId) {
    return NextResponse.json({ ok: false, error: 'eventId requerido' }, { status: 400 })
  }
  if (!isUuid(eventId)) {
    return NextResponse.json({ ok: false, error: 'eventId inválido' }, { status: 400 })
  }

  // Check Google Calendar connection of THIS user (workspace_id + user_id).
  let connection
  try {
    connection = await selectUserConnection<{
      status: string | null
      calendar_id: string | null
      default_calendar_id: string | null
      refresh_token_enc: string | null
      token_expiry: string | null
      selected_calendar_ids: unknown
      calendar_metadata: unknown
    }>(
      serviceSupabase,
      workspaceId,
      user.id,
      'status, calendar_id, default_calendar_id, refresh_token_enc, token_expiry, selected_calendar_ids, calendar_metadata',
    )
  } catch (err) {
    console.error('[sync-event] DB read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'No se pudo leer la conexión' }, { status: 500 })
  }
  if (connection.schemaPending) {
    return NextResponse.json({ ok: false, error: 'Aplica calendar_user_level_v1.sql para sincronizar.' }, { status: 503 })
  }
  const gcConn = connection.row
  if (!gcConn || gcConn.status !== 'connected') {
    return NextResponse.json({ ok: true, synced: false, reason: 'not_connected' })
  }

  const refreshToken = gcConn.refresh_token_enc
  if (!refreshToken) {
    return NextResponse.json({ ok: true, synced: false, reason: 'no_refresh_token' })
  }

  // Server-side credentials
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: true, synced: false, reason: 'credentials_not_configured' })
  }

  // Load the local calendar event — select * to be resilient to schema differences
  const { data: eventRow } = await supabase
    .from('calendar_events')
    .select('id, title, start_at, end_at, date, start_hour, start_minute, duration, description, notes, client_name, location, google_event_id, google_calendar_id, is_read_only')
    .eq('id', eventId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!eventRow) {
    return NextResponse.json({ ok: false, error: 'Evento no encontrado' }, { status: 404 })
  }
  if (eventRow.is_read_only === true) {
    return NextResponse.json({ ok: true, synced: false, reason: 'read_only_event' })
  }

  // If the event already has a google_event_id, this is a re-sync (e.g. user confirmed twice
  // or page reload re-triggered). Don't create a duplicate in Google — PATCH the existing one.
  const existingGoogleId = eventRow.google_event_id as string | null | undefined
  const existingGoogleCalendarId = eventRow.google_calendar_id as string | null | undefined
  const selectedCalendarIds = parseStringArray(gcConn.selected_calendar_ids)
  const calendarMetadata = parseCalendarMetadata(gcConn.calendar_metadata)

  // Refresh access token — we always refresh since we only store the token hash, not the token itself
  let accessToken: string
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string }
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[sync-event] Token refresh failed:', tokenData.error)
      return NextResponse.json({ ok: true, synced: false, reason: 'token_refresh_failed' })
    }
    accessToken = tokenData.access_token

    // Update token_expiry on THIS user's row only (access tokens expire in 1h).
    const expiry = new Date(Date.now() + 3590 * 1000).toISOString()
    void serviceSupabase
      .from('google_calendar_connections')
      .update({ token_expiry: expiry })
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
  } catch (err) {
    console.error('[sync-event] Token refresh error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true, synced: false, reason: 'token_refresh_error' })
  }

  // Build ISO datetimes: prefer start_at/end_at, fall back to date + hour fields
  let startAt: string
  let endAt: string
  if (eventRow.start_at && eventRow.end_at) {
    startAt = String(eventRow.start_at)
    endAt = String(eventRow.end_at)
  } else {
    const date = String(eventRow.date ?? '')
    const hour = Number(eventRow.start_hour ?? 10)
    const minute = Number(eventRow.start_minute ?? 0)
    const duration = Number(eventRow.duration ?? 60)
    const start = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`)
    const end = new Date(start.getTime() + duration * 60_000)
    startAt = start.toISOString()
    endAt = end.toISOString()
  }

  if (!startAt || !endAt) {
    return NextResponse.json({ ok: true, synced: false, reason: 'missing_event_times' })
  }

  // Build Google Calendar event payload.
  // For existing events: keep the original calendar to avoid orphaning.
  // For new events: prefer user-selected default calendar before falling back to "primary".
  const calendarId =
    existingGoogleCalendarId ||
    requestedCalendarId ||
    selectedCalendarIds[0] ||
    (gcConn.default_calendar_id as string | null) ||
    (gcConn.calendar_id as string | null) ||
    'primary'

  // `primaryRealId` is the user's actual primary calendar id (typically their
  // email). Derived strictly from `calendar_metadata` — the JSONB the engine
  // populates from Google's calendarList. Used as the only authority that can
  // declare "primary" === some-email. If metadata doesn't mark a primary, the
  // helper returns null and `areSameCalendarId` will refuse to bridge the
  // alias, which is exactly the safe behavior: no metadata → no equivalence.
  const primaryRealId = getPrimaryRealIdFromMetadata(calendarMetadata)

  if (!existingGoogleId) {
    // `selected_calendar_ids` is the server-side source of truth for which
    // calendars this user is authorised to target. An empty selection means
    // no calendar is authorised — we MUST NOT fall back to `default_calendar_id`
    // or `"primary"`, even though the frontend usually prevents this path.
    // Defence-in-depth: rejecting here makes the server safe regardless of
    // which client is calling.
    if (selectedCalendarIds.length === 0) {
      return NextResponse.json({ ok: true, synced: false, reason: 'calendar_not_selected' })
    }
    const isSelected = selectedCalendarIds.some((selectedId) =>
      areSameCalendarId(selectedId, calendarId, primaryRealId),
    )
    if (!isSelected) {
      return NextResponse.json({ ok: true, synced: false, reason: 'calendar_not_selected' })
    }
    // Read-only / freeBusy calendars can't host writes. We look up the metadata
    // first by the literal calendarId; if absent and we're targeting "primary",
    // fall back to whichever metadata entry is flagged `primary` so the role
    // check still runs (otherwise primary aliases would silently bypass it).
    const metadata = calendarMetadata[calendarId] ?? (calendarId === 'primary'
      ? Object.values(calendarMetadata).find((item) => item?.primary)
      : undefined)
    if (metadata?.accessRole && !isWritableRole(metadata.accessRole)) {
      return NextResponse.json({ ok: true, synced: false, reason: 'calendar_read_only' })
    }
  }
  const gcalPayload = {
    summary: String(eventRow.title ?? ''),
    description: String(eventRow.description ?? eventRow.notes ?? ''),
    location: eventRow.location ? String(eventRow.location) : undefined,
    start: { dateTime: startAt, timeZone: 'Europe/Madrid' },
    end: { dateTime: endAt, timeZone: 'Europe/Madrid' },
  }

  // POST creates a new Google event. PATCH updates an existing one (idempotent re-sync).
  // This prevents duplicates when the same NowCRM event is synced more than once.
  const isUpdate = Boolean(existingGoogleId)
  const gcalUrl = isUpdate
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existingGoogleId!)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`

  let googleEventId: string
  let createdNewGoogleEvent = !isUpdate
  try {
    const gcalRes = await fetch(gcalUrl, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(gcalPayload),
    })
    const gcalData = await gcalRes.json() as { id?: string; error?: { message?: string } }
    // If PATCH on a deleted/missing event fails with 404/410, retry as POST so we recover gracefully.
    if (isUpdate && (gcalRes.status === 404 || gcalRes.status === 410)) {
      console.warn('[sync-event] Existing Google event missing, falling back to POST')
      const retryRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(gcalPayload),
        }
      )
      const retryData = await retryRes.json() as { id?: string; error?: { message?: string } }
      if (!retryRes.ok || !retryData.id) {
        console.error('[sync-event] POST retry failed:', retryData.error?.message)
        return NextResponse.json({ ok: true, synced: false, reason: 'google_api_error' })
      }
      googleEventId = retryData.id
      createdNewGoogleEvent = true
    } else if (!gcalRes.ok || !gcalData.id) {
      const msg = gcalData.error?.message ?? gcalRes.statusText
      console.error(`[sync-event] Google Calendar ${isUpdate ? 'PATCH' : 'POST'} failed:`, msg)
      return NextResponse.json({ ok: true, synced: false, reason: 'google_api_error' })
    } else {
      googleEventId = gcalData.id
    }
  } catch (err) {
    console.error('[sync-event] Google Calendar fetch error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true, synced: false, reason: 'google_fetch_error' })
  }

  // Compatibility patch for older callers; the strict session/RLS confirmation
  // below (run via the authenticated cookie client, NOT the service role) is
  // what decides success.
  try {
    await supabase.from('calendar_events')
      .update({
        google_event_id: googleEventId,
        google_calendar_id: calendarId,
        sync_source: 'crm',
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', eventId)
      .eq('workspace_id', workspaceId)
  } catch {
    // Columns may not exist yet — see SQL below
  }

  const localPatch = await supabase
    .from('calendar_events')
    .update({
      google_event_id: googleEventId,
      google_calendar_id: calendarId,
      sync_source: 'crm',
      google_sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .eq('workspace_id', workspaceId)
    .select('id')

  if (localPatch.error || (localPatch.data?.length ?? 0) === 0) {
    console.error('[sync-event] Local metadata patch failed:', localPatch.error?.message ?? '0 rows updated')
    if (createdNewGoogleEvent) await rollbackGoogleCreate(accessToken, calendarId, googleEventId)
    return NextResponse.json({ ok: true, synced: false, reason: 'local_update_failed' })
  }

  // Update last_sync_at on THIS user's connection only.
  void serviceSupabase.from('google_calendar_connections')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true, synced: true, googleEventId, calendarId })
}
