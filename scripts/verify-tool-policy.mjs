#!/usr/bin/env node
// P51B — Verificación REAL del enforcement de /api/agent/tool contra el entorno desplegado.
// Firma Turn Policy Tokens (igual que la app) y ejecuta los casos A–H. NO filtra el secreto ni el token
// completo (solo un prefijo). Lo ejecuta el usuario/operador con acceso a los secretos del servidor.
//
// Uso (PowerShell):
//   $env:AGENT_TOOL_URL="https://<staging>/api/agent/tool"
//   $env:AGENT_TOOL_SECRET="<AGENT_TOOL_SECRET del servidor>"
//   $env:WORKSPACE_ID="d0000000-0000-4000-8000-000000000001"
//   node scripts/verify-tool-policy.mjs
//
// El AGENT_TOOL_SECRET debe ser el MISMO que usa el servidor (firma del token + auth del endpoint).

import { createHmac } from 'node:crypto'

const URL = process.env.AGENT_TOOL_URL
const SECRET = process.env.AGENT_TOOL_SECRET
const WORKSPACE_ID = process.env.WORKSPACE_ID
if (!URL || !SECRET || !WORKSPACE_ID) {
  console.error('Faltan envs: AGENT_TOOL_URL, AGENT_TOOL_SECRET, WORKSPACE_ID')
  process.exit(2)
}

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const hmac = (data) => createHmac('sha256', SECRET).update(data).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function sign({ domain, read, write, tools, ttlMs = 90_000, now = Date.now() }) {
  const payload = { v: 1, cid: 'verify', tid: 'verify', domain, read, write, tools, iat: now, exp: now + ttlMs }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${hmac(body)}`
}

async function call({ tool, token, input = {} }) {
  const headers = { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET }
  if (token) headers['x-nowcrm-turn-policy'] = token
  let res, json
  try {
    res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify({ tool, workspace_id: WORKSPACE_ID, input }) })
    json = await res.json().catch(() => ({}))
  } catch (e) {
    return { status: 0, error: String(e?.message || e) }
  }
  return { status: res.status, error: json?.error, reason: json?.reason }
}

const readTasks = sign({ domain: 'tasks', read: true, write: false, tools: ['tasks.read', 'tasks.search'] })
const noData = sign({ domain: 'clients', read: false, write: false, tools: [] })
const expired = sign({ domain: 'tasks', read: true, write: false, tools: ['tasks.read'], now: Date.now() - 10 * 60_000 })
const tampered = readTasks.slice(0, -1) + (readTasks.endsWith('a') ? 'b' : 'a')

const cases = [
  { name: 'A token válido + tool permitida', run: () => call({ tool: 'get_pending_tasks', token: readTasks }), expect: (r) => r.status === 200 },
  { name: 'B token válido + cross-domain', run: () => call({ tool: 'search_properties', token: readTasks, input: { query: 'piso' } }), expect: (r) => r.status === 403 && r.error === 'tool_not_allowed_for_turn' },
  { name: 'C turno no-datos → read rechazada', run: () => call({ tool: 'get_pending_tasks', token: noData }), expect: (r) => r.status === 403 && r.error === 'tool_not_allowed_for_turn' },
  { name: 'D token expirado', run: () => call({ tool: 'get_pending_tasks', token: expired }), expect: (r) => r.status === 403 && r.error === 'invalid_turn_policy' },
  { name: 'E token manipulado', run: () => call({ tool: 'get_pending_tasks', token: tampered }), expect: (r) => r.status === 403 && r.error === 'invalid_turn_policy' },
  { name: 'G invoice tool (siempre 403)', run: () => call({ tool: 'get_invoices_summary', token: readTasks }), expect: (r) => r.status === 403 && r.error === 'tool_forbidden_for_assistant' },
  { name: 'F sin token (403 si strict, 200 si compat)', run: () => call({ tool: 'get_pending_tasks', token: null }), expect: (r) => r.status === 403 || r.status === 200, note: 'strict=AGENT_TOOLS_REQUIRE_POLICY' },
]

let failed = 0
console.log(`\nVerificando ${cases.length} casos contra ${URL} (token: ${readTasks.slice(0, 8)}…)\n`)
for (const c of cases) {
  const r = await c.run()
  const pass = c.expect(r)
  if (!pass) failed++
  console.log(`${pass ? '✓' : '✗'} ${c.name} → HTTP ${r.status}${r.error ? ` ${r.error}` : ''}${r.reason ? `/${r.reason}` : ''}${c.note ? `  (${c.note})` : ''}`)
}
console.log(failed === 0 ? '\nTOOL POLICY: OK ✅' : `\nTOOL POLICY: ${failed} FALLO(S) ❌`)
process.exit(failed === 0 ? 0 : 1)
