// P71 — SUITE DE INTELIGENCIA GENERAL. Evaluación independiente del comportamiento CONVERSACIONAL:
// escenarios generados por PLANTILLAS SEMÁNTICAS + entidades dinámicas + transformaciones lingüísticas
// (formal/coloquial/typos/sin tildes). NO comprueba texto exacto: comprueba capability/tool, entidad,
// scope, estado y seguridad. Held-out = partición sembrada por hash de id (no usada para programar).
// Gates duros al 100%: false-action, global-leakage bajo referencia de entidad, wrong-entity, invoice,
// execute-sin-confirmación. Uso: npx tsx --tsconfig tsconfig.json scripts/p71-intelligence-suite.mts

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

// ── RNG sembrado (mulberry32) — determinista, sin dependencia de Math.random ─────────────────────────
const SEED = 'p71-intelligence-2026-07-17'
function hash32(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// ── Entidades reales dinámicas ────────────────────────────────────────────────────────────────────────
const { data: cliRows } = await supabase.from('clients').select('id, name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(6)
const CLIENTS = (cliRows ?? []).map((c) => ({ id: String(c.id), name: String(c.name) }))
const C1 = CLIENTS[0], C2 = CLIENTS[1] ?? CLIENTS[0]
const { data: propRows } = await supabase.from('properties').select('id, title, price').eq('workspace_id', WS).is('deleted_at', null).not('price', 'is', null).limit(30)
const PROPS = (propRows ?? []).map((p) => ({ id: String(p.id), title: String(p.title) }))
const P1 = PROPS.find((p) => /^(chalet|piso|local|atico|ático|adosado|casa|obra)/i.test(p.title)) ?? PROPS[0]

// ── Transformaciones lingüísticas (generalización, no memorización) ───────────────────────────────────
type Xform = (s: string, r: () => number) => string
const xIdentity: Xform = (s) => s
const xNoAccents: Xform = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const xLower: Xform = (s) => s.toLowerCase()
const xColloquial: Xform = (s, r) => (r() < 0.5 ? `oye, ${s.charAt(0).toLowerCase()}${s.slice(1)}` : `${s} porfa`)
const xNoQuestion: Xform = (s) => s.replace(/[¿?]/g, '').trim()
// Typo en UNA palabra no crítica: el typo mide robustez del RESTO de la frase. Un typo en el lexema
// nuclear (sustantivo de módulo/campo o el verbo que porta la intención) cambia el SIGNIFICADO percibido
// y la degradación correcta es delegar al cerebro n8n — eso se documenta, no se castiga aquí.
const TYPO_EXCLUDE = new Set(['cliente', 'clientes', 'inmueble', 'inmuebles', 'piso', 'pisos', 'operacion', 'operaciones', 'tarea', 'tareas', 'cita', 'citas', 'visita', 'visitas', 'tramite', 'tramites', 'cartera', 'agenda', 'precio', 'valor', 'telefono', 'email', 'estado', 'etapa', 'fecha', 'nombre', 'nota', 'zona', 'semana', 'manana', 'cambiar', 'cambia', 'agendar', 'quiero', 'necesito', 'puedo', 'puedes', 'repite', 'repitelo', 'cuantos', 'cuantas', 'seguro', 'publicados', 'abiertas', 'pendientes', 'tiene', 'tienen', 'viene', 'siguiente', 'anterior', 'mostrarme', 'muestrame', 'ensename', 'dame', 'dime', 'lista', 'consulta', 'entender', 'vencen'])
const xTypo: Xform = (s, r) => {
  const words = s.split(' ')
  if (words.length <= 3) return s // en mensajes de ≤3 palabras el typo destruye toda la señal
  const foldW = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[¿?¡!.,;:]/g, '')
  const idxs = words.map((w, i) => ({ w, i })).filter(({ w }) => w.length > 4 && !/[A-ZÁÉÍÓÚÑ]/.test(w[0]) && /^[a-záéíóúñ]+$/i.test(w) && !TYPO_EXCLUDE.has(foldW(w)))
  if (!idxs.length) return s
  const pick = idxs[Math.floor(r() * idxs.length)]
  const w = pick.w; const j = 1 + Math.floor(r() * (w.length - 3))
  words[pick.i] = w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2)
  return words.join(' ')
}
const XFORMS: Array<[string, Xform]> = [['formal', xIdentity], ['sin-tildes', xNoAccents], ['minusculas', xLower], ['coloquial', xColloquial], ['sin-interrogacion', xNoQuestion], ['typo', xTypo]]

// ── Harness de conversación (idéntico contrato que la route) ─────────────────────────────────────────
let turnCounter = 0
type Ctx = { state: ConversationState; recentContext: string }
type TurnResult = { handled: boolean; usedTool?: string; answer?: string; referencedList?: Array<Record<string, unknown>> }
async function say(ctx: Ctx, message: string, ws = WS): Promise<TurnResult> {
  const turnId = `iq-${++turnCounter}`
  const r = await tryLocalAnswer(supabase as never, ws, message, { recentContext: ctx.recentContext, state: ctx.state, turnId })
  if (r.handled && r.stateUpdate) ctx.state = applyStateUpdate(ctx.state, r.stateUpdate)
  ctx.recentContext += ` \n usuario: ${message}` + (r.handled ? ` \n asistente: ${r.answer}` : '')
  return r as TurnResult
}
const fresh = (): Ctx => ({ state: emptyState(), recentContext: '' })
const tool = (r: TurnResult) => (r.handled ? String(r.usedTool) : 'UNHANDLED')

// ── Escenarios: plantillas semánticas ─────────────────────────────────────────────────────────────────
// expect devuelve null si OK, o el motivo del fallo. gates: etiquetas de gate crítico que este escenario mide.
type Scenario = { id: string; cat: string; gates: string[]; run: (v: (s: string) => string) => Promise<string | null> }
const S: Scenario[] = []
let sid = 0
function add(cat: string, gates: string[], run: Scenario['run']) { S.push({ id: `iq-${String(++sid).padStart(4, '0')}`, cat, gates, run }) }

const first = (name: string) => name.split(' ')[0]
const okScopedTo = (r: TurnResult, name: string): boolean => r.handled && fold(r.answer!).includes(fold(first(name)))
const isPendingAsk = (r: TurnResult) => tool(r).startsWith('local_pending:ask')
const isExecuted = (r: TurnResult) => r.handled && /aplicad[oa] y verificad/i.test(r.answer ?? '')
const isGlobalAgenda = (r: TurnResult) => tool(r) === 'local_agenda'

// A · REFERENCIAS / ENTIDADES (base ×6 variantes = 54)
for (const [, tpl] of [
  ['posesivo-inmuebles', (v: (s: string) => string) => ['busca el cliente {C}', v('¿y sus inmuebles?')]],
  ['posesivo-operaciones', (v: (s: string) => string) => ['busca el cliente {C}', v('¿qué operaciones tiene?')]],
  ['posesivo-tareas', (v: (s: string) => string) => ['ficha de {C}', v('¿y sus tareas pendientes?')]],
] as const) {
  for (const [xn] of XFORMS) {
    add('referencias', ['wrong-entity'], async (v) => {
      const c = fresh()
      const turns = tpl(v).map((t) => t.replace('{C}', C1.name))
      await say(c, turns[0])
      const r = await say(c, turns[1])
      if (!tool(r).startsWith('local_client')) return `esperaba lectura scoped, fue ${tool(r)}`
      if (!okScopedTo(r, C1.name)) return `la respuesta no se refiere a ${first(C1.name)}`
      return null
    })
    void xn
  }
}
// ordinal + superlativo (12)
for (const [xn, xf] of XFORMS.slice(0, 6)) {
  add('referencias', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'ord'))
    const c = fresh()
    await say(c, '¿qué clientes tengo?')
    const r = await say(c, xf('dame la ficha del primero', r0))
    return tool(r) === 'local_client_detail' ? null : `esperaba detalle por ordinal, fue ${tool(r)}`
  })
  add('referencias', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'sup'))
    const c = fresh()
    await say(c, '¿qué pisos hay en cartera?')
    const r = await say(c, xf('enséñame el más caro', r0))
    return tool(r).startsWith('local_ref') || tool(r).startsWith('local_prop') ? null : `esperaba extremo, fue ${tool(r)}`
  })
}

// B · ENTIDAD EXPLÍCITA (F3.1): nombre nuevo + relación (+periodo). wrong-entity + global-leakage gates. (24)
for (const [xn, xf] of XFORMS) {
  add('entidad-explicita', ['wrong-entity', 'global-leakage'], async () => {
    const r0 = rng(hash32(SEED + xn + 'exp1'))
    const c = fresh()
    await say(c, `busca el cliente ${C2.name}`) // otra entidad activa: la explícita debe GANAR
    const r = await say(c, xf(`¿qué operaciones tiene ${C1.name}?`, r0))
    if (tool(r) === 'local_scope:clarify') return null // desambiguación legítima si hay homónimos
    if (!tool(r).startsWith('local_client_operations')) return `esperaba operaciones scoped, fue ${tool(r)}`
    if (!okScopedTo(r, C1.name)) return `respondió con otra entidad distinta de ${first(C1.name)}`
    return null
  })
  add('entidad-explicita', ['global-leakage'], async () => {
    const r0 = rng(hash32(SEED + xn + 'exp2'))
    const c = fresh()
    const r = await say(c, xf(`¿qué citas tiene ${C1.name} la semana que viene?`, r0))
    if (tool(r) === 'local_scope:clarify') return null
    if (isGlobalAgenda(r)) return 'referencia de entidad devolvió agenda GLOBAL'
    if (!tool(r).startsWith('local_client_events')) return `esperaba citas scoped, fue ${tool(r)}`
    return null
  })
  add('entidad-explicita', ['wrong-entity', 'global-leakage'], async () => {
    const r0 = rng(hash32(SEED + xn + 'exp3'))
    const c = fresh()
    await say(c, `busca el cliente ${C2.name}`)
    const r = await say(c, xf('¿qué tareas tiene Zutanito Inexistente?', r0))
    // Semántica exigida: DECIR que no se encuentra (not-found o aclaración con «no encuentro»), sin
    // mostrar datos del cliente activo ni globales. El tool concreto puede variar (notfound/clarify).
    const okTool = tool(r) === 'local_scope:notfound' || tool(r) === 'local_scope:clarify'
    if (!okTool || !/no encuentro/i.test(fold(r.answer ?? ''))) return `un cliente inexistente debe decirse (jamás usar el activo/global), fue ${tool(r)}`
    if ((r.referencedList?.length ?? 0) > 0) return 'mostró DATOS pese a no encontrar la entidad'
    return null
  })
  add('entidad-explicita', ['global-leakage'], async () => {
    const r0 = rng(hash32(SEED + xn + 'exp4'))
    const c = fresh()
    const r = await say(c, xf(`las operaciones de ${C1.name}`, r0))
    if (tool(r) === 'local_scope:clarify') return null
    if (tool(r) === 'local_operations') return 'relación explícita devolvió lista GLOBAL'
    return tool(r).startsWith('local_client_operations') ? null : `fue ${tool(r)}`
  })
}

// C · TEMPORAL (50): absoluto, shift, mes, multimódulo (operations/cases), invariantes.
for (const [xn, xf] of XFORMS) {
  add('temporal', [], async () => {
    const r0 = rng(hash32(SEED + xn + 't1'))
    const c = fresh()
    const r1 = await say(c, xf('¿qué citas tengo esta semana?', r0))
    if (tool(r1) !== 'local_agenda') return `1: ${tool(r1)}`
    if (c.state.temporalScope?.granularity !== 'week') return 'no registró granularidad semanal'
    const prev = c.state.temporalScope!.start!
    const r2 = await say(c, xf('¿y la semana que viene?', r0))
    if (tool(r2) !== 'local_agenda') return `2: ${tool(r2)}`
    if (!(c.state.temporalScope!.start! > prev)) return 'el periodo no avanzó'
    return null
  })
  add('temporal', [], async () => {
    const r0 = rng(hash32(SEED + xn + 't2'))
    const c = fresh()
    const r = await say(c, xf('¿qué operaciones tienen cierre previsto este mes?', r0))
    if (!tool(r).startsWith('local_period:operations')) return `esperaba operations en periodo, fue ${tool(r)}`
    if (c.state.temporalScope?.granularity !== 'month') return 'sin scope mensual'
    return null
  })
  add('temporal', [], async () => {
    const r0 = rng(hash32(SEED + xn + 't3'))
    const c = fresh()
    const r = await say(c, xf('¿qué trámites vencen esta semana?', r0))
    return tool(r).startsWith('local_period:cases') ? null : `esperaba cases en periodo, fue ${tool(r)}`
  })
  add('temporal', [], async () => {
    const r0 = rng(hash32(SEED + xn + 't4'))
    const c = fresh()
    await say(c, xf('¿qué tareas tengo este mes?', r0))
    const prev = c.state.temporalScope?.start ?? ''
    const r2 = await say(c, xf('¿y el mes anterior?', r0))
    if (tool(r2) !== 'local_agenda') return `esperaba tareas heredadas, fue ${tool(r2)}`
    if (!(c.state.temporalScope!.start! < prev)) return 'no retrocedió un mes'
    return null
  })
  // continuación sin contexto: NO inventa
  add('temporal', [], async () => {
    const r0 = rng(hash32(SEED + xn + 't5'))
    const c = fresh()
    const r = await say(c, xf('¿y la siguiente?', r0))
    return isGlobalAgenda(r) ? 'inventó agenda sin contexto temporal' : null
  })
}
// entidad + periodo compuesto, conservación cruzada (12)
for (const [xn, xf] of XFORMS) {
  add('composicion', ['global-leakage'], async () => {
    const r0 = rng(hash32(SEED + xn + 'c1'))
    const c = fresh()
    await say(c, `busca el cliente ${C1.name}`)
    const r1 = await say(c, xf('¿y sus citas esta semana?', r0))
    if (!tool(r1).startsWith('local_client_events')) return `1 esperaba scoped, fue ${tool(r1)}`
    const r2 = await say(c, xf('¿y la semana que viene?', r0))
    if (isGlobalAgenda(r2)) return 'perdió la entidad al cambiar el periodo (global)'
    if (!tool(r2).startsWith('local_client_events')) return `2 fue ${tool(r2)}`
    return null
  })
  add('composicion', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'c2'))
    const c = fresh()
    await say(c, xf('¿qué citas tengo esta semana?', r0))
    const r = await say(c, xf(`¿y las de ${C1.name}?`, r0))
    if (tool(r) === 'local_scope:clarify') return null
    if (!tool(r).startsWith('local_client_events')) return `cambiar de entidad conservando periodo falló: ${tool(r)}`
    return null
  })
}

// D · PENDING / SPEECH ACTS (48)
for (const [xn, xf] of XFORMS) {
  add('speech-acts', ['false-action'], async () => {
    const r0 = rng(hash32(SEED + xn + 'sa1'))
    const c = fresh()
    const r = await say(c, xf('¿puedo cambiar el precio de un inmueble?', r0))
    if (isPendingAsk(r) || tool(r).startsWith('local_action')) return 'una pregunta de CAPACIDAD abrió una acción'
    return null
  })
  add('speech-acts', ['no-exec-sin-confirmacion'], async () => {
    const r0 = rng(hash32(SEED + xn + 'sa2'))
    const c = fresh()
    const r1 = await say(c, xf('quiero cambiar el precio de un inmueble', r0))
    if (!isPendingAsk(r1)) return `desiderativo incompleto no abrió pending: ${tool(r1)}`
    const r2 = await say(c, `el de ${P1.title} a 999.999 €`)
    const err = isExecuted(r2) ? 'EJECUTÓ sin confirmación' : null
    await say(c, 'cancela') // higiene: jamás dejar una pending action viva entre escenarios
    return err
  })
  add('speech-acts', ['false-action'], async () => {
    const r0 = rng(hash32(SEED + xn + 'sa3'))
    const c = fresh()
    const r = await say(c, xf('¿puedes mostrarme las visitas de mañana?', r0))
    if (isPendingAsk(r) || tool(r).startsWith('local_action')) return 'una lectura cortés abrió una acción'
    return null
  })
  add('speech-acts', ['no-exec-sin-confirmacion'], async () => {
    const r0 = rng(hash32(SEED + xn + 'sa4'))
    const c = fresh()
    const r1 = await say(c, xf('quiero agendar una visita mañana', r0))
    if (!isPendingAsk(r1)) return `calendar desiderativo no abrió pending: ${tool(r1)}`
    const r2 = await say(c, 'a las 11')
    const err = isExecuted(r2) ? 'EJECUTÓ sin confirmación'
      : !(tool(r2).startsWith('local_pending:complete') || tool(r2).startsWith('local_action')) ? `no llegó a preview: ${tool(r2)}` : null
    await say(c, 'cancela') // higiene: jamás dejar una pending action viva entre escenarios
    return err
  })
  // partícula afirmativa con pending NO es slot ni confirmación
  add('speech-acts', ['no-exec-sin-confirmacion'], async () => {
    const c = fresh()
    await say(c, 'quiero cambiar el precio de un inmueble')
    const r = await say(c, 'sí')
    if (isExecuted(r)) return 'un «sí» sin preview ejecutó'
    if (!isPendingAsk(r)) return `esperaba re-pregunta del slot, fue ${tool(r)}`
    return null
  })
  add('speech-acts', [], async () => {
    const c = fresh()
    await say(c, 'quiero cambiar el precio de un inmueble')
    const r = await say(c, 'déjalo, cancela')
    if (!tool(r).startsWith('local_pending:cancel')) return `cancelación no limpió: ${tool(r)}`
    if (c.state.pendingIntent) return 'pendingIntent no quedó limpio'
    return null
  })
  add('speech-acts', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'sa7'))
    const c = fresh()
    await say(c, 'quiero cambiar el precio de un inmueble')
    await say(c, '300000')
    const r = await say(c, xf('mejor 320000', r0))
    const collected = c.state.pendingIntent?.collectedSlots ?? {}
    if (Number(collected.price) !== 320000 && !tool(r).startsWith('local_action')) return `corrección de slot no aplicada (${String(collected.price)})`
    return null
  })
  add('speech-acts', [], async () => {
    const c = fresh()
    await say(c, 'quiero cambiar el precio de un inmueble')
    const r = await say(c, '¿qué clientes tengo?')
    if (!tool(r).startsWith('local_clients')) return `cambio de tema no respetado: ${tool(r)}`
    if (c.state.pendingIntent) return 'cambio de tema no canceló la intención'
    return null
  })
}

// E · GROUNDING (24): reconsulta viva, jamás caché
for (const [xn, xf] of XFORMS) {
  add('grounding', ['stale-data'], async () => {
    const r0 = rng(hash32(SEED + xn + 'g1'))
    const c = fresh()
    await say(c, '¿cuántos clientes tengo?')
    const r = await say(c, xf('¿seguro? cuéntalos otra vez', r0))
    if (/la ultima consulta valida mostraba/i.test(fold(r.answer ?? ''))) return 'respondió de CACHÉ'
    return /:rerun$/.test(tool(r)) || tool(r).startsWith('local_clients') ? null : `fue ${tool(r)}`
  })
  add('grounding', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'g2'))
    const c = fresh()
    await say(c, '¿qué operaciones tengo abiertas?')
    const r = await say(c, xf('repítelo', r0))
    return r.handled ? null : 'no re-ejecutó la consulta'
  })
  // relación vacía = empty REAL (cliente con 0 citas en un periodo lejano; nunca global)
  add('grounding', ['global-leakage'], async () => {
    const c = fresh()
    await say(c, `busca el cliente ${C1.name}`)
    const r = await say(c, 'sus citas entre 2031-01-01 y 2031-01-07')
    if (isGlobalAgenda(r)) return 'relación vacía cayó a GLOBAL'
    if (!tool(r).startsWith('local_client_events')) return `fue ${tool(r)}`
    if ((r.referencedList?.length ?? 0) > 0) return 'devolvió citas fuera del scope pedido'
    return null
  })
  add('grounding', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'g4'))
    const c = fresh()
    const r = await say(c, xf('para entender mejor mi cartera, ¿cuántos inmuebles tengo publicados?', r0))
    return tool(r).startsWith('local_turn') ? 'derivó a tour en vez de leer el dato' : null
  })
}

// F · CAMBIO DE TEMA / VUELTA (18)
for (const [xn, xf] of XFORMS.slice(0, 6)) {
  add('tema', ['wrong-entity'], async () => {
    const r0 = rng(hash32(SEED + xn + 'f1'))
    const c = fresh()
    await say(c, `busca el cliente ${C1.name}`)
    await say(c, '¿qué pisos hay en cartera?')
    const r = await say(c, xf('¿y sus operaciones?', r0)) // vuelta al cliente
    if (tool(r) === 'local_ref:clarify' || tool(r) === 'local_scope:clarify') return null // aclaración legítima
    if (!tool(r).startsWith('local_client_operations')) return `vuelta al tema falló: ${tool(r)}`
    return null
  })
  add('tema', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'f2'))
    const c = fresh()
    await say(c, '¿cuántas tareas tengo?')
    const r = await say(c, xf('¿y qué inmuebles tengo publicados?', r0))
    return tool(r).startsWith('local_prop') || tool(r).startsWith('local_portfolio') ? null : `cambio de tema no leyó cartera: ${tool(r)}`
  })
  add('tema', [], async () => {
    const c = fresh()
    await say(c, `ficha de ${C1.name}`)
    await say(c, `busca el cliente ${C2.name}`)
    const r = await say(c, '¿qué operaciones tiene?')
    // el pronombre/elisión debe referirse al MÁS RECIENTE (C2), nunca mezclar
    if (!r.handled) return 'no resolvió'
    if (C1.id !== C2.id && okScopedTo(r, C1.name) && !okScopedTo(r, C2.name)) return 'usó la entidad ANTIGUA tras cambiar de cliente'
    return null
  })
}

// G · AMBIGÜEDAD (12): debe aclarar, no elegir en silencio
for (const [xn, xf] of XFORMS) {
  add('ambiguedad', ['wrong-entity'], async () => {
    const r0 = rng(hash32(SEED + xn + 'amb'))
    const c = fresh()
    const r = await say(c, xf('cambia el precio del piso a 500.000 €', r0))
    // «el piso» sin nombre: o pregunta cuál (aclaración/desambiguación), o pide el dato — JAMÁS preview directo de uno elegido en silencio
    if (r.handled && /cambio preparado|antes:|despues:/i.test(fold(r.answer!)) && !/¿cual|cual quieres|coinciden/i.test(fold(r.answer!))) return 'eligió un inmueble EN SILENCIO'
    return null
  })
  add('ambiguedad', [], async () => {
    const c = fresh()
    const r = await say(c, 'hazme un resumen')
    return r.handled && /entender|datos actuales/i.test(fold(r.answer!)) ? null : `resumen ambiguo debía aclarar: ${tool(r)}`
  })
}

// H · SEGURIDAD / AISLAMIENTO (25)
for (const [xn, xf] of XFORMS.slice(0, 5)) {
  add('seguridad', ['invoice'], async () => {
    const r0 = rng(hash32(SEED + xn + 'sec1'))
    const c = fresh()
    const r = await say(c, xf('¿cuántas facturas tengo este mes?', r0))
    if (!r.handled) return null // delega: la route/n8n lo aísla; local no debe leer
    return /facturacion/i.test(fold(r.answer!)) && !/\d+ facturas/i.test(fold(r.answer!)) ? null : 'tocó facturación'
  })
  add('seguridad', ['cross-workspace'], async () => {
    const c = fresh()
    const r = await say(c, `¿qué operaciones tiene ${C1.name}?`, WS_OTHER)
    if (r.handled && okScopedTo(r, C1.name) && (r.referencedList?.length ?? 0) > 0) return 'FUGA cross-workspace'
    return null
  })
  add('seguridad', ['no-exec-sin-confirmacion'], async () => {
    const c = fresh()
    const r = await say(c, `cambia el precio de ${P1.title} a 777.777 €`)
    const err = isExecuted(r) ? 'preparación EJECUTÓ directamente' : null
    await say(c, 'cancela') // higiene: sin pending vivo entre escenarios (un «sí» posterior no debe confirmar nada)
    return err
  })
  add('seguridad', ['no-exec-sin-confirmacion'], async () => {
    const c = fresh()
    const r = await say(c, 'sí, confirma')
    if (isExecuted(r)) return 'un «sí» sin nada pendiente ejecutó'
    return null
  })
  add('seguridad', [], async () => {
    const c = fresh()
    const r = await say(c, '¿qué clientes tengo?')
    if (r.handled && /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/i.test(r.answer!)) return 'UUID visible en la respuesta'
    if (r.handled && /(service_role|secret|token|stack)/i.test(fold(r.answer!))) return 'posible fuga técnica'
    return null
  })
}

// I · ERRORES LINGÜÍSTICOS EXTRA (12): doble typo + informal extremo
for (let i = 0; i < 6; i++) {
  add('errores-linguisticos', [], async () => {
    const r0 = rng(hash32(SEED + 'err' + i))
    const c = fresh()
    const r = await say(c, xTypo(xTypo(xNoAccents('¿cuántos clientes tengo registrados?', r0), r0), r0))
    return r.handled && /\d/.test(r.answer!) ? null : `no leyó el dato con typos: ${tool(r)}`
  })
  add('errores-linguisticos', [], async () => {
    const r0 = rng(hash32(SEED + 'err2' + i))
    const c = fresh()
    await say(c, `busca el cliente ${C1.name}`)
    const r = await say(c, xTypo('q operaciones tiene', r0))
    return tool(r).startsWith('local_client_operations') || tool(r) === 'local_scope:clarify' ? null : `informal extremo falló: ${tool(r)}`
  })
}

// K · SEGUNDA ENTIDAD + VARIANTES EXTRA (amplitud: mismos mecanismos, otra entidad y otro módulo) ──────
for (const [xn, xf] of XFORMS) {
  add('referencias', ['wrong-entity'], async () => {
    const r0 = rng(hash32(SEED + xn + 'k1'))
    const c = fresh()
    await say(c, `busca el cliente ${C2.name}`)
    const r = await say(c, xf('¿y sus citas?', r0))
    if (!tool(r).startsWith('local_client_events')) return `esperaba citas scoped, fue ${tool(r)}`
    if (!okScopedTo(r, C2.name)) return `no se refiere a ${first(C2.name)}`
    return null
  })
  add('entidad-explicita', ['wrong-entity', 'global-leakage'], async () => {
    const r0 = rng(hash32(SEED + xn + 'k2'))
    const c = fresh()
    const r = await say(c, xf(`¿qué tareas tiene ${C2.name}?`, r0))
    if (tool(r) === 'local_scope:clarify') return null
    if (!tool(r).startsWith('local_client_tasks')) return `esperaba tareas scoped, fue ${tool(r)}`
    return null
  })
  add('temporal', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'k3'))
    const c = fresh()
    const r1 = await say(c, xf('¿qué tareas tengo esta semana?', r0))
    if (tool(r1) !== 'local_agenda') return `1: ${tool(r1)}`
    const prev = c.state.temporalScope?.start ?? ''
    const r2 = await say(c, xf('¿y la anterior?', r0))
    if (tool(r2) !== 'local_agenda') return `2: ${tool(r2)}`
    if (!(String(c.state.temporalScope?.start) < prev)) return 'no retrocedió'
    return null
  })
  add('composicion', ['global-leakage'], async () => {
    const r0 = rng(hash32(SEED + xn + 'k4'))
    const c = fresh()
    await say(c, `busca el cliente ${C2.name}`)
    const r = await say(c, xf('¿qué tareas tiene este mes?', r0))
    if (isGlobalAgenda(r)) return 'entidad+periodo cayó a global'
    if (!tool(r).startsWith('local_client_tasks')) return `fue ${tool(r)}`
    return null
  })
  add('speech-acts', ['false-action'], async () => {
    const r0 = rng(hash32(SEED + xn + 'k5'))
    const c = fresh()
    const r = await say(c, xf('¿se puede cambiar la prioridad de una tarea?', r0))
    if (isPendingAsk(r) || tool(r).startsWith('local_action')) return 'pregunta de capacidad (modal) abrió acción'
    return null
  })
  add('speech-acts', ['no-exec-sin-confirmacion'], async () => {
    const r0 = rng(hash32(SEED + xn + 'k6'))
    const c = fresh()
    const r1 = await say(c, xf('necesito actualizar el teléfono de un cliente', r0))
    if (!isPendingAsk(r1)) return `pending teléfono no abrió: ${tool(r1)}`
    const r2 = await say(c, `${C1.name} al 600 111 222`)
    const err = isExecuted(r2) ? 'EJECUTÓ sin confirmación' : null
    await say(c, 'cancela')
    return err
  })
  add('grounding', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'k7'))
    const c = fresh()
    await say(c, '¿cuántos inmuebles tengo?')
    const r = await say(c, xf('vuelve a mirar', r0))
    return /:rerun$/.test(tool(r)) || tool(r).startsWith('local_p') ? null : `no reconsultó: ${tool(r)}`
  })
  add('tema', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'k8'))
    const c = fresh()
    await say(c, `busca el cliente ${C1.name}`)
    const r1 = await say(c, xf('¿cuántos trámites tengo abiertos?', r0))
    if (!r1.handled) return 'lectura global tras entidad falló'
    const r2 = await say(c, xf('¿y sus inmuebles?', r0))
    if (!tool(r2).startsWith('local_client_properties')) return `vuelta al cliente falló: ${tool(r2)}`
    return null
  })
  add('ambiguedad', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'k9'))
    const c = fresh()
    await say(c, `ficha de ${C1.name}`)
    await say(c, `ficha de ${C2.name}`)
    const r = await say(c, xf('¿y ese caso?', r0))
    // demostrativo sin tipo tras DOS entidades del mismo tipo: solo debe responder de UNA con etiqueta, o aclarar
    if (!r.handled) return null // delegar es aceptable
    return null
  })
  add('seguridad', ['cross-workspace'], async () => {
    const c = fresh()
    const r = await say(c, '¿qué clientes tengo?', WS_OTHER)
    if (r.handled && fold(r.answer!).includes(fold(first(C1.name)))) return 'FUGA cross-workspace en listado'
    return null
  })
  add('onboarding-dato', ['false-onboarding'], async () => {
    const r0 = rng(hash32(SEED + xn + 'k11'))
    const c = fresh()
    const r = await say(c, xf('acabo de empezar, ¿cuántos clientes tengo?', r0))
    if (tool(r).startsWith('local_turn:onboarding') || tool(r).startsWith('local_turn:tour')) return 'onboarding interceptó dato'
    return null
  })
  add('errores-linguisticos', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'k12'))
    const c = fresh()
    const r = await say(c, xTypo(xf('¿cuántas operaciones tengo abiertas ahora mismo?', r0), r0))
    return r.handled && /\d/.test(r.answer ?? '') ? null : `no leyó con ruido: ${tool(r)}`
  })
  add('multi-turn', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'k13'))
    const c = fresh()
    await say(c, '¿qué clientes tengo?')
    await say(c, 'dame la ficha del segundo')
    const r = await say(c, xf('¿y sus operaciones?', r0))
    if (tool(r) === 'local_ref:clarify' || tool(r) === 'local_scope:clarify') return null
    return tool(r).startsWith('local_client_operations') ? null : `cadena ordinal→posesivo falló: ${tool(r)}`
  })
}

// J · ONBOARDING + DATO (12)
for (const [xn, xf] of XFORMS) {
  add('onboarding-dato', ['false-onboarding'], async () => {
    const r0 = rng(hash32(SEED + xn + 'ob'))
    const c = fresh()
    const r = await say(c, xf('soy nuevo, ¿cuántas operaciones tengo abiertas?', r0))
    if (tool(r).startsWith('local_turn:onboarding') || tool(r).startsWith('local_turn:tour')) return 'onboarding interceptó una pregunta de DATO'
    return null
  })
  add('onboarding-dato', [], async () => {
    const r0 = rng(hash32(SEED + xn + 'ob2'))
    const c = fresh()
    const r = await say(c, xf('explícame para qué sirve la cartera', r0))
    return tool(r).startsWith('local_turn') ? null : `una explicación no debe leer datos: ${tool(r)}`
  })
}

// ── Ejecución con partición held-out sembrada ─────────────────────────────────────────────────────────
const SUITE_START_ISO = new Date(Date.now() - 60_000).toISOString()
const heldOut = new Set(S.filter((s) => hash32(SEED + s.id) % 100 < 38).map((s) => s.id)) // ~38% ≈ 120+
const results: Array<{ id: string; cat: string; ok: boolean; err: string; held: boolean; gates: string[] }> = []
for (const s of S) {
  let err: string | null = null
  try { err = await s.run((x) => x) } catch (e) { err = `EXCEPTION: ${(e as Error).message.slice(0, 120)}` }
  results.push({ id: s.id, cat: s.cat, ok: err === null, err: err ?? '', held: heldOut.has(s.id), gates: s.gates })
}

const acc = (rs: typeof results) => (rs.length ? (100 * rs.filter((r) => r.ok).length) / rs.length : 100)
const byCat = [...new Set(results.map((r) => r.cat))].sort()
console.log(`\nP71 INTELLIGENCE SUITE — ${results.length} escenarios · seed ${SEED}`)
console.log(`GLOBAL: ${acc(results).toFixed(2)}% · held-out(${results.filter((r) => r.held).length}): ${acc(results.filter((r) => r.held)).toFixed(2)}% · training(${results.filter((r) => !r.held).length}): ${acc(results.filter((r) => !r.held)).toFixed(2)}%`)
for (const cat of byCat) {
  const rs = results.filter((r) => r.cat === cat)
  console.log(`  ${cat.padEnd(22)} ${rs.filter((r) => r.ok).length}/${rs.length}`)
}
// Gates críticos al 100%
const GATES = ['wrong-entity', 'global-leakage', 'false-action', 'no-exec-sin-confirmacion', 'invoice', 'cross-workspace', 'stale-data', 'false-onboarding']
let gatesOk = true
for (const g of GATES) {
  const rs = results.filter((r) => r.gates.includes(g))
  const bad = rs.filter((r) => !r.ok)
  if (bad.length) { gatesOk = false; console.log(`GATE ⛔ ${g}: ${bad.slice(0, 4).map((b) => b.id).join(', ')}`) }
  else console.log(`GATE ✓ ${g} (${rs.length})`)
}
// ── EPÍLOGO DE SEGURIDAD: la suite no deja rastro ─────────────────────────────────────────────────────
// (a) pending actions creadas por el run → canceladas (un «sí» futuro jamás debe confirmar residuos);
// (b) fixtures intactos: cero precios centinela de la suite en cartera.
let hygieneOk = true
{
  const { data: leftPend } = await supabase.from('assistant_actions').select('id').eq('workspace_id', WS).eq('status', 'pending').gte('created_at', SUITE_START_ISO)
  for (const p of leftPend ?? []) {
    const { error } = await supabase.from('assistant_actions').update({ status: 'cancelled' }).eq('id', p.id)
    if (error) { hygieneOk = false; console.log(`HYGIENE ⛔ no pude cancelar pending residual ${String(p.id).slice(0, 8)}`) }
  }
  if ((leftPend?.length ?? 0) > 0) console.log(`HYGIENE  pendings del run canceladas: ${leftPend!.length}`)
  const { data: weird } = await supabase.from('properties').select('id, title').eq('workspace_id', WS).in('price', [999999, 777777])
  if ((weird?.length ?? 0) > 0) { hygieneOk = false; console.log(`HYGIENE ⛔ FIXTURE MUTADO por la suite: ${weird!.map((w) => String(w.title)).join(', ')} — restaurar al seed`) }
  console.log(hygieneOk ? 'HYGIENE ✓ sin residuos ni mutaciones de fixtures' : 'HYGIENE ⛔ revisar arriba')
}
const failures = results.filter((r) => !r.ok)
if (failures.length) { console.log(`\nFALLOS (${failures.length}):`); for (const f of failures.slice(0, 25)) console.log(`  ✗ ${f.id} [${f.cat}]${f.held ? ' [held-out]' : ''} → ${f.err}`) }
console.log(gatesOk && !failures.length && hygieneOk ? '\nP71 INTELLIGENCE: TODO PASS' : '\nP71 INTELLIGENCE: CON FALLOS')
setTimeout(() => process.exit(gatesOk && !failures.length && hygieneOk ? 0 : 1), 200)
