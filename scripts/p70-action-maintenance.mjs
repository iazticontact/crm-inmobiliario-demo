#!/usr/bin/env node
// P70 Wave G — MANTENIMIENTO de acciones (DRY-RUN, solo lectura; NUNCA borra el audit trail).
// Informa de la salud del plano de acciones por workspace: prepared caducadas sin cerrar, executing
// atascadas (>15 min), ratios de completed/failed/conflict, y sugiere (sin ejecutar) la limpieza segura.
// Uso: node scripts/p70-action-maintenance.mjs [--workspace <uuid>]

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n) { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined }
const wsArg = process.argv.includes('--workspace') ? process.argv[process.argv.indexOf('--workspace') + 1] : null
const sb = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL'), envLocal('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const now = Date.now()
let q = sb.from('assistant_actions').select('workspace_id, status, expires_at, confirmed_at, created_at, safe_error_code')
if (wsArg) q = q.eq('workspace_id', wsArg)
const { data, error } = await q.limit(5000)
if (error) { console.error('No pude leer assistant_actions:', error.message); process.exit(1) }
const rows = data ?? []
const by = (f) => rows.reduce((a, r) => { a[r[f] ?? 'null'] = (a[r[f] ?? 'null'] ?? 0) + 1; return a }, {})
const staleprepared = rows.filter((r) => r.status === 'prepared' && r.expires_at && new Date(r.expires_at).getTime() < now)
const stuck = rows.filter((r) => r.status === 'executing' && r.confirmed_at && now - new Date(r.confirmed_at).getTime() > 15 * 60_000)
console.log(`P70 ACTION MAINTENANCE (DRY-RUN)${wsArg ? ` · ws ${wsArg.slice(0, 8)}…` : ' · todos los ws'}`)
console.log(`Total acciones: ${rows.length}`)
console.log(`Por estado: ${Object.entries(by('status')).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
console.log(`Prepared CADUCADAS sin cerrar: ${staleprepared.length}  ${staleprepared.length ? '→ sugerencia: marcar status=expired (idempotente, NO borrar)' : ''}`)
console.log(`Executing ATASCADAS (>15min): ${stuck.length}  ${stuck.length ? '→ revisar: posible run interrumpido; el confirm es idempotente' : ''}`)
const codes = by('safe_error_code'); delete codes.null
console.log(`Códigos de error seguros: ${Object.keys(codes).length ? Object.entries(codes).map(([k, v]) => `${k}=${v}`).join(' · ') : 'ninguno'}`)
console.log('Nota: script de solo lectura. No modifica ni borra el audit trail.')
