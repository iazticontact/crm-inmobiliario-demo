// FASE 41 — HUMAN-LIKE CONVERSATION HARNESS (subset acotado; escalar a 120+ cuando se decida el coste).
// Un SIMULADOR de usuario LLM (persona + misión ABSTRACTA, sin conocer capabilities/implementación/frases
// esperadas) conversa con el pipeline real (plan → validate → execute → synthesize, QA real, dry-run).
// JUEZ doble: (a) métricas ESTRUCTURALES deterministas (rejected, errores, replans, clarificaciones);
// (b) juez LLM SEPARADO que puntúa coherencia/grounding/continuidad viendo SOLO transcript + evidencia
// resumida (status/counts por turno), nunca las interioridades del planner.
//   npx tsx --tsconfig tsconfig.json scripts/planner-humanlike.mts [maxTurnos=7]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
const WS = 'd0000000-0000-4000-8000-000000000001'
const APIKEY = envLocal('OPENAI_API_KEY')!
const MODEL = envLocal('PLANNER_MODEL') || 'gpt-4.1-mini'
const JUDGE_MODEL = envLocal('JUDGE_MODEL') || MODEL
const MAX_TURNS = Number(process.argv[2] ?? 7)
const { runTurn } = await import('@/lib/agents/planner/planner-pipeline')
const { emptyDiscourse } = await import('@/lib/agents/planner/discourse-state')
import type { RichDiscourse } from '@/lib/agents/planner/discourse-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// Personas + misiones ABSTRACTAS (módulos/objetivos, no frases de incidente ni ids internos).
const PERSONAS = [
  { id: 'novato', style: 'Eres un empleado NUEVO de una inmobiliaria; no conoces el CRM. Escribes educado, frases completas, a veces inseguro.', mission: 'Quieres entender qué puede hacer el asistente por ti, después ver tus clientes y abrir la ficha de uno que te llame la atención.' },
  { id: 'seco', style: 'Eres un agente MUY experimentado y seco: mensajes telegráficos de 2 a 6 palabras, sin cortesía.', mission: 'Quieres el estado de la cartera de inmuebles, cuántas operaciones abiertas hay y cuánto llevas en comisiones este mes.' },
  { id: 'erratas', style: 'Escribes rápido, CON faltas de ortografía y sin tildes, a veces sin signos de puntuación.', mission: 'Quieres ver tus citas de esta semana y tus tareas pendientes; luego, de algún cliente que aparezca por ahí, sus operaciones.' },
  { id: 'indeciso', style: 'Eres indeciso: empiezas a pedir algo, te corriges a mitad, cambias de tema y luego vuelves a un tema anterior.', mission: 'Empiezas preguntando por clientes, te desvías a preguntar por la cartera, y al final vuelves a un cliente concreto para ver su detalle.' },
  { id: 'manager', style: 'Eres el gerente de la agencia: pides números y resúmenes ejecutivos, comparas periodos, sin rodeos.', mission: 'Quieres una foto del negocio: valor de operaciones ganadas, comisiones del mes, estado de la cartera, y al final qué requiere atención.' },
  { id: 'frustrado', style: 'Estás algo frustrado porque tienes prisa; usas frases cortantes y expresas impaciencia si algo no sale a la primera.', mission: 'Necesitas YA las citas de hoy, las tareas urgentes y el teléfono de algún cliente que te aparezca por ahí.' },
  { id: 'multitarea', style: 'Mezclas varias peticiones en un mismo mensaje porque estás con mil cosas a la vez.', mission: 'En pocas interacciones quieres: cuántos clientes activos hay Y qué citas hay esta semana Y que te expliquen para qué sirve el módulo de trámites.' },
  { id: 'spanglish', style: 'Trabajas en una agencia internacional: mezclas términos en inglés y español (lead, pipeline, appointment) con naturalidad.', mission: 'Quieres revisar tus leads, el pipeline de deals abiertos y las appointments de la semana.' },
] as const

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
async function llm(model: string, system: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>, json = false): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${APIKEY}` },
    body: JSON.stringify({ model, temperature: 0.7, messages: [{ role: 'system', content: system }, ...messages], ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`llm_http_${res.status}`)
  const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  return j.choices?.[0]?.message?.content ?? ''
}

type TurnLog = { user: string; answer: string; speechAct: string; caps: string[]; statuses: string[]; rejected: number; planAttempts: number; clarification: boolean }

async function simulate(p: (typeof PERSONAS)[number]): Promise<{ turns: TurnLog[]; structural: Record<string, number> }> {
  const simSystem = `${p.style}\nMISIÓN (no la reveles literalmente, persíguela de forma natural): ${p.mission}\nHablas con el asistente del CRM inmobiliario que usa tu empresa. NO sabes cómo está implementado. Escribe SOLO tu siguiente mensaje (una línea). Si ya cumpliste la misión, responde exactamente [FIN].`
  const turns: TurnLog[] = []
  let d = emptyDiscourse() as RichDiscourse
  const chat: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (let t = 0; t < MAX_TURNS; t++) {
    // El simulador ve el diálogo desde SU lado: sus mensajes = assistant del sim-chat invertido.
    let userMsg = (await llm(MODEL, simSystem, chat.map((m) => ({ role: m.role === 'user' ? 'assistant' as const : 'user' as const, content: m.content })))).trim()
    const done = userMsg.includes('[FIN]')
    userMsg = userMsg.replace('[FIN]', '').trim()
    if (!userMsg) break
    const r = await runTurn({ supabase: supabase as never, workspaceId: WS, message: userMsg, discourse: d, apiKey: APIKEY, plannerModel: MODEL, synth: true, selectionSeed: 11 })
    d = r.discourse
    const o = r.observability as Record<string, unknown>
    turns.push({
      user: userMsg, answer: r.answer,
      speechAct: String(o.speechAct ?? ''), caps: (o.capabilities as string[]) ?? [],
      statuses: (o.statuses as string[]) ?? [], rejected: ((o.rejected as unknown[]) ?? []).length,
      planAttempts: Number(o.planAttempts ?? 1), clarification: r.trace.plan.needsClarification,
    })
    chat.push({ role: 'user', content: userMsg }, { role: 'assistant', content: r.answer })
    if (done) break
  }
  const structural = {
    turns: turns.length,
    rejectedGoals: turns.reduce((a, t) => a + t.rejected, 0),
    internalErrors: turns.filter((t) => t.statuses.includes('INTERNAL_ERROR')).length,
    replans: turns.filter((t) => t.planAttempts > 1).length,
    clarifications: turns.filter((t) => t.clarification).length,
    emptyAnswers: turns.filter((t) => !t.answer.trim()).length,
  }
  return { turns, structural }
}

async function judge(p: (typeof PERSONAS)[number], turns: TurnLog[]): Promise<{ coherencia: number; grounding: number; continuidad: number; notas: string }> {
  const transcript = turns.map((t, i) => `T${i + 1} USUARIO: ${t.user}\nT${i + 1} ASISTENTE: ${t.answer}\nT${i + 1} EVIDENCIA(no visible al usuario): statuses=${t.statuses.join(',') || '-'} caps=${t.caps.join(',') || '-'}`).join('\n\n')
  const sys = `Eres un JUEZ independiente de calidad conversacional de un asistente CRM. Puntúa la CONVERSACIÓN COMPLETA (no cada turno aislado) del 1 al 5 en: "coherencia" (hilo, foco, no-contradicción entre turnos), "grounding" (lo afirmado es compatible con la EVIDENCIA adjunta: p. ej. no afirma datos si status=EMPTY/NOT_FOUND, no dice "no puedo" si hubo SUCCESS), "continuidad" (referencias como pronombres/"ese cliente" se mantienen bien). Devuelve SOLO JSON: {"coherencia":n,"grounding":n,"continuidad":n,"notas":"<una frase con el peor defecto o 'sin defectos'>"}`
  const raw = await llm(JUDGE_MODEL, sys, [{ role: 'user', content: `Persona del usuario simulado: ${p.style}\n\n${transcript}` }], true)
  try { const j = JSON.parse(raw); return { coherencia: Number(j.coherencia ?? 0), grounding: Number(j.grounding ?? 0), continuidad: Number(j.continuidad ?? 0), notas: String(j.notas ?? '') } }
  catch { return { coherencia: 0, grounding: 0, continuidad: 0, notas: 'juez ilegible' } }
}

console.log(`\nHUMAN-LIKE HARNESS (subset acotado) · planner=${MODEL} · juez=${JUDGE_MODEL} · máx ${MAX_TURNS} turnos\n`)
const results: Array<{ id: string; structural: Record<string, number>; scores: { coherencia: number; grounding: number; continuidad: number; notas: string } }> = []
for (const p of PERSONAS) {
  console.log(`── persona: ${p.id} ──`)
  const { turns, structural } = await simulate(p)
  for (const [i, t] of turns.entries()) console.log(`  T${i + 1} «${t.user.slice(0, 60)}» → act=${t.speechAct} caps=${t.caps.join(',') || '∅'} st=${t.statuses.join(',') || '-'}${t.planAttempts > 1 ? ' (replan)' : ''}`)
  const scores = await judge(p, turns)
  console.log(`  estructural: ${JSON.stringify(structural)}`)
  console.log(`  juez: coherencia=${scores.coherencia} grounding=${scores.grounding} continuidad=${scores.continuidad} · ${scores.notas}\n`)
  results.push({ id: p.id, structural, scores })
}

const avg = (k: 'coherencia' | 'grounding' | 'continuidad') => (results.reduce((a, r) => a + r.scores[k], 0) / results.length).toFixed(1)
const totErr = results.reduce((a, r) => a + r.structural.internalErrors + r.structural.emptyAnswers, 0)
console.log(`RESUMEN · ${results.length} conversaciones · coherencia=${avg('coherencia')}/5 grounding=${avg('grounding')}/5 continuidad=${avg('continuidad')}/5 · errores duros=${totErr}`)
console.log(`(subset acotado — NO es el gate de 120+; registrar N real en docs)`)
setTimeout(() => process.exit(0), 400)
