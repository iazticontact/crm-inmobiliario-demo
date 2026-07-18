// P71 — SOAK ADVERSARIAL: 30 conversaciones LARGAS (30-80 turnos) generadas con SEED reproducible,
// mezclando lecturas, referencias, ordinales, tiempo, cambios de tema, retornos, correcciones, typos,
// mensajes irrelevantes, acciones INCOMPLETAS (siempre canceladas) y previews de automatización (siempre
// descartadas). NO ejecuta ninguna mutación real. En cada turno se verifican INVARIANTES (no textos):
//   · sin excepciones · higiene (cero UUID/secretos/stacks) · cero «aplicado y verificado» (soak es RO)
//   · estado ACOTADO (entidades≤8, referentes≤12, refs≤25) · scoped ⇒ la respuesta es de ESA entidad
//   · workspace ajeno ⇒ cero nombres del demo · latencia registrada (p50/p95/p99)
// Epílogo: cero pendings/reglas/residuos en BD. Uso: npx tsx --tsconfig tsconfig.json scripts/p71-soak-adversarial.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const WS_OTHER = 'd0000000-0000-4000-8000-0000000000ff'
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { emptyState, applyStateUpdate } = await import('@/lib/agents/conversation-state')
import type { ConversationState } from '@/lib/agents/conversation-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const SEED = 'p71-soak-2026-07-18'
function hash32(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function mkRng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

const { data: cliRows } = await supabase.from('clients').select('id, name').eq('workspace_id', WS).is('deleted_at', null).limit(6)
const CLIENTS = (cliRows ?? []).map((c) => ({ id: String(c.id), name: String(c.name) }))
const SUITE_START_ISO = new Date(Date.now() - 60_000).toISOString()

// ── Generadores de turno (clases semánticas; el contenido usa entidades dinámicas) ────────────────────
type Gen = (r: () => number) => string
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)]
const client = (r: () => number) => pick(r, CLIENTS)
const typo = (r: () => number, s: string) => { const w = s.split(' '); const i = w.findIndex((x) => x.length > 5); if (i < 0) return s; const j = 1 + Math.floor(r() * (w[i].length - 3)); w[i] = w[i].slice(0, j) + w[i][j + 1] + w[i][j] + w[i].slice(j + 2); return w.join(' ') }
const GENS: Array<[number, Gen]> = [
  [3, (r) => pick(r, ['hola', 'buenas', 'gracias', 'vale', 'ok', 'genial'])],
  [6, (r) => pick(r, ['¿cuántos clientes tengo?', '¿qué inmuebles tengo publicados?', '¿qué operaciones tengo abiertas?', '¿cuántas tareas pendientes hay?', '¿qué trámites tengo abiertos?', '¿qué citas tengo esta semana?', '¿qué tareas tengo este mes?'])],
  [5, (r) => `busca el cliente ${client(r).name}`],
  [5, (r) => pick(r, ['¿y sus operaciones?', '¿qué tareas tiene?', '¿y sus inmuebles?', '¿y sus citas?', '¿qué citas tiene esta semana?'])],
  [3, (r) => pick(r, ['dame la ficha del primero', 'enséñame el más caro', 'la ficha del segundo'])],
  [4, (r) => pick(r, ['¿y la semana que viene?', '¿y el mes anterior?', '¿y la siguiente?', '¿y este mes?'])],
  [3, (r) => pick(r, ['¿seguro? míralo otra vez', 'repítelo', 'vuelve a mirar'])],
  [3, (r) => pick(r, ['¿para qué sirve la cartera?', '¿cómo funciona el calendario?', '¿qué muestra el dashboard?'])],
  [3, (r) => pick(r, ['¿puedo cambiar el precio de un inmueble?', '¿se puede cambiar la prioridad de una tarea?', '¿puedes crear citas?'])],
  [3, (r) => pick(r, ['quiero cambiar el precio de un inmueble', 'necesito actualizar el teléfono de un cliente', 'quiero agendar una visita mañana'])],
  [3, (r) => pick(r, ['cancela', 'déjalo, no importa', 'olvídalo'])],
  [2, (r) => pick(r, ['actívame un resumen diario a las 8', 'activa un aviso de tareas vencidas a las 8'])],
  [2, (r) => pick(r, ['mejor no, descártala', 'no, déjalo'])],
  [3, (r) => typo(r, pick(r, ['¿cuántos clientes tengo registrados?', '¿qué operaciones tengo abiertas ahora?', '¿qué inmuebles tengo publicados hoy?']))],
  [2, (r) => pick(r, ['¿qué tiempo hace hoy?', 'cuéntame un chiste', 'jajaja', '???', 'mmm no sé'])],
  [2, (r) => pick(r, ['no me refiero a eso', 'te has confundido', 'eso no es lo que pedí'])],
  [2, (r) => pick(r, ['¿qué requiere atención?', 'lista mis automatizaciones'])],
  [2, (r) => `¿qué operaciones tiene ${client(r).name}?`],
  [1, () => 'sí'],
  [1, () => 'no'],
]
const TOTAL_W = GENS.reduce((a, [w]) => a + w, 0)
function genTurn(r: () => number): string {
  let x = r() * TOTAL_W
  for (const [w, g] of GENS) { if ((x -= w) <= 0) return g(r) }
  return GENS[0][1](r)
}

// ── Harness + invariantes ─────────────────────────────────────────────────────────────────────────────
type Ctx = { state: ConversationState; recentContext: string }
const violations: string[] = []
const latencies: number[] = []
let turns = 0, handled = 0, delegated = 0, errors = 0
const HYGIENE = /([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|service_role|x-nowcrm|AGENT_TOOL_SECRET|stack trace|\bat [A-Za-z].*\(.*:\d+:\d+\))/i

async function turn(ctx: Ctx, msg: string, ws = WS, convId = 0): Promise<void> {
  const t0 = Date.now()
  turns++
  let r
  try {
    r = await tryLocalAnswer(supabase as never, ws, msg, { recentContext: ctx.recentContext, state: ctx.state, turnId: `soak-${convId}-${turns}` })
  } catch (e) {
    errors++
    violations.push(`EXCEPTION conv${convId} turno${turns} «${msg.slice(0, 40)}»: ${(e as Error).message.slice(0, 80)}`)
    return
  }
  latencies.push(Date.now() - t0)
  if (!r.handled) { delegated++; ctx.recentContext = (ctx.recentContext + ` \n usuario: ${msg}`).slice(-4000); return }
  handled++
  const ans = r.answer
  if (HYGIENE.test(ans)) violations.push(`HIGIENE conv${convId} «${msg.slice(0, 30)}» → fuga técnica en la respuesta`)
  if (/aplicad[oa] y verificad/i.test(ans)) violations.push(`MUTACIÓN conv${convId} «${msg.slice(0, 40)}» → el soak NO debe ejecutar nada`)
  if (/activada y programada/i.test(ans)) violations.push(`AUTOMATIZACIÓN CREADA conv${convId} «${msg.slice(0, 40)}» → el soak solo debe dejar previews`)
  // scoped ⇒ de ESA entidad (el nombre del cliente activo aparece; jamás el de otro)
  if (/^local_client_/.test(r.usedTool)) {
    const active = ctx.state.activeEntities.find((e) => e.entityType === 'client')
    const target = r.stateUpdate?.resolvedEntities?.find((e) => e.entityType === 'client') ?? active
    if (target && !fold(ans).includes(fold(target.displayLabel.split(' ')[0]))) {
      violations.push(`WRONG-ENTITY conv${convId} «${msg.slice(0, 40)}» → scoped sin la entidad esperada`)
    }
  }
  // CROSS-WS: la FUGA real es DATA del demo (filas devueltas) o un nombre del demo que NO estaba en la
  // propia pregunta. Un «no encuentro a X» que hace ECO del término buscado no es fuga (X no existe allí).
  if (ws === WS_OTHER) {
    const foldedMsg = fold(msg)
    const leakName = CLIENTS.find((c) => fold(ans).includes(fold(c.name.split(' ')[0])) && !foldedMsg.includes(fold(c.name.split(' ')[0])))
    if (leakName) violations.push(`CROSS-WS conv${convId} «${msg.slice(0, 30)}» → nombre del demo NO pedido en workspace ajeno`)
    if ((r.referencedList?.length ?? 0) > 0) violations.push(`CROSS-WS conv${convId} «${msg.slice(0, 30)}» → ${r.referencedList!.length} filas de datos en workspace ajeno`)
  }
  if (r.stateUpdate) ctx.state = applyStateUpdate(ctx.state, r.stateUpdate)
  // Estado ACOTADO (fuga de memoria conversacional = violación)
  if (ctx.state.activeEntities.length > 8 || ctx.state.previousEntities.length > 8 || ctx.state.referents.length > 12 || (ctx.state.lastDataQuery?.resultRefs.length ?? 0) > 25) {
    violations.push(`ESTADO SIN LÍMITE conv${convId} turno${turns}`)
  }
  ctx.recentContext = (ctx.recentContext + ` \n usuario: ${msg} \n asistente: ${ans}`).slice(-4000)
}

// ── 30 conversaciones largas (seed reproducible) + inyecciones deliberadas cada 5-10 turnos ───────────
console.log(`\nP71 SOAK ADVERSARIAL — seed ${SEED} · ${CLIENTS.length} entidades dinámicas\n`)
const t0 = Date.now()
for (let conv = 1; conv <= 30; conv++) {
  const r = mkRng(hash32(SEED + ':' + conv))
  const len = 30 + Math.floor(r() * 51) // 30-80
  const ctx: Ctx = { state: emptyState(), recentContext: '' }
  let sinceInjection = 0
  for (let i = 0; i < len; i++) {
    let msg = genTurn(r)
    sinceInjection++
    if (sinceInjection >= 5 + Math.floor(r() * 6)) {
      // Inyección deliberada: cambio de módulo / referente antiguo / corrección / periodo / no-relacionado
      msg = pick(r, [
        '¿qué inmuebles tengo publicados?',
        'volvamos al cliente de antes, ¿qué tareas tiene?',
        `mejor dime las operaciones de ${client(r).name}`,
        '¿y el mes que viene?',
        '¿cuál es la capital de Francia?',
      ])
      sinceInjection = 0
    }
    await turn(ctx, msg, WS, conv)
  }
  await turn(ctx, 'cancela', WS, conv) // higiene: jamás dejar pendiente vivo
  if (ctx.state.pendingIntent) violations.push(`PENDING RESIDUAL conv${conv} al cerrar`)
  process.stdout.write(`  conv ${conv}: ${len + 1} turnos ✓\n`)
}

// ── Rondas multi-hilo (3 contextos intercalados, MISMO cliente ≠ hilos) + workspace ajeno ─────────────
{
  const r = mkRng(hash32(SEED + ':interleave'))
  const tabs: Ctx[] = [0, 1, 2].map(() => ({ state: emptyState(), recentContext: '' }))
  for (let i = 0; i < 30; i++) {
    const k = i % 3
    await turn(tabs[k], i < 3 ? `busca el cliente ${CLIENTS[k % CLIENTS.length].name}` : genTurn(r), WS, 100 + k)
  }
  for (const [k, tab] of tabs.entries()) { await turn(tab, 'cancela', WS, 100 + k) }
  process.stdout.write('  interleave 3-hilos: 33 turnos ✓\n')
}
{
  const r = mkRng(hash32(SEED + ':ws-other'))
  const ctx: Ctx = { state: emptyState(), recentContext: '' }
  for (let i = 0; i < 20; i++) await turn(ctx, genTurn(r), WS_OTHER, 200)
  process.stdout.write('  workspace ajeno: 20 turnos ✓\n')
}

// ── Métricas + epílogo de BD ──────────────────────────────────────────────────────────────────────────
latencies.sort((a, b) => a - b)
const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0
const durMin = ((Date.now() - t0) / 60000).toFixed(1)
console.log(`\nTurnos: ${turns} · handled ${handled} (${(100 * handled / turns).toFixed(1)}%) · delegados ${delegated} · excepciones ${errors} · ${durMin} min`)
console.log(`Latencia local p50=${pct(50)}ms · p95=${pct(95)}ms · p99=${pct(99)}ms`)

let dbClean = true
{
  const { data: pend } = await supabase.from('assistant_actions').select('id').eq('workspace_id', WS).eq('status', 'pending').gte('created_at', SUITE_START_ISO)
  for (const p of pend ?? []) { await supabase.from('assistant_actions').update({ status: 'cancelled' }).eq('id', p.id) }
  if ((pend?.length ?? 0) > 0) console.log(`epílogo: ${pend!.length} pending del soak canceladas`)
  const { count: rules } = await supabase.from('assistant_automation_rules').select('id', { count: 'exact', head: true }).eq('workspace_id', WS).gte('created_at', SUITE_START_ISO)
  if ((rules ?? 0) > 0) { dbClean = false; console.log(`⛔ ${rules} reglas creadas por el soak (no debía crear ninguna)`) }
  const { data: weird } = await supabase.from('properties').select('id').eq('workspace_id', WS).in('price', [999999, 777777])
  if ((weird?.length ?? 0) > 0) { dbClean = false; console.log('⛔ precios centinela en cartera') }
}

if (violations.length) { console.log(`\nVIOLACIONES (${violations.length}):`); for (const v of violations.slice(0, 30)) console.log(`  ✗ ${v}`) }
const ok = violations.length === 0 && errors === 0 && dbClean
console.log(ok ? '\nP71 SOAK: TODO PASS (0 violaciones de invariantes)' : '\nP71 SOAK: CON VIOLACIONES')
setTimeout(() => process.exit(ok ? 0 : 1), 200)
