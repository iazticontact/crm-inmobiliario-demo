// Evals del motor de OFERTAS/ACEPTACIÓN y alcance global (P62). Clases del incidente real: oferta →
// aceptación («sí/venga/muéstramela»), referencia por número/género, alcance global > módulo previo,
// «mirar» como lectura, saludo coloquial bilingüe, y prefijo de hablante sin contaminar el contexto.

import { decideTurn } from '@/lib/agents/assistant-turn'
import { detectOfferRequest, detectAcceptance, resolveOfferedModules, suggestionsAnswer } from '@/lib/agents/local-answers'
import { isSafeAnswer } from '@/lib/agents/assistant-errors'

export function runOfferEngineEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // A) Petición de sugerencia → oferta local concreta (sin leer, sin n8n).
  for (const q of ['que hacemos ofreceme algo', 'sugiereme algo', '¿qué me recomiendas?', 'dame opciones']) {
    ok(detectOfferRequest(q), `offer request: "${q}"`)
  }
  ok(!detectOfferRequest('muéstrame los clientes'), 'lectura no es offer request')
  ok(isSafeAnswer(suggestionsAnswer()) && /cartera/i.test(suggestionsAnswer()), 'sugerencias seguras y concretas')

  // B) Aceptación breve; «sí explícame» NO es aceptación de datos.
  for (const q of ['sí', 'vale', 'venga va', 'dale', 'muestramela', 'a ver', 'hazlo']) {
    ok(detectAcceptance(q) !== null, `aceptación: "${q}"`)
  }
  ok(detectAcceptance('sí explícame') === null, '«sí explícame» no es aceptación de datos')
  ok(detectAcceptance('no, mejor otra cosa') === null, 'rechazo no es aceptación')
  ok(detectAcceptance('quiero que me digas cuántos clientes tengo registrados ahora mismo') === null, 'mensaje largo no es aceptación')

  // C) Resolución de la oferta desde el hilo (con prefijos de hablante, como la route real).
  const multi = ['asistente: Te propongo tres cosas que puedo mirarte ahora mismo:', '• La cartera activa (tus inmuebles y su estado).', '• Las operaciones abiertas (tu pipeline).', '• Las citas próximas del calendario.', '¿Cuál te muestro?'].join('\n')
  const mods = resolveOfferedModules(multi)
  ok(mods.includes('portfolio') && mods.includes('operations') && mods.includes('calendar'), `oferta múltiple resuelve 3 módulos (${mods.join(',')})`)
  const single = ['asistente: **Calendario** — Reúne tus citas y visitas.', '• Dónde: Menú lateral → Calendario.', '• Puedes: Crear/editar citas, vincularlas a clientes/inmuebles.', '¿Quieres que te muestre tus datos actuales?'].join('\n')
  ok(JSON.stringify(resolveOfferedModules(single)) === JSON.stringify(['calendar']), 'cabecera de módulo manda en exclusiva (no absorbe inmuebles/clientes)')
  ok(resolveOfferedModules('usuario: hola\nasistente: ¡Hola! ¿Qué necesitas?').length === 0, 'sin oferta → sin módulos')

  // D) Alcance global gana al módulo del contexto.
  const glob = decideTurn('Si explicame todo el crm resumido', { priorModule: 'calendar' })
  ok(glob.turnType === 'onboarding' && !glob.shouldReadData, '«todo el CRM» → tour global, no Calendario')
  ok(decideTurn('en general, ¿cómo funciona esto?', { priorModule: 'calendar' }).turnType === 'onboarding', '«en general» → global')

  // E) «mirar» es lectura; saludo coloquial bilingüe.
  ok(decideTurn('en el calendario me puedes mirar?').shouldReadData, '«me puedes mirar» lee')
  ok(decideTurn('Hello que tal').turnType === 'social', '«Hello que tal» → social')

  // F) No regresión: correcciones/meta no se tragan como aceptación (detectAcceptance exige inicio claro).
  ok(detectAcceptance('no me refiero a eso') === null, 'corrección no es aceptación')

  return fail
}
