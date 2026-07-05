#!/usr/bin/env node
// P51C — Parchea un workflow de n8n EXPORTADO (JSON) para el contrato del Turn Policy Token.
// Añade la cabecera `x-nowcrm-turn-policy` a cada nodo HTTP Request que llama a /api/agent/tool, con una
// expresión que referencia el token recibido en el webhook. NO toca credenciales ni secretos. NO llama a
// ningún sitio: solo transforma el JSON localmente y escribe `<archivo>.patched.json`.
//
// Uso:
//   node scripts/patch-n8n-workflow.mjs <ruta-al-workflow-exportado.json>
//
// Después: importar el .patched.json en n8n (Import from File / actualizar workflow) y activar.
// El system prompt del agente hay que actualizarlo A MANO (el patcher imprime el texto a pegar; reescribir
// prompts automáticamente es arriesgado).

import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2] || process.env.WORKFLOW_JSON
if (!src) {
  console.error('Uso: node scripts/patch-n8n-workflow.mjs <workflow-exportado.json>')
  process.exit(2)
}

let wf
try {
  wf = JSON.parse(readFileSync(src, 'utf8'))
} catch (e) {
  console.error('No pude leer/parsear el JSON:', e?.message || e)
  process.exit(2)
}

const nodes = Array.isArray(wf.nodes) ? wf.nodes : null
if (!nodes) {
  console.error('El JSON no parece un workflow de n8n (falta `nodes`).')
  process.exit(2)
}

// Nombre del nodo trigger/webhook → para referenciar el token con seguridad.
const trigger = nodes.find((n) => typeof n.type === 'string' && /webhook|formTrigger|trigger/i.test(n.type))
const webhookName = trigger?.name
const tokenExpr = webhookName
  ? `={{ $('${webhookName}').item.json.body?.turnPolicyToken || $('${webhookName}').item.json.turnPolicyToken || $json.turnPolicyToken }}`
  : '={{ $json.body?.turnPolicyToken || $json.turnPolicyToken }}'

const HEADER = 'x-nowcrm-turn-policy'
const isToolCall = (n) => {
  if (typeof n.type !== 'string' || !/httpRequest/i.test(n.type)) return false
  const url = n.parameters?.url
  return typeof url === 'string' && /\/api\/agent\/tool/.test(url)
}

let changed = 0
const touched = []
for (const n of nodes) {
  if (!isToolCall(n)) continue
  n.parameters = n.parameters || {}
  // Estructura v4: sendHeaders + headerParameters.parameters[]
  n.parameters.sendHeaders = true
  const hp = (n.parameters.headerParameters = n.parameters.headerParameters || {})
  const list = (hp.parameters = Array.isArray(hp.parameters) ? hp.parameters : [])
  const existing = list.find((p) => typeof p?.name === 'string' && p.name.toLowerCase() === HEADER)
  if (existing) { existing.value = tokenExpr }
  else { list.push({ name: HEADER, value: tokenExpr }) }
  changed++
  touched.push(n.name || '(sin nombre)')
}

const out = src.replace(/\.json$/i, '') + '.patched.json'
writeFileSync(out, JSON.stringify(wf, null, 2), 'utf8')

console.log('\n── Parche P51C ──')
console.log(`Trigger/webhook detectado: ${webhookName ?? '(no encontrado → uso $json)'}`)
console.log(`Nodos HTTP a /api/agent/tool encontrados y parcheados: ${changed}`)
for (const t of touched) console.log(`  • ${t}  (+ header ${HEADER})`)
if (changed === 0) console.log('  ⚠ Ninguno. Revisa que la URL de los nodos contenga "/api/agent/tool".')
console.log(`\nEscrito: ${out}`)
console.log('\nSiguiente: importa ese .patched.json en n8n y ACTUALIZA el system prompt del agente con las')
console.log('reglas de docs/AGENT_N8N_CONTRACT.md §4 (por clases de turno, no por frases). Luego activa el')
console.log('workflow y ejecuta `node scripts/verify-tool-policy.mjs`.')
process.exit(0)
