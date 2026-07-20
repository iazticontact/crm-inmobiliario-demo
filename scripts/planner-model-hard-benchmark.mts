// FASE 46 — HARD BENCHMARK DE MODELOS del PLANNER. Casos DIFÍCILES y discriminantes donde el modelo
// actual (gpt-4.1-mini) flojea o podría flojear: composición relation+aggregate sobre entidad nombrada
// (el P2 real), 3+ goals, referencia a larga distancia tras cambio y retorno de tema, corrección,
// selección compuesta, ambigüedad financiera que exige aclaración, no-overuse de crm.query.
// Mismo prompt/schema/ontología para todos (solo cambia el modelo). Estados de discurso preparados
// (snapshots de mitad de conversación) idénticos entre modelos. Plan-only (sin executor/synth) por coste.
//   npx tsx --tsconfig tsconfig.json scripts/planner-model-hard-benchmark.mts [modelos_csv]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
const WS = 'd0000000-0000-4000-8000-000000000001'
const APIKEY = envLocal('OPENAI_API_KEY')!
const { planTurn } = await import('@/lib/agents/planner/semantic-planner')
import type { DiscourseState, Plan } from '@/lib/agents/planner/semantic-planner'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const { data: cli } = await supabase.from('clients').select('name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(3)
const C = String(cli?.[0]?.name ?? 'cliente')
const C2 = String(cli?.[1]?.name ?? 'otro cliente')
const disc = (o: Partial<DiscourseState> = {}): DiscourseState => ({ activeModule: null, activeEntities: [], lastListedEntityType: null, offeredCapabilities: [], pendingAction: null, temporalScope: null, ...o })
const caps = (p: Plan) => p.goals.map((g) => g.capability)

// Juez de la composición P2: vale crm.query(relation+aggregate) O una descomposición coherente
// (goal de relación con aggregation) — lo INVÁLIDO es reducirlo a una mera búsqueda del cliente.
const p2ok = (p: Plan) => {
  const viaQuery = p.goals.some((g) => g.capability === 'crm.query' && g.query?.operation === 'relation' && (g.query?.aggregateFn === 'sum' || g.aggregation === 'sum'))
  const viaRelation = p.goals.some((g) => g.capability === 'clients.relation.operations' && (g.aggregation === 'sum' || g.requestedOutput === 'value'))
  const onlySearch = caps(p).every((c) => c === 'clients.search' || c === 'clients.detail')
  return (viaQuery || viaRelation) && !onlySearch
}

type Case = { name: string; msg: string; d: DiscourseState; judge: (p: Plan) => boolean }
const CASES: Case[] = [
  // P2 real (composición sobre entidad nombrada) en 3 fraseos NO vistos
  { name: 'P2 rel+agg entidad nombrada A', msg: `¿cuánto suman las operaciones de ${C}?`, d: disc(), judge: p2ok },
  { name: 'P2 rel+agg entidad nombrada B', msg: `dime el valor total que mueve ${C2} con nosotros`, d: disc(), judge: p2ok },
  { name: 'P2 rel+agg con pronombre', msg: '¿y cuánto suman sus operaciones?', d: disc({ activeModule: 'clients', activeEntities: [{ type: 'client', label: C }] }), judge: p2ok },
  // 3+ goals compatibles en un mensaje
  { name: '3 goals (explica+cuenta+agenda)', msg: 'explícame el módulo de trámites, dime cuántos clientes activos tengo y qué citas hay esta semana', d: disc(), judge: (p) => p.goals.length >= 3 && caps(p).some((c) => c === 'explain.module') && caps(p).some((c) => c.startsWith('clients.')) && caps(p).some((c) => c === 'calendar.list') },
  // Referencia a LARGA distancia: cliente activo viejo + foco actual portfolio; retorno explícito
  { name: 'retorno a referente tras cambio de tema', msg: `vale, volvamos a ${C}: ¿tiene tareas pendientes?`, d: disc({ activeModule: 'portfolio', activeEntities: [{ type: 'property', label: 'Piso Centro' }] }), judge: (p) => p.goals.some((g) => g.capability === 'clients.relation.tasks' && !!g.entityRef) },
  // Corrección con contexto de oferta
  { name: 'corrección sobre lo ofrecido', msg: 'no, mejor las perdidas de este trimestre', d: disc({ activeModule: 'operations', offeredCapabilities: ['operations.list'] }), judge: (p) => p.goals.some((g) => g.capability.startsWith('operations') && (g.filters.stage === 'lost' || g.filters.stage === 'closed')) },
  // Selección compuesta dentro de una lectura
  { name: 'top-2 por valor con filtro', msg: 'dime las 2 operaciones ganadas más grandes por valor', d: disc(), judge: (p) => p.goals.some((g) => (g.selection === 'top' && (g.selectionCount ?? 0) === 2 && g.filters.stage === 'won') || (g.capability === 'crm.query' && g.query?.orderingField != null && g.selection === 'top')) },
  // Ambigüedad financiera → aclaración específica (no inventar)
  { name: 'ambigüedad generado (ops vs comisiones)', msg: '¿cuánto hemos generado este mes?', d: disc(), judge: (p) => p.needsClarification || caps(p).includes('commissions.aggregate') || caps(p).includes('operations.aggregate.value') },
  // Introspección con entidad activa: NO buscar, NO actuar
  { name: 'capacidad sobre entidad activa', msg: `¿qué me dejas hacer con ${C}?`, d: disc({ activeModule: 'clients', activeEntities: [{ type: 'client', label: C }] }), judge: (p) => p.speechAct === 'capability_question' && caps(p).includes('capabilities.introspect') && !p.goals.some((g) => g.kind === 'action') },
  // No-overuse: petición directa NO debe ir a crm.query
  { name: 'no-overuse (directa especializada)', msg: '¿cuántas tareas tengo pendientes?', d: disc(), judge: (p) => caps(p).includes('tasks.list') && !caps(p).includes('crm.query') },
  // Valores canónicos bajo paráfrasis
  { name: 'valores canónicos (en curso)', msg: '¿qué operaciones siguen en curso ahora mismo?', d: disc(), judge: (p) => p.goals.some((g) => g.capability.startsWith('operations') && (g.filters.stage === 'open' || !g.filters.stage)) && !p.goals.some((g) => typeof g.filters.stage === 'string' && !['open', 'closed', 'new', 'contacted', 'qualified', 'visit_scheduled', 'offer', 'negotiation', 'reserved', 'won', 'lost'].includes(String(g.filters.stage))) },
  // Agregado no-sum debe ir a crm.query (avg)
  { name: 'avg → crm.query (no operations.aggregate.value)', msg: '¿cuál es el valor medio de las operaciones ganadas?', d: disc(), judge: (p) => p.goals.some((g) => g.capability === 'crm.query' && g.query?.aggregateFn === 'avg') },
]

const MODELS = (process.argv[2] ? process.argv[2].split(',') : ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5-mini', 'gpt-5.1']).map((s) => s.trim()).filter(Boolean)

type Agg = { model: string; ok: number; n: number; ms: number; ptok: number; ctok: number; avail: boolean; schemaFails: number; fails: string[] }
const results: Agg[] = []
for (const model of MODELS) {
  const a: Agg = { model, ok: 0, n: 0, ms: 0, ptok: 0, ctok: 0, avail: true, schemaFails: 0, fails: [] }
  for (const c of CASES) {
    const r = await planTurn(c.msg, c.d, { apiKey: APIKEY, model })
    if (!r.ok) {
      if (/http_(400|404)/.test(r.error)) { a.avail = false; a.fails.push(`${c.name}:${r.error.slice(0, 28)}`); break }
      a.n++; a.schemaFails++; a.fails.push(`${c.name}:${r.error.slice(0, 20)}`); continue
    }
    a.n++; a.ms += r.ms
    const u = r.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    a.ptok += u?.prompt_tokens ?? 0; a.ctok += u?.completion_tokens ?? 0
    if (c.judge(r.plan)) a.ok++; else a.fails.push(c.name)
  }
  results.push(a)
}

console.log(`\nFASE 46 — HARD BENCHMARK (planTurn plan-only) · ${CASES.length} casos difíciles · cliente=${C}\n`)
console.log('  modelo         | acierto | lat.media | tok.out~ | fallos')
for (const a of results) {
  if (!a.avail) { console.log(`  ${a.model.padEnd(14)} | NO DISPONIBLE (${a.fails[0] ?? ''})`); continue }
  console.log(`  ${a.model.padEnd(14)} |  ${String(a.ok).padStart(2)}/${a.n}  |  ${(a.ms / Math.max(1, a.n)).toFixed(0)}ms  |  ${(a.ctok / Math.max(1, a.n)).toFixed(0)}  | ${a.fails.slice(0, 8).join('; ')}`)
}
console.log('\n(mismo prompt/ontología/schema; solo cambia el modelo — FASE 46/47)')
setTimeout(() => process.exit(0), 400)
