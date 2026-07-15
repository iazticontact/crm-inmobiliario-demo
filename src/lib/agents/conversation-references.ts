// P71 — RESOLUCIÓN ESTRUCTURAL DE REFERENCIAS. Capa PURA que trabaja con TIPOS y ESTADO, no con frases.
// Detecta marcadores lingüísticos GENERALES del español (pronombres/posesivos, demostrativos, ordinales,
// superlativos/extremos, «el anterior», «otra vez») y los mapea al ESTADO conversacional para devolver un
// IDENTIFICADOR o CRITERIO. NUNCA devuelve datos: el llamador reconsulta la fuente real por id/criterio.
// Regla dura: jamás cambia de tipo de entidad sin evidencia; ante dos referentes de confianza similar,
// marca ambigüedad (el llamador pregunta, no elige en silencio).

import { foldText } from '@/lib/real-estate-search'
import type { ConversationState, EntityRef, ConvEntityType } from './conversation-state'

export type ReferenceKind =
  | { kind: 'possessive' }                              // «su/sus/le/de él/de ella/suyo»
  | { kind: 'demonstrative'; noun: ConvEntityType | null } // «ese/esta/aquel [piso/cliente…]»
  | { kind: 'ordinal'; index: number }                  // «el primero/segundo/último» (0-based; -1 = último)
  | { kind: 'extreme'; field: ExtremeField; dir: 'asc' | 'desc' } // «el más caro/reciente»
  | { kind: 'previous' }                                // «el anterior/el de antes/el otro»
  | { kind: 'same_query' }                              // «otra vez/de nuevo/repite/¿seguro? cuéntalos»

export type ExtremeField = 'price' | 'date' | 'value' | 'name'

export type AnchorResolution =
  | { type: 'entity'; entity: EntityRef; via: string; confidence: number }
  | { type: 'extreme'; field: ExtremeField; dir: 'asc' | 'desc'; via: string }
  | { type: 'same_query'; via: string }
  | { type: 'ambiguous'; candidates: EntityRef[]; via: string }
  | null

// ── Léxico general (marcadores lingüísticos, no frases del incidente) ─────────────────────────────────
const POSSESSIVE = /\b(sus?|le|les|suy[oa]s?|de (el|ella|ellos|ellas))\b/
const DEMONSTRATIVE = /\b(ese|esa|eso|este|esta|esto|aquel|aquella|aquello|dicho|dicha)\b/
const PREVIOUS = /\b(el anterior|la anterior|el de antes|la de antes|el otro|la otra|el previo|la previa)\b/
const SAME_QUERY = /\b(otra vez|de nuevo|nuevamente|repite(lo|los|las)?|vuelve a (mirar|consultar|contar|listar)|cuenta(los|las)?|reconsulta|refresca|actualiza(lo|los)?|seguro\?|estas segur|comprueba(lo)?)\b/
const ORDINAL_WORDS: Record<string, number> = {
  primer: 0, primero: 0, primera: 0, segundo: 1, segunda: 1, tercero: 2, tercer: 2, tercera: 2,
  cuarto: 3, cuarta: 3, quinto: 4, quinta: 4, sexto: 5, septimo: 6, octavo: 7, noveno: 8, decimo: 9,
}
const LAST = /\b(ultim[oa]|el final|la final)\b/
const PENULT = /\bpenultim[oa]\b/
// Superlativo: «(el|la|lo) más|menos <adj>». El adjetivo mapea a un campo de orden real.
const EXTREME_ADJ: Record<string, { field: ExtremeField; highIsMore: boolean }> = {
  caro: { field: 'price', highIsMore: true }, cara: { field: 'price', highIsMore: true },
  barat: { field: 'price', highIsMore: false }, economic: { field: 'price', highIsMore: false },
  reciente: { field: 'date', highIsMore: true }, nuev: { field: 'date', highIsMore: true },
  antigu: { field: 'date', highIsMore: false }, viej: { field: 'date', highIsMore: false },
  grande: { field: 'value', highIsMore: true }, alt: { field: 'value', highIsMore: true },
  pequen: { field: 'value', highIsMore: false }, baj: { field: 'value', highIsMore: false },
}

// Mapea el sustantivo de un demostrativo al tipo de entidad (general, no exhaustivo).
const NOUN_TO_TYPE: Array<[RegExp, ConvEntityType]> = [
  [/\b(client[ea]|comprador|vendedor|propietario|contacto)\b/, 'client'],
  [/\b(inmueble|piso|propiedad|casa|chalet|atico|local|vivienda)\b/, 'property'],
  [/\b(operacion|oportunidad|venta|deal)\b/, 'opportunity'],
  [/\b(tarea|recordatorio|pendiente)\b/, 'task'],
  [/\b(cita|visita|reunion|evento)\b/, 'calendar_event'],
  [/\b(tramite|expediente|caso)\b/, 'service_case'],
  [/\b(documento|archivo|fichero)\b/, 'document'],
]

// Detecta la expresión de referencia presente en el mensaje (la MÁS específica primero).
export function detectReference(message: string): ReferenceKind | null {
  const n = foldText(message)
  if (SAME_QUERY.test(n)) return { kind: 'same_query' }
  if (PREVIOUS.test(n)) return { kind: 'previous' }
  // Ordinales por palabra o por número («el 2», «el número 3»).
  if (PENULT.test(n)) return { kind: 'ordinal', index: -2 }
  if (LAST.test(n)) return { kind: 'ordinal', index: -1 }
  for (const [w, idx] of Object.entries(ORDINAL_WORDS)) {
    if (new RegExp(`\\b(el|la|lo)?\\s*${w}\\b`).test(n)) return { kind: 'ordinal', index: idx }
  }
  const numOrd = n.match(/\b(?:el|la)?\s*(?:numero\s*)?(\d{1,2})\b/)
  if (numOrd && /\b(el|la|numero|dame|muestra|ensename|abre|ficha|detalle)\b/.test(n)) {
    const i = Number(numOrd[1]); if (i >= 1 && i <= 25) return { kind: 'ordinal', index: i - 1 }
  }
  // Extremos: «(el|la|lo) más|menos <adj>».
  const ext = n.match(/\b(?:el|la|lo)\s+(mas|menos)\s+([a-z]+)/)
  if (ext) {
    const dirWord = ext[1]; const adj = ext[2]
    const key = Object.keys(EXTREME_ADJ).find((k) => adj.startsWith(k))
    if (key) {
      const { field, highIsMore } = EXTREME_ADJ[key]
      // «más caro» → desc; «menos caro/más barato» → asc (según highIsMore del adjetivo).
      const dir: 'asc' | 'desc' = (dirWord === 'mas') === highIsMore ? 'desc' : 'asc'
      return { kind: 'extreme', field, dir }
    }
  }
  if (DEMONSTRATIVE.test(n)) {
    const noun = NOUN_TO_TYPE.find(([re]) => re.test(n))?.[1] ?? null
    return { kind: 'demonstrative', noun }
  }
  if (POSSESSIVE.test(n)) return { kind: 'possessive' }
  return null
}

// Elige la entidad activa (por tipo si se sabe; si no, la más reciente de cualquier tipo).
function pickActive(state: ConversationState, type: ConvEntityType | null): EntityRef | null {
  if (type) return state.activeEntities.find((e) => e.entityType === type) ?? null
  return state.activeEntities[0] ?? null
}

// Resuelve el ANCLA a partir de la referencia + estado. Devuelve id/criterio, jamás datos.
export function resolveAnchor(ref: ReferenceKind, state: ConversationState): AnchorResolution {
  switch (ref.kind) {
    case 'same_query':
      return state.lastDataQuery ? { type: 'same_query', via: 'same_query' } : null
    case 'previous': {
      const prev = state.previousEntities[0]
      return prev ? { type: 'entity', entity: prev, via: 'previous', confidence: 0.7 } : null
    }
    case 'possessive': {
      // «su/sus» apunta al POSEEDOR activo (habitualmente el cliente activo). Sin poseedor → nada.
      const owner = pickActive(state, 'client') ?? state.activeEntities[0] ?? null
      return owner ? { type: 'entity', entity: owner, via: 'possessive', confidence: 0.75 } : null
    }
    case 'demonstrative': {
      const nounType = ref.noun
      const byType = pickActive(state, nounType)
      if (byType) return { type: 'entity', entity: byType, via: 'demonstrative', confidence: 0.8 }
      // Sin sustantivo: si hay una sola entidad activa clara, úsala; si hay varias de tipos distintos, ambiguo.
      if (state.activeEntities.length === 1) return { type: 'entity', entity: state.activeEntities[0], via: 'demonstrative', confidence: 0.7 }
      if (state.activeEntities.length > 1) return { type: 'ambiguous', candidates: state.activeEntities.slice(0, 4), via: 'demonstrative' }
      return null
    }
    case 'ordinal': {
      const refs = state.lastDataQuery?.resultRefs ?? []
      if (!refs.length || !state.lastDataQuery) return null
      const idx = ref.index < 0 ? refs.length + ref.index : ref.index
      const item = refs[idx]
      if (!item || !state.lastDataQuery.entityType) return null
      return { type: 'entity', entity: { entityType: state.lastDataQuery.entityType, entityId: item.entityId, displayLabel: item.label, confidence: 0.85, sourceTurnId: '' }, via: `ordinal:${ref.index}`, confidence: 0.85 }
    }
    case 'extreme': {
      // Si el último listado trae sortValue, resolvemos AHÍ (el llamador reconsulta ese id); si no,
      // devolvemos criterio para que el llamador reconsulte con orden.
      const q = state.lastDataQuery
      if (q && q.entityType && q.resultRefs.some((r) => typeof r.sortValue === 'number')) {
        const withVals = q.resultRefs.filter((r) => typeof r.sortValue === 'number') as Array<{ entityId: string; label: string; sortValue: number }>
        withVals.sort((a, b) => ref.dir === 'desc' ? b.sortValue - a.sortValue : a.sortValue - b.sortValue)
        const top = withVals[0]
        if (top) return { type: 'entity', entity: { entityType: q.entityType, entityId: top.entityId, displayLabel: top.label, confidence: 0.8, sourceTurnId: '' }, via: `extreme:${ref.field}:${ref.dir}`, confidence: 0.8 }
      }
      return { type: 'extreme', field: ref.field, dir: ref.dir, via: `extreme:${ref.field}:${ref.dir}` }
    }
    default:
      return null
  }
}

// Conveniencia: detecta + resuelve en un paso.
export function resolveReference(message: string, state: ConversationState): { ref: ReferenceKind; anchor: AnchorResolution } | null {
  const ref = detectReference(message)
  if (!ref) return null
  return { ref, anchor: resolveAnchor(ref, state) }
}
