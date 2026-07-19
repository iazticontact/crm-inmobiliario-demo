// Cablear crm.query — pruebas de PROPIEDAD (no frases): el planner emite crm.query para consultas
// COMPUESTAS sin capability fija, NO lo usa cuando existe una especializada, y ejecuta a evidence grounded
// vía la Safe Query Layer. Fraseos NO vistos + datos reales QA. Synth off (juez estructural).
//   npx tsx --tsconfig tsconfig.json scripts/planner-crm-query.mts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
const WS = 'd0000000-0000-4000-8000-000000000001'
const APIKEY = envLocal('OPENAI_API_KEY')!
const MODEL = envLocal('PLANNER_MODEL') || 'gpt-4.1-mini'
const { runTurn } = await import('@/lib/agents/planner/planner-pipeline')
const { emptyDiscourse } = await import('@/lib/agents/planner/discourse-state')
import type { RichDiscourse } from '@/lib/agents/planner/discourse-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const { data: cli } = await supabase.from('clients').select('name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(1)
const C = String(cli?.[0]?.name ?? 'cliente')

async function run(msg: string, seed: Partial<RichDiscourse> = {}) {
  const r = await runTurn({ supabase: supabase as never, workspaceId: WS, message: msg, discourse: { ...emptyDiscourse(), ...seed } as RichDiscourse, apiKey: APIKEY, plannerModel: MODEL, synth: false, selectionSeed: 7 })
  return r.trace
}
let pass = 0, total = 0
function ck(name: string, ok: boolean, detail: string) { total++; if (ok) pass++; console.log(`  ${ok ? '✓' : '✗ FALLO'} ${name.padEnd(52)} ${detail}`) }

// ── A. DEBE emitir crm.query (composición sin capability fija) + ejecutar a evidence grounded ──
console.log(`\n══ A · crm.query para consultas COMPUESTAS (modelo ${MODEL}) ══\n`)
{ const t = await run('¿cuál es el precio medio de los inmuebles de la cartera?'); const g = t.plan.goals.find((x) => x.capability === 'crm.query'); const e = t.evidences.find((x) => x.capability === 'crm.query'); ck('precio medio cartera → crm.query aggregate avg', !!g && g.query?.operation === 'aggregate' && g.query?.aggregateFn === 'avg' && !!e && ['SUCCESS', 'EMPTY'].includes(e.status), `cap=${t.plan.goals.map((x) => x.capability).join(',')} st=${e?.status}`) }
{ const t = await run('de mis operaciones ganadas, ¿cuál es el valor medio?'); const g = t.plan.goals.find((x) => x.capability === 'crm.query'); const e = t.evidences.find((x) => x.capability === 'crm.query'); ck('valor medio operaciones ganadas → crm.query avg', !!g && g.query?.aggregateFn === 'avg' && !!e && ['SUCCESS', 'EMPTY'].includes(e.status), `cap=${t.plan.goals.map((x) => x.capability).join(',')} st=${e?.status}`) }
{ const t = await run(`de ${C}, suma el valor total de todas sus operaciones`); const g = t.plan.goals.find((x) => x.capability === 'crm.query'); const e = t.evidences.find((x) => x.capability === 'crm.query'); ck('suma valor operaciones de un cliente → crm.query relation+agg', !!g && g.query?.aggregateFn === 'sum' && !!e && ['SUCCESS', 'EMPTY'].includes(e.status) && e.resolvedEntity?.label === C, `cap=${t.plan.goals.map((x) => x.capability).join(',')} st=${e?.status} ent=${e?.resolvedEntity?.label}`) }
{ const t = await run('dame el inmueble más caro de la cartera'); const usedQuery = t.plan.goals.some((x) => x.capability === 'crm.query'); const usedPortfolio = t.plan.goals.some((x) => x.capability.startsWith('portfolio')); ck('inmueble más caro → crm.query(max/top) o portfolio+selection', usedQuery || usedPortfolio, `cap=${t.plan.goals.map((x) => `${x.capability}[${x.selection ?? x.query?.aggregateFn ?? ''}]`).join(',')}`) }

// ── B. NO debe usar crm.query cuando hay capability especializada (no-overuse) ──
console.log('\n══ B · NO-OVERUSE (capability especializada gana) ══\n')
for (const [msg, expect] of [['¿cuántos clientes tengo?', 'clients.count'], ['¿qué citas tengo esta semana?', 'calendar.list'], ['¿cuánto he generado en comisiones este mes?', 'commissions.aggregate'], ['enséñame la cartera de inmuebles', 'portfolio.list']] as const) {
  const t = await run(msg); const caps = t.plan.goals.map((x) => x.capability); const noQuery = !caps.includes('crm.query'); const hasSpec = caps.includes(expect)
  ck(`«${msg.slice(0, 34)}» → ${expect}, no crm.query`, noQuery && hasSpec, `cap=${caps.join(',')}`)
}

console.log(`\ncrm.query BEHAVIOR: ${pass}/${total}`)
setTimeout(() => process.exit(0), 400)
