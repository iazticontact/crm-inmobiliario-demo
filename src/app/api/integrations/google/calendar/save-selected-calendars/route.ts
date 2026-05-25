// POST /api/integrations/google/calendar/save-selected-calendars
//
// Saves which Google calendars the CURRENT user wants to sync AND triggers
// an immediate sync of those calendars in the same request. Strictly scoped
// by (workspace_id, user_id) — saving Patricia's selection never touches Fran.
//
// Body: { selectedCalendarIds: string[]; calendarMetadata?: object; syncEnabled?: boolean }
//
// Response (on success):
//   {
//     ok: true,
//     saved: string[],
//     sync: { imported, updated, cancelled, calendars[], lastSyncAt } | { skipped: reason }
//   }
//
// Why sync here:
//   - When the user picks new calendars, those are typically ones we don't have
//     an `incremental_sync_tokens[calendarId]` for yet → full sync window.
//   - When the user drops a calendar, we leave its rows in place but stop
//     pulling new changes; a future cleanup endpoint can prune.
//   - When the user re-saves the same set, the engine uses the stored
//     syncToken and only pulls the delta. Cheap.

import { NextRequest, NextResponse } from 'next/server'
import { getGoogleCalendarServiceClient } from '../server-utils'
import {
  buildCookieClient,
  resolveCalendarAuth,
  selectUserConnection,
  updateUserConnection,
  upsertUserConnection,
} from '../_user-connection'
import {
  parseConnectionForSync,
  runIncrementalSync,
  sanitizeFailedCalendarForWire,
  sanitizeWriteFailureForWire,
  type CalendarSyncSummary,
  type CalendarWriteFailure,
} from '../_sync-engine'
import { dedupeCalendarIds, canonicalCalendarId, getPrimaryCalendarRealId, type CalendarLike } from '@/lib/calendar-primary'

export const runtime = 'nodejs'

type SyncPayload =
  | {
      imported: number
      updated: number
      cancelled: number
      skippedAllDay: number
      lastSyncAt: string
      calendars: Omit<CalendarSyncSummary, 'errorDetail'>[]
      partialFailure: boolean
      failedCalendars: {
        id: string
        summary?: string
        errorCode: string
        reason: string
        retryable: boolean
        operation?: string
        failedEventId?: string
        failedEventTitle?: string
        failedEventStart?: string
        dbErrorCode?: string
      }[]
      safeWriteFailures: Omit<CalendarWriteFailure, 'dbErrorMessage'>[]
    }
  | { skipped: string }

type Result =
  | { ok: true; saved: string[]; sync: SyncPayload }
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
  const eventsClient = await buildCookieClient()
  if (!eventsClient) return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })

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

  // Final defensive normalisation against the "primary" alias bug: collapse
  // ["primary", "user@gmail.com"] into a single canonical entry before we
  // touch the DB. Frontend already does this but we must NEVER trust the
  // wire payload alone — a stale tab or a third-party caller could send
  // duplicates and the engine would then sync the same calendar twice.
  const metadataCalendarsForAlias: CalendarLike[] = calendarMetadata
    ? Object.entries(calendarMetadata)
      .filter(([id]) => typeof id === 'string' && id.length > 0)
      .map(([id, meta]) => ({
        id,
        primary: typeof meta === 'object' && meta !== null && (meta as { primary?: unknown }).primary === true,
      }))
    : []
  const primaryRealIdFromBody = getPrimaryCalendarRealId(metadataCalendarsForAlias)
  selectedCalendarIds = dedupeCalendarIds(selectedCalendarIds, primaryRealIdFromBody)

  // Strip ["primary"] from calendar_metadata when we have the real id so the
  // engine only ever sees one entry per calendar in `calendar_metadata`.
  if (calendarMetadata && primaryRealIdFromBody) {
    if ('primary' in calendarMetadata && primaryRealIdFromBody in calendarMetadata) {
      delete (calendarMetadata as Record<string, unknown>).primary
    }
  }

  // Canonical first id wins for the legacy `calendar_id` column (used when the
  // sync engine has no other hint).
  const firstCanonical = selectedCalendarIds[0]
    ? canonicalCalendarId(selectedCalendarIds[0], primaryRealIdFromBody)
    : 'primary'

  const patch: Record<string, unknown> = {
    selected_calendar_ids: selectedCalendarIds,
    calendar_metadata: calendarMetadata ?? {},
    calendar_id: firstCanonical,
  }
  if (syncEnabled !== undefined) patch.sync_enabled = syncEnabled

  let existing
  try {
    existing = await selectUserConnection<{ id: string | null; refresh_token_enc?: string | null; selected_calendar_ids?: unknown; incremental_sync_tokens?: unknown; calendar_id?: string | null }>(
      admin,
      auth.workspaceId,
      auth.userId,
      'id, refresh_token_enc, selected_calendar_ids, incremental_sync_tokens, calendar_id',
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
  } else {
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
  }

  // Trigger sync immediately so the user doesn't have to press "Sincronizar".
  const refreshToken = existing.row?.refresh_token_enc
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return NextResponse.json({ ok: true, saved: selectedCalendarIds, sync: { skipped: 'no_refresh_token' } })
  }

  // Read the freshly-written row so we sync over the calendars the user just picked
  // (not the previous selection).
  const refreshed = await selectUserConnection<Record<string, unknown>>(
    admin,
    auth.workspaceId,
    auth.userId,
    'refresh_token_enc, selected_calendar_ids, incremental_sync_tokens, calendar_id',
  )
  const refreshedRow = refreshed.row ?? existing.row
  if (!refreshedRow) {
    return NextResponse.json({ ok: true, saved: selectedCalendarIds, sync: { skipped: 'connection_missing' } })
  }

  const parsed = parseConnectionForSync(refreshedRow)
  if (!parsed.refreshToken) {
    return NextResponse.json({ ok: true, saved: selectedCalendarIds, sync: { skipped: 'no_refresh_token' } })
  }

  const syncResult = await runIncrementalSync({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    serviceClient: admin,
    eventsClient,
    refreshToken: parsed.refreshToken,
    selectedCalendarIds: parsed.selectedCalendarIds,
    incrementalSyncTokens: parsed.incrementalSyncTokens,
  })

  if (!syncResult.ok) {
    return NextResponse.json({ ok: true, saved: selectedCalendarIds, sync: { skipped: syncResult.reason } })
  }

  const calendars = syncResult.calendars.map((c) => {
    const { errorDetail, ...rest } = c
    void errorDetail
    return rest
  })

  return NextResponse.json({
    ok: true,
    saved: selectedCalendarIds,
    sync: {
      imported: syncResult.imported,
      updated: syncResult.updated,
      cancelled: syncResult.cancelled,
      skippedAllDay: syncResult.skippedAllDay,
      lastSyncAt: syncResult.lastSyncAt,
      calendars,
      partialFailure: syncResult.partialFailure,
      failedCalendars: syncResult.failedCalendars.map(sanitizeFailedCalendarForWire),
      safeWriteFailures: syncResult.safeWriteFailures.map(sanitizeWriteFailureForWire),
    },
  })
}
