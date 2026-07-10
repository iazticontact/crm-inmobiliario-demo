// Clasificador GENERAL de intención del Asistente CRM (P48) — PURO y testeable.
//
// No hardcodea frases: puntúa señales semánticas (diccionarios de entidad + acción + marcadores de
// seguimiento) y elige la entidad con más peso. Tolerante a acentos, mayúsculas, plurales y abreviaturas
// (via foldText). Devuelve una decisión estructurada que el router usa para elegir local-first vs n8n,
// resolver seguimientos y bloquear lo que debe seguir aislado (Facturación).

import { foldText } from '@/lib/real-estate-search'

export type CrmEntity =
  | 'clients' | 'properties' | 'operations' | 'commissions'
  | 'calendar' | 'tasks' | 'service_cases' | 'documents'
  | 'invoicing' | 'help' | 'unknown'

export type IntentAction = 'list' | 'search' | 'count' | 'detail' | 'summary' | 'help' | 'redirect'
export type FollowUpType = 'none' | 'confirm' | 'reference' | 'filter' | 'detail' | 'correction'

export type IntentResult = {
  entity: CrmEntity
  action: IntentAction
  confidence: number            // 0..1 (fuerza de la señal de entidad)
  followUpType: FollowUpType
  needsContext: boolean         // seguimiento que requiere el contexto anterior para resolverse
  shouldUseLocal: boolean       // el motor local puede responder (lectura básica del CRM)
  shouldUseN8n: boolean         // derivar al cerebro general (razonamiento / ambiguo / no cubierto)
  blockedReason: string | null  // p. ej. 'invoicing_isolated'
  searchTerm: string | null     // término para búsquedas por nombre
  query: string                 // mensaje original (para parsers aguas abajo)
}

// Señales por entidad. Raíces en singular; el matcher tolera plural (…s/…es) por regex.
const ENTITY_SIGNALS: Record<Exclude<CrmEntity, 'unknown'>, string[]> = {
  clients: ['cliente', 'clienta', 'comprador', 'compradora', 'vendedor', 'vendedora', 'contacto', 'lead', 'inquilino', 'arrendatario'],
  // P63: estados de inmueble («publicados», «reservados»…) son señales de properties — «muéstrame los
  // publicados» debe resolver Cartera aunque no diga «inmueble». (sold/rented los cubre sales-domain.)
  properties: ['inmueble', 'piso', 'apartamento', 'casa', 'chalet', 'villa', 'adosado', 'pareado', 'atico', 'duplex', 'estudio', 'local', 'garaje', 'parking', 'trastero', 'terreno', 'parcela', 'nave', 'oficina', 'vivienda', 'propiedad', 'cartera', 'inmobiliario', 'publicado', 'anunciado', 'reservado', 'archivado'],
  operations: ['operacion', 'oportunidad', 'pipeline', 'etapa', 'trato', 'negociacion', 'embudo'],
  commissions: ['comision', 'comisionado', 'comisionar', 'honorario'],
  calendar: ['cita', 'agenda', 'calendario', 'visita', 'reunion', 'evento', 'vencimiento'],
  // P63: PROHIBIDO 'todo' como señal de tasks — es la palabra española más común («lístame TODO lo que
  // tengo en inmuebles») y secuestraba cualquier petición hacia Tareas. Solo el anglicismo real to-do.
  tasks: ['tarea', 'recordatorio', 'to-do', 'checklist', 'pendiente'],
  service_cases: ['tramite', 'expediente', 'gestion', 'caso', 'diligencia'],
  documents: ['documento', 'archivo', 'fichero', 'nota simple', 'contrato', 'escritura', 'adjunto'],
  invoicing: ['factura', 'facturado', 'facturar', 'facturacion', 'iva', 'irpf', 'abono', 'ticket'],
  help: ['que puedes hacer', 'que sabes hacer', 'como funciona', 'para que sirves', 'ayuda', 'ayudame', 'capacidad', 'que haces'],
}

// Acciones (débiles; refinan pero no deciden la entidad).
const ACTION_SIGNALS: Record<Exclude<IntentAction, 'redirect' | 'help'>, string[]> = {
  count: ['cuanto', 'cuanta', 'cuantos', 'cuantas', 'numero de', 'total de'],
  search: ['busca', 'buscar', 'buscame', 'encuentra', 'encuentrame', 'localiza', 'localizame'],
  detail: ['dime mas', 'mas detalle', 'detalle', 'detalles', 'sus datos', 'ficha', 'amplia', 'informacion de', 'ver ficha'],
  summary: ['resumen', 'como va', 'como voy', 'resume', 'panorama', 'estado general'],
  list: ['lista', 'listado', 'muestra', 'ensename', 'ensena', 'dame', 'ver', 'que hay', 'que tengo', 'tengo', 'cuales', 'todos', 'todas', 'dime'],
}

// Marcadores de seguimiento (conversacional). Solo se activan en mensajes cortos o con conector inicial.
const FOLLOWUP_MARKERS: Record<Exclude<FollowUpType, 'none'>, RegExp> = {
  reference: /\b(ese|esos|esa|esas|aquel|aquella|el primero|la primera|el segundo|el ultimo|la ultima|el anterior|este|estos)\b/,
  detail: /\b(dime mas|mas detalle|mas detalles|detalles|sus datos|su ficha|amplia|y que mas|dame mas)\b/,
  correction: /\b(no me refiero|mejor|en realidad|quiero decir|no,|me referia|corrige)\b/,
  confirm: /\b(seguro|de verdad|confirma|estas seguro|revisa|repite|otra vez|en serio|de nuevo)\b/,
  filter: /\b(solo|unicamente|filtra|quita|sin|con mas|con menos|mas de|menos de|en venta|en alquiler|disponibles|baratos|caros|abiertas|cerradas|vendidos)\b/,
}

const WRITE_VERBS = /\b(crea|crear|añad|anad|agrega|agregar|nuev[oa]|elimina|elimin|borra|borrar|actualiza|actualizar|cambia|cambiar|modifica|edita|editar|marca|marcar|mueve|mover|programa|programar|agenda(r| una| la)|asigna|asignar|apunta|guarda|envia|manda)\b/

function signalRegex(s: string): RegExp {
  return s.includes(' ') ? new RegExp(`\\b${s}\\b`) : new RegExp(`\\b${s}(?:es|s)?\\b`) // tolera plural
}
function countSignals(n: string, signals: string[]): number {
  let c = 0
  for (const s of signals) if (signalRegex(s).test(n)) c++
  return c
}
// Puntúa una entidad y registra la posición del PRIMER término que casa (para desempatar: la entidad cuyo
// sustantivo aparece antes es el sujeto principal → "documentos de un cliente" = documentos).
function scoreEntity(n: string, signals: string[]): { score: number; firstIndex: number } {
  let score = 0
  let firstIndex = Number.MAX_SAFE_INTEGER
  for (const s of signals) {
    const m = signalRegex(s).exec(n)
    if (m) { score++; if (m.index < firstIndex) firstIndex = m.index }
  }
  return { score, firstIndex }
}

const LOCAL_ENTITIES = new Set<CrmEntity>(['clients', 'properties', 'operations', 'commissions', 'calendar', 'tasks', 'service_cases', 'documents'])

export function classifyIntent(
  message: string,
  opts: { priorEntity?: CrmEntity } = {},
): IntentResult {
  const query = typeof message === 'string' ? message : ''
  const n = foldText(query)
  const words = n.split(/\s+/).filter(Boolean)

  // ── Entidad: puntuar todas; elegir por (score desc, posición del primer término asc) ──
  const scored = new Map<CrmEntity, { score: number; firstIndex: number }>()
  for (const [entity, signals] of Object.entries(ENTITY_SIGNALS) as [Exclude<CrmEntity, 'unknown'>, string[]][]) {
    const s = scoreEntity(n, signals)
    if (s.score > 0) scored.set(entity, s)
  }
  // "en venta"/"en alquiler" sin sustantivo → pista de inmuebles.
  const opHint = /\b(en venta|en alquiler|de venta|de alquiler)\b/.test(n)
  if (opHint && !scored.has('properties')) scored.set('properties', { score: 1, firstIndex: n.search(/\b(venta|alquiler)\b/) })

  let entity: CrmEntity = 'unknown'
  let best = 0
  let bestIdx = Number.MAX_SAFE_INTEGER
  for (const [e, s] of scored) {
    if (s.score > best || (s.score === best && s.firstIndex < bestIdx)) { best = s.score; bestIdx = s.firstIndex; entity = e }
  }

  // ── Seguimiento ──
  let followUpType: FollowUpType = 'none'
  // El anclaje de inicio ignora la puntuación inicial española («¿Y el de…?» = «Y el de…»).
  const startsWithConnector = /^\s*(y|e|ademas|tambien|aparte|luego)\b/.test(n.replace(/^[\s¿¡!?.,;:]+/, ''))
  const shortish = words.length <= 6
  for (const [ft, rx] of Object.entries(FOLLOWUP_MARKERS) as [Exclude<FollowUpType, 'none'>, RegExp][]) {
    if (rx.test(n)) { followUpType = ft; break }
  }
  if (followUpType === 'none' && startsWithConnector && shortish) followUpType = 'filter'

  // Si es seguimiento sin entidad propia y hay entidad previa → heredar el tema.
  const needsContext = followUpType !== 'none' && best === 0 && Boolean(opts.priorEntity && opts.priorEntity !== 'unknown')
  if (needsContext && opts.priorEntity) entity = opts.priorEntity

  // ── Acción ──
  let action: IntentAction = 'list'
  if (entity === 'help') action = 'help'
  else if (entity === 'invoicing') action = 'redirect'
  else if (countSignals(n, ACTION_SIGNALS.count) > 0) action = 'count'
  else if (countSignals(n, ACTION_SIGNALS.detail) > 0 || followUpType === 'detail') action = 'detail'
  else if (countSignals(n, ACTION_SIGNALS.summary) > 0) action = 'summary'
  else if (countSignals(n, ACTION_SIGNALS.search) > 0) action = 'search'

  // ── Confianza (fuerza de la señal de entidad, acotada) ──
  const confidence = entity === 'unknown' ? 0 : Math.min(1, 0.55 + 0.2 * best + (needsContext ? 0.1 : 0))

  // ── Routing ──
  const isWrite = WRITE_VERBS.test(n)
  let blockedReason: string | null = null
  let shouldUseLocal = false
  let shouldUseN8n = false

  if (entity === 'invoicing') {
    blockedReason = 'invoicing_isolated'
  } else if (entity === 'help') {
    shouldUseLocal = true
  } else if (isWrite) {
    // Escrituras: NO local; el cerebro general / fallback determinista las maneja.
    shouldUseN8n = true
  } else if (LOCAL_ENTITIES.has(entity)) {
    shouldUseLocal = true
  } else {
    shouldUseN8n = true // desconocido / ambiguo → cerebro general
  }

  // Término de búsqueda por nombre (para clientes principalmente).
  let searchTerm: string | null = null
  if (action === 'search') {
    const term = extractSearchTerm(n)
    if (term) searchTerm = term
  }

  return { entity, action, confidence, followUpType, needsContext, shouldUseLocal, shouldUseN8n, blockedReason, searchTerm, query }
}

const SEARCH_STOP = new Set([
  'busca', 'buscar', 'buscame', 'encuentra', 'encuentrame', 'localiza', 'localizame', 'el', 'la', 'los', 'las',
  'un', 'una', 'cliente', 'clienta', 'clientes', 'inmueble', 'inmuebles', 'piso', 'pisos', 'llamado', 'llamada',
  'que', 'se', 'llama', 'a', 'al', 'de', 'del', 'me', 'ficha', 'datos', 'sobre', 'informacion', 'info', 'dame',
  'muestra', 'muestrame', 'por', 'nombre', 'telefono', 'email', 'correo',
])
export function extractSearchTerm(folded: string): string | null {
  const t = folded
    .replace(/[¿?¡!.,;:]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SEARCH_STOP.has(w) && !/^\d+$/.test(w))
    .join(' ')
    .trim()
  return t.length >= 2 ? t.slice(0, 60) : null
}
