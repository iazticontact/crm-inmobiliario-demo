#!/usr/bin/env node
// P65 — E2E del CONTROL PLANE de acciones contra el endpoint DESPLEGADO. Ciclo completo con fixture QA
// aislado (tarea QA creada y completada; sin tocar datos de negocio). Casos: prepare→confirm→verify,
// idempotencia (doble confirm), cancel, seguridad (sin secret, token lectura, campo denegado, invoices,
// workspace cruzado). No imprime secretos.
// Uso: node scripts/p65-action-e2e.mjs

import { readFileSync } from 'node:fs'
function envLocal(name) {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined
}
const SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
const BASE = process.env.APP_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = process.env.WORKSPACE_ID || 'd0000000-0000-4000-8000-000000000001'
if (!SECRET) { console.error('Falta AGENT_TOOL_SECRET'); process.exit(2) }

let pass = 0, fail = 0
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name} ${extra}`) } }
const call = async (body, secret = SECRET) => {
  const r = await fetch(`${BASE}/api/agent/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-nowcrm-secret': secret } : {}) },
    body: JSON.stringify({ workspace_id: WS, ...body }),
  })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}

// ── 1. PREPARE tasks.create (fixture QA) ──
const title = `[QA P65] Tarea e2e ${new Date().toISOString().slice(0, 16)}`
const prep = await call({ operation: 'prepare', action_type: 'tasks.create', proposed_changes: { title, priority: 'low' } })
check('prepare tasks.create → 200 + preview + token', prep.status === 200 && prep.json.confirmation_required === true && String(prep.json.action_token || '').startsWith('act.'), `(${prep.status} ${prep.json.error ?? ''})`)
const token = prep.json.action_token

// ── 2. CONFIRM → execute + read-after-write ──
const conf = await call({ operation: 'confirm', action_token: token })
check('confirm → completed + verify_ok', conf.status === 200 && conf.json.status === 'completed' && conf.json.result?.verify_ok === true, `(${conf.status} ${conf.json.error ?? ''})`)
const taskId = conf.json.result?.entity_id

// ── 3. IDEMPOTENCIA: segunda confirmación → mismo resultado, sin segunda escritura ──
const conf2 = await call({ operation: 'confirm', action_token: token })
check('doble confirm → duplicate:true (sin segunda escritura)', conf2.status === 200 && conf2.json.duplicate === true && conf2.json.result?.entity_id === taskId, `(${conf2.status})`)

// ── 4. COMPLETE la tarea QA (update con optimistic lock) + verificación ──
let completed = false
if (taskId) {
  const prep2 = await call({ operation: 'prepare', action_type: 'tasks.complete', entity_id: taskId, proposed_changes: { status: 'done' } })
  const conf3 = prep2.status === 200 ? await call({ operation: 'confirm', action_token: prep2.json.action_token }) : { status: 0, json: {} }
  completed = conf3.status === 200 && conf3.json.result?.verified?.status === 'done'
  check('tasks.complete → verificado (fixture cerrado)', completed, `(${prep2.status}/${conf3.status})`)
}

// ── 5. CANCEL: preparar y cancelar → no ejecuta ──
const prep3 = await call({ operation: 'prepare', action_type: 'tasks.create', proposed_changes: { title: '[QA P65] cancelada' } })
const canc = await call({ operation: 'cancel', action_id: prep3.json.action_id })
const confAfterCancel = await call({ operation: 'confirm', action_token: prep3.json.action_token })
check('cancel → cancelled y confirm posterior rechazado', canc.status === 200 && confAfterCancel.status === 409 && confAfterCancel.json.error === 'ACTION_CANCELLED', `(${canc.status}/${confAfterCancel.status})`)

// ── 6. SEGURIDAD ──
const noSecret = await call({ operation: 'prepare', action_type: 'tasks.create', proposed_changes: { title: 'x' } }, null)
check('sin x-nowcrm-secret → 401', noSecret.status === 401)
const badField = await call({ operation: 'prepare', action_type: 'portfolio.update_price', entity_id: '00000000-0000-4000-8000-000000000000', proposed_changes: { price: 1000, status: 'sold' } })
check('campo no permitido (status en update_price) → 403 FIELD_DENIED', badField.status === 403 && badField.json.error === 'ACTION_FIELD_DENIED')
const invoice = await call({ operation: 'prepare', action_type: 'invoices.update', proposed_changes: { total: 1 } })
check('acción de facturación → rechazada (no registrada)', invoice.status === 422 && invoice.json.error === 'ACTION_UNKNOWN')
const readAsAction = await call({ operation: 'confirm', action_token: 'eyJ2IjoxfQ.abc' })
check('token de lectura/basura como acción → 403', readAsAction.status === 403 && readAsAction.json.error === 'ACTION_CONFIRMATION_INVALID')
const crossWs = await fetch(`${BASE}/api/agent/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET }, body: JSON.stringify({ workspace_id: 'ffc49d1b-12ba-465f-8f5a-d43f5e473fe7', operation: 'confirm', action_token: token }) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }))
check('confirm con OTRO workspace → 403 WORKSPACE_MISMATCH', crossWs.status === 403 && crossWs.json.error === 'ACTION_WORKSPACE_MISMATCH')

console.log(fail === 0 ? `\nP65 ACTION E2E: ${pass}/${pass + fail} TODO PASS` : `\nP65 ACTION E2E: ${fail} FALLOS`)
process.exit(fail === 0 ? 0 : 1)
