import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getGoogleCalendarServiceClient } from '../server-utils'

export const runtime = 'nodejs'

// POST /api/integrations/google/calendar/disconnect
//
// Properly disconnects Google Calendar for the current user's workspace:
//   1. Reads the stored refresh_token (best-effort).
//   2. Tries to revoke it at https://oauth2.googleapis.com/revoke — best-effort, doesn't fail
//      the disconnect if Google is unreachable or token already invalid.
//   3. Clears refresh_token_enc, calendar_id, selected_calendar_ids, calendar_metadata,
//      sync_enabled and last_sync_at — leaves the row with status='disconnected' so the
//      status route can report it correctly without a pending OAuth state.
//
// Uses SERVICE_ROLE_KEY so the cleanup works with hardened RLS. There is no
// SSR fallback because the base table contains OAuth tokens.
export async function POST() {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      },
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

    const workspaceId = profile?.workspace_id as string | null | undefined
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: 'Workspace no encontrado' }, { status: 404 })
    }

    const writeClient = getGoogleCalendarServiceClient()
    if (!writeClient) {
      return NextResponse.json({ ok: false, error: 'Service role no configurado' }, { status: 503 })
    }

    // 1. Read current refresh_token (best-effort).
    const { data: existing } = await writeClient
      .from('google_calendar_connections')
      .select('id, refresh_token_enc')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    const refreshToken = (existing as { refresh_token_enc?: string | null } | null)?.refresh_token_enc

    // 2. Best-effort revoke at Google. Never blocks disconnect if it fails.
    let revoked: 'ok' | 'failed' | 'skipped' = 'skipped'
    if (refreshToken) {
      try {
        const revokeRes = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        revoked = revokeRes.ok ? 'ok' : 'failed'
        if (!revokeRes.ok) {
          const body = await revokeRes.text().catch(() => '')
          console.warn('[google/calendar/disconnect] Revoke non-200', { status: revokeRes.status, bodyPreview: body.slice(0, 120) })
        }
      } catch (err) {
        revoked = 'failed'
        console.warn('[google/calendar/disconnect] Revoke threw', err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120))
      }
    }

    // 3. Clear stored credentials and selection. Keep the row so audit/history is preserved.
    const now = new Date().toISOString()
    const clearPayload: Record<string, unknown> = {
      status: 'disconnected',
      sync_enabled: false,
      refresh_token_enc: null,
      calendar_id: null,
      last_sync_at: null,
      updated_at: now,
    }

    // Try wide update first (multi-calendar columns); fall back if those columns don't exist yet.
    let updateErr: { code?: string; message?: string } | null = null
    {
      const wide = await writeClient
        .from('google_calendar_connections')
        .update({ ...clearPayload, selected_calendar_ids: null, calendar_metadata: null })
        .eq('workspace_id', workspaceId)

      if (wide.error) {
        const code = String(wide.error.code ?? '')
        // 42703 = undefined_column → legacy schema, retry without multi-calendar cols.
        if (code === '42703') {
          const narrow = await writeClient
            .from('google_calendar_connections')
            .update(clearPayload)
            .eq('workspace_id', workspaceId)
          updateErr = narrow.error ?? null
        } else {
          updateErr = wide.error
        }
      }
    }

    if (updateErr) {
      console.error('[google/calendar/disconnect] Update failed', {
        code: updateErr.code,
        message: updateErr.message?.slice(0, 120),
        hasServiceRole: true,
      })
      return NextResponse.json(
        { ok: false, error: 'No se pudo limpiar la conexión en la base de datos', revoked },
        { status: 500 },
      )
    }

    console.info('[google/calendar/disconnect] Cleared connection for workspace', workspaceId, 'revoked:', revoked)
    return NextResponse.json({ ok: true, revoked, connectionExisted: Boolean(existing) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[google/calendar/disconnect]', msg.slice(0, 120))
    return NextResponse.json({ ok: false, error: 'Error al desconectar Google Calendar' }, { status: 500 })
  }
}
