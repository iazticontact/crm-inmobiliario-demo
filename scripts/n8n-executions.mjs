#!/usr/bin/env node
// P51C — Revisa ejecuciones recientes del workflow (API n8n) para confirmar que, bajo strict, las tools
// reciben datos (no 403). No imprime secretos ni payloads: solo por nodo si su salida parece OK / 403 /
// turn_policy. Uso: node scripts/n8n-executions.mjs

import { readFileSync } from 'node:fs'
function envLocal(name) {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined
}
const key = process.env.N8N_API_KEY || envLocal('N8N_API_KEY')
const apiBase = (process.env.N8N_API_URL || envLocal('N8N_API_URL') || ((process.env.N8N_BASE_URL || envLocal('N8N_BASE_URL') || '').replace(/\/$/, '') + '/api/v1')).replace(/\/$/, '')
const WF_ID = process.env.WF_ID || '6mps8YoWu3syldUc'
if (!key || !apiBase) { console.error('Faltan N8N_API_KEY / N8N_API_URL|N8N_BASE_URL'); process.exit(2) }
const H = { 'X-N8N-API-KEY': key, accept: 'application/json' }

function classify(s) {
  if (/turn_policy_required/.test(s)) return '⛔ 403 turn_policy_required (n8n NO reenvía token)'
  if (/tool_not_allowed_for_turn/.test(s)) return '403 tool_not_allowed_for_turn'
  if (/tool_forbidden_for_assistant|invoices/.test(s)) return '403 facturación (esperado)'
  if (/invalid_turn_policy/.test(s)) return '⛔ 403 invalid_turn_policy (token mal formado)'
  if (/crm_unreachable/.test(s)) return '⚠ crm_unreachable'
  if (/"ok":true|"result"|"count"|"results"|"properties"|"clients"|"tasks"|"events"/.test(s)) return '✅ datos OK'
  return '· (sin señal clara)'
}

async function main() {
  const list = await fetch(`${apiBase}/executions?workflowId=${WF_ID}&limit=5&includeData=true`, { headers: H })
  console.log('GET /executions → HTTP', list.status)
  if (!list.ok) { console.error('No OK:', (await list.text()).slice(0, 160)); process.exit(1) }
  const data = await list.json()
  const execs = data.data || data.results || []
  console.log(`Ejecuciones recientes: ${execs.length}`)
  for (const ex of execs.slice(0, 5)) {
    const when = ex.startedAt || ex.createdAt || ''
    const runData = ex.data?.resultData?.runData || {}
    const toolNodes = Object.keys(runData).filter((n) => /search_|get_|pipeline_|crm_read/.test(n))
    console.log(`\n· exec ${ex.id}  ${String(when).slice(0, 19)}  finished:${ex.finished}  tools:[${toolNodes.join(', ') || '—'}]`)
    for (const t of toolNodes) {
      const s = JSON.stringify(runData[t]).slice(0, 4000)
      console.log(`    ${t}: ${classify(s)}`)
    }
  }
}
main()
