#!/usr/bin/env node
// P66 — Patch n8n vivo: tools crm_action_cancel / crm_action_status + bloque [P66 CHAT ACTION INTEGRATION]
// en el prompt. Idempotente; dry-run por defecto, --apply para PUT. Backup en temp. Sin secretos.

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

const P66_PROMPT = `

[P66 CHAT ACTION INTEGRATION]
1. El flujo de acciones tiene 4 tools: crm_action_prepare, crm_action_confirm, crm_action_cancel, crm_action_status. Usa cancel cuando el usuario descarte el cambio ("cancela", "mejor no", "dejalo") y status cuando pregunte que cambio tiene pendiente.
2. Una MODIFICACION del preview ("mejor 285.000") = cancel de la accion anterior + prepare nuevo. NUNCA edites la accion anterior ni reutilices su token.
3. Si confirm devuelve ACTION_EXPIRED o ACTION_CANCELLED, informa y ofrece preparar de nuevo. Si devuelve ACTION_CONFLICT, muestra el valor actual y NO reintentes.
4. No declares cancelacion sin status cancelled del tool result. No declares exito sin status completed.`

const mkToolCode = (operation) => `const ws = $('Normalize input').first().json.workspaceId;
let input = {};
try { input = typeof query === 'string' ? JSON.parse(query) : (query ?? {}); } catch (e) { return JSON.stringify({ ok: false, error: 'invalid_input' }); }
let res;
try {
  res = await this.helpers.httpRequest({
    method: 'POST',
    url: $env.CRM_BASE_URL + '/api/agent/action',
    headers: { 'x-nowcrm-secret': $env.AGENT_TOOL_SECRET, 'Content-Type': 'application/json' },
    body: { operation: '${operation}', workspace_id: ws, ...input },
    json: true,
    timeout: 15000,
  });
} catch (e) {
  const code = (e && e.response && e.response.body && e.response.body.error) || 'action_endpoint_error';
  return JSON.stringify({ ok: false, error: code });
}
return JSON.stringify(res);`

const TOOLS = [
  { name: 'crm_action_cancel', desc: 'Cancela una accion preparada (descarta el cambio sin ejecutarlo). Input JSON: {"action_id":"uuid"}.', op: 'cancel' },
  { name: 'crm_action_status', desc: 'Consulta el estado de una accion (prepared/completed/cancelled/expired/conflict). Input JSON: {"action_id":"uuid"}.', op: 'status' },
]

async function main() {
  const res = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H })
  if (!res.ok) { console.error('GET →', res.status); process.exit(1) }
  const wf = await res.json()
  const dir = mkdtempSync(join(tmpdir(), 'n8n-p66-'))
  writeFileSync(join(dir, 'backup.json'), JSON.stringify(wf))
  console.log(`Workflow: ${wf.name} · active:${wf.active} · nodos:${wf.nodes.length} · backup: ${dir}`)

  const agent = wf.nodes.find((n) => /crm agent/i.test(n.name || ''))
  const sampleTool = wf.nodes.find((n) => /toolCode/i.test(n.type || ''))
  if (!agent || !sampleTool) { console.error('Faltan nodos base'); process.exit(1) }

  let changed = false
  const smPath = agent.parameters?.options && 'systemMessage' in agent.parameters.options ? 'options' : 'direct'
  const sm = smPath === 'options' ? agent.parameters.options.systemMessage : agent.parameters.systemMessage
  if (!String(sm).includes('[P66')) {
    if (smPath === 'options') agent.parameters.options.systemMessage = String(sm) + P66_PROMPT
    else agent.parameters.systemMessage = String(sm) + P66_PROMPT
    changed = true; console.log('Prompt: + [P66]')
  } else console.log('Prompt: [P66] ya presente')

  let px = 0
  for (const t of TOOLS) {
    if (wf.nodes.some((n) => n.name === t.name)) { console.log(`Tool ${t.name}: ya existe`); continue }
    wf.nodes.push({
      id: `p66-${t.op}-${Math.random().toString(36).slice(2, 10)}`,
      name: t.name, type: sampleTool.type, typeVersion: sampleTool.typeVersion,
      position: [Number(sampleTool.position?.[0] ?? 0) + 700 + px, Number(sampleTool.position?.[1] ?? 0) + 320],
      parameters: { name: t.name, description: t.desc, jsCode: mkToolCode(t.op) },
    })
    wf.connections[t.name] = { ai_tool: [[{ node: agent.name, type: 'ai_tool', index: 0 }]] }
    px += 220; changed = true
    console.log(`Tool ${t.name}: añadida + conectada`)
  }

  if (!changed) { console.log('Idempotente: nada que aplicar.'); return }
  if (!APPLY) { console.log('DRY-RUN. --apply para PUT.'); return }
  const put = await fetch(`${apiBase}/workflows/${WF_ID}`, { method: 'PUT', headers: H, body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings ?? {} }) })
  console.log(`PUT → HTTP ${put.status}`)
  if (!put.ok) { console.error((await put.text()).replace(/[A-Za-z0-9_-]{20,}/g, '«redacted»').slice(0, 200)); process.exit(1) }
  const check = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H }).then((r) => r.json())
  const actionTools = check.nodes.filter((n) => /crm_action_(prepare|confirm|cancel|status)/.test(n.name))
  const sm2 = check.nodes.find((n) => /crm agent/i.test(n.name || ''))?.parameters?.options?.systemMessage ?? ''
  console.log(`Verificación: active:${check.active} · tools acción: ${actionTools.length}/4 · [P66]: ${String(sm2).includes('[P66')}`)
}
main()
