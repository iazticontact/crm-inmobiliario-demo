// P71 — BLACK-BOX NATURAL. Conversaciones LARGAS y naturales (20 conversaciones × 6-14 turnos) con estilos
// distintos, evaluadas por SEMÁNTICA del comportamiento (objetivo/capability/entidad/scope/seguridad), nunca
// por texto exacto. Incluye: no-contaminación A→B→A con pronombre, relación vacía sin fallback global,
// dos pestañas (mismo hilo, estados re-cargados), y aislamiento de workspaces. Entidades QA dinámicas.
// Complementa (no sustituye) p71-realtime-e2e.mts, que cubre la mutación externa del dato (freshness BD).
// Uso: npx tsx --tsconfig tsconfig.json scripts/p71-blackbox-natural.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const WS_OTHER = 'd0000000-0000-4000-8000-0000000000ff'
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { emptyState, applyStateUpdate, validateConversationState } = await import('@/lib/agents/conversation-state')
import type { ConversationState } from '@/lib/agents/conversation-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const { data: cli } = await supabase.from('clients').select('id, name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(4)
const C = (cli ?? []).map((c) => ({ id: String(c.id), name: String(c.name) }))
const A = C[0], B = C[1] ?? C[0]
const { data: pr } = await supabase.from('properties').select('id, title').eq('workspace_id', WS).is('deleted_at', null).limit(10)
const P = { id: String(pr?.[0]?.id), title: String(pr?.[0]?.title ?? 'inmueble') }

let turnCounter = 0
type Ctx = { state: ConversationState; recentContext: string }
async function say(ctx: Ctx, message: string, ws = WS) {
  const turnId = `bb-${++turnCounter}`
  const r = await tryLocalAnswer(supabase as never, ws, message, { recentContext: ctx.recentContext, state: ctx.state, turnId })
  if (r.handled && r.stateUpdate) ctx.state = applyStateUpdate(ctx.state, r.stateUpdate)
  ctx.recentContext += ` \n usuario: ${message}` + (r.handled ? ` \n asistente: ${r.answer}` : '')
  return r
}
const fresh = (): Ctx => ({ state: emptyState(), recentContext: '' })
const tool = (r: { handled: boolean; usedTool?: string }) => (r.handled ? String(r.usedTool) : 'UNHANDLED')
type T = { m: string; check?: (r: Awaited<ReturnType<typeof say>>, c: Ctx) => string | null }
const results: Array<{ name: string; ok: boolean; detail: string }> = []
async function conv(name: string, turns: T[], ws = WS) {
  const c = fresh()
  for (let i = 0; i < turns.length; i++) {
    const r = await say(c, turns[i].m, ws)
    const err = turns[i].check ? turns[i].check!(r, c) : null
    if (err) { results.push({ name: `${name} · turno ${i + 1} («${turns[i].m.slice(0, 40)}…»)`, ok: false, detail: err }); return }
  }
  results.push({ name, ok: true, detail: '' })
}
const noExec = (r: { handled: boolean; answer?: string }) => (r.handled && /aplicad[oa] y verificad/i.test(r.answer ?? '') ? 'ejecutó sin confirmar' : null)
const scoped = (name: string) => (r: { handled: boolean; answer?: string }) => (r.handled && fold(r.answer!).includes(fold(name.split(' ')[0])) ? null : `no se refiere a ${name.split(' ')[0]}`)
const handledOk = (r: { handled: boolean }) => (r.handled ? null : 'no resuelto (delegado)')

// ── 20 conversaciones naturales (estilos distintos, sin frases del incidente) ─────────────────────────
await conv('1 agente nuevo (formal, saludo→guía→dato→detalle)', [
  { m: 'Hola, buenos días' , check: handledOk },
  { m: 'Soy nuevo en la agencia, ¿por dónde empiezo?', check: handledOk },
  { m: '¿Cuántos clientes tengo registrados?', check: (r) => (r.handled && /\d/.test(r.answer!) ? null : 'sin conteo') },
  { m: 'dame la ficha del primero', check: (r) => (tool(r) === 'local_client_detail' ? null : `fue ${tool(r)}`) },
  { m: '¿y sus operaciones?', check: (r) => (tool(r).startsWith('local_client_operations') ? null : `fue ${tool(r)}`) },
])
await conv('2 con prisa (elipsis, minúsculas, sin signos)', [
  { m: `busca a ${A.name.toLowerCase()}`, check: handledOk },
  { m: 'operaciones', check: handledOk },
  { m: 'y sus citas', check: (r) => (tool(r).startsWith('local_client_events') ? null : `fue ${tool(r)}`) },
  { m: 'vale gracias', check: handledOk },
])
await conv('3 faltas de ortografía', [
  { m: 'cuantos inmuebels tengo publicados', check: handledOk },
  { m: 'y cuantas tareas pendietnes hay', check: handledOk },
  { m: '¿seguro? mira otra vez', check: (r) => (/rerun$/.test(tool(r)) || r.handled ? null : 'no reconsultó') },
])
await conv('4 cambio de tema y vuelta', [
  { m: `ficha de ${A.name}`, check: scoped(A.name) },
  { m: '¿qué pisos hay en cartera?', check: handledOk },
  { m: 'enséñame el más caro', check: handledOk },
  { m: `¿y las tareas de ${A.name}?`, check: (r) => (tool(r).startsWith('local_client_tasks') || tool(r) === 'local_scope:clarify' ? null : `fue ${tool(r)}`) },
])
await conv('5 A→B→A con pronombre (no contaminación)', [
  { m: `busca el cliente ${A.name}`, check: scoped(A.name) },
  { m: `ahora la ficha de ${B.name}`, check: scoped(B.name) },
  { m: '¿qué operaciones tiene?', check: (r) => { // el pronombre es del MÁS RECIENTE (B); jamás mezclar con A
    if (!r.handled) return 'no resuelto'
    if (A.id !== B.id && fold(r.answer!).includes(fold(A.name.split(' ')[0])) && !fold(r.answer!).includes(fold(B.name.split(' ')[0]))) return 'contaminación: usó A tras cambiar a B'
    return null
  } },
])
await conv('6 acción incompleta multiturno + corrección + preview', [
  { m: 'quiero cambiar el precio de un inmueble', check: (r) => (tool(r).startsWith('local_pending:ask') ? null : `fue ${tool(r)}`) },
  { m: '450000', check: noExec },
  { m: 'mejor 425000', check: noExec },
  { m: `el de ${P.title}`, check: (r) => noExec(r) ?? (tool(r).startsWith('local_pending:complete') || tool(r).startsWith('local_action') ? null : `no llegó a preview: ${tool(r)}`) },
  { m: 'cancela', check: handledOk },
])
await conv('7 pregunta de capacidad → deseo → slots → cancelación', [
  { m: '¿puedo cambiar el estado de un cliente?', check: (r) => (tool(r).startsWith('local_pending') ? 'capacidad abrió acción' : null) },
  { m: 'pues sí, quiero cambiar el estado de un cliente', check: (r) => (tool(r).startsWith('local_pending:ask') ? null : `fue ${tool(r)}`) },
  { m: 'déjalo', check: (r, c) => (c.state.pendingIntent ? 'no canceló' : null) },
])
await conv('8 agenda semanal → siguiente → cliente concreto', [
  { m: '¿qué citas tengo esta semana?', check: (r) => (tool(r) === 'local_agenda' ? null : `fue ${tool(r)}`) },
  { m: '¿y la que viene?', check: (r, c) => (tool(r) === 'local_agenda' && c.state.temporalScope?.interpretation?.includes('siguiente') ? null : `fue ${tool(r)}`) },
  { m: `¿y las de ${A.name}?`, check: (r) => (tool(r).startsWith('local_client_events') || tool(r) === 'local_scope:clarify' ? null : `fue ${tool(r)}`) },
])
await conv('9 operaciones por periodo (multimódulo)', [
  { m: '¿qué operaciones tienen cierre previsto este mes?', check: (r) => (tool(r).startsWith('local_period:operations') ? null : `fue ${tool(r)}`) },
  { m: '¿y el mes que viene?', check: (r) => (tool(r).startsWith('local_period:operations') ? null : `fue ${tool(r)}`) },
])
await conv('10 trámites que vencen + continuidad', [
  { m: '¿qué trámites vencen esta semana?', check: (r) => (tool(r).startsWith('local_period:cases') ? null : `fue ${tool(r)}`) },
  { m: '¿y la siguiente?', check: (r) => (tool(r).startsWith('local_period:cases') ? null : `fue ${tool(r)}`) },
])
await conv('11 relación vacía (periodo lejano) sin fallback global', [
  { m: `busca el cliente ${A.name}`, check: scoped(A.name) },
  { m: 'sus citas entre 2031-03-01 y 2031-03-07', check: (r) => {
    if (tool(r) === 'local_agenda') return 'cayó a agenda GLOBAL'
    if (!tool(r).startsWith('local_client_events')) return `fue ${tool(r)}`
    return (r.handled && (r.referencedList?.length ?? 0) === 0) ? null : 'devolvió datos fuera del scope'
  } },
])
await conv('12 coloquial + automatización con preview y cancelación', [
  { m: 'oye, actívame un resumen diario a las 8', check: (r) => (tool(r).startsWith('local_automation') && !/activada y programada/i.test(r.handled ? r.answer! : '') ? null : `fue ${tool(r)}`) },
  { m: 'mejor no, descártala', check: handledOk },
  { m: 'sí, confirma', check: (r) => (r.handled && /activada y programada/i.test(r.answer!) ? 'confirmó una automatización CANCELADA' : null) },
])
await conv('13 cita nueva multiturno (desiderativo → hora → preview → cancel)', [
  { m: 'necesito agendar una visita el viernes', check: (r) => (tool(r).startsWith('local_pending:ask') ? null : `fue ${tool(r)}`) },
  { m: 'sí', check: (r) => (tool(r).startsWith('local_pending:ask') ? null : `un «sí» debía re-preguntar: ${tool(r)}`) },
  { m: 'a las 10 y media', check: (r) => noExec(r) ?? (tool(r).startsWith('local_pending:complete') || tool(r).startsWith('local_action') ? null : `fue ${tool(r)}`) },
  { m: 'cancela', check: handledOk },
])
await conv('14 usuario que corrige al asistente', [
  { m: '¿cuántas operaciones tengo?', check: handledOk },
  { m: 'no me refiero a eso, quería decir operaciones GANADAS', check: handledOk },
  { m: '¿cuántas operaciones ganadas tengo?', check: (r) => (r.handled && /\d/.test(r.answer!) ? null : 'sin dato') },
])
await conv('15 explicación vs dato en el mismo hilo', [
  { m: '¿para qué sirve el módulo de trámites?', check: (r) => (tool(r).startsWith('local_turn') ? null : `explicación leyó datos: ${tool(r)}`) },
  { m: 'vale, ¿y cuántos trámites tengo abiertos?', check: (r) => (r.handled && /\d/.test(r.answer!) ? null : 'sin dato') },
])
await conv('16 findings / atención', [
  { m: '¿qué requiere atención hoy?', check: handledOk },
])
await conv('17 dos entidades del mismo tipo → pronombre ambiguo pide claridad o usa la última', [
  { m: `ficha de ${A.name}`, check: scoped(A.name) },
  { m: `ficha de ${B.name}`, check: scoped(B.name) },
  { m: '¿y su teléfono?', check: (r) => {
    if (!r.handled) return null // delegar al cerebro es aceptable aquí
    if (A.id !== B.id && fold(r.answer!).includes(fold(A.name.split(' ')[0]))) return 'respondió del ANTIGUO sin aclarar'
    return null
  } },
])
await conv('18 informal extremo', [
  { m: 'q tal, cuantos clientes tengo?', check: (r) => (r.handled && /\d/.test(r.answer!) ? null : 'sin dato') },
  { m: 'y pisos?', check: handledOk },
])
await conv('19 negación no es acción', [
  { m: `no cambies el precio de ${P.title}`, check: (r) => (r.handled && /cambio preparado|antes:/i.test(fold(r.answer!)) ? 'una NEGACIÓN preparó una acción' : null) },
])
await conv('20 flujo completo lectura→acción completa→preview→cancel→relectura', [
  { m: `ficha de ${A.name}`, check: scoped(A.name) },
  { m: `añade una nota al cliente ${A.name}: llamó interesado en local`, check: (r) => noExec(r) ?? null },
  { m: 'cancela', check: handledOk },
  { m: '¿y sus tareas?', check: (r) => (tool(r).startsWith('local_client_tasks') || tool(r) === 'local_ref:clarify' ? null : `fue ${tool(r)}`) },
])

// ── DOS PESTAÑAS: mismo hilo, estados independientes re-cargados de BD simulada (validate/serialize) ──
{
  const tab1 = fresh()
  await say(tab1, `busca el cliente ${A.name}`)
  // «otra pestaña»: el estado viaja por persistencia (serialización JSON) — nunca referencias en memoria
  const tab2: Ctx = { state: validateConversationState(JSON.parse(JSON.stringify(tab1.state)))!, recentContext: '' }
  const r = await say(tab2, '¿qué operaciones tiene?')
  results.push({ name: '21 dos pestañas: el estado sobrevive serialización y sigue scoped', ok: tool(r).startsWith('local_client_operations'), detail: tool(r) })
}
// ── AISLAMIENTO DE WORKSPACE ───────────────────────────────────────────────────────────────────────────
{
  const c = fresh()
  const r = await say(c, '¿qué clientes tengo?', WS_OTHER)
  const leaked = r.handled && C.some((x) => fold(r.answer!).includes(fold(x.name.split(' ')[0])))
  results.push({ name: '22 workspace ajeno: cero datos del demo', ok: !leaked, detail: leaked ? 'FUGA' : '' })
}

const pass = results.filter((r) => r.ok).length
console.log(`\nP71 BLACK-BOX NATURAL — ${pass}/${results.length} PASS\n`)
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `  →  ${r.detail}`}`)
setTimeout(() => process.exit(pass === results.length ? 0 : 1), 200)
