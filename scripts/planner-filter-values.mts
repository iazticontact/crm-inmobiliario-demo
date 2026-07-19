// REPRO — valores canónicos de filtro: «clientes activos» debe contar 6 (status=active), «operaciones
// abiertas» debe ser EMPTY VERAZ con stage=open (QA solo tiene won/lost), «cerradas» debe dar 8.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
const WS = 'd0000000-0000-4000-8000-000000000001'
const { runTurn } = await import('@/lib/agents/planner/planner-pipeline')
const { emptyDiscourse } = await import('@/lib/agents/planner/discourse-state')
import type { RichDiscourse } from '@/lib/agents/planner/discourse-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const APIKEY = envLocal('OPENAI_API_KEY')!
const MODEL = envLocal('PLANNER_MODEL') || 'gpt-4.1-mini'

let pass = 0, tot = 0
async function t(msg: string, judge: (g: { filters: Record<string, string | number> } | undefined, ev: { status: string; count?: number } | undefined) => boolean, capPrefix: string) {
  tot++
  const r = await runTurn({ supabase: supabase as never, workspaceId: WS, message: msg, discourse: emptyDiscourse() as RichDiscourse, apiKey: APIKEY, plannerModel: MODEL, synth: false, selectionSeed: 3 })
  const g = r.trace.plan.goals.find((x) => x.capability.startsWith(capPrefix))
  const ev = r.trace.evidences.find((e) => e.capability.startsWith(capPrefix))
  const ok = judge(g, ev)
  if (ok) pass++
  console.log(`  ${ok ? '✓' : '✗'} «${msg}» → filters=${JSON.stringify(g?.filters ?? {})} status=${ev?.status} count=${ev?.count}`)
}

console.log('\nVALORES CANÓNICOS DE FILTRO (fraseos no vistos)\n')
await t('¿cuántos clientes activos tenemos ahora mismo?', (g, ev) => g?.filters.status === 'active' && ev?.status === 'SUCCESS' && ev?.count === 6, 'clients.')
await t('dime cuántas operaciones siguen abiertas', (g, ev) => g?.filters.stage === 'open' && ev?.status === 'EMPTY', 'operations.')
await t('¿cuántas operaciones están ya cerradas?', (g, ev) => g?.filters.stage === 'closed' && ev?.status === 'SUCCESS' && (ev?.count ?? 0) === 8, 'operations.')
await t('lista los clientes que son leads', (g, ev) => g?.filters.status === 'lead' && ev?.status === 'SUCCESS' && ev?.count === 2, 'clients.')
console.log(`\nRESULTADO: ${pass}/${tot}`)
setTimeout(() => process.exit(pass === tot ? 0 : 1), 300)
