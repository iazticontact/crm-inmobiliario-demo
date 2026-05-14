import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

// Google Calendar OAuth callback — exchanges authorization code for tokens.
//
// Production checklist:
//   1. Verify `state` param matches the user.id stored when the flow was initiated (CSRF)
//   2. Exchange `code` for tokens via POST https://oauth2.googleapis.com/token
//      — include: client_id, client_secret, redirect_uri, code, grant_type=authorization_code
//   3. Store refresh_token in `google_calendar_connections` (server-side only, never sent to client)
//   4. Store access_token temporarily (expires in 1h) — never expose to browser
//   5. Set row status = 'connected' and update last_sync_at
//   6. Redirect user back to /settings?integration=google_calendar&status=connected
//
// Security: GOOGLE_CLIENT_SECRET must never appear in any response body or client-side code.

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
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
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
      // Credentials not yet configured — mark as pending and redirect
      return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=pending&reason=not_configured`)
    }

    // TODO (production): exchange code for tokens
    // const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    //   body: new URLSearchParams({
    //     client_id: clientId,
    //     client_secret: clientSecret,
    //     redirect_uri: redirectUri,
    //     code,
    //     grant_type: 'authorization_code',
    //   }),
    // })
    // const tokens = await tokenRes.json()
    // if (!tokenRes.ok || !tokens.refresh_token) { ... handle error ... }
    //
    // Store refresh_token in google_calendar_connections (server-side only):
    // await supabase.from('google_calendar_connections').upsert({
    //   workspace_id: workspaceId,
    //   refresh_token_enc: encrypt(tokens.refresh_token), // encrypt before storing
    //   access_token_hash: hash(tokens.access_token),
    //   status: 'connected',
    //   last_sync_at: new Date().toISOString(),
    // }, { onConflict: 'workspace_id' })

    // Placeholder: credentials configured but exchange not yet implemented
    return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=pending&reason=token_exchange_not_implemented`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[google/calendar/callback]', msg.slice(0, 100))
    return NextResponse.redirect(`${settingsUrl}?integration=google_calendar&status=error&reason=server_error`)
  }
}
