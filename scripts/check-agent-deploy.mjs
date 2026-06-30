#!/usr/bin/env node
// P25 — Verificación SEGURA del backend desplegado del Asistente.
//
// Comprueba objetivamente que el backend al que apunta el `CRM_BASE_URL` de n8n
// (y que sirve la UI) es el correcto: mismo commit que `main`, mismo proyecto
// Supabase que la UI, contrato de tools al día y, opcionalmente, cuántos
// registros REALES ve para un workspace. Así se distingue "no hay datos" de
// "el backend apunta a otra base / commit viejo / cuenta vacía".
//
// Uso:
//   node scripts/check-agent-deploy.mjs <DEPLOY_URL> [--workspace <uuid>]
//   DEPLOY_URL=https://staging.example.com node scripts/check-agent-deploy.mjs
//
// Si no se pasa URL, usa DEPLOY_URL o NEXT_PUBLIC_APP_URL de .env.local.
// El sondeo por workspace usa AGENT_TOOL_SECRET (env o .env.local) en el header
// `x-nowcrm-secret`. NUNCA se imprime ningún secreto.
//
// Salida: exit 0 si todo cuadra; exit 1 si hay fallo duro (diag inalcanzable,
// supabaseRef distinto al de la UI, o sondeo no autorizado pedido explícitamente).

import fs from 'node:fs'
import { execSync } from 'node:child_process'

const EXPECTED_TOOL_VERSION = '2026-07-01.p24' // sube cuando cambie TOOL_CONTRACT_VERSION

function readEnvLocal() {
  try {
    return Object.fromEntries(
      fs.readFileSync('.env.local', 'utf8').split('\n')
        .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }),
    )
  } catch { return {} }
}

function refFromSupabaseUrl(url) {
  try { return new URL(url).host.split('.')[0] || null } catch { return null }
}

function gitCommit() {
  try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().slice(0, 12) } catch { return null }
}

const args = process.argv.slice(2)
let deployUrl = null
let workspace = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace') { workspace = args[++i]; continue }
  if (!args[i].startsWith('--')) deployUrl = args[i]
}

const env = readEnvLocal()
deployUrl = (deployUrl || process.env.DEPLOY_URL || env.DEPLOY_URL || env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
if (!deployUrl) {
  console.error('✗ Falta la URL de despliegue. Uso: node scripts/check-agent-deploy.mjs <DEPLOY_URL> [--workspace <uuid>]')
  process.exit(1)
}

const expectedRef = refFromSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '')
const expectedCommit = gitCommit()
let hardFail = false

console.log(`\n→ Backend desplegado: ${deployUrl}`)
console.log(`  (UI Supabase ref esperado: ${expectedRef ?? 'desconocido'} · HEAD local: ${expectedCommit ?? 'desconocido'})\n`)

// ── 1) diag público ──────────────────────────────────────────────────────────
let diag
try {
  const res = await fetch(`${deployUrl}/api/agent/diag`, { headers: { accept: 'application/json' } })
  if (!res.ok) { console.error(`✗ /api/agent/diag respondió HTTP ${res.status}`); process.exit(1) }
  diag = await res.json()
} catch (e) {
  console.error(`✗ No se pudo alcanzar /api/agent/diag: ${e.message}`)
  console.error('  → ¿URL correcta? ¿backend desplegado y vivo? ¿dominio del CRM (no el de n8n)?')
  process.exit(1)
}

const mark = (ok) => (ok ? '✓' : '✗')
console.log('=== /api/agent/diag ===')
console.log(`  service      : ${diag.service}`)
console.log(`  commit       : ${diag.commit}`)
console.log(`  toolVersion  : ${diag.toolVersion}`)
console.log(`  supabaseRef  : ${diag.supabaseRef}`)
console.log(`  generatedAt  : ${diag.generatedAt}`)
console.log(`  freshness    : agentToolDynamic=${diag.freshness?.agentToolDynamic} diagDynamic=${diag.freshness?.diagDynamic}`)
console.log(`  config       : agentToolSecret=${diag.config?.agentToolSecret} serviceRole=${diag.config?.serviceRole} n8nWebhook=${diag.config?.n8nWebhook} n8nSecret=${diag.config?.n8nSecret}`)

// Comparaciones objetivas
const refOk = !expectedRef || diag.supabaseRef === expectedRef
console.log(`\n  ${mark(refOk)} supabaseRef == UI (${expectedRef ?? 'n/a'})`)
if (!refOk) { hardFail = true; console.log('     → El backend apunta a OTRA Supabase que la UI. Corrige NEXT_PUBLIC_SUPABASE_URL/envs del backend.') }

const commitOk = !expectedCommit || diag.commit === 'unknown' || diag.commit === expectedCommit
console.log(`  ${mark(commitOk)} commit == HEAD local (${expectedCommit ?? 'n/a'})`)
if (diag.commit === 'unknown') console.log('     ⚠ El backend no expone commit (configura SOURCE_COMMIT/NEXT_PUBLIC_COMMIT_SHA en EasyPanel).')
else if (!commitOk) console.log('     ⚠ El backend sirve un commit distinto al de tu rama. Redeploy si esperabas el último.')

const tvOk = diag.toolVersion === EXPECTED_TOOL_VERSION
console.log(`  ${mark(tvOk)} toolVersion == ${EXPECTED_TOOL_VERSION}`)
if (!tvOk) console.log('     ⚠ Contrato de tools desfasado: el backend desplegado no trae el último código.')

const cfgOk = diag.config?.agentToolSecret && diag.config?.serviceRole && diag.config?.n8nWebhook && diag.config?.n8nSecret
console.log(`  ${mark(cfgOk)} configuración de envs completa`)
if (!cfgOk) console.log('     ⚠ Falta alguna env en el backend (agentToolSecret/serviceRole/n8nWebhook/n8nSecret).')

// ── 2) sondeo por workspace (requiere secreto) ───────────────────────────────
if (workspace) {
  const secret = process.env.AGENT_TOOL_SECRET || env.AGENT_TOOL_SECRET || ''
  if (!secret) {
    console.error('\n✗ Pediste --workspace pero no hay AGENT_TOOL_SECRET (env ni .env.local). No se imprime el sondeo.')
    process.exit(1)
  }
  console.log(`\n=== Sondeo de workspace ${workspace} (lo que ve el backend) ===`)
  let probe
  try {
    const res = await fetch(`${deployUrl}/api/agent/diag?workspace_id=${encodeURIComponent(workspace)}`, {
      headers: { accept: 'application/json', 'x-nowcrm-secret': secret },
    })
    probe = await res.json()
    if (res.status === 401) { console.error('✗ No autorizado: el AGENT_TOOL_SECRET local no coincide con el del backend.'); process.exit(1) }
  } catch (e) {
    console.error(`✗ No se pudo sondear el workspace: ${e.message}`); process.exit(1)
  }
  const entities = probe.workspaceProbe?.entities ?? {}
  let total = 0
  for (const [k, v] of Object.entries(entities)) {
    total += v.count || 0
    const last = v.lastUpdated ? new Date(v.lastUpdated).toISOString().slice(0, 10) : '—'
    console.log(`  ${String(k).padEnd(14)} count=${String(v.count).padStart(4)}  últ=${last}  muestra=${(v.sample || []).slice(0, 2).join(' · ') || '—'}`)
  }
  if (total === 0) {
    console.log('\n  ⚠ El backend ve 0 registros en TODO el workspace. Dos causas posibles:')
    console.log('     a) Es una cuenta realmente vacía (correcto: el Asistente debe decir "esta cuenta aún no tiene datos").')
    console.log('     b) CRM_BASE_URL/Supabase del backend apunta a otra base → mismatch de entorno (revisa EasyPanel).')
  } else {
    console.log(`\n  ✓ El backend ve datos reales (${total} registros). Compara estos conteos con la UI de esa misma cuenta.`)
  }
}

console.log(`\n${hardFail ? '✗ HAY UN MISMATCH DURO (ver arriba).' : '✓ Verificación completada.'}\n`)
process.exit(hardFail ? 1 : 0)
