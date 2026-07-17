// P71·It2/It3 — INTENCIÓN PENDIENTE con SLOTS derivados del ACTION REGISTRY (capa PURA). Cuando un turno
// expresa la INTENCIÓN de una acción pero le falta información, se conserva como `PendingIntent` con sus
// slots; el turno siguiente se interpreta como complemento y, si queda completa, produce una intención de
// acción COMPLETA que el plano P66 convierte en PREVIEW (prepare→confirm→execute→verify). NUNCA ejecuta.
//
// It3 — Generalidad: los slots de cada acción se DERIVAN del registry (ASSISTANT_ACTIONS.allowedFields) y se
// parsean con los MISMOS parsers de P70 (sin duplicar). Cubre las 21 acciones, campos de texto libre
// (nombre/título/notas/zona) y calendar.create multi-slot (fecha+hora). La resolución del NOMBRE de la
// entidad NO es destructiva: un label que empieza por un sustantivo de tipo («Chalet …», «Local …») se
// conserva íntegro y lo desambigua el resolver real del workspace (searchProperties/searchClients…).

import { foldText } from '@/lib/real-estate-search'
import {
  parsePriceEs, parsePhoneEs, parseDueDateEs, parseTimeEs, detectCalendarType,
  detectClientStatusWord, detectPriorityWord, detectOperationStage, detectCaseStatusWord,
  type AssistantActionIntent,
} from './assistant-action-intent'
import { getActionDefinition, type AssistantActionId } from './action-registry'
import type { PendingIntent, PendingSlot } from './conversation-state'

const emailParse = (msg: string): string | null => msg.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)?.[0] ?? null

// ── P71·F3.4 — PARTÍCULAS DISCURSIVAS (clase general del español, no frases): asentimiento/negación/
// cortesía. Un mensaje compuesto SOLO de partículas jamás es un nombre de entidad ni un valor de slot.
const PARTICLE_WORD = '(?:si|sí|no|vale|ok|okay|okey|claro|venga|genial|perfecto|estupendo|gracias|de acuerdo|por favor|confirma(?:lo)?|confirmo|adelante|dale|hazlo|eso es|exacto|correcto|entendido)'
const DISCOURSE_PARTICLE_ONLY = new RegExp(`^(?:${PARTICLE_WORD})(?:[\\s.,;:!?¡¿]+(?:${PARTICLE_WORD}))*[\\s.,;:!?]*$`, 'i')
export function isDiscourseParticleOnly(message: string): boolean {
  const n = foldText(message).trim()
  return !!n && DISCOURSE_PARTICLE_ONLY.test(n)
}
// Afirmación pura («sí», «vale, adelante»): con una intención pendiente, NO es un slot — se re-pregunta.
const AFFIRMATIVE_ONLY = /^(?:si|sí|vale|ok|okay|claro|venga|adelante|dale|confirma(?:lo)?|confirmo|perfecto|genial|hazlo|de acuerdo)(?:[\s.,;:!?]+(?:si|sí|vale|ok|okay|claro|venga|adelante|dale|confirma(?:lo)?|confirmo|perfecto|genial|hazlo|de acuerdo|por favor))*[\s.,;:!?]*$/
export function isAffirmativeParticleOnly(message: string): boolean {
  const n = foldText(message).trim()
  return !!n && AFFIRMATIVE_ONLY.test(n)
}
function detectPortfolioStatusWord(n: string): string | null {
  const map: Record<string, string> = { vendid: 'sold', alquilad: 'rented', reservad: 'under_contract', publicad: 'listed', archivad: 'archived' }
  const m = n.match(/\b(vendid[oa]|alquilad[oa]|reservad[oa]|publicad[oa]|archivad[oa])\b/)
  if (!m) return null
  const key = Object.keys(map).find((k) => m[1].startsWith(k))
  return key ? map[key] : null
}

// ── SUSTANTIVOS DE TIPO (para clasificar, NUNCA para borrar del nombre) ────────────────────────────────
const TYPE_NOUN = '(?:inmueble|inmuebles|piso|pisos|propiedad|propiedades|casa|casas|local|locales|chalet|chalets|atico|aticos|vivienda|viviendas|client[ea]s?|operacion(?:es)?|oportunidad(?:es)?|tarea|tareas|tramite|tramites|expediente|expedientes|cita|citas|visita|visitas|reunion(?:es)?)'

// Extrae el TEXTO DE BÚSQUEDA de la entidad sin destruir el nombre. Estrategia:
//  1) quita el valor/fecha/estado final («… a 305.000 €», «… como inactivo», «… a mañana»);
//  2) recorta el andamiaje de campo por delante SOLO cuando hay un artículo+tipo seguido de más texto
//     («el precio del inmueble <chalet …>» → «<chalet …>»); un nombre que empieza por un tipo lo conserva.
//  3) el resolver real del workspace desambigua. Nunca elimina un token de tipo que sea principio del nombre.
function extractEntityNeedle(message: string): string | null {
  let raw = message.trim()
  // P71·F3.4 — un mensaje SOLO de partículas discursivas («sí, confirma», «vale») jamás es una entidad.
  if (isDiscourseParticleOnly(raw)) return null
  raw = raw.replace(/\s+(a|al|como|en|para|hasta)\s+\S.*$/i, ' ').trim() // 1 · quita el valor final
  // 2 · si hay «(artículo) (tipo) NOMBRE», nos quedamos con NOMBRE (un solo tipo, precedido de artículo).
  const artType = raw.match(new RegExp(`\\b(?:el|la|los|las|un|una|del|de la|al)\\s+${TYPE_NOUN}\\s+(.+)$`, 'i'))
  let needle = artType ? artType[1] : raw
  // Marcadores de discurso/corrección al inicio, que no forman parte del nombre («mejor …», «sí, el de…»).
  needle = needle.replace(/^\s*(?:(?:mejor|en realidad|pues|vale|ok|okay|oye|mira|perdona|no espera|si|sí|no|claro|venga)[,\s]+)+/i, '').trim()
  // Conectores de cabeza que NO forman parte del nombre («el de», «la de», «de», «del», artículos sueltos).
  needle = needle.replace(/^\s*(?:el de|la de|los de|las de|del|de la|de|al|a la|el|la|los|las)\s+/i, '').trim()
  // Verbos/campo residuales por delante («cambiar el precio de», «actualizar»…) — corta hasta el último «de».
  if (/\b(precio|valor|importe|telefono|teléfono|movil|móvil|email|correo|estado|etapa|fase|prioridad|fecha|vencimiento|nombre|titulo|título|nota|notas|zona)\b/.test(foldText(needle))) {
    const afterLastDe = needle.match(/\bde(?:l| la)?\s+(.+)$/i)
    if (afterLastDe) needle = afterLastDe[1].replace(new RegExp(`^${TYPE_NOUN}\\s+`, 'i'), '').trim()
  }
  if (!needle || /^(un|una|unos|unas|alg[uú]n|alguna|cualquier)\b/i.test(needle) || needle.length < 2) return null
  // Un nombre de entidad tiene LETRAS: un valor puramente numérico («320000») nunca es una entidad.
  if (!/[a-záéíóúñ]/i.test(needle)) return null
  if (/\b(que|cual|cuales|cuando|cuant[oa]s?|como|donde|tengo|tienes|hay|muestra|ensename|dame|lista|listame|quiero|necesito|ver)\b/.test(foldText(needle))) return null
  return needle.slice(0, 90)
}

// ── SLOTS derivados del registry ──────────────────────────────────────────────────────────────────────
// `acc` acumula proposedChanges (claves de BD) + `entity` (texto de búsqueda) + `__prov` (origen por slot).
type Acc = Record<string, unknown>
type Slot = {
  key: string                 // clave lógica del slot (nombre de campo BD o 'entity'/'when')
  type: PendingSlot
  isEntity?: boolean
  freeText?: boolean
  askNoun?: string
  parseInto: (msg: string, today: string) => Acc | null   // devuelve parte de acc, o null
  isFilled: (acc: Acc) => boolean
}
type ActionSchema = { entityNoun: string; requiredSlots: Slot[] }

const entitySlot = (noun: string): Slot => ({
  key: 'entity', type: 'entity', isEntity: true, askNoun: noun,
  parseInto: (m) => { const n = extractEntityNeedle(m); return n ? { entity: n } : null },
  isFilled: (a) => a.entity !== undefined,
})
const scalarSlot = (field: string, type: PendingSlot, parse: (m: string, today: string) => unknown | null): Slot => ({
  key: field, type,
  parseInto: (m, t) => { const v = parse(m, t); return v !== null && v !== undefined && v !== '' ? { [field]: v } : null },
  isFilled: (a) => a[field] !== undefined,
})
const dateSlot = (field: string): Slot => scalarSlot(field, 'date', (m, t) => parseDueDateEs(m, t) ?? m.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null)
const timeSlot: Slot = {
  key: 'time', type: 'date', askNoun: 'hora',
  parseInto: (m) => { const t = parseTimeEs(m); return t ? { start_hour: t.hour, start_minute: t.minute } : null },
  isFilled: (a) => a.start_hour !== undefined,
}
const freeTextSlot = (field: string, noun: string, max = 160): Slot => ({
  key: field, type: 'value', freeText: true, askNoun: noun,
  parseInto: (m) => {
    // Estructurado: tras «a »/«: »/«que diga …». En completación bare, lo aplica completePendingAction.
    const t = (m.match(/:\s*(.+)\s*$/)?.[1] ?? m.match(/\ba\s+(.+)$/i)?.[1] ?? m.match(/\bque\s+(?:diga\s+|dice\s+)?(.+)\s*$/i)?.[1] ?? '').trim().replace(/^["«]|["»]$/g, '')
    return t.length >= 2 ? { [field]: t.slice(0, max) } : null
  },
  isFilled: (a) => a[field] !== undefined,
})

// Capability → esquema (los campos escritos son subconjunto de allowedFields del registry; se auto-verifica).
const SCHEMAS: Partial<Record<AssistantActionId, ActionSchema>> = {
  'portfolio.update_price': { entityNoun: 'inmueble', requiredSlots: [scalarSlot('price', 'value', (m) => parsePriceEs(m)), entitySlot('inmueble')] },
  'portfolio.update_status': { entityNoun: 'inmueble', requiredSlots: [scalarSlot('status', 'status', (m) => detectPortfolioStatusWord(foldText(m))), entitySlot('inmueble')] },
  'portfolio.update_notes': { entityNoun: 'inmueble', requiredSlots: [freeTextSlot('notes', 'nota', 1000), entitySlot('inmueble')] },
  'portfolio.update_zone': { entityNoun: 'inmueble', requiredSlots: [freeTextSlot('area', 'zona', 80), entitySlot('inmueble')] },
  'operations.update_value': { entityNoun: 'operación', requiredSlots: [scalarSlot('value', 'value', (m) => parsePriceEs(m)), entitySlot('operación')] },
  'operations.change_stage': { entityNoun: 'operación', requiredSlots: [scalarSlot('stage', 'status', (m) => detectOperationStage(foldText(m))), entitySlot('operación')] },
  'clients.update_phone': { entityNoun: 'cliente', requiredSlots: [scalarSlot('phone', 'value', (m) => parsePhoneEs(m)), entitySlot('cliente')] },
  'clients.update_email': { entityNoun: 'cliente', requiredSlots: [scalarSlot('email', 'value', (m) => emailParse(m)), entitySlot('cliente')] },
  'clients.update_status': { entityNoun: 'cliente', requiredSlots: [scalarSlot('status', 'status', (m) => detectClientStatusWord(foldText(m))), entitySlot('cliente')] },
  'clients.update_name': { entityNoun: 'cliente', requiredSlots: [freeTextSlot('name', 'nuevo nombre', 120), entitySlot('cliente')] },
  'clients.update_note': { entityNoun: 'cliente', requiredSlots: [freeTextSlot('notes', 'nota', 1000), entitySlot('cliente')] },
  'tasks.update_due_date': { entityNoun: 'tarea', requiredSlots: [dateSlot('due_date'), entitySlot('tarea')] },
  'tasks.update_priority': { entityNoun: 'tarea', requiredSlots: [scalarSlot('priority', 'status', (m) => detectPriorityWord(foldText(m))), entitySlot('tarea')] },
  'tasks.update_title': { entityNoun: 'tarea', requiredSlots: [freeTextSlot('title', 'nuevo título', 160), entitySlot('tarea')] },
  'cases.update_status': { entityNoun: 'trámite', requiredSlots: [scalarSlot('status', 'status', (m) => detectCaseStatusWord(foldText(m))), entitySlot('trámite')] },
  'cases.update_due_date': { entityNoun: 'trámite', requiredSlots: [dateSlot('due_date'), entitySlot('trámite')] },
  'calendar.create': { entityNoun: 'asunto', requiredSlots: [dateSlot('date'), timeSlot] },
  'calendar.reschedule': { entityNoun: 'cita', requiredSlots: [entitySlot('cita'), { key: 'when', type: 'date', askNoun: 'nueva fecha u hora', parseInto: (m, t) => { const d = parseDueDateEs(m, t) ?? m.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null; const h = parseTimeEs(m); const out: Acc = {}; if (d) out.date = d; if (h) { out.start_hour = h.hour; out.start_minute = h.minute }; return Object.keys(out).length ? out : null }, isFilled: (a) => a.date !== undefined || a.start_hour !== undefined }] },
  'tasks.create': { entityNoun: 'tarea', requiredSlots: [freeTextSlot('title', 'título de la tarea', 160)] },
  'tasks.complete': { entityNoun: 'tarea', requiredSlots: [entitySlot('tarea')] },
  'tasks.reopen': { entityNoun: 'tarea', requiredSlots: [entitySlot('tarea')] },
}
// Auto-verificación (dev): cada campo escrito por un slot debe estar en allowedFields del registry.
if (process.env.NODE_ENV !== 'production') {
  for (const [cap, sch] of Object.entries(SCHEMAS)) {
    const def = getActionDefinition(cap)
    if (!def || !sch) continue
    for (const s of sch.requiredSlots) {
      if (s.isEntity || s.key === 'when' || s.key === 'time') continue
      if (!def.allowedFields.includes(s.key)) console.warn(`[conversation-pending] slot '${s.key}' no está en allowedFields de ${cap}`)
    }
  }
}

function schemaFor(capability: string): ActionSchema | null { return SCHEMAS[capability as AssistantActionId] ?? null }

// ── DETECCIÓN NL → capability (para forma DESIDERATIVA que parseActionIntent no captura) ────────────────
const ACTION_VERB = /\b(cambia\w*|modifica\w*|actualiza\w*|pon\w*|sube\w*|baja\w*|edita\w*|corrige\w*|ajusta\w*|mueve\w*|pasa\w*|marca\w*|renombra\w*|crea\w*|agenda\w*|programa\w*)\b/
const DESIRE = /\b(quiero|necesito|me gustaria|querria|querría|podrias|podrías|puedes|deberia|debería|habria que|habría que|hay que|tengo que|me interesa)\b/
// P71·F3.3 — verbos de LECTURA: «¿puedes mostrarme las visitas de mañana?» es una lectura cortés, no una
// acción. Si el mensaje trae verbo de lectura y ningún verbo de acción propio, no se abre intención.
const READ_VERB = /\b(muestra\w*|mostra\w*|ensena\w*|ensename|dime|dame|lista\w*|ver|veo|consulta\w*|revisa\w*|mira\w*|leer?|cuale?s|cuant[oa]s|que hay|hay)\b/
type DetectRow = { field: RegExp; moduleNoun: RegExp; capability: AssistantActionId; gate?: (n: string) => boolean }
const DETECT: DetectRow[] = [
  { field: /\bprecio\b/, moduleNoun: /\b(inmueble|piso|propiedad|casa|local|chalet|atico|vivienda)\b/, capability: 'portfolio.update_price' },
  { field: /\b(nota|notas)\b/, moduleNoun: /\b(inmueble|piso|propiedad|casa|local|chalet|atico|vivienda)\b/, capability: 'portfolio.update_notes' },
  { field: /\bzona\b/, moduleNoun: /\b(inmueble|piso|propiedad|casa|local|chalet|atico|vivienda)\b/, capability: 'portfolio.update_zone' },
  { field: /\bestado\b/, moduleNoun: /\b(inmueble|piso|propiedad|casa|local|chalet|atico|vivienda)\b/, capability: 'portfolio.update_status' },
  { field: /\b(valor|importe)\b/, moduleNoun: /\boperacion(es)?\b/, capability: 'operations.update_value' },
  { field: /\b(etapa|fase)\b/, moduleNoun: /\boperacion(es)?\b/, capability: 'operations.change_stage' },
  { field: /\b(telefono|teléfono|movil|móvil)\b/, moduleNoun: /\bclient[ea]\b/, capability: 'clients.update_phone' },
  { field: /\b(email|correo|e-mail|mail)\b/, moduleNoun: /\bclient[ea]\b/, capability: 'clients.update_email' },
  { field: /\bnombre\b/, moduleNoun: /\bclient[ea]\b/, capability: 'clients.update_name' },
  { field: /\b(nota|notas)\b/, moduleNoun: /\bclient[ea]\b/, capability: 'clients.update_note' },
  { field: /\bestado\b/, moduleNoun: /\bclient[ea]\b/, capability: 'clients.update_status' },
  { field: /\bprioridad\b/, moduleNoun: /\btarea\b/, capability: 'tasks.update_priority' },
  { field: /\b(titulo|título)\b/, moduleNoun: /\btarea\b/, capability: 'tasks.update_title' },
  { field: /\b(fecha|vencimiento)\b/, moduleNoun: /\btarea\b/, capability: 'tasks.update_due_date' },
  { field: /\b(estado)\b/, moduleNoun: /\b(tramite|expediente)\b/, capability: 'cases.update_status' },
  { field: /\b(fecha|vencimiento)\b/, moduleNoun: /\b(tramite|expediente)\b/, capability: 'cases.update_due_date' },
  // P71·F3.3 — CALENDAR desiderativo («quiero agendar una visita», «necesito programar una reunión mañana»).
  // Gate ESTRUCTURAL: verbo de creación O artículo indefinido («una cita» = cita NUEVA; «la cita» = lectura).
  {
    field: /\b(cita|visita|reunion|llamada)\b/, moduleNoun: /\b(cita|visita|reunion|llamada)\b/, capability: 'calendar.create',
    gate: (n) => /\b(agendar?|agendame|crea\w*|creame|programa\w*|reserva\w*|apunta\w*|organiza\w*|concerta\w*)\b/.test(n)
      || /(?:^|\s)(una|otra)\s+(cita|visita|reunion|llamada)\b/.test(n),
  },
]

// ── API pública ───────────────────────────────────────────────────────────────────────────────────────
export type PendingBuild = { pending: Omit<PendingIntent, 'expiresAt' | 'sourceTurnId'>; askSlot: PendingSlot; askEntityNoun: string }

function firstMissing(schema: ActionSchema, acc: Acc): Slot | null {
  return schema.requiredSlots.find((s) => !s.isFilled(acc)) ?? null
}
function pendingFrom(capability: string, schema: ActionSchema, acc: Acc, message: string): PendingBuild | null {
  const miss = firstMissing(schema, acc)
  if (!miss) return null
  const requiredSlots = schema.requiredSlots.filter((s) => !s.isFilled(acc)).map((s) => s.type)
  return {
    pending: { kind: 'action', capability, module: getActionDefinition(capability)?.module ?? null, requiredSlots, collectedSlots: acc, originalRequest: message.slice(0, 400), confidence: 0.7, status: 'awaiting_slot' },
    askSlot: miss.type, askEntityNoun: miss.askNoun ?? schema.entityNoun,
  }
}

// A partir de una intención de acción PARSEADA (parseActionIntent) que resultó INCOMPLETA → intención pendiente.
export function buildPendingFromIntent(intent: Extract<AssistantActionIntent, { act: 'prepare' }>, message: string): PendingBuild | null {
  const schema = schemaFor(intent.actionType)
  if (!schema) return null
  const acc: Acc = { ...intent.proposedChanges }
  if (intent.entityText) acc.entity = intent.entityText
  return pendingFrom(intent.actionType, schema, acc, message)
}

// Forma DESIDERATIVA/incompleta que parseActionIntent no captura («quiero cambiar el precio de un inmueble»).
export function detectIncompleteAction(message: string, todayIso: string): PendingBuild | null {
  const n = foldText(message)
  if (!ACTION_VERB.test(n) && !DESIRE.test(n)) return null
  // P71·F3.3 — lectura cortés/indirecta («¿puedes mostrarme…?», «quiero ver…») NO es una acción.
  if (READ_VERB.test(n) && !ACTION_VERB.test(n)) return null
  // Forma de CAPACIDAD: signos de interrogación O modal interrogativo («puedo/podría/se puede/es posible»)
  // — en chat la gente omite los «¿?»; la forma modal expresa pregunta de capacidad igualmente.
  const isQuestion = /[?¿]/.test(message) || /\b(puedo|podria|podriamos|se puede|es posible|hay (manera|forma) de)\b/.test(n)
  for (const row of DETECT) {
    if (!row.field.test(n) || !row.moduleNoun.test(n)) continue
    if (row.gate && !row.gate(n)) continue
    const schema = schemaFor(row.capability)
    if (!schema) continue
    const acc: Acc = {}
    for (const s of schema.requiredSlots) { const part = s.parseInto(message, todayIso); if (part) Object.assign(acc, part) }
    // Una PREGUNTA sin NINGÚN dato concreto es una consulta de capacidad, no una acción incompleta.
    if (isQuestion && !Object.keys(acc).length) return null
    const build = pendingFrom(row.capability, schema, acc, message)
    if (build) return build
    // completa por composición del propio mensaje → no hace falta pendiente (lo maneja parseActionIntent)
    return null
  }
  return null
}

export type PendingComplete =
  | { done: true; intent: Extract<AssistantActionIntent, { act: 'prepare' }>; collected: Acc }
  | { done: false; stillMissing: string[]; askSlot: PendingSlot; askEntityNoun: string; collected: Acc }
  | null

const CORRECTION_MARK = /\b(mejor|en realidad|no,|no espera|que sea|corrige|cambialo a|cámbialo a|ponle mejor|perdona)\b/

export function completePendingAction(pending: PendingIntent, message: string, todayIso: string): PendingComplete {
  if (pending.kind !== 'action') return null
  const schema = schemaFor(pending.capability)
  if (!schema) return null
  const acc: Acc = { ...pending.collectedSlots }
  const prov = { ...(acc.__prov as Record<string, string> | undefined) }
  const correcting = CORRECTION_MARK.test(foldText(message))
  let filledOtherThisTurn = false
  // Parsear los slots del mensaje. Un slot AÚN vacío se rellena; un slot YA puesto solo se SUSTITUYE si el
  // mensaje trae un marcador de corrección explícito («mejor 320.000»). Así no se pisa el nombre con el valor.
  for (const s of schema.requiredSlots) {
    const part = s.parseInto(message, todayIso)
    if (!part) continue
    const already = s.isFilled(acc)
    if (already && !correcting) continue
    Object.assign(acc, part)
    for (const k of Object.keys(part)) prov[k] = already ? 'correction' : 'clarification'
    if (!s.freeText) filledOtherThisTurn = true
  }
  // Texto libre en un turno de COMPLEMENTO «bare»: usar el mensaje entero SOLO si este turno no rellenó
  // ya otro slot (evita que el mensaje que aporta la ENTIDAD se use también como el texto libre).
  if (!filledOtherThisTurn) {
    for (const s of schema.requiredSlots) {
      if (s.freeText && !s.isFilled(acc) && looksLikeSlotFiller(message)) {
        const t = message.trim().replace(/^["«]|["»]$/g, '')
        if (t.length >= 2) { acc[s.key] = t.slice(0, 160); prov[s.key] = 'clarification' }
      }
    }
  }
  acc.__prov = prov
  const miss = schema.requiredSlots.filter((s) => !s.isFilled(acc))
  if (miss.length) {
    return { done: false, stillMissing: miss.map((s) => s.type), askSlot: miss[0].type, askEntityNoun: miss[0].askNoun ?? schema.entityNoun, collected: acc }
  }
  const changes: Record<string, unknown> = {}
  for (const k of Object.keys(acc)) { if (k === 'entity' || k.startsWith('__')) continue; changes[k] = acc[k] }
  // P71 — FINALIZACIÓN por capability (derivada del registry, no de frases): calendar.create necesita
  // type/title/duration además de fecha+hora; se derivan de la PETICIÓN ORIGINAL con el parser P70
  // (detectCalendarType) — el preview siempre lo enseña antes de tocar nada.
  if (pending.capability === 'calendar.create') {
    const { type, label } = detectCalendarType(foldText(pending.originalRequest || message))
    if (changes.type === undefined) changes.type = type
    if (changes.title === undefined) changes.title = label
    if (changes.duration === undefined) changes.duration = 60
    if (changes.start_minute === undefined && changes.start_hour !== undefined) changes.start_minute = 0
  }
  const intent: Extract<AssistantActionIntent, { act: 'prepare' }> = {
    act: 'prepare', actionType: pending.capability as AssistantActionId,
    entityText: acc.entity !== undefined ? String(acc.entity) : null, proposedChanges: changes, missingFields: [],
  }
  return { done: true, intent, collected: acc }
}

// Cancelación explícita GENERAL (limpia intención/preview): «cancela», «déjalo», «olvídalo», «mejor no»…
export function detectExplicitCancel(message: string): boolean {
  return /\b(cancela(lo|la)?|dejalo|déjalo|olvidalo|olvídalo|descarta(lo|la)?|mejor no|da igual|no importa|olvida(lo)?)\b/.test(foldText(message))
}

// Pregunta de aclaración GENERAL para un slot (sin frases del incidente).
export function askForSlot(slot: PendingSlot, entityNoun: string): string {
  switch (slot) {
    case 'entity': return `¿De qué ${entityNoun} se trata? Dime el nombre o la referencia y te preparo el cambio (con preview antes de tocar nada).`
    case 'value': {
      const entityNouns = new Set(['inmueble', 'cliente', 'operación', 'tarea', 'trámite', 'asunto', 'cita'])
      return entityNouns.has(entityNoun)
        ? '¿Qué valor le pongo? Dímelo y te enseño el preview antes de aplicarlo.'
        : `¿Qué ${entityNoun} le pongo? Dímelo y te enseño el preview antes de aplicarlo.`
    }
    case 'date': return `¿Para qué ${entityNoun && /hora/.test(entityNoun) ? 'hora' : 'fecha'}? Dímela y te preparo el cambio (con preview).`
    case 'status': return '¿A qué estado lo paso? Dímelo y te enseño el preview.'
    default: return 'Me falta un dato para prepararlo. ¿Me lo concretas?'
  }
}

// «Respuesta breve» que NO debe tratarse como intención nueva: turno corto y sin verbo de acción propio.
// P71·F3.4 — una partícula pura («sí», «vale») tampoco es un filler: no aporta ningún valor de slot.
export function looksLikeSlotFiller(message: string): boolean {
  const n = foldText(message).trim()
  if (!n) return false
  if (isDiscourseParticleOnly(message)) return false
  const words = n.replace(/[¿?¡!.,;:]/g, ' ').split(/\s+/).filter(Boolean)
  return words.length <= 8 && !ACTION_VERB.test(n)
}
