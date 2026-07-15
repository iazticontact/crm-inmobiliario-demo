// P70 Wave H — PERFORMANCE: mide latencias de los caminos calientes del asistente contra el motor real
// y el plano desplegado. Reporta p50/p95/max por camino y compara con presupuestos. No escribe datos de
// negocio (el ciclo de acción usa un inmueble QA en el ws demo y lo restaura; cancela previews).
// Uso: npx tsx --tsconfig tsconfig.json scripts/p70-performance.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const BASE = String(process.env.AGENT_ACTION_URL).replace(/\/$/, '')
const SECRET = process.env.AGENT_TOOL_SECRET!
const WS = 'd0000000-0000-4000-8000-000000000001'

const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { parseActionIntent } = await import('@/lib/agents/assistant-action-intent')
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

async function measure(label: string, iters: number, budgetMs: number, fn: () => Promise<unknown> | unknown) {
  const t: number[] = []
  for (let i = 0; i < iters; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s) }
  t.sort((a, b) => a - b)
  const p = (q: number) => t[Math.min(t.length - 1, Math.floor(q * t.length))]
  const p50 = p(0.5), p95 = p(0.95), max = t[t.length - 1]
  const ok = p95 <= budgetMs
  results.push({ label, p50, p95, max, budgetMs, ok })
  console.log(`${ok ? 'PASS' : 'WARN'}  ${label.padEnd(34)} p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms max=${max.toFixed(0)}ms (budget p95 ${budgetMs}ms)`)
}
const results: Array<{ label: string; p50: number; p95: number; max: number; budgetMs: number; ok: boolean }> = []

// 1) Parser puro (sin red).
await measure('parse action (puro)', 200, 5, () => parseActionIntent('Cambia el precio de Avenida San Pedro 66 a 281.000 €'))

// 2) Lecturas locales (DB real, RLS service): clientes, cartera, agenda, resumen ejecutivo.
await measure('read: clientes', 8, 2500, () => tryLocalAnswer(supabase as never, WS, '¿qué clientes tengo?', {}))
await measure('read: cartera', 8, 2500, () => tryLocalAnswer(supabase as never, WS, '¿qué pisos hay en cartera?', {}))
await measure('read: agenda', 8, 2500, () => tryLocalAnswer(supabase as never, WS, '¿tengo citas o tareas?', {}))
await measure('read: resumen ejecutivo (multi-fuente)', 6, 4000, () => tryLocalAnswer(supabase as never, WS, 'resumen ejecutivo', {}))

// 3) Automatización: preview (engine, sin escritura).
await measure('automation preview (opt-in)', 6, 2500, () => tryLocalAnswer(supabase as never, WS, 'activa un resumen diario a las 8', {}))

// 4) Plano de acciones desplegado: prepare + cancel (sin ejecutar; inmueble QA restaurado).
const { data: prop } = await supabase.from('properties').insert({ workspace_id: WS, title: 'Piso Perfqa', status: 'listed', price: 200000, currency: 'EUR' }).select('id').single()
if (prop) {
  await measure('action prepare (staging)', 6, 3000, async () => {
    const r = await fetch(`${BASE}/api/agent/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET }, body: JSON.stringify({ operation: 'prepare', workspace_id: WS, action_type: 'portfolio.update_price', entity_id: prop.id, proposed_changes: { price: 205000 } }) })
    const j = await r.json().catch(() => ({})) as Record<string, unknown>
    if (j.action_id) await fetch(`${BASE}/api/agent/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET }, body: JSON.stringify({ operation: 'cancel', workspace_id: WS, action_id: j.action_id }) })
  })
  await supabase.from('assistant_actions').delete().eq('workspace_id', WS).eq('entity_id', String(prop.id))
  await supabase.from('properties').delete().eq('id', prop.id)
}

const warns = results.filter((r) => !r.ok)
console.log(`\nP70 PERFORMANCE: ${results.length - warns.length}/${results.length} dentro de presupuesto p95${warns.length ? ` · ${warns.length} sobre presupuesto (WARN, no bloqueante)` : ''}`)
// Performance es informativo: no bloquea el release salvo un p95 catastrófico (>3× budget).
const hard = results.filter((r) => r.p95 > r.budgetMs * 3)
process.exit(hard.length ? 1 : 0)
