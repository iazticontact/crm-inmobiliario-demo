#!/usr/bin/env node
// P67 — Patch n8n vivo: tool crm_findings_check (auditoría de calidad + findings) + bloque [P67].
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

const P67_PROMPT = `

[P67 PROACTIVE INTELLIGENCE]
1. Cuando el usuario pregunte que requiere atencion, incidencias o calidad de datos, usa crm_findings_check. Cada finding trae titulo, criterio y severidad: presenta los hechos y el criterio, sin inventar urgencia.
2. Nuevas acciones disponibles via prepare/confirm: clients.update_email, tasks.update_due_date, portfolio.update_status. Los cambios de estado de inmueble validan TRANSICIONES (p. ej. sold solo puede pasar a archived); si el endpoint devuelve ACTION_TRANSITION_INVALID, explica las transiciones validas que indica el mensaje.
3. Los findings NUNCA modifican datos; para corregir algo, prepara una accion con confirmacion.`

const FINDINGS_TOOL = `const ws = $('Normalize input').first().json.workspaceId;
let res;
try {
  res = await this.helpers.httpRequest({
    method: 'POST',
    url: $env.CRM_BASE_URL + '/api/agent/automation',
    headers: { 'x-nowcrm-secret': $env.AGENT_TOOL_SECRET, 'Content-Type': 'application/json' },
    body: { operation: 'run_data_quality', workspace_id: ws },
    json: true,
    timeout: 20000,
  });
} catch (e) { return JSON.stringify({ ok: false, error: 'automation_endpoint_error' }); }
return JSON.stringify(res);`

async function main() {
  const res = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H })
  if (!res.ok) { console.error('GET →', res.status); process.exit(1) }
  const wf = await res.json()
  const dir = mkdtempSync(join(tmpdir(), 'n8n-p67-'))
  writeFileSync(join(dir, 'backup.json'), JSON.stringify(wf))
  console.log(`Workflow: ${wf.name} · active:${wf.active} · nodos:${wf.nodes.length} · backup: ${dir}`)
  const agent = wf.nodes.find((n) => /crm agent/i.test(n.name || ''))
  const sampleTool = wf.nodes.find((n) => /toolCode/i.test(n.type || ''))
  if (!agent || !sampleTool) { console.error('Faltan nodos base'); process.exit(1) }

  let changed = false
  const smPath = agent.parameters?.options && 'systemMessage' in agent.parameters.options ? 'options' : 'direct'
  const sm = smPath === 'options' ? agent.parameters.options.systemMessage : agent.parameters.systemMessage
  if (!String(sm).includes('[P67')) {
    if (smPath === 'options') agent.parameters.options.systemMessage = String(sm) + P67_PROMPT
    else agent.parameters.systemMessage = String(sm) + P67_PROMPT
    changed = true; console.log('Prompt: + [P67]')
  } else console.log('Prompt: [P67] ya presente')

  if (!wf.nodes.some((n) => n.name === 'crm_findings_check')) {
    wf.nodes.push({
      id: `p67-findings-${Math.random().toString(36).slice(2, 10)}`,
      name: 'crm_findings_check', type: sampleTool.type, typeVersion: sampleTool.typeVersion,
      position: [Number(sampleTool.position?.[0] ?? 0) + 1150, Number(sampleTool.position?.[1] ?? 0) + 320],
      parameters: { name: 'crm_findings_check', description: 'Ejecuta la auditoria de calidad de datos del CRM y devuelve las incidencias (findings) abiertas con titulo, criterio y severidad. Sin input. NUNCA modifica datos.', jsCode: FINDINGS_TOOL },
    })
    wf.connections['crm_findings_check'] = { ai_tool: [[{ node: agent.name, type: 'ai_tool', index: 0 }]] }
    changed = true; console.log('Tool crm_findings_check: añadida + conectada')
  } else console.log('Tool crm_findings_check: ya existe')

  if (!changed) { console.log('Idempotente.'); return }
  if (!APPLY) { console.log('DRY-RUN. --apply para PUT.'); return }
  const put = await fetch(`${apiBase}/workflows/${WF_ID}`, { method: 'PUT', headers: H, body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings ?? {} }) })
  console.log(`PUT → HTTP ${put.status}`)
  if (!put.ok) { console.error((await put.text()).replace(/[A-Za-z0-9_-]{20,}/g, '«redacted»').slice(0, 200)); process.exit(1) }
  const check = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H }).then((r) => r.json())
  const tools = check.nodes.filter((n) => /toolCode/i.test(n.type || ''))
  const sm2 = check.nodes.find((n) => /crm agent/i.test(n.name || ''))?.parameters?.options?.systemMessage ?? ''
  console.log(`Verificación: active:${check.active} · tools totales:${tools.length} · findings_check:${check.nodes.some((n) => n.name === 'crm_findings_check')} · [P67]:${String(sm2).includes('[P67')}`)
}
main()
