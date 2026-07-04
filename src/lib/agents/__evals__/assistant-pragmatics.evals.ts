// Evals de PRAGMÁTICA conversacional (P49) — por PROPIEDADES, no por frases exactas.
// Propiedad central: mencionar una entidad NO dispara lectura; primero manda el acto comunicativo.

import {
  classifyPragmatics, capabilityAnswer, howItWorksAnswer, futureAnswer, greetingAnswer,
} from '@/lib/agents/assistant-pragmatics'
import { isSafeAnswer } from '@/lib/agents/assistant-errors'

export function runPragmaticsEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const act = (q: string) => classifyPragmatics(q).speechAct
  const reads = (q: string) => classifyPragmatics(q).shouldReadData

  // A) Preguntas de CAPACIDAD/permiso con entidad → NO leen datos.
  const capability = [
    '¿tienes acceso a los clientes?',
    '¿puedes acceder a los trámites?',
    '¿eres capaz de ver los inmuebles?',
    '¿sabes leer las citas?',
    '¿puedes crear un cliente?',
    '¿qué puedes hacer?',
    '¿cuáles son tus límites?',
  ]
  for (const q of capability) {
    ok(!reads(q), `capacidad NO debe leer: "${q}" (act=${act(q)})`)
    ok(classifyPragmatics(q).shouldExplainCapability, `capacidad debe explicar: "${q}"`)
  }

  // B) CÓMO FUNCIONA → explica, no lee.
  for (const q of ['¿cómo funciona la cartera?', '¿cómo funcionas?', '¿para qué sirve el módulo de comisiones?', '¿en qué consiste esto?']) {
    ok(act(q) === 'how_it_works_question' && !reads(q), `how-it-works no lee: "${q}" (act=${act(q)})`)
  }

  // C) FUTURO / hipotético → responde condicional, no lee.
  for (const q of ['si creo un cliente nuevo, ¿podrás verlo?', 'cuando añada un inmueble, ¿lo leerás?', '¿podrás actualizar los datos si guardo algo?']) {
    ok(act(q) === 'hypothetical_future_question' && !reads(q), `futuro no lee: "${q}" (act=${act(q)})`)
  }

  // D) LECTURAS reales (varias entidades) → SÍ leen.
  const readReqs = ['muéstrame los clientes', '¿qué inmuebles hay en cartera?', 'lista mis tareas', 'próximas citas', '¿cuántos clientes tengo?', 'busca el cliente Javier', '¿qué operaciones abiertas tengo?']
  for (const q of readReqs) ok(reads(q), `lectura debe leer: "${q}" (act=${act(q)})`)

  // E) Petición cortés de lectura ("¿puedes mostrarme…?") → SÍ lee (imperativo educado).
  for (const q of ['¿puedes mostrarme los clientes?', '¿podrías listarme los inmuebles?', '¿me puedes decir cuántas citas tengo?']) {
    ok(reads(q), `petición cortés lee: "${q}" (act=${act(q)})`)
  }

  // F) Facturación: capacidad/permiso → no lee, y la explicación redirige a Facturación.
  for (const q of ['¿puedes leer las facturas?', '¿tienes acceso a la facturación?']) {
    ok(!reads(q), `facturación capacidad no lee: "${q}"`)
  }
  ok(/Facturaci[oó]n/.test(capabilityAnswer('invoicing')) && isSafeAnswer(capabilityAnswer('invoicing')), 'capabilityAnswer(invoicing) redirige y es seguro')

  // G) Saludo / agradecimiento → no leen.
  ok(act('hola') === 'greeting' && !reads('hola'), 'saludo no lee')
  ok(act('gracias') === 'smalltalk' && !reads('gracias'), 'gracias no lee')
  // pero "hola, ¿qué clientes tengo?" SÍ es lectura (no lo traga el saludo).
  ok(reads('hola, ¿qué clientes tengo?'), 'saludo + consulta → lee')

  // H) Invariancia metamórfica: acentos/mayúsculas no cambian el acto.
  const pairs: [string, string][] = [
    ['¿Cómo FUNCIONA la Cartera?', 'como funciona la cartera'],
    ['¿Tienes Acceso a los Clientes?', 'tienes acceso a los clientes'],
    ['Muéstrame los PISOS', 'muestrame los pisos'],
  ]
  for (const [a, b] of pairs) ok(act(a) === act(b), `metamórfico: "${a}"(${act(a)}) ≠ "${b}"(${act(b)})`)

  // I) Generadores: seguros (sin datos técnicos) y con sentido.
  for (const s of [capabilityAnswer('clients'), howItWorksAnswer('properties'), futureAnswer('clients'), greetingAnswer(), capabilityAnswer('help')]) {
    ok(isSafeAnswer(s) && s.length > 10, `respuesta pragmática segura y no vacía: "${s.slice(0, 30)}…"`)
  }
  ok(/guardad/.test(futureAnswer('clients')), 'futuro explica condición de guardado')
  ok(!/•/.test(capabilityAnswer('clients')) || capabilityAnswer('clients').includes('lista'), 'capacidad de entidad no vuelca una lista mecánica')

  // J) Ambigüedad → pide aclaración (no lectura).
  for (const q of ['mmm', 'y eso?', 'no sé']) {
    ok(!reads(q), `ambiguo no lee: "${q}" (act=${act(q)})`)
  }

  return fail
}
