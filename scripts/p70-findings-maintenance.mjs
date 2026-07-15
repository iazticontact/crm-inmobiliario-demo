#!/usr/bin/env node
// P70 Wave G — MANTENIMIENTO de findings (DRY-RUN, solo lectura). Informa: findings por estado y
// severidad, tipos más frecuentes, más antiguo abierto, ratio resueltos. NUNCA cambia estados ni borra
// (el ciclo open→acknowledged→resolved/dismissed vive en el chat y las tools n8n).
// Uso: node scripts/p70-findings-maintenance.mjs [--workspace <uuid>]

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n) { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined }
const wsArg = process.argv.includes('--workspace') ? process.argv[process.argv.indexOf('--workspace') + 1] : null
const sb = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL'), envLocal('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
let q = sb.from('assistant_findings').select('workspace_id, finding_type, severity, status, detected_at')
if (wsArg) q = q.eq('workspace_id', wsArg)
const { data, error } = await q.limit(5000)
if (error) { console.error('No pude leer findings:', error.message); process.exit(1) }
const rows = data ?? []
const by = (f) => rows.reduce((a, r) => { a[r[f] ?? 'null'] = (a[r[f] ?? 'null'] ?? 0) + 1; return a }, {})
const open = rows.filter((r) => r.status === 'open' || r.status === 'acknowledged')
const closed = rows.filter((r) => r.status === 'resolved' || r.status === 'dismissed')
const oldestOpen = open.map((r) => r.detected_at).sort()[0]
const topTypes = Object.entries(by('finding_type')).sort((a, b) => b[1] - a[1]).slice(0, 5)
console.log(`P70 FINDINGS MAINTENANCE (DRY-RUN)${wsArg ? ` · ws ${wsArg.slice(0, 8)}…` : ' · todos los ws'}`)
console.log(`Total findings: ${rows.length} (abiertos ${open.length} · cerrados ${closed.length})`)
console.log(`Por severidad (abiertos): ${Object.entries(open.reduce((a, r) => { a[r.severity] = (a[r.severity] ?? 0) + 1; return a }, {})).map(([k, v]) => `${k}=${v}`).join(' · ') || 'ninguno'}`)
console.log(`Ratio resueltos: ${rows.length ? Math.round(100 * closed.length / rows.length) : 0}%`)
console.log(`Más antiguo abierto: ${oldestOpen ? oldestOpen.slice(0, 10) : '—'}`)
console.log(`Tipos más frecuentes: ${topTypes.map(([k, v]) => `${k}=${v}`).join(' · ') || 'ninguno'}`)
console.log('Nota: solo lectura. La resolución/descarte se hace desde el chat o las tools n8n; sin hard delete.')
