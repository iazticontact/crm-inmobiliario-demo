// Evals del enforcement de tools por turno (P51B) — cubren TODOS los casos del endpoint /api/agent/tool a
// través de la función pura `evaluateToolPolicy` (strict/compat/token). Antes solo se testeaba con token
// presente; ahora se cubre el modo estricto (sin token → 403) y el compat (sin token → warn).

import { evaluateToolPolicy, signTurnPolicy } from '@/lib/agents/turn-policy'
import { decideTurn } from '@/lib/agents/assistant-turn'
import { allowedToolsForTurn } from '@/lib/agents/assistant-tool-permissions'

const SECRET = 'p51b-secret-1234567890'
const NOW = 1_700_000_000_000

function tokenFor(q: string, nowMs = NOW): string {
  const d = decideTurn(q)
  return signTurnPolicy({ cid: 'c', tid: 't', domain: d.domain, read: d.shouldReadData, write: d.shouldWriteData, tools: allowedToolsForTurn(d) }, SECRET, nowMs)
}

export function runTurnPolicyStrictEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const ev = (o: Parameters<typeof evaluateToolPolicy>[0]) => evaluateToolPolicy(o)

  const readTok = tokenFor('muéstrame los clientes')

  // A) Token válido + tool permitida → allow.
  ok(ev({ tool: 'search_clients', token: readTok, secret: SECRET, requirePolicy: true, allowUnscopedDev: false, nowMs: NOW }).action === 'allow', 'A: token válido + permitida → allow')
  // B) Token válido + tool no permitida (cross-domain) → reject 403 tool_not_allowed_for_turn.
  {
    const r = ev({ tool: 'search_properties', token: readTok, secret: SECRET, requirePolicy: true, allowUnscopedDev: false, nowMs: NOW })
    ok(r.action === 'reject' && r.status === 403 && r.code === 'tool_not_allowed_for_turn', 'B: cross-domain → 403 tool_not_allowed_for_turn')
  }
  // C) Turno no-datos (meta) → cualquier read rechazada.
  {
    const metaTok = tokenFor('por qué me listas los clientes')
    const r = ev({ tool: 'search_clients', token: metaTok, secret: SECRET, requirePolicy: true, allowUnscopedDev: false, nowMs: NOW })
    ok(r.action === 'reject' && r.code === 'tool_not_allowed_for_turn', 'C: turno meta → read rechazada')
  }
  // D) Token expirado → reject invalid_turn_policy.
  {
    const r = ev({ tool: 'search_clients', token: readTok, secret: SECRET, requirePolicy: true, allowUnscopedDev: false, nowMs: NOW + 10_000_000 })
    ok(r.action === 'reject' && r.code === 'invalid_turn_policy', 'D: expirado → 403 invalid_turn_policy')
  }
  // E) Token manipulado → reject invalid_turn_policy.
  {
    const tampered = readTok.slice(0, -1) + (readTok.endsWith('a') ? 'b' : 'a')
    const r = ev({ tool: 'search_clients', token: tampered, secret: SECRET, requirePolicy: true, allowUnscopedDev: false, nowMs: NOW })
    ok(r.action === 'reject' && r.code === 'invalid_turn_policy', 'E: manipulado → 403 invalid_turn_policy')
  }
  // F) Sin token + strict → reject turn_policy_required.
  {
    const r = ev({ tool: 'search_clients', token: null, secret: SECRET, requirePolicy: true, allowUnscopedDev: false, nowMs: NOW })
    ok(r.action === 'reject' && r.code === 'turn_policy_required', 'F: sin token + strict → 403 turn_policy_required')
  }
  // F2) Sin token + compat → warn (se sirve pero se registra).
  {
    const r = ev({ tool: 'search_clients', token: null, secret: SECRET, requirePolicy: false, allowUnscopedDev: false, nowMs: NOW })
    ok(r.action === 'warn_unscoped', 'F2: sin token + compat → warn_unscoped')
  }
  // F3) Sin token + strict + allowUnscopedDev → warn (solo dev).
  {
    const r = ev({ tool: 'search_clients', token: null, secret: SECRET, requirePolicy: true, allowUnscopedDev: true, nowMs: NOW })
    ok(r.action === 'warn_unscoped', 'F3: strict + dev override → warn')
  }
  // G) Invoice tool → reject SIEMPRE (con o sin token, strict o compat).
  for (const [tok, rp] of [[readTok, true], [null, false]] as [string | null, boolean][]) {
    const r = ev({ tool: 'get_invoices_summary', token: tok, secret: SECRET, requirePolicy: rp, allowUnscopedDev: false, nowMs: NOW })
    ok(r.action === 'reject' && r.code === 'tool_forbidden_for_assistant', `G: get_invoices_summary → 403 (token=${!!tok})`)
  }
  // H) Secreto incorrecto → reject invalid_turn_policy.
  {
    const r = ev({ tool: 'search_clients', token: readTok, secret: 'otro-secreto', requirePolicy: true, allowUnscopedDev: false, nowMs: NOW })
    ok(r.action === 'reject' && r.code === 'invalid_turn_policy', 'H: secreto incorrecto → 403')
  }

  return fail
}
