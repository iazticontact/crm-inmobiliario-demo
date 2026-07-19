// FASE 17 — BENCHMARK DE MODELOS del PLANNER. Aísla la calidad de INTERPRETACIÓN (planTurn, sin executor
// ni synth) sobre casos DISCRIMINANTES con datos reales de QA. Mismo prompt/schema para todos. Mide
// acierto de capability/multi-goal/speech-act/temporal + latencia + tokens. Descubre qué modelos están
// realmente disponibles y salta los que fallen. Uso: npx tsx --tsconfig tsconfig.json scripts/planner-model-benchmark.mts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
const WS = 'd0000000-0000-4000-8000-000000000001'
const APIKEY = envLocal('OPENAI_API_KEY')!
const { planTurn } = await import('@/lib/agents/planner/semantic-planner')
import type { DiscourseState, Plan } from '@/lib/agents/planner/semantic-planner'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const { data: cli } = await supabase.from('clients').select('name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(2)
const C = String(cli?.[0]?.name ?? 'cliente')
const disc = (o: Partial<DiscourseState> = {}): DiscourseState => ({ activeModule: null, activeEntities: [], lastListedEntityType: null, offeredCapabilities: [], pendingAction: null, temporalScope: null, ...o })
const caps = (p: Plan) => p.goals.map((g) => g.capability)
const kinds = (p: Plan) => p.goals.map((g) => g.kind)

type Case = { name: string; msg: string; d: DiscourseState; judge: (p: Plan) => boolean }
const CASES: Case[] = [
  { name: 'detalle terse (abre a X)', msg: `abre a ${C}`, d: disc(), judge: (p) => caps(p).includes('clients.detail') },
  { name: 'detalle explícito', msg: `dame la ficha completa de ${C}`, d: disc(), judge: (p) => caps(p).includes('clients.detail') },
  { name: 'multi-goal explain+read', msg: 'explícame el módulo de operaciones y dime cuántas tengo abiertas', d: disc(), judge: (p) => kinds(p).includes('explain') && p.goals.some((g) => g.kind === 'read') },
  { name: 'pronombre+relación+periodo', msg: '¿y sus citas de esta semana?', d: disc({ activeModule: 'clients', activeEntities: [{ type: 'client', label: C }] }), judge: (p) => caps(p).includes('clients.relation.events') && p.goals.some((g) => !!g.temporal) },
  { name: 'corrección de tema', msg: 'no no, me refería a las ganadas, no a las abiertas', d: disc({ activeModule: 'operations' }), judge: (p) => caps(p).some((c) => c.startsWith('operations')) },
  { name: 'financiero comisiones', msg: '¿cuánto llevo generado en comisiones este mes?', d: disc(), judge: (p) => caps(p).includes('commissions.aggregate') || p.needsClarification },
  { name: 'pregunta de capacidad', msg: '¿se pueden cambiar los precios de los pisos desde aquí?', d: disc(), judge: (p) => p.speechAct === 'capability_question' && !kinds(p).includes('action') },
  { name: 'oferta→aceptación', msg: 'venga sí, enséñamelas', d: disc({ offeredCapabilities: ['operations.list'] }), judge: (p) => p.speechAct === 'accept_offer' && caps(p).includes('operations.list') },
  { name: 'ordinal tras lista', msg: 'ábreme el detalle del segundo', d: disc({ lastListedEntityType: 'client', activeModule: 'clients' }), judge: (p) => caps(p).some((c) => c.endsWith('.detail')) && p.goals.some((g) => !!g.entityRef) },
  { name: 'agregado valor ventas', msg: 'dime el valor total de lo vendido este mes', d: disc(), judge: (p) => p.goals.some((g) => g.capability === 'operations.aggregate.value' || g.aggregation === 'sum') },
]

const MODELS = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-5.1', 'gpt-5-mini']

type Agg = { model: string; ok: number; n: number; ms: number; ptok: number; ctok: number; avail: boolean; fails: string[] }
const results: Agg[] = []
for (const model of MODELS) {
  const a: Agg = { model, ok: 0, n: 0, ms: 0, ptok: 0, ctok: 0, avail: true, fails: [] }
  for (const c of CASES) {
    const r = await planTurn(c.msg, c.d, { apiKey: APIKEY, model })
    if (!r.ok) { if (/http_(400|404)/.test(r.error)) { a.avail = false; a.fails.push(`${c.name}:${r.error.slice(0, 24)}`); break } a.n++; a.fails.push(`${c.name}:${r.error.slice(0, 16)}`); continue }
    a.n++; a.ms += r.ms
    const u = r.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    a.ptok += u?.prompt_tokens ?? 0; a.ctok += u?.completion_tokens ?? 0
    if (c.judge(r.plan)) a.ok++; else a.fails.push(c.name)
  }
  results.push(a)
}

console.log(`\nFASE 17 — BENCHMARK DE MODELOS (planTurn plan-only) · ${CASES.length} casos discriminantes · cliente=${C}\n`)
console.log('  modelo         | acierto | lat.media | tok.prompt~ | tok.out~ | fallos')
for (const a of results) {
  if (!a.avail) { console.log(`  ${a.model.padEnd(14)} | NO DISPONIBLE via chat/completions+json_schema (${a.fails[0] ?? ''})`); continue }
  console.log(`  ${a.model.padEnd(14)} |  ${a.ok}/${a.n}   |  ${(a.ms / Math.max(1, a.n)).toFixed(0)}ms  |   ${(a.ptok / Math.max(1, a.n)).toFixed(0)}   |   ${(a.ctok / Math.max(1, a.n)).toFixed(0)}   | ${a.fails.slice(0, 6).join(', ')}`)
}
setTimeout(() => process.exit(0), 400)
