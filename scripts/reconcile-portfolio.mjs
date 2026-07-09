#!/usr/bin/env node
// P56B — RECONCILIACIÓN Cartera: prueba que el reader del Asistente (endpoint desplegado) devuelve LO
// MISMO que la UI/BD para un workspace. Verifica además la VERSIÓN desplegada (meta.toolVersion) para
// confirmar que staging ejecuta el código actual. No imprime secretos.
//
// Uso (PowerShell):
//   $env:AGENT_TOOL_URL="https://<staging>/api/agent/tool"; $env:WORKSPACE_ID="<uuid>"; node scripts/reconcile-portfolio.mjs

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

function envLocal(name) {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined
}
const URL = process.env.AGENT_TOOL_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/api/agent/tool'
const SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
const WS = process.env.WORKSPACE_ID || 'd0000000-0000-4000-8000-000000000001'
if (!SECRET) { console.error('Falta AGENT_TOOL_SECRET (env o .env.local)'); process.exit(2) }

const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const mac = (d) => createHmac('sha256', SECRET).update(d).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const now = Date.now()
const p = b64(JSON.stringify({ v: 1, cid: 'reconcile', tid: 'reconcile', domain: 'properties', read: true, write: false, tools: ['properties.read', 'properties.search'], iat: now, exp: now + 90000 }))
const token = `${p}.${mac(p)}`

const res = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET, 'x-nowcrm-turn-policy': token },
  body: JSON.stringify({ tool: 'crm_read_query', workspace_id: WS, input: { entity: 'properties', limit: 20 } }),
})
const j = await res.json().catch(() => ({}))
console.log(`HTTP ${res.status} · toolVersion desplegada: ${j?.meta?.toolVersion ?? '—'}`)
if (res.status !== 200) { console.error('Error:', j?.error, j?.reason ?? ''); process.exit(1) }

const rows = j.result?.rows ?? []
const counts = {}
for (const r of rows) counts[r.status ?? '∅'] = (counts[r.status ?? '∅'] || 0) + 1
console.log(`\nWorkspace ${WS.slice(0, 8)}… → ${rows.length} inmuebles (lo que ve el Asistente):`)
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`)
for (const r of rows.slice(0, 12)) console.log(`  • ${r.title} — ${r.status} · ${r.city ?? ''}`)
console.log('\nCompara con la página Cartera de ESE workspace: los totales y estados deben coincidir.')
console.log('Si la versión desplegada no es la esperada, staging aún no ha redeployado el último push.')
