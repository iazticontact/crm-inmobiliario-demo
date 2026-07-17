#!/usr/bin/env node
// P71 — PATCH del workflow n8n (CRM Agent V2): añade el bloque [P71 ADAPTIVE CONVERSATIONAL INTELLIGENCE]
// al system prompt SOLO si no está (idempotente). NO toca tools, cron, contrato P51 ni el bloque P70.
// El bloque enseña al agente a CONSUMIR el campo `conversationState` (proyección reducida del estado
// compartido con local-first) con reglas GENERALES: contexto para entender, jamás fuente de datos.
// Sin --apply es DRY-RUN (diff seguro). Con --apply: backup → PUT → reread → verificación.
// NUNCA imprime credenciales. Uso: node scripts/n8n-p71-patch.mjs [--apply]

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

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

const P71_MARKER = '[P71 ADAPTIVE CONVERSATIONAL INTELLIGENCE]'
const P71_BLOCK = `

${P71_MARKER}
El body del webhook puede incluir "conversationState": la MISMA memoria estructurada del hilo que usa el
backend (activeModule, activeCapability, activeEntities[{type,id,label}], temporal{start,end,interpretation},
pendingIntent{capability,missingSlots}, lastQuery{module,entityType}). Reglas GENERALES:
1. USALO COMO CONTEXTO para entender continuidad: pronombres/elipsis se refieren a activeEntities; una
   continuacion temporal hereda temporal (start/end) salvo que el usuario indique otro periodo; si el
   mensaje encaja como complemento de pendingIntent, pide SOLO los missingSlots que falten.
2. JAMAS respondas datos desde conversationState ni desde la memoria del hilo: para CUALQUIER dato actual
   llama SIEMPRE a una tool (releer es obligatorio aunque creas conocer la respuesta).
3. Los ids de activeEntities son REFERENCIAS del backend: usalos como parametros de tools (p.ej. clientId)
   sin inventarlos ni alterarlos; el workspace es SIEMPRE el del Normalize input, nunca el del estado.
4. pendingIntent NUNCA se ejecuta desde aqui: si el usuario confirma una accion, la preparacion/confirmacion
   la hacen las action tools bifasicas existentes (preview antes de escribir). No alteres proposedChanges.
5. Si conversationState esta vacio o falta, opera como hasta ahora (activeEntity/recentMessages).
6. Nada de esto cambia las reglas previas: Facturacion prohibida, turn policy obligatoria, cero UUIDs en la
   respuesta, y ante ambiguedad real pregunta en vez de elegir en silencio.
Al final, en activeEntityUpdate devuelve la entidad que REALMENTE resolviste este turno (type,id,label), como
ya haces: el backend fusiona esa actualizacion en el estado compartido.`

const wf = await apiGet(`/workflows/${WF_ID}`)
const nodes = wf.nodes ?? []
const agent = nodes.find((n) => n.name === 'CRM Agent')
if (!agent) { console.error('Nodo "CRM Agent" no encontrado'); process.exit(1) }
const prompt = String(agent.parameters?.options?.systemMessage ?? '')
const hashOf = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

console.log(`Workflow: ${wf.name} · nodos=${nodes.length} · active=${wf.active}`)
console.log(`Prompt actual: ${prompt.length} chars · hash=${hashOf(prompt)}`)
console.log(`Marker P70 presente: ${prompt.includes('[P70 FINAL RELEASE CANDIDATE]')}`)
console.log(`Marker P71 presente: ${prompt.includes(P71_MARKER)}`)

if (prompt.includes(P71_MARKER)) { console.log('\nYa parcheado (idempotente). Nada que hacer.'); process.exit(0) }

console.log(`\nDIFF (append al system prompt, ${P71_BLOCK.length} chars):`)
console.log(P71_BLOCK.slice(0, 400) + '…')

if (!APPLY) { console.log('\nDRY-RUN (usa --apply para aplicar).'); process.exit(0) }

// Backup COMPLETO fuera del repo.
const backupPath = join(tmpdir(), `CRM_AGENT_V2_BACKUP_BEFORE_P71_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(backupPath, JSON.stringify(wf, null, 2))
console.log(`\nBackup (fuera del repo): ${backupPath}`)

const newNodes = nodes.map((n) => n.name === 'CRM Agent'
  ? { ...n, parameters: { ...n.parameters, options: { ...n.parameters.options, systemMessage: prompt + P71_BLOCK } } }
  : n)
const put = await apiPut(`/workflows/${WF_ID}`, { name: wf.name, nodes: newNodes, connections: wf.connections, settings: wf.settings })
console.log(`PUT → HTTP ${put.status}`)
if (put.status !== 200) { console.error('PUT falló:', JSON.stringify(put.json).slice(0, 300)); process.exit(1) }

const after = await apiGet(`/workflows/${WF_ID}`)
const afterAgent = after.nodes.find((n) => n.name === 'CRM Agent')
const afterPrompt = String(afterAgent?.parameters?.options?.systemMessage ?? '')
const ok = afterPrompt.includes(P71_MARKER) && afterPrompt.includes('[P70 FINAL RELEASE CANDIDATE]') && after.nodes.length === nodes.length && after.active === wf.active
console.log(`Reread: nodos=${after.nodes.length} · active=${after.active} · prompt=${afterPrompt.length} chars · hash=${hashOf(afterPrompt)}`)
console.log(`Markers: P70=${afterPrompt.includes('[P70 FINAL RELEASE CANDIDATE]')} · P71=${afterPrompt.includes(P71_MARKER)}`)
console.log(ok ? 'PATCH P71 VERIFICADO ✅' : 'VERIFICACIÓN FALLIDA ⛔ (restaurar backup)')
process.exit(ok ? 0 : 1)
