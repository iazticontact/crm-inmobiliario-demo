import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { GoogleCalendarConnectionConfig, GoogleCalendarConnectionStatus } from '@/lib/types'

export const runtime = 'nodejs'

function deriveStatus(row: Record<string, unknown>): GoogleCalendarConnectionStatus {
  const s = String(row.status ?? '')
  if (s === 'connected') return 'connected'
  if (s === 'token_expired') return 'token_expired'
  if (s === 'error') return 'error'
  if (row.calendar_id || row.access_token_hash) return 'oauth_pending'
  return 'not_configured'
}

export async function GET() {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', user.id)
      .maybeSingle()

    const workspaceId = profile?.workspace_id
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: 'Workspace no encontrado' }, { status: 404 })
    }

    const { data: row } = await supabase
      .from('google_calendar_connections')
      .select('id, workspace_id, calendar_id, status, last_sync_at, updated_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (!row) {
      const config: GoogleCalendarConnectionConfig = {
        workspaceId,
        provider: 'google_calendar',
        connectionStatus: 'not_configured',
      }
      return NextResponse.json({ ok: true, connection: config })
    }

    const config: GoogleCalendarConnectionConfig = {
      id: String(row.id ?? ''),
      workspaceId,
      provider: 'google_calendar',
      calendarId: row.calendar_id ? String(row.calendar_id) : undefined,
      connectionStatus: deriveStatus(row as Record<string, unknown>),
      lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : undefined,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    }

    return NextResponse.json({ ok: true, connection: config })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[google/calendar/status]', msg.slice(0, 100))
    return NextResponse.json({ ok: false, error: 'Error al leer estado de Google Calendar' }, { status: 500 })
  }
}
