// Evals del ROUTER de decisión (P53) — propiedades transversales del contrato.
// Todo turno produce una decisión completa; la guía de producto y la capa meta MANDAN sobre la entidad;
// ningún turno no-datos autoriza tools; los flags son coherentes con la acción.

import { decideTurn, type TurnType } from '@/lib/agents/assistant-turn'
import { allowedToolsForTurn } from '@/lib/agents/assistant-tool-permissions'

const NO_DATA_TYPES: TurnType[] = [
  'social', 'help', 'capability', 'how_it_works', 'hypothetical',
  'onboarding', 'module_explanation', 'navigation_help', 'user_confused',
  'assistant_meta', 'user_correction', 'user_complaint', 'disagreement', 'ambiguous',
]

export function runDecisionRouterEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // A) Corpus mixto: toda entrada produce una decisión completa y coherente.
  const corpus = [
    'hola', 'gracias', '¿qué puedes hacer?', '¿cómo funciona la cartera?', 'si creo un cliente ¿podrás verlo?',
    'soy nuevo', 'no entiendo', '¿qué muestra el dashboard?', '¿dónde está la facturación?',
    'muéstrame los clientes', '¿cuántas tareas tengo?', 'crea un cliente nuevo',
    'por qué me listas los inmuebles', 'no me refiero a eso', 'esto está mal', 'te equivocas',
    '¿cuánto he facturado?', 'mmm', '¿y el de Malasaña?',
  ]
  for (const q of corpus) {
    const d = decideTurn(q)
    ok(typeof d.turnType === 'string' && d.turnType.length > 0, `decisión con turnType: "${q}"`)
    ok(typeof d.action === 'string' && typeof d.reason === 'string' && d.reason.length > 0, `decisión con action/reason: "${q}"`)
    ok(d.confidence >= 0 && d.confidence <= 1, `confidence válida: "${q}"`)
    // Invariante central: tipo no-datos ⇒ ni lectura ni tools.
    if (NO_DATA_TYPES.includes(d.turnType)) {
      ok(!d.shouldReadData && !d.shouldWriteData, `no-datos no lee/escribe: "${q}" (${d.turnType})`)
      ok(allowedToolsForTurn(d).length === 0, `no-datos sin tools: "${q}" (${d.turnType})`)
    }
    // Coherencia: shouldExplainProduct solo en turnos de guía.
    if (d.shouldExplainProduct) ok(!d.shouldReadData, `guía no lee: "${q}" (${d.turnType})`)
  }

  // B) Prioridades del contrato.
  //    META > módulo/entidad: hablar de la respuesta del Asistente mencionando un módulo NO es guía ni lectura.
  const meta = decideTurn('¿por qué me muestras el dashboard?')
  ok(meta.turnType === 'assistant_meta' && !meta.shouldReadData, `meta > módulo: got ${meta.turnType}`)
  const corr = decideTurn('no me refiero a la cartera')
  ok(corr.turnType === 'user_correction' && !corr.shouldReadData, `corrección > módulo: got ${corr.turnType}`)
  //    GUÍA > entidad: «¿qué muestra la cartera?» tiene entidad properties pero es explicación.
  const guide = decideTurn('¿qué muestra la cartera?')
  ok(guide.turnType === 'module_explanation' && guide.module === 'portfolio' && !guide.shouldReadData, `guía > entidad: got ${guide.turnType}/${guide.module}`)
  //    LECTURA clara con módulo mencionado sigue leyendo.
  const read = decideTurn('muéstrame los inmuebles de la cartera')
  ok(read.shouldReadData && read.turnType.startsWith('data_'), `lectura clara lee: got ${read.turnType}`)

  // C) Facturación: guía explica; lectura redirige; nunca tools.
  const invExplain = decideTurn('¿para qué sirve la facturación?')
  ok(!invExplain.shouldReadData && allowedToolsForTurn(invExplain).length === 0, 'facturación explicación sin tools')
  const invRead = decideTurn('¿cuánto he facturado este mes?')
  ok(invRead.action === 'redirect' && allowedToolsForTurn(invRead).length === 0, 'facturación lectura redirige sin tools')

  // D) Contexto (context kinds): heredar solo cuando toca.
  ok(decideTurn('no entiendo', { priorModule: 'commissions' }).module === 'commissions', 'confusión hereda topic del hilo')
  ok(decideTurn('muéstrame los clientes', { priorModule: 'dashboard' }).module === 'clients', 'lectura no arrastra módulo previo')
  const fu = decideTurn('¿y el de Malasaña?', { priorEntity: 'properties', hasLastResult: true })
  ok(fu.turnType === 'data_followup' || fu.shouldReadData || fu.shouldUseLastResult, `follow-up de datos usa contexto: got ${fu.turnType}`)

  // E) Escritura: prepara, no lee; tools solo write_prepare.
  const w = decideTurn('crea una tarea para mañana')
  ok(w.shouldWriteData && !w.shouldReadData, 'escritura no lee')
  ok(allowedToolsForTurn(w).every((t) => t.endsWith('.write_prepare')), 'escritura solo write_prepare')

  return fail
}
