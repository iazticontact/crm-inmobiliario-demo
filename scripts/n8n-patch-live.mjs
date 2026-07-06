#!/usr/bin/env node
// P51C — Parchea el workflow VIVO del Asistente vía API de n8n (dry-run por defecto; --apply para escribir).
// 1) Normalize input: expone `turnPolicyToken` desde el body del webhook.
// 2) Cada toolCode que llama a /api/agent/tool: añade la cabecera `x-nowcrm-turn-policy` (desde Normalize).
// 3) CRM Agent: añade el CONTRATO de herramientas (por clases de turno) al systemMessage.
// Idempotente. No imprime secretos (los valores viajan por $env dentro de n8n; aquí no se tocan).
//
// Uso:
//   node scripts/n8n-patch-live.mjs            # dry-run: dice qué cambiaría, no escribe
//   node scripts/n8n-patch-live.mjs --apply    # aplica (PUT) y re-activa el workflow

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function loadEnv(path) {
  const env = {}; let raw = ''
  try { raw = readFileSync(path, 'utf8') } catch { return env }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (!m) continue
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    env[m[1]] = v
  }
  return env
}

const APPLY = process.argv.includes('--apply')
const env = loadEnv('.env.local')
const key = env.N8N_API_KEY
const apiBase = (env.N8N_API_URL || (env.N8N_BASE_URL ? env.N8N_BASE_URL.replace(/\/$/, '') + '/api/v1' : '')).replace(/\/$/, '')
const WF_ID = process.env.WF_ID || '6mps8YoWu3syldUc'
if (!key || !apiBase) { console.error('Faltan N8N_API_KEY / N8N_API_URL|N8N_BASE_URL'); process.exit(2) }
const H = { 'X-N8N-API-KEY': key, accept: 'application/json', 'Content-Type': 'application/json' }

const TP_VALUE = "={{ $json.body.turnPolicyToken }}"
const HEADER_INSERT = "'x-nowcrm-turn-policy': String($('Normalize input').first().json.turnPolicyToken || ''), "
const CONTRACT = [
  '',
  'CONTRATO DE HERRAMIENTAS (P51 — obligatorio):',
  '- No uses herramientas por la simple mención de una entidad (cliente, inmueble, trámite, cita, factura, comisión, documento).',
  '- Si el usuario habla de tu respuesta anterior, corrige, se queja, discrepa o pregunta por qué respondiste algo: responde SIN herramientas.',
  '- Si pregunta capacidades, funcionamiento, límites o hipótesis/futuro: responde SIN herramientas.',
  '- Usa herramientas SOLO cuando el usuario pide datos reales actuales. Nunca leas facturas desde aquí.',
  '- Si una herramienta responde 403 (tool_not_allowed_for_turn / tool_forbidden_for_assistant / turn_policy_required): NO insistas ni pruebes otra; explica breve que ese mensaje no requiere consulta de datos.',
  '- Tras una corrección del usuario, no repitas automáticamente la lectura anterior.',
].join('\n')

async function main() {
  const g = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H })
  if (!g.ok) { console.error('GET falló:', g.status, (await g.text()).slice(0, 160)); process.exit(1) }
  const wf = await g.json()
  const nodes = wf.nodes || []
  const changes = []

  // 1) Normalize input → turnPolicyToken
  const norm = nodes.find((n) => n.name === 'Normalize input')
  if (norm?.parameters?.assignments?.assignments) {
    const list = norm.parameters.assignments.assignments
    if (!list.some((a) => a.name === 'turnPolicyToken')) {
      list.push({ id: 'tp1', name: 'turnPolicyToken', value: TP_VALUE, type: 'string' })
      changes.push('Normalize input: +turnPolicyToken')
    } else changes.push('Normalize input: ya tenía turnPolicyToken (sin cambios)')
  } else changes.push('⚠ Normalize input no encontrado / estructura inesperada')

  // 2) toolCode headers
  const rx = /(['"]x-nowcrm-secret['"]\s*:\s*\$env\.AGENT_TOOL_SECRET\s*,\s*)/
  let patched = 0, already = 0, skipped = 0
  for (const n of nodes) {
    if (!/toolCode/i.test(n.type || '')) continue
    const p = n.parameters || {}
    const code = typeof p.jsCode === 'string' ? p.jsCode : null
    if (!code || !/\/api\/agent\/tool/.test(code)) { skipped++; continue }
    if (code.includes('x-nowcrm-turn-policy')) { already++; continue }
    if (!rx.test(code)) { console.log(`  ⚠ patrón de header no encontrado en ${n.name}`); skipped++; continue }
    p.jsCode = code.replace(rx, `$1${HEADER_INSERT}`)
    patched++
  }
  changes.push(`toolCode: ${patched} parcheados, ${already} ya tenían header, ${skipped} omitidos`)

  // 3) CRM Agent system message
  const agent = nodes.find((n) => /langchain\.agent/i.test(n.type || ''))
  const sm = agent?.parameters?.options?.systemMessage
  if (typeof sm === 'string') {
    if (!sm.includes('CONTRATO DE HERRAMIENTAS (P51')) {
      agent.parameters.options.systemMessage = sm + '\n' + CONTRACT
      changes.push('CRM Agent: +contrato P51')
    } else changes.push('CRM Agent: contrato ya presente')
  } else changes.push('⚠ CRM Agent systemMessage no encontrado')

  console.log('\n── Cambios ──')
  for (const c of changes) console.log('  •', c)

  const patchedFile = join(tmpdir(), `CRM_AGENT_V2_PATCHED_P51C_${new Date().toISOString().slice(0, 10)}.json`)
  writeFileSync(patchedFile, JSON.stringify(wf, null, 2), 'utf8')
  console.log('\nWorkflow parcheado (local):', patchedFile)

  if (!APPLY) { console.log('\nDRY-RUN. Repite con --apply para escribir en n8n.'); return }

  // PUT: solo los campos permitidos por la API pública.
  const updateBody = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings ?? {} }
  const put = await fetch(`${apiBase}/workflows/${WF_ID}`, { method: 'PUT', headers: H, body: JSON.stringify(updateBody) })
  console.log('\nPUT /workflows →', put.status)
  if (!put.ok) { console.error('PUT falló:', (await put.text()).slice(0, 300)); process.exit(1) }
  // Re-activar si procede.
  const after = await (await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: H })).json()
  if (!after.active) {
    const act = await fetch(`${apiBase}/workflows/${WF_ID}/activate`, { method: 'POST', headers: H })
    console.log('POST activate →', act.status)
  } else {
    console.log('workflow sigue active:', after.active)
  }
  console.log('\n✅ Aplicado.')
}
main()
