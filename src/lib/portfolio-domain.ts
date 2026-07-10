// Semántica REAL de Cartera/Inmuebles (P56) — PURA. Basada en la auditoría del modelo (ver
// docs/P56_PORTFOLIO_DATA_MODEL_AUDIT.md): la publicación EXISTE vía la columna `status`
// (`listed` = «Publicado» en la UI); NO hay campo aparte de publicación/portales. Vendido/alquilado/
// reservado también viven en `status`. Esta capa traduce estados crudos a semántica honesta y detecta
// preguntas de ESTADO BINARIO (publicado/vendido/reservado…) que NUNCA deben responderse con
// «lo más cercano» de la búsqueda por similitud.

import { foldText } from '@/lib/real-estate-search'

export type Availability = 'available' | 'reserved' | 'sold' | 'rented' | 'inactive' | 'unknown'
export type Publication = 'published' | 'unpublished' | 'unknown'

export type PortfolioPropertyState = {
  availability: Availability
  publication: Publication   // published = status listed/available (así lo etiqueta la UI)
  isClosed: boolean          // vendido/alquilado/archivado (histórico)
  labelEs: string            // etiqueta para el usuario — NUNCA el status crudo
  reason: string
}

// Mapa de estados REALES (catálogo de la UI + valores vistos en BD: prospecting/listed/sold/rented…).
const STATE_MAP: Record<string, Omit<PortfolioPropertyState, 'reason'>> = {
  prospecting: { availability: 'available', publication: 'unpublished', isClosed: false, labelEs: 'En preparación (sin publicar)' },
  listed: { availability: 'available', publication: 'published', isClosed: false, labelEs: 'Publicado' },
  available: { availability: 'available', publication: 'published', isClosed: false, labelEs: 'Disponible (publicado)' },
  under_contract: { availability: 'reserved', publication: 'published', isClosed: false, labelEs: 'Reservado' },
  reserved: { availability: 'reserved', publication: 'published', isClosed: false, labelEs: 'Reservado' },
  sold: { availability: 'sold', publication: 'unpublished', isClosed: true, labelEs: 'Vendido' },
  rented: { availability: 'rented', publication: 'unpublished', isClosed: true, labelEs: 'Alquilado' },
  archived: { availability: 'inactive', publication: 'unpublished', isClosed: true, labelEs: 'Archivado' },
}

export function normalizePropertyState(status: unknown): PortfolioPropertyState {
  const s = typeof status === 'string' ? status.trim().toLowerCase() : ''
  const m = STATE_MAP[s]
  if (m) return { ...m, reason: `status=${s}` }
  return { availability: 'unknown', publication: 'unknown', isClosed: false, labelEs: 'Estado sin clasificar', reason: `status=${s || 'vacío'}` }
}

// ── Intención de ESTADO sobre la cartera («publicados», «vendidos», «reservados», «recientes»…) ──────
export type StatusIntent =
  | 'published' | 'unpublished' | 'available' | 'sold' | 'rented' | 'reserved' | 'closed' | 'all' | 'recent'

export function parseStatusIntent(text: string): StatusIntent | null {
  const n = foldText(text)
  if (/\b(publicad|anunciad)\w*\b/.test(n)) return /\b(no|sin)\s+(estan?\s+)?(publicad|anunciad)/.test(n) ? 'unpublished' : 'published'
  if (/\b(sin publicar|por publicar|listos? para publicar|publicables?)\b/.test(n)) return 'unpublished'
  if (/\bvendid[oa]s?\b/.test(n)) return 'sold'
  if (/\balquilad[oa]s?\b/.test(n)) return 'rented'
  if (/\breservad[oa]s?\b/.test(n)) return 'reserved'
  if (/\b(cerrad[oa]s?|historico)\b/.test(n)) return 'closed'
  if (/\b(disponibles?|libres?|activ[oa]s?)\b/.test(n)) return 'available'
  if (/\b(actualizad[oa]s? recientemente|recientes?|ultim[oa]s? (cambios|actualizaciones)|cambios recientes)\b/.test(n)) return 'recent'
  if (/\btod[oa]s? (los |las )?(inmuebles|propiedades|pisos|viviendas)\b/.test(n)) return 'all'
  // P63: «todo lo que tengo en inmuebles», «todo lo de cartera/propiedades» → listado completo.
  if (/\btodo lo (que tengo |de |en )?(de |en )?(inmuebles|cartera|propiedades|pisos)\b/.test(n)) return 'all'
  if (/\b(listame|lista|muestrame|ensename|dame|dime)\b.*\btodo\b.*\b(inmuebles|cartera|propiedades|pisos)\b/.test(n)) return 'all'
  return null
}

// ¿El inmueble encaja con la intención de estado?
export function matchesStatusIntent(status: unknown, intent: StatusIntent): boolean {
  const st = normalizePropertyState(status)
  switch (intent) {
    case 'published': return st.publication === 'published'
    case 'unpublished': return st.publication === 'unpublished' && !st.isClosed // activos sin publicar (no vendidos)
    case 'available': return st.availability === 'available'
    case 'sold': return st.availability === 'sold'
    case 'rented': return st.availability === 'rented'
    case 'reserved': return st.availability === 'reserved'
    case 'closed': return st.isClosed
    case 'all': case 'recent': return true
  }
}

// Criterio aplicado, explicado en humano (para que «no hay resultados» nunca sea genérico).
export const STATUS_INTENT_LABEL: Record<StatusIntent, string> = {
  published: 'estado = Publicado', unpublished: 'activos sin publicar (En preparación)',
  available: 'disponibles (no vendidos/alquilados)', sold: 'estado = Vendido', rented: 'estado = Alquilado',
  reserved: 'estado = Reservado', closed: 'histórico (vendidos/alquilados/archivados)',
  all: 'todos los inmuebles', recent: 'actualizados recientemente',
}

// ¿Es una pregunta de estado binario? (publicación/vendido/reservado…) → PROHIBIDO «lo más cercano».
export function isBinaryStateQuestion(text: string): boolean {
  const i = parseStatusIntent(text)
  return i !== null && i !== 'all' && i !== 'recent'
}
