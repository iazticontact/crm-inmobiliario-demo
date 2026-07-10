// Evals del motor conversacional (P61) — clases del incidente real: saludo coloquial, resumen de módulo
// con datos (posesivo), extracción de ficha/detalle, y no-regresión de las clases previas.

import { decideTurn } from '@/lib/agents/assistant-turn'
import { classifyPragmatics } from '@/lib/agents/assistant-pragmatics'
import { classifySummaryIntent } from '@/lib/summary-intent'
import { extractDetailName } from '@/lib/agents/local-answers'

export function runConversationEngineEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // A) Saludo coloquial → social (no data), pero «hola + comando» sí lee.
  ok(classifyPragmatics('Hola que hay').speechAct === 'greeting', '«hola que hay» → saludo')
  ok(classifyPragmatics('que tal').speechAct === 'greeting', '«que tal» → saludo')
  ok(decideTurn('Hola que hay').turnType === 'social', '«hola que hay» → social')
  ok(decideTurn('hola muéstrame los clientes').shouldReadData, '«hola + comando» sí lee')

  // B) Resumen de módulo con POSESIVO → datos (no clarify). Regresión P60 corregida.
  ok(classifySummaryIntent('hazme un resumen de mi cartera') === 'operational', '«resumen de mi cartera» → operativo')
  ok(classifySummaryIntent('resumen de mis clientes') === 'operational', '«resumen de mis clientes» → operativo')
  ok(decideTurn('hazme un resumen de mi cartera').shouldReadData, '«resumen de mi cartera» lee datos')
  ok(decideTurn('hazme un resumen de mi cartera').reason !== 'p60:ambiguous-summary', 'no pide aclaración genérica')
  // Conceptual sigue sin leer.
  ok(!decideTurn('hazme un resumen para entender el CRM').shouldReadData, 'conceptual no lee')
  // Ambiguo puro sigue aclarando.
  ok(classifySummaryIntent('hazme un resumen') === 'ambiguous', 'resumen a secas → ambiguo')

  // C) Extracción de ficha/detalle.
  ok(extractDetailName('Si, quiero que me imprimas toda la ficha de David Iglesias') === 'David Iglesias', 'extrae «David Iglesias»')
  ok(extractDetailName('ficha completa de David') === 'David', 'extrae «David»')
  ok(extractDetailName('dame la ficha de Ana María López') === 'Ana María López', 'extrae nombre compuesto')
  ok(extractDetailName('muéstrame los clientes') === null, 'lista de clientes NO es detalle')
  ok(extractDetailName('qué muestra la cartera') === null, 'explicación NO es detalle')

  // D) No-regresión de clases previas.
  ok(decideTurn('¿qué muestra el dashboard?').shouldReadData === false, 'P53 explica')
  ok(decideTurn('cuántos he vendido').shouldReadData, 'P58 ventas lee')
  ok(decideTurn('¿tengo algún inmueble publicado?').shouldReadData, 'P56 estado lee')
  ok(decideTurn('gracias').turnType === 'social', 'agradecimiento social')

  return fail
}
