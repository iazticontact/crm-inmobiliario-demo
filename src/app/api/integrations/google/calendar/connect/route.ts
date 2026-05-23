// GET /api/integrations/google/calendar/connect
//
// Initiates the Google Calendar OAuth flow for the current user. The user's
// workspace is resolved from `profiles.workspace_id`; we never trust query
// params or body to scope the connection.
//
// OAuth `state` is a nonce stored in an httpOnly cookie alongside the
// initiating user_id + workspace_id (see _oauth-state.ts). The callback
// validates the nonce, user, and workspace before persisting tokens.

import { NextResponse } from 'next/server'
import { issueOAuthState } from '../_oauth-state'
import { resolveCalendarAuth } from '../_user-connection'

export const runtime = 'nodejs'

const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
]

export async function GET() {
  const auth = await resolveCalendarAuth()
  if ('ok' in auth && auth.ok === false) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }
  if (!('userId' in auth)) {
    // Defensive — shouldn't happen because resolveCalendarAuth has discriminated returns.
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
      nextStep: 'Configura las credenciales OAuth en el servidor antes de conectar.',
    })
  }

  const stateNonce = await issueOAuthState({ userId: auth.userId, workspaceId: auth.workspaceId })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: REQUIRED_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: stateNonce,
  })

  // No logueamos user_id / workspace_id en claro. Solo el evento.
  console.log('[google/connect] OAuth flow initiated')

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  return NextResponse.redirect(authUrl)
}
