// OAuth state helpers for Google Calendar.
//
// Production model:
//   - `connect/route.ts` generates a cryptographically random nonce, stores
//     it (alongside the initiating user_id and workspace_id) in an httpOnly
//     cookie scoped to /api/integrations/google/calendar/callback, and
//     mirrors the nonce in the OAuth `state` query param.
//   - `callback/route.ts` reads the cookie, asserts that:
//       (a) the nonce in `state` equals the nonce in the cookie,
//       (b) the user_id in the cookie equals auth.getUser().id,
//       (c) the workspace_id in the cookie equals profiles.workspace_id.
//     If any of those fail, the callback aborts with state_mismatch.
//
// Why a cookie rather than `state=user.id`:
//   - Plain user.id is guessable / leakable, so an attacker who knows it
//     can forge a CSRF callback against an authenticated user.
//   - A random nonce in an httpOnly cookie ties the redirect to the same
//     browser session that initiated `connect`, which is what OAuth state
//     is for.
//
// The cookie is bound to the callback path, lives 10 minutes, and is
// cleared in the callback regardless of outcome.

import { cookies } from 'next/headers'

export const OAUTH_STATE_COOKIE = 'gcal_oauth_state'
const COOKIE_PATH = '/api/integrations/google/calendar/callback'
const COOKIE_TTL_SECONDS = 10 * 60

export type OAuthStatePayload = {
  nonce: string
  userId: string
  workspaceId: string
  issuedAt: number
}

function randomNonce(bytes = 32): string {
  // Web Crypto is available in Next.js node runtime (≥ 18).
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(input: string): string | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4)
    return Buffer.from(padded, 'base64').toString('utf8')
  } catch {
    return null
  }
}

/**
 * Issues a fresh OAuth state nonce, stores it (with user/workspace context)
 * in an httpOnly cookie, and returns the value that should be sent as the
 * OAuth `state` query param. The returned string is opaque — it is just the
 * raw nonce. The cookie holds the full structured payload.
 */
export async function issueOAuthState(input: { userId: string; workspaceId: string }): Promise<string> {
  const payload: OAuthStatePayload = {
    nonce: randomNonce(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    issuedAt: Date.now(),
  }
  const cookieStore = await cookies()
  cookieStore.set(OAUTH_STATE_COOKIE, base64UrlEncode(JSON.stringify(payload)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: COOKIE_TTL_SECONDS,
  })
  return payload.nonce
}

/**
 * Consumes the OAuth state cookie. Returns the stored payload if it parses,
 * or null otherwise. Always clears the cookie (single-use), regardless of
 * success — both to prevent replay and to keep the browser tidy.
 */
export async function consumeOAuthState(): Promise<OAuthStatePayload | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(OAUTH_STATE_COOKIE)?.value ?? null
  cookieStore.set(OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: 0,
  })

  if (!raw) return null
  const decoded = base64UrlDecode(raw)
  if (!decoded) return null
  try {
    const parsed = JSON.parse(decoded) as Partial<OAuthStatePayload>
    if (
      typeof parsed.nonce !== 'string' || !parsed.nonce ||
      typeof parsed.userId !== 'string' || !parsed.userId ||
      typeof parsed.workspaceId !== 'string' || !parsed.workspaceId ||
      typeof parsed.issuedAt !== 'number'
    ) return null
    if (Date.now() - parsed.issuedAt > COOKIE_TTL_SECONDS * 1000) return null
    return parsed as OAuthStatePayload
  } catch {
    return null
  }
}

/**
 * Constant-time string comparison so we don't leak timing on the nonce match.
 */
export function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
