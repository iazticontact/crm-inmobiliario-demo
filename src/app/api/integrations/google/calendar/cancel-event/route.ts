// POST /api/integrations/google/calendar/cancel-event
// Deletes the Google Calendar event linked to a local calendar_events row.
// Best-effort: always call this AFTER local cancellation. If Google fails, local state is unchanged.
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

  // Fetch the local event to get google_event_id
  const { data: eventRow } = await supabase
    .from('calendar_events')
    .select('google_event_id, google_calendar_id')
    .eq('id', localEventId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const googleEventId = eventRow?.google_event_id as string | null | undefined
  if (!googleEventId) return NextResponse.json({ ok: true, synced: false, reason: 'no_google_event_id' })

  // Get Google connection
  const { data: gcConn } = await supabase
    .from('google_calendar_connections')
    .select('status, calendar_id, refresh_token_enc')
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
    console.error('[cancel-event] Token refresh failed:', tokenData.error)
    return NextResponse.json({ ok: true, synced: false, reason: 'token_refresh_failed' })
  }
  const accessToken = tokenData.access_token
  const calendarId = (eventRow?.google_calendar_id as string | null) || (gcConn.calendar_id as string | null) || 'primary'

  // Delete from Google Calendar
  try {
    const gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    )
    // 204 = success, 404 = already deleted — both are acceptable
    if (!gcalRes.ok && gcalRes.status !== 404) {
      console.error('[cancel-event] Google DELETE failed:', gcalRes.status)
      return NextResponse.json({ ok: true, synced: false, reason: 'google_api_error' })
    }
  } catch (err) {
    console.error('[cancel-event] Fetch error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true, synced: false, reason: 'google_fetch_error' })
  }

  // Update local row: mark google_sync_status
  void supabase.from('calendar_events')
    .update({ google_sync_status: 'cancelled', last_synced_at: new Date().toISOString() })
    .eq('id', localEventId)
    .eq('workspace_id', workspaceId)

  return NextResponse.json({ ok: true, synced: true })
}
