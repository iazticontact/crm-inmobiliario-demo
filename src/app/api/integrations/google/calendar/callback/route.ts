import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

// Google Calendar OAuth callback — exchanges authorization code for tokens.
//
// Security notes:
//   - GOOGLE_CLIENT_SECRET never appears in any response body or client-side code.
//   - refresh_token is stored server-side in refresh_token_enc (plaintext for now — TODO: encrypt at rest).
//   - access_token is used transiently and never persisted or sent to the browser.
//   - state param is the user.id used as CSRF protection — adequate for demo; use a random nonce for production.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000'
  const settingsUrl = `${appOrigin}/settings`

  if (error) {
    console.warn('[google/calendar/callback] OAuth error from Google:', error)
    return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    console.warn('[google/calendar/callback] Missing code or state param')
    return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=missing_params`)
  }

  console.log('[google/callback:start]', {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    statePreview: state?.slice(0, 8),
  })

  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(list) {
            try {
              list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
            } catch { /* route handler context */ }
          },
        },
      }
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    console.log('[google/callback:start]', {
      hasUser: Boolean(user),
      userId: user?.id?.slice(0, 8),
      authErr: authErr?.message,
    })

    if (authErr || !user) {
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=unauthenticated`)
    }

    // Verify state matches the user who initiated the flow (CSRF protection)
    if (state !== user.id) {
      console.warn('[google/calendar/callback] State mismatch — possible CSRF', {
        statePreview: state?.slice(0, 8),
        userIdPreview: user.id?.slice(0, 8),
      })
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=state_mismatch`)
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
    const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()

    if (!clientId || !clientSecret || !redirectUri) {
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=pending&reason=not_configured`)
    }

    // Exchange authorization code for tokens
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
      scope?: string
      token_type?: string
      error?: string
      error_description?: string
    }

    console.log('[google/callback:token]', {
      ok: tokenRes.ok,
      hasAccessToken: Boolean(tokenData.access_token),
      hasRefreshToken: Boolean(tokenData.refresh_token),
      expiresIn: tokenData.expires_in,
      error: tokenData.error,
      errorDescription: tokenData.error_description,
    })

    if (!tokenRes.ok) {
      console.error('[google/calendar/callback] Token exchange failed:', tokenData.error, tokenData.error_description)
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=token_exchange_failed`)
    }

    // Get workspace_id for this user (needed for both paths below)
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', user.id)
      .maybeSingle()

    const workspaceId = profile?.workspace_id as string | null | undefined

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    const writeClient = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : supabase
    const writeClientKind: 'service_role' | 'ssr' = serviceRoleKey ? 'service_role' : 'ssr'

    console.log('[google/callback:workspace]', {
      userId: user.id?.slice(0, 8),
      workspaceId,
      hasServiceRole: Boolean(serviceRoleKey),
      writeClientKind,
    })

    if (!workspaceId) {
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=no_workspace`)
    }

    const now = new Date().toISOString()
    const tokenExpiry = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString()

    if (!tokenData.refresh_token) {
      // Google only sends refresh_token on first consent or when prompt=consent forces a new grant.
      // Fallback: if this workspace already has a valid refresh_token in DB, keep it and mark connected.
      const { data: existing } = await writeClient
        .from('google_calendar_connections')
        .select('refresh_token_enc')
        .eq('workspace_id', workspaceId)
        .maybeSingle()

      console.log('[google/callback:no-refresh-token]', {
        hasExistingToken: Boolean((existing as Record<string, unknown> | null)?.refresh_token_enc),
      })

      const existingToken = (existing as Record<string, unknown> | null)?.refresh_token_enc
      if (!existingToken) {
        // No token anywhere — user must fully revoke Google access and reconnect
        console.warn('[google/calendar/callback] No refresh_token from Google and no existing token in DB')
        return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=no_refresh_token`)
      }

      // Reuse the stored refresh_token: just refresh expiry + mark connected
      const { error: upsertErr } = await writeClient
        .from('google_calendar_connections')
        .upsert(
          {
            workspace_id: workspaceId,
            calendar_id: 'primary',
            token_expiry: tokenExpiry,
            status: 'connected',
            sync_enabled: true,
            last_sync_at: now,
            updated_at: now,
          },
          { onConflict: 'workspace_id' }
        )

      if (upsertErr) {
        const errCode = String(upsertErr.code ?? '')
        const errMsg = String(upsertErr.message ?? '').toLowerCase()
        const looksLikeGrantMissing = errCode === '42501' && (errMsg.includes('permission denied for') || errMsg.includes('no permission'))
        const reason = errCode === '42P01' || errCode === '42703' ? 'missing_schema'
          : errCode === '42P10' ? 'missing_unique_index'
          : !serviceRoleKey && errCode === '42501' ? 'missing_service_role'
          : looksLikeGrantMissing ? 'missing_grant'
          : errCode === '42501' ? 'rls_blocked'
          : 'db_upsert_failed'
        console.error('[google/calendar/callback] Upsert failed (fallback)', { reason, hasServiceRole: Boolean(serviceRoleKey), writeClientKind, code: errCode, message: upsertErr.message })
        return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=${reason}`)
      }

      console.info('[google/calendar/callback] Reconnected using existing token for workspace', workspaceId)
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=connected`)
    }

    // Store new refresh_token.
    // refresh_token_enc is plaintext for now — TODO: encrypt at rest before production.
    // access_token is intentionally NOT stored; re-obtained on each sync via refresh_token.
    const upsertPayload = {
      workspace_id: workspaceId,
      calendar_id: 'primary',
      refresh_token_enc: tokenData.refresh_token,
      token_expiry: tokenExpiry,
      status: 'connected',
      sync_enabled: true,
      last_sync_at: now,
      updated_at: now,
    }

    console.log('[google/callback:pre-upsert]', {
      hasServiceRole: Boolean(serviceRoleKey),
      writeClientKind,
      workspaceId,
      hasRefreshTokenToStore: Boolean(tokenData.refresh_token),
      calendarId: upsertPayload.calendar_id,
      statusToStore: upsertPayload.status,
      syncEnabledToStore: upsertPayload.sync_enabled,
      onConflict: 'workspace_id',
    })

    const { error: upsertErr } = await writeClient
      .from('google_calendar_connections')
      .upsert(upsertPayload, { onConflict: 'workspace_id' })

    console.log('[google/callback:upsert-result]', {
      ok: !upsertErr,
      writeClientKind,
      errorCode: upsertErr?.code,
      errorMessage: upsertErr?.message,
      errorDetails: upsertErr?.details,
      errorHint: upsertErr?.hint,
    })

    if (upsertErr) {
      const errCode = String(upsertErr.code ?? '')
      const errMsg = String(upsertErr.message ?? '').toLowerCase()
      // 42501 from PostgreSQL can mean two distinct things:
      //   a) RLS policy denied  → message contains "row-level security" / "rls"
      //   b) Missing GRANT      → message contains "permission denied for table" / "no permission"
      // The fix is different in each case, so we distinguish here.
      const looksLikeGrantMissing = errCode === '42501' && (errMsg.includes('permission denied for') || errMsg.includes('no permission'))
      const reason = errCode === '42P01' || errCode === '42703' ? 'missing_schema'
        : errCode === '42P10' ? 'missing_unique_index'
        : !serviceRoleKey && errCode === '42501' ? 'missing_service_role'
        : looksLikeGrantMissing ? 'missing_grant'
        : errCode === '42501' ? 'rls_blocked'
        : 'db_upsert_failed'
      console.error('[google/calendar/callback] Supabase upsert failed', { reason, hasServiceRole: Boolean(serviceRoleKey), writeClientKind, code: errCode, message: upsertErr.message })
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=${reason}`)
    }

    // Verify the row really landed by reading it back with the same client used to write.
    // Logs only booleans + non-sensitive fields — never the token itself.
    const { data: verify, error: verifyErr } = await writeClient
      .from('google_calendar_connections')
      .select('workspace_id, status, sync_enabled, calendar_id, refresh_token_enc, updated_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    console.log('[google/callback:post-upsert-read]', {
      verifyOk: !verifyErr,
      verifyErrorCode: verifyErr?.code,
      verifyErrorMessage: verifyErr?.message,
      rowFound: Boolean(verify),
      rowStatus: verify?.status ?? null,
      rowSyncEnabled: verify?.sync_enabled ?? null,
      rowCalendarId: verify?.calendar_id ?? null,
      rowHasRefreshToken: Boolean(verify?.refresh_token_enc),
      rowUpdatedAt: verify?.updated_at ?? null,
    })

    console.info('[google/calendar/callback] Connection stored for workspace', workspaceId)
    return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=connected`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[google/calendar/callback]', msg.slice(0, 100))
    return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=server_error`)
  }
}
