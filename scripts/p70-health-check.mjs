#!/usr/bin/env node
// P70 Wave G — HEALTH CHECK consolidado (solo lectura): staging vivo + config, n8n API accesible +
// workflow activo, y cifras de negocio sanas (clientes/inmuebles/operaciones > 0 en el ws demo). Un
// panel rápido de «¿está todo en pie?». No imprime secretos.
// Uso: node scripts/p70-health-check.mjs

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n) { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined }
const URL = (envLocal('AGENT_ACTION_URL') || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host').replace(/\/$/, '')
const WS = 'd0000000-0000-4000-8000-000000000001'
let fail = 0
const check = (name, cond, extra = '') => { if (cond) { console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}  ${extra}`) } }

// 1) Staging diag.
try { const d = await (await fetch(`${URL}/api/agent/diag`, { headers: { accept: 'application/json' } })).json(); check('staging /api/agent/diag OK', d.ok !== false && !!d.toolVersion, JSON.stringify(d).slice(0, 60)); check('config staging completa', d.config?.agentToolSecret && d.config?.serviceRole && d.config?.n8nWebhook) } catch (e) { check('staging /api/agent/diag OK', false, e?.message) }

// 2) n8n API + workflow activo.
const key = envLocal('N8N_API_KEY'); const api = (envLocal('N8N_API_URL') || (envLocal('N8N_BASE_URL') ? envLocal('N8N_BASE_URL').replace(/\/$/, '') + '/api/v1' : '')).replace(/\/$/, '')
if (key && api) {
  try { const wf = await (await fetch(`${api}/workflows/6mps8YoWu3syldUc`, { headers: { 'X-N8N-API-KEY': key, accept: 'application/json' } })).json(); check('n8n workflow accesible y activo', wf.active === true, `(active=${wf.active})`); check('n8n workflow con 41 nodos (P70)', (wf.nodes?.length ?? 0) === 41, `(${wf.nodes?.length})`) } catch (e) { check('n8n workflow accesible', false, e?.message) }
} else { console.log('SKIP  n8n (faltan N8N_API_KEY/N8N_API_URL)') }

// 3) Cifras de negocio sanas (ws demo).
try {
  const sb = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL'), envLocal('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const c = async (t, extra = (q) => q) => (await extra(sb.from(t).select('id', { count: 'exact', head: true }).eq('workspace_id', WS))).count ?? 0
  const clients = await c('clients', (q) => q.is('deleted_at', null))
  const props = await c('properties', (q) => q.is('deleted_at', null))
  const ops = await c('opportunities', (q) => q.is('deleted_at', null))
  check('datos demo sanos (clientes/inmuebles/operaciones > 0)', clients > 0 && props > 0 && ops > 0, `(${clients}/${props}/${ops})`)
} catch (e) { check('datos demo accesibles', false, e?.message) }

console.log(`\nP70 HEALTH CHECK: ${fail ? 'CON FALLOS' : 'TODO OK'}`)
process.exit(fail ? 1 : 0)
