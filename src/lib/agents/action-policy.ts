// Token de POLÍTICA DE ACCIÓN (P65) — firmado HMAC-SHA256 con AGENT_TOOL_SECRET, prefijo `act.` para que
// un token de LECTURA jamás sirva para escribir (y viceversa). Claims sin secretos ni PII.

import { createHmac, timingSafeEqual, createHash, randomUUID } from 'crypto'

export type ActionPolicyClaims = {
  v: 1
  kind: 'action'
  actionId: string
  actionType: string
  workspaceId: string
  entityId: string | null
  previewHash: string
  idempotencyKey: string
  confirmed: boolean
  iat: number
  exp: number
}

const b64u = (s: Buffer | string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

function mac(data: string, secret: string): string {
  return b64u(createHmac('sha256', secret).update(data).digest())
}

export function signActionToken(claims: Omit<ActionPolicyClaims, 'v' | 'kind' | 'iat' | 'exp'>, secret: string, ttlMs = 10 * 60 * 1000): string {
  const now = Date.now()
  const full: ActionPolicyClaims = { v: 1, kind: 'action', ...claims, iat: now, exp: now + ttlMs }
  const payload = b64u(JSON.stringify(full))
  return `act.${payload}.${mac(payload, secret)}`
}

export type ActionTokenResult = { ok: true; claims: ActionPolicyClaims } | { ok: false; reason: 'missing' | 'not_action_token' | 'bad_signature' | 'expired' | 'malformed' }

export function verifyActionToken(token: string | null | undefined, secret: string): ActionTokenResult {
  if (!token) return { ok: false, reason: 'missing' }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'act') return { ok: false, reason: 'not_action_token' }
  const [, payload, sig] = parts
  const expected = mac(payload, secret)
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' }
  try {
    const claims = JSON.parse(fromB64u(payload)) as ActionPolicyClaims
    if (claims.kind !== 'action' || claims.v !== 1) return { ok: false, reason: 'not_action_token' }
    if (typeof claims.exp !== 'number' || Date.now() > claims.exp) return { ok: false, reason: 'expired' }
    return { ok: true, claims }
  } catch { return { ok: false, reason: 'malformed' } }
}

// Hash estable del preview (estado actual + cambios propuestos) — si algo cambia, el hash no cuadra.
export function previewHashOf(currentState: Record<string, unknown>, proposedChanges: Record<string, unknown>): string {
  const stable = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))
  return createHash('sha256').update(stable(currentState) + '|' + stable(proposedChanges)).digest('hex').slice(0, 32)
}

export function newIdempotencyKey(): string { return randomUUID() }
