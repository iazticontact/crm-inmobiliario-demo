// GET /api/integrations/google/calendar/callback
//
// OAuth callback for Google Calendar.
//   - state nonce comes from a single-use httpOnly cookie (see _oauth-state.ts).
//   - user_id is resolved from the cookie payload AND re-checked against the
//     current Supabase session — both must match.
//   - workspace_id is taken from the cookie payload (issued by /connect) and
//     re-validated against the user's current profile.
//   - The connection row is upserted with ON CONFLICT (workspace_id, user_id)
//     so distinct users never overwrite each other.
//   - When the BD doesn't yet have the user_id column, the callback redirects
//     to /settings with reason=schema_pending_migration. We do NOT fall back
//     to workspace-level writes.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getGoogleCalendarServiceClient } from '../server-utils'
import { consumeOAuthState, safeEquals } from '../_oauth-state'
import { selectUserConnection, upsertUserConnection } from '../_user-connection'
import { parseConnectionForSync, runIncrementalSync } from '../_sync-engine'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000'
  const settingsUrl = `${appOrigin}/settings`
  const redirectTo = (reason: string, status: 'connected' | 'error' | 'pending' = 'error') =>
    NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=${status}${status === 'connected' ? '' : `&reason=${encodeURIComponent(reason)}`}`)

  // Consume the OAuth state cookie regardless of outcome (single-use).
  const statePayload = await consumeOAuthState()

  if (error) {
    console.warn('[google/calendar/callback] OAuth error from Google:', error)
    return redirectTo(error)
  }
  if (!code || !state) return redirectTo('missing_params')
  if (!statePayload) return redirectTo('state_mismatch')
  if (!safeEquals(state, statePayload.nonce)) return redirectTo('state_mismatch')

  try {
    // Re-authenticate from the cookie — the OAuth flow must come from the same
    // browser session that initiated it.
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(list) {
            try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { /* static */ }
          },
        },
      },
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return redirectTo('unauthenticated')

    // The current session MUST match the user_id we issued the state for.
    if (user.id !== statePayload.userId) return redirectTo('state_mismatch')

    // workspace_id from current profile must also match the one issued in /connect.
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', user.id)
      .maybeSingle()
    const workspaceId = profile?.workspace_id as string | null | undefined
    if (!workspaceId) return redirectTo('no_workspace')
    if (workspaceId !== statePayload.workspaceId) return redirectTo('state_mismatch')

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
    const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()
    if (!clientId || !clientSecret || !redirectUri) return redirectTo('not_configured', 'pending')

    const writeClient = getGoogleCalendarServiceClient()
    if (!writeClient) return redirectTo('missing_service_role')

    // Exchange the code for tokens. access_token is transient and never persisted.
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
      error_description?: string
    }
    if (!tokenRes.ok) {
      console.error('[google/calendar/callback] Token exchange failed:', tokenData.error)
      return redirectTo('token_exchange_failed')
    }

    const now = new Date().toISOString()
    const tokenExpiry = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString()

    // No refresh_token means Google didn't grant offline access for this user.
    // Strategy: if THIS user already had a row with a refresh_token, keep it
    // (re-auth without offline grant should not lose the token). Otherwise we
    // can't proceed — ask the user to revoke + reconnect.
    if (!tokenData.refresh_token) {
      const existing = await selectUserConnection<{ refresh_token_enc: string | null }>(
        writeClient,
        workspaceId,
        user.id,
        'refresh_token_enc',
      )
      if (existing.schemaPending) return redirectTo('schema_pending_migration')

      const existingToken = existing.row?.refresh_token_enc
      if (!existingToken) return redirectTo('no_refresh_token')

      const reuse = await upsertUserConnection(writeClient, workspaceId, user.id, {
        calendar_id: 'primary',
        token_expiry: tokenExpiry,
        status: 'connected',
        sync_enabled: true,
        last_sync_at: now,
      })
      if (!reuse.ok) {
        if ('schemaPending' in reuse) return redirectTo('schema_pending_migration')
        console.error('[google/calendar/callback] upsert reuse failed:', reuse.error)
        return redirectTo('db_upsert_failed')
      }

      console.info('[google/calendar/callback] Reconnected reusing stored refresh_token for current user')
      await runInitialSync(writeClient, supabase, workspaceId, user.id)
      return redirectTo('connected', 'connected')
    }

    // Store the new refresh_token scoped to (workspace_id, user_id).
    const persist = await upsertUserConnection(writeClient, workspaceId, user.id, {
      calendar_id: 'primary',
      refresh_token_enc: tokenData.refresh_token,
      token_expiry: tokenExpiry,
      status: 'connected',
      sync_enabled: true,
      last_sync_at: now,
    })
    if (!persist.ok) {
      if ('schemaPending' in persist) return redirectTo('schema_pending_migration')
      console.error('[google/calendar/callback] upsert failed:', persist.error)
      return redirectTo('db_upsert_failed')
    }

    console.info('[google/calendar/callback] Connection stored for current user')
    await runInitialSync(writeClient, supabase, workspaceId, user.id)
    return redirectTo('connected', 'connected')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[google/calendar/callback]', msg.slice(0, 200))
    return redirectTo('server_error')
  }
}

// Best-effort initial sync after OAuth. Awaited so the user lands on /settings
// with events already imported, but any failure is logged and swallowed — we
// never block the redirect on Google API hiccups (the user can press
// "Actualizar ahora" or re-open /calendar later to retry).
async function runInitialSync(
  serviceClient: ReturnType<typeof getGoogleCalendarServiceClient>,
  eventsClient: SupabaseClient,
  workspaceId: string,
  userId: string,
) {
  if (!serviceClient) return
  try {
    const refreshed = await selectUserConnection<Record<string, unknown>>(
      serviceClient,
      workspaceId,
      userId,
      'refresh_token_enc, selected_calendar_ids, incremental_sync_tokens, calendar_id',
    )
    if (refreshed.schemaPending || !refreshed.row) return
    const parsed = parseConnectionForSync(refreshed.row)
    if (!parsed.refreshToken) return
    const result = await runIncrementalSync({
      workspaceId,
      userId,
      serviceClient,
      eventsClient,
      refreshToken: parsed.refreshToken,
      selectedCalendarIds: parsed.selectedCalendarIds,
      incrementalSyncTokens: parsed.incrementalSyncTokens,
    })
    if (result.ok) {
      console.info('[google/calendar/callback] initial sync ok', {
        imported: result.imported,
        updated: result.updated,
        cancelled: result.cancelled,
        calendars: result.calendars.length,
      })
    } else {
      console.warn('[google/calendar/callback] initial sync skipped:', result.reason)
    }
  } catch (err) {
    console.warn('[google/calendar/callback] initial sync error:', err instanceof Error ? err.message : err)
  }
}
