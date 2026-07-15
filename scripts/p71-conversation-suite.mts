// P71·It2 — SUITE CONVERSACIONAL FORMAL (versionada). Evoluciona la sonda a un test de APROBACIÓN con
// aserciones SEMÁNTICAS (tool/módulo/estado/consulta real), no de texto literal. Entidades DESCUBIERTAS en
// runtime (nunca hardcode). Cubre: intención pendiente de acción (slot único y múltiple), corrección de
// slot, cancelación, cambio de tema, continuidad temporal (periodo siguiente/anterior), ambigüedad temporal,
// onboarding-vs-dato y grounding. Cada aserción valida MECANISMOS GENERALES, no frases del incidente.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p71-conversation-suite.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { emptyState, applyStateUpdate } = await import('@/lib/agents/conversation-state')
import type { ConversationState } from '@/lib/agents/conversation-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// ── Entidades reales (dinámicas) ────────────────────────────────────────────────────────────────────
const { data: cliRows } = await supabase.from('clients').select('id, name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(5)
const CLIENT = String(cliRows?.[0]?.name ?? 'cliente')
// Un inmueble cuyo título sea una referencia LIMPIA (sin guiones/prefijos) para que la búsqueda sea inequívoca.
const { data: propRows } = await supabase.from('properties').select('id, title').eq('workspace_id', WS).is('deleted_at', null).limit(20)
const cleanProp = (propRows ?? []).map((p) => String(p.title)).find((t) => !t.includes('-')) ?? String(propRows?.[0]?.title ?? 'inmueble')
const PROP = cleanProp

let turnCounter = 0
type Ctx = { state: ConversationState; recentContext: string }
async function say(ctx: Ctx, message: string) {
  const turnId = `suite-${++turnCounter}`
  const r = await tryLocalAnswer(supabase as never, WS, message, { recentContext: ctx.recentContext, state: ctx.state, turnId })
  if (r.handled && r.stateUpdate) ctx.state = applyStateUpdate(ctx.state, r.stateUpdate)
  ctx.recentContext += ` \n usuario: ${message}` + (r.handled ? ` \n asistente: ${r.answer}` : '')
  return r
}
function fresh(): Ctx { return { state: emptyState(), recentContext: '' } }

const results: Array<{ name: string; ok: boolean; detail: string }> = []
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true, detail: '' }) }
  catch (e) { results.push({ name, ok: false, detail: (e as Error).message }) }
}
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg) }
const tool = (r: { handled: boolean; usedTool?: string }) => r.handled ? String(r.usedTool) : 'UNHANDLED'

// ── 1 · Intención pendiente de ACCIÓN, slot que falta → pregunta; complemento → preview (nunca ejecuta) ─
await test('pendingIntent-action: crea intención y pregunta por el slot', async () => {
  const c = fresh()
  const r = await say(c, 'quiero cambiar el precio de un inmueble')
  assert(tool(r).startsWith('local_pending:ask'), `esperaba local_pending:ask, fue ${tool(r)}`)
  assert(c.state.pendingIntent && c.state.pendingIntent.kind === 'action', 'debe quedar una intención pendiente de acción')
  assert(c.state.pendingIntent!.capability === 'portfolio.update_price', `capability inesperada: ${c.state.pendingIntent!.capability}`)
})

await test('pendingIntent-action: el complemento COMPLETA y produce preview/aclaración (no ejecuta)', async () => {
  const c = fresh()
  await say(c, 'quiero cambiar el precio de un inmueble')
  const r = await say(c, `el de ${PROP} a 305.000 €`)
  assert(tool(r).startsWith('local_pending:complete') || tool(r).startsWith('local_action'), `esperaba completar hacia acción/preview, fue ${tool(r)}`)
  // Nunca «aplicado» sin confirmación: la respuesta es preview o desambiguación, jamás verificación.
  assert(r.handled && !/aplicado y verificado/i.test(r.answer), 'una completación NUNCA debe ejecutar directamente')
  assert(!c.state.pendingIntent, 'la intención pendiente debe limpiarse tras completar')
})

// ── 2 · Cancelación explícita limpia la intención ─────────────────────────────────────────────────────
await test('pendingIntent: «cancela» limpia la intención pendiente', async () => {
  const c = fresh()
  await say(c, 'quiero cambiar el precio de un inmueble')
  const r = await say(c, 'déjalo, cancela')
  assert(tool(r).startsWith('local_pending:cancel'), `esperaba local_pending:cancel, fue ${tool(r)}`)
  assert(!c.state.pendingIntent, 'no debe quedar intención pendiente tras cancelar')
})

// ── 3 · Cambio de tema: una petición clara nueva suspende la intención anterior ───────────────────────
await test('pendingIntent: un objetivo NUEVO cancela la intención anterior', async () => {
  const c = fresh()
  await say(c, 'quiero cambiar el precio de un inmueble')
  const r = await say(c, '¿qué clientes tengo?')
  assert(tool(r).startsWith('local_clients'), `esperaba lectura de clientes, fue ${tool(r)}`)
  assert(!c.state.pendingIntent, 'una petición nueva y clara debe cancelar la intención pendiente')
})

// ── 4 · Continuidad temporal: esta semana → la semana que viene (hereda módulo, desplaza periodo) ──────
await test('temporal: consulta acota el periodo y registra alcance semanal', async () => {
  const c = fresh()
  const r = await say(c, '¿qué citas tengo esta semana?')
  assert(tool(r) === 'local_agenda', `esperaba local_agenda, fue ${tool(r)}`)
  assert(c.state.temporalScope?.granularity === 'week', 'debe registrar granularidad semanal')
})

await test('temporal: «¿y la semana que viene?» hereda agenda y DESPLAZA el periodo (re-consulta)', async () => {
  const c = fresh()
  await say(c, '¿qué citas tengo esta semana?')
  const prevStart = c.state.temporalScope!.start!
  const r = await say(c, '¿y la semana que viene?')
  assert(tool(r) === 'local_agenda', `esperaba local_agenda heredado, fue ${tool(r)}`)
  assert(c.state.temporalScope && c.state.temporalScope.start! > prevStart, 'el periodo debe avanzar a la semana siguiente')
})

await test('temporal: «¿y la anterior?» retrocede el periodo', async () => {
  const c = fresh()
  await say(c, '¿qué citas tengo esta semana?')
  const prevStart = c.state.temporalScope!.start!
  const r = await say(c, '¿y la anterior?')
  assert(tool(r) === 'local_agenda', `esperaba local_agenda, fue ${tool(r)}`)
  assert(c.state.temporalScope && c.state.temporalScope.start! < prevStart, 'el periodo debe retroceder a la semana anterior')
})

// ── 5 · Ambigüedad temporal: continuación SIN alcance previo no se inventa (no secuestra) ──────────────
await test('temporal: «¿y la siguiente?» sin alcance previo NO se resuelve como agenda', async () => {
  const c = fresh()
  const r = await say(c, '¿y la siguiente?')
  assert(tool(r) !== 'local_agenda', `no debía inventar agenda sin contexto, fue ${tool(r)}`)
})

// ── 6 · Mes: composición de granularidad distinta ─────────────────────────────────────────────────────
await test('temporal: «este mes» → «¿y el mes que viene?» desplaza por mes', async () => {
  const c = fresh()
  const r1 = await say(c, '¿qué tareas tengo este mes?')
  assert(tool(r1) === 'local_agenda' && c.state.temporalScope?.granularity === 'month', `esperaba agenda mensual, fue ${tool(r1)}/${c.state.temporalScope?.granularity}`)
  const prevStart = c.state.temporalScope!.start!
  const r2 = await say(c, '¿y el mes que viene?')
  assert(tool(r2) === 'local_agenda', `esperaba agenda heredada, fue ${tool(r2)}`)
  assert(c.state.temporalScope!.start! > prevStart && c.state.temporalScope!.granularity === 'month', 'debe avanzar un mes')
})

// ── 7 · onboarding-vs-dato: pregunta de dato con marco de aprendizaje lee el dato ─────────────────────
await test('onboarding-vs-dato: pregunta de dato no deriva a tour', async () => {
  const c = fresh()
  const r = await say(c, 'para entender mejor mi cartera, ¿cuántos inmuebles tengo publicados?')
  assert(tool(r).startsWith('local_') && !tool(r).startsWith('local_turn'), `esperaba lectura de datos, fue ${tool(r)}`)
})

// ── 8 · Grounding: «¿seguro?» reconsulta la fuente, no repite del contexto ─────────────────────────────
await test('grounding: «¿seguro? cuéntalos» reconsulta la fuente en vivo', async () => {
  const c = fresh()
  await say(c, '¿cuántos clientes tengo?')
  const r = await say(c, '¿seguro? cuéntalos otra vez')
  assert(/:rerun$/.test(tool(r)) || tool(r).startsWith('local_clients'), `esperaba reconsulta viva, fue ${tool(r)}`)
})

// ── 9 · Referencia estructural sigue intacta (no regresión del núcleo It1) ─────────────────────────────
await test('referencia: tras buscar un cliente, «¿qué operaciones tiene?» se refiere a ESE cliente', async () => {
  const c = fresh()
  await say(c, `busca el cliente ${CLIENT}`)
  const r = await say(c, '¿qué operaciones tiene?')
  assert(tool(r) === 'local_client_operations', `esperaba operaciones scoped, fue ${tool(r)}`)
})

// ── Resumen ───────────────────────────────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length
console.log(`\nP71·It2 SUITE CONVERSACIONAL — ${passed}/${results.length} PASS  (cliente=${CLIENT} · inmueble=${PROP})\n`)
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `  →  ${r.detail}`}`)
if (passed !== results.length) { console.log('\nFALLOS ARRIBA.'); setTimeout(() => process.exit(1), 200) }
else { console.log('\nTODO VERDE.'); setTimeout(() => process.exit(0), 200) }
