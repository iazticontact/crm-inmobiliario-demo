// POST /api/integrations/google/calendar/import-events
//
// Runs an incremental Google Calendar sync for the CURRENT user, scoped strictly
// by (workspace_id, user_id). Delegates the actual sync work to the shared
// engine in `_sync-engine.ts` so this route, `save-selected-calendars` and
// `callback` all behave identically.
//
// Behaviour:
//   - If we have a stored `incremental_sync_tokens[calendarId]`, use it.
//   - If Google returns 410 GONE, fall back to a full sync over [-30d, +90d].
//   - Pagination via `nextPageToken`.
//   - Persists `nextSyncToken` per calendarId.
//   - Soft-cancels Google `status='cancelled'` events instead of deleting rows.
//   - Never exposes tokens.

import { NextResponse } from 'next/server'
import { getGoogleCalendarServiceClient } from '../server-utils'
import { resolveCalendarAuth, selectUserConnection } from '../_user-connection'
import { parseConnectionForSync, runIncrementalSync } from '../_sync-engine'

export const runtime = 'nodejs'

type ImportResult =
  | {
      ok: true
      imported: number
      updated: number
      skipped: number
      skippedAllDay: number
      cancelled: number
      calendars: { id: string; summary?: string; imported: number; updated: number; cancelled: number; fullResync: boolean; hadSyncToken: boolean; criticalFailure: boolean; error?: string }[]
      lastSyncAt: string
      partialFailure: boolean
      failedCalendars: string[]
    }
  | { ok: true; imported: 0; updated: 0; skipped: 0; reason: string }
  | { ok: false; error: string }

export async function POST(): Promise<NextResponse<ImportResult>> {
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

  let connection
  try {
    connection = await selectUserConnection<Record<string, unknown>>(
      admin,
      auth.workspaceId,
      auth.userId,
      'status, calendar_id, refresh_token_enc, selected_calendar_ids, incremental_sync_tokens',
    )
  } catch (err) {
    console.error('[import-events] DB read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'No se pudo leer la conexión' }, { status: 500 })
  }
  if (connection.schemaPending) {
    return NextResponse.json({ ok: false, error: 'Aplica calendar_user_level_v1.sql para sincronizar por usuario.' }, { status: 503 })
  }
  const connRow = connection.row
  if (!connRow || connRow.status !== 'connected' || !connRow.refresh_token_enc) {
    return NextResponse.json({ ok: true, imported: 0, updated: 0, skipped: 0, reason: 'no_google_connection' })
  }

  const parsed = parseConnectionForSync(connRow)
  if (!parsed.refreshToken) {
    return NextResponse.json({ ok: true, imported: 0, updated: 0, skipped: 0, reason: 'no_refresh_token' })
  }

  const result = await runIncrementalSync({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    serviceClient: admin,
    refreshToken: parsed.refreshToken,
    selectedCalendarIds: parsed.selectedCalendarIds,
    incrementalSyncTokens: parsed.incrementalSyncTokens,
  })

  if (!result.ok) {
    if (result.reason === 'token_refresh_failed') {
      return NextResponse.json({ ok: true, imported: 0, updated: 0, skipped: 0, reason: 'token_refresh_failed' })
    }
    if (result.reason === 'no_calendars') {
      return NextResponse.json({ ok: true, imported: 0, updated: 0, skipped: 0, reason: 'no_calendars_selected' })
    }
    return NextResponse.json({ ok: true, imported: 0, updated: 0, skipped: 0, reason: result.reason })
  }

  return NextResponse.json({
    ok: true,
    imported: result.imported,
    updated: result.updated,
    skipped: result.skipped,
    skippedAllDay: result.skippedAllDay,
    cancelled: result.cancelled,
    calendars: result.calendars,
    lastSyncAt: result.lastSyncAt,
    partialFailure: result.partialFailure,
    failedCalendars: result.failedCalendars,
  })
}
