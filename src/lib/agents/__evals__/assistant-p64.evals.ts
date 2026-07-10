// Evals P64 — verdad temporal, sanitizador de asteriscos y resumen ejecutivo (routing). Evidencia del
// incidente: cita pasada (24/06) mostrada como «próxima» y tarea completada como «vencida».

import { isUpcoming, isPast, isOverdueTask, isPendingTask, todayMadridIso } from '@/lib/assistant-temporal'
import { classifySummaryIntent } from '@/lib/summary-intent'
import { decideTurn } from '@/lib/agents/assistant-turn'
import { resolveModuleFromText } from '@/lib/agents/crm-module-catalog'
import { foldText } from '@/lib/real-estate-search'

export function runP64Evals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const T = '2026-07-10' // hoy fijo para tests deterministas

  // A) VERDAD TEMPORAL — una fecha pasada NUNCA es próxima; completada NUNCA pendiente/vencida.
  ok(!isUpcoming('2026-06-24', null, T), 'cita 24/06 NO es próxima (evidencia del incidente)')
  ok(isPast('2026-06-24', T), '24/06 es pasada')
  ok(isUpcoming('2026-07-10', null, T), 'hoy cuenta como próxima (límite inclusivo)')
  ok(isUpcoming('2026-07-11', null, T) && !isPast('2026-07-11', T), 'mañana próxima')
  ok(!isUpcoming('2026-07-11', 'cancelled', T), 'cancelada no es próxima')
  ok(!isOverdueTask('2026-06-01', 'completed', T), 'tarea COMPLETADA no es vencida')
  ok(isOverdueTask('2026-06-01', 'pending', T), 'pendiente con fecha pasada SÍ es vencida')
  ok(!isOverdueTask('2026-07-11', 'pending', T), 'pendiente futura no es vencida')
  ok(!isOverdueTask(null, 'pending', T), 'sin fecha no es vencida')
  ok(!isPendingTask('completed') && isPendingTask('pending'), 'pendiente solo status pending')
  ok(/^\d{4}-\d{2}-\d{2}$/.test(todayMadridIso()), 'todayMadrid formato ISO')
  // Fechas con hora (ISO datetime) se comparan por día, sin desplazamiento.
  ok(!isUpcoming('2026-06-24T10:00:00+00:00', null, T), 'datetime pasada no es próxima')

  // B) RESUMEN EJECUTIVO — routing: operativo global va a datos (no n8n, no clarify); módulo concreto no.
  ok(classifySummaryIntent('resumen del día con mis datos') === 'operational', 'operativo detectado')
  const execGate = (q: string) => {
    const k = classifySummaryIntent(q)
    const m = resolveModuleFromText(q)
    const explicit = /\b(resumen (ejecutivo|del negocio)|como va el negocio|ponme al dia con mis datos)\b/.test(foldText(q))
    return explicit || (k === 'operational' && (!m || m === 'dashboard'))
  }
  ok(execGate('hazme un resumen del día con mis datos'), 'resumen del día → ejecutivo')
  ok(execGate('resumen ejecutivo'), 'resumen ejecutivo → ejecutivo')
  ok(execGate('¿cómo va el negocio?'), 'cómo va el negocio → ejecutivo')
  ok(!execGate('resumen de mi cartera'), 'resumen de mi cartera → módulo (no ejecutivo)')
  ok(!execGate('resumen para entender el CRM'), 'conceptual no es ejecutivo')
  ok(decideTurn('hazme un resumen del día con mis datos').shouldReadData, 'operativo lee')

  // C) No-regresión de decisiones clave.
  ok(!decideTurn('hazme un resumen para entender el CRM').shouldReadData, 'conceptual no lee')
  ok(decideTurn('lístame todo lo que tengo en inmuebles').shouldReadData, 'P63 intacto')

  return fail
}
