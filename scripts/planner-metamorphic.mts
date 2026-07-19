// FASE 19 — PRUEBAS METAMÓRFICAS / DE PROPIEDAD del planner. Misma INTENCIÓN semántica con variación
// superficial (tildes, mayúsculas, orden, registro formal/coloquial, faltas, pronombre/elipsis,
// singular/plural, paráfrasis) → PLAN COMPATIBLE (mismo conjunto de capabilities núcleo + speech-act
// estable). No compara texto exacto. Usa datos reales de QA. Uso:
//   npx tsx --tsconfig tsconfig.json scripts/planner-metamorphic.mts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
const WS = 'd0000000-0000-4000-8000-000000000001'
const APIKEY = envLocal('OPENAI_API_KEY')!
const MODEL = envLocal('PLANNER_MODEL') || 'gpt-4.1-mini'
const { planTurn } = await import('@/lib/agents/planner/semantic-planner')
import type { DiscourseState, Plan } from '@/lib/agents/planner/semantic-planner'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const { data: cli } = await supabase.from('clients').select('name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(1)
const C = String(cli?.[0]?.name ?? 'cliente')
const disc = (o: Partial<DiscourseState> = {}): DiscourseState => ({ activeModule: null, activeEntities: [], lastListedEntityType: null, offeredCapabilities: [], pendingAction: null, temporalScope: null, ...o })
const capset = (p: Plan) => new Set(p.goals.map((g) => g.capability))

// Grupos: [invariante requerida] + variaciones superficiales de LA MISMA intención.
type Group = { name: string; mustInclude: string; d: DiscourseState; variants: string[] }
const GROUPS: Group[] = [
  { name: 'contar clientes', mustInclude: 'clients.count', d: disc(), variants: ['¿cuántos clientes tengo?', 'cuantos clientes tengo', 'CUÁNTOS CLIENTES HAY', 'dime el número de clientes', 'oye, el total de clientes cuál es', '¿q clientes tngo en total?'] },
  { name: 'agenda de la semana', mustInclude: 'calendar.list', d: disc(), variants: ['¿qué citas tengo esta semana?', 'que citas tengo esta semana', 'mi agenda de esta semana', 'enséñame las visitas de la semana', 'a ver qué tengo en el calendario estos días'] },
  { name: 'comisiones del mes', mustInclude: 'commissions.aggregate', d: disc(), variants: ['¿cuánto he generado en comisiones este mes?', 'comisiones generadas este mes', 'mis honorarios comerciales del mes', 'cuanto llevo de comision este mes'] },
  { name: 'detalle de cliente', mustInclude: 'clients.detail', d: disc(), variants: [`dame la ficha de ${C}`, `ábreme a ${C}`, `quiero ver a ${C}`, `enséñame el detalle de ${C}`, `muéstrame la info de ${C}`] },
  { name: 'operaciones abiertas', mustInclude: 'operations.list', d: disc(), variants: ['¿qué operaciones tengo abiertas?', 'lista mis oportunidades en curso', 'operaciones activas', 'qué ventas tengo abiertas ahora mismo'] },
]

let groupsOk = 0, totalVariants = 0, variantsOk = 0
console.log(`\nFASE 19 — METAMÓRFICO · modelo ${MODEL} · cliente=${C}\n`)
for (const g of GROUPS) {
  const speechActs = new Set<string>()
  let allInclude = true
  const detail: string[] = []
  for (const v of g.variants) {
    const r = await planTurn(v, g.d, { apiKey: APIKEY, model: MODEL })
    totalVariants++
    const ok = r.ok && capset(r.plan).has(g.mustInclude)
    if (ok) variantsOk++
    if (!ok) allInclude = false
    if (r.ok) speechActs.add(r.plan.speechAct)
    detail.push(`${ok ? '✓' : '✗'}`)
  }
  const stableAct = speechActs.size <= 2 // tolera 1-2 actos compatibles (p. ej. read_request/explain_request)
  const groupOk = allInclude && stableAct
  if (groupOk) groupsOk++
  console.log(`  ${groupOk ? '✓' : '✗'} ${g.name.padEnd(22)} · incluye ${g.mustInclude} en ${detail.filter((x) => x === '✓').length}/${g.variants.length} variantes · actos={${[...speechActs].join(',')}}`)
}
console.log(`\nGrupos estables: ${groupsOk}/${GROUPS.length} · variantes compatibles: ${variantsOk}/${totalVariants} (${(variantsOk / totalVariants * 100).toFixed(0)}%)`)
setTimeout(() => process.exit(0), 300)
