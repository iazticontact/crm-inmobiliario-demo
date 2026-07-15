// P71·It2 — INTENCIÓN PENDIENTE con SLOTS (capa PURA). Cuando un turno expresa la INTENCIÓN de una acción
// pero le falta información (la entidad, el valor, la fecha…), en vez de descartarla se conserva como
// `PendingIntent` con sus slots. El turno siguiente se interpreta como POSIBLE complemento: se combinan los
// slots ya conocidos con los nuevos y, si la intención queda completa, se produce una intención de acción
// COMPLETA que el plano P66 convierte en PREVIEW (prepare→confirm→execute→verify). NUNCA ejecuta.
//
// Generalidad: la detección se basa en (verbo de mutación imperativo o desiderativo) + (palabra de campo) +
// (sustantivo de módulo), y los valores se extraen con los MISMOS parsers de P70 (precio, teléfono, fecha,
// estado…). No hay frases del incidente, ni nombres, ni listas cerradas: es una tabla de CAMPOS por acción.

import { foldText } from '@/lib/real-estate-search'
import {
  parsePriceEs, parsePhoneEs, parseDueDateEs,
  detectClientStatusWord, detectPriorityWord, detectOperationStage,
  type AssistantActionIntent,
} from './assistant-action-intent'
import type { PendingIntent, PendingSlot } from './conversation-state'

// Verbo de mutación: imperativo («cambia», «pon») O desiderativo («quiero cambiar», «necesito actualizar»,
// «habría que subir»). El sufijo abierto (\w*) cubre infinitivos/conjugaciones sin listar cada forma.
const ACTION_VERB = /\b(cambia\w*|modifica\w*|actualiza\w*|pon\w*|sube\w*|baja\w*|edita\w*|corrige\w*|ajusta\w*|mueve\w*|pasa\w*|marca\w*)\b/
const DESIRE = /\b(quiero|necesito|me gustaria|querria|querría|podrias|podrías|puedes|deberia|debería|habria que|habría que|hay que|tengo que|me interesa)\b/

// Un CAMPO por acción registrada (alineado con action-registry / parseActionIntent, no con ejemplos).
type FieldSpec = {
  field: RegExp            // palabra de campo («precio», «teléfono», «estado»…)
  moduleNoun: RegExp       // sustantivo de módulo/entidad («inmueble», «cliente», «operación»…)
  capability: string       // actionType del registry
  module: string
  entityNoun: string       // para la pregunta de aclaración: «¿de qué inmueble?»
  valueSlot: PendingSlot   // qué tipo de valor pide («value» | «date» | «status»)
  dbKey: string            // clave real en proposedChanges (price, phone, due_date, status…)
  parse: (msg: string, todayIso: string) => unknown | null
}

const emailParse = (msg: string): string | null => msg.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)?.[0] ?? null

const FIELD_SPECS: FieldSpec[] = [
  { field: /\bprecio\b/, moduleNoun: /\b(inmueble|piso|propiedad|casa|local|chalet|atico|vivienda)\b/, capability: 'portfolio.update_price', module: 'portfolio', entityNoun: 'inmueble', valueSlot: 'value', dbKey: 'price', parse: (m) => parsePriceEs(m) },
  { field: /\b(valor|importe)\b/, moduleNoun: /\boperacion(es)?\b/, capability: 'operations.update_value', module: 'operations', entityNoun: 'operación', valueSlot: 'value', dbKey: 'value', parse: (m) => parsePriceEs(m) },
  { field: /\b(telefono|teléfono|movil|móvil)\b/, moduleNoun: /\bclient[ea]\b/, capability: 'clients.update_phone', module: 'clients', entityNoun: 'cliente', valueSlot: 'value', dbKey: 'phone', parse: (m) => parsePhoneEs(m) },
  { field: /\b(email|correo|e-mail|mail)\b/, moduleNoun: /\bclient[ea]\b/, capability: 'clients.update_email', module: 'clients', entityNoun: 'cliente', valueSlot: 'value', dbKey: 'email', parse: (m) => emailParse(m) },
  { field: /\bestado\b/, moduleNoun: /\bclient[ea]\b/, capability: 'clients.update_status', module: 'clients', entityNoun: 'cliente', valueSlot: 'status', dbKey: 'status', parse: (m) => detectClientStatusWord(foldText(m)) },
  { field: /\b(etapa|fase)\b/, moduleNoun: /\boperacion(es)?\b/, capability: 'operations.change_stage', module: 'operations', entityNoun: 'operación', valueSlot: 'status', dbKey: 'stage', parse: (m) => detectOperationStage(foldText(m)) },
  { field: /\bprioridad\b/, moduleNoun: /\btarea\b/, capability: 'tasks.update_priority', module: 'tasks', entityNoun: 'tarea', valueSlot: 'status', dbKey: 'priority', parse: (m) => detectPriorityWord(foldText(m)) },
  { field: /\b(fecha|vencimiento)\b/, moduleNoun: /\btarea\b/, capability: 'tasks.update_due_date', module: 'tasks', entityNoun: 'tarea', valueSlot: 'date', dbKey: 'due_date', parse: (m, today) => parseDueDateEs(m, today) ?? m.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null },
]

function specFor(capability: string): FieldSpec | null {
  return FIELD_SPECS.find((s) => s.capability === capability) ?? null
}

// ¿El mensaje nombra una ENTIDAD concreta (no un indefinido «un/una/algún»)? Devuelve el texto de búsqueda.
function extractEntityNeedle(message: string, spec: FieldSpec): string | null {
  let raw = message.trim()
  // Quita el valor final para no confundirlo con el nombre: «… a 305.000 €», «… como inactivo», «… a mañana».
  raw = raw.replace(/\s+(a|como|en|para)\s+\S.*$/i, ' ').trim()
  // Toma lo que va tras «de/del» o tras el sustantivo del módulo; si no, el mensaje limpio.
  const afterDe = raw.match(/\b(?:de|del)\s+(.+)$/i)?.[1]
  let needle = (afterDe ?? raw)
    .replace(new RegExp(`.*?${spec.moduleNoun.source}`, 'i'), '') // corta hasta el sustantivo del módulo
    .replace(/^\s*(el|la|los|las|un|una|unos|unas|de|del)\s+/i, '')
    .replace(/^\s*(de|del)\s+/i, '')
    .trim()
  if (!needle) needle = (afterDe ?? '').replace(/^\s*(el|la|un|una)\s+/i, '').trim()
  // Indefinido puro («un inmueble», «una operación») → NO es concreto.
  if (!needle || /^(un|una|unos|unas|alg[uú]n|alguna|cualquier)\b/i.test(needle) || needle.length < 2) return null
  // Una PREGUNTA o un verbo de consulta no es un nombre de entidad («¿qué clientes tengo?» no es «cliente»).
  if (/\b(que|cual|cuales|cuando|cuant[oa]s?|como|donde|tengo|tienes|hay|muestra|ensename|dame|lista|listame|quiero|necesito|ver)\b/.test(foldText(needle))) return null
  return needle.slice(0, 80)
}

export type PendingBuild = { pending: Omit<PendingIntent, 'expiresAt' | 'sourceTurnId'>; askSlot: PendingSlot; askEntityNoun: string }

// Detecta una acción con intención clara pero INCOMPLETA. Devuelve la intención pendiente y qué preguntar.
// Devuelve null si no es una acción, o si ya está completa (en ese caso lo maneja parseActionIntent → preview).
export function detectIncompleteAction(message: string, todayIso: string): PendingBuild | null {
  const n = foldText(message)
  if (!ACTION_VERB.test(n) && !DESIRE.test(n)) return null
  const isQuestion = /[?¿]/.test(message)
  for (const spec of FIELD_SPECS) {
    if (!spec.field.test(n) || !spec.moduleNoun.test(n)) continue
    const collected: Record<string, unknown> = {}
    const val = spec.parse(message, todayIso)
    if (val !== null && val !== undefined && val !== '') collected[spec.valueSlot] = val
    const needle = extractEntityNeedle(message, spec)
    if (needle) collected.entity = needle
    // Una PREGUNTA sin NINGÚN dato concreto es una consulta de capacidad («¿puedo cambiar el precio de un
    // inmueble?»), no una acción incompleta: no se abre intención pendiente (lo explica el turno conceptual).
    if (isQuestion && collected[spec.valueSlot] === undefined && collected.entity === undefined) return null
    const requiredSlots: string[] = []
    if (collected[spec.valueSlot] === undefined) requiredSlots.push(spec.valueSlot)
    if (collected.entity === undefined) requiredSlots.push('entity')
    if (!requiredSlots.length) return null // completa → no hace falta pendiente
    return {
      pending: { kind: 'action', capability: spec.capability, module: spec.module, requiredSlots, collectedSlots: collected, originalRequest: message.slice(0, 400), confidence: 0.7, status: 'awaiting_slot' },
      askSlot: requiredSlots[0] as PendingSlot,
      askEntityNoun: spec.entityNoun,
    }
  }
  return null
}

// Intenta COMPLETAR una intención pendiente con el mensaje de complemento. Combina slots ya conocidos con
// los nuevos. Si queda completa → intención de acción para el preview; si sigue faltando → stillMissing.
export type PendingComplete =
  | { done: true; intent: Extract<AssistantActionIntent, { act: 'prepare' }>; collected: Record<string, unknown> }
  | { done: false; stillMissing: string[]; askSlot: PendingSlot; askEntityNoun: string; collected: Record<string, unknown> }
  | null

export function completePendingAction(pending: PendingIntent, message: string, todayIso: string): PendingComplete {
  if (pending.kind !== 'action') return null
  const spec = specFor(pending.capability)
  if (!spec) return null
  const collected: Record<string, unknown> = { ...pending.collectedSlots }
  // Completar el VALOR si falta.
  if (collected[spec.valueSlot] === undefined) {
    const val = spec.parse(message, todayIso)
    if (val !== null && val !== undefined && val !== '') collected[spec.valueSlot] = val
  }
  // Completar la ENTIDAD si falta.
  if (collected.entity === undefined) {
    const needle = extractEntityNeedle(message, spec)
    if (needle) collected.entity = needle
  }
  const stillMissing: string[] = []
  if (collected[spec.valueSlot] === undefined) stillMissing.push(spec.valueSlot)
  if (collected.entity === undefined) stillMissing.push('entity')
  if (stillMissing.length) return { done: false, stillMissing, askSlot: stillMissing[0] as PendingSlot, askEntityNoun: spec.entityNoun, collected }
  const intent: Extract<AssistantActionIntent, { act: 'prepare' }> = {
    act: 'prepare', actionType: spec.capability as Extract<AssistantActionIntent, { act: 'prepare' }>['actionType'],
    entityText: String(collected.entity), proposedChanges: { [spec.dbKey]: collected[spec.valueSlot] }, missingFields: [],
  }
  return { done: true, intent, collected }
}

// Cancelación explícita GENERAL (limpia intención/preview): «cancela», «déjalo», «olvídalo», «mejor no»…
export function detectExplicitCancel(message: string): boolean {
  return /\b(cancela(lo|la)?|dejalo|déjalo|olvidalo|olvídalo|descarta(lo|la)?|mejor no|da igual|no importa|olvida(lo)?)\b/.test(foldText(message))
}

// Pregunta de aclaración GENERAL para un slot (sin frases del incidente).
export function askForSlot(slot: PendingSlot, entityNoun: string): string {
  switch (slot) {
    case 'entity': return `¿De qué ${entityNoun} se trata? Dime el nombre o la referencia y te preparo el cambio (con preview antes de tocar nada).`
    case 'value': return '¿Qué valor le pongo? Dímelo y te enseño el preview antes de aplicarlo.'
    case 'date': return '¿Para qué fecha? Dímela y te preparo el cambio.'
    case 'status': return '¿A qué estado lo paso? Dímelo y te enseño el preview.'
    default: return 'Me falta un dato para prepararlo. ¿Me lo concretas?'
  }
}

// «Respuesta breve» que NO debe tratarse como intención nueva (mandato §2): un turno corto y sin verbo de
// acción propio es candidato a COMPLEMENTO de la intención pendiente, no a un nuevo objetivo.
export function looksLikeSlotFiller(message: string): boolean {
  const n = foldText(message).trim()
  if (!n) return false
  const words = n.replace(/[¿?¡!.,;:]/g, ' ').split(/\s+/).filter(Boolean)
  const hasOwnActionVerb = ACTION_VERB.test(n)
  return words.length <= 8 && !hasOwnActionVerb
}
