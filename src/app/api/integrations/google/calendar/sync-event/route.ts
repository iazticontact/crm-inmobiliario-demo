// POST /api/integrations/google/calendar/sync-event
// Server-side only. Reads refresh_token from google_calendar_connections, obtains a fresh
// access_token from Google, inserts the event in Google Calendar, and patches the local
// calendar_events row with the resulting google_event_id.
// Never exposes tokens to the browser — the frontend only receives { synced, reason }.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

type SyncResult =
  | { ok: true; synced: true; googleEventId: string; calendarId: string }
  | { ok: true; synced: false; reason: string }
  | { ok: false; error: string }

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

  // Body
  let eventId: string
  try {
    const body = await req.json() as { eventId?: unknown }
    eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 })
  }
  if (!eventId) {
    return NextResponse.json({ ok: false, error: 'eventId requerido' }, { status: 400 })
  }

  // Check Google Calendar connection
  const { data: gcConn } = await supabase
    .from('google_calendar_connections')
    .select('status, calendar_id, refresh_token_enc, token_expiry')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!gcConn || gcConn.status !== 'connected') {
    return NextResponse.json({ ok: true, synced: false, reason: 'not_connected' })
  }

  const refreshToken = gcConn.refresh_token_enc as string | null
  if (!refreshToken) {
    return NextResponse.json({ ok: true, synced: false, reason: 'no_refresh_token' })
  }

  // Server-side credentials
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: true, synced: false, reason: 'credentials_not_configured' })
  }

  // Load the local calendar event
  const { data: eventRow } = await supabase
    .from('calendar_events')
    .select('id, title, start_at, end_at, description, notes, client_name, location')
    .eq('id', eventId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!eventRow) {
    return NextResponse.json({ ok: false, error: 'Evento no encontrado' }, { status: 404 })
  }

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

    // Update token_expiry (access tokens expire in 1h)
    const expiry = new Date(Date.now() + 3590 * 1000).toISOString()
    void supabase.from('google_calendar_connections').update({ token_expiry: expiry }).eq('workspace_id', workspaceId)
  } catch (err) {
    console.error('[sync-event] Token refresh error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true, synced: false, reason: 'token_refresh_error' })
  }

  // Build Google Calendar event payload
  const calendarId = (gcConn.calendar_id as string | null) || 'primary'
  const startAt = String(eventRow.start_at ?? '')
  const endAt = String(eventRow.end_at ?? '')
  const gcalPayload = {
    summary: String(eventRow.title ?? ''),
    description: String(eventRow.description ?? eventRow.notes ?? ''),
    location: eventRow.location ? String(eventRow.location) : undefined,
    start: { dateTime: startAt, timeZone: 'Europe/Madrid' },
    end: { dateTime: endAt, timeZone: 'Europe/Madrid' },
  }

  // Insert into Google Calendar
  let googleEventId: string
  try {
    const gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(gcalPayload),
      }
    )
    const gcalData = await gcalRes.json() as { id?: string; error?: { message?: string } }
    if (!gcalRes.ok || !gcalData.id) {
      const msg = gcalData.error?.message ?? gcalRes.statusText
      console.error('[sync-event] Google Calendar insert failed:', msg)
      return NextResponse.json({ ok: true, synced: false, reason: 'google_api_error' })
    }
    googleEventId = gcalData.id
  } catch (err) {
    console.error('[sync-event] Google Calendar fetch error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true, synced: false, reason: 'google_fetch_error' })
  }

  // Patch local event with Google metadata — best-effort, sync succeeded regardless
  try {
    await supabase.from('calendar_events')
      .update({
        google_event_id: googleEventId,
        google_calendar_id: calendarId,
        sync_source: 'nowcrm',
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', eventId)
      .eq('workspace_id', workspaceId)
  } catch {
    // Columns may not exist yet — see SQL below
  }

  // Update last_sync_at on the connection
  void supabase.from('google_calendar_connections')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)

  return NextResponse.json({ ok: true, synced: true, googleEventId, calendarId })
}
