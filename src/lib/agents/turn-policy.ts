// Turn Policy Token (P51) — token FIRMADO server-side que viaja app → n8n → /api/agent/tool y permite al
// backend IMPONER la decisión del turno (no confiar en que n8n "se porte bien").
//
// Diseño:
//   - Firma HMAC-SHA256 con un secreto SOLO de servidor (nunca NEXT_PUBLIC, nunca en el browser).
//   - El payload NO lleva secretos ni PII: solo la política del turno (dominio, si puede leer/escribir, qué
//     tools se permiten) + ids de correlación + expiración corta.
//   - Verificable e infalsificable: cualquier manipulación invalida la firma.
//   - Expira rápido (por defecto 90 s) para que no sea reutilizable indefinidamente.
//
// sign/verify reciben el secreto como parámetro → PUROS y testeables (los evals usan un secreto fijo).

import { createHmac, timingSafeEqual } from 'node:crypto'

export type TurnPolicyPayload = {
  v: 1
  cid: string            // conversationId
  tid: string            // turnId
  domain: string | null
  read: boolean          // shouldReadData
  write: boolean         // shouldWriteData
  tools: string[]        // allowedTools (nombres lógicos: "clients.read", …)
  iat: number            // issued-at (ms)
  exp: number            // expires-at (ms)
}

export const DEFAULT_TURN_POLICY_TTL_MS = 90_000

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8')
}
function hmac(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function signTurnPolicy(
  input: Omit<TurnPolicyPayload, 'v' | 'iat' | 'exp'> & { ttlMs?: number },
  secret: string,
  nowMs: number = Date.now(),
): string {
  const ttl = typeof input.ttlMs === 'number' && input.ttlMs > 0 ? input.ttlMs : DEFAULT_TURN_POLICY_TTL_MS
  const payload: TurnPolicyPayload = {
    v: 1, cid: input.cid, tid: input.tid, domain: input.domain,
    read: input.read, write: input.write, tools: input.tools,
    iat: nowMs, exp: nowMs + ttl,
  }
  const body = b64urlEncode(JSON.stringify(payload))
  return `${body}.${hmac(body, secret)}`
}

export type VerifyResult =
  | { ok: true; payload: TurnPolicyPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'unsupported_version' }

export function verifyTurnPolicy(token: string, secret: string, nowMs: number = Date.now()): VerifyResult {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' }
  const dot = token.lastIndexOf('.')
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!body || !sig) return { ok: false, reason: 'malformed' }
  if (!safeEqual(sig, hmac(body, secret))) return { ok: false, reason: 'bad_signature' }
  let payload: TurnPolicyPayload
  try {
    payload = JSON.parse(b64urlDecode(body)) as TurnPolicyPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.v !== 1) return { ok: false, reason: 'unsupported_version' }
  if (typeof payload.exp !== 'number' || payload.exp < nowMs) return { ok: false, reason: 'expired' }
  return { ok: true, payload }
}

// Herramientas físicas del endpoint /api/agent/tool → dominio lógico. Las genéricas (crm_read_query,
// get_crm_overview) no fijan dominio: se permiten si el turno autoriza lectura.
const TOOL_DOMAIN: Record<string, string | 'generic'> = {
  search_clients: 'clients', get_client_360: 'clients', get_client_opportunities: 'clients',
  get_client_service_cases: 'clients', get_latest_client: 'clients', get_client_summary: 'clients',
  search_properties: 'properties',
  pipeline_summary: 'operations', get_open_operations: 'operations',
  get_open_service_cases: 'cases',
  get_pending_tasks: 'tasks',
  get_calendar_summary: 'calendar',
  get_documents_metadata: 'documents',
  get_invoices_summary: 'invoicing',
  get_recent_activity: 'generic', get_conversations_summary: 'generic',
  crm_read_query: 'generic', get_crm_overview: 'generic', get_workspace_summary: 'generic',
  log_external_automation_event: 'generic',
}

// Tools SIEMPRE prohibidas desde la ruta del Asistente general (Facturación aislada).
export const FORBIDDEN_TOOLS: ReadonlySet<string> = new Set(['get_invoices_summary'])

// Evaluación COMPLETA de si una llamada a tool debe servirse (PURA: recibe secreto + flags). El endpoint
// /api/agent/tool solo aplica el resultado. Cubre: facturación siempre bloqueada, token válido + permiso,
// token inválido/expirado/manipulado, y modo estricto (sin token → rechazo) vs compat (sin token → warn).
export type ToolPolicyEvaluation =
  | { action: 'allow' }
  | { action: 'warn_unscoped' }
  | { action: 'reject'; status: number; code: string; reason?: string }

export function evaluateToolPolicy(params: {
  tool: string
  token: string | null | undefined
  secret: string
  requirePolicy: boolean
  allowUnscopedDev: boolean
  nowMs?: number
}): ToolPolicyEvaluation {
  const { tool, token, secret, requirePolicy, allowUnscopedDev, nowMs } = params
  if (FORBIDDEN_TOOLS.has(tool)) return { action: 'reject', status: 403, code: 'tool_forbidden_for_assistant' }
  if (token) {
    const v = verifyTurnPolicy(token, secret, nowMs)
    if (!v.ok) return { action: 'reject', status: 403, code: 'invalid_turn_policy', reason: v.reason }
    const check = policyAllowsTool(v.payload, tool)
    if (!check.ok) return { action: 'reject', status: 403, code: 'tool_not_allowed_for_turn', reason: check.reason }
    return { action: 'allow' }
  }
  if (requirePolicy && !allowUnscopedDev) return { action: 'reject', status: 403, code: 'turn_policy_required' }
  return { action: 'warn_unscoped' }
}

// ¿Autoriza esta política que se ejecute la tool física `tool`?
export function policyAllowsTool(payload: TurnPolicyPayload, tool: string): { ok: true } | { ok: false; reason: string } {
  if (FORBIDDEN_TOOLS.has(tool)) return { ok: false, reason: 'forbidden_tool' }
  if (!payload.read && !payload.write) return { ok: false, reason: 'turn_reads_no_data' }
  const dom = TOOL_DOMAIN[tool]
  if (dom === 'invoicing') return { ok: false, reason: 'invoicing_isolated' }
  // Dominio concreto: debe estar entre los permitidos (si la política declaró tools por dominio).
  if (dom && dom !== 'generic' && payload.tools.length) {
    const domainAllowed = payload.tools.some((t) => t.startsWith(`${dom}.`))
    if (!domainAllowed) return { ok: false, reason: 'domain_not_allowed' }
  }
  return { ok: true }
}
