// Evals del intérprete de INTENCIÓN DE ACCIÓN (P66) — frases naturales → acciones registradas, valores
// españoles (precios/teléfonos/fechas), confirmación estricta y cero falsos positivos en lecturas.

import { parseActionIntent, parsePriceEs, parsePhoneEs, parseDueDateEs } from '@/lib/agents/assistant-action-intent'

export function runActionIntentEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const p = parseActionIntent

  // A) Valores españoles.
  ok(parsePriceEs('a 280.000 €') === 280000, 'precio 280.000 €')
  ok(parsePriceEs('a 280000') === 280000, 'precio 280000')
  ok(parsePriceEs('a 280 mil') === 280000, 'precio 280 mil')
  ok(parsePhoneEs('al 600 555 555') === '600 555 555', 'teléfono con espacios')
  ok(parsePhoneEs('al 600555555') === '600 555 555', 'teléfono junto')
  ok(parsePhoneEs('al 12345') === null, 'teléfono inválido → null')
  ok(parseDueDateEs('mañana', '2026-07-12') === '2026-07-13', 'mañana')
  ok(parseDueDateEs('el viernes', '2026-07-12') === '2026-07-17', 'viernes próximo')

  // B) PREPARE por composición.
  const price = p('Cambia el precio de San Pedro 66 a 280.000 €')
  ok(price?.act === 'prepare' && price.actionType === 'portfolio.update_price' && price.proposedChanges.price === 280000 && /San Pedro 66/.test(String(price.entityText)), 'update_price completo')
  const phone = p('Cambia el teléfono de David Iglesias al 600 555 555')
  ok(phone?.act === 'prepare' && phone.actionType === 'clients.update_phone' && phone.proposedChanges.phone === '600 555 555' && phone.entityText === 'David Iglesias', 'update_phone completo')
  const phoneMissing = p('Actualiza el teléfono de David')
  ok(phoneMissing?.act === 'prepare' && phoneMissing.missingFields.includes('phone'), 'teléfono sin valor → missing')
  const task = p('Crea una tarea para llamar mañana a David')
  ok(task?.act === 'prepare' && task.actionType === 'tasks.create' && /llamar/.test(String(task.proposedChanges.title)) && typeof task.proposedChanges.due_date === 'string', 'tasks.create con fecha')
  const done = p('Marca como hecha la tarea de llamar a David')
  ok(done?.act === 'prepare' && done.actionType === 'tasks.complete' && /llamar a David/i.test(String(done.entityText)), 'tasks.complete con referencia')

  // C) Confirmación ESTRICTA («sí explícame» / «sí pero» NO confirman).
  ok(p('sí, confirma')?.act === 'confirm', 'sí, confirma')
  ok(p('confirma')?.act === 'confirm' && p('adelante')?.act === 'confirm' && p('hazlo')?.act === 'confirm', 'variantes confirmación')
  ok(p('sí')?.act === 'confirm', 'sí a secas (el wiring exige pending en BD)')
  ok(p('sí, explícame') === null || p('sí, explícame')?.act !== 'confirm', '«sí explícame» no confirma')
  ok(p('sí, pero primero dime el precio actual')?.act !== 'confirm', '«sí pero…» no confirma')
  // D) Cancel > todo; modify; status.
  ok(p('mejor no, cancela')?.act === 'cancel' && p('cancela el cambio')?.act === 'cancel' && p('déjalo')?.act === 'cancel', 'cancelación')
  const mod = p('mejor ponlo a 285.000')
  ok(mod?.act === 'modify' && (mod as { proposedChanges: Record<string, unknown> }).proposedChanges.price === 285000, 'modificación del preview')
  ok(p('¿qué cambio tengo pendiente?')?.act === 'status', 'status')

  // E) CERO falsos positivos en lecturas/explicaciones.
  for (const q of ['muéstrame los clientes', '¿qué muestra el dashboard?', 'lístame todo lo que tengo en inmuebles', '¿cuántos he vendido?', 'hola que tal', '¿tengo citas próximas?']) {
    ok(p(q) === null, `no acción: "${q}"`)
  }
  return fail
}
