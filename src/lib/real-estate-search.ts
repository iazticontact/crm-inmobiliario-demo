// Motor semántico de búsqueda inmobiliaria (P29). PURO y testeable (sin I/O): normaliza taxonomía
// (tipo/operación/ubicación/presupuesto), clasifica disponibilidad y puntúa candidatos para que el
// Asistente NO sea un buscador literal. No hardcodea ejemplos: trabaja por diccionarios y reglas.
//
// Consumido por `searchProperties` en agent-tool-readers.ts. La disponibilidad se alinea con
// property-display.ts (isClosedPropertyStatus): activos = no cerrados.

// ── Normalización de texto (tolerante a acentos/mayúsculas) ──────────────────
export function foldText(s: unknown): string {
  return typeof s === 'string'
    ? s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim()
    : ''
}

// ── Taxonomía de TIPO: término del usuario → tipos del catálogo ──────────────
// "genérico" (vivienda/inmueble/propiedad/casa a secas como "hogar") NO filtra por tipo: solo puntúa.
const TYPE_SYNONYMS: Record<string, string[]> = {
  piso: ['piso'], apartamento: ['piso'], apto: ['piso'], estudio: ['piso'], atico: ['atico'],
  duplex: ['duplex'], casa: ['casa', 'chalet', 'adosado'], chalet: ['chalet'], villa: ['chalet'],
  adosado: ['adosado'], pareado: ['adosado'], unifamiliar: ['casa', 'chalet', 'adosado'],
  local: ['local'], comercial: ['local'], oficina: ['oficina'], despacho: ['oficina'],
  nave: ['nave'], industrial: ['nave'], garaje: ['garaje'], parking: ['garaje'], plaza: ['garaje'],
  trastero: ['trastero'], terreno: ['terreno'], parcela: ['terreno'], solar: ['terreno'],
  edificio: ['edificio'],
}
const GENERIC_TYPE_TERMS = new Set(['vivienda', 'viviendas', 'inmueble', 'inmuebles', 'propiedad', 'propiedades', 'hogar', 'casa'])

export type TypeMatch = { canonical: string[] | null; generic: boolean; term: string | null }

// Devuelve los tipos canónicos sugeridos por el texto. Si solo hay términos genéricos → no filtra.
export function normalizePropertyType(text: unknown): TypeMatch {
  const n = foldText(text)
  if (!n) return { canonical: null, generic: false, term: null }
  const found = new Set<string>()
  let term: string | null = null
  let generic = false
  for (const [word, types] of Object.entries(TYPE_SYNONYMS)) {
    if (new RegExp(`\\b${word}s?\\b`).test(n)) {
      types.forEach((t) => found.add(t))
      term = term ?? word
    }
  }
  for (const g of GENERIC_TYPE_TERMS) if (new RegExp(`\\b${g}\\b`).test(n)) generic = true
  // "casa" es ambiguo (tipo o "hogar"): si aparece junto a genéricos, trátalo como pista suave.
  return { canonical: found.size ? [...found] : null, generic, term }
}

// ── Operación ────────────────────────────────────────────────────────────────
export function normalizeOperation(text: unknown): 'venta' | 'alquiler' | null {
  const n = foldText(text)
  if (/\b(comprar|compra|venta|vender|adquirir|en venta|invertir|inversion|invierto)\b/.test(n)) return 'venta'
  if (/\b(alquilar|alquiler|renta|rentar|arrendar|en alquiler|mensualidad)\b/.test(n)) return 'alquiler'
  return null
}

// ── Disponibilidad comercial ─────────────────────────────────────────────────
const CLOSED_STATUS = new Set(['sold', 'rented', 'archived'])
export function isPropertyClosed(status: unknown): boolean {
  return typeof status === 'string' && CLOSED_STATUS.has(status)
}
// Comercialmente activo = en cartera y NO cerrado (prospecting/listed/available/reserved/under_contract…).
export function isPropertyCommerciallyActive(status: unknown): boolean {
  return typeof status === 'string' && status.length > 0 && !CLOSED_STATUS.has(status)
}
export type AvailabilityMode = 'available' | 'all' | 'closed'
export function availabilityAllows(status: unknown, mode: AvailabilityMode): boolean {
  if (mode === 'all') return true
  if (mode === 'closed') return isPropertyClosed(status)
  return isPropertyCommerciallyActive(status) // 'available'
}

// ── Presupuesto / precio (es-ES: 250.000€, 1.200 €/mes, "hasta 300k", "entre 200 y 250 mil") ─────
export type BudgetParse = { maxPrice: number | null; minPrice: number | null; monthly: boolean }
function toNumberEs(raw: string): number | null {
  let s = raw.replace(/\s/g, '')
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (s.includes(',')) s = s.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}
export function parseBudget(text: unknown): BudgetParse {
  const n = foldText(text)
  const monthly = /(\/mes|al mes|mensual|mensualidad|alquiler|renta)/.test(n)
  const scale = (numStr: string, kSuffix: string | undefined) => {
    const base = toNumberEs(numStr)
    if (base == null) return null
    if (kSuffix === 'k' || /\bmil\b/.test(kSuffix ?? '')) return base * 1000
    if (kSuffix === 'm' || /\bmillon/.test(kSuffix ?? '')) return base * 1_000_000
    return base
  }
  const num = '(\\d{1,3}(?:[.\\s]\\d{3})*(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)'
  let minPrice: number | null = null
  let maxPrice: number | null = null
  const between = n.match(new RegExp(`\\bentre\\s+${num}\\s*(k|mil|m|millones?)?\\s*(?:y|a|-)\\s*${num}\\s*(k|mil|m|millones?)?`))
  if (between) {
    minPrice = scale(between[1], between[2])
    maxPrice = scale(between[3], between[4] ?? between[2])
  } else {
    const max = n.match(new RegExp(`(?:hasta|maximo|max|menos de|por debajo de|no mas de)\\s+${num}\\s*(k|mil|m|millones?)?`))
    if (max) maxPrice = scale(max[1], max[2])
    const min = n.match(new RegExp(`(?:desde|minimo|min|mas de|por encima de|a partir de)\\s+${num}\\s*(k|mil|m|millones?)?`))
    if (min) minPrice = scale(min[1], min[2])
    if (!max && !min) {
      // Una sola cifra + señal de presupuesto → techo aproximado.
      const one = n.match(new RegExp(`(?:presupuesto|sobre|unos|en torno a|budget|precio)\\s+${num}\\s*(k|mil|m|millones?)?`))
      if (one) maxPrice = scale(one[1], one[2])
    }
  }
  return { maxPrice, minPrice, monthly }
}

// ── Habitaciones / baños ("3 habitaciones", "2 dormitorios", "1 baño") ───────
export function parseRooms(text: unknown): { bedrooms: number | null; bathrooms: number | null } {
  const n = foldText(text)
  const beds = n.match(/(\d{1,2})\s*(?:hab(?:itacion(?:es)?)?|dormitorios?|dorm\.?)/)
  const baths = n.match(/(\d{1,2})\s*(?:banos?|aseos?)/)
  return {
    bedrooms: beds ? Number(beds[1]) : null,
    bathrooms: baths ? Number(baths[1]) : null,
  }
}

// ── Criterios estructurados a partir de texto libre + parámetros explícitos ──
export type PropertyCriteria = {
  text?: string
  types?: string[] | null
  typeGeneric?: boolean
  operation?: 'venta' | 'alquiler' | null
  locationTokens?: string[]
  minPrice?: number | null
  maxPrice?: number | null
  bedrooms?: number | null
  bathrooms?: number | null
  availability?: AvailabilityMode
}

// Palabras que NO son ubicación: artículos/preposiciones/verbos de consulta/genéricos/presupuesto.
// Sin esto, "tengo"/"hasta"/"algo" se tomaban como localidad y degradaban TODO a parcial (falsos
// negativos). Los tokens ya vienen sin acentos (foldText) y sin dígitos (filtro en buildCriteria).
const STOPWORDS = new Set([
  'de', 'del', 'en', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'con', 'por', 'para', 'que',
  'al', 'y', 'o', 'su', 'sus', 'se', 'lo', 'me', 'mi', 'mis', 'tu', 'tus', 'te', 'nos',
  'busco', 'buscar', 'buscando', 'quiero', 'queria', 'necesito', 'dame', 'muestra', 'muestrame', 'ensename',
  'ensena', 'ver', 'mostrar', 'tengo', 'tienes', 'tiene', 'hay', 'ando', 'pon', 'ponme', 'saca', 'sacame',
  'lista', 'listame', 'consigueme', 'encuentrame',
  'algo', 'alguna', 'algun', 'alguno', 'algunas', 'algunos', 'cosa', 'sitio', 'opcion', 'opciones',
  'disponible', 'disponibles', 'disponibilidad', 'vendido', 'vendidos', 'vendida', 'vendidas',
  'alquilado', 'alquilados', 'reservado', 'reservados', 'publicado', 'publicados', 'activo', 'activos',
  'cerrado', 'cerrados', 'historico', 'historicos',
  'hasta', 'desde', 'entre', 'sobre', 'menos', 'mas', 'max', 'maximo', 'maxima', 'minimo', 'minima', 'min',
  'presupuesto', 'precio', 'importe', 'coste', 'cuesta', 'mil', 'millon', 'millones', 'euro', 'euros', 'budget',
  'zona', 'barrio', 'cerca', 'ubicacion', 'ubicado', 'ubicada', 'localidad', 'municipio', 'pueblo', 'ciudad',
  'cliente', 'clientes', 'comprador', 'vendedor', 'inquilino', 'propietario', 'inversor',
  // verbos de intención (no son ubicación; la operación la infiere normalizeOperation)
  'invertir', 'inversion', 'inversiones', 'vender', 'comprar', 'valorar', 'valoracion', 'visitar', 'ensenar',
  'traspaso', 'captacion', 'reservar',
  // atributos del inmueble (no son ubicación; el nº ya lo extrae parseRooms/parseBudget)
  'habitacion', 'habitaciones', 'hab', 'dormitorio', 'dormitorios', 'dorm', 'bano', 'banos', 'aseo', 'aseos',
  'metro', 'metros', 'superficie', 'planta', 'plantas', 'garaje', 'parking', 'ascensor', 'terraza', 'balcon',
  'piscina', 'jardin', 'trastero', 'exterior', 'interior', 'reformado', 'amueblado', 'luminoso', 'nuevo', 'obra',
])

export function buildCriteriaFromText(text: unknown, explicit: Partial<PropertyCriteria> = {}): PropertyCriteria {
  const raw = typeof text === 'string' ? text : ''
  const typeM = normalizePropertyType(raw)
  const budget = parseBudget(raw)
  const rooms = parseRooms(raw)
  const n = foldText(raw)
  // Tokens de ubicación: palabras "significativas" que no son taxonomía/stopwords ni números.
  const taxoWords = new Set([...Object.keys(TYPE_SYNONYMS), ...GENERIC_TYPE_TERMS, 'venta', 'compra', 'comprar', 'alquiler', 'alquilar'])
  const locationTokens = n
    .replace(/[.,;:()€]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !taxoWords.has(w) && !/\d/.test(w))
  return {
    text: raw,
    types: explicit.types ?? typeM.canonical,
    typeGeneric: typeM.generic,
    operation: explicit.operation ?? normalizeOperation(raw),
    locationTokens: explicit.locationTokens ?? locationTokens,
    minPrice: explicit.minPrice ?? budget.minPrice,
    maxPrice: explicit.maxPrice ?? budget.maxPrice,
    bedrooms: explicit.bedrooms ?? rooms.bedrooms,
    bathrooms: explicit.bathrooms ?? rooms.bathrooms,
    availability: explicit.availability ?? 'available',
  }
}

// ── Puntuación de un candidato ───────────────────────────────────────────────
export type ScorableProperty = {
  property_type?: string | null
  operation_type?: string | null
  status?: string | null
  city?: string | null
  area?: string | null
  address?: string | null
  title?: string | null
  notes?: string | null
  price?: number | null
  bedrooms?: number | null
  bathrooms?: number | null
  area_m2?: number | null
}
export type PropertyScore = { score: number; reasons: string[]; exact: boolean; excluded: boolean; note: string | null }

export function scoreProperty(p: ScorableProperty, c: PropertyCriteria): PropertyScore {
  const reasons: string[] = []
  let score = 0
  let exact = true // se degrada a parcial si algún criterio pedido NO casa

  // Disponibilidad (regla dura configurable): por defecto excluye cerrados.
  if (!availabilityAllows(p.status, c.availability ?? 'available')) {
    return { score: 0, reasons: [], exact: false, excluded: true, note: null }
  }
  if (isPropertyCommerciallyActive(p.status)) { score += 2; reasons.push('disponible') }

  // Tipo
  if (c.types && c.types.length) {
    if (p.property_type && c.types.includes(p.property_type)) { score += 4; reasons.push('tipo coincide') }
    else { exact = false; score += 0.5 }
  } else if (c.typeGeneric) { score += 1 }

  // Operación
  if (c.operation) {
    if (p.operation_type === c.operation) { score += 3; reasons.push('operación coincide') }
    else { exact = false }
  }

  // Ubicación (ciudad/zona/dirección/título/notas), tolerante a acentos
  const hay = foldText([p.city, p.area, p.address, p.title, p.notes].filter(Boolean).join(' · '))
  let noteHit: string | null = null
  if (c.locationTokens && c.locationTokens.length) {
    const hits = c.locationTokens.filter((t) => hay.includes(t))
    if (hits.length) { score += 2 + hits.length; reasons.push('ubicación coincide') }
    else { exact = false }
  }

  // Presupuesto
  if (typeof p.price === 'number') {
    if (c.maxPrice != null) {
      if (p.price <= c.maxPrice) { score += 3; reasons.push('dentro de presupuesto') }
      else if (p.price <= c.maxPrice * 1.1) { score += 1; exact = false; reasons.push('ligeramente por encima del presupuesto') }
      else { exact = false }
    }
    if (c.minPrice != null && p.price < c.minPrice) exact = false
  }

  // Habitaciones / baños
  if (c.bedrooms != null && typeof p.bedrooms === 'number') {
    if (p.bedrooms >= c.bedrooms) { score += 2; reasons.push('habitaciones encajan') } else exact = false
  }
  if (c.bathrooms != null && typeof p.bathrooms === 'number') {
    if (p.bathrooms >= c.bathrooms) { score += 1; reasons.push('baños encajan') } else exact = false
  }

  // Coincidencia en NOTAS (condiciones/precio/observaciones) — señal, citable como "según las notas".
  if (c.locationTokens && c.locationTokens.length && typeof p.notes === 'string') {
    const notesFold = foldText(p.notes)
    const noteTok = c.locationTokens.find((t) => notesFold.includes(t))
    if (noteTok) noteHit = 'coincidencia en notas'
  }
  if (noteHit) { score += 1; reasons.push(noteHit) }

  return { score, reasons, exact, excluded: false, note: noteHit }
}

// ── Motor: separa exactos y parciales, ordena por score ──────────────────────
export type RankedProperty<T> = { item: T; score: number; reasons: string[]; matchLevel: 'exact' | 'partial' }
export type SearchEngineResult<T> = {
  exact: RankedProperty<T>[]
  partial: RankedProperty<T>[]
  excludedCount: number
}
export function rankProperties<T extends ScorableProperty>(rows: T[], c: PropertyCriteria): SearchEngineResult<T> {
  const exact: RankedProperty<T>[] = []
  const partial: RankedProperty<T>[] = []
  let excludedCount = 0
  const hasCriteria = Boolean(
    (c.types && c.types.length) || c.operation || (c.locationTokens && c.locationTokens.length) ||
    c.maxPrice != null || c.minPrice != null || c.bedrooms != null || c.bathrooms != null,
  )
  for (const item of rows) {
    const s = scoreProperty(item, c)
    if (s.excluded) { excludedCount++; continue }
    const ranked: RankedProperty<T> = { item, score: s.score, reasons: s.reasons, matchLevel: s.exact ? 'exact' : 'partial' }
    // Sin criterios (solo "inmuebles disponibles") → todo lo activo cuenta como exacto.
    if (!hasCriteria || (s.exact && s.score > 0)) exact.push(ranked)
    else if (s.score > 0) partial.push(ranked)
  }
  const byScore = (a: RankedProperty<T>, b: RankedProperty<T>) => b.score - a.score
  exact.sort(byScore)
  partial.sort(byScore)
  return { exact, partial, excludedCount }
}
