// POST /api/integrations/google/calendar/import-events
// Imports events from the selected Google Calendars into calendar_events.
// Multi-calendar aware: loops over selected_calendar_ids from the connection
// (falls back to legacy calendar_id if the new column isn't present yet).
// Dedupe is per (workspace, google_calendar_id, google_event_id).
// Never exposes tokens. All Google API calls happen server-side.

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getGoogleCalendarServiceClient } from '../server-utils'

export const runtime = 'nodejs'

type ImportResult =
  | {
      ok: true
      imported: number
      updated: number
      skipped: number
      skippedAllDay: number
      cancelled: number
      calendars: { id: string; summary?: string; imported: number; updated: number; cancelled: number; error?: string }[]
      lastSyncAt: string
    }
  | { ok: true; imported: 0; updated: 0; skipped: 0; reason: string }
  | { ok: false; error: string }

type GoogleEvent = {
  id?: string
  summary?: string
  description?: string
  location?: string
  status?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

type GoogleCalendarListEntry = {
  id?: string
  summary?: string
  summaryOverride?: string
  primary?: boolean
  accessRole?: string
  backgroundColor?: string
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
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { /* static */ }
      },
    },
  })
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
    console.error('[import-events] Token refresh failed:', data.error)
    return null
  }
  return data.access_token
}

// Convert Google Calendar event to a calendar_events insert row.
// Returns null for all-day events (no dateTime) or already-cancelled events.
function googleEventToRow(
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

  // Parse date + time components in Europe/Madrid timezone
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
  }
}

async function fetchCalendarsMetadata(accessToken: string): Promise<Record<string, GoogleCalendarListEntry>> {
  const out: Record<string, GoogleCalendarListEntry> = {}
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false&minAccessRole=reader', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return out
    const data = await res.json() as { items?: GoogleCalendarListEntry[] }
    for (const item of data.items ?? []) {
      if (item.id) out[String(item.id)] = item
    }
  } catch {
    /* ignore — calendars stay unresolved */
  }
  return out
}

export async function POST(): Promise<NextResponse<ImportResult>> {
  const supabase = await buildSupabase()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })
  }

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })
  }

  // Read connection — try the wide select first (multi-calendar schema), fall back to legacy.
  const serviceSupabase = getGoogleCalendarServiceClient()
  if (!serviceSupabase) {
    return NextResponse.json({ ok: false, error: 'Service role no configurado' }, { status: 503 })
  }

  let connRow: Record<string, unknown> | null = null
  {
    const wide = await serviceSupabase
      .from('google_calendar_connections')
      .select('status, calendar_id, refresh_token_enc, selected_calendar_ids')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!wide.error) {
      connRow = (wide.data as Record<string, unknown> | null)
    } else {
      const narrow = await serviceSupabase
        .from('google_calendar_connections')
        .select('status, calendar_id, refresh_token_enc')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
      connRow = (narrow.data as Record<string, unknown> | null)
    }
  }

  if (!connRow || connRow.status !== 'connected' || !connRow.refresh_token_enc) {
    return NextResponse.json({ ok: true, imported: 0, updated: 0, skipped: 0, reason: 'no_google_connection' })
  }

  const accessToken = await refreshAccessToken(String(connRow.refresh_token_enc))
  if (!accessToken) {
    return NextResponse.json({ ok: true, imported: 0, updated: 0, skipped: 0, reason: 'token_refresh_failed' })
  }

  // Determine which calendars to sync
  let calendarIds: string[] = []
  const rawSelected = connRow.selected_calendar_ids
  if (Array.isArray(rawSelected)) {
    calendarIds = rawSelected.filter((v): v is string => typeof v === 'string')
  } else if (typeof rawSelected === 'string') {
    try {
      const parsed = JSON.parse(rawSelected)
      if (Array.isArray(parsed)) calendarIds = parsed.filter((v): v is string => typeof v === 'string')
    } catch { /* invalid JSON */ }
  }
  if (calendarIds.length === 0) {
    const legacy = (connRow.calendar_id as string | null) || 'primary'
    calendarIds = [legacy]
  }

  // Fetch calendar metadata once — used to resolve accessRole (read-only) and summary
  const calendarMetadata = await fetchCalendarsMetadata(accessToken)

  // Load existing google_event_ids for THIS workspace, scoped per calendar.
  // Key: `${calendarId}|${googleEventId}` → localId
  const { data: existingRows } = await supabase
    .from('calendar_events')
    .select('id, google_event_id, google_calendar_id')
    .eq('workspace_id', workspaceId)
    .not('google_event_id', 'is', null)

  const existingMap = new Map<string, string>()
  for (const row of existingRows ?? []) {
    if (!row.google_event_id) continue
    const cid = (row.google_calendar_id as string | null) ?? 'primary'
    existingMap.set(`${cid}|${row.google_event_id}`, String(row.id))
  }

  const timeMin = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const timeMax = new Date(Date.now() + 90 * 86_400_000).toISOString()

  let totalImported = 0
  let totalUpdated = 0
  let totalSkipped = 0
  let totalSkippedAllDay = 0
  let totalCancelled = 0
  const perCalendar: { id: string; summary?: string; imported: number; updated: number; cancelled: number; error?: string }[] = []

  for (const calendarId of calendarIds) {
    const meta = calendarMetadata[calendarId]
    const accessRole = String(meta?.accessRole ?? 'reader')
    const isReadOnly = accessRole === 'reader' || accessRole === 'freeBusyReader'

    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin,
      timeMax,
      maxResults: '250',
      showDeleted: 'true', // we want to see status:'cancelled' so we can soft-cancel locally
    })

    let googleEvents: GoogleEvent[] = []
    try {
      const gcalRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      const gcalData = await gcalRes.json() as { items?: GoogleEvent[]; error?: { message?: string } }
      if (!gcalRes.ok) {
        console.error(`[import-events] Google API error for ${calendarId}:`, gcalData.error?.message)
        perCalendar.push({ id: calendarId, summary: meta?.summary, imported: 0, updated: 0, cancelled: 0, error: 'google_api_error' })
        continue
      }
      googleEvents = gcalData.items ?? []
    } catch (err) {
      console.error(`[import-events] Fetch error for ${calendarId}:`, err instanceof Error ? err.message : err)
      perCalendar.push({ id: calendarId, summary: meta?.summary, imported: 0, updated: 0, cancelled: 0, error: 'google_fetch_error' })
      continue
    }

    const toInsert: Record<string, unknown>[] = []
    const toUpdate: { localId: string; row: Record<string, unknown> }[] = []
    const toCancel: string[] = []
    let calImported = 0
    let calUpdated = 0
    let calCancelled = 0

    for (const gEvent of googleEvents) {
      if (!gEvent.id) {
        totalSkipped++
        continue
      }
      const key = `${calendarId}|${gEvent.id}`
      const existingLocalId = existingMap.get(key)

      if (gEvent.status === 'cancelled') {
        // Soft cancel the local row if we already had it
        if (existingLocalId) toCancel.push(existingLocalId)
        else totalSkipped++ // never had it locally, ignore
        continue
      }

      const row = googleEventToRow(gEvent, workspaceId, calendarId, isReadOnly)
      if (!row) {
        if (gEvent.start?.date && !gEvent.start?.dateTime) totalSkippedAllDay++
        else totalSkipped++
        continue
      }

      if (existingLocalId) {
        const updateFields = Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'workspace_id'))
        toUpdate.push({ localId: existingLocalId, row: updateFields })
      } else {
        toInsert.push(row)
      }
    }

    // Insert: try with all columns; if schema error, strip optional columns one by one
    if (toInsert.length > 0) {
      const optionalCols = ['start_at', 'end_at', 'start_hour', 'start_minute', 'duration', 'description', 'location', 'sync_source', 'google_event_id', 'google_calendar_id', 'last_synced_at', 'is_read_only']
      let rows = toInsert
      for (let attempt = 0; attempt <= optionalCols.length; attempt++) {
        const { data, error } = await supabase.from('calendar_events').insert(rows).select('id')
        if (!error) { calImported = data?.length ?? rows.length; break }
        const colMatch = error.message?.match(/column "([^"]+)" of relation/)
        const colHint = error.message?.match(/"([^"]+)" does not exist/)
        const missingCol = colMatch?.[1] ?? colHint?.[1]
        if (missingCol && optionalCols.includes(missingCol)) {
          rows = rows.map((r) => { const copy = { ...r }; delete copy[missingCol]; return copy })
        } else {
          console.error('[import-events] Insert error:', error.message)
          break
        }
      }
    }

    // Update existing rows
    for (const { localId, row } of toUpdate) {
      const { error } = await supabase
        .from('calendar_events')
        .update(row)
        .eq('id', localId)
        .eq('workspace_id', workspaceId)
      if (!error) calUpdated++
      else if (process.env.NODE_ENV === 'development') {
        // is_read_only might not exist yet — retry without it
        const stripped = { ...row }
        delete stripped.is_read_only
        const retry = await supabase.from('calendar_events').update(stripped).eq('id', localId).eq('workspace_id', workspaceId)
        if (!retry.error) calUpdated++
        else console.warn('[import-events] Update error for', localId, error.message)
      }
    }

    // Soft-cancel events that Google reports as cancelled
    for (const localId of toCancel) {
      const { error } = await supabase
        .from('calendar_events')
        .update({ status: 'cancelled', google_sync_status: 'deleted_from_google', last_synced_at: new Date().toISOString() })
        .eq('id', localId)
        .eq('workspace_id', workspaceId)
      if (!error) calCancelled++
      else if (process.env.NODE_ENV === 'development') {
        // google_sync_status might not exist — retry minimal
        const retry = await supabase.from('calendar_events').update({ status: 'cancelled' }).eq('id', localId).eq('workspace_id', workspaceId)
        if (!retry.error) calCancelled++
      }
    }

    totalImported += calImported
    totalUpdated += calUpdated
    totalCancelled += calCancelled
    perCalendar.push({ id: calendarId, summary: meta?.summary, imported: calImported, updated: calUpdated, cancelled: calCancelled })
  }

  // Update last_sync_at on connection
  const lastSyncAt = new Date().toISOString()
  void serviceSupabase.from('google_calendar_connections')
    .update({ last_sync_at: lastSyncAt })
    .eq('workspace_id', workspaceId)

  return NextResponse.json({
    ok: true,
    imported: totalImported,
    updated: totalUpdated,
    skipped: totalSkipped,
    skippedAllDay: totalSkippedAllDay,
    cancelled: totalCancelled,
    calendars: perCalendar,
    lastSyncAt,
  })
}
