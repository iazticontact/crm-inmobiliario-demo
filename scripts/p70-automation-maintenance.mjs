#!/usr/bin/env node
// P70 Wave G — MANTENIMIENTO de automatizaciones (DRY-RUN, solo lectura). Informa: reglas activas con
// next_run_at en el pasado (vencidas sin ejecutar → el cron debería recogerlas), reglas sin próxima
// ejecución, runs atascados (running >15 min), runs skipped por catch-up, y estados de runs recientes.
// Uso: node scripts/p70-automation-maintenance.mjs [--workspace <uuid>]

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n) { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined }
const wsArg = process.argv.includes('--workspace') ? process.argv[process.argv.indexOf('--workspace') + 1] : null
const sb = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL'), envLocal('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const now = Date.now()
let rq = sb.from('assistant_automation_rules').select('id, workspace_id, type, enabled, next_run_at, last_run_at')
if (wsArg) rq = rq.eq('workspace_id', wsArg)
const { data: rules, error } = await rq.limit(2000)
if (error) { console.error('No pude leer reglas:', error.message); process.exit(1) }
const enabled = (rules ?? []).filter((r) => r.enabled)
const overdue = enabled.filter((r) => r.next_run_at && new Date(r.next_run_at).getTime() < now - 60_000)
const noNext = enabled.filter((r) => !r.next_run_at)
let runq = sb.from('assistant_automation_runs').select('status, started_at, scheduled_for')
if (wsArg) runq = runq.eq('workspace_id', wsArg)
const { data: runs } = await runq.gte('started_at', new Date(now - 7 * 24 * 3600e3).toISOString()).limit(5000)
const stuck = (runs ?? []).filter((r) => r.status === 'running' && now - new Date(r.started_at).getTime() > 15 * 60_000)
const byStatus = (runs ?? []).reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a }, {})
console.log(`P70 AUTOMATION MAINTENANCE (DRY-RUN)${wsArg ? ` · ws ${wsArg.slice(0, 8)}…` : ' · todos los ws'}`)
console.log(`Reglas: ${rules?.length ?? 0} (activas ${enabled.length})`)
console.log(`Activas VENCIDAS (next_run_at pasado >1min): ${overdue.length}  ${overdue.length ? '→ el dispatcher run_due las recogerá; si persisten, revisar cron n8n' : ''}`)
console.log(`Activas SIN next_run_at: ${noNext.length}  ${noNext.length ? '→ reactivar recalcula next_run_at' : ''}`)
console.log(`Runs (7 días) por estado: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(' · ') || 'ninguno'}`)
console.log(`Runs ATASCADOS (running >15min): ${stuck.length}  ${stuck.length ? '→ run_due los marca error AUTOMATION_TIMEOUT en la próxima pasada' : ''}`)
console.log('Nota: script de solo lectura. No modifica reglas ni borra runs (audit trail intacto).')
