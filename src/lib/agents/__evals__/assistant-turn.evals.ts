// Evals del contrato de decisión por turno (P50) — por PROPIEDADES, no frases.
// Propiedad central: cuando el usuario habla DEL Asistente (meta), corrige, se queja o discrepa, NO se
// leen datos, aunque el mensaje mencione CUALQUIER entidad CRM.

import {
  decideTurn, assistantMetaAnswer, userCorrectionAnswer, userComplaintAnswer, disagreementAnswer,
  type TurnType,
} from '@/lib/agents/assistant-turn'
import { isSafeAnswer } from '@/lib/agents/assistant-errors'

// Sustantivos de entidad para probar la invariancia "mencionar entidad ≠ leer".
const ENTITY_NOUNS = ['clientes', 'inmuebles', 'pisos', 'operaciones', 'comisiones', 'citas', 'tareas', 'trámites', 'documentos', 'facturas']

const META_CLASSES: TurnType[] = ['assistant_meta', 'user_correction', 'user_complaint', 'disagreement']

export function runTurnEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const reads = (q: string) => decideTurn(q).shouldReadData
  const type = (q: string) => decideTurn(q).turnType

  // A) META con mención de entidad → NUNCA lee (para TODAS las entidades).
  for (const e of ENTITY_NOUNS) {
    const metaPhrases = [
      `por qué me muestras los ${e}?`,
      `por qué me listas los ${e}`,
      `no te pedí los ${e}`,
      `tu respuesta sobre los ${e} está mal`,
    ]
    for (const q of metaPhrases) {
      ok(!reads(q), `META no debe leer (${e}): "${q}" → ${type(q)}`)
      ok(META_CLASSES.includes(type(q)), `META clasifica meta/correction/complaint/disagreement (${e}): "${q}" → ${type(q)}`)
    }
    // Corrección explícita con entidad → reparar, no leer.
    ok(!reads(`no me refiero a los ${e}`), `corrección no lee (${e})`)
    ok(type(`no me refiero a los ${e}`) === 'user_correction', `corrección clasifica (${e})`)
  }

  // B) Capacidad / cómo-funciona / futuro con entidad → no leen.
  for (const e of ENTITY_NOUNS) {
    ok(!reads(`¿tienes acceso a los ${e}?`), `capacidad no lee (${e})`)
    ok(!reads(`¿cómo funcionan los ${e}?`) || type(`¿cómo funcionan los ${e}?`) === 'how_it_works', `cómo-funciona no lee (${e})`)
    ok(!reads(`si creo ${e} nuevos, ¿podrás verlos?`), `futuro no lee (${e})`)
  }

  // C) Lecturas reales → sí leen.
  for (const q of ['muéstrame los clientes', '¿qué inmuebles hay en cartera?', 'lista mis tareas', 'próximas citas', '¿cuántos clientes tengo?']) {
    ok(reads(q), `lectura debe leer: "${q}" → ${type(q)}`)
    ok(type(q) === 'data_read' || type(q) === 'data_followup', `lectura clasifica data_read: "${q}"`)
  }

  // D) Queja / discrepancia → no leen.
  ok(type('esto está mal, no me ayudas') === 'user_complaint' && !reads('esto está mal, no me ayudas'), 'queja no lee')
  ok(type('te equivocas, eso no es correcto') === 'disagreement' && !reads('te equivocas, eso no es correcto'), 'discrepancia no lee')

  // E) Social / ayuda → no leen.
  ok(!reads('hola') && !reads('gracias'), 'social no lee')
  ok(type('¿qué puedes hacer?') === 'capability', 'capacidad self')

  // F) Facturación → redirección, sin lectura de tools.
  const inv = decideTurn('¿cuánto he facturado?')
  ok(inv.domain === 'invoicing' && inv.action === 'redirect', 'facturación redirige')

  // G) Invariancia metamórfica: acentos/mayúsculas no cambian la clase META vs lectura.
  ok(type('POR QUÉ ME LISTAS LOS CLIENTES') === type('por que me listas los clientes'), 'metamórfico meta')
  ok(type('Muéstrame los CLIENTES') === type('muestrame los clientes'), 'metamórfico lectura')

  // H) Confianza y flags de comportamiento.
  ok(decideTurn('por qué respondes así').shouldExplainAssistantBehavior, 'meta explica comportamiento')
  ok(decideTurn('no me refiero a eso').shouldExplainAssistantBehavior, 'corrección explica comportamiento')

  // I) Generadores de recuperación seguros y no vacíos.
  for (const s of [assistantMetaAnswer('clients'), userCorrectionAnswer('properties'), userComplaintAnswer(), disagreementAnswer()]) {
    ok(isSafeAnswer(s) && s.length > 20, `recuperación segura y no vacía: "${s.slice(0, 30)}…"`)
  }
  // No listan datos (no bullets de entidades).
  ok(!assistantMetaAnswer('clients').includes('•'), 'meta no vuelca lista')
  ok(!userCorrectionAnswer('properties').includes('•'), 'corrección no vuelca lista')

  return fail
}
