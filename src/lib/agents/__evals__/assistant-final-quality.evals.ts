// Evals de PERFECCIÓN FINAL (P54) — propiedades de calidad de producto sobre el comportamiento visible.
// No reconstruye nada: protege que las respuestas sean humanas, breves, sin datos cuando no toca y sin
// señales prohibidas, y que las reglas de decisión de P53 no se degraden con variantes coloquiales.

import { decideTurn } from '@/lib/agents/assistant-turn'
import { allowedToolsForTurn } from '@/lib/agents/assistant-tool-permissions'
import { isSafeAnswer } from '@/lib/agents/assistant-errors'
import {
  ALL_MODULE_IDS, explainModule, onboardingAnswer, confusedAnswer, navigationAnswer,
} from '@/lib/agents/crm-module-catalog'
import {
  assistantMetaAnswer, userCorrectionAnswer, userComplaintAnswer, disagreementAnswer,
} from '@/lib/agents/assistant-turn'
import { greetingAnswer, smalltalkAnswer, capabilityAnswer, futureAnswer, howItWorksAnswer } from '@/lib/agents/assistant-pragmatics'

export function runFinalQualityEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const reads = (q: string) => decideTurn(q).shouldReadData

  // ── A/B) Explicaciones y «qué muestra/resume» NO leen (muestreo amplio) ──
  const explainQs = [
    '¿qué muestra el dashboard?', '¿qué resume la cartera?', '¿para qué sirven las comisiones?',
    '¿qué es el apartado de documentos?', 'explícame el calendario', '¿cómo se usa la configuración?',
  ]
  for (const q of explainQs) ok(!reads(q), `explicación no lee: "${q}"`)

  // ── C) Demanda clara de datos SÍ lee ──
  const readQs = ['¿qué tengo ahora en tareas?', 'muéstrame los clientes', 'lista los trámites abiertos', '¿cuántos inmuebles hay disponibles?']
  for (const q of readQs) ok(reads(q), `lectura sí lee: "${q}"`)

  // ── D) «No entiendo» simplifica el MISMO tema, sin repetir listas ──
  const conf = decideTurn('no entiendo', { priorModule: 'dashboard' })
  ok(conf.turnType === 'user_confused' && conf.module === 'dashboard' && !conf.shouldReadData, 'no-entiendo mantiene módulo y no lee')
  ok(!confusedAnswer('dashboard').includes('•'), 'confusión no vuelca lista')
  ok(confusedAnswer('dashboard').includes('KPIs'), 'confusión conserva mayúsculas (fix «kPIs»)')

  // ── E) Corrección/queja sin tools ──
  for (const q of ['no me refiero a los pisos', 'esto está mal, no me ayudas']) {
    const d = decideTurn(q)
    ok(!d.shouldReadData && allowedToolsForTurn(d).length === 0, `corrección/queja sin tools: "${q}"`)
  }

  // ── F) Cambio de módulo sin arrastre ──
  ok(decideTurn('¿qué muestra el calendario?', { priorModule: 'portfolio' }).module === 'calendar', 'cambio de módulo gana al contexto')

  // ── G/H/I) Calidad de TODOS los generadores: longitud, ≤1 pregunta, seguros ──
  const generators: [string, string][] = [
    ['greeting', greetingAnswer()], ['smalltalk', smalltalkAnswer()],
    ['onboarding', onboardingAnswer()], ['confused', confusedAnswer('portfolio')], ['confused-null', confusedAnswer(null)],
    ['meta', assistantMetaAnswer('clients')], ['correction', userCorrectionAnswer('properties')],
    ['complaint', userComplaintAnswer()], ['disagreement', disagreementAnswer()],
    ['navigation', navigationAnswer('invoicing')], ['capability', capabilityAnswer('clients')],
    ['future', futureAnswer('clients')], ['how', howItWorksAnswer('properties')],
    ...ALL_MODULE_IDS.map((id): [string, string] => [`explain:${id}`, explainModule(id)]),
  ]
  for (const [name, g] of generators) {
    ok(isSafeAnswer(g), `seguro (${name})`)
    ok(g.length >= 40 && g.length <= 900, `longitud razonable (${name}): ${g.length}`)
    ok((g.match(/\?/g) ?? []).length <= 1, `máx 1 pregunta (${name}): ${(g.match(/\?/g) ?? []).length}`)
    ok(!/workspace|uuid|sql|null|undefined/i.test(g), `sin tecnicismos (${name})`)
  }
  // Regla 1: explicación de módulo = 3-6 bullets máx + un cierre.
  for (const id of ALL_MODULE_IDS) {
    const bullets = (explainModule(id).match(/^• /gm) ?? []).length
    ok(bullets >= 2 && bullets <= 6, `explainModule(${id}): 2-6 bullets (${bullets})`)
  }

  // ── J) Facturación redirige sin leer ──
  const inv = decideTurn('quiero ver mis facturas')
  ok(inv.action === 'redirect' && allowedToolsForTurn(inv).length === 0, 'facturación redirige sin tools')

  // ── K/L) Social sin tools · ambiguo pide aclaración ──
  for (const q of ['hola', 'buenos días', 'gracias', 'perfecto']) {
    const d = decideTurn(q)
    ok(!d.shouldReadData && allowedToolsForTurn(d).length === 0, `social sin tools: "${q}"`)
  }
  ok(decideTurn('mmm').shouldAskClarification, 'ambiguo pide aclaración')

  // ── M) Puntuación española protegida ──
  ok(decideTurn('¡Hola!').turnType === 'social', '¡Hola! → social')
  const fu = decideTurn('¿Y el de Malasaña?', { priorEntity: 'properties', hasLastResult: true })
  ok(fu.shouldReadData || fu.shouldUseLastResult, '¿Y el de…? mantiene el seguimiento')

  // ── N) Variantes coloquiales no rompen la clase ──
  ok(reads('oye, enséñame los pisos que tenemos'), 'coloquial lectura lee')
  ok(!reads('oye, ¿esto de la cartera para qué sirve?'), 'coloquial explicación no lee')
  ok(!reads('a ver, no entiendo nada de esto'), 'coloquial confusión no lee')

  return fail
}
