// GET /api/debug/google-calendar-connection
// Returns safe metadata about the current user's Google Calendar connection.
// NEVER exposes tokens, secrets, or sensitive data.
// For development and troubleshooting only.
//
// Optional query param `?probe=write` runs a write probe with the service_role
// client to prove whether INSERT/UPDATE/DELETE actually work. It will refuse to
// run if a real connection (with refresh_token_enc) already exists, so it cannot
// damage live data. The probe inserts a marker row, reads it back, and deletes it.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getGoogleCalendarServiceClient } from '../../integrations/google/calendar/server-utils'

export const runtime = 'nodejs'

// Dev-only debug endpoint. Returns 404 in production builds and refuses to run
// unless DEBUG_ROUTES_ENABLED=1 is set on the server (server-side var — never
// NEXT_PUBLIC_*). The ?probe=write path is doubly gated by DEBUG_PROBE_WRITE=1
// because it touches the live table with service_role.
const DEBUG_ROUTES_ENABLED =
  process.env.NODE_ENV !== 'production' && process.env.DEBUG_ROUTES_ENABLED === '1'
const DEBUG_PROBE_WRITE_ALLOWED =
  DEBUG_ROUTES_ENABLED && process.env.DEBUG_PROBE_WRITE === '1'

export async function GET(request: NextRequest) {
  if (!DEBUG_ROUTES_ENABLED) {
    return new NextResponse('Not Found', { status: 404 })
  }
  try {
    const cookieStore = await cookies()
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
    const probeWrite =
      DEBUG_PROBE_WRITE_ALLOWED &&
      new URL(request.url).searchParams.get('probe') === 'write'

    if (!url || !key) {
      return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })
    }

    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* read-only */ },
      },
    })

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({
        ok: false,
        hasUser: false,
        userId: null,
        workspaceId: null,
        hasConnection: false,
        status: null,
        syncEnabled: null,
        hasRefreshToken: null,
        calendarId: null,
        updatedAt: null,
        error: 'No autenticado',
      })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', user.id)
      .maybeSingle()

    const workspaceId = (profile as Record<string, unknown> | null)?.workspace_id as string | null | undefined

    if (!workspaceId) {
      return NextResponse.json({
        ok: true,
        hasUser: true,
        userId: user.id.slice(0, 8) + '…',
        workspaceId: null,
        hasConnection: false,
        status: null,
        syncEnabled: null,
        hasRefreshToken: null,
        calendarId: null,
        updatedAt: null,
        error: 'Workspace no encontrado en profiles',
      })
    }

    const { data: row, error: rowErr } = await supabase
      .from('vw_google_calendar_status')
      .select('id, workspace_id, calendar_id, status, sync_enabled, has_refresh_token, last_sync_at, updated_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (rowErr) {
      const errCode = String(rowErr.code ?? '')
      const diagnosticReason = errCode === '42P01' ? 'table_missing'
        : errCode === '42703' ? 'column_missing'
        : errCode === '42501' ? 'rls_blocked'
        : 'schema_error'
      return NextResponse.json({
        ok: true,
        hasUser: true,
        userId: user.id.slice(0, 8) + '…',
        workspaceId,
        hasConnection: false,
        status: 'schema_error',
        syncEnabled: null,
        hasRefreshToken: null,
        calendarId: null,
        updatedAt: null,
        diagnosticReason,
        error: rowErr.message,
      })
    }

    const r = row as Record<string, unknown> | null

    const diagnosticReason = !r ? 'no_connection'
      : !r.has_refresh_token ? 'missing_refresh_token'
      : r.status !== 'connected' ? `status_is_${String(r.status)}`
      : null

    const writeClient = getGoogleCalendarServiceClient()

    // Optional write probe: proves whether service_role can actually INSERT/UPDATE/DELETE.
    // Refuses to run if a real connection (with refresh_token_enc) exists — never touches live data.
    let probe: Record<string, unknown> | undefined
    if (probeWrite) {
      if (!writeClient) {
        probe = { ran: false, skipped: 'no_service_role_key' }
      } else if (r) {
        probe = { ran: false, skipped: 'connection_row_exists' }
      } else {
        const probePayload = {
          workspace_id: workspaceId,
          calendar_id: 'debug-probe',
          status: 'pending',
          sync_enabled: false,
          updated_at: new Date().toISOString(),
        }
        const insertRes = await writeClient
          .from('google_calendar_connections')
          .upsert(probePayload, { onConflict: 'workspace_id' })
          .select('id, status, calendar_id')
          .maybeSingle()
        const readRes = await writeClient
          .from('google_calendar_connections')
          .select('status, calendar_id')
          .eq('workspace_id', workspaceId)
          .maybeSingle()
        const delRes = await writeClient
          .from('google_calendar_connections')
          .delete()
          .eq('workspace_id', workspaceId)
          .eq('calendar_id', 'debug-probe')
        probe = {
          ran: true,
          insertOk: !insertRes.error,
          insertErrorCode: insertRes.error?.code ?? null,
          insertErrorMessage: insertRes.error?.message ?? null,
          readOk: !readRes.error,
          readRowStatus: readRes.data?.status ?? null,
          readRowCalendarId: readRes.data?.calendar_id ?? null,
          deleteOk: !delRes.error,
          deleteErrorCode: delRes.error?.code ?? null,
          deleteErrorMessage: delRes.error?.message ?? null,
        }
      }
    }

    return NextResponse.json({
      ok: true,
      hasUser: true,
      userId: user.id.slice(0, 8) + '…',
      workspaceId,
      hasServiceRole: Boolean(writeClient),
      hasConnection: Boolean(r),
      status: r?.status ?? null,
      syncEnabled: r?.sync_enabled ?? null,
      hasRefreshToken: Boolean(r?.has_refresh_token),
      calendarId: r?.calendar_id ?? null,
      updatedAt: r?.updated_at ?? null,
      diagnosticReason,
      ...(probe ? { probe } : {}),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ ok: false, error: msg.slice(0, 200) }, { status: 500 })
  }
}
