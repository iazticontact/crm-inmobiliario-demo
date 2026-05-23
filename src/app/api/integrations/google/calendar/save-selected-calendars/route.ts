// POST /api/integrations/google/calendar/save-selected-calendars
//
// Saves which Google calendars the CURRENT user wants to sync. Strictly scoped
// by (workspace_id, user_id) — saving Patricia's selection never touches Fran.
// Refuses when the BD hasn't been migrated to user-level (no silent fallback).
//
// Body: { selectedCalendarIds: string[]; calendarMetadata?: object; syncEnabled?: boolean }

import { NextRequest, NextResponse } from 'next/server'
import { getGoogleCalendarServiceClient } from '../server-utils'
import {
  resolveCalendarAuth,
  selectUserConnection,
  updateUserConnection,
  upsertUserConnection,
} from '../_user-connection'

export const runtime = 'nodejs'

type Result =
  | { ok: true; saved: string[] }
  | { ok: false; error: string; reason?: string }

export async function POST(req: NextRequest): Promise<NextResponse<Result>> {
  const auth = await resolveCalendarAuth()
  if ('ok' in auth && auth.ok === false) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }
  if (!('userId' in auth)) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const admin = getGoogleCalendarServiceClient()
  if (!admin) return NextResponse.json({ ok: false, error: 'Service role no configurado' }, { status: 503 })

  let selectedCalendarIds: string[]
  let calendarMetadata: Record<string, unknown> | undefined
  let syncEnabled: boolean | undefined
  try {
    const body = await req.json() as { selectedCalendarIds?: unknown; calendarMetadata?: unknown; syncEnabled?: unknown }
    if (!Array.isArray(body.selectedCalendarIds)) {
      return NextResponse.json({ ok: false, error: 'selectedCalendarIds requerido' }, { status: 400 })
    }
    selectedCalendarIds = body.selectedCalendarIds
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .slice(0, 50)
    if (selectedCalendarIds.length === 0) {
      return NextResponse.json({ ok: false, error: 'Debes seleccionar al menos un calendario' }, { status: 400 })
    }
    if (body.calendarMetadata && typeof body.calendarMetadata === 'object') {
      calendarMetadata = body.calendarMetadata as Record<string, unknown>
    }
    if (typeof body.syncEnabled === 'boolean') {
      syncEnabled = body.syncEnabled
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {
    selected_calendar_ids: selectedCalendarIds,
    calendar_metadata: calendarMetadata ?? {},
    calendar_id: selectedCalendarIds[0],
  }
  if (syncEnabled !== undefined) patch.sync_enabled = syncEnabled

  // Check if the current user already has a row. If so, update; if not, upsert
  // a minimal row (status=pending) so the user can pre-select calendars before
  // OAuth completes. Upsert uses ON CONFLICT (workspace_id, user_id).
  let existing
  try {
    existing = await selectUserConnection<{ id: string | null }>(
      admin,
      auth.workspaceId,
      auth.userId,
      'id',
    )
  } catch (err) {
    console.error('[save-selected-calendars] read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'No se pudo leer la conexión' }, { status: 500 })
  }

  if (existing.schemaPending) {
    return NextResponse.json({
      ok: false,
      reason: 'schema_pending_migration',
      error: 'Aplica la migración calendar_user_level_v1.sql para activar la conexión individual.',
    }, { status: 503 })
  }

  if (existing.row) {
    const result = await updateUserConnection(admin, auth.workspaceId, auth.userId, patch)
    if (!result.ok) {
      if ('schemaPending' in result) {
        return NextResponse.json({
          ok: false,
          reason: 'schema_pending_migration',
          error: 'Aplica la migración calendar_user_level_v1.sql para activar la conexión individual.',
        }, { status: 503 })
      }
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
    }
    return NextResponse.json({ ok: true, saved: selectedCalendarIds })
  }

  // No row yet — create one in pending state.
  const inserted = await upsertUserConnection(admin, auth.workspaceId, auth.userId, {
    ...patch,
    status: 'pending',
  })
  if (!inserted.ok) {
    if ('schemaPending' in inserted) {
      return NextResponse.json({
        ok: false,
        reason: 'schema_pending_migration',
        error: 'Aplica la migración calendar_user_level_v1.sql para activar la conexión individual.',
      }, { status: 503 })
    }
    return NextResponse.json({ ok: false, error: inserted.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true, saved: selectedCalendarIds })
}
