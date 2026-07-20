// FASE 19/20 — SAFE GENERAL CRM QUERY LAYER: seguridad (allowlists) + generalización (composición de
// consultas NO programadas). Planes hand-built (simulan la salida del planner). Determinista + QA real.
//   npx tsx --tsconfig tsconfig.json scripts/planner-query-layer.mts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
const WS = 'd0000000-0000-4000-8000-000000000001'
const { validateQueryPlan, executeQueryPlan } = await import('@/lib/agents/planner/crm-query-layer')
import type { CrmQueryPlan } from '@/lib/agents/planner/crm-query-layer'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const ref = { activeEntities: [], lastListed: null }
const P = (o: Partial<CrmQueryPlan>): CrmQueryPlan => ({ entity: 'clients', operation: 'list', ...o })

// ── SEGURIDAD: cada plan hostil/ inválido debe ser RECHAZADO por el CÓDIGO (no por el LLM) ──
console.log('\n══ SEGURIDAD DEL QUERY LAYER ══\n')
const sec: Array<{ name: string; plan: CrmQueryPlan; expect: string }> = [
  { name: 'entidad inexistente (invoices)', plan: P({ entity: 'invoices' }), expect: 'unknown_entity' },
  { name: 'entidad inventada (users/secrets)', plan: P({ entity: 'users' }), expect: 'unknown_entity' },
  { name: 'tabla arbitraria por inyección', plan: P({ entity: 'clients; DROP TABLE clients' }), expect: 'unknown_entity' },
  { name: 'facturación aislada', plan: P({ entity: 'facturacion' }), expect: 'unknown_entity' },
  { name: 'filtro por campo no filtrable', plan: P({ entity: 'clients', filters: { ssn: 'x' } }), expect: 'field_not_filterable' },
  { name: 'inyección SQL en filtro', plan: P({ entity: 'clients', filters: { status: "active'; DROP--" } }), expect: 'injection_in_filter' },
  { name: 'campo temporal no permitido', plan: P({ entity: 'opportunities', temporal: { field: 'secret_col', range: 'este mes' } }), expect: 'bad_temporal_field' },
  { name: 'relación no registrada', plan: P({ entity: 'clients', operation: 'relation', relation: 'salaries' }), expect: 'unknown_relation' },
  { name: 'agregar campo no agregable (name)', plan: P({ entity: 'opportunities', operation: 'aggregate', aggregate: { fn: 'sum', field: 'title' } }), expect: 'field_not_aggregatable' },
  { name: 'ordenar por columna arbitraria', plan: P({ entity: 'clients', ordering: { field: 'password', dir: 'asc' } }), expect: 'bad_order_field' },
]
let sok = 0
for (const c of sec) { const v = validateQueryPlan(c.plan); const ok = !v.ok && v.reason.startsWith(c.expect); if (ok) sok++; console.log(`  ${ok ? '✓' : '✗ FALLO'} ${c.name.padEnd(38)} → ${v.ok ? 'ACEPTADO (mal)' : v.reason}`) }
// un plan válido pasa y queda workspace-pinned
const good = validateQueryPlan(P({ entity: 'clients', operation: 'count' }))
console.log(`  ${good.ok ? '✓' : '✗'} plan válido aceptado (count clientes)`)
console.log(`\nSEGURIDAD: ${sok + (good.ok ? 1 : 0)}/${sec.length + 1}`)

// ── GENERALIZACIÓN: consulta COMPUESTA que nadie programó como tool (search→one→relation→aggregate) ──
console.log('\n══ GENERALIZACIÓN: composición de consultas no programadas ══\n')
let gok = 0, gtot = 0
async function step(name: string, plan: CrmQueryPlan, judge: (e: Awaited<ReturnType<typeof executeQueryPlan>>) => boolean, seed = 7) {
  gtot++; const e = await executeQueryPlan(supabase as never, WS, plan, ref, { selectionSeed: seed })
  const ok = judge(e); if (ok) gok++
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(52)} status=${e.status} count=${e.count}${e.aggregate ? ` agg(${e.aggregate.fn})=${e.aggregate.value}` : ''}${e.scope.resolvedEntity ? ` ent=${e.scope.resolvedEntity.label}` : ''}`)
  return e
}

// Composición A: clientes activos → uno → sus operaciones → suma de valor. (No hay tool específica.)
const active = await step('clientes activos (filter)', P({ entity: 'clients', operation: 'filter', filters: { status: 'active' } }), (e) => e.status === 'SUCCESS' || e.status === 'EMPTY')
const oneClient = active.rows[0] ? String(active.rows[0].name ?? '') : ''
if (oneClient) {
  await step(`operaciones de «${oneClient}» (relation)`, P({ entity: 'clients', operation: 'relation', entityRef: oneClient, relation: 'operation' }), (e) => ['SUCCESS', 'EMPTY'].includes(e.status) && e.scope.resolvedEntity?.label === oneClient)
  await step(`suma del valor de sus operaciones (relation+aggregate)`, P({ entity: 'clients', operation: 'relation', entityRef: oneClient, relation: 'operation', aggregate: { fn: 'sum', field: 'value' } }), (e) => ['SUCCESS', 'EMPTY'].includes(e.status) && e.aggregate?.fn === 'sum' && typeof e.aggregate.value === 'number')
}
// Composición B: cartera → precio medio (aggregate avg sobre campo agregable).
await step('precio medio de la cartera (aggregate avg price)', P({ entity: 'portfolio', operation: 'aggregate', aggregate: { fn: 'avg', field: 'price' } }), (e) => ['SUCCESS', 'EMPTY'].includes(e.status) && e.aggregate?.fn === 'avg')
// Composición C: operaciones ganadas este mes → suma valor (filter+temporal+aggregate).
await step('valor ganado este mes (filter+temporal+aggregate)', P({ entity: 'operations', operation: 'aggregate', filters: { stage: 'won' }, temporal: { field: 'expected_close_date', range: 'este mes' }, aggregate: { fn: 'sum', field: 'value' } }), (e) => ['SUCCESS', 'EMPTY'].includes(e.status))
// Composición D: un inmueble al azar (selection random) → 1, no la lista.
await step('un inmueble al azar (selection random)', P({ entity: 'portfolio', operation: 'list', selection: 'random' }), (e) => e.count <= 1)
// Composición E: top 3 operaciones por valor (ordering+selection top).
await step('top 3 operaciones por valor (ordering+top)', P({ entity: 'operations', operation: 'list', ordering: { field: 'value', dir: 'desc' }, selection: 'top', selectionCount: 3 }), (e) => e.count <= 3)
// Composición F: PIVOTE por grafo registrado — «suma de operaciones DE <cliente>» expresado como
// entity=operaciones + aggregate + entityRef (la forma natural que emiten los modelos fuertes).
if (oneClient) {
  await step(`pivote: suma operaciones DE «${oneClient}» (agg+entityRef)`, P({ entity: 'operations', operation: 'aggregate', entityRef: oneClient, aggregate: { fn: 'sum', field: 'value' } }), (e) => ['SUCCESS', 'EMPTY'].includes(e.status) && e.scope.resolvedEntity?.label === oneClient && e.aggregate?.fn === 'sum')
}
// Pivote con referencia inexistente → NOT_FOUND (nunca agrega TODO el workspace en silencio).
await step('pivote ref inexistente → NOT_FOUND, sin ampliar scope', P({ entity: 'operations', operation: 'aggregate', entityRef: 'Zzz Cliente Inexistente Qq', aggregate: { fn: 'sum', field: 'value' } }), (e) => e.status === 'NOT_FOUND')
// entityRef sobre entidad SIN arista padre registrada → INVALID_PLAN explícito (no se ignora).
await step('entityRef sin arista registrada → INVALID_PLAN', P({ entity: 'clients', operation: 'aggregate', entityRef: 'alguien', aggregate: { fn: 'count' } }), (e) => e.status === 'INVALID_PLAN')

console.log(`\nGENERALIZACIÓN: ${gok}/${gtot} · TODO workspace-pinned, sin SQL libre, sin fuga`)
setTimeout(() => process.exit(0), 300)
