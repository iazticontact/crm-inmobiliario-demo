// POST /api/integrations/google/calendar/update-event
// PATCHes the Google Calendar event linked to a local calendar_events row.
// Best-effort: always call AFTER local reschedule. If Google fails, local state is unchanged.
// Never exposes tokens.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

type Result =
  | { ok: true; synced: true }
  | { ok: true; synced: false; reason: string }
  | { ok: false; error: string }

function isUuid(value?: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
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

export async function POST(req: NextRequest): Promise<NextResponse<Result>> {
  const supabase = await buildSupabase()
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })

  let localEventId: string
  try {
    const body = await req.json() as { localEventId?: unknown }
    localEventId = typeof body.localEventId === 'string' ? body.localEventId.trim() : ''
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 })
  }
  if (!localEventId) return NextResponse.json({ ok: false, error: 'localEventId requerido' }, { status: 400 })
  if (!isUuid(localEventId)) return NextResponse.json({ ok: false, error: 'localEventId inválido' }, { status: 400 })

  // Fetch local event with all fields needed to rebuild the Google event
  const { data: eventRow } = await supabase
    .from('calendar_events')
    .select('title, start_at, end_at, date, start_hour, start_minute, duration, description, notes, location, google_event_id, google_calendar_id, is_read_only')
    .eq('id', localEventId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!eventRow) return NextResponse.json({ ok: false, error: 'Evento no encontrado' }, { status: 404 })

  if (eventRow.is_read_only === true) {
    return NextResponse.json({ ok: true, synced: false, reason: 'read_only_event' })
  }

  const googleEventId = eventRow.google_event_id as string | null | undefined
  if (!googleEventId) return NextResponse.json({ ok: true, synced: false, reason: 'no_google_event_id' })

  // Build ISO datetimes from start_at or from date+hour fields
  let startDt: string
  let endDt: string
  if (eventRow.start_at && eventRow.end_at) {
    startDt = String(eventRow.start_at)
    endDt = String(eventRow.end_at)
  } else {
    const date = String(eventRow.date ?? '')
    const hour = Number(eventRow.start_hour ?? 10)
    const minute = Number(eventRow.start_minute ?? 0)
    const duration = Number(eventRow.duration ?? 60)
    const start = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`)
    const end = new Date(start.getTime() + duration * 60_000)
    startDt = start.toISOString()
    endDt = end.toISOString()
  }

  // Get Google connection
  const { data: gcConn } = await supabase
    .from('google_calendar_connections')
    .select('status, calendar_id, default_calendar_id, refresh_token_enc')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!gcConn || gcConn.status !== 'connected' || !gcConn.refresh_token_enc) {
    return NextResponse.json({ ok: true, synced: false, reason: 'not_connected' })
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return NextResponse.json({ ok: true, synced: false, reason: 'credentials_not_configured' })

  // Refresh access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: String(gcConn.refresh_token_enc),
      grant_type: 'refresh_token',
    }),
  })
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string }
  if (!tokenRes.ok || !tokenData.access_token) {
    console.error('[update-event] Token refresh failed:', tokenData.error)
    return NextResponse.json({ ok: true, synced: false, reason: 'token_refresh_failed' })
  }
  const accessToken = tokenData.access_token
  const calendarId =
    (eventRow.google_calendar_id as string | null) ||
    (gcConn.default_calendar_id as string | null) ||
    (gcConn.calendar_id as string | null) ||
    'primary'

  // PATCH Google Calendar event
  const patchBody = {
    summary: String(eventRow.title ?? ''),
    description: eventRow.description ? String(eventRow.description) : eventRow.notes ? String(eventRow.notes) : undefined,
    location: eventRow.location ? String(eventRow.location) : undefined,
    start: { dateTime: startDt, timeZone: 'Europe/Madrid' },
    end: { dateTime: endDt, timeZone: 'Europe/Madrid' },
  }

  try {
    const gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      },
    )
    if (!gcalRes.ok) {
      const errData = await gcalRes.json().catch(() => ({})) as { error?: { message?: string } }
      console.error('[update-event] Google PATCH failed:', gcalRes.status, errData.error?.message)
      return NextResponse.json({ ok: true, synced: false, reason: 'google_api_error' })
    }
  } catch (err) {
    console.error('[update-event] Fetch error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true, synced: false, reason: 'google_fetch_error' })
  }

  // Update last_synced_at on local row
  void supabase.from('calendar_events')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', localEventId)
    .eq('workspace_id', workspaceId)

  return NextResponse.json({ ok: true, synced: true })
}
