#!/usr/bin/env node
// P64 — Patch REAL del workflow n8n vivo: añade el bloque de reglas [P64] al system prompt del CRM Agent.
// Idempotente (marcador [P64]); dry-run por defecto, `--apply` para PUT. Backup previo via n8n-inspect.
// No imprime secretos. Uso: node scripts/n8n-p64-patch.mjs [--apply]

import { readFileSync } from 'node:fs'
function envLocal(name) {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined
}
const key = process.env.N8N_API_KEY || envLocal('N8N_API_KEY')
let apiBase = (process.env.N8N_API_URL || envLocal('N8N_API_URL') || ((process.env.N8N_BASE_URL || envLocal('N8N_BASE_URL') || '').replace(/\/$/, '') + '/api/v1')).replace(/\/$/, '')
if (!/\/api\/v\d+$/.test(apiBase)) apiBase += '/api/v1'
const WF_ID = process.env.WF_ID || '6mps8YoWu3syldUc'
const APPLY = process.argv.includes('--apply')
if (!key || !apiBase) { console.error('Faltan N8N_API_KEY / N8N_API_URL|N8N_BASE_URL'); process.exit(2) }
const H = { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json', accept: 'application/json' }

const P64_RULES = `

[P64] REGLAS ADICIONALES (obligatorias):
1. MODULO EXPLICITO: si el mensaje actual nombra inmuebles/cartera/propiedades, la respuesta es de ese modulo. PROHIBIDO responder con tareas/agenda/citas salvo peticion combinada expresa. La palabra "todo" NUNCA significa tareas.
2. VERDAD TEMPORAL: una cita con fecha anterior a hoy NUNCA es "proxima" (es pasada). Una tarea completada NUNCA es "pendiente" ni "vencida activa" (puedes decir "completada; su fecha limite era ..."). Vencida = pendiente + fecha limite anterior a hoy.
3. SI/NO PRIMERO: si preguntan "¿tengo...?" responde primero "Si," o "No," y despues el detalle con cifras de los tool results.
4. TEXTO LIMPIO: no uses ** ni markdown crudo en la respuesta; texto plano con bullets "•".
5. Cada cifra debe venir de un tool result de ESTA conversacion. Si una fuente falla, da las demas (parcial) y dilo; nunca "fallo temporal" total si algo respondio.`

async function main() {
  console.log('base:', apiBase.replace(/\/\/[^/]+/, '//<host>'))
  const res = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H })
  if (!res.ok) { console.error('GET workflow →', res.status, (await res.text()).replace(/[A-Za-z0-9_-]{20,}/g, '«redacted»').slice(0, 160)); process.exit(1) }
  const wf = await res.json()
  const agent = (wf.nodes || []).find((n) => /agent/i.test(n.type || '') && /crm agent/i.test(n.name || ''))
  if (!agent) { console.error('Nodo CRM Agent no encontrado'); process.exit(1) }
  const sm = agent.parameters?.options?.systemMessage ?? agent.parameters?.systemMessage ?? ''
  const already = String(sm).includes('[P64]')
  console.log(`Workflow: ${wf.name} · active:${wf.active} · nodos:${(wf.nodes || []).length}`)
  console.log(`CRM Agent systemMessage: ${String(sm).length} chars · [P64] presente: ${already}`)
  if (already) { console.log('Idempotente: nada que hacer.'); return }
  if (!APPLY) { console.log('DRY-RUN: añadiría el bloque [P64] (' + P64_RULES.length + ' chars). Ejecuta con --apply.'); return }
  const next = String(sm) + P64_RULES
  if (agent.parameters?.options && 'systemMessage' in agent.parameters.options) agent.parameters.options.systemMessage = next
  else agent.parameters.systemMessage = next
  const put = await fetch(`${apiBase}/workflows/${WF_ID}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings ?? {} }),
  })
  console.log(`PUT → HTTP ${put.status}`)
  if (!put.ok) { console.error((await put.text()).slice(0, 200)); process.exit(1) }
  // Verificación en fresco.
  const check = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H }).then((r) => r.json())
  const agent2 = (check.nodes || []).find((n) => /crm agent/i.test(n.name || ''))
  const sm2 = agent2?.parameters?.options?.systemMessage ?? agent2?.parameters?.systemMessage ?? ''
  const tools = (check.nodes || []).filter((n) => /toolCode/i.test(n.type || '') && /\/api\/agent\/tool/.test(String(n.parameters?.jsCode || '')))
  const withTP = tools.filter((n) => String(n.parameters?.jsCode || '').includes('x-nowcrm-turn-policy'))
  console.log(`Verificación: [P64] presente: ${String(sm2).includes('[P64]')} · active:${check.active} · tools ${withTP.length}/${tools.length} con policy header`)
}
main()
