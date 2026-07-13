#!/usr/bin/env node
// P68 — SCHEDULER REAL en n8n vivo: Schedule Trigger (cada 15 min) → HTTP run_due en /api/agent/automation
// (ejecuta las reglas opt-in vencidas con idempotencia por ventana). + bloque [P68] en el prompt.
// Idempotente; dry-run por defecto, --apply para PUT. Backup en temp. Sin secretos.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function envLocal(name) {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined
}
const key = process.env.N8N_API_KEY || envLocal('N8N_API_KEY')
let apiBase = (process.env.N8N_API_URL || envLocal('N8N_API_URL') || ((process.env.N8N_BASE_URL || envLocal('N8N_BASE_URL') || '').replace(/\/$/, '') + '/api/v1')).replace(/\/$/, '')
if (!/\/api\/v\d+$/.test(apiBase)) apiBase += '/api/v1'
const WF_ID = process.env.WF_ID || '6mps8YoWu3syldUc'
const APPLY = process.argv.includes('--apply')
if (!key) { console.error('Falta N8N_API_KEY'); process.exit(2) }
const H = { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json', accept: 'application/json' }

const P68_PROMPT = `

[P68 AUTOMATIONS]
1. Las automatizaciones son OPT-IN: para "activa un resumen diario a las 8" u similar, explica que quedara programada (Europe/Madrid) y que puedes ejecutar la auditoria ahora con crm_findings_check. La activacion real requiere confirmacion explicita del usuario.
2. Nunca afirmes que una automatizacion se ejecuto sin evidencia de run. Los findings generados por el scheduler son los mismos que ves con crm_findings_check.`

async function main() {
  const res = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H })
  if (!res.ok) { console.error('GET →', res.status); process.exit(1) }
  const wf = await res.json()
  const dir = mkdtempSync(join(tmpdir(), 'n8n-p68-'))
  writeFileSync(join(dir, 'backup.json'), JSON.stringify(wf))
  console.log(`Workflow: ${wf.name} · active:${wf.active} · nodos:${wf.nodes.length} · backup: ${dir}`)
  const agent = wf.nodes.find((n) => /crm agent/i.test(n.name || ''))
  if (!agent) { console.error('Sin CRM Agent'); process.exit(1) }

  let changed = false
  const smPath = agent.parameters?.options && 'systemMessage' in agent.parameters.options ? 'options' : 'direct'
  const sm = smPath === 'options' ? agent.parameters.options.systemMessage : agent.parameters.systemMessage
  if (!String(sm).includes('[P68')) {
    if (smPath === 'options') agent.parameters.options.systemMessage = String(sm) + P68_PROMPT
    else agent.parameters.systemMessage = String(sm) + P68_PROMPT
    changed = true; console.log('Prompt: + [P68]')
  } else console.log('Prompt: [P68] ya presente')

  if (!wf.nodes.some((n) => n.name === 'Automation Scheduler')) {
    const base = wf.nodes.find((n) => /webhook/i.test(n.type || ''))?.position ?? [0, 0]
    wf.nodes.push({
      id: `p68-sched-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Automation Scheduler', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [Number(base[0]) - 200, Number(base[1]) + 500],
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } },
    })
    wf.nodes.push({
      id: `p68-rundue-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Run Due Automations', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [Number(base[0]) + 60, Number(base[1]) + 500],
      parameters: {
        method: 'POST',
        url: '={{ $env.CRM_BASE_URL }}/api/agent/automation',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'x-nowcrm-secret', value: '={{ $env.AGENT_TOOL_SECRET }}' }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ operation: "run_due", workspace_id: "d0000000-0000-4000-8000-000000000001" }) }}',
        options: { timeout: 30000 },
      },
    })
    wf.connections['Automation Scheduler'] = { main: [[{ node: 'Run Due Automations', type: 'main', index: 0 }]] }
    changed = true
    console.log('Scheduler: + Schedule Trigger (15 min) → Run Due Automations (run_due)')
  } else console.log('Scheduler: ya existe')

  if (!changed) { console.log('Idempotente.'); return }
  if (!APPLY) { console.log('DRY-RUN. --apply para PUT.'); return }
  const put = await fetch(`${apiBase}/workflows/${WF_ID}`, { method: 'PUT', headers: H, body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings ?? {} }) })
  console.log(`PUT → HTTP ${put.status}`)
  if (!put.ok) { console.error((await put.text()).replace(/[A-Za-z0-9_-]{20,}/g, '«redacted»').slice(0, 200)); process.exit(1) }
  const check = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H }).then((r) => r.json())
  console.log(`Verificación: active:${check.active} · nodos:${check.nodes.length} · scheduler:${check.nodes.some((n) => n.name === 'Automation Scheduler')} · [P68]:${String(check.nodes.find((n) => /crm agent/i.test(n.name || ''))?.parameters?.options?.systemMessage ?? '').includes('[P68')}`)
}
main()
