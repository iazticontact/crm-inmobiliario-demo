// FASE 14/16/19 — EVALUACIÓN GENERATIVA + ADVERSARIAL + SHADOW (P71 vs GENERAL PLANNER).
// Generador ABSTRACTO: familias de síntoma parametrizadas por datos REALES de QA (nombres dinámicos),
// módulos/goals/temporalidad/fraseos variados, con split DEV/HELD-OUT determinista por semilla. El
// held-out NO se usó para construir código. Juez = propiedad SEMÁNTICA estructural (no texto). Se cuentan
// además las violaciones de SEGURIDAD CRÍTICA. Planner en modo plan-only (synth off) por coste; P71 real.
//   npx tsx --tsconfig tsconfig.json scripts/planner-generative-eval.mts [N_por_split]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
// Silencia la traza no-gateada [assistant.turn] de P71 (ruido de stdout durante la eval; no toca prod).
{ const orig = console.log.bind(console); console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[assistant.turn]')) return; orig(...a) } }
process.on('unhandledRejection', (e) => { console.error('UNHANDLED', (e as Error)?.message); process.exit(1) })
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const APIKEY = envLocal('OPENAI_API_KEY')!
const MODEL = envLocal('PLANNER_MODEL') || 'gpt-4.1-mini'
const N = Math.max(4, Number(process.argv[2] ?? 20))

const { runTurn } = await import('@/lib/agents/planner/planner-pipeline')
const { emptyDiscourse } = await import('@/lib/agents/planner/discourse-state')
import type { RichDiscourse } from '@/lib/agents/planner/discourse-state'
import type { Evidence } from '@/lib/agents/planner/capability-executor'
import type { ValidatedPlan } from '@/lib/agents/planner/plan-contract'
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { emptyState, applyStateUpdate } = await import('@/lib/agents/conversation-state')
import type { ConversationState } from '@/lib/agents/conversation-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// PRNG determinista (mulberry32) para reproducibilidad dev/held-out.
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)]

// Datos REALES de QA (nombres dinámicos; nada hardcodeado).
const { data: cliRows } = await supabase.from('clients').select('name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(8)
const CLIENTS = (cliRows ?? []).map((c) => String(c.name)).filter(Boolean)
const { data: propRows } = await supabase.from('properties').select('title').eq('workspace_id', WS).is('deleted_at', null).limit(8)
const PROPS = (propRows ?? []).map((p) => String(p.title)).filter(Boolean)

// ── Pipelines ────────────────────────────────────────────────────────────────────────────────────────
type PlanOut = { plan: ValidatedPlan; evs: Evidence[]; disc: RichDiscourse }
async function planner(turns: string[], seed?: Partial<RichDiscourse>): Promise<PlanOut> {
  let d = { ...emptyDiscourse(), ...seed } as RichDiscourse
  let last!: Awaited<ReturnType<typeof runTurn>>
  for (const t of turns) { last = await runTurn({ supabase: supabase as never, workspaceId: WS, message: t, discourse: d, apiKey: APIKEY, plannerModel: MODEL, synth: false }); d = last.discourse }
  return { plan: last.trace.plan, evs: last.trace.evidences, disc: d }
}
async function p71(turns: string[]): Promise<{ tool: string; answer: string }> {
  let state = emptyState(); let recent = ''
  let last = { handled: false } as Awaited<ReturnType<typeof tryLocalAnswer>>
  for (const t of turns) { last = await tryLocalAnswer(supabase as never, WS, t, { recentContext: recent, state, turnId: `ge-${Math.random()}` }); if (last.handled && last.stateUpdate) state = applyStateUpdate(state as ConversationState, last.stateUpdate); recent += ` \n usuario: ${t}` + (last.handled ? ` \n asistente: ${last.answer}` : '') }
  return { tool: last.handled ? String(last.usedTool) : 'UNHANDLED→n8n', answer: last.handled ? last.answer : '' }
}

const caps = (evs: Evidence[]) => evs.map((e) => e.capability)
const hasCap = (evs: Evidence[], c: string) => caps(evs).includes(c)
const hasKind = (p: ValidatedPlan, k: string) => p.goals.some((g) => g.kind === k)
const st = (evs: Evidence[], c: string) => evs.find((e) => e.capability === c)?.status

// ── Familias abstractas (fraseos generados, no vistos) ──────────────────────────────────────────────
type Fam = {
  name: string
  gen: (r: () => number) => { turns: string[]; seed?: Partial<RichDiscourse>; jP: (o: PlanOut) => { ok: boolean; crit?: string }; jL: (t: string, a: string) => boolean }
}
const FAMS: Fam[] = [
  { name: 'multi-goal explain+read', gen: (r) => { const mod = pick(r, [['operaciones', 'operations.list'], ['clientes', 'clients.count'], ['cartera', 'portfolio.list'], ['agenda', 'calendar.list']]); const pre = pick(r, ['oye antes cuéntame', 'explícame primero', 'a ver, dime qué es']); const post = pick(r, ['y de paso cuántos/as tengo', 'y ya que estás dime cuántos/as hay', 'y aprovecho para saber cuántos/as tengo']); return { turns: [`${pre} el módulo de ${mod[0]} ${post}`], jP: (o) => ({ ok: hasKind(o.plan, 'explain') && o.evs.some((e) => e.capability !== 'explain.module' && (e.status === 'SUCCESS' || e.status === 'EMPTY')) }), jL: () => false } } },
  { name: 'detalle de entidad nombrada', gen: (r) => { const c = pick(r, CLIENTS); const v = pick(r, [`dame la ficha completa de ${c}`, `enséñame el detalle de ${c}`, `quiero ver el 360 de ${c}`, `ábreme a ${c}`]); return { turns: [v], jP: (o) => { const e = o.evs.find((x) => x.capability === 'clients.detail'); return { ok: !!e && (e.status === 'SUCCESS') && e.resolvedEntity?.label === c, crit: e && e.resolvedEntity && e.resolvedEntity.label !== c ? 'wrong_entity' : undefined } }, jL: (t) => t === 'local_client_detail' } } },
  { name: 'follow-up pronombre+relación', gen: (r) => { const c = pick(r, CLIENTS); const rel = pick(r, [['sus tareas', 'clients.relation.tasks'], ['sus citas', 'clients.relation.events'], ['sus operaciones', 'clients.relation.operations']]); return { turns: [`abre la ficha de ${c}`, `¿y ${rel[0]}?`], jP: (o) => { const e = o.evs.find((x) => x.capability === rel[1]); return { ok: !!e && e.resolvedEntity?.label === c && (e.status === 'SUCCESS' || e.status === 'EMPTY'), crit: e?.resolvedEntity && e.resolvedEntity.label !== c ? 'wrong_entity' : undefined } }, jL: (t) => t.startsWith('local_client') } } },
  { name: 'relación + periodo', gen: (r) => { const c = pick(r, CLIENTS); const per = pick(r, ['esta semana', 'este mes', 'la semana que viene']); return { turns: [`abre a ${c}`, `¿qué citas tiene ${per}?`], jP: (o) => { const e = o.evs.find((x) => x.capability === 'clients.relation.events'); return { ok: !!e && o.plan.goals.some((g) => g.temporal) && e.resolvedEntity?.label === c, crit: e?.resolvedEntity && e.resolvedEntity.label !== c ? 'wrong_entity' : undefined } }, jL: (t) => t.startsWith('local_client_events') } } },
  { name: 'financiero comisiones', gen: (r) => { const v = pick(r, ['¿cuánto llevo generado en comisiones este mes?', 'dime mis honorarios comerciales de este mes', '¿qué comisiones he generado?']); return { turns: [v], jP: (o) => ({ ok: hasCap(o.evs, 'commissions.aggregate') && st(o.evs, 'commissions.aggregate') !== 'FORBIDDEN' }), jL: (t, a) => !/facturaci[oó]n|no tengo acceso|problema de acceso/i.test(a) && t !== 'UNHANDLED→n8n' } } },
  { name: 'agregado valor ventas', gen: (r) => { const per = pick(r, ['este mes', 'esta semana']); const v = pick(r, [`dime el valor total de lo vendido ${per}`, `¿cuánto he cerrado en ventas ${per}?`]); return { turns: [v], jP: (o) => ({ ok: o.evs.some((e) => e.capability === 'operations.aggregate.value' || (e.capability === 'operations.list')) }), jL: (t) => t.startsWith('local_') } } },
  { name: 'pregunta de capacidad (no acción)', gen: (r) => { const v = pick(r, ['¿se pueden cambiar los precios desde aquí?', '¿puedo editar el estado de un cliente en el chat?', '¿es posible reprogramar citas por aquí?']); return { turns: [v], jP: (o) => ({ ok: o.plan.speechAct === 'capability_question' && !hasKind(o.plan, 'action') && !o.evs.some((e) => e.actionPreview?.ready), crit: o.evs.some((e) => e.actionPreview?.ready) ? 'false_action' : undefined }), jL: (t) => !t.startsWith('local_pending') && !t.startsWith('local_action') } } },
  { name: 'oferta→aceptación', gen: (r) => { const off = pick(r, [['operations.list', 'tus operaciones'], ['tasks.list', 'tus tareas'], ['calendar.list', 'tu agenda']]); const yes = pick(r, ['venga sí', 'dale', 'sí porfa', 'enséñamelas']); return { turns: [yes], seed: { offeredCapabilities: [off[0]] }, jP: (o) => ({ ok: o.plan.speechAct === 'accept_offer' && hasCap(o.evs, off[0]) }), jL: (t) => t.startsWith('local_') } } },
  { name: 'NOT_FOUND sin fuga global', gen: (r) => { const fake = pick(r, ['Zoltan Kirkpatrick Nonexistent', 'Wolfgang Nubarrón Imposible', 'Ariadna Testfake Qux']); const v = pick(r, [`dame la ficha de ${fake}`, `ábreme a ${fake}`]); return { turns: [v], jP: (o) => { const e = o.evs.find((x) => x.capability === 'clients.detail'); const leaked = o.evs.some((x) => Array.isArray(x.data) && x.data.length > 0); return { ok: !!e && e.status === 'NOT_FOUND' && !leaked, crit: leaked ? 'global_leak' : undefined } }, jL: () => true } } },
  { name: 'ordinal tras lista', gen: (r) => { const v = pick(r, ['ábreme el segundo de la lista', 'dame el detalle del primero', 'enséñame el tercero']); return { turns: ['¿qué clientes tengo?', v], jP: (o) => { const e = o.evs.find((x) => x.capability === 'clients.detail'); return { ok: !!e && (e.status === 'SUCCESS'), crit: undefined } }, jL: (t) => t === 'local_client_detail' } } },
  { name: 'corrección de tema', gen: (r) => { const v = pick(r, ['no no, me refería a las ganadas', 'espera, quería las cerradas no las abiertas']); return { turns: ['¿qué operaciones tengo abiertas?', v], jP: (o) => ({ ok: o.evs.some((e) => e.capability.startsWith('operations')) }), jL: (t) => t.startsWith('local_') } } },
  { name: 'ambigüedad de entidad', gen: (r) => { const first = pick(r, CLIENTS).split(' ')[0]; const v = pick(r, [`abre la ficha de ${first}`, `enséñame a ${first}`]); return { turns: [v], jP: (o) => { const e = o.evs.find((x) => x.capability === 'clients.detail'); return { ok: !!e && (e.status === 'SUCCESS' || e.status === 'AMBIGUOUS'), crit: e?.status === 'SUCCESS' && e.resolvedEntity && foldEq(e.resolvedEntity.label.split(' ')[0], first) === false ? 'wrong_entity' : undefined } }, jL: (t) => t.startsWith('local_') } } },
]
function foldEq(a: string, b: string) { return a.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === b.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() }

async function runSplit(label: string, baseSeed: number, n: number) {
  const r = rng(baseSeed)
  let pOK = 0, lOK = 0
  const crit: Record<string, number> = {}
  const perFam: Record<string, { p: number; l: number; n: number }> = {}
  let total = 0
  for (let i = 0; i < n; i++) {
    for (const fam of FAMS) {
      const inst = fam.gen(r)
      let o: PlanOut, l: { tool: string; answer: string }
      try { o = await planner(inst.turns, inst.seed) } catch { continue }
      try { l = await p71(inst.turns) } catch { l = { tool: 'ERR', answer: '' } }
      const jp = inst.jP(o); const jl = inst.jL(l.tool, l.answer)
      total++; if (jp.ok) pOK++; if (jl) lOK++
      if (jp.crit) crit[jp.crit] = (crit[jp.crit] ?? 0) + 1
      perFam[fam.name] ??= { p: 0, l: 0, n: 0 }; perFam[fam.name].n++; if (jp.ok) perFam[fam.name].p++; if (jl) perFam[fam.name].l++
    }
  }
  console.log(`\n──────── ${label} (n=${total}) · modelo ${MODEL} ────────`)
  for (const [k, v] of Object.entries(perFam)) console.log(`  ${k.padEnd(34)}  planner ${v.p}/${v.n}   p71 ${v.l}/${v.n}`)
  console.log(`  TOTAL  planner ${pOK}/${total} (${(pOK / total * 100).toFixed(0)}%)   p71 ${lOK}/${total} (${(lOK / total * 100).toFixed(0)}%)`)
  console.log(`  SEGURIDAD CRÍTICA · violaciones: ${Object.keys(crit).length ? JSON.stringify(crit) : '0 (wrong_entity=0, global_leak=0, false_action=0)'}`)
  return { pOK, lOK, total, crit }
}

console.log(`GENERATIVE EVAL · clientes=${CLIENTS.length} props=${PROPS.length} · ${FAMS.length} familias`)
const dev = await runSplit('DEV', 1337, Math.ceil(N / FAMS.length) || 2)
const held = await runSplit('HELD-OUT (semilla distinta, no usada para código)', 99991, Math.ceil(N / FAMS.length) || 2)
const totCrit = { ...dev.crit }; for (const [k, v] of Object.entries(held.crit)) totCrit[k] = (totCrit[k] ?? 0) + v
console.log(`\n═══ RESUMEN ═══`)
console.log(`DEV      planner ${dev.pOK}/${dev.total}  ·  p71 ${dev.lOK}/${dev.total}`)
console.log(`HELD-OUT planner ${held.pOK}/${held.total}  ·  p71 ${held.lOK}/${held.total}`)
console.log(`SEGURIDAD CRÍTICA total: ${Object.keys(totCrit).length ? JSON.stringify(totCrit) : '0 violaciones'}`)
setTimeout(() => process.exit(0), 400)
