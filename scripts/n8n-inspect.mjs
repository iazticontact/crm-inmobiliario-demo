#!/usr/bin/env node
// P51C — Inspecciona (read-only) el workflow del Asistente vía API pública de n8n y guarda un BACKUP.
// Lee N8N_API_KEY / N8N_API_URL|N8N_BASE_URL / (WF_ID) desde .env.local. NUNCA imprime secretos ni el JSON
// completo (solo metadata: nombre, activo, nº nodos, nodos HTTP → /api/agent/tool y si ya llevan el header).
// El backup se escribe en el directorio temporal del SO (fuera del repo), no se commitea.
//
// Uso:  node scripts/n8n-inspect.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
const key = env.N8N_API_KEY
const apiBase = (env.N8N_API_URL || (env.N8N_BASE_URL ? env.N8N_BASE_URL.replace(/\/$/, '') + '/api/v1' : '')).replace(/\/$/, '')
const WF_ID = process.env.WF_ID || '6mps8YoWu3syldUc'
if (!key || !apiBase) { console.error('Faltan N8N_API_KEY / N8N_API_URL|N8N_BASE_URL en .env.local'); process.exit(2) }

async function main() {
  let res
  try {
    res = await fetch(`${apiBase}/workflows/${WF_ID}`, { headers: { 'X-N8N-API-KEY': key, accept: 'application/json' } })
  } catch (e) {
    console.error('Error de red al conectar con n8n:', e?.message || e); process.exit(1)
  }
  console.log('n8n API base:', apiBase.replace(/\/\/[^/]+/, '//<host>'))
  console.log('GET /workflows/' + WF_ID + ' → HTTP', res.status)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('No OK. Cuerpo (recortado, sin secretos):', body.slice(0, 200))
    process.exit(1)
  }
  const wf = await res.json()
  const date = new Date().toISOString().slice(0, 10)
  const backup = join(tmpdir(), `CRM_AGENT_V2_READ_ONLY_BACKUP_BEFORE_P51C_${date}.json`)
  writeFileSync(backup, JSON.stringify(wf, null, 2), 'utf8')

  console.log('\n── Workflow ──')
  console.log('name  :', wf.name)
  console.log('id    :', wf.id)
  console.log('active:', wf.active)
  console.log('nodes :', Array.isArray(wf.nodes) ? wf.nodes.length : 'n/a')
  const httpTool = (wf.nodes || []).filter((n) => /httpRequest/i.test(n.type || '') && /\/api\/agent\/tool/.test(n.parameters?.url || ''))
  console.log('HTTP nodes → /api/agent/tool:', httpTool.length)
  for (const n of httpTool) {
    const hdrs = n.parameters?.headerParameters?.parameters || []
    const hasHeader = hdrs.some((p) => String(p?.name).toLowerCase() === 'x-nowcrm-turn-policy')
    console.log(`  • ${n.name} — token header: ${hasHeader ? 'YES' : 'no'}`)
  }
  const trigger = (wf.nodes || []).find((n) => /webhook|trigger/i.test(n.type || ''))
  console.log('trigger node:', trigger?.name ?? '(none)')

  // Cobertura del contrato P51 (tools tipo toolCode).
  const toolCode = (wf.nodes || []).filter((n) => /toolCode/i.test(n.type || '') && /\/api\/agent\/tool/.test(String(n.parameters?.jsCode || '')))
  const withTP = toolCode.filter((n) => String(n.parameters?.jsCode || '').includes('x-nowcrm-turn-policy'))
  console.log(`\n── Contrato P51 (live) ──`)
  console.log(`toolCode → /api/agent/tool: ${toolCode.length}  ·  con header x-nowcrm-turn-policy: ${withTP.length}`)
  const norm = (wf.nodes || []).find((n) => n.name === 'Normalize input')
  const normTP = norm?.parameters?.assignments?.assignments?.some((a) => a.name === 'turnPolicyToken')
  console.log('Normalize input expone turnPolicyToken:', !!normTP)
  const agent = (wf.nodes || []).find((n) => /langchain\.agent/i.test(n.type || ''))
  console.log('CRM Agent tiene CONTRATO P51:', /CONTRATO DE HERRAMIENTAS \(P51/.test(String(agent?.parameters?.options?.systemMessage || '')))

  console.log('\nBackup guardado en:', backup)
}
main()
