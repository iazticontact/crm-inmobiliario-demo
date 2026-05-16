import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { GoogleCalendarConnectionConfig, GoogleCalendarConnectionStatus } from '@/lib/types'

export const runtime = 'nodejs'

function deriveStatus(row: Record<string, unknown>): GoogleCalendarConnectionStatus {
  const s = String(row.status ?? '')
  // Only report 'connected' when a refresh_token is actually stored — without it we cannot sync
  if (s === 'connected' && row.refresh_token_enc) return 'connected'
  if (s === 'connected') return 'error'  // status=connected but token missing
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

    // Try the wide select (multi-calendar columns), fall back to legacy if columns don't exist yet.
    let row: Record<string, unknown> | null = null
    let rowErr: { message?: string } | null = null
    {
      const wide = await supabase
        .from('google_calendar_connections')
        .select('id, workspace_id, calendar_id, status, sync_enabled, refresh_token_enc, last_sync_at, updated_at, selected_calendar_ids, calendar_metadata')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
      if (!wide.error) {
        row = (wide.data as Record<string, unknown> | null)
      } else {
        const narrow = await supabase
          .from('google_calendar_connections')
          .select('id, workspace_id, calendar_id, status, sync_enabled, refresh_token_enc, last_sync_at, updated_at')
          .eq('workspace_id', workspaceId)
          .maybeSingle()
        row = (narrow.data as Record<string, unknown> | null)
        rowErr = narrow.error ?? null
      }
    }

    console.log('[google/status]', {
      hasUser: Boolean(user),
      userId: user.id?.slice(0, 8),
      workspaceId,
      foundConnection: Boolean(row),
      status: (row as Record<string, unknown> | null)?.status,
      syncEnabled: (row as Record<string, unknown> | null)?.sync_enabled,
      hasRefreshToken: Boolean((row as Record<string, unknown> | null)?.refresh_token_enc),
      rowErr: rowErr?.message,
    })

    if (!row) {
      const config: GoogleCalendarConnectionConfig = {
        workspaceId,
        provider: 'google_calendar',
        connectionStatus: 'not_configured',
      }
      return NextResponse.json({ ok: true, connection: config })
    }

    // Multi-calendar fields (may not exist in legacy schema — both default to safe values)
    let selectedCalendarIds: string[] | undefined
    const rawSelected = row.selected_calendar_ids
    if (Array.isArray(rawSelected)) {
      selectedCalendarIds = rawSelected.filter((v): v is string => typeof v === 'string')
    } else if (typeof rawSelected === 'string') {
      try {
        const parsed = JSON.parse(rawSelected)
        if (Array.isArray(parsed)) selectedCalendarIds = parsed.filter((v): v is string => typeof v === 'string')
      } catch { /* invalid JSON */ }
    }
    let calendarMetadata: Record<string, { summary?: string; accessRole?: string; backgroundColor?: string; primary?: boolean }> | undefined
    const rawMeta = row.calendar_metadata
    if (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
      calendarMetadata = rawMeta as Record<string, { summary?: string; accessRole?: string; backgroundColor?: string; primary?: boolean }>
    }

    const config: GoogleCalendarConnectionConfig = {
      id: String(row.id ?? ''),
      workspaceId,
      provider: 'google_calendar',
      calendarId: row.calendar_id ? String(row.calendar_id) : undefined,
      connectionStatus: deriveStatus(row as Record<string, unknown>),
      lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : undefined,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined,
      selectedCalendarIds,
      calendarMetadata,
    }

    return NextResponse.json({ ok: true, connection: config })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[google/calendar/status]', msg.slice(0, 100))
    return NextResponse.json({ ok: false, error: 'Error al leer estado de Google Calendar' }, { status: 500 })
  }
}
