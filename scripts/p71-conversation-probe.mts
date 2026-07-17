// P71 — Sondeo multi-turno del motor conversacional LOCAL (tryLocalAnswer con recentContext acumulado,
// igual que la route). Objetivo: EVIDENCIA de dónde se rompen referencias/pronombres/intención pendiente/
// continuidad temporal/grounding. NO es un test de aprobación: imprime qué tool responde y el texto, para
// diagnosticar causas raíz GENERALES (no frases concretas). Entidades descubiertas en runtime, no
// hardcodeadas en producto. Uso: npx tsx --tsconfig tsconfig.json scripts/p71-conversation-probe.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { emptyState, applyStateUpdate } = await import('@/lib/agents/conversation-state')
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// Entidades reales (descubiertas dinámicamente).
const { data: cli } = await supabase.from('clients').select('name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(2)
const CLIENT = String(cli?.[0]?.name ?? 'cliente')
const { data: pr } = await supabase.from('properties').select('title').eq('workspace_id', WS).is('deleted_at', null).limit(2)
const PROP = String(pr?.[0]?.title ?? 'inmueble').replace(/^Piso - |^Atico[^-]*- |^Adosado - /, '')

// Conversaciones (cada una es una lista de turnos; el contexto se acumula como en la route).
const CONVERSATIONS: Array<{ name: string; turns: string[]; note: string }> = [
  { name: 'referencia-tras-busqueda', note: 'tras buscar un cliente, «¿qué operaciones tiene?» debería referirse a ESE cliente', turns: [`busca el cliente ${CLIENT}`, '¿qué operaciones tiene?'] },
  { name: 'pronombre-y-sus-inmuebles', note: '«y sus inmuebles?» debería resolver al cliente activo', turns: [`busca el cliente ${CLIENT}`, '¿y sus inmuebles?'] },
  { name: 'ordinal-el-primero', note: 'tras listar, «dame la ficha del primero» debería resolver por ordinal', turns: ['¿qué clientes tengo?', 'dame la ficha del primero'] },
  { name: 'intencion-pendiente-slots', note: 'cambiar precio sin inmueble → el turno siguiente aporta el slot que falta', turns: ['quiero cambiar el precio de un inmueble', `el de ${PROP} a 305.000 €`] },
  { name: 'continuidad-temporal', note: '«¿y la semana que viene?» debería mantener el módulo agenda con nuevo alcance temporal', turns: ['¿qué citas tengo esta semana?', '¿y la semana que viene?'] },
  { name: 'grounding-reconsulta', note: '«¿seguro?» tras un conteo: ¿reconsulta la fuente o responde del contexto?', turns: ['¿cuántos clientes tengo?', '¿seguro? cuéntalos otra vez'] },
  { name: 'onboarding-vs-dato', note: 'una pregunta de DATO con marco de aprendizaje NO debería derivar a tour', turns: ['para entender mejor mi cartera, ¿cuántos inmuebles tengo publicados?'] },
  { name: 'cambio-tema-pronombre', note: 'cambio de módulo con pronombre: «¿y de él?» tras hablar de un cliente', turns: [`ficha de ${CLIENT}`, '¿y sus tareas pendientes?'] },
  { name: 'operaciones-abiertas-directo', note: 'pregunta directa y clara de operaciones abiertas: ¿lee o pide aclaración?', turns: ['¿qué operaciones tengo abiertas?'] },
  { name: 'seguimiento-detalle', note: 'tras listar inmuebles, «enséñame el más caro» (superlativo referido a la lista)', turns: ['¿qué pisos hay en cartera?', 'enséñame el más caro'] },
]

const short = (s: string) => s.replace(/\n/g, ' ⏎ ').slice(0, 130)
let turnCounter = 0
for (const c of CONVERSATIONS) {
  console.log(`\n══ ${c.name} ══  (${c.note})`)
  let ctx = ''
  let state = emptyState()   // P71 — estado hilado entre turnos (como hará la route)
  for (const turn of c.turns) {
    const turnId = `probe-${++turnCounter}`
    const r = await tryLocalAnswer(supabase as never, WS, turn, { recentContext: ctx, state, turnId })
    const tool = r.handled ? r.usedTool : 'UNHANDLED→n8n'
    console.log(`  U: ${turn}`)
    console.log(`  A[${tool}]: ${r.handled ? short(r.answer) : '(delegado a n8n; el motor local no lo resuelve)'}`)
    if (r.handled && r.stateUpdate) state = applyStateUpdate(state, r.stateUpdate)
    ctx += ` \n usuario: ${turn}` + (r.handled ? ` \n asistente: ${r.answer}` : '')
  }
}
console.log('\n(Evidencia para docs/P71_CONVERSATIONAL_REGRESSION_ANALYSIS.md — no es un test de aprobación.)')
