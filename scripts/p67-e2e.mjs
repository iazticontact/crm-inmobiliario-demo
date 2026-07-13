#!/usr/bin/env node
// P67 — E2E contra staging: findings (auditoría + dedupe) y acciones ampliadas (transiciones, email).
// Sin tocar datos de negocio (prepare+cancel; findings solo detectan). No imprime secretos.

import { readFileSync } from 'node:fs'
function envLocal(name) {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined
}
const SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
const BASE = process.env.APP_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
let pass = 0, fail = 0
const check = (n, c, x = '') => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n} ${x}`) } }
const api = async (kind, body) => { const r = await fetch(`${BASE}/api/agent/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET }, body: JSON.stringify({ workspace_id: WS, ...body }) }); return { status: r.status, json: await r.json().catch(() => ({})) } }

// 1) FINDINGS: auditoría viva + dedupe en segunda ejecución.
const run1 = await api('automation', { operation: 'run_data_quality' })
check('run_data_quality → ok + detecta incidencias', run1.status === 200 && run1.json.detected >= 1, `(${run1.status} det=${run1.json.detected})`)
const run2 = await api('automation', { operation: 'run_data_quality' })
check('segunda ejecución NO duplica (dedupe por fingerprint)', run2.status === 200 && run2.json.created === 0 && run2.json.duplicates >= 1, `(created=${run2.json.created} dup=${run2.json.duplicates})`)
const list = await api('automation', { operation: 'list_findings' })
check('list_findings devuelve abiertas con criterio', list.status === 200 && (list.json.findings ?? []).length >= 1 && /Criterio/i.test(JSON.stringify(list.json.findings)), `(${(list.json.findings ?? []).length})`)

// 2) TRANSICIONES: sold→listed rechazada; listed→under_contract preparada y cancelada (sin mutar).
const soldProp = await api('action', { operation: 'prepare', action_type: 'portfolio.update_status', entity_id: '00000000-0000-4000-8000-000000000000', proposed_changes: { status: 'listed' } })
check('entidad inexistente → 404 (no fuga)', soldProp.status === 404)
// Busca ids reales vía tool de lectura firmada… simplificado: usa el endpoint de tool crm_read_query.
import('node:crypto').then(() => {})
const { createHmac } = await import('node:crypto')
const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const now = Date.now()
const pay = b64(JSON.stringify({ v: 1, cid: 'p67', tid: 'p67', domain: 'properties', read: true, write: false, tools: ['properties.read'], iat: now, exp: now + 90000 }))
const token = `${pay}.${createHmac('sha256', SECRET).update(pay).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
const props = await fetch(`${BASE}/api/agent/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET, 'x-nowcrm-turn-policy': token }, body: JSON.stringify({ tool: 'crm_read_query', workspace_id: WS, input: { entity: 'properties', limit: 20 } }) }).then((r) => r.json())
const rows = props.result?.rows ?? []
const sold = rows.find((p) => p.status === 'sold')
const listed = rows.find((p) => p.status === 'listed')
if (sold) {
  const bad = await api('action', { operation: 'prepare', action_type: 'portfolio.update_status', entity_id: sold.id, proposed_changes: { status: 'listed' } })
  check('transición sold→listed → 422 ACTION_TRANSITION_INVALID', bad.status === 422 && bad.json.error === 'ACTION_TRANSITION_INVALID', `(${bad.status} ${bad.json.error})`)
}
if (listed) {
  const okp = await api('action', { operation: 'prepare', action_type: 'portfolio.update_status', entity_id: listed.id, proposed_changes: { status: 'under_contract' } })
  check('transición listed→reservado → preview 200', okp.status === 200 && okp.json.confirmation_required === true)
  const canc = await api('action', { operation: 'cancel', action_id: okp.json.action_id })
  check('cancelada sin mutar', canc.status === 200)
}
// 3) EMAIL: formato inválido rechazado (con un CLIENTE real — la validación semántica va tras resolver entidad).
const pay2 = b64(JSON.stringify({ v: 1, cid: 'p67', tid: 'p67', domain: 'clients', read: true, write: false, tools: ['clients.read'], iat: Date.now(), exp: Date.now() + 90000 }))
const token2 = `${pay2}.${createHmac('sha256', SECRET).update(pay2).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
const cli = await fetch(`${BASE}/api/agent/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET, 'x-nowcrm-turn-policy': token2 }, body: JSON.stringify({ tool: 'crm_read_query', workspace_id: WS, input: { entity: 'clients', limit: 1 } }) }).then((r) => r.json())
const clientId = cli.result?.rows?.[0]?.id
const badEmail = await api('action', { operation: 'prepare', action_type: 'clients.update_email', entity_id: clientId, proposed_changes: { email: 'no-es-email' } })
check('email inválido → 422 (cliente real)', badEmail.status === 422, `(${badEmail.status} ${badEmail.json.error})`)

console.log(fail === 0 ? `\nP67 E2E: ${pass}/${pass + fail} TODO PASS` : `\nP67 E2E: ${fail} FALLOS`)
process.exit(fail === 0 ? 0 : 1)
