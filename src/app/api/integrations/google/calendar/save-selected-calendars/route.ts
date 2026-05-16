// POST /api/integrations/google/calendar/save-selected-calendars
// Persists which Google calendars the workspace wants to sync.
// Body: { selectedCalendarIds: string[]; calendarMetadata?: Record<string, { summary, accessRole, backgroundColor }> }
// Tolerates legacy schema where selected_calendar_ids / calendar_metadata don't exist —
// falls back to writing primary calendar_id only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

type Result =
  | { ok: true; saved: string[]; mode: 'multi' | 'legacy_single' }
  | { ok: false; error: string }

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

export async function POST(req: NextRequest): Promise<NextResponse<Result>> {
  const supabase = await buildSupabase()
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })

  let selectedCalendarIds: string[]
  let calendarMetadata: Record<string, unknown> | undefined
  try {
    const body = await req.json() as { selectedCalendarIds?: unknown; calendarMetadata?: unknown }
    if (!Array.isArray(body.selectedCalendarIds)) {
      return NextResponse.json({ ok: false, error: 'selectedCalendarIds requerido' }, { status: 400 })
    }
    selectedCalendarIds = body.selectedCalendarIds
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .slice(0, 50) // hard cap
    if (selectedCalendarIds.length === 0) {
      return NextResponse.json({ ok: false, error: 'Debes seleccionar al menos un calendario' }, { status: 400 })
    }
    if (body.calendarMetadata && typeof body.calendarMetadata === 'object') {
      calendarMetadata = body.calendarMetadata as Record<string, unknown>
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 })
  }

  // First, try the wide update (multi-calendar schema). If selected_calendar_ids column
  // doesn't exist yet, fall back to writing the first id to calendar_id (legacy).
  const wide = await supabase
    .from('google_calendar_connections')
    .update({
      selected_calendar_ids: selectedCalendarIds,
      calendar_metadata: calendarMetadata ?? {},
      // Keep calendar_id mirroring the first selected id so legacy code paths still work.
      calendar_id: selectedCalendarIds[0],
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .select('id')

  if (!wide.error) {
    return NextResponse.json({ ok: true, saved: selectedCalendarIds, mode: 'multi' })
  }

  // Legacy fallback: only calendar_id column exists.
  const narrow = await supabase
    .from('google_calendar_connections')
    .update({
      calendar_id: selectedCalendarIds[0],
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .select('id')

  if (narrow.error) {
    console.error('[save-selected-calendars] DB update failed:', narrow.error.message)
    return NextResponse.json({ ok: false, error: 'No se pudo guardar la selección' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, saved: [selectedCalendarIds[0]], mode: 'legacy_single' })
}
