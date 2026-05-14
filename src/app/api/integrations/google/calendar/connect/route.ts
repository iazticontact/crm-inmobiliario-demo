import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

// Placeholder — initiates Google OAuth flow for Google Calendar.
// In production:
//   1. Verify GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are configured server-side
//   2. Build OAuth URL with scopes: https://www.googleapis.com/auth/calendar
//   3. Store a state param (CSRF protection) in the session
//   4. Redirect user to Google consent screen
//   5. Callback at /api/integrations/google/calendar/callback exchanges code for tokens
//   6. Store refresh_token server-side only (never send to client)

const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
]

export async function GET() {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
    const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()

    if (!clientId || !redirectUri) {
      return NextResponse.json({
        ok: false,
        pending: true,
        status: 'not_configured',
        message: 'Google OAuth no configurado en este servidor.',
        requiredVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
        scopes: REQUIRED_SCOPES,
        nextStep: 'Crea un proyecto en Google Cloud Console, configura las credenciales OAuth y añade las variables de entorno al servidor.',
      })
    }

    // Build OAuth URL — redirect user to Google consent screen
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: REQUIRED_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: user.id,
    })

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    return NextResponse.redirect(authUrl)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[google/calendar/connect]', msg.slice(0, 100))
    return NextResponse.json({ ok: false, error: 'Error al iniciar conexión con Google' }, { status: 500 })
  }
}
