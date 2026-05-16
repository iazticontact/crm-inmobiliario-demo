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
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
    const probeWrite = new URL(request.url).searchParams.get('probe') === 'write'

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
      .from('google_calendar_connections')
      .select('id, workspace_id, calendar_id, status, sync_enabled, refresh_token_enc, last_sync_at, updated_at')
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
      : !r.refresh_token_enc ? 'missing_refresh_token'
      : r.status !== 'connected' ? `status_is_${String(r.status)}`
      : null

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

    // Optional write probe: proves whether service_role can actually INSERT/UPDATE/DELETE.
    // Refuses to run if a real connection (with refresh_token_enc) exists — never touches live data.
    let probe: Record<string, unknown> | undefined
    if (probeWrite) {
      if (!serviceRoleKey) {
        probe = { ran: false, skipped: 'no_service_role_key' }
      } else if (r?.refresh_token_enc) {
        probe = { ran: false, skipped: 'real_connection_exists' }
      } else {
        const writeClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
        const probePayload = {
          workspace_id: workspaceId,
          calendar_id: 'debug-probe',
          status: 'debug_probe',
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
          .eq('status', 'debug_probe')
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
      hasServiceRole: Boolean(serviceRoleKey),
      hasConnection: Boolean(r),
      status: r?.status ?? null,
      syncEnabled: r?.sync_enabled ?? null,
      hasRefreshToken: Boolean(r?.refresh_token_enc),
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
