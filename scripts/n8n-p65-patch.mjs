#!/usr/bin/env node
// P65 — Patch REAL del workflow n8n vivo: (1) bloque [P65 ACTION CONTROL PLANE] en el system prompt;
// (2) DOS tools de acción (crm_action_prepare / crm_action_confirm) que llaman a /api/agent/action con
// x-nowcrm-secret, conectadas al CRM Agent como ai_tool. Idempotente; dry-run por defecto, --apply para PUT.
// No imprime secretos. Uso: node scripts/n8n-p65-patch.mjs [--apply]

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

const P65_PROMPT = `

[P65 ACTION CONTROL PLANE] Acciones de escritura (obligatorio):
1. NUNCA ejecutes una accion en el turno de preparacion. Flujo: crm_action_prepare → mostrar el preview al usuario (entidad, valor actual, valor nuevo) → esperar confirmacion EXPLICITA → crm_action_confirm con el action_token EXACTO que devolvio prepare.
2. Un "si" solo confirma si hay una accion preparada en ESTA conversacion y el usuario se refiere a ella. "si explicame" o un "si" tras cambiar de tema NO confirman.
3. No cambies action_type, entidad ni campos despues del preview. No inventes campos. Solo las acciones soportadas: tasks.create, tasks.complete, portfolio.update_price, clients.update_phone.
4. Tras confirmar, el resultado ya viene VERIFICADO (read-after-write). Si status es ACTION_CONFLICT, informa del conflicto y ofrece preparar de nuevo; NUNCA reintentes a ciegas ni afirmes exito.
5. Si confirm devuelve duplicate:true, el cambio YA estaba aplicado: no lo presentes como nueva escritura.
6. Nada de Facturacion. No muestres action_token, UUID ni JSON crudo al usuario.`

const mkToolCode = (operation) => `const ws = $('Normalize input').first().json.workspaceId;
let input = {};
try { input = typeof query === 'string' ? JSON.parse(query) : (query ?? {}); } catch (e) { return JSON.stringify({ ok: false, error: 'invalid_input', message: 'El input debe ser JSON.' }); }
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
  { name: 'crm_action_prepare', desc: 'Prepara una accion de escritura del CRM (NO la ejecuta). Input JSON: {"action_type":"tasks.create|tasks.complete|portfolio.update_price|clients.update_phone","entity_id":"uuid si aplica","proposed_changes":{...},"conversation_id":"opcional"}. Devuelve preview + action_token. SIEMPRE mostrar el preview y esperar confirmacion.', op: 'prepare' },
  { name: 'crm_action_confirm', desc: 'Confirma y ejecuta una accion PREVIAMENTE preparada, solo tras confirmacion explicita del usuario. Input JSON: {"action_token":"act...."}. Devuelve resultado verificado (read-after-write) o ACTION_CONFLICT.', op: 'confirm' },
]

async function main() {
  const res = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H })
  if (!res.ok) { console.error('GET →', res.status); process.exit(1) }
  const wf = await res.json()
  // Backup fuera de git.
  const dir = mkdtempSync(join(tmpdir(), 'n8n-p65-'))
  writeFileSync(join(dir, 'backup.json'), JSON.stringify(wf))
  console.log(`Workflow: ${wf.name} · active:${wf.active} · nodos:${wf.nodes.length} · backup: ${dir}`)

  const agent = wf.nodes.find((n) => /crm agent/i.test(n.name || ''))
  const sampleTool = wf.nodes.find((n) => /toolCode/i.test(n.type || ''))
  if (!agent || !sampleTool) { console.error('Faltan nodos base'); process.exit(1) }

  let changed = false
  // 1) Prompt [P65]
  const smPath = agent.parameters?.options && 'systemMessage' in agent.parameters.options ? 'options' : 'direct'
  const sm = smPath === 'options' ? agent.parameters.options.systemMessage : agent.parameters.systemMessage
  if (!String(sm).includes('[P65')) {
    if (smPath === 'options') agent.parameters.options.systemMessage = String(sm) + P65_PROMPT
    else agent.parameters.systemMessage = String(sm) + P65_PROMPT
    changed = true
    console.log('Prompt: + bloque [P65]')
  } else console.log('Prompt: [P65] ya presente')

  // 2) Tools de acción
  let px = 0
  for (const t of TOOLS) {
    if (wf.nodes.some((n) => n.name === t.name)) { console.log(`Tool ${t.name}: ya existe`); continue }
    const node = {
      id: `p65-${t.op}-${Math.random().toString(36).slice(2, 10)}`,
      name: t.name,
      type: sampleTool.type,
      typeVersion: sampleTool.typeVersion,
      position: [Number(sampleTool.position?.[0] ?? 0) + 240 + px, Number(sampleTool.position?.[1] ?? 0) + 320],
      parameters: { name: t.name, description: t.desc, jsCode: mkToolCode(t.op) },
    }
    px += 220
    wf.nodes.push(node)
    wf.connections[t.name] = { ai_tool: [[{ node: agent.name, type: 'ai_tool', index: 0 }]] }
    changed = true
    console.log(`Tool ${t.name}: añadida + conectada a ${agent.name}`)
  }

  if (!changed) { console.log('Idempotente: nada que aplicar.'); return }
  if (!APPLY) { console.log('DRY-RUN. Ejecuta con --apply para PUT.'); return }

  const put = await fetch(`${apiBase}/workflows/${WF_ID}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings ?? {} }),
  })
  console.log(`PUT → HTTP ${put.status}`)
  if (!put.ok) { console.error((await put.text()).replace(/[A-Za-z0-9_-]{20,}/g, '«redacted»').slice(0, 300)); process.exit(1) }

  // Verificación en fresco.
  const check = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H }).then((r) => r.json())
  const tools = check.nodes.filter((n) => /toolCode/i.test(n.type || ''))
  const actionTools = tools.filter((n) => /crm_action_(prepare|confirm)/.test(n.name))
  const readTools = tools.filter((n) => String(n.parameters?.jsCode || '').includes('x-nowcrm-turn-policy'))
  const agent2 = check.nodes.find((n) => /crm agent/i.test(n.name || ''))
  const sm2 = agent2?.parameters?.options?.systemMessage ?? agent2?.parameters?.systemMessage ?? ''
  const wired = actionTools.every((t) => JSON.stringify(check.connections[t.name] ?? {}).includes(agent2?.name ?? 'CRM Agent'))
  console.log(`Verificación: active:${check.active} · tools lectura con policy: ${readTools.length} · tools acción: ${actionTools.length}/2 conectadas:${wired} · [P65] prompt: ${String(sm2).includes('[P65')}`)
}
main()
