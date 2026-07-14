#!/usr/bin/env node
// P70 Wave E — DRIFT CHECK: compara el hash del workflow VIVO contra el hash registrado en el repo
// (docs/P70_N8N_WORKFLOW_HASH.txt). Cualquier cambio manual en n8n (nodos, tools, prompt, conexiones)
// hace fallar este check en rojo hasta re-verificar y re-registrar conscientemente.
// Uso: node scripts/n8n-p70-drift-check.mjs

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

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

let expected = ''
try { expected = readFileSync('docs/P70_N8N_WORKFLOW_HASH.txt', 'utf8').trim() } catch {
  console.error('No existe docs/P70_N8N_WORKFLOW_HASH.txt — ejecuta n8n-p70-verify.mjs --write-hash tras un estado bueno conocido.')
  process.exit(2)
}
const r = await fetch(`${API}/workflows/${WF_ID}`, { headers: { 'X-N8N-API-KEY': KEY, accept: 'application/json' } })
if (!r.ok) { console.error(`GET workflow → ${r.status}`); process.exit(1) }
const wf = await r.json()
const nodesSorted = [...wf.nodes].sort((a, b) => a.name.localeCompare(b.name)).map((n) => ({ name: n.name, type: n.type, params: n.parameters }))
const live = createHash('sha256').update(JSON.stringify({ nodes: nodesSorted, connections: wf.connections })).digest('hex').slice(0, 16)

if (live === expected) {
  console.log(`P70 N8N DRIFT CHECK: OK (hash ${live})`)
  process.exit(0)
}
console.error(`P70 N8N DRIFT CHECK: DRIFT DETECTADO — esperado ${expected}, vivo ${live}`)
console.error('El workflow cambió fuera del proceso controlado. Inspecciona (n8n-p70-inspect), verifica (n8n-p70-verify) y re-registra el hash solo si el cambio es legítimo.')
process.exit(1)
