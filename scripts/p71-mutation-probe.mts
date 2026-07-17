// P71 — PROBE de invariantes para el mutation harness (patrón P70). Comprueba UN invariante CONVERSACIONAL
// en vivo y sale 0 si se cumple / 1 si está roto. Cada invariante es un mini-flujo real contra la BD QA.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p71-mutation-probe.mts <invariante>

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { emptyState, applyStateUpdate, upgradeConversationState } = await import('@/lib/agents/conversation-state')
import type { ConversationState } from '@/lib/agents/conversation-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const { data: cli } = await supabase.from('clients').select('id, name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(2)
const A = { id: String(cli?.[0]?.id), name: String(cli?.[0]?.name ?? 'cliente') }

let n = 0
type Ctx = { state: ConversationState; recentContext: string }
async function say(ctx: Ctx, message: string) {
  const r = await tryLocalAnswer(supabase as never, WS, message, { recentContext: ctx.recentContext, state: ctx.state, turnId: `mp-${++n}` })
  if (r.handled && r.stateUpdate) ctx.state = applyStateUpdate(ctx.state, r.stateUpdate)
  ctx.recentContext += ` \n usuario: ${message}` + (r.handled ? ` \n asistente: ${r.answer}` : '')
  return r
}
const fresh = (): Ctx => ({ state: emptyState(), recentContext: '' })
const tool = (r: { handled: boolean; usedTool?: string }) => (r.handled ? String(r.usedTool) : 'UNHANDLED')

const inv = process.argv[2]
let ok = false
switch (inv) {
  case 'state-emitted': { // local-first ESCRIBE estado (lastDataQuery tras una lista)
    const c = fresh()
    await say(c, '¿qué clientes tengo?')
    ok = !!c.state.lastDataQuery && c.state.lastDataQuery.resultRefs.length > 0
    break
  }
  case 'state-read-possessive': { // local-first LEE estado (posesivo scoped)
    const c = fresh()
    await say(c, `busca el cliente ${A.name}`)
    const r = await say(c, '¿y sus inmuebles?')
    ok = tool(r).startsWith('local_client_properties')
    break
  }
  case 'entity-plus-period-scoped': { // temporal NO pisa entityScope
    const c = fresh()
    await say(c, `busca el cliente ${A.name}`)
    const r = await say(c, '¿y sus citas esta semana?')
    ok = tool(r).startsWith('local_client_events')
    break
  }
  case 'reader-respects-entity': { // el reader scoped aplica client_id (cada fila es del cliente)
    // Rango AMPLIO (cubre eventos pasados del seed): sano → solo filas del cliente (o vacío);
    // mutado (sin eq client_id) → aparecen citas de OTROS clientes → rojo.
    const c = fresh()
    await say(c, `busca el cliente ${A.name}`)
    const r = await say(c, 'sus citas entre 2020-01-01 y 2030-12-31')
    if (!r.handled) break
    const rows = (r.referencedList ?? []) as Array<Record<string, unknown>>
    ok = tool(r).startsWith('local_client_events')
      && rows.every((x) => !x.client_name || fold(String(x.client_name)).includes(fold(A.name.split(' ')[0])))
    break
  }
  case 'scoped-empty-not-global': { // relación vacía NO cae a global
    const c = fresh()
    await say(c, `busca el cliente ${A.name}`)
    const r = await say(c, 'sus citas entre 2031-01-01 y 2031-01-07')
    ok = tool(r).startsWith('local_client_events') && (r.handled ? (r.referencedList?.length ?? 0) === 0 : false)
    break
  }
  case 'confirm-requeries': { // «¿seguro?» reconsulta (jamás el conteo cacheado de lastResults)
    // Estado VACÍO + lastResults simulando el hilo del navegador: fuerza la ruta ctxDecision (P48),
    // donde vivía el atajo de caché. Sano → lectura fresca; mutado → «la última consulta mostraba N…».
    const r = await tryLocalAnswer(supabase as never, WS, '¿seguro? cuéntalos otra vez', {
      recentContext: 'usuario: ¿cuántos clientes tengo? \n asistente: Tienes 9 clientes registrados.',
      lastResults: Array.from({ length: 9 }, () => ({})), state: emptyState(), turnId: 'mp-cq',
    })
    const ans = fold(r.handled ? r.answer : '')
    ok = r.handled && !/ultima consulta valida mostraba|mostraba 9/i.test(ans) && /\d/.test(ans)
    break
  }
  case 'capacity-question-no-action': { // pregunta de capacidad NO abre acción
    const c = fresh()
    const r = await say(c, '¿puedo cambiar el precio de un inmueble?')
    ok = !tool(r).startsWith('local_pending') && !tool(r).startsWith('local_action')
    break
  }
  case 'action-not-hijacked-by-temporal': { // una acción con fecha NO es lectura temporal
    const c = fresh()
    const r = await say(c, 'quiero agendar una visita mañana')
    ok = tool(r).startsWith('local_pending:ask')
    break
  }
  case 'ambiguous-asks': { // entidad ambigua → pregunta, jamás elegir en silencio
    const c = fresh()
    const r = await say(c, 'cambia el precio de Piso a 500.000 €')
    ok = r.handled && /coinciden|cual/i.test(fold(r.answer ?? '')) && !/cambio preparado/i.test(fold(r.answer ?? ''))
    await say(c, 'cancela') // higiene: si una mutación llegó a preparar, se cancela SIEMPRE
    break
  }
  case 'v1-upgrades': { // un estado v1 válido se ADAPTA (no se descarta)
    const v1 = { version: 1, activeModule: 'clients', activeEntities: [{ entityType: 'client', entityId: A.id, displayLabel: A.name, confidence: 0.8, sourceTurnId: 't' }], previousEntities: [], referents: [], pendingIntent: null, temporalScope: null, lastDataQuery: null, lastAssistantResult: null }
    const r = upgradeConversationState(v1)
    ok = r.outcome === 'upgraded' && r.state?.activeEntities[0]?.entityId === A.id
    break
  }
  default:
    console.error(`invariante desconocido: ${inv}`)
}
setTimeout(() => process.exit(ok ? 0 : 1), 200)
