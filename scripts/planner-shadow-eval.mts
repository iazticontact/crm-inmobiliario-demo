// SHADOW EVAL — P71 (regex/handlers) vs GENERAL SEMANTIC PLANNER (LLM), sobre CATEGORÍAS ABSTRACTAS de los
// síntomas reportados, con fraseos NO usados para construir ninguno de los dos sistemas y módulos/entidades
// variados. Juez = propiedad SEMÁNTICA estructural (no texto). Objetivo: demostrar si el planner GENERALIZA
// donde el árbol de regex falla — reportando también los fallos del planner (sin cherry-pick). Reads QA,
// NINGUNA mutación (el planner no ejecuta; P71 solo se consulta por su tool). gpt-4.1-mini (cerebro del CRM).
// Uso: npx tsx --tsconfig tsconfig.json scripts/planner-shadow-eval.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const APIKEY = envLocal('OPENAI_API_KEY')!
const MODEL = 'gpt-4.1-mini'
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { emptyState, applyStateUpdate } = await import('@/lib/agents/conversation-state')
import type { ConversationState } from '@/lib/agents/conversation-state'
const { planTurn } = await import('@/lib/agents/planner/semantic-planner')
import type { DiscourseState, Plan } from '@/lib/agents/planner/semantic-planner'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const { data: cli } = await supabase.from('clients').select('id, name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(2)
const C = String(cli?.[0]?.name ?? 'cliente')

// P71 multi-turno real
type Ctx = { state: ConversationState; recentContext: string }
async function p71(turns: string[]): Promise<{ tool: string; answer: string }> {
  const c: Ctx = { state: emptyState(), recentContext: '' }
  let last = { handled: false } as Awaited<ReturnType<typeof tryLocalAnswer>>
  for (const t of turns) { last = await tryLocalAnswer(supabase as never, WS, t, { recentContext: c.recentContext, state: c.state, turnId: `sh-${Math.random()}` }); if (last.handled && last.stateUpdate) c.state = applyStateUpdate(c.state, last.stateUpdate); c.recentContext += ` \n usuario: ${t}` + (last.handled ? ` \n asistente: ${last.answer}` : '') }
  return { tool: last.handled ? String(last.usedTool) : 'UNHANDLED→n8n', answer: last.handled ? last.answer : '' }
}
const plan = async (message: string, state: DiscourseState): Promise<Plan | null> => { const r = await planTurn(message, state, { apiKey: APIKEY, model: MODEL }); return r.ok ? r.plan : null }
const emptyDisc = (): DiscourseState => ({ activeModule: null, activeEntities: [], lastListedEntityType: null, offeredCapabilities: [], pendingAction: null, temporalScope: null })
const caps = (p: Plan | null) => (p?.goals ?? []).map((g) => g.capability)
const hasKind = (p: Plan | null, k: string) => (p?.goals ?? []).some((g) => g.kind === k)

// ── Categorías abstractas de síntoma (fraseos NUEVOS, módulos variados) ──────────────────────────────
type Scn = { cat: string; msg: string; disc: DiscourseState; p71turns: string[]; prop: string; judgeP71: (t: string, a: string) => boolean; judgePlan: (p: Plan | null) => boolean }
const S: Scn[] = [
  { cat: 'multi-goal (explain+read)', msg: 'oye antes de nada cuéntame qué es el módulo de operaciones y ya de paso cuántas tengo abiertas',
    disc: emptyDisc(), p71turns: ['oye antes de nada cuéntame qué es el módulo de operaciones y ya de paso cuántas tengo abiertas'],
    prop: 'plan con ≥2 goals (explain + read); P71 hace solo uno',
    judgeP71: () => false /* P71 devuelve un solo turnType — no puede componer explain+read */,
    judgePlan: (p) => hasKind(p, 'explain') && hasKind(p, 'read') },
  { cat: 'multi-goal (explain+read) cartera', msg: 'explícame para qué vale la cartera y dime cuántos pisos tengo publicados',
    disc: emptyDisc(), p71turns: ['explícame para qué vale la cartera y dime cuántos pisos tengo publicados'],
    prop: 'plan con explain + read', judgeP71: () => false, judgePlan: (p) => hasKind(p, 'explain') && hasKind(p, 'read') },
  { cat: 'oferta→aceptación', msg: 'venga sí, enséñamelas',
    disc: { ...emptyDisc(), offeredCapabilities: ['operations.list'] }, p71turns: ['¿quieres que te muestre tus operaciones?', 'venga sí, enséñamelas'],
    prop: 'planner: accept_offer + goal operations.list', judgeP71: (t) => t.startsWith('local_operations') || t.startsWith('local_offer'),
    judgePlan: (p) => p?.speechAct === 'accept_offer' && caps(p).includes('operations.list') },
  { cat: 'oferta→aceptación (otra capability)', msg: 'sí porfa',
    disc: { ...emptyDisc(), offeredCapabilities: ['tasks.list'] }, p71turns: ['¿te muestro tus tareas pendientes?', 'sí porfa'],
    prop: 'planner acepta y pide tasks.list', judgeP71: (t) => t.startsWith('local_tasks') || t.startsWith('local_offer') || t.startsWith('local_agenda'),
    judgePlan: (p) => caps(p).includes('tasks.list') },
  { cat: 'pregunta de capacidad', msg: '¿oye se pueden cambiar los precios de los pisos desde aquí?',
    disc: emptyDisc(), p71turns: ['¿oye se pueden cambiar los precios de los pisos desde aquí?'],
    prop: 'capability_question, SIN goal de acción', judgeP71: (t) => !t.startsWith('local_pending') && !t.startsWith('local_action'),
    judgePlan: (p) => p?.speechAct === 'capability_question' && !hasKind(p, 'action') },
  { cat: 'detalle scoped, no global', msg: `dame la ficha completa de ${C}`,
    disc: emptyDisc(), p71turns: [`dame la ficha completa de ${C}`],
    prop: 'read detail de UN cliente (no lista global)', judgeP71: (t) => t === 'local_client_detail',
    judgePlan: (p) => caps(p).some((c) => c === 'clients.detail') && (p?.goals ?? []).some((g) => g.capability === 'clients.detail' && !!g.entityRef) },
  { cat: 'financiero ≠ acceso denegado', msg: '¿cuánto llevo generado en comisiones este mes?',
    disc: emptyDisc(), p71turns: ['¿cuánto llevo generado en comisiones este mes?'],
    prop: 'planner: commissions.aggregate (o aclaración), NO falso acceso', judgeP71: (t, a) => !/facturaci[oó]n|no tengo acceso|problema de acceso/i.test(a) && t !== 'UNHANDLED→n8n',
    judgePlan: (p) => caps(p).includes('commissions.aggregate') || p?.needsClarification === true },
  { cat: 'onboarding + dato', msg: 'acabo de entrar hoy, oye ¿cuántas citas tengo esta semana?',
    disc: emptyDisc(), p71turns: ['acabo de entrar hoy, oye ¿cuántas citas tengo esta semana?'],
    prop: 'plan incluye un read (no solo onboarding)', judgeP71: (t) => t.startsWith('local_agenda') || t.startsWith('local_calendar'),
    judgePlan: (p) => hasKind(p, 'read') && caps(p).some((c) => c === 'calendar.list') },
  { cat: 'pronombre + relación + periodo', msg: '¿y sus citas de la semana que viene?',
    disc: { ...emptyDisc(), activeModule: 'clients', activeEntities: [{ type: 'client', label: C }] }, p71turns: [`busca el cliente ${C}`, '¿y sus citas de la semana que viene?'],
    prop: 'read relación citas del cliente + temporal', judgeP71: (t) => t.startsWith('local_client_events'),
    judgePlan: (p) => caps(p).includes('clients.relation.events') && (p?.goals ?? []).some((g) => g.temporal) },
  { cat: 'ordinal tras lista', msg: 'ábreme el detalle del segundo de la lista',
    disc: { ...emptyDisc(), lastListedEntityType: 'client', activeModule: 'clients' }, p71turns: ['¿qué clientes tengo?', 'ábreme el detalle del segundo de la lista'],
    prop: 'read detail con entityRef ordinal', judgeP71: (t) => t === 'local_client_detail',
    judgePlan: (p) => caps(p).some((c) => c.endsWith('.detail')) && (p?.goals ?? []).some((g) => !!g.entityRef) },
  { cat: 'corrección de tema', msg: 'no no, me refería a las operaciones ganadas, no a las abiertas',
    disc: { ...emptyDisc(), activeModule: 'operations' }, p71turns: ['¿qué operaciones tengo abiertas?', 'no no, me refería a las operaciones ganadas, no a las abiertas'],
    prop: 'planner: correction + read operations (stage ganadas)', judgeP71: (t) => t.startsWith('local_'),
    judgePlan: (p) => caps(p).some((c) => c.startsWith('operations')) },
  { cat: 'agregado temporal ventas', msg: 'dime el valor total de lo que he vendido este mes',
    disc: emptyDisc(), p71turns: ['dime el valor total de lo que he vendido este mes'],
    prop: 'planner: aggregate sum de operaciones ganadas + temporal', judgeP71: (t) => t.startsWith('local_'),
    judgePlan: (p) => (p?.goals ?? []).some((g) => g.aggregation === 'sum' || g.capability === 'operations.aggregate.value') },
]

type Row = { cat: string; p71: boolean; planner: boolean; p71tool: string; plancaps: string }
const rows: Row[] = []
for (const s of S) {
  const a = await p71(s.p71turns)
  const p = await plan(s.msg, s.disc)
  rows.push({ cat: s.cat, p71: s.judgeP71(a.tool, a.answer), planner: s.judgePlan(p), p71tool: a.tool, plancaps: caps(p).join('+') || (p?.needsClarification ? 'CLARIFY' : p?.speechAct ?? 'null') })
}

const p71ok = rows.filter((r) => r.p71).length
const planok = rows.filter((r) => r.planner).length
console.log(`\nSHADOW EVAL — categorías abstractas de síntoma (${rows.length}) · modelo ${MODEL} · cliente=${C}\n`)
console.log('  cat                                   | P71 | PLANNER | p71.tool / planner.caps')
for (const r of rows) console.log(`  ${r.cat.padEnd(37)} |  ${r.p71 ? '✓' : '✗'}  |    ${r.planner ? '✓' : '✗'}    | ${r.p71tool}  /  ${r.plancaps}`)
console.log(`\nP71: ${p71ok}/${rows.length} · PLANNER: ${planok}/${rows.length}`)
console.log(`Multi-goal (P71 estructuralmente incapaz): ${rows.filter((r) => r.cat.startsWith('multi-goal')).length} categorías`)
setTimeout(() => process.exit(0), 300)
