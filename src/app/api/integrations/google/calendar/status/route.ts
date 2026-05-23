// GET /api/integrations/google/calendar/status
//
// Returns the Google Calendar connection status of the CURRENT user. Never
// returns tokens. Scoped by (workspace_id, user_id). When the BD doesn't
// yet have the user_id column, we surface schema_pending_migration so the
// UI can show an honest banner instead of pretending we're connected.

import { NextResponse } from 'next/server'
import type { GoogleCalendarConnectionConfig, GoogleCalendarConnectionStatus } from '@/lib/types'
import { getGoogleCalendarServiceClient } from '../server-utils'
import { resolveCalendarAuth, selectUserConnection } from '../_user-connection'

export const runtime = 'nodejs'

type ConnectionRow = {
  id?: string
  status?: string
  calendar_id?: string | null
  default_calendar_id?: string | null
  sync_enabled?: boolean
  refresh_token_enc?: string | null
  last_sync_at?: string | null
  updated_at?: string | null
  selected_calendar_ids?: unknown
  calendar_metadata?: unknown
}

function deriveStatus(row: ConnectionRow): GoogleCalendarConnectionStatus {
  const s = String(row.status ?? '')
  if (s === 'disconnected') return 'disconnected'
  const hasRefresh = typeof row.refresh_token_enc === 'string' && row.refresh_token_enc.length > 0
  if (s === 'connected' && hasRefresh) return 'connected'
  if (s === 'connected') return 'error'
  if (s === 'token_expired') return 'token_expired'
  if (s === 'error') return 'error'
  if (row.calendar_id) return 'oauth_pending'
  return 'not_configured'
}

export async function GET() {
  const auth = await resolveCalendarAuth()
  if ('ok' in auth && auth.ok === false) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }
  if (!('userId' in auth)) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  // Use service_role to read the base table (members have no SELECT grant
  // on the table itself; only on the public view). We need refresh_token_enc
  // to derive `has_refresh_token` accurately, and we filter strictly by
  // (workspace_id, user_id) — tokens never leave this route.
  const admin = getGoogleCalendarServiceClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Service role no configurado' }, { status: 503 })
  }

  let connection
  try {
    connection = await selectUserConnection<ConnectionRow>(
      admin,
      auth.workspaceId,
      auth.userId,
      'id, status, calendar_id, default_calendar_id, sync_enabled, refresh_token_enc, last_sync_at, updated_at, selected_calendar_ids, calendar_metadata',
    )
  } catch (err) {
    console.error('[google/status] DB read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'No se pudo leer el estado de Google Calendar' }, { status: 500 })
  }

  if (connection.schemaPending) {
    return NextResponse.json({
      ok: false,
      reason: 'schema_pending_migration',
      error: 'La conexión individual requiere aplicar la migración calendar_user_level_v1.sql en Supabase.',
    }, { status: 503 })
  }

  if (!connection.row) {
    const config: GoogleCalendarConnectionConfig = {
      workspaceId: auth.workspaceId,
      provider: 'google_calendar',
      connectionStatus: 'not_configured',
    }
    return NextResponse.json({ ok: true, connection: config })
  }

  const row = connection.row
  let selectedCalendarIds: string[] | undefined
  if (Array.isArray(row.selected_calendar_ids)) {
    selectedCalendarIds = row.selected_calendar_ids.filter((v): v is string => typeof v === 'string')
  } else if (typeof row.selected_calendar_ids === 'string') {
    try {
      const parsed = JSON.parse(row.selected_calendar_ids)
      if (Array.isArray(parsed)) selectedCalendarIds = parsed.filter((v): v is string => typeof v === 'string')
    } catch { /* ignore */ }
  }

  let calendarMetadata: Record<string, { summary?: string; accessRole?: string; backgroundColor?: string; primary?: boolean }> | undefined
  if (row.calendar_metadata && typeof row.calendar_metadata === 'object' && !Array.isArray(row.calendar_metadata)) {
    calendarMetadata = row.calendar_metadata as typeof calendarMetadata
  }

  const config: GoogleCalendarConnectionConfig = {
    id: row.id ? String(row.id) : undefined,
    workspaceId: auth.workspaceId,
    provider: 'google_calendar',
    calendarId: row.calendar_id ? String(row.calendar_id) : undefined,
    connectionStatus: deriveStatus(row),
    lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    selectedCalendarIds,
    calendarMetadata,
  }
  return NextResponse.json({ ok: true, connection: config })
}
