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
    if (authErr || !user) {
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=unauthenticated`)
    }

    // Verify state matches the user who initiated the flow (CSRF protection)
    if (state !== user.id) {
      console.warn('[google/calendar/callback] State mismatch — possible CSRF')
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

    if (!tokenRes.ok) {
      console.error('[google/calendar/callback] Token exchange failed:', tokenData.error, tokenData.error_description)
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=token_exchange_failed`)
    }

    if (!tokenData.refresh_token) {
      // Google only issues a refresh_token on first consent or when prompt=consent is forced.
      // If missing, the user must revoke Google access at myaccount.google.com and reconnect.
      console.warn('[google/calendar/callback] No refresh_token in response — user must revoke and reconnect')
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=no_refresh_token`)
    }

    // Get workspace_id for this user
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', user.id)
      .maybeSingle()

    const workspaceId = profile?.workspace_id as string | null | undefined
    if (!workspaceId) {
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=no_workspace`)
    }

    const now = new Date().toISOString()
    const tokenExpiry = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString()

    // Use service role key if available so the upsert bypasses RLS in the redirect context.
    // User identity is already verified above via session + state param.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    const writeClient = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : supabase

    // Store connection. refresh_token_enc is plaintext for now — TODO: encrypt at rest before production.
    // access_token is intentionally NOT stored; it is re-obtained on each sync via refresh_token.
    const { error: upsertErr } = await writeClient
      .from('google_calendar_connections')
      .upsert(
        {
          workspace_id: workspaceId,
          calendar_id: 'primary',
          refresh_token_enc: tokenData.refresh_token,
          token_expiry: tokenExpiry,
          status: 'connected',
          sync_enabled: true,
          last_sync_at: now,
          updated_at: now,
        },
        { onConflict: 'workspace_id' }
      )

    if (upsertErr) {
      console.error('[google/calendar/callback] Supabase upsert failed:', upsertErr.message)
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=db_error`)
    }

    console.info('[google/calendar/callback] Connection stored for workspace', workspaceId)
    return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=connected`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[google/calendar/callback]', msg.slice(0, 100))
    return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=server_error`)
  }
}
