// POST /api/integrations/google/calendar/cancel-event
//
// Atomic cancellation for a NowCRM calendar event with optional Google sync.
//
// Behavior:
//   1. Validates user + workspace + event ownership.
//   2. Refuses to touch read-only events (`is_read_only=true`).
//   3. If the event has `google_event_id` AND there's a healthy Google connection:
//        - Deletes the event in Google Calendar (treats 200/204/404/410 as OK).
//        - On Google success → soft-cancels the local row (`status='cancelled'`).
//        - On Google auth failure (401/invalid_grant) → does NOT cancel local; user must reconnect.
//        - On other Google errors → does NOT cancel local; user can retry.
//   4. If there's no Google link → just soft-cancels local.
//
// Returns a stable JSON contract with explicit booleans + reason codes, so the UI can
// give an honest message instead of a fake "cancelled" toast.
//
// Never returns tokens. Never logs tokens. Never silently swallows Google failures.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getGoogleCalendarServiceClient } from '../server-utils'
import { selectUserConnection } from '../_user-connection'

export const runtime = 'nodejs'

type CancelReason =
  | 'cancelled'
  | 'already_cancelled'
  | 'not_synced_to_google'
  | 'not_connected'
  | 'credentials_not_configured'
  | 'read_only_event'
  | 'event_not_found'
  | 'needs_reconnect'
  | 'google_forbidden'
  | 'rate_limited'
  | 'google_api_error'
  | 'google_fetch_error'
  | 'local_cancel_failed'

type Result = {
  ok: boolean
  localCancelled: boolean
  googleCancelled: boolean
  googleAlreadyGone: boolean
  calendarIdUsed?: string
  reason: CancelReason
  message: string
  // legacy compatibility for existing callers that only read `synced`
  synced?: boolean
}

function isUuid(value?: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

async function buildSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { /* static */ }
      },
    },
  })
}

function respond(status: number, payload: Result) {
  return NextResponse.json({ ...payload, synced: payload.googleCancelled }, { status })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await buildSupabase()
  if (!supabase) {
    return NextResponse.json({ ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'local_cancel_failed', message: 'Supabase no configurado', synced: false }, { status: 503 })
  }

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'local_cancel_failed', message: 'No autenticado', synced: false }, { status: 401 })
  }

  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) {
    return NextResponse.json({ ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'local_cancel_failed', message: 'Sin workspace asignado', synced: false }, { status: 403 })
  }

  const serviceSupabase = getGoogleCalendarServiceClient()
  if (!serviceSupabase) {
    return NextResponse.json({ ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'local_cancel_failed', message: 'Service role no configurado', synced: false }, { status: 503 })
  }

  let localEventId: string
  try {
    const body = await req.json() as { localEventId?: unknown; eventId?: unknown }
    const raw = (typeof body.localEventId === 'string' ? body.localEventId : typeof body.eventId === 'string' ? body.eventId : '').trim()
    localEventId = raw
  } catch {
    return NextResponse.json({ ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'local_cancel_failed', message: 'Body JSON inválido', synced: false }, { status: 400 })
  }
  if (!localEventId) {
    return NextResponse.json({ ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'local_cancel_failed', message: 'localEventId requerido', synced: false }, { status: 400 })
  }
  if (!isUuid(localEventId)) {
    return NextResponse.json({ ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'local_cancel_failed', message: 'localEventId inválido', synced: false }, { status: 400 })
  }

  // Fetch the local event up-front so we can decide what to do
  const { data: eventRow, error: fetchErr } = await supabase
    .from('calendar_events')
    .select('id, title, status, google_event_id, google_calendar_id, is_read_only')
    .eq('id', localEventId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (fetchErr) {
    console.error('[google/cancel-event:fetch] error', fetchErr.message)
    return respond(500, { ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'local_cancel_failed', message: 'Error leyendo el evento' })
  }
  if (!eventRow) {
    return respond(404, { ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'event_not_found', message: 'Evento no encontrado en NowCRM' })
  }

  if (eventRow.is_read_only === true) {
    return respond(200, { ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'read_only_event', message: 'Este evento viene de un calendario de Google de solo lectura. Cancélalo desde Google Calendar.' })
  }

  const wasAlreadyCancelled = String(eventRow.status ?? '') === 'cancelled'
  const googleEventId = (eventRow.google_event_id as string | null | undefined) ?? undefined
  console.log('[google/cancel-event:start]', { localEventId, hasGoogleEventId: Boolean(googleEventId), wasAlreadyCancelled })

  // Local-only path: no Google link → just cancel local.
  if (!googleEventId) {
    const localOk = await softCancelLocal(supabase, localEventId, workspaceId)
    if (!localOk) {
      return respond(500, { ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'local_cancel_failed', message: 'No se pudo cancelar el evento en NowCRM' })
    }
    return respond(200, {
      ok: true,
      localCancelled: true,
      googleCancelled: false,
      googleAlreadyGone: false,
      reason: wasAlreadyCancelled ? 'already_cancelled' : 'not_synced_to_google',
      message: 'Evento cancelado en NowCRM (no estaba sincronizado con Google).',
    })
  }

  // Google path. Need THIS user's healthy connection (workspace_id + user_id).
  let connection
  try {
    connection = await selectUserConnection<{
      status: string | null
      calendar_id: string | null
      default_calendar_id: string | null
      refresh_token_enc: string | null
    }>(
      serviceSupabase,
      workspaceId,
      user.id,
      'status, calendar_id, default_calendar_id, refresh_token_enc',
    )
  } catch (err) {
    console.error('[cancel-event] DB read failed:', err instanceof Error ? err.message : err)
    return respond(500, {
      ok: false,
      localCancelled: false,
      googleCancelled: false,
      googleAlreadyGone: false,
      reason: 'local_cancel_failed',
      message: 'No se pudo leer la conexión Google del usuario.',
    })
  }
  if (connection.schemaPending) {
    return respond(503, {
      ok: false,
      localCancelled: false,
      googleCancelled: false,
      googleAlreadyGone: false,
      reason: 'not_connected',
      message: 'Aplica calendar_user_level_v1.sql para gestionar el calendario por usuario.',
    })
  }
  const gcConn = connection.row
  if (!gcConn || gcConn.status !== 'connected' || !gcConn.refresh_token_enc) {
    // No active Google connection → cancel local only and tell the user.
    const localOk = await softCancelLocal(supabase, localEventId, workspaceId)
    return respond(localOk ? 200 : 500, {
      ok: localOk,
      localCancelled: localOk,
      googleCancelled: false,
      googleAlreadyGone: false,
      reason: 'not_connected',
      message: localOk
        ? 'Evento cancelado en NowCRM. Google Calendar no está conectado — reconéctalo desde Configuración para que NowCRM borre allí también.'
        : 'No se pudo cancelar en NowCRM ni en Google.',
    })
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    const localOk = await softCancelLocal(supabase, localEventId, workspaceId)
    return respond(localOk ? 200 : 500, {
      ok: localOk,
      localCancelled: localOk,
      googleCancelled: false,
      googleAlreadyGone: false,
      reason: 'credentials_not_configured',
      message: localOk
        ? 'Evento cancelado en NowCRM. Faltan credenciales de Google en el servidor para borrarlo en Google.'
        : 'No se pudo cancelar en NowCRM y faltan credenciales de Google.',
    })
  }

  const calendarId =
    (eventRow.google_calendar_id as string | null) ||
    (gcConn.default_calendar_id as string | null) ||
    (gcConn.calendar_id as string | null) ||
    'primary'

  console.log('[google/cancel-event:calendar-id]', { calendarId, source: eventRow.google_calendar_id ? 'event' : gcConn.default_calendar_id ? 'connection_default' : gcConn.calendar_id ? 'connection_primary' : 'fallback' })

  // Refresh access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: String(gcConn.refresh_token_enc),
      grant_type: 'refresh_token',
    }),
  })
  const tokenData = await tokenRes.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string }
  if (!tokenRes.ok || !tokenData.access_token) {
    const errorCode = String(tokenData.error ?? '')
    console.error('[google/cancel-event:token-refresh] failed', { status: tokenRes.status, error: errorCode })
    if (errorCode === 'invalid_grant') {
      return respond(200, {
        ok: false,
        localCancelled: false,
        googleCancelled: false,
        googleAlreadyGone: false,
        calendarIdUsed: calendarId,
        reason: 'needs_reconnect',
        message: 'Google rechazó la sesión. Reconecta Google Calendar desde Configuración y vuelve a cancelar.',
      })
    }
    return respond(200, {
      ok: false,
      localCancelled: false,
      googleCancelled: false,
      googleAlreadyGone: false,
      calendarIdUsed: calendarId,
      reason: 'google_api_error',
      message: 'No se pudo refrescar la sesión de Google. Inténtalo otra vez en unos minutos.',
    })
  }
  const accessToken = tokenData.access_token

  // DELETE in Google
  let googleStatus = 0
  let googleAlreadyGone = false
  try {
    const gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    )
    googleStatus = gcalRes.status
    console.log('[google/cancel-event:google-delete]', { status: googleStatus, calendarId })

    if (gcalRes.ok || googleStatus === 204) {
      // Deleted in Google
    } else if (googleStatus === 404 || googleStatus === 410) {
      googleAlreadyGone = true
    } else if (googleStatus === 401) {
      return respond(200, { ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, calendarIdUsed: calendarId, reason: 'needs_reconnect', message: 'Google ha invalidado la sesión. Reconecta Google Calendar.' })
    } else if (googleStatus === 403) {
      return respond(200, { ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, calendarIdUsed: calendarId, reason: 'google_forbidden', message: 'Google no permite borrar este evento (puede ser de un calendario de solo lectura).' })
    } else if (googleStatus === 429) {
      return respond(200, { ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, calendarIdUsed: calendarId, reason: 'rate_limited', message: 'Google está limitando peticiones (429). Inténtalo en unos minutos.' })
    } else {
      return respond(200, { ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, calendarIdUsed: calendarId, reason: 'google_api_error', message: `Google devolvió ${googleStatus}. NowCRM no canceló el evento para evitar inconsistencia.` })
    }
  } catch (err) {
    console.error('[google/cancel-event:google-delete] fetch error', err instanceof Error ? err.message : err)
    return respond(200, { ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, calendarIdUsed: calendarId, reason: 'google_fetch_error', message: 'No se pudo contactar con Google. Inténtalo otra vez.' })
  }

  // Google succeeded (or 404/410): now soft-cancel local with sync metadata
  const localOk = await softCancelLocal(supabase, localEventId, workspaceId, googleAlreadyGone ? 'deleted_from_google' : 'cancelled')
  console.log('[google/cancel-event:result]', { localOk, googleStatus, googleAlreadyGone })

  if (!localOk) {
    return respond(500, {
      ok: false,
      localCancelled: false,
      googleCancelled: true,
      googleAlreadyGone,
      calendarIdUsed: calendarId,
      reason: 'local_cancel_failed',
      message: 'Borrado en Google pero NowCRM no pudo marcar el evento como cancelado. Refresca la página.',
    })
  }

  return respond(200, {
    ok: true,
    localCancelled: true,
    googleCancelled: true,
    googleAlreadyGone,
    calendarIdUsed: calendarId,
    reason: 'cancelled',
    message: googleAlreadyGone
      ? 'Evento cancelado en NowCRM. En Google ya no existía (borrado desde fuera).'
      : 'Evento cancelado en NowCRM y en Google Calendar.',
  })
}

// Soft-cancel: set status='cancelled' + google_sync_status. Verifies row count.
async function softCancelLocal(
  supabase: Awaited<ReturnType<typeof buildSupabase>>,
  eventId: string,
  workspaceId: string,
  googleSyncStatus: 'cancelled' | 'deleted_from_google' = 'cancelled',
): Promise<boolean> {
  if (!supabase) return false
  const patch: Record<string, unknown> = {
    status: 'cancelled',
    google_sync_status: googleSyncStatus,
    last_synced_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('calendar_events')
    .update(patch)
    .eq('id', eventId)
    .eq('workspace_id', workspaceId)
    .select('id')

  if (error) {
    console.error('[google/cancel-event:local-cancel] update error', error.message)
    // Retry without google_sync_status in case the column type rejects the value
    const { data: data2, error: error2 } = await supabase
      .from('calendar_events')
      .update({ status: 'cancelled' })
      .eq('id', eventId)
      .eq('workspace_id', workspaceId)
      .select('id')
    if (error2) {
      console.error('[google/cancel-event:local-cancel] fallback update error', error2.message)
      return false
    }
    return (data2?.length ?? 0) > 0
  }
  return (data?.length ?? 0) > 0
}
