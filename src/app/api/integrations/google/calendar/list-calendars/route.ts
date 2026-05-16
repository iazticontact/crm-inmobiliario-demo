// GET /api/integrations/google/calendar/list-calendars
// Lists the Google calendars visible to the connected workspace user.
// Returns a slim view: { id, summary, primary, accessRole, backgroundColor, selected }.
// Never exposes tokens. Falls back gracefully if the schema doesn't yet have
// selected_calendar_ids / calendar_metadata columns — see docs/google-calendar-multi-calendar.sql.

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

type CalendarItem = {
  id: string
  summary: string
  primary: boolean
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader' | string
  backgroundColor?: string
  foregroundColor?: string
  selected: boolean
}

type Result =
  | { ok: true; calendars: CalendarItem[]; defaultCalendarId: string; selectedCalendarIds: string[] }
  | { ok: true; calendars: []; reason: string }
  | { ok: false; error: string }

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
    console.error('[list-calendars] Token refresh failed:', data.error)
    return null
  }
  return data.access_token
}

export async function GET(): Promise<NextResponse<Result>> {
  const supabase = await buildSupabase()
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })

  // Read connection — tolerate missing selected_calendar_ids column (legacy schema).
  let connRow: Record<string, unknown> | null = null
  // Try the wide select first, fall back to the legacy columns if the wide select fails
  // because selected_calendar_ids hasn't been added yet.
  {
    const wide = await supabase
      .from('google_calendar_connections')
      .select('status, calendar_id, refresh_token_enc, selected_calendar_ids, calendar_metadata')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!wide.error) {
      connRow = (wide.data as Record<string, unknown> | null)
    } else {
      const narrow = await supabase
        .from('google_calendar_connections')
        .select('status, calendar_id, refresh_token_enc')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
      connRow = (narrow.data as Record<string, unknown> | null)
    }
  }

  if (!connRow || connRow.status !== 'connected' || !connRow.refresh_token_enc) {
    return NextResponse.json({ ok: true, calendars: [], reason: 'no_google_connection' })
  }

  const accessToken = await refreshAccessToken(String(connRow.refresh_token_enc))
  if (!accessToken) return NextResponse.json({ ok: true, calendars: [], reason: 'token_refresh_failed' })

  // Fetch calendarList from Google
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

  // Compute selectedCalendarIds. If the column exists, use it. Otherwise fall back to
  // the single calendar_id stored on the connection (legacy mode).
  let selectedIds: string[] = []
  const rawSelected = connRow.selected_calendar_ids
  if (Array.isArray(rawSelected)) {
    selectedIds = rawSelected.filter((v): v is string => typeof v === 'string')
  } else if (typeof rawSelected === 'string') {
    try {
      const parsed = JSON.parse(rawSelected)
      if (Array.isArray(parsed)) selectedIds = parsed.filter((v): v is string => typeof v === 'string')
    } catch { /* invalid JSON, fallthrough */ }
  }
  if (selectedIds.length === 0) {
    const legacy = connRow.calendar_id ? String(connRow.calendar_id) : 'primary'
    selectedIds = [legacy]
  }

  // Build slim view
  const calendars: CalendarItem[] = []
  let defaultCalendarId = 'primary'
  for (const item of items) {
    if (!item.id || item.deleted) continue
    const id = String(item.id)
    if (item.primary) defaultCalendarId = id
    calendars.push({
      id,
      summary: String(item.summaryOverride || item.summary || id),
      primary: Boolean(item.primary),
      accessRole: String(item.accessRole ?? 'reader'),
      backgroundColor: item.backgroundColor ? String(item.backgroundColor) : undefined,
      foregroundColor: item.foregroundColor ? String(item.foregroundColor) : undefined,
      selected: selectedIds.includes(id) || (selectedIds.includes('primary') && Boolean(item.primary)),
    })
  }

  // Sort: primary first, then by summary
  calendars.sort((a, b) => {
    if (a.primary && !b.primary) return -1
    if (!a.primary && b.primary) return 1
    return a.summary.localeCompare(b.summary)
  })

  return NextResponse.json({ ok: true, calendars, defaultCalendarId, selectedCalendarIds: selectedIds })
}
