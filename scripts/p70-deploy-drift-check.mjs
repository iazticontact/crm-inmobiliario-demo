#!/usr/bin/env node
// P70 Wave G — DEPLOY DRIFT CHECK: compara el HEAD local (commit + TOOL_CONTRACT_VERSION del código) con
// lo que sirve staging (/api/agent/diag) y con el ref de Supabase de la UI. Falla si el deploy va por
// detrás del código o apunta a otra base. No imprime secretos.
// Uso: node scripts/p70-deploy-drift-check.mjs [URL]

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
function envLocal(n) { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined }
const URL = (process.argv[2] || envLocal('AGENT_ACTION_URL') || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host').replace(/\/$/, '')

// TOOL_CONTRACT_VERSION del código local.
let localVersion = 'unknown'
try { localVersion = (readFileSync('src/lib/agent-tool-readers.ts', 'utf8').match(/TOOL_CONTRACT_VERSION\s*=\s*'([^']+)'/) || [])[1] ?? 'unknown' } catch {}
let head = 'unknown'
try { head = execSync('git rev-parse --short HEAD').toString().trim() } catch {}
const uiRef = (envLocal('NEXT_PUBLIC_SUPABASE_URL') || '').match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? 'unknown'

let diag
try { diag = await (await fetch(`${URL}/api/agent/diag`, { headers: { accept: 'application/json' } })).json() } catch (e) { console.error('No pude leer /api/agent/diag:', e?.message); process.exit(1) }

let fail = 0
const check = (name, cond, extra = '') => { if (cond) { console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}  ${extra}`) } }
console.log(`Deploy: ${URL}`)
console.log(`Local: HEAD ${head} · TOOL_CONTRACT_VERSION ${localVersion} · UI supabaseRef ${uiRef}`)
console.log(`Staging: toolVersion ${diag.toolVersion} · supabaseRef ${diag.supabaseRef} · commit ${diag.commit}`)
check('toolVersion staging == código local', diag.toolVersion === localVersion, `(${diag.toolVersion} vs ${localVersion})`)
check('supabaseRef staging == UI', diag.supabaseRef === uiRef, `(${diag.supabaseRef} vs ${uiRef})`)
check('config completa en staging', diag.config && diag.config.agentToolSecret && diag.config.serviceRole && diag.config.n8nWebhook)
console.log(`\nP70 DEPLOY DRIFT: ${fail ? 'DRIFT DETECTADO' : 'OK'}`)
process.exit(fail ? 1 : 0)
