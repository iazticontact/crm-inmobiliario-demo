// GET /api/integrations/google/calendar/team-status
//
// Returns Google Calendar connection status for every member of the caller's
// workspace, with strictly UI-safe data only. Required role is workspace_admin
// (client_admin OR nowlabs_admin); members get 403.
//
// We query the base table google_calendar_connections with service_role —
// NOT the public view — because:
//   1. We need to filter by user_id (the view doesn't expose it yet under the
//      legacy schema).
//   2. We need to detect a missing `user_id` column (schema_pending_migration)
//      to be honest with the UI instead of silently reporting everyone as
//      "not_configured".
//
// The response never includes refresh_token_enc, webhook_channel_id,
// webhook_resource_id, incremental_sync_tokens, default_calendar_id (Google
// internal id) or token_expiry. We expose only:
//   - member id, email, full_name, role (already visible in the team panel)
//   - connected: boolean
//   - lastSyncAt: ISO timestamp or null

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getGoogleCalendarServiceClient } from '../server-utils'

export const runtime = 'nodejs'

const PG_UNDEFINED_COLUMN = '42703'

type Member = {
  id: string
  email: string | null
  full_name: string | null
  role: string
}

type ConnectionRow = {
  user_id?: string | null
  status?: string | null
  refresh_token_enc?: string | null
  last_sync_at?: string | null
}

async function buildCookieClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll() { /* no-op */ },
    },
  })
}

export async function GET() {
  const supabase = await buildCookieClient()
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .maybeSingle()
  const workspaceId = profile?.workspace_id as string | undefined
  const role = String(profile?.role ?? '')
  if (!workspaceId) return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })
  if (!(role === 'client_admin' || role === 'nowlabs_admin')) {
    return NextResponse.json({
      ok: false,
      error: 'No tienes permisos para ver el estado del equipo.',
    }, { status: 403 })
  }

  const admin = getGoogleCalendarServiceClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Service role no configurado' }, { status: 503 })
  }

  // Members of the workspace.
  const { data: members, error: membersErr } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (membersErr) {
    console.error('[team-status] members read failed:', membersErr.message)
    return NextResponse.json({ ok: false, error: 'No se pudieron leer los miembros' }, { status: 500 })
  }

  // Try to read connections with user_id (user-level schema).
  // If the column doesn't exist (42703), respond with modelLevel='workspace'
  // so the UI shows an honest banner instead of silently mis-attributing.
  const wantedColumns = 'user_id, status, refresh_token_enc, last_sync_at'
  const probe = await admin
    .from('google_calendar_connections')
    .select(wantedColumns)
    .eq('workspace_id', workspaceId)

  if (probe.error && String(probe.error.code ?? '') === PG_UNDEFINED_COLUMN) {
    // Legacy workspace-level schema. We do NOT silently report 'shared' anymore:
    // honest answer is that we cannot attribute connections per user yet.
    return NextResponse.json({
      ok: true,
      modelLevel: 'workspace',
      schemaPending: true,
      team: (members ?? []).map((m) => ({
        id: String(m.id ?? ''),
        email: typeof m.email === 'string' ? m.email : null,
        full_name: typeof m.full_name === 'string' ? m.full_name : null,
        role: typeof m.role === 'string' ? m.role : 'member',
        connected: false,
        lastSyncAt: null,
      })),
    })
  }

  if (probe.error) {
    console.error('[team-status] connections read failed:', probe.error.message)
    return NextResponse.json({ ok: false, error: 'No se pudo leer el estado de Google Calendar' }, { status: 500 })
  }

  const connectionsByUser = new Map<string, ConnectionRow>()
  for (const row of (probe.data ?? []) as ConnectionRow[]) {
    if (row.user_id && typeof row.user_id === 'string') {
      connectionsByUser.set(row.user_id, row)
    }
  }

  const team = ((members ?? []) as Member[]).map((m) => {
    const own = connectionsByUser.get(m.id)
    const connected = Boolean(own && own.status === 'connected' && own.refresh_token_enc)
    return {
      id: String(m.id ?? ''),
      email: typeof m.email === 'string' ? m.email : null,
      full_name: typeof m.full_name === 'string' ? m.full_name : null,
      role: typeof m.role === 'string' ? m.role : 'member',
      connected,
      lastSyncAt: own?.last_sync_at ?? null,
    }
  })

  return NextResponse.json({
    ok: true,
    modelLevel: 'user',
    schemaPending: false,
    team,
  })
}
