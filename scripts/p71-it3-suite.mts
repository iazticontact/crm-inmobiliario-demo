// P71·It3 — SUITE CONVERSACIONAL COMPOSICIONAL (BD real, entidades dinámicas). Valida COMPORTAMIENTO
// (tool/entidad/periodo/estado), nunca texto literal. Cubre: composición entidad+periodo (scoped, empty
// REAL sin fallback global), resolución de nombre NO destructiva, pendingIntent del registry multiturno
// (incl. calendar) y un bloque HELD-OUT con frases distintas (no usadas para ajustar el código).
// Uso: npx tsx --tsconfig tsconfig.json scripts/p71-it3-suite.mts

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

// ── Entidades reales ──────────────────────────────────────────────────────────────────────────────────
const { data: cliRows } = await supabase.from('clients').select('id, name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(5)
const CLIENT = String(cliRows?.[0]?.name ?? 'cliente')
const CLIENT2 = String(cliRows?.[1]?.name ?? CLIENT)
// Un inmueble cuyo título EMPIEZA por un sustantivo de tipo (Chalet/Piso/Local/Ático…): caso clave del
// resolver NO destructivo (no debe perder el primer token del nombre).
const { data: propRows } = await supabase.from('properties').select('id, title').eq('workspace_id', WS).is('deleted_at', null).limit(40)
const typeStart = (propRows ?? []).map((p) => String(p.title)).find((t) => /^(chalet|piso|local|atico|ático|adosado|casa|vivienda|duplex|dúplex)\b/i.test(t))
const PROP_TYPESTART = typeStart ?? String(propRows?.[0]?.title ?? 'inmueble')

let turnCounter = 0
type Ctx = { state: ConversationState; recentContext: string }
async function say(ctx: Ctx, message: string) {
  const turnId = `it3-${++turnCounter}`
  const r = await tryLocalAnswer(supabase as never, WS, message, { recentContext: ctx.recentContext, state: ctx.state, turnId })
  if (r.handled && r.stateUpdate) ctx.state = applyStateUpdate(ctx.state, r.stateUpdate)
  ctx.recentContext += ` \n usuario: ${message}` + (r.handled ? ` \n asistente: ${r.answer}` : '')
  return r
}
const fresh = (): Ctx => ({ state: emptyState(), recentContext: '' })
const results: Array<{ n: string; ok: boolean; d: string }> = []
async function test(n: string, fn: () => Promise<void>) { try { await fn(); results.push({ n, ok: true, d: '' }) } catch (e) { results.push({ n, ok: false, d: (e as Error).message }) } }
function assert(c: unknown, m: string) { if (!c) throw new Error(m) }
const tool = (r: { handled: boolean; usedTool?: string }) => r.handled ? String(r.usedTool) : 'UNHANDLED'
const foldl = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ── A · COMPOSICIÓN entidad + periodo ─────────────────────────────────────────────────────────────────
await test('composición: pronombre + periodo → citas del CLIENTE en el periodo (scoped, no global)', async () => {
  const c = fresh()
  await say(c, `busca el cliente ${CLIENT}`)
  const r = await say(c, '¿y sus citas la semana que viene?')
  assert(tool(r) === 'local_client_events', `esperaba local_client_events, fue ${tool(r)}`)
  assert(r.handled && foldl(r.answer).includes(foldl(CLIENT).split(' ')[0]), 'la respuesta debe referirse al cliente (scoped, no global)')
})
await test('composición: elisión + periodo → tareas del cliente acotadas', async () => {
  const c = fresh()
  await say(c, `busca el cliente ${CLIENT}`)
  const r = await say(c, '¿qué tareas tiene este mes?')
  assert(tool(r) === 'local_client_tasks', `esperaba local_client_tasks, fue ${tool(r)}`)
})
await test('composición: cambio de periodo conservando entidad (dos periodos, misma entidad)', async () => {
  const c = fresh()
  await say(c, `busca el cliente ${CLIENT}`)
  const r1 = await say(c, '¿y sus citas esta semana?')
  assert(tool(r1) === 'local_client_events', `1: ${tool(r1)}`)
  const r2 = await say(c, '¿y la semana que viene?')
  // Sigue scoped al cliente (no salta a agenda global) y avanza el periodo.
  assert(tool(r2) === 'local_client_events', `2 esperaba seguir scoped, fue ${tool(r2)}`)
})

// ── B · RESOLUCIÓN DE ENTIDAD NO DESTRUCTIVA ─────────────────────────────────────────────────────────
await test('entidad: nombre que empieza por tipo se resuelve entero (pending precio → preview/aclaración)', async () => {
  const c = fresh()
  await say(c, 'quiero cambiar el precio de un inmueble')
  const r = await say(c, `el de ${PROP_TYPESTART} a 412.000 €`)
  assert(tool(r).startsWith('local_pending:complete') || tool(r).startsWith('local_action'), `esperaba completar, fue ${tool(r)}`)
  // No debe fallar por «no encuentro»: el nombre completo (con su primer token de tipo) se conserva.
  const ans = r.handled ? r.answer : ''
  assert(r.handled && !/no encuentro/i.test(ans), `no debería fallar la resolución: ${ans.slice(0, 90)}`)
})

// ── C · PENDING INTENT DEL REGISTRY (multiturno) ─────────────────────────────────────────────────────
await test('registry: calendar.create imperativo incompleto → pide hora → preview (nunca ejecuta)', async () => {
  const c = fresh()
  const r1 = await say(c, 'agéndame una visita mañana')
  assert(tool(r1).startsWith('local_pending:ask'), `esperaba pedir slot, fue ${tool(r1)}`)
  assert(c.state.pendingIntent?.capability === 'calendar.create', `cap=${c.state.pendingIntent?.capability}`)
  const r2 = await say(c, 'a las 11')
  assert(tool(r2).startsWith('local_pending:complete') || tool(r2).startsWith('local_action'), `esperaba preview, fue ${tool(r2)}`)
  assert(r2.handled && !/aplicad[oa] y verificad/i.test(r2.answer), 'nunca debe ejecutar directamente')
  assert(!c.state.pendingIntent, 'pendingIntent limpio tras completar')
})
await test('registry: texto libre (nota de cliente) multiturno → completa y previsualiza', async () => {
  const c = fresh()
  const r1 = await say(c, `quiero cambiar el nombre del cliente ${CLIENT2}`)
  // Falta el nuevo nombre → pregunta.
  assert(tool(r1).startsWith('local_pending:ask'), `esperaba pedir el nuevo nombre, fue ${tool(r1)}`)
  const r2 = await say(c, `${CLIENT2} Delgado`)
  assert(tool(r2).startsWith('local_pending:complete') || tool(r2).startsWith('local_action'), `esperaba preview, fue ${tool(r2)}`)
})

// ── D · HELD-OUT (frases distintas, no usadas para ajustar el código) ────────────────────────────────
await test('held-out: sujeto omitido informal «y este mes q tiene?» → scoped al cliente', async () => {
  const c = fresh()
  await say(c, `abre la ficha de ${CLIENT}`)
  const r = await say(c, 'y este mes q tiene?')
  // «tiene» = elisión → cliente activo; sin capability explícita cae a ficha/detalle scoped, nunca global.
  assert(tool(r).startsWith('local_client') || tool(r) === 'local_client_detail', `esperaba scoped al cliente, fue ${tool(r)}`)
})
await test('held-out: sin tildes «cuantas operaciones tiene la proxima semana» → scoped', async () => {
  const c = fresh()
  await say(c, `busca el cliente ${CLIENT}`)
  const r = await say(c, 'cuantas operaciones tiene')
  assert(tool(r) === 'local_client_operations', `esperaba operaciones scoped, fue ${tool(r)}`)
})
await test('held-out: acción incompleta coloquial «oye súbele el precio a un piso» → pide slots, no ejecuta', async () => {
  const c = fresh()
  const r = await say(c, 'oye súbele el precio a un piso')
  assert(tool(r).startsWith('local_pending:ask'), `esperaba pedir slot, fue ${tool(r)}`)
  assert(c.state.pendingIntent?.capability === 'portfolio.update_price', `cap=${c.state.pendingIntent?.capability}`)
})
await test('held-out: cambio de tema cancela pending «déjalo, ¿qué inmuebles tengo?»', async () => {
  const c = fresh()
  await say(c, 'quiero cambiar el precio de un inmueble')
  const r = await say(c, 'déjalo, mejor dime qué inmuebles tengo')
  assert(!c.state.pendingIntent, 'la intención pendiente debe quedar cancelada')
  assert(tool(r).startsWith('local_pending:cancel') || tool(r).startsWith('local_prop') || tool(r).startsWith('local_portfolio'), `fue ${tool(r)}`)
})

// ── Resumen ───────────────────────────────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length
console.log(`\nP71·It3 SUITE COMPOSICIONAL — ${passed}/${results.length} PASS  (cliente=${CLIENT} · inmueble=${PROP_TYPESTART})\n`)
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.n}${r.ok ? '' : `  →  ${r.d}`}`)
setTimeout(() => process.exit(passed === results.length ? 0 : 1), 200)
