// POST /api/integrations/google/calendar/disconnect
//
// Disconnects Google Calendar for the CURRENT user only. The query is
// strictly scoped by (workspace_id, user_id) so disconnecting Patricia
// never touches Fran's connection.
//   1. Read this user's refresh_token (server-side, never returned).
//   2. Best-effort revoke at Google.
//   3. Clear credentials and mark status='disconnected' for that user.
// Refuses to operate if the schema hasn't been migrated to user-level —
// otherwise we'd be disconnecting the shared workspace token and locking
// out other members.

import { NextResponse } from 'next/server'
import { getGoogleCalendarServiceClient } from '../server-utils'
import {
  resolveCalendarAuth,
  selectUserConnection,
  updateUserConnection,
} from '../_user-connection'

export const runtime = 'nodejs'

type ConnectionRow = {
  id: string | null
  refresh_token_enc: string | null
}

export async function POST() {
  const auth = await resolveCalendarAuth()
  if ('ok' in auth && auth.ok === false) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }
  if (!('userId' in auth)) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const admin = getGoogleCalendarServiceClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Service role no configurado' }, { status: 503 })
  }

  let existing
  try {
    existing = await selectUserConnection<ConnectionRow>(
      admin,
      auth.workspaceId,
      auth.userId,
      'id, refresh_token_enc',
    )
  } catch (err) {
    console.error('[google/disconnect] DB read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'No se pudo leer la conexión actual' }, { status: 500 })
  }

  if (existing.schemaPending) {
    return NextResponse.json({
      ok: false,
      reason: 'schema_pending_migration',
      error: 'La desconexión individual requiere aplicar la migración calendar_user_level_v1.sql en Supabase.',
    }, { status: 503 })
  }

  const refreshToken = existing.row?.refresh_token_enc ?? null

  // Best-effort revoke. Never blocks the disconnect.
  let revoked: 'ok' | 'failed' | 'skipped' = 'skipped'
  if (refreshToken) {
    try {
      const revokeRes = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      revoked = revokeRes.ok ? 'ok' : 'failed'
      if (!revokeRes.ok) {
        console.warn('[google/disconnect] Revoke non-200', { status: revokeRes.status })
      }
    } catch (err) {
      revoked = 'failed'
      console.warn('[google/disconnect] Revoke threw', err instanceof Error ? err.message.slice(0, 120) : '')
    }
  }

  // If there was no row for this user, return ok quietly.
  if (!existing.row) {
    return NextResponse.json({ ok: true, revoked, connectionExisted: false })
  }

  const clearPayload: Record<string, unknown> = {
    status: 'disconnected',
    sync_enabled: false,
    refresh_token_enc: null,
    calendar_id: null,
    last_sync_at: null,
    selected_calendar_ids: null,
    calendar_metadata: null,
  }

  const result = await updateUserConnection(admin, auth.workspaceId, auth.userId, clearPayload)
  if (!result.ok) {
    if ('schemaPending' in result) {
      return NextResponse.json({
        ok: false,
        reason: 'schema_pending_migration',
        error: 'La desconexión individual requiere aplicar la migración calendar_user_level_v1.sql en Supabase.',
      }, { status: 503 })
    }
    console.error('[google/disconnect] update failed:', result.error)
    return NextResponse.json({ ok: false, error: 'No se pudo limpiar la conexión', revoked }, { status: 500 })
  }

  return NextResponse.json({ ok: true, revoked, connectionExisted: true })
}
