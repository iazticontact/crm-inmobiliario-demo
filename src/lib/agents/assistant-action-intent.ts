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

// ── P70 Wave C · parsers auxiliares del catálogo multimódulo ─────────────────
// Hora española: «a las 10», «a las 17:30», «a las 9 y media».
export function parseTimeEs(text: string): { hour: number; minute: number } | null {
  const n = foldText(text)
  const m = n.match(/a las? (\d{1,2})(?::(\d{2}))?( y media| y cuarto)?/)
  if (!m) return null
  const hour = Number(m[1])
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  let minute = m[2] ? Number(m[2]) : 0
  if (m[3]?.includes('media')) minute = 30
  if (m[3]?.includes('cuarto')) minute = 15
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  return { hour, minute }
}

// Tipo de evento del calendario según la palabra usada (CHECK real de calendar_events.type).
export function detectCalendarType(n: string): { type: string; label: string } {
  if (/\bvisita\b/.test(n)) return { type: 'visit', label: 'Visita' }
  if (/\bllamada\b/.test(n)) return { type: 'call', label: 'Llamada' }
  if (/\bfirma\b/.test(n)) return { type: 'signing', label: 'Firma' }
  if (/\b(valoracion|tasacion)\b/.test(n)) return { type: 'valuation', label: 'Valoración' }
  if (/\bseguimiento\b/.test(n)) return { type: 'follow-up', label: 'Seguimiento' }
  if (/\bdemo\b/.test(n)) return { type: 'demo', label: 'Demo' }
  if (/\breunion\b/.test(n)) return { type: 'meeting', label: 'Reunión' }
  return { type: 'meeting', label: 'Cita' }
}

// Etapa de operación (vocabulario comercial → etapa interna; mismo mapa que los detectores del CRM).
export function detectOperationStage(n: string): string | null {
  if (/\b(ganad[oa]|vendid[oa]|alquilad[oa]|cerrad[oa] con exito)\b/.test(n)) return 'won'
  if (/\bperdid[oa]\b/.test(n)) return 'lost'
  if (/\breserv/.test(n)) return 'reserved'
  if (/\bnegociacion\b/.test(n)) return 'negotiation'
  if (/\boferta\b/.test(n)) return 'offer'
  if (/\bvisita programada\b/.test(n)) return 'visit_scheduled'
  if (/\bcualificad[oa]\b/.test(n)) return 'qualified'
  if (/\bcontactad[oa]\b/.test(n)) return 'contacted'
  if (/\bnuev[oa]\b/.test(n)) return 'new'
  return null
}

// Estado de trámite (vocabulario canónico del módulo Trámites).
export function detectCaseStatusWord(n: string): string | null {
  if (/\bresuelt[oa]\b/.test(n)) return 'resolved'
  if (/\bcerrad[oa]\b/.test(n)) return 'closed'
  if (/\bpresentad[oa]\b/.test(n)) return 'submitted'
  if (/\ben revision\b/.test(n)) return 'in_review'
  if (/\ben seguimiento\b/.test(n)) return 'in_follow_up'
  if (/\bdocumentacion pendiente\b/.test(n)) return 'documentation_pending'
  if (/\babiert[oa]\b/.test(n)) return 'open'
  return null
}

// Estado de cliente (CHECK real clients.status).
export function detectClientStatusWord(n: string): string | null {
  if (/\binactiv[oa]\b/.test(n)) return 'inactive'
  if (/\bactiv[oa]\b/.test(n)) return 'active'
  if (/\b(perdid[oa]|churn)\b/.test(n)) return 'churned'
  if (/\blead\b/.test(n)) return 'lead'
  return null
}

// Prioridad (vocabulario real: high|normal|low).
export function detectPriorityWord(n: string): string | null {
  if (/\b(alta|urgente|maxima)\b/.test(n)) return 'high'
  if (/\bbaja\b/.test(n)) return 'low'
  if (/\b(normal|media)\b/.test(n)) return 'normal'
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
  // P70 Wave C — OPERACIONES (antes que el branch de precio: «cambia el valor de la operación a 350.000»
  // no es un cambio de precio de inmueble).
  if (/\boperacion(es)?\b/.test(n)) {
    if (MUTATE_VERB.test(n) && /\b(valor|importe)\b/.test(n)) {
      const value = parsePriceEs(raw)
      const m = raw.match(/operaci[oó]n\s+(?:de\s+)?(.+?)\s+a\s+[\d.]/i)
      return { act: 'prepare', actionType: 'operations.update_value', entityText: m ? m[1].trim() : null, proposedChanges: value ? { value } : {}, missingFields: [...(value ? [] : ['valor']), ...(m ? [] : ['operación'])] }
    }
    if (/\b(mueve|pasa|cambia|marca|pon)\b/.test(n)) {
      const stage = detectOperationStage(n)
      if (stage) {
        const m = raw.match(/operaci[oó]n\s+(?:de\s+)?(.+?)\s+(?:a|como|en)\s/i)
        return { act: 'prepare', actionType: 'operations.change_stage', entityText: m ? m[1].trim() : null, proposedChanges: { stage }, missingFields: m ? [] : ['operación'] }
      }
    }
  }
  // P70 Wave F — PRECIO en construcción INVERTIDA (valor antes que la referencia):
  // «ponle 310.000 € al piso de San Pedro 66», «déjale 250.000 al inmueble de la calle Mayor».
  const invPrice = raw.match(/\b(?:ponle|pon|dejale|déjale|deja)\s+([\d.]+\s*(?:€|euros?|mil|k)?)\s+(?:al|a la|en el|en la)\s+(?:piso|inmueble|propiedad|casa|local|chalet|[aá]tico)\s+(?:de\s+)?(.+?)[.!?]*$/i)
  if (invPrice && parsePriceEs(invPrice[1])) {
    const ref = invPrice[2].trim()
    return { act: 'prepare', actionType: 'portfolio.update_price', entityText: ref || null, proposedChanges: { price: parsePriceEs(invPrice[1])! }, missingFields: ref ? [] : ['inmueble'] }
  }
  if (MUTATE_VERB.test(n) && mentionsPrice && /\b(inmueble|piso|propiedad|casa|local|chalet|atico|[A-Z])/.test(raw)) {
    const price = parsePriceEs(raw)
    const ref = extractPropertyRef(raw)
    return { act: 'prepare', actionType: 'portfolio.update_price', entityText: ref, proposedChanges: price ? { price } : {}, missingFields: [...(price ? [] : ['price']), ...(ref ? [] : ['inmueble'])] }
  }
  // P70 Wave C — NOTAS de cliente o inmueble: «añade una nota al cliente X: …» / «apunta en la ficha
  // del inmueble X que …». La nota es el texto tras «:» o tras «que».
  if (/\b(anade|añade|apunta|pon(le)?|escribe|actualiza)\b/.test(n) && /\bnota\b/.test(n) && !/\btarea\b/.test(n)) {
    const noteText = (raw.match(/:\s*(.+)\s*$/)?.[1] ?? raw.match(/\bque\s+(?:diga\s+|dice\s+)?(.+)\s*$/i)?.[1] ?? '').trim().replace(/^["«]|["»]$/g, '')
    const isClient = /\bclient[ea]\b/.test(n)
    const isProperty = /\b(inmueble|piso|propiedad|casa|local|chalet|atico)\b/.test(n)
    if (isClient || isProperty) {
      const m = raw.match(/\b(?:cliente|clienta|inmueble|piso|propiedad|casa|local|chalet|ático|atico)\s+(?:de\s+)?(.+?)(?::|\s+que\s|$)/i)
      const entity = m ? m[1].trim() : null
      const changes = noteText ? { notes: noteText.slice(0, 1000) } : {}
      const missing = [...(noteText ? [] : ['texto de la nota']), ...(entity ? [] : [isClient ? 'cliente' : 'inmueble'])]
      return { act: 'prepare', actionType: isClient ? 'clients.update_note' : 'portfolio.update_notes', entityText: entity, proposedChanges: changes, missingFields: missing }
    }
  }
  // P70 Wave C — NOMBRE de cliente: «cambia el nombre del cliente David a David Iglesias García».
  if (MUTATE_VERB.test(n) && /\bnombre\b/.test(n) && /\bclient[ea]\b/.test(n) && !/\btarea\b/.test(n)) {
    const m = raw.match(/client[ea]\s+(.+?)\s+a\s+(.+?)[.!?]*\s*$/i)
    const entity = m ? m[1].trim() : null
    const newName = m ? m[2].trim() : ''
    return { act: 'prepare', actionType: 'clients.update_name', entityText: entity, proposedChanges: newName ? { name: newName.slice(0, 120) } : {}, missingFields: [...(newName ? [] : ['nuevo nombre']), ...(entity ? [] : ['cliente'])] }
  }
  // P70 Wave C/F — ESTADO de cliente: «marca al cliente David como inactivo», «pasa al cliente David a
  // lead». No exige «como»: basta un verbo de cambio + «cliente» + una palabra de estado inequívoca.
  if (/\b(marca|cambia|pon|pasa)\b/.test(n) && /\bclient[ea]\b/.test(n)) {
    const status = detectClientStatusWord(n)
    if (status) {
      const m = raw.match(/client[ea]\s+(.+?)\s+(?:como|a)\s/i)
      return { act: 'prepare', actionType: 'clients.update_status', entityText: m ? m[1].trim() : null, proposedChanges: { status }, missingFields: m ? [] : ['cliente'] }
    }
  }
  // P70 Wave C — ZONA de inmueble: «cambia la zona de San Pedro 66 a Deusto».
  if (MUTATE_VERB.test(n) && /\bzona\b/.test(n) && !/\bclient[ea]\b/.test(n)) {
    const m = raw.match(/zona\s+(?:de[l]?\s+)?(.+?)\s+a\s+(.+?)[.!?]*\s*$/i)
    const entity = m ? m[1].trim() : null
    const zone = m ? m[2].trim() : ''
    return { act: 'prepare', actionType: 'portfolio.update_zone', entityText: entity, proposedChanges: zone ? { area: zone.slice(0, 80) } : {}, missingFields: [...(zone ? [] : ['zona']), ...(entity ? [] : ['inmueble'])] }
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
  // P67 — email de cliente: «cambia el email de David a x@y.com».
  if (MUTATE_VERB.test(n) && /\b(email|correo|e-mail|mail)\b/.test(n)) {
    const email = raw.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)?.[0] ?? null
    const name = extractName(raw.replace(/[\w.+-]+@[\w-]+\.[\w.]{2,}/, '').trim())
    return { act: 'prepare', actionType: 'clients.update_email', entityText: name, proposedChanges: email ? { email } : {}, missingFields: [...(email ? [] : ['email']), ...(name ? [] : ['cliente'])] }
  }
  // P67 — fecha de tarea: «cambia la fecha de la tarea X a mañana/el viernes».
  if (MUTATE_VERB.test(n) && /\b(fecha|vencimiento)\b/.test(n) && /\btarea\b/.test(n)) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
    const due = parseDueDateEs(raw, today) ?? raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
    const m = raw.match(/tarea\s+(?:de\s+)?(.+?)\s+(?:a|para)\s+(mañana|manana|hoy|el \w+|\d{4}-\d{2}-\d{2})/i)
    return { act: 'prepare', actionType: 'tasks.update_due_date', entityText: m ? m[1].trim() : null, proposedChanges: due ? { due_date: due } : {}, missingFields: [...(due ? [] : ['fecha']), ...(m ? [] : ['tarea'])] }
  }
  // P70 Wave F — fecha de tarea con verbo de MOVIMIENTO sin la palabra «fecha»: «pasa/mueve/aplaza/
  // retrasa/adelanta la tarea X para/a <fecha>». Excluye prioridad/estado/título/completar/reabrir.
  if (/\b(pasa|mueve|aplaza|retrasa|adelanta|reprograma)\b/.test(n) && /\btarea\b/.test(n)
      && !/\b(prioridad|estado|titulo|título|hecha|hecho|completa|terminada|finaliza|pendiente|reabr)\b/.test(n)) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
    const due = parseDueDateEs(raw, today) ?? raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
    if (due) {
      const m = raw.match(/tarea\s+(?:de\s+)?(.+?)\s+(?:a|para)\s/i)
      return { act: 'prepare', actionType: 'tasks.update_due_date', entityText: m ? m[1].trim() : null, proposedChanges: { due_date: due }, missingFields: m ? [] : ['tarea'] }
    }
  }
  // P70 Wave C — fecha límite de TRÁMITE: «cambia la fecha del trámite X a mañana».
  if ((MUTATE_VERB.test(n) || /\bcambia\b/.test(n)) && /\b(fecha|limite|vencimiento)\b/.test(n) && /\b(tramite|expediente)\b/.test(n)) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
    const due = parseDueDateEs(raw, today) ?? raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
    const m = raw.match(/(?:tr[aá]mite|expediente)\s+(?:de\s+)?(.+?)\s+(?:a|para)\s/i)
    return { act: 'prepare', actionType: 'cases.update_due_date', entityText: m ? m[1].trim() : null, proposedChanges: due ? { due_date: due } : {}, missingFields: [...(due ? [] : ['fecha']), ...(m ? [] : ['trámite'])] }
  }
  // P70 Wave C — estado de TRÁMITE: «marca el trámite X como resuelto/presentado/en revisión…».
  if (/\b(marca|cambia|pon|pasa)\b/.test(n) && /\b(tramite|expediente)\b/.test(n)) {
    const status = detectCaseStatusWord(n)
    if (status) {
      const m = raw.match(/(?:tr[aá]mite|expediente)\s+(?:de\s+)?(.+?)\s+(?:como|a|en)\s/i)
      return { act: 'prepare', actionType: 'cases.update_status', entityText: m ? m[1].trim() : null, proposedChanges: { status }, missingFields: m ? [] : ['trámite'] }
    }
  }
  // P67 — estado de inmueble: «marca San Pedro 66 como vendido/reservado/publicado/archivado/alquilado».
  const stateWord = n.match(/\bcomo (vendid[oa]|alquilad[oa]|reservad[oa]|publicad[oa]|archivad[oa]|en preparacion)\b/)
  if (stateWord && (MUTATE_VERB.test(n) || /\bmarca\b/.test(n)) && !/\btarea\b/.test(n) && !/\boperacion\b/.test(n)) {
    const map: Record<string, string> = { vendid: 'sold', alquilad: 'rented', reservad: 'under_contract', publicad: 'listed', archivad: 'archived', 'en preparacion': 'prospecting' }
    const key = Object.keys(map).find((k) => stateWord[1].startsWith(k)) ?? null
    const ref = raw.match(/\b(?:marca|pon|cambia|actualiza)\s+(?:el inmueble\s+|el piso\s+|la propiedad\s+)?(.+?)\s+(?:como|a)\s/i)?.[1]?.trim() ?? null
    return { act: 'prepare', actionType: 'portfolio.update_status', entityText: ref, proposedChanges: key ? { status: map[key] } : {}, missingFields: [...(key ? [] : ['estado']), ...(ref ? [] : ['inmueble'])] }
  }
  // P70 Wave C — PRIORIDAD de tarea: «pon la tarea X en prioridad alta», «cambia la prioridad de la tarea X a baja».
  if (/\bprioridad\b/.test(n) && /\btarea\b/.test(n) && (MUTATE_VERB.test(n) || /\b(marca|pasa|dale)\b/.test(n))) {
    const priority = detectPriorityWord(n)
    const m = raw.match(/tarea\s+(?:de\s+)?(.+?)\s+(?:a|en|con|como)\s/i) ?? raw.match(/(?:a|de)\s+la\s+tarea\s+(?:de\s+)?(.{3,80}?)[.!?]*\s*$/i)
    return { act: 'prepare', actionType: 'tasks.update_priority', entityText: m ? m[1].trim() : null, proposedChanges: priority ? { priority } : {}, missingFields: [...(priority ? [] : ['prioridad']), ...(m ? [] : ['tarea'])] }
  }
  // P70 Wave C — TÍTULO de tarea: «renombra la tarea X a Y», «cambia el título de la tarea X a Y».
  if (/\btarea\b/.test(n) && (/\brenombra\b/.test(n) || (MUTATE_VERB.test(n) && /\b(titulo|nombre)\b/.test(n)))) {
    const m = raw.match(/tarea\s+(?:de\s+)?["«]?(.+?)["»]?\s+a\s+["«]?(.+?)["»]?[.!?]*\s*$/i)
    const entity = m ? m[1].trim() : null
    const newTitle = m ? m[2].trim() : ''
    return { act: 'prepare', actionType: 'tasks.update_title', entityText: entity, proposedChanges: newTitle ? { title: newTitle.slice(0, 160) } : {}, missingFields: [...(newTitle ? [] : ['nuevo título']), ...(entity ? [] : ['tarea'])] }
  }
  // P70 Wave C — REABRIR tarea (antes que completar: «marca la tarea X como pendiente» NO es completar).
  if (/\btarea\b/.test(n) && (/\breabr/.test(n) || (/\b(marca|pon|pasa|deja)\b/.test(n) && /\b(pendiente|sin hacer|no hecha)\b/.test(n)))) {
    const m = raw.match(/tarea\s+(?:de\s+)?(.+?)(?:\s+(?:como|a|en)\s+.*)?[.!?]*\s*$/i)
    return { act: 'prepare', actionType: 'tasks.reopen', entityText: m ? m[1].replace(/\s+(como|a|en)\s+.*$/i, '').trim() : null, proposedChanges: { status: 'pending' }, missingFields: m ? [] : ['tarea'] }
  }
  // Completar tarea: «marca como hecha…», «da por hecha/terminada la tarea de…», «completa la tarea…».
  if (/\b(marca|da por|completa|termina|finaliza)\b.*\b(hecha|hecho|completada|terminada|tarea)\b/.test(n)) {
    const m = raw.match(/tarea\s+(?:de\s+)?(.{3,80})$/i)
    return { act: 'prepare', actionType: 'tasks.complete', entityText: m ? m[1].replace(/[.!?]+$/, '').trim() : null, proposedChanges: { status: 'done' }, missingFields: m ? [] : ['tarea'] }
  }
  // P70 Wave C — CALENDARIO. Solo IMPERATIVOS claros de creación (una pregunta o una lectura de agenda
  // JAMÁS se convierte en acción): «crea/agenda/programa una cita/visita/reunión…».
  const CAL_NOUN = /\b(cita|visita|reunion|llamada|firma|valoracion|tasacion|demo)\b/
  if (!/[?¿]/.test(raw) && CAL_NOUN.test(n) && !/\btarea\b/.test(n) && !/\bnota\b/.test(n)) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
    // Crear: verbo de creación al inicio del mensaje.
    if (/^(crea(me)?|agenda(me)?|programa(me)?|apunta(me)?|pon(me)?|organiza)\b/.test(n.trim()) && !/\b(mueve|reprograma|pasa|retrasa|adelanta|cambia)\b/.test(n)) {
      const date = parseDueDateEs(raw, today) ?? raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
      const time = parseTimeEs(raw)
      const { type, label } = detectCalendarType(n)
      const client = raw.match(/\bcon\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]+){0,3})\b/)?.[1]?.trim() ?? null
      const location = raw.match(/\ben\s+(?:la\s+|el\s+)?((?:oficina|calle|avenida|plaza|c\/)[^,.!?]*)/i)?.[1]?.trim() ?? null
      const changes: Record<string, unknown> = { type, title: client ? `${label} con ${client}` : label, duration: 60 }
      if (client) changes.client_name = client
      if (location) changes.location = location.slice(0, 120)
      if (date) changes.date = date
      if (time) { changes.start_hour = time.hour; changes.start_minute = time.minute }
      const missing = [...(date ? [] : ['fecha']), ...(time ? [] : ['hora'])]
      return { act: 'prepare', actionType: 'calendar.create', entityText: null, proposedChanges: changes, missingFields: missing }
    }
    // Reprogramar: mover una cita existente a otra fecha/hora.
    if (/\b(mueve|reprograma|pasa|retrasa|adelanta|cambia)\b/.test(n) && !/\b(estado|etapa|precio|valor|zona|nota|prioridad|titulo)\b/.test(n)) {
      const date = parseDueDateEs(raw, today) ?? raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
      const time = parseTimeEs(raw)
      if (date || time) {
        const m = raw.match(/\b(?:cita|visita|reuni[oó]n|llamada|firma|valoraci[oó]n|demo)\s+(?:de\s+|con\s+)?(.+?)\s+(?:a|al|para)\s/i)
        const changes: Record<string, unknown> = {}
        if (date) changes.date = date
        if (time) { changes.start_hour = time.hour; changes.start_minute = time.minute }
        return { act: 'prepare', actionType: 'calendar.reschedule', entityText: m ? m[1].trim() : null, proposedChanges: changes, missingFields: m ? [] : ['cita'] }
      }
    }
  }
  return null
}
