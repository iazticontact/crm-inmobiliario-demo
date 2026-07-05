// Evals del contrato App→n8n→tool endpoint (P51) — propiedades.
// Verifican el Turn Policy Token (firma/expiración/manipulación), que un turno no-datos produce
// allowedTools=[] y el backend rechazaría la lectura, y que las tools de facturación se rechazan siempre.

import { signTurnPolicy, verifyTurnPolicy, policyAllowsTool, FORBIDDEN_TOOLS } from '@/lib/agents/turn-policy'
import { decideTurn } from '@/lib/agents/assistant-turn'
import { allowedToolsForTurn } from '@/lib/agents/assistant-tool-permissions'

const SECRET = 'p51-test-secret-абвг-1234567890'
const NOW = 1_700_000_000_000

function tokenFor(q: string) {
  const d = decideTurn(q)
  const tools = allowedToolsForTurn(d)
  const tok = signTurnPolicy({ cid: 'c1', tid: 't1', domain: d.domain, read: d.shouldReadData, write: d.shouldWriteData, tools }, SECRET, NOW)
  return { d, tools, tok }
}

export function runN8nContractEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // ── Firma / verificación ──
  const tok = signTurnPolicy({ cid: 'c', tid: 't', domain: 'clients', read: true, write: false, tools: ['clients.read', 'clients.search'] }, SECRET, NOW)
  const v = verifyTurnPolicy(tok, SECRET, NOW + 1000)
  ok(v.ok && v.payload.domain === 'clients' && v.payload.read === true, 'roundtrip firma/verificación')
  ok(!verifyTurnPolicy(tok.slice(0, -1) + (tok.endsWith('a') ? 'b' : 'a'), SECRET, NOW).ok, 'firma manipulada → inválida')
  ok(!verifyTurnPolicy(tok, 'otro-secreto', NOW).ok, 'secreto incorrecto → inválido')
  ok(!verifyTurnPolicy(tok, SECRET, NOW + 10_000_000).ok, 'token expirado → inválido')
  ok(!verifyTurnPolicy('no-es-un-token', SECRET, NOW).ok, 'token malformado → inválido')
  // El payload NO lleva secretos ni el propio secreto.
  ok(!tok.includes(SECRET), 'el token no filtra el secreto')

  // ── Un turno NO-datos ⇒ el backend rechazaría cualquier lectura ──
  const nonData = ['por qué me listas los clientes', 'no me refiero a los inmuebles', '¿qué puedes hacer?', '¿cómo funciona la cartera?', 'si creo un cliente, ¿podrás verlo?', 'hola']
  for (const q of nonData) {
    const { d, tools, tok: t } = tokenFor(q)
    ok(tools.length === 0, `no-datos ⇒ allowedTools vacío: "${q}" (${d.turnType})`)
    const vr = verifyTurnPolicy(t, SECRET, NOW)
    ok(vr.ok && !policyAllowsTool(vr.payload, 'search_clients').ok, `backend rechaza lectura en turno no-datos: "${q}"`)
    ok(vr.ok && !policyAllowsTool(vr.payload, 'crm_read_query').ok, `backend rechaza crm_read_query en turno no-datos: "${q}"`)
  }

  // ── Lectura real de clientes ⇒ tools del dominio permitidas; cross-domain rechazado ──
  const cli = tokenFor('muéstrame los clientes')
  const cv = verifyTurnPolicy(cli.tok, SECRET, NOW)
  ok(cv.ok && policyAllowsTool(cv.payload, 'search_clients').ok, 'lectura clientes: search_clients permitida')
  ok(cv.ok && policyAllowsTool(cv.payload, 'crm_read_query').ok, 'lectura: tool genérica permitida')
  ok(cv.ok && !policyAllowsTool(cv.payload, 'search_properties').ok, 'no permite cross-domain (properties)')

  // ── Facturación: tools SIEMPRE prohibidas, con cualquier token ──
  ok(FORBIDDEN_TOOLS.has('get_invoices_summary'), 'get_invoices_summary en FORBIDDEN')
  ok(cv.ok && !policyAllowsTool(cv.payload, 'get_invoices_summary').ok, 'get_invoices_summary rechazada aun en turno de datos')
  const inv = tokenFor('¿cuánto he facturado?')
  ok(inv.tools.length === 0, 'facturación ⇒ allowedTools vacío')

  return fail
}
