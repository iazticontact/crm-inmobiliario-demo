// GET /api/integrations/google/calendar/list-calendars
//
// Lists the Google calendars visible to the CURRENT user, using that user's
// own refresh_token. Scope is strictly (workspace_id, user_id). Never leaks
// tokens to the browser.

import { NextResponse } from 'next/server'
import { getGoogleCalendarServiceClient } from '../server-utils'
import { resolveCalendarAuth, selectUserConnection } from '../_user-connection'

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

  calendars.sort((a, b) => {
    if (a.primary && !b.primary) return -1
    if (!a.primary && b.primary) return 1
    return a.summary.localeCompare(b.summary)
  })

  return NextResponse.json({ ok: true, calendars, defaultCalendarId, selectedCalendarIds: selectedIds })
}
