// Evals de CONTRATO RAÍZ (P60) — separan resumen conceptual vs operativo y blindan el learning context.
// Regla de oro: ninguna keyword suelta («resumen», «dashboard», «vendido», «tareas») lee datos a ciegas;
// el acto comunicativo (entender vs consultar) manda. En ambigüedad NO se lee: se pregunta.

import { decideTurn } from '@/lib/agents/assistant-turn'
import { allowedToolsForTurn } from '@/lib/agents/assistant-tool-permissions'
import { classifySummaryIntent, isLearningContext, wantsFullTour } from '@/lib/summary-intent'
import { generateFullCrmTour, ALL_MODULE_IDS } from '@/lib/agents/crm-module-catalog'
import { isSafeAnswer } from '@/lib/agents/assistant-errors'

export function runRootContractEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const reads = (q: string) => decideTurn(q).shouldReadData

  // A) Resumen CONCEPTUAL / learning → NUNCA lee, sin tools.
  for (const q of [
    'Hazme un resumen de todo el CRM para entenderlo empezando desde el Dashboard',
    'hazme un resumen para entender el CRM', 'resumen de cómo funciona el CRM',
    'no sé cómo va esto', 'me han dado la cuenta para probar', 'estamos valorando comprar el CRM',
    'explícame el producto', 'quiero entender cómo va',
  ]) {
    const d = decideTurn(q)
    ok(!d.shouldReadData, `conceptual/learning NO lee: "${q}" (${d.turnType})`)
    ok(allowedToolsForTurn(d).length === 0, `conceptual/learning sin tools: "${q}"`)
  }

  // B) Resumen OPERATIVO (mis datos / hoy) → SÍ lee.
  for (const q of ['hazme un resumen del día con mis datos', 'resumen del día', 'qué tengo pendiente hoy', 'resumen de mis operaciones de hoy']) {
    ok(reads(q), `operativo lee: "${q}"`)
  }

  // C) Resumen AMBIGUO → aclara, no lee.
  const amb = decideTurn('hazme un resumen')
  ok(!amb.shouldReadData && amb.reason === 'p60:ambiguous-summary', 'resumen ambiguo → aclara, no lee')

  // D) classifySummaryIntent puro.
  ok(classifySummaryIntent('resumen para entender el CRM') === 'conceptual', 'clasifica conceptual')
  ok(classifySummaryIntent('resumen del día con mis datos') === 'operational', 'clasifica operativo')
  ok(classifySummaryIntent('hazme un resumen') === 'ambiguous', 'clasifica ambiguo')
  ok(classifySummaryIntent('muéstrame los clientes') === null, 'no-resumen → null')
  ok(isLearningContext('soy nuevo usuario') && isLearningContext('estamos valorando'), 'learning detectado')
  ok(!isLearningContext('muéstrame mis tareas'), 'data no es learning')

  // E) Product tour: full tour cubre todos los módulos, seguro, sin datos ni «no hay …».
  ok(wantsFullTour('resumen de todo el CRM'), 'wantsFullTour')
  const tour = generateFullCrmTour('dashboard')
  ok(isSafeAnswer(tour), 'tour seguro')
  ok(/empezando por Dashboard/i.test(tour), 'tour arranca en dashboard')
  ok(!/no hay (tareas|operaciones|inmuebles|citas)/i.test(tour), 'tour no dice «no hay …»')
  for (const id of ALL_MODULE_IDS) ok(tour.includes({ dashboard: 'Dashboard', clients: 'Clientes', portfolio: 'Cartera', operations: 'Operaciones', commissions: 'Comisiones', invoicing: 'Facturación', calendar: 'Calendario', tasks: 'Tareas', cases: 'Trámites', documents: 'Documentos', settings: 'Configuración', assistant: 'Asistente' }[id]), `tour menciona ${id}`)

  // F) Prioridades: corrección/meta ganan sobre resumen; onboarding gana sobre data.
  ok(decideTurn('no me refiero a ese resumen').turnType === 'user_correction', 'corrección > resumen')
  ok(!decideTurn('soy nuevo, hazme un resumen del día').shouldReadData, 'learning gana a «del día»')

  // G) No regresión de clases previas (P53/P56/P58).
  ok(!reads('¿qué muestra el dashboard?'), 'P53 dashboard explica')
  ok(reads('muéstrame los clientes') && reads('cuántos he vendido') && reads('¿tengo algún inmueble publicado?'), 'P56/P58 leen')
  ok(!reads('no listes datos'), 'meta no lee')

  return fail
}
