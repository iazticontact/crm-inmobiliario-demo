// FASE 3/5 — Verifica el plumbing SHADOW y la ATRIBUCIÓN, y compara P71 vs planner por turno (sin exact
// text). Prueba también que el flag por defecto es OFF (no-op). Usa el hook real de la route.
//   npx tsx --tsconfig tsconfig.json scripts/planner-shadow-compare.mts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || envLocal('OPENAI_API_KEY')
const WS = 'd0000000-0000-4000-8000-000000000001'
const { plannerMode, plannerShadowObserve } = await import('@/lib/agents/planner/shadow-hook')
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { emptyState } = await import('@/lib/agents/conversation-state')
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const { data: cli } = await supabase.from('clients').select('name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(1)
const C = String(cli?.[0]?.name ?? 'cliente')

// 1) Flag por defecto = OFF (no-op en producción).
console.log(`\n[flag] por defecto = ${plannerMode()} ${plannerMode() === 'off' ? '✓ (no-op)' : '✗'}`)
console.log(`[flag] shadow → ${(() => { process.env.GENERAL_SEMANTIC_PLANNER = 'shadow'; return plannerMode() })()} · on → ${(() => { process.env.GENERAL_SEMANTIC_PLANNER = 'on'; return plannerMode() })()} · basura → ${(() => { process.env.GENERAL_SEMANTIC_PLANNER = 'xyz'; return plannerMode() })()}`)
delete process.env.GENERAL_SEMANTIC_PLANNER

// 2) Comparación por turno (P71 vs observación del planner en SHADOW).
const MSGS = [
  '¿cuántos clientes tengo?',
  'enséñame un cliente al azar',
  `dame la ficha completa de ${C}`,
  '¿qué puedes hacer con la cartera?',
  '¿cuánto llevo generado en comisiones este mes?',
  'explícame operaciones y dime cuántas tengo abiertas',
  '¿se pueden cambiar los precios desde aquí?',
]
console.log(`\nSHADOW COMPARE · cliente=${C}\n`)
console.log('  mensaje                                          | P71 tool            | PLANNER arch/act/caps')
for (const m of MSGS) {
  const p71 = await tryLocalAnswer(supabase as never, WS, m, { recentContext: '', state: emptyState(), turnId: `sc-${Math.random()}` }).catch(() => ({ handled: false as const }))
  const obs = await plannerShadowObserve({ supabase: supabase as never, workspaceId: WS, message: m, convState: emptyState() })
  const p71tool = p71.handled ? String((p71 as { usedTool?: unknown }).usedTool) : 'UNHANDLED→n8n'
  console.log(`  ${m.slice(0, 46).padEnd(47)} | ${p71tool.padEnd(19)} | ${obs?.assistantArchitecture}/${obs?.speechAct}/${obs?.capabilities.join('+')}`)
}
setTimeout(() => process.exit(0), 400)
