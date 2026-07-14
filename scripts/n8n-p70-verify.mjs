#!/usr/bin/env node
// P70 Wave E — VERIFICACIÓN del workflow n8n (read-only): nodos, tools (20 previas + 10 P70), marker
// [P70 FINAL RELEASE CANDIDATE], contrato P51 (headers turn-policy en tools de lectura), cron del
// scheduler, active=true y HASH estable (para drift-check). No imprime credenciales.
// Uso: node scripts/n8n-p70-verify.mjs [--write-hash]  (escribe docs/P70_N8N_WORKFLOW_HASH.txt)

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

function loadEnv(path) {
  const env = {}
  try { for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); env[m[1]] = v } } } catch { /* noop */ }
  return env
}
const env = loadEnv('.env.local')
const KEY = env.N8N_API_KEY
const API = (env.N8N_API_URL || (env.N8N_BASE_URL ? env.N8N_BASE_URL.replace(/\/$/, '') + '/api/v1' : '')).replace(/\/$/, '')
const WF_ID = process.env.WF_ID || '6mps8YoWu3syldUc'
if (!KEY || !API) { console.error('Faltan N8N_API_KEY / N8N_API_URL en .env.local'); process.exit(2) }

const r = await fetch(`${API}/workflows/${WF_ID}`, { headers: { 'X-N8N-API-KEY': KEY, accept: 'application/json' } })
if (!r.ok) { console.error(`GET workflow → ${r.status}`); process.exit(1) }
const wf = await r.json()

let pass = 0, fail = 0
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}  ${extra}`) } }

const names = new Set(wf.nodes.map((n) => n.name))
const READ_TOOLS = ['search_clients', 'get_client_360', 'get_crm_overview', 'get_pending_tasks', 'get_calendar_summary', 'get_open_operations', 'get_recent_activity', 'get_documents_metadata', 'get_latest_client', 'get_client_opportunities', 'get_client_service_cases', 'get_open_service_cases', 'pipeline_summary', 'search_properties', 'crm_read_query']
const ACTION_TOOLS = ['crm_action_prepare', 'crm_action_confirm', 'crm_action_cancel', 'crm_action_status', 'crm_findings_check']
const P70_TOOLS = ['crm_automation_list', 'crm_automation_update', 'crm_automation_enable', 'crm_automation_disable', 'crm_automation_run', 'crm_automation_last_run', 'crm_findings_list', 'crm_finding_acknowledge', 'crm_finding_resolve', 'crm_finding_dismiss']

check('workflow activo', wf.active === true)
check('nodos = 41 (31 previos + 10 tools P70)', wf.nodes.length === 41, `(${wf.nodes.length})`)
check('15 read tools presentes', READ_TOOLS.every((t) => names.has(t)))
check('5 action/finding tools P66/P67 presentes', ACTION_TOOLS.every((t) => names.has(t)))
check('10 tools P70 presentes', P70_TOOLS.every((t) => names.has(t)), P70_TOOLS.filter((t) => !names.has(t)).join(','))
const agent = wf.nodes.find((n) => n.name === 'CRM Agent')
const prompt = String(agent?.parameters?.options?.systemMessage ?? '')
check('marker [P70 FINAL RELEASE CANDIDATE] en prompt', prompt.includes('[P70 FINAL RELEASE CANDIDATE]'))
for (const m of ['[P64]', '[P65 ACTION CONTROL PLANE]', '[P66 CHAT ACTION INTEGRATION]', '[P67 PROACTIVE INTELLIGENCE]', '[P68 AUTOMATIONS]']) {
  check(`marker previo intacto: ${m}`, prompt.includes(m))
}
// Contrato P51: las tools de lectura llevan el header x-nowcrm-turn-policy.
const readToolNodes = wf.nodes.filter((n) => READ_TOOLS.includes(n.name))
check('P51: read tools con x-nowcrm-turn-policy', readToolNodes.every((n) => String(n.parameters?.jsCode ?? '').includes('x-nowcrm-turn-policy')), readToolNodes.filter((n) => !String(n.parameters?.jsCode ?? '').includes('x-nowcrm-turn-policy')).map((n) => n.name).join(','))
// Las tools P70 usan el endpoint de automatización con secreto y workspace del contexto (jamás del modelo).
const p70Nodes = wf.nodes.filter((n) => P70_TOOLS.includes(n.name))
check('P70 tools → /api/agent/automation con x-nowcrm-secret', p70Nodes.every((n) => String(n.parameters?.jsCode ?? '').includes('/api/agent/automation') && String(n.parameters?.jsCode ?? '').includes('x-nowcrm-secret')))
check('P70 tools: workspace del Normalize input (no del modelo)', p70Nodes.every((n) => String(n.parameters?.jsCode ?? '').includes(`$('Normalize input')`)))
check('P70 tools conectadas al agente (ai_tool)', P70_TOOLS.every((t) => JSON.stringify(wf.connections?.[t] ?? {}).includes('CRM Agent')))
// Prohibiciones: sin HTTP genérico nuevo, sin SQL, sin invoices.
check('sin tools de facturación', ![...names].some((n) => /invoice|factur/i.test(n)))
check('cron del scheduler intacto (run_due)', names.has('Automation Scheduler') && names.has('Run Due Automations') && JSON.stringify(wf.nodes.find((n) => n.name === 'Run Due Automations')?.parameters ?? {}).includes('run_due'))

// Hash estable (nodes+connections ordenados) para drift-check.
const nodesSorted = [...wf.nodes].sort((a, b) => a.name.localeCompare(b.name)).map((n) => ({ name: n.name, type: n.type, params: n.parameters }))
const hash = createHash('sha256').update(JSON.stringify({ nodes: nodesSorted, connections: wf.connections })).digest('hex').slice(0, 16)
console.log(`\nHash del workflow: ${hash}`)
if (process.argv.includes('--write-hash')) {
  writeFileSync('docs/P70_N8N_WORKFLOW_HASH.txt', `${hash}\n`)
  console.log('Hash escrito en docs/P70_N8N_WORKFLOW_HASH.txt')
}

console.log(`\nP70 N8N VERIFY: ${pass}/${pass + fail} ${fail ? 'CON FALLOS' : 'TODO PASS'}`)
process.exit(fail ? 1 : 0)
