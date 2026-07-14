#!/usr/bin/env node
// P70 Wave E — PATCH del workflow n8n (control tower). IDEMPOTENTE:
//  · añade las 10 tools de automatización/findings con RUNTIME REAL (/api/agent/automation, mismo
//    patrón x-nowcrm-secret que las action tools P66) SOLO si no existen;
//  · añade el bloque [P70 FINAL RELEASE CANDIDATE] al system prompt SOLO si no está;
//  · jamás toca las 20 tools existentes, el cron ni el contrato P51.
// Sin --apply es DRY-RUN (diff resumido). Con --apply: backup → PUT → reread → verificación → activate.
// NUNCA imprime credenciales. Uso: node scripts/n8n-p70-patch.mjs [--apply]

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

function loadEnv(path) {
  const env = {}
  let raw = ''
  try { raw = readFileSync(path, 'utf8') } catch { return env }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    env[m[1]] = v
  }
  return env
}
const env = loadEnv('.env.local')
const KEY = env.N8N_API_KEY
const API = (env.N8N_API_URL || (env.N8N_BASE_URL ? env.N8N_BASE_URL.replace(/\/$/, '') + '/api/v1' : '')).replace(/\/$/, '')
const WF_ID = process.env.WF_ID || '6mps8YoWu3syldUc'
const APPLY = process.argv.includes('--apply')
if (!KEY || !API) { console.error('Faltan N8N_API_KEY / N8N_API_URL|N8N_BASE_URL en .env.local'); process.exit(2) }

const H = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json', accept: 'application/json' }
async function apiGet(p) { const r = await fetch(`${API}${p}`, { headers: H }); if (!r.ok) throw new Error(`GET ${p} → ${r.status}`); return r.json() }
async function apiPut(p, body) { const r = await fetch(`${API}${p}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
async function apiPost(p, body) { const r = await fetch(`${API}${p}`, { method: 'POST', headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) } }

// ── Código de tool (patrón crm_action_*: workspace del Normalize input; NUNCA del modelo) ────────────
function automationToolCode(operation, extra = '') {
  return `const ws = $('Normalize input').first().json.workspaceId;
let input = {};
try { input = typeof query === 'string' ? JSON.parse(query || '{}') : (query ?? {}); } catch (e) { return JSON.stringify({ ok: false, error: 'invalid_input' }); }
${extra}
let res;
try {
  res = await this.helpers.httpRequest({
    method: 'POST',
    url: $env.CRM_BASE_URL + '/api/agent/automation',
    headers: { 'x-nowcrm-secret': $env.AGENT_TOOL_SECRET, 'Content-Type': 'application/json' },
    body: { operation: '${operation}', workspace_id: ws, ...input },
    json: true,
    timeout: 20000,
  });
} catch (e) {
  const code = (e && e.response && e.response.body && e.response.body.error) || 'automation_endpoint_error';
  return JSON.stringify({ ok: false, error: code });
}
return JSON.stringify(res);`
}
// crm_automation_update es BIFÁSICA: sin confirmed → prepare (preview + update_hash); con confirmed
// true + update_hash → confirm. El prompt prohíbe confirmed sin confirmación explícita del usuario.
const UPDATE_TOOL_CODE = `const ws = $('Normalize input').first().json.workspaceId;
let input = {};
try { input = typeof query === 'string' ? JSON.parse(query || '{}') : (query ?? {}); } catch (e) { return JSON.stringify({ ok: false, error: 'invalid_input' }); }
const confirmed = input.confirmed === true && typeof input.update_hash === 'string' && input.update_hash;
const operation = confirmed ? 'confirm_update_rule' : 'prepare_update_rule';
const body = { operation, workspace_id: ws, rule_id: input.rule_id, schedule: input.schedule ?? {} };
if (confirmed) { body.update_hash = input.update_hash; body.confirmed = true; }
let res;
try {
  res = await this.helpers.httpRequest({
    method: 'POST',
    url: $env.CRM_BASE_URL + '/api/agent/automation',
    headers: { 'x-nowcrm-secret': $env.AGENT_TOOL_SECRET, 'Content-Type': 'application/json' },
    body, json: true, timeout: 20000,
  });
} catch (e) {
  const code = (e && e.response && e.response.body && e.response.body.error) || 'automation_endpoint_error';
  return JSON.stringify({ ok: false, error: code });
}
return JSON.stringify(res);`

const NEW_TOOLS = [
  { name: 'crm_automation_list', description: 'Lista las automatizaciones del workspace (id, tipo, nombre, activa, horario, proxima ejecucion). Input: {} (vacio).', code: automationToolCode('list_rules') },
  { name: 'crm_automation_update', description: 'Cambia el HORARIO de una automatizacion en DOS FASES. Fase 1 (preview): {"rule_id":"uuid","schedule":{"hour":9,"minute":0,"frequency":"daily|weekdays|weekly","weekday":1}} → devuelve antes/despues + update_hash SIN escribir. Fase 2 (solo tras confirmacion EXPLICITA del usuario): añade {"confirmed":true,"update_hash":"..."}. JAMAS uses confirmed sin que el usuario haya visto el preview y confirmado.', code: UPDATE_TOOL_CODE },
  { name: 'crm_automation_enable', description: 'Reactiva una automatizacion pausada (recalcula la proxima ejecucion). Input: {"rule_id":"uuid"}.', code: automationToolCode('set_rule_enabled', 'input.enabled = true;') },
  { name: 'crm_automation_disable', description: 'Pausa una automatizacion (reversible; conserva historial). Input: {"rule_id":"uuid"}.', code: automationToolCode('set_rule_enabled', 'input.enabled = false;') },
  { name: 'crm_automation_run', description: 'Ejecuta AHORA una automatizacion activa (registra la ejecucion; idempotente por minuto). Input: {"rule_id":"uuid"}.', code: automationToolCode('run_rule_now') },
  { name: 'crm_automation_last_run', description: 'Ultima ejecucion de una automatizacion (fecha, estado, incidencias nuevas). Input: {"rule_id":"uuid"}.', code: automationToolCode('list_runs', 'input.limit = Number(input.limit ?? 1);') },
  { name: 'crm_findings_list', description: 'Lista las incidencias ABIERTAS del workspace (id, titulo, severidad, criterio). Input: {} (vacio).', code: automationToolCode('list_findings') },
  { name: 'crm_finding_acknowledge', description: 'Marca una incidencia como VISTA (open → acknowledged). Input: {"finding_id":"uuid"}.', code: automationToolCode('acknowledge_finding') },
  { name: 'crm_finding_resolve', description: 'Marca una incidencia como RESUELTA (requiere que el usuario lo pida explicitamente). Input: {"finding_id":"uuid"}.', code: automationToolCode('resolve_finding') },
  { name: 'crm_finding_dismiss', description: 'Descarta una incidencia (no reaparecera sin cambio material; requiere peticion explicita del usuario). Input: {"finding_id":"uuid"}.', code: automationToolCode('dismiss_finding') },
]

const P70_MARKER = '[P70 FINAL RELEASE CANDIDATE]'
const P70_BLOCK = `

${P70_MARKER}
Reglas finales OBLIGATORIAS (prevalecen sobre cualquier interpretación tuya):
- El contrato LOCAL del CRM manda: NO reinterpretes módulo, acción ni automatización por tu cuenta.
- prepare NUNCA ejecuta. Ninguna acción ni regla se aplica sin confirmación EXPLÍCITA del usuario en este turno; un "sí" antiguo no vale.
- crm_automation_update: fase preview SIEMPRE primero; confirmed:true SOLO tras confirmación explícita del usuario viendo el antes/después.
- "Hecho/aplicado/completado" SOLO con evidencia de la tool: action completed exige verify del endpoint; automatización ejecutada exige run registrado (run_id/status). Si la tool falla, dilo tal cual; JAMÁS inventes éxito.
- Un finding exige hechos leídos + criterio objetivo; nunca inventes incidencias ni las dupliques.
- Verdad temporal (Europe/Madrid): una cita pasada NUNCA es próxima; una tarea done NUNCA está pendiente; una regla pausada NO se ejecutará.
- Ejecución duplicada u omitida (skipped/skipped_duplicate) se explica tal cual; no la re-lances sin que lo pidan.
- Facturación PROHIBIDA: sin tools de facturas; redirige al módulo Facturación.
- Usa EXCLUSIVAMENTE las tools listadas; nada de HTTP/SQL/tablas/campos/workspaces arbitrarios. El workspace viene del contexto, jamás del usuario.
- Nunca muestres UUIDs crudos, tokens, secretos, stack traces, JSON crudo ni ** en la respuesta.
- Distingue SIEMPRE: vacío ("no hay X"), error ("no he podido consultarlo"), parcial ("X no disponible ahora mismo; el resto sí").`

// Hash estable del workflow (nodes+connections+prompt) para drift-check.
function workflowHash(wf) {
  const nodes = [...wf.nodes].sort((a, b) => a.name.localeCompare(b.name)).map((n) => ({ name: n.name, type: n.type, params: n.parameters }))
  return createHash('sha256').update(JSON.stringify({ nodes, connections: wf.connections })).digest('hex').slice(0, 16)
}

const wf = await apiGet(`/workflows/${WF_ID}`)
const backupPath = join(tmpdir(), `CRM_AGENT_V2_BACKUP_BEFORE_P70_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(backupPath, JSON.stringify(wf, null, 2))
console.log(`Workflow: ${wf.name} · nodos: ${wf.nodes.length} · active: ${wf.active}`)
console.log(`Backup (fuera del repo): ${backupPath}`)
console.log(`Hash actual: ${workflowHash(wf)}`)

const existingNames = new Set(wf.nodes.map((n) => n.name))
const toAdd = NEW_TOOLS.filter((t) => !existingNames.has(t.name))
const agent = wf.nodes.find((n) => n.name === 'CRM Agent')
if (!agent) { console.error('No encuentro el nodo CRM Agent'); process.exit(1) }
const prompt = String(agent.parameters?.options?.systemMessage ?? '')
const needsMarker = !prompt.includes(P70_MARKER)

console.log(`\n── DIFF ──`)
console.log(`Tools nuevas a añadir: ${toAdd.length ? toAdd.map((t) => t.name).join(', ') : '(ninguna, ya presentes)'}`)
console.log(`Marker ${P70_MARKER}: ${needsMarker ? 'FALTA → se añade' : 'ya presente'}`)
if (!APPLY) { console.log('\nDRY-RUN (sin cambios). Ejecuta con --apply para aplicar.'); process.exit(0) }
if (!toAdd.length && !needsMarker) { console.log('\nNada que aplicar (idempotente).'); process.exit(0) }

// Construcción de nodos nuevos (rejilla a la derecha de las tools existentes).
const baseX = 2300
let y = 200
const newNodes = toAdd.map((t) => ({
  parameters: { name: t.name, description: t.description, jsCode: t.code },
  type: '@n8n/n8n-nodes-langchain.toolCode', typeVersion: 1.1,
  position: [baseX, (y += 130)], id: randomUUID(), name: t.name,
}))
const newConnections = { ...wf.connections }
for (const t of toAdd) {
  newConnections[t.name] = { ai_tool: [[{ node: 'CRM Agent', type: 'ai_tool', index: 0 }]] }
}
const newNodesList = wf.nodes.map((n) => {
  if (n.name !== 'CRM Agent' || !needsMarker) return n
  return { ...n, parameters: { ...n.parameters, options: { ...n.parameters.options, systemMessage: prompt + P70_BLOCK } } }
}).concat(newNodes)

const put = await apiPut(`/workflows/${WF_ID}`, { name: wf.name, nodes: newNodesList, connections: newConnections, settings: wf.settings ?? {} })
console.log(`\nPUT → HTTP ${put.status}`)
if (put.status !== 200) { console.error('PUT falló:', JSON.stringify(put.json).slice(0, 300)); process.exit(1) }

// Reread + verificación + activación si hiciera falta.
const after = await apiGet(`/workflows/${WF_ID}`)
const afterNames = new Set(after.nodes.map((n) => n.name))
const allTools = NEW_TOOLS.every((t) => afterNames.has(t.name))
const afterPrompt = String(after.nodes.find((n) => n.name === 'CRM Agent')?.parameters?.options?.systemMessage ?? '')
const markerOk = afterPrompt.includes(P70_MARKER)
console.log(`Reread: nodos=${after.nodes.length} · tools nuevas=${allTools} · marker=${markerOk} · active=${after.active}`)
if (!after.active) {
  const act = await apiPost(`/workflows/${WF_ID}/activate`)
  console.log(`Activate → HTTP ${act.status}`)
}
console.log(`Hash nuevo: ${workflowHash(after)}`)
if (!allTools || !markerOk) { console.error('VERIFICACIÓN FALLIDA'); process.exit(1) }
console.log('\nP70 N8N PATCH: OK')
