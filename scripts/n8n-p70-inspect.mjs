#!/usr/bin/env node
// P70 Wave E — INSPECCIÓN read-only del workflow n8n + ejecuciones recientes. Base del runtime map:
// por nodo imprime tipo, rol, upstream/downstream y clasificación (live/infra). Guarda backup fuera
// del repo. No imprime credenciales ni el prompt completo.
// Uso: node scripts/n8n-p70-inspect.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
const H = { 'X-N8N-API-KEY': KEY, accept: 'application/json' }

const wf = await (await fetch(`${API}/workflows/${WF_ID}`, { headers: H })).json()
const backupPath = join(tmpdir(), `CRM_AGENT_V2_INSPECT_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(backupPath, JSON.stringify(wf, null, 2))
console.log(`Workflow: ${wf.name} · id ${wf.id} · active=${wf.active} · nodos=${wf.nodes.length}`)
console.log(`Backup: ${backupPath}\n`)

// upstream/downstream desde connections (main y ai_tool).
const down = new Map()
for (const [from, conns] of Object.entries(wf.connections ?? {})) {
  for (const outs of Object.values(conns)) {
    for (const arr of outs) for (const c of arr) {
      down.set(from, [...(down.get(from) ?? []), `${c.node} (${c.type})`])
    }
  }
}
const up = new Map()
for (const [from, targets] of down.entries()) {
  for (const t of targets) {
    const name = t.replace(/ \(.+\)$/, '')
    up.set(name, [...(up.get(name) ?? []), from])
  }
}
const role = (n) => {
  if (n.type.includes('webhook')) return 'entrada (webhook del CRM)'
  if (n.name === 'Check secret') return 'gate de autenticación (x-nowcrm-agent-secret)'
  if (n.name === 'Normalize input') return 'normaliza payload + expone workspace/turnPolicyToken'
  if (n.type.includes('agent')) return 'agente (prompt + orquestación de tools)'
  if (n.type.includes('lmChat')) return 'modelo LLM'
  if (n.type.includes('memory')) return 'memoria de ventana por hilo'
  if (n.type.includes('toolCode')) return 'tool (código controlado)'
  if (n.name === 'Build Response') return 'construye respuesta estructurada'
  if (n.type.includes('respondToWebhook')) return 'respuesta HTTP'
  if (n.type.includes('scheduleTrigger')) return 'cron del scheduler'
  if (n.type.includes('httpRequest')) return 'dispatcher run_due → /api/agent/automation'
  return 'otro'
}
console.log('── Nodos (nombre | tipo | rol | upstream → downstream) ──')
for (const n of wf.nodes) {
  const u = (up.get(n.name) ?? []).join(', ') || '—'
  const d = (down.get(n.name) ?? []).join(', ') || '—'
  console.log(`${n.name.padEnd(30)} | ${n.type.replace('@n8n/n8n-nodes-langchain.', 'lc.').replace('n8n-nodes-base.', '')} | ${role(n)}`)
  console.log(`${''.padEnd(30)} | up: ${u} → down: ${d}`)
}

// Ejecuciones recientes (metadata; sin payloads).
try {
  const ex = await (await fetch(`${API}/executions?workflowId=${WF_ID}&limit=15`, { headers: H })).json()
  const rows = (ex.data ?? [])
  console.log(`\n── Ejecuciones recientes (${rows.length}) ──`)
  const byStatus = {}
  for (const e of rows) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1
  console.log(Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'sin ejecuciones')
  for (const e of rows.slice(0, 8)) console.log(`• ${e.startedAt} · ${e.status} · mode=${e.mode}`)
} catch { console.log('\n(no pude listar ejecuciones)') }
