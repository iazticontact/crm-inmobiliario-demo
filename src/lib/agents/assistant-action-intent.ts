// Intérprete de INTENCIÓN DE ACCIÓN (P66) — PURO. Traduce frases naturales de modificación a las acciones
// REGISTRADAS del plano P65 (nunca inventa tipos ni campos). La confirmación/cancelación solo tienen
// sentido con una pending action válida (eso lo comprueba el wiring, aquí solo se clasifica).

import { foldText } from '@/lib/real-estate-search'
import type { AssistantActionId } from './action-registry'

export type AssistantActionIntent =
  | { act: 'prepare'; actionType: AssistantActionId; entityText: string | null; proposedChanges: Record<string, unknown>; missingFields: string[] }
  | { act: 'confirm' } | { act: 'cancel' } | { act: 'status' }
  | { act: 'modify'; proposedChanges: Record<string, unknown> }

// ── Parsers de valores ────────────────────────────────────────────────────────
// Precio español: «280.000 €», «280000», «280 mil», «280k».
export function parsePriceEs(text: string): number | null {
  const n = foldText(text)
  let m = n.match(/(\d{1,3}(?:\.\d{3})+|\d{4,9})(?:\s*(?:€|euros?))?/)
  if (m) { const v = Number(m[1].replace(/\./g, '')); if (Number.isFinite(v) && v > 0) return v }
  m = n.match(/(\d{1,4})\s*(mil|k)\b/)
  if (m) return Number(m[1]) * 1000
  return null
}
// Teléfono ES: 9 dígitos (600 555 555, 600555555, +34 …).
export function parsePhoneEs(text: string): string | null {
  const m = text.replace(/[.\-]/g, ' ').match(/(?:\+34\s*)?([6789]\d{2})\s*(\d{3})\s*(\d{3})\b/)
  return m ? `${m[1]} ${m[2]} ${m[3]}` : null
}
// Fecha relativa simple → ISO (Europe/Madrid): hoy, mañana, pasado mañana, día de la semana próximo.
export function parseDueDateEs(text: string, todayIso: string): string | null {
  const n = foldText(text)
  const base = new Date(todayIso + 'T12:00:00Z')
  const plus = (d: number) => { const x = new Date(base); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
  if (/\bpasado manana\b/.test(n)) return plus(2)
  if (/\bmanana\b/.test(n)) return plus(1)
  if (/\bhoy\b/.test(n)) return todayIso
  const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b(el )?${days[i]}\\b`).test(n)) {
      const cur = base.getUTCDay()
      const delta = ((i - cur + 7) % 7) || 7
      return plus(delta)
    }
  }
  return null
}

// Nombre propio tras «de/a» («…teléfono de David Iglesias al 600…» → «David Iglesias»).
function extractName(text: string): string | null {
  const m = text.match(/\bde\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]+){0,3})/)
  if (m) return m[1].trim()
  const m2 = text.match(/\ba\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]+){0,3})\b(?!\s*€)/)
  return m2 ? m2[1].trim() : null
}
// Referencia a inmueble: texto tras de/del/el hasta « a <precio>» («San Pedro 66», «Avenida San Pedro 66»).
function extractPropertyRef(text: string): string | null {
  const m = text.match(/\b(?:de|del|el inmueble|la propiedad|el piso)\s+(.+?)\s+a\s+[\d.]/i)
  if (m) return m[1].replace(/^(de |del |la |el )/i, '').trim()
  return null
}

const MUTATE_VERB = /\b(cambia|cambiale|actualiza|modifica|pon(le|lo|)?|sube|baja|edita|corrige)\b/
const CONFIRM = /^(si|sí)?[\s,]*(confirma(lo)?|confirmo|adelante|ejecuta(lo)?|aplica(lo)?|hazlo|dale|procede)\b|^(si|sí)[\s,]*(por favor)?[\s.!]*$/
const CANCEL = /\b(cancela(lo)?|mejor no|dejalo|déjalo|no lo (hagas|apliques)|olvidalo|olvídalo|descarta(lo)?)\b/
const STATUS = /\b(que (cambio|accion|acción) (tengo|hay) pendiente|cambio pendiente|accion pendiente|estado de(l cambio| la accion))\b/
const MODIFY = /\b(mejor|en vez de eso)\b.*\b(\d)/

export function parseActionIntent(message: string): AssistantActionIntent | null {
  const n = foldText(message)
  const raw = message.trim()

  // Orden: cancel > modify > status > confirm > prepare (la cancelación gana a todo).
  if (CANCEL.test(n)) return { act: 'cancel' }
  if (MODIFY.test(n)) {
    const price = parsePriceEs(raw)
    if (price) return { act: 'modify', proposedChanges: { price } }
  }
  if (STATUS.test(n)) return { act: 'status' }
  // «sí explícame / sí pero…» NO es confirmación.
  if (CONFIRM.test(n) && !/\b(explica|pero|primero|cuanto|como|por que|porque)\b/.test(n)) return { act: 'confirm' }

  // PREPARE por composición: verbo de mutación + campo + valor + entidad.
  const mentionsPrice = /\bprecio\b/.test(n) || /\ba \d[\d.]*\s*(€|euros|mil|k)?\s*[.!]?$/.test(n)
  const mentionsPhone = /\b(telefono|teléfono|movil|móvil|numero de contacto)\b/.test(foldText(raw))
  if (MUTATE_VERB.test(n) && mentionsPhone) {
    const phone = parsePhoneEs(raw)
    const name = extractName(raw)
    return { act: 'prepare', actionType: 'clients.update_phone', entityText: name, proposedChanges: phone ? { phone } : {}, missingFields: [...(phone ? [] : ['phone']), ...(name ? [] : ['cliente'])] }
  }
  if (MUTATE_VERB.test(n) && mentionsPrice && /\b(inmueble|piso|propiedad|casa|local|chalet|atico|[A-Z])/.test(raw)) {
    const price = parsePriceEs(raw)
    const ref = extractPropertyRef(raw)
    return { act: 'prepare', actionType: 'portfolio.update_price', entityText: ref, proposedChanges: price ? { price } : {}, missingFields: [...(price ? [] : ['price']), ...(ref ? [] : ['inmueble'])] }
  }
  // Crear tarea: «crea/añade una tarea…», «recuérdame llamar mañana a David».
  if (/\b(crea|anade|añade|apunta|pon)\b.*\btarea\b/.test(n) || /\brecuerdame\b/.test(n)) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
    const due = parseDueDateEs(raw, today)
    let title = raw.replace(/^(crea|añade|anade|apunta|pon)\s+(una\s+)?tarea\s+(para\s+)?/i, '').replace(/^recuérdame\s+|^recuerdame\s+/i, '').trim()
    title = title.replace(/[.!?]+$/, '')
    if (title.length < 3) return { act: 'prepare', actionType: 'tasks.create', entityText: null, proposedChanges: {}, missingFields: ['title'] }
    return { act: 'prepare', actionType: 'tasks.create', entityText: null, proposedChanges: { title: title.slice(0, 160), ...(due ? { due_date: due } : {}) }, missingFields: [] }
  }
  // Completar tarea: «marca como hecha…», «da por hecha/terminada la tarea de…», «completa la tarea…».
  if (/\b(marca|da por|completa|termina|finaliza)\b.*\b(hecha|hecho|completada|terminada|tarea)\b/.test(n)) {
    const m = raw.match(/tarea\s+(?:de\s+)?(.{3,80})$/i)
    return { act: 'prepare', actionType: 'tasks.complete', entityText: m ? m[1].replace(/[.!?]+$/, '').trim() : null, proposedChanges: { status: 'done' }, missingFields: m ? [] : ['tarea'] }
  }
  return null
}
