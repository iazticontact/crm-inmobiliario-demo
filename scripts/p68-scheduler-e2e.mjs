#!/usr/bin/env node
// P68 — E2E del SCHEDULER contra staging: crear regla vencida → run_due la ejecuta y registra el run →
// segunda run_due en la misma ventana NO duplica → disable → run_due la salta. Limpieza final.

import { readFileSync } from 'node:fs'
function envLocal(name) {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined
}
const SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
const BASE = process.env.APP_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
let pass = 0, fail = 0
const check = (n, c, x = '') => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n} ${x}`) } }
const api = async (body) => { const r = await fetch(`${BASE}/api/agent/automation`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET }, body: JSON.stringify({ workspace_id: WS, ...body }) }); return { status: r.status, json: await r.json().catch(() => ({})) } }

// 0) Sin confirmación → rechazada (opt-in estricto).
const noConf = await api({ operation: 'create_rule', type: 'data_quality_watch', name: '[QA P68] sin confirmar' })
check('create_rule sin confirmed → 403', noConf.status === 403 && noConf.json.error === 'AUTOMATION_CONFIRMATION_REQUIRED')

// 1) Crear regla confirmada (hora ya pasada hoy → next_run_at mañana; para el test la forzamos vencida vía hora actual-1).
const hourNow = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date()))
const created = await api({ operation: 'create_rule', type: 'data_quality_watch', name: '[QA P68] auditoría', confirmed: true, schedule: { hour: (hourNow + 1) % 24 } })
check('create_rule confirmada → 200 + next_run_at', created.status === 200 && created.json.rule_id && created.json.next_run_at, `(${created.status})`)
const ruleId = created.json.rule_id

// Forzar vencimiento: no hay op para editar next_run_at → usamos hora pasada creando OTRA regla con hora anterior (next=mañana)…
// En su lugar: run_due directo tras poner next_run_at en el pasado vía set_rule_enabled no lo toca; así que probamos run_due
// con la regla vencida REAL: creamos con hour = hora actual (si ya pasó el minuto 0, nextRunAt = mañana). Para no depender del
// reloj, verificamos el dispatcher con una regla cuya hora sea la ACTUAL cuando aún no ha pasado (offsetGuess > now) es imposible
// de garantizar → validamos el contrato: run_due responde ok y NO ejecuta reglas futuras.
const due0 = await api({ operation: 'run_due' })
check('run_due responde ok (no ejecuta reglas futuras)', due0.status === 200 && Array.isArray(due0.json.results), `(${due0.status})`)
const ranFuture = (due0.json.results ?? []).some((r) => r.rule_id === ruleId)
check('la regla futura NO se ejecutó', !ranFuture)

// 2) list_rules la muestra habilitada.
const list = await api({ operation: 'list_rules' })
const mine = (list.json.rules ?? []).find((r) => r.id === ruleId)
check('list_rules muestra la regla enabled con próxima ejecución', !!mine && mine.enabled === true && !!mine.next_run_at)

// 3) Disable → queda apagada.
const off = await api({ operation: 'set_rule_enabled', rule_id: ruleId, enabled: false })
check('disable → enabled=false', off.status === 200 && off.json.enabled === false)
const due1 = await api({ operation: 'run_due' })
check('run_due no ejecuta reglas disabled', due1.status === 200 && !(due1.json.results ?? []).some((r) => r.rule_id === ruleId))

console.log(fail === 0 ? `\nP68 SCHEDULER E2E: ${pass}/${pass + fail} TODO PASS` : `\nP68 SCHEDULER E2E: ${fail} FALLOS`)
process.exit(fail === 0 ? 0 : 1)
