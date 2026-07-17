// Motor LOCAL-FIRST del Asistente CRM (P47 · generalizado P48) — capa de fiabilidad.
//
// El cerebro por defecto es n8n (que llama de vuelta a /api/agent/tool). Ese camino puede fallar en una
// demo (n8n caído, CRM_BASE_URL mal, timeout) y el LLM se disculpa. Para las LECTURAS BÁSICAS del CRM
// respondemos aquí, de forma determinista, con la sesión RLS del usuario (sin n8n, sin OpenAI, sin
// service_role). P48 lo generaliza: clasificador de intención + política de contexto/anti-contradicción +
// política de errores + más entidades (operaciones, citas, tareas, trámites, documentos, ayuda), sin
// hardcodear frases (diccionarios + reglas). Todo workspace-scoped y read-only.

import type { SupabaseClient } from '@supabase/supabase-js'
import { foldText } from '@/lib/real-estate-search'
import {
  searchProperties, searchClients, crmReadQuery, getCalendarSummary, getPendingTasks, getDocumentsMetadata,
  getClient360, type SearchPropertyItem,
} from '@/lib/agent-tool-readers'
import { classifyIntent, type CrmEntity } from './intent'
import { readFailedCodeFor, humanError } from './assistant-errors'
import { decideFollowUp, shouldAnswerFromPrior, confirmPriorText, stalePreface, type PriorRead } from './context-policy'
import { howItWorksAnswer, capabilityAnswer, futureAnswer, greetingAnswer, smalltalkAnswer } from './assistant-pragmatics'
import { decideTurn, assistantMetaAnswer, userCorrectionAnswer, userComplaintAnswer, disagreementAnswer, type TurnType } from './assistant-turn'
import { explainModule, navigationAnswer, onboardingAnswer, confusedAnswer, resolveModuleFromText, generateFullCrmTour } from './crm-module-catalog'
import { wantsFullTour } from '@/lib/summary-intent'
import { parseStatusIntent, matchesStatusIntent, normalizePropertyState, STATUS_INTENT_LABEL } from '@/lib/portfolio-domain'
import { parseSalesIntent, SALES_DIFFERENCE_EXPLANATION, type SalesQueryIntent } from '@/lib/sales-domain'
import { isUpcoming, isPast, isPendingTask, isOverdueTask, todayMadridIso } from '@/lib/assistant-temporal'
import { classifySummaryIntent } from '@/lib/summary-intent'
import { parseActionIntent, type AssistantActionIntent } from './assistant-action-intent'
import { signActionToken } from './action-policy'
import { getActionDefinition } from './action-registry'

import type { AssistantUiPayload } from '@/lib/assistant/ui-contract'
import { AUTOMATION_RULES } from './findings-engine'
import { parseSchedule as parseScheduleJson, scheduleLabelOf, type ScheduleJson } from './automation-schedule'
import { parseTimeEs } from './assistant-action-intent'
// P71 — estado conversacional unificado + resolución estructural de referencias.
import { type ConversationState, type StateUpdate, type ConvEntityType, type TemporalScope, type EntityRef, emptyState, PENDING_INTENT_TTL_MS } from './conversation-state'
import { detectReference, resolveAnchor, type AnchorResolution } from './conversation-references'
import { getClientOpportunities } from '@/lib/agent-tool-readers'
// P71·It2/It3 — motor temporal (rango en Europe/Madrid) + intención pendiente con slots del action registry.
import { resolveTemporalScope, parseAbsoluteTemporal, formatScopeLabel } from './conversation-temporal'
import { detectIncompleteAction, completePendingAction, detectExplicitCancel, looksLikeSlotFiller, askForSlot, buildPendingFromIntent, isAffirmativeParticleOnly } from './conversation-pending'
// P71·F3.2 — metadata de capacidades temporales de lectura (campo de fecha real por módulo).
import { TEMPORAL_READ_CAPABILITIES } from './conversation-scope'

export type LocalAnswer =
  | { handled: true; answer: string; usedTool: string; entity: CrmEntity; referencedList?: Array<Record<string, unknown>>; ui?: AssistantUiPayload; stateUpdate?: StateUpdate }
  | { handled: false }

// P71 — opciones del motor local (recentContext = apoyo lingüístico; state = memoria estructurada real).
export type LocalOpts = { recentContext?: string; lastResults?: unknown[]; state?: ConversationState; turnId?: string }

type Row = Record<string, unknown>

// ── Formateo (PURO, sin IDs) ─────────────────────────────────────────────────
function cap(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
function euro(n: number): string { return `${n.toLocaleString('es-ES')} €` }
function str(v: unknown): string { return typeof v === 'string' ? v.trim() : '' }
function numOrNull(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) ? v : null }

export function formatPropertyLine(p: {
  title?: string | null; address?: string | null; property_type?: string | null; operation_type?: string | null
  price?: number | null; city?: string | null; area?: string | null
  bedrooms?: number | null; bathrooms?: number | null; area_m2?: number | null
}): string {
  const head = str(p.title) || str(p.address) || 'Inmueble'
  const loc = [p.city, p.area].map((s) => str(s)).filter(Boolean).join(' / ')
  const specs: string[] = []
  if (typeof p.bedrooms === 'number') specs.push(`${p.bedrooms} hab`)
  if (typeof p.bathrooms === 'number') specs.push(`${p.bathrooms} baños`)
  if (typeof p.area_m2 === 'number') specs.push(`${p.area_m2} m²`)
  const parts = [
    p.property_type ? cap(p.property_type) : null,
    p.operation_type ? cap(p.operation_type) : null,
    typeof p.price === 'number' ? euro(p.price) : null,
    loc || null,
    specs.length ? specs.join(' · ') : null,
  ].filter(Boolean)
  return `• ${head} — ${parts.join(' · ')}`
}

export function formatClientLine(c: { name?: string | null; company?: string | null; email?: string | null; phone?: string | null }): string {
  const head = str(c.name) || 'Cliente'
  const parts = [c.company, c.email, c.phone].map((s) => str(s)).filter(Boolean)
  return parts.length ? `• ${head} — ${parts.join(' · ')}` : `• ${head}`
}

function formatOperationLine(o: Row): string {
  const head = str(o.title) || 'Operación'
  const parts = [
    str(o.client_name) || null,
    str(o.stage) ? cap(str(o.stage)) : null,
    numOrNull(o.value) ? euro(numOrNull(o.value)!) : null,
  ].filter(Boolean)
  return parts.length ? `• ${head} — ${parts.join(' · ')}` : `• ${head}`
}

function formatEventLine(e: Row): string {
  const head = str(e.title) || 'Cita'
  const when = [str(e.date), str(e.start_at).slice(11, 16)].filter(Boolean).join(' ')
  const parts = [when || null, str(e.client_name) || null, str(e.status) ? cap(str(e.status)) : null].filter(Boolean)
  return parts.length ? `• ${head} — ${parts.join(' · ')}` : `• ${head}`
}

function formatTaskLine(t: Row): string {
  const head = str(t.title) || 'Tarea'
  const parts = [str(t.due_date) || null, str(t.client_name) || null, str(t.priority) ? cap(str(t.priority)) : null].filter(Boolean)
  return parts.length ? `• ${head} — ${parts.join(' · ')}` : `• ${head}`
}

function formatCaseLine(s: Row): string {
  const head = str(s.title) || 'Trámite'
  const parts = [str(s.client_name) || null, str(s.status) ? cap(str(s.status)) : null, str(s.due_date) || null].filter(Boolean)
  return parts.length ? `• ${head} — ${parts.join(' · ')}` : `• ${head}`
}

function formatDocLine(d: Row): string {
  const head = str(d.file_name) || 'Documento'
  const parts = [str(d.mime_type) || null, str(d.created_at).slice(0, 10) || null].filter(Boolean)
  return parts.length ? `• ${head} — ${parts.join(' · ')}` : `• ${head}`
}

// ── Detectores P47 (conservados; siguen siendo válidos y están en evals) ─────
const PROPERTY_VOCAB = /\b(inmueble|inmuebles|piso|pisos|apartamento|apartamentos|casa|casas|chalet|chalets|adosado|adosados|atico|aticos|duplex|local|locales|garaje|garajes|trastero|trasteros|terreno|terrenos|nave|naves|oficina|oficinas|vivienda|viviendas|propiedad|propiedades|cartera)\b/
const OPERATION_HINT = /\ben (venta|alquiler)\b|\bde venta\b|\bde alquiler\b/
const OTHER_ENTITY = /\b(factura|facturas|cita|citas|tarea|tareas|evento|eventos|comision|comisiones|tramite|tramites|expediente|expedientes|conversacion|conversaciones)\b/

export function detectClientsListIntent(message: string): boolean {
  const n = foldText(message)
  if (!/\bclient(e|es|a|as)\b/.test(n)) return false
  if (PROPERTY_VOCAB.test(n) || OTHER_ENTITY.test(n)) return false
  return /\b(que|cuant[oa]s|list[ae]|listado|listar|muestra|muestrame|ensename|ensena|ver|dame|tengo|tienes|hay|mis|todos|todas|registrad[oa]s|dime|cuales)\b/.test(n)
    || n.replace(/[¿?¡!.\s]/g, '') === 'clientes'
}

const CLIENT_STOP = new Set([
  'busca', 'buscar', 'buscame', 'encuentra', 'encuentrame', 'localiza', 'localizame', 'dame', 'muestra',
  'muestrame', 'ensename', 'ensena', 'ver', 'abre', 'abreme', 'ficha', 'informacion', 'info', 'datos',
  'sobre', 'el', 'la', 'los', 'las', 'un', 'una', 'cliente', 'clienta', 'clientes', 'clientas', 'llamado',
  'llamada', 'que', 'se', 'llama', 'a', 'al', 'de', 'del', 'me', 'quiero', 'necesito', 'dime',
  'tengo', 'tienes', 'tiene', 'hay', 'mis', 'tus', 'todos', 'todas', 'registrados', 'registradas',
  'cuantos', 'cuantas', 'lista', 'listame', 'listado', 'cuales', 'mios', 'mias', 'hola',
])
export function detectClientSearch(message: string): { name: string } | null {
  const n = foldText(message)
  if (!/\bcliente|\bbusca|\bencuentra|\blocaliza/.test(n)) return null
  if (PROPERTY_VOCAB.test(n) || OTHER_ENTITY.test(n)) return null
  const needle = n.replace(/[¿?¡!.,;:]/g, ' ').split(/\s+/).filter((w) => w && !CLIENT_STOP.has(w) && !/^\d+$/.test(w)).join(' ').trim()
  if (needle.length < 2) return null
  return { name: needle.slice(0, 60) }
}

// P61 — Nombre para una FICHA/detalle de cliente: «ficha completa de David Iglesias», «imprime toda la
// ficha de David», «todo sobre David Iglesias». Devuelve el nombre (tras «de …»), o null si no es detalle.
export function extractDetailName(message: string): string | null {
  const n = foldText(message)
  if (!/\b(ficha|detalle|expediente|todo sobre|toda la (informacion|ficha)|imprime|imprimas|dame la ficha|abre la ficha|ver la ficha|ver a)\b/.test(n)) return null
  const m = message.match(/\bde\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][\wÁÉÍÓÚÑáéíóúñ'.-]*(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ][\wÁÉÍÓÚÑáéíóúñ'.-]*){0,3})\s*[?.!]*\s*$/)
  const name = m?.[1]?.trim()
  if (!name || name.length < 2) return null
  // Excluye palabras genéricas que no son nombres propios.
  if (/^(clientes?|inmuebles?|cartera|operaciones|tareas|citas|todo|eso|esto)$/i.test(name)) return null
  return name.slice(0, 60)
}

export function detectPropertiesIntent(message: string, recentContext = ''): { query: string } | null {
  const n = foldText(message)
  if (PROPERTY_VOCAB.test(n) || OPERATION_HINT.test(n)) return { query: message }
  const ctx = foldText(recentContext)
  const talkingProps = PROPERTY_VOCAB.test(ctx) || OPERATION_HINT.test(ctx)
  if (talkingProps && !OTHER_ENTITY.test(n)) {
    const nf = n.replace(/[¿?¡!.]/g, ' ').replace(/\s+/g, ' ').trim()
    const words = nf.split(' ')
    if (words.length <= 6 && /^(?:y|e)\s+/.test(nf)) {
      let q = nf.replace(/^(?:y|e)\s+/, '')
      while (/^(?:el|la|los|las|lo|un|una|unos|unas|de|del|en)\s+/.test(q)) q = q.replace(/^(?:el|la|los|las|lo|un|una|unos|unas|de|del|en)\s+/, '')
      q = q.trim()
      if (q.length >= 2) return { query: q }
    }
  }
  return null
}

// ── Handlers por entidad (DB, RLS del usuario) ───────────────────────────────
const followUpCTA: Partial<Record<CrmEntity, string>> = {
  clients: '¿Quieres que busque un cliente concreto o abra su ficha?',
  properties: '¿Quieres que filtre por zona, precio, habitaciones, baños o m²?',
  operations: '¿Quieres filtrar por etapa, cliente o valor?',
  calendar: '¿Quieres ver las de un cliente concreto o de otro periodo?',
  tasks: '¿Quieres filtrar por cliente o prioridad?',
  service_cases: '¿Quieres ver los de un cliente o por estado?',
  documents: '¿Quieres los documentos de un cliente o inmueble concreto?',
}

function fail(entity: CrmEntity, tool: string, ws: string): LocalAnswer {
  const code = readFailedCodeFor(entity)
  console.error(`[assistant.local] ${code}`, { ws, tool })
  return { handled: true, usedTool: tool, entity, answer: humanError(code) }
}

async function handleClients(supabase: SupabaseClient, ws: string, intent: ReturnType<typeof classifyIntent>): Promise<LocalAnswer> {
  // Búsqueda por nombre.
  if (intent.action === 'search' && intent.searchTerm) {
    const res = await searchClients(supabase, ws, { query: intent.searchTerm, limit: 8 })
    if ('error' in res) return res.error === 'invalid_input' ? { handled: false } : fail('clients', 'local_clients', ws)
    if (!res.results.length) return { handled: true, usedTool: 'local_clients', entity: 'clients', answer: `No he encontrado ningún cliente que coincida con «${intent.searchTerm}». ¿Quieres que te liste todos los clientes?` }
    const lines = res.results.map((c) => formatClientLine(c))
    const head = res.results.length === 1 ? 'He encontrado 1 cliente:' : `He encontrado ${res.results.length} clientes:`
    return { handled: true, usedTool: 'local_clients', entity: 'clients', answer: `${head}\n${lines.join('\n')}`, referencedList: res.results as unknown as Row[] }
  }
  // Listar / contar.
  const { data, error, count } = await supabase
    .from('clients').select('id, name, company, email, phone', { count: 'exact' })
    .eq('workspace_id', ws).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(12)
  if (error) return fail('clients', 'local_clients', ws)
  const rows = (data ?? []) as Row[]
  const total = typeof count === 'number' ? count : rows.length
  if (total === 0) return { handled: true, usedTool: 'local_clients', entity: 'clients', answer: 'No hay clientes registrados todavía. Cuando añadas alguno aparecerá aquí.' }
  if (intent.action === 'count') return { handled: true, usedTool: 'local_clients', entity: 'clients', answer: `Tienes ${total} ${total === 1 ? 'cliente' : 'clientes'} registrados.` }
  const lines = rows.map((c) => formatClientLine(c))
  const head = total === 1 ? 'Tienes 1 cliente registrado:' : `Tienes ${total} clientes registrados${total > rows.length ? `. Te muestro los ${rows.length} más recientes:` : ':'}`
  return { handled: true, usedTool: 'local_clients', entity: 'clients', answer: `${head}\n${lines.join('\n')}\n\n${followUpCTA.clients}`, referencedList: rows }
}

async function handleProperties(supabase: SupabaseClient, ws: string, query: string): Promise<LocalAnswer> {
  // P56 — INTENCIÓN DE ESTADO («publicados», «vendidos», «reservados», «recientes»…): respuesta de estado
  // real con criterio explícito. NUNCA «lo más cercano» para preguntas de estado binario. La publicación
  // existe vía `status` (listed = «Publicado» en la UI); no se inventa ningún campo.
  const statusIntent = parseStatusIntent(query)
  if (statusIntent) {
    const r = await crmReadQuery(supabase, ws, { entity: 'properties', limit: 20, ...(statusIntent === 'recent' ? { orderBy: 'updated_at', orderDirection: 'desc' } : {}) })
    if ('error' in r) return fail('properties', 'local_properties', ws)
    const rows = (r.rows as Row[]).filter((p) => matchesStatusIntent(p.status, statusIntent))
    const criterion = STATUS_INTENT_LABEL[statusIntent]
    if (!rows.length) {
      return { handled: true, usedTool: 'local_properties', entity: 'properties', answer: `No veo inmuebles con ese criterio (${criterion}). ¿Quieres que te muestre toda la cartera o los disponibles?` }
    }
    const shown = rows.slice(0, 8)
    const lines = shown.map((p) => `${formatPropertyLine(p)} · ${normalizePropertyState(p.status).labelEs}`)
    const head = rows.length === 1 ? `Tienes 1 inmueble (criterio: ${criterion}):` : `Tienes ${rows.length} inmuebles (criterio: ${criterion}):`
    return { handled: true, usedTool: 'local_properties', entity: 'properties', answer: `${head}\n${lines.join('\n')}\n\n${followUpCTA.properties}`, referencedList: shown }
  }

  const res = await searchProperties(supabase, ws, { query, availabilityMode: 'available' })
  if ('error' in res) return fail('properties', 'local_properties', ws)
  const exact = res.exactMatches
  const partial = res.partialMatches
  const bullet = (p: SearchPropertyItem) => formatPropertyLine(p)
  const cta = `\n\n${followUpCTA.properties}`
  if (exact.length) {
    const head = exact.length === 1 ? 'Solo he encontrado un inmueble que encaja:' : `Encontré ${exact.length} inmuebles que encajan:`
    let answer = `${head}\n${exact.map(bullet).join('\n')}`
    if (partial.length) answer += `\n\nParecidos (no cumplen todo):\n${partial.slice(0, 4).map(bullet).join('\n')}`
    return { handled: true, usedTool: 'local_properties', entity: 'properties', answer: answer + cta, referencedList: exact as unknown as Row[] }
  }
  if (partial.length) {
    const head = partial.length === 1 ? 'No hay coincidencia exacta. Lo más cercano:' : 'No hay inmuebles que cumplan todos los criterios. Lo más cercano:'
    return { handled: true, usedTool: 'local_properties', entity: 'properties', answer: `${head}\n${partial.slice(0, 6).map(bullet).join('\n')}${cta}`, referencedList: partial as unknown as Row[] }
  }
  const warn = res.warnings[0]
  const base = warn && warn.includes('cerrados')
    ? 'No hay inmuebles disponibles con esos criterios; los que había están cerrados (vendidos/alquilados/archivados).'
    : 'No he encontrado inmuebles con esos criterios en la cartera activa.'
  return { handled: true, usedTool: 'local_properties', entity: 'properties', answer: `${base}${cta}` }
}

async function handleList(
  supabase: SupabaseClient, ws: string, entity: CrmEntity, tool: string,
  loader: () => Promise<{ rows: Row[] } | { error: true }>,
  fmt: (r: Row) => string, singular: string, plural: string,
): Promise<LocalAnswer> {
  const res = await loader()
  if ('error' in res) return fail(entity, tool, ws)
  const rows = res.rows
  if (!rows.length) return { handled: true, usedTool: tool, entity, answer: `No hay ${plural} para mostrar ahora mismo.` }
  const shown = rows.slice(0, 10)
  const head = rows.length === 1 ? `Tienes 1 ${singular}:` : `Tienes ${rows.length}${rows.length > shown.length ? '+' : ''} ${plural}:`
  const cta = followUpCTA[entity] ? `\n\n${followUpCTA[entity]}` : ''
  return { handled: true, usedTool: tool, entity, answer: `${head}\n${shown.map(fmt).join('\n')}${cta}`, referencedList: shown }
}

function helpAnswer(): LocalAnswer {
  return {
    handled: true, usedTool: 'local_help', entity: 'help',
    answer: [
      'Soy tu asistente del CRM inmobiliario. Puedo ayudarte con:',
      '• Clientes — listar, buscar por nombre, ver su ficha.',
      '• Inmuebles — buscar en cartera por zona, precio, tipo, habitaciones, baños o m².',
      '• Operaciones — ver las abiertas/cerradas y su estado.',
      '• Citas y tareas — próximas citas, vencimientos y pendientes.',
      '• Trámites y documentos (solo datos, no el contenido).',
      'La facturación (facturas, IVA, PDF, cobros oficiales) se gestiona en el módulo Facturación.',
      '¿Por dónde quieres empezar?',
    ].join('\n'),
  }
}

function invoicingRedirect(): LocalAnswer {
  return {
    handled: true, usedTool: 'local_redirect', entity: 'invoicing',
    answer: 'La facturación (facturas, IVA, PDF y cobros oficiales) se gestiona en el módulo **Facturación**, no desde el Asistente. El seguimiento interno de comisiones y honorarios está en Cartera → Comisiones. ¿Quieres que te muestre las operaciones cerradas?',
  }
}

function commissionsRedirectFallback(): LocalAnswer {
  return {
    handled: true, usedTool: 'local_commissions', entity: 'commissions',
    answer: 'El control de comisiones y honorarios (pendiente de facturar, facturado, cobrado y potencial) está en **Cartera → Comisiones**, con su resumen y filtros. ¿Quieres que te liste las operaciones cerradas con comisión?',
  }
}

// ── P66 · WIRING DEL CHAT AL PLANO DE ACCIONES P65 (reutiliza /api/agent/action; cero duplicación) ────
// Frase natural → prepare (preview, NUNCA ejecuta) → «sí, confirma» → confirm (execute+verify) → resultado
// verificado. La pending action vive en la tabla assistant_actions (persistente); el token se re-firma
// server-side desde la fila (el chat es la parte de confianza que posee AGENT_TOOL_SECRET).

const FIELD_LABEL: Record<string, string> = {
  price: 'Precio', phone: 'Teléfono', email: 'Email', title: 'Título', due_date: 'Fecha límite',
  priority: 'Prioridad', status: 'Estado', name: 'Nombre', notes: 'Notas', area: 'Zona',
  stage: 'Etapa', value: 'Valor', date: 'Fecha', start_hour: 'Hora', start_minute: 'Minutos',
  duration: 'Duración (min)', client_name: 'Cliente', location: 'Lugar', type: 'Tipo',
  start_at: 'Comienzo', end_at: 'Fin',
}
// P70 Wave C — etiquetas humanas de los VALORES de enums (sin colisión: los literales difieren por dominio).
const VALUE_LABEL: Record<string, string> = {
  sold: 'Vendido', listed: 'Publicado', rented: 'Alquilado', under_contract: 'Reservado',
  prospecting: 'En preparación', archived: 'Archivado', available: 'Disponible',
  pending: 'Pendiente', done: 'Completada',
  high: 'Alta', normal: 'Normal', low: 'Baja',
  active: 'Activo', lead: 'Lead', inactive: 'Inactivo', churned: 'Perdido',
  open: 'Abierto', documentation_pending: 'Documentación pendiente', in_review: 'En revisión',
  in_follow_up: 'En seguimiento', submitted: 'Presentado', resolved: 'Resuelto', closed: 'Cerrado',
  new: 'Nueva', contacted: 'En gestión', qualified: 'Cualificada', visit_scheduled: 'Visita programada',
  offer: 'Oferta', negotiation: 'Negociación', reserved: 'Reserva', won: 'Ganada', lost: 'Perdida',
  visit: 'Visita', call: 'Llamada', meeting: 'Reunión', 'follow-up': 'Seguimiento',
  signing: 'Firma', valuation: 'Valoración', demo: 'Demo', other: 'Otro',
}

// P70 Wave C — composición de tiempos de calendario en Europe/Madrid (la app escribe SIEMPRE
// start_at/end_at además de date/start_hour/start_minute; las listas filtran por start_at).
function madridOffset(dateIso: string): string {
  const probe = new Date(`${dateIso}T12:00:00Z`)
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'longOffset' })
    .formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00'
  const m = tz.match(/GMT([+-]\d{2}):?(\d{2})?/)
  return m ? `${m[1]}:${m[2] ?? '00'}` : '+01:00'
}
export function composeCalendarTimes(dateIso: string, hour: number, minute: number, durationMin: number): { startAt: string; endAt: string } {
  const off = madridOffset(dateIso)
  const start = new Date(`${dateIso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${off}`)
  const end = new Date(start.getTime() + durationMin * 60_000)
  return { startAt: start.toISOString(), endAt: end.toISOString() }
}
// P69/P70 — nombres humanos de los tipos de automatización: derivados del REGISTRY único (Wave D).
const AUTOMATION_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(AUTOMATION_RULES).map((d) => [d.type, d.label]),
)

// P70 Wave D — resolución de TIPO de automatización desde el lenguaje (vocabulario canónico).
export function detectAutomationType(n: string): string | null {
  if (/\b(auditoria|calidad de (los )?datos|revision de datos)\b/.test(n) && !/\bcartera\b/.test(n)) return 'data_quality_watch'
  if (/\bresumen (ejecutivo )?(diario|del dia)\b/.test(n) || /\bresumen diario\b/.test(n)) return 'daily_executive_brief'
  if (/\bagenda de la manana\b/.test(n) || /\bbrief matinal\b/.test(n)) return 'morning_agenda_brief'
  if (/\btareas vencidas\b/.test(n)) return 'overdue_tasks_watch'
  if (/\bcitas proximas\b/.test(n) || /\baviso de citas\b/.test(n)) return 'upcoming_appointments_watch'
  if (/\b(vencimientos? de tramites|tramites (vencidos|proximos))\b/.test(n)) return 'case_deadline_watch'
  if (/\b(calidad|datos) de (la )?cartera\b/.test(n) || /\bcartera\b.*\bcalidad\b/.test(n)) return 'portfolio_data_quality_watch'
  if (/\b(reconciliacion|operaciones ganadas)\b/.test(n)) return 'won_operation_reconciliation_watch'
  if (/\bacciones fallidas\b/.test(n)) return 'action_failure_watch'
  if (/\boperaciones (sin movimiento|paradas|estancadas)\b/.test(n)) return 'stale_operations_watch'
  if (/\b(clientes inactivos|seguimiento de clientes)\b/.test(n)) return 'inactive_client_followup_watch'
  return null
}

// P70 — Marcadores de flujo de automatización en el hilo. [AUTO:type:hour] = preview de CREACIÓN;
// [AUTOEDIT:ruleId:hash:h<hour>:f<freq>:w<weekday>] = preview de EDICIÓN. cancelled/done neutralizan.
// Un «confirma» actúa SOLO sobre el último marcador VIVO (creación o edición, el más reciente).
export type LiveAutoMarker =
  | { kind: 'create'; type: string; hour: number; minute: number; frequency: 'daily' | 'weekdays' | 'weekly'; weekday?: number }
  | { kind: 'edit'; ruleId: string; hash: string; hour: number; minute: number; frequency: string; weekday?: number }
export function lastLiveAutoMarker(recentContext: string): LiveAutoMarker | null {
  const all = recentContext.match(/\[AUTO(?:EDIT)?:[^\]]{1,120}\]/g)
  const last = all?.length ? all[all.length - 1] : null
  if (!last) return null
  const create = last.match(/^\[AUTO:([a-z_]+):(\d{1,2})(?::m(\d{1,2}))?(?::f(daily|weekdays|weekly))?(?::w(\d))?\]$/)
  if (create) return { kind: 'create', type: create[1], hour: Number(create[2]), minute: create[3] ? Number(create[3]) : 0, frequency: (create[4] ?? 'daily') as 'daily', weekday: create[5] ? Number(create[5]) : undefined }
  const edit = last.match(/^\[AUTOEDIT:([0-9a-f-]{36}):([0-9a-f]{16}):h(\d{1,2})(?::m(\d{1,2}))?:f(daily|weekdays|weekly)(?::w(\d))?\]$/)
  if (edit) return { kind: 'edit', ruleId: edit[1], hash: edit[2], hour: Number(edit[3]), minute: edit[4] ? Number(edit[4]) : 0, frequency: edit[5], weekday: edit[6] ? Number(edit[6]) : undefined }
  return null // cancelled / done / malformado → no hay preview vivo
}
// Compat: preview de creación vivo (usado por la confirmación P69).
export function lastLiveAutoPreview(recentContext: string): { type: string; hour: number } | null {
  const m = lastLiveAutoMarker(recentContext)
  return m && m.kind === 'create' ? { type: m.type, hour: m.hour } : null
}
const fmtVal = (k: string, v: unknown): string => {
  if ((k === 'price' || k === 'value') && typeof v === 'number') return euro(v)
  if (v == null || v === '') return '—'
  // Los ISO internos (start_at/end_at) nunca se muestran crudos: hora local Europe/Madrid.
  if ((k === 'start_at' || k === 'end_at') && /^\d{4}-\d{2}-\d{2}T/.test(String(v))) {
    const d = new Date(String(v))
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }
  return VALUE_LABEL[String(v)] ?? String(v)
}

function actionApiUrl(): string {
  return `${(process.env.AGENT_ACTION_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')}/api/agent/action`
}
// P67 — llamada genérica a los endpoints server-to-server del agente (action | automation).
async function actionApi2(kind: 'action' | 'automation', body: Record<string, unknown>): Promise<{ status: number; json: Row }> {
  const secret = process.env.AGENT_TOOL_SECRET
  if (!secret) return { status: 0, json: { error: 'no_secret' } }
  const base = (process.env.AGENT_ACTION_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  try {
    const r = await fetch(`${base}/api/agent/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': secret }, body: JSON.stringify(body) })
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Row }
  } catch { return { status: 0, json: { error: 'unreachable' } } }
}
async function actionApi(body: Record<string, unknown>): Promise<{ status: number; json: Row }> {
  const secret = process.env.AGENT_TOOL_SECRET
  if (!secret) return { status: 0, json: { error: 'no_secret' } }
  try {
    const r = await fetch(actionApiUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': secret }, body: JSON.stringify(body) })
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Row }
  } catch { return { status: 0, json: { error: 'unreachable' } } }
}

async function latestPendingAction(supabase: SupabaseClient, ws: string): Promise<Row | null> {
  const { data } = await supabase.from('assistant_actions').select('*')
    .eq('workspace_id', ws).eq('status', 'prepared').gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1)
  return (data?.[0] as Row) ?? null
}

function renderPreview(preview: Row): string {
  const current = (preview.current ?? {}) as Row
  const changes = (preview.changes ?? {}) as Row
  const lines = Object.entries(changes).map(([k, v]) => {
    const label = FIELD_LABEL[k] ?? k
    const cur = current[k]
    return cur != null && cur !== '' ? `• ${label}: ${fmtVal(k, cur)} → ${fmtVal(k, v)}` : `• ${label}: ${fmtVal(k, v)}`
  })
  return `Cambio preparado\n${lines.join('\n')}\n\nTodavía no se ha aplicado. ¿Confirmo el cambio? (también puedes decir «cancela»)`
}

async function handleChatAction(supabase: SupabaseClient, ws: string, intent: AssistantActionIntent, conversationId?: string): Promise<LocalAnswer> {
  const T = 'local_action'
  // — CONFIRM / CANCEL / MODIFY / STATUS: exigen pending action válida (si no hay, el caller sigue su flujo) —
  if (intent.act !== 'prepare') {
    const row = await latestPendingAction(supabase, ws)
    if (!row) return { handled: false }
    if (intent.act === 'status') {
      return { handled: true, usedTool: T, entity: 'help', answer: `Tienes un cambio pendiente de confirmar (${getActionDefinition(String(row.action_type))?.description ?? row.action_type}). Di «confirma» para aplicarlo o «cancela» para descartarlo.` }
    }
    if (intent.act === 'cancel') {
      const r = await actionApi({ operation: 'cancel', workspace_id: ws, action_id: row.id })
      return { handled: true, usedTool: T, entity: 'help', answer: r.status === 200 ? 'Hecho, he descartado el cambio pendiente. No se ha aplicado nada.' : 'No he podido cancelar la acción (puede que ya estuviera cerrada).' }
    }
    if (intent.act === 'modify') {
      await actionApi({ operation: 'cancel', workspace_id: ws, action_id: row.id })
      const r = await actionApi({ operation: 'prepare', workspace_id: ws, action_type: row.action_type, entity_id: row.entity_id, proposed_changes: intent.proposedChanges, conversation_id: conversationId })
      if (r.status !== 200) return { handled: true, usedTool: T, entity: 'help', answer: 'No he podido preparar el nuevo cambio. ¿Lo intentamos de nuevo indicando el valor?' }
      return { handled: true, usedTool: T, entity: 'help', answer: renderPreview((r.json.preview ?? {}) as Row) }
    }
    // CONFIRM: re-firmar token desde la fila (server-side) y ejecutar. Nunca reconstruir la acción del texto.
    const secret = process.env.AGENT_TOOL_SECRET
    if (!secret) return { handled: false }
    const token = signActionToken({
      actionId: String(row.id), actionType: String(row.action_type), workspaceId: ws,
      entityId: row.entity_id ? String(row.entity_id) : null,
      previewHash: String(row.preview_hash), idempotencyKey: String(row.idempotency_key), confirmed: true,
    }, secret)
    const r = await actionApi({ operation: 'confirm', workspace_id: ws, action_token: token })
    if (r.status === 200 && (r.json.status === 'completed')) {
      const verified = ((r.json.result as Row | undefined)?.verified ?? {}) as Row
      const lines = Object.entries(verified).map(([k, v]) => `• ${FIELD_LABEL[k] ?? k}: ${fmtVal(k, v)}`)
      const dup = r.json.duplicate === true ? ' (ya estaba aplicado)' : ''
      const ui: AssistantUiPayload = {
        kind: 'action_result',
        action: {
          actionId: String(row.id), actionType: String(row.action_type), status: 'completed',
          title: getActionDefinition(String(row.action_type))?.description ?? 'Cambio aplicado',
          fields: Object.entries(verified).map(([k, v]) => ({ key: k, label: FIELD_LABEL[k] ?? k, proposedValue: fmtVal(k, v) })),
          verified: true, allowedUiActions: ['open_entity'],
        },
      }
      return { handled: true, usedTool: T, entity: 'help', answer: `Cambio aplicado y verificado${dup}\n${lines.join('\n')}\n\nLo he vuelto a consultar en el CRM y ya aparece así.`, ui }
    }
    if (r.json.error === 'ACTION_CONFLICT') {
      return { handled: true, usedTool: T, entity: 'help', answer: 'No he aplicado el cambio: el registro fue modificado después de preparar la acción. Dime si quieres que lo prepare de nuevo con los datos actuales.' }
    }
    if (r.json.error === 'ACTION_EXPIRED') {
      return { handled: true, usedTool: T, entity: 'help', answer: 'La confirmación ha caducado. Pídeme el cambio otra vez y te preparo un preview con los datos actuales.' }
    }
    return { handled: true, usedTool: T, entity: 'help', answer: 'No he podido aplicar el cambio. No se ha modificado nada; puedes pedírmelo de nuevo.' }
  }

  // — PREPARE —
  if (intent.missingFields.length) {
    return { handled: true, usedTool: T, entity: 'help', answer: `Para preparar el cambio necesito: ${intent.missingFields.join(', ')}. Dímelo y te enseño el preview antes de tocar nada.` }
  }
  let entityId: string | null = null
  // ── Cartera (precio, estado, notas, zona) ──
  const PORTFOLIO_ACTIONS = new Set(['portfolio.update_price', 'portfolio.update_status', 'portfolio.update_notes', 'portfolio.update_zone'])
  if (PORTFOLIO_ACTIONS.has(intent.actionType)) {
    const res = await searchProperties(supabase, ws, { query: intent.entityText ?? '', availabilityMode: 'all' })
    if ('error' in res) return fail('properties', T, ws)
    const hits = [...res.exactMatches, ...res.partialMatches]
    if (!hits.length) return { handled: true, usedTool: T, entity: 'properties', answer: `No encuentro ningún inmueble que coincida con «${intent.entityText}».` }
    if (hits.length > 1 && res.exactMatches.length !== 1) {
      return { handled: true, usedTool: T, entity: 'properties', answer: `Hay varios inmuebles que coinciden:\n${hits.slice(0, 4).map((p) => `• ${p.title}`).join('\n')}\n¿Cuál quieres modificar?` }
    }
    entityId = String((res.exactMatches[0] ?? hits[0]).id)
  }
  // ── Tareas PENDIENTES (fecha, completar, prioridad, título) ──
  const PENDING_TASK_ACTIONS = new Set(['tasks.update_due_date', 'tasks.complete', 'tasks.update_priority', 'tasks.update_title'])
  if (PENDING_TASK_ACTIONS.has(intent.actionType)) {
    const res = await getPendingTasks(supabase, ws, {})
    if ('error' in res) return fail('tasks', T, ws)
    const needle = foldText(intent.entityText ?? '')
    const hits = (res.tasks as Array<{ id: string; title: string }>).filter((t) => foldText(t.title).includes(needle))
    if (!hits.length) return { handled: true, usedTool: T, entity: 'tasks', answer: `No encuentro una tarea pendiente que coincida con «${intent.entityText}».` }
    if (hits.length > 1) return { handled: true, usedTool: T, entity: 'tasks', answer: `Hay varias tareas que coinciden:\n${hits.slice(0, 4).map((t) => `• ${t.title}`).join('\n')}\n¿Cuál?` }
    entityId = hits[0].id
  }
  // ── Tareas COMPLETADAS (reabrir): la búsqueda es sobre status=done, no sobre pendientes ──
  if (intent.actionType === 'tasks.reopen') {
    const needle = `%${(intent.entityText ?? '').replace(/[\\%_]/g, '')}%`
    const { data, error } = await supabase.from('tasks').select('id, title')
      .eq('workspace_id', ws).eq('status', 'done').ilike('title', needle).limit(5)
    if (error) return fail('tasks', T, ws)
    const hits = (data ?? []) as Array<{ id: string; title: string }>
    if (!hits.length) return { handled: true, usedTool: T, entity: 'tasks', answer: `No encuentro una tarea completada que coincida con «${intent.entityText}».` }
    if (hits.length > 1) return { handled: true, usedTool: T, entity: 'tasks', answer: `Hay varias tareas completadas que coinciden:\n${hits.slice(0, 4).map((t) => `• ${t.title}`).join('\n')}\n¿Cuál reabro?` }
    entityId = hits[0].id
  }
  // ── Clientes (teléfono, email, nombre, nota, estado) ──
  const CLIENT_ACTIONS = new Set(['clients.update_email', 'clients.update_phone', 'clients.update_name', 'clients.update_note', 'clients.update_status'])
  if (CLIENT_ACTIONS.has(intent.actionType)) {
    const res = await searchClients(supabase, ws, { query: intent.entityText ?? '', limit: 5 })
    if ('error' in res) return fail('clients', T, ws)
    if (!res.results.length) return { handled: true, usedTool: T, entity: 'clients', answer: `No encuentro ningún cliente que coincida con «${intent.entityText}».` }
    if (res.results.length > 1) return { handled: true, usedTool: T, entity: 'clients', answer: `Hay varios clientes que coinciden:\n${res.results.map((c) => `• ${str(c.name)}`).join('\n')}\n¿Cuál quieres modificar?` }
    entityId = String(res.results[0].id)
  }
  // ── Operaciones (etapa, valor): por título; si no, por cliente ──
  if (intent.actionType === 'operations.change_stage' || intent.actionType === 'operations.update_value') {
    const raw = (intent.entityText ?? '').replace(/[\\%_]/g, '').trim()
    let hits: Array<{ id: string; title: string; stage: string }> = []
    if (raw) {
      const { data } = await supabase.from('opportunities').select('id, title, stage')
        .eq('workspace_id', ws).is('deleted_at', null).ilike('title', `%${raw}%`).limit(5)
      hits = (data ?? []) as typeof hits
      if (!hits.length) {
        // «la operación de David» → resolver cliente y buscar sus operaciones.
        const cli = await searchClients(supabase, ws, { query: raw, limit: 3 })
        if (!('error' in cli) && cli.results.length === 1) {
          const { data: byClient } = await supabase.from('opportunities').select('id, title, stage')
            .eq('workspace_id', ws).is('deleted_at', null).eq('client_id', String(cli.results[0].id)).limit(5)
          hits = (byClient ?? []) as typeof hits
        }
      }
    }
    if (!hits.length) return { handled: true, usedTool: T, entity: 'operations', answer: `No encuentro ninguna operación que coincida con «${intent.entityText}».` }
    if (hits.length > 1) return { handled: true, usedTool: T, entity: 'operations', answer: `Hay varias operaciones que coinciden:\n${hits.slice(0, 4).map((o) => `• ${o.title} (${VALUE_LABEL[o.stage] ?? o.stage})`).join('\n')}\n¿Cuál?` }
    entityId = hits[0].id
  }
  // ── Trámites (estado, fecha límite): por título ──
  if (intent.actionType === 'cases.update_status' || intent.actionType === 'cases.update_due_date') {
    const raw = (intent.entityText ?? '').replace(/[\\%_]/g, '').trim()
    const { data, error } = await supabase.from('service_cases').select('id, title, status')
      .eq('workspace_id', ws).is('deleted_at', null).ilike('title', `%${raw}%`).limit(5)
    if (error) return fail('service_cases', T, ws)
    const hits = (data ?? []) as Array<{ id: string; title: string }>
    if (!hits.length) return { handled: true, usedTool: T, entity: 'service_cases', answer: `No encuentro ningún trámite que coincida con «${intent.entityText}».` }
    if (hits.length > 1) return { handled: true, usedTool: T, entity: 'service_cases', answer: `Hay varios trámites que coinciden:\n${hits.slice(0, 4).map((c) => `• ${c.title}`).join('\n')}\n¿Cuál?` }
    entityId = hits[0].id
  }
  // ── Calendario · crear: componer start_at/end_at (Europe/Madrid) desde fecha+hora del parser ──
  if (intent.actionType === 'calendar.create' && !intent.missingFields.length) {
    const c = intent.proposedChanges as Record<string, unknown>
    const t = composeCalendarTimes(String(c.date), Number(c.start_hour), Number(c.start_minute ?? 0), Number(c.duration ?? 60))
    c.start_at = t.startAt
    c.end_at = t.endAt
  }
  // ── Calendario · reprogramar: resolver la cita (próximas, editables) y completar fecha/hora del
  //    estado actual antes de componer start_at/end_at. Eventos de Google (read-only) se excluyen. ──
  if (intent.actionType === 'calendar.reschedule') {
    const raw = (intent.entityText ?? '').replace(/[\\%_]/g, '').trim()
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { data, error } = await supabase.from('calendar_events')
      .select('id, title, client_name, date, start_hour, start_minute, duration, start_at, is_read_only')
      .eq('workspace_id', ws).neq('status', 'cancelled').eq('is_read_only', false)
      .gte('start_at', since).order('start_at', { ascending: true }).limit(25)
    if (error) return fail('calendar', T, ws)
    const needle = foldText(raw)
    const rows = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((e) => !needle || foldText(String(e.title ?? '')).includes(needle) || foldText(String(e.client_name ?? '')).includes(needle))
    if (!rows.length) return { handled: true, usedTool: T, entity: 'calendar', answer: `No encuentro una cita próxima que coincida con «${intent.entityText}».` }
    if (rows.length > 1) return { handled: true, usedTool: T, entity: 'calendar', answer: `Hay varias citas que coinciden:\n${rows.slice(0, 4).map((e) => `• ${e.title} (${String(e.date ?? String(e.start_at ?? '').slice(0, 10))})`).join('\n')}\n¿Cuál reprogramo?` }
    const ev = rows[0]
    entityId = String(ev.id)
    const c = intent.proposedChanges as Record<string, unknown>
    // Derivar la parte no indicada del estado ACTUAL del evento (fecha o hora), en Europe/Madrid.
    const curStart = ev.start_at ? new Date(String(ev.start_at)) : null
    const curDate = String(ev.date ?? (curStart ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(curStart) : ''))
    const curHour = Number(ev.start_hour ?? (curStart ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(curStart)) : 10))
    const curMinute = Number(ev.start_minute ?? (curStart ? curStart.getUTCMinutes() : 0))
    const date = String(c.date ?? curDate)
    const hour = Number(c.start_hour ?? curHour)
    const minute = Number(c.start_minute ?? curMinute)
    const duration = Number(ev.duration ?? 60)
    const t = composeCalendarTimes(date, hour, minute, duration)
    c.date = date; c.start_hour = hour; c.start_minute = minute
    c.start_at = t.startAt; c.end_at = t.endAt
  }
  const r = await actionApi({ operation: 'prepare', workspace_id: ws, action_type: intent.actionType, ...(entityId ? { entity_id: entityId } : {}), proposed_changes: intent.proposedChanges, conversation_id: conversationId })
  if (r.status !== 200) {
    return { handled: true, usedTool: T, entity: 'help', answer: 'No he podido preparar el cambio ahora mismo. No se ha modificado nada.' }
  }
  // P70 Wave A — bloque estructurado para la UI (las tarjetas consumen esto, nunca el texto).
  const prev = (r.json.preview ?? {}) as Row
  const current = (prev.current ?? {}) as Row
  const changes = (prev.changes ?? {}) as Row
  const ui: AssistantUiPayload = {
    kind: 'action_preview',
    action: {
      actionId: String(r.json.action_id ?? ''), actionType: intent.actionType, status: 'prepared',
      title: getActionDefinition(intent.actionType)?.description ?? 'Cambio preparado',
      fields: Object.entries(changes).map(([k, v]) => ({ key: k, label: FIELD_LABEL[k] ?? k, currentValue: current[k] != null && current[k] !== '' ? fmtVal(k, current[k]) : undefined, proposedValue: fmtVal(k, v) })),
      expiresAt: typeof r.json.expires_at === 'string' ? r.json.expires_at : undefined,
      verified: false, allowedUiActions: ['confirm', 'cancel', 'modify'],
    },
  }
  return { handled: true, usedTool: T, entity: 'help', answer: renderPreview(prev), ui }
}

// ── P70 Wave A · UI ACTION por botón (Confirmar/Cancelar con actionId; el server resuelve TODO) ───────
// El navegador solo envía uiAction+actionId. Aquí se carga la fila real (RLS/workspace), se re-firma el
// token server-side y se reutiliza el plano P65. Nunca se aceptan proposedChanges/entidad del cliente.
export async function executeUiAction(
  supabase: SupabaseClient, ws: string, uiAction: 'confirm' | 'cancel', actionId: string,
): Promise<LocalAnswer> {
  const T = 'local_ui_action'
  const { data: row } = await supabase.from('assistant_actions').select('*')
    .eq('workspace_id', ws).eq('id', actionId).maybeSingle()
  if (!row) return { handled: true, usedTool: T, entity: 'help', answer: 'No encuentro ese cambio (puede ser de otro espacio o haber caducado).' }
  const secret = process.env.AGENT_TOOL_SECRET
  if (!secret) return { handled: true, usedTool: T, entity: 'help', answer: 'No puedo procesar la acción ahora mismo.' }
  if (uiAction === 'cancel') {
    const r = await actionApi({ operation: 'cancel', workspace_id: ws, action_id: actionId })
    const ok = r.status === 200
    const ui: AssistantUiPayload = { kind: 'action_status', action: { actionId, actionType: String(row.action_type), status: ok ? 'cancelled' : 'failed', title: getActionDefinition(String(row.action_type))?.description ?? 'Cambio', fields: [], verified: false, allowedUiActions: [] } }
    return { handled: true, usedTool: T, entity: 'help', answer: ok ? 'Cambio descartado. No se ha aplicado nada.' : 'No he podido cancelarlo (puede que ya estuviera cerrado).', ui }
  }
  const token = signActionToken({
    actionId, actionType: String(row.action_type), workspaceId: ws,
    entityId: row.entity_id ? String(row.entity_id) : null,
    previewHash: String(row.preview_hash), idempotencyKey: String(row.idempotency_key), confirmed: true,
  }, secret)
  const r = await actionApi({ operation: 'confirm', workspace_id: ws, action_token: token })
  if (r.status === 200 && r.json.status === 'completed') {
    const verified = ((r.json.result as Row | undefined)?.verified ?? {}) as Row
    const lines = Object.entries(verified).map(([k, v]) => `• ${FIELD_LABEL[k] ?? k}: ${fmtVal(k, v)}`)
    const ui: AssistantUiPayload = { kind: 'action_result', action: { actionId, actionType: String(row.action_type), status: 'completed', title: getActionDefinition(String(row.action_type))?.description ?? 'Cambio aplicado', fields: Object.entries(verified).map(([k, v]) => ({ key: k, label: FIELD_LABEL[k] ?? k, proposedValue: fmtVal(k, v) })), verified: true, allowedUiActions: [] } }
    return { handled: true, usedTool: T, entity: 'help', answer: `Cambio aplicado y verificado${r.json.duplicate === true ? ' (ya estaba aplicado)' : ''}\n${lines.join('\n')}`, ui }
  }
  const code = String(r.json.error ?? '')
  const msg = code === 'ACTION_CONFLICT' ? 'No lo he aplicado: el registro cambió después del preview. Pídeme el cambio de nuevo.'
    : code === 'ACTION_EXPIRED' ? 'La confirmación ha caducado. Pídeme el cambio otra vez.'
      : code === 'ACTION_CANCELLED' ? 'Ese cambio estaba cancelado; no se ha aplicado.'
        : 'No he podido aplicar el cambio. No se ha modificado nada.'
  const ui: AssistantUiPayload = { kind: 'action_status', action: { actionId, actionType: String(row.action_type), status: code === 'ACTION_CONFLICT' ? 'conflict' : code === 'ACTION_EXPIRED' ? 'expired' : code === 'ACTION_CANCELLED' ? 'cancelled' : 'failed', title: getActionDefinition(String(row.action_type))?.description ?? 'Cambio', fields: [], verified: false, allowedUiActions: [], safeErrorCode: code || undefined } }
  return { handled: true, usedTool: T, entity: 'help', answer: msg, ui }
}

// ── P70 Wave D · Preview de CREACIÓN de automatización (opt-in; compartido entre el atajo pre-ventas
//    y el flujo estándar). Solo construye el preview: NADA se crea sin confirmación. ──────────────────
export function handleAutomationCreatePreview(nmsg: string): LocalAnswer | null {
  const type = detectAutomationType(nmsg)
  if (!type) return null
  const def = AUTOMATION_RULES[type as keyof typeof AUTOMATION_RULES]
  const t = parseTimeEs(nmsg)
  const weeklyDay = nmsg.match(/\btodos los (lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)\b/)?.[1] ?? null
  const WD: Record<string, number> = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sabados: 6, domingo: 7, domingos: 7 }
  const frequency = weeklyDay ? 'weekly' as const : /\blunes a viernes\b|\bentre semana\b/.test(nmsg) ? 'weekdays' as const : 'daily' as const
  const hour = t ? t.hour : def.defaultHour
  const minute = t ? t.minute : 0
  const weekday = weeklyDay ? (WD[weeklyDay] ?? 1) : undefined
  const schPrev: ScheduleJson = { frequency, hour, ...(minute ? { minute } : {}), ...(frequency === 'weekly' ? { weekday: weekday ?? 1 } : {}) }
  const schLabel = scheduleLabelOf(schPrev)
  const marker = `[AUTO:${type}:${hour}${minute ? `:m${minute}` : ''}${frequency !== 'daily' ? `:f${frequency}` : ''}${frequency === 'weekly' ? `:w${weekday ?? 1}` : ''}]`
  const ui: AssistantUiPayload = { kind: 'automation_preview', automation: { type, name: def.label, status: 'awaiting_confirmation', scheduleLabel: schLabel, timezone: 'Europe/Madrid', allowedUiActions: ['confirm', 'cancel'] } }
  return { handled: true, usedTool: 'local_automation:preview', entity: 'help', answer: `Automatización preparada\n• Tipo: ${def.label}\n• Qué vigila: ${def.criterion}\n• Horario: ${schLabel} (Europe/Madrid)\n• Resultado: incidencias/resumen internos en el CRM (sin emails ni mensajes externos)\n\nAún no está activada. ¿Confirmo la activación? ${marker}`, ui }
}

// ── P64 · RESUMEN EJECUTIVO multi-fuente (Cartera + Operaciones + Agenda + Tareas + Trámites) ─────────
// Datos VIVOS de todas las fuentes autorizadas, en paralelo, con degradación parcial (una fuente caída no
// tumba el resumen). Sin Facturación. Cada cifra procede de un reader real; prioridades = reglas objetivas.
async function handleExecutiveSummary(supabase: SupabaseClient, ws: string): Promise<LocalAnswer> {
  const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p } catch { return null } }
  const [props, ops, cal, tsk, cases] = await Promise.all([
    safe(crmReadQuery(supabase, ws, { entity: 'properties', limit: 200 })),
    safe(crmReadQuery(supabase, ws, { entity: 'opportunities', limit: 200 })),
    safe(getCalendarSummary(supabase, ws, {})),
    safe(getPendingTasks(supabase, ws, {})),
    safe(crmReadQuery(supabase, ws, { entity: 'service_cases', limit: 100 })),
  ])
  const blocks: string[] = ['Resumen ejecutivo (datos consultados ahora mismo):']
  let anyOk = false
  // Cartera
  if (props && !('error' in props)) {
    anyOk = true
    const rows = props.rows as Row[]
    const by: Record<string, number> = {}
    for (const p of rows) { const l = normalizePropertyState(p.status).labelEs; by[l] = (by[l] ?? 0) + 1 }
    blocks.push(`• Cartera: ${rows.length} inmuebles (${Object.entries(by).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') || 'sin inmuebles'}).`)
  } else blocks.push('• Cartera: no disponible ahora mismo.')
  // Operaciones
  if (ops && !('error' in ops)) {
    anyOk = true
    const rows = ops.rows as Row[]
    const won = rows.filter((o) => str(o.stage) === 'won').length
    const lost = rows.filter((o) => str(o.stage) === 'lost').length
    const open = rows.length - won - lost
    blocks.push(`• Operaciones: ${rows.length} en total — ${open} abiertas, ${won} ganadas, ${lost} perdidas.`)
  } else blocks.push('• Operaciones: no disponibles ahora mismo.')
  // Agenda
  if (cal && !('error' in cal)) { anyOk = true; blocks.push(`• Citas próximas: ${cal.events.length}.`) } else blocks.push('• Citas: no disponibles.')
  let overdueN = 0
  if (tsk && !('error' in tsk)) {
    anyOk = true
    overdueN = (tsk.tasks as Array<{ due_date: string | null; status: string | null }>).filter((t) => isOverdueTask(t.due_date, t.status)).length
    blocks.push(`• Tareas pendientes: ${tsk.tasks.length}${overdueN ? ` (${overdueN} vencidas)` : ''}.`)
  } else blocks.push('• Tareas: no disponibles.')
  // Trámites
  if (cases && !('error' in cases)) {
    anyOk = true
    const rows = cases.rows as Row[]
    const openC = rows.filter((c) => !/closed|done|resuelto|cerrado/i.test(str(c.status))).length
    blocks.push(`• Trámites: ${rows.length} (${openC} abiertos).`)
  } else blocks.push('• Trámites: no disponibles.')
  if (!anyOk) return fail('operations', 'local_exec_summary', ws)
  // Prioridades objetivas (solo hechos leídos arriba).
  const prios: string[] = []
  if (overdueN) prios.push(`revisar las ${overdueN} tareas vencidas`)
  if (cal && !('error' in cal) && cal.events.length) prios.push('preparar las citas próximas')
  if (prios.length) blocks.push(`Sugerencia (basada en lo anterior): ${prios.join(' y ')}.`)
  return { handled: true, usedTool: 'local_exec_summary', entity: 'operations', answer: blocks.join('\n') }
}

// ── P62 · OFERTAS Y ACEPTACIÓN («ofréceme algo» → oferta; «sí/venga/muéstramela» → ejecutar) ─────────
// El estado de la oferta se deriva del propio texto del asistente en el hilo (marcadores estables), sin
// canal nuevo. Una aceptación NUNCA vuelve a explicar la pantalla ni cae a n8n sin plan: ejecuta la
// lectura ofrecida o hace UNA aclaración concreta.

export function detectOfferRequest(message: string): boolean {
  const n = foldText(message)
  return /\b(ofreceme|ofrece algo|proponme|propon algo|sugiereme|sugiere algo|recomiendame|que (hacemos|podemos hacer|me recomiendas|me ofreces|me propones)|dame (opciones|ideas)|a que podemos)\b/.test(n)
}

export function suggestionsAnswer(): string {
  return [
    'Te propongo tres cosas que puedo mirarte ahora mismo:',
    '• La cartera activa (tus inmuebles y su estado).',
    '• Las operaciones abiertas (tu pipeline).',
    '• Las citas próximas del calendario.',
    '¿Cuál te muestro?',
  ].join('\n')
}

// Aceptación breve («sí», «vale», «venga va», «muéstramela», «dale», «a ver») — solo mensajes cortos.
export function detectAcceptance(message: string): { fem: boolean; sing: boolean } | null {
  const n = foldText(message).replace(/[¿?¡!.,;:]/g, ' ').trim()
  const words = n.split(/\s+/).filter(Boolean)
  if (words.length > 7) return null
  if (!/^(si|vale|venga( va)?|ok|okey|okay|dale|claro( que si)?|hazlo|adelante|va|perfecto|genial|por favor|muestramel[oa]|ensenamel[oa]|a ver)\b/.test(n)) return null
  // No es aceptación si pide explicación u otra cosa explícita («sí explícame», «sí pero cuéntame»).
  if (/\b(explica|explicame|como funciona|que es|no\b)\b/.test(n)) return null
  const fem = /\bmuestramela|ensenamela|la\b/.test(n) && !/\blo\b/.test(n)
  const sing = /muestramela|ensenamela|esa\b|la primera\b/.test(n)
  return { fem, sing }
}

// Resuelve QUÉ se ofreció: busca la ÚLTIMA línea del hilo con marcador de oferta y extrae los módulos de
// esa línea o de las líneas anteriores del mismo mensaje del asistente.
const OFFER_MARKER = /(quieres que te muestre|quieres que te liste|puedo mostrarte|te propongo|cual te muestro|quieres que revise|te muestro)/
export function resolveOfferedModules(recentContext: string): ReturnType<typeof resolveModuleFromText>[] {
  // Limpia prefijos de hablante para que «asistente:» no se resuelva como módulo Asistente.
  const lines = recentContext.split('\n')
    .map((l) => l.trim().replace(/^(usuario|asistente|user|assistant)\s*:\s*/i, ''))
    .filter(Boolean)
  let offerIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (OFFER_MARKER.test(foldText(lines[i]))) { offerIdx = i; break }
  }
  if (offerIdx === -1) return []
  const mods: ReturnType<typeof resolveModuleFromText>[] = []
  const push = (l: string) => { const m = resolveModuleFromText(l); if (m && !mods.includes(m)) mods.push(m) }
  push(lines[offerIdx])
  // Hacia atrás SOLO dentro del mismo mensaje del asistente: bullets («•»), numeradas o cabecera («**…»).
  // Al encontrar una línea de otro formato (p. ej. el mensaje del usuario) se corta — así una oferta de
  // Calendario no absorbe la Cartera de un mensaje anterior.
  // Cabecera de explicación de módulo: «**Calendario** — …» o, tras el sanitizador P64 (sin asteriscos),
  // «Calendario — …». Ese módulo manda EN EXCLUSIVA (las líneas internas mencionan otros de pasada).
  const isHeader = (l: string) => /^(\*\*)?[A-ZÁÉÍÓÚÑ]/.test(l) && / — /.test(l) && resolveModuleFromText(l.split(' — ')[0]) !== null
  for (let i = offerIdx - 1; i >= Math.max(0, offerIdx - 8); i--) {
    const l = lines[i]
    if (isHeader(l)) {
      const header = resolveModuleFromText(l.split(' — ')[0])
      if (header) return [header]
    }
    if (!/^([•\-\d]|\*\*|\d+\.)/.test(l)) break
    push(l)
  }
  return mods
}

// Ejecuta la lectura ofrecida para un módulo (siempre EN VIVO).
async function executeOfferedModule(supabase: SupabaseClient, ws: string, mod: NonNullable<ReturnType<typeof resolveModuleFromText>>): Promise<LocalAnswer> {
  switch (mod) {
    case 'portfolio': return handlePortfolioSummary(supabase, ws)
    case 'calendar': return handleAgenda(supabase, ws, { calendar: true, tasks: false })
    case 'tasks': return handleAgenda(supabase, ws, { calendar: false, tasks: true })
    case 'dashboard': return handleAgenda(supabase, ws, { calendar: true, tasks: true })
    case 'clients': return handleClients(supabase, ws, classifyIntent('muéstrame los clientes'))
    case 'operations':
      return handleList(supabase, ws, 'operations', 'local_operations',
        async () => { const r = await crmReadQuery(supabase, ws, { entity: 'opportunities', limit: 10 }); return 'error' in r ? { error: true } : { rows: r.rows } },
        formatOperationLine, 'operación', 'operaciones')
    case 'cases':
      return handleList(supabase, ws, 'service_cases', 'local_cases',
        async () => { const r = await crmReadQuery(supabase, ws, { entity: 'service_cases', limit: 10 }); return 'error' in r ? { error: true } : { rows: r.rows } },
        formatCaseLine, 'trámite', 'trámites')
    default: return handlePortfolioSummary(supabase, ws)
  }
}

// ── P61 · AGENDA combinada (citas + tareas) con respuesta ANSWER-FIRST (sí/no) y multi-fuente ─────────
// «¿tengo citas o tareas?», «¿qué tengo pendiente/próximo?», «¿tengo algo en el calendario?». Consulta las
// DOS fuentes reales (calendar_events + tasks, tablas distintas), responde sí/no por cada una y nunca
// convierte un vacío en «no hay nada en el CRM».
async function handleAgenda(supabase: SupabaseClient, ws: string, want: { calendar: boolean; tasks: boolean }, opts: { scope?: TemporalScope | null; turnId?: string } = {}): Promise<LocalAnswer> {
  // P71·It2 — alcance temporal opcional: si viene, la consulta a BD se acota a [start, end] (Europe/Madrid)
  // y la respuesta menciona el periodo. Sin alcance, comportamiento previo (desde hoy, ~2 semanas).
  const scope = opts.scope && opts.scope.start && opts.scope.end ? opts.scope : null
  let calN: number | null = null, calRows: Row[] = [], calErr = false
  let taskN: number | null = null, taskRows: Row[] = [], taskErr = false
  if (want.calendar) {
    const r = await getCalendarSummary(supabase, ws, scope ? { from: scope.start, to: scope.end, limit: 50 } : {})
    if ('error' in r) calErr = true; else { calRows = r.events as unknown as Row[]; calN = calRows.length }
  }
  if (want.tasks) {
    const r = await getPendingTasks(supabase, ws, {})
    if ('error' in r) taskErr = true
    else {
      taskRows = r.tasks as unknown as Row[]
      // Acotar tareas por fecha límite dentro del periodo (freshness: se filtra sobre datos ACTUALES).
      if (scope) taskRows = taskRows.filter((t) => { const d = str(t.due_date).slice(0, 10); return d && d >= scope.start! && d <= scope.end! })
      taskN = taskRows.length
    }
  }
  // Fallback parcial: solo error si TODO lo pedido falló.
  if ((want.calendar && calErr && (!want.tasks || taskErr)) && (want.tasks ? taskErr : true) && !(want.calendar && !calErr) && !(want.tasks && !taskErr)) {
    return fail('calendar', 'local_agenda', ws)
  }
  const periodo = scope ? ` para ${formatScopeLabel(scope)}` : ' próximas'
  const periodoT = scope ? ` con fecha en ${formatScopeLabel(scope)}` : ' pendientes'
  const lines: string[] = []
  if (want.calendar) {
    lines.push(calErr ? '• Citas: no he podido consultarlas ahora mismo.'
      : calN ? `• Citas${periodo}: **sí**, tienes ${calN}.` : `• Citas${periodo}: **no**, no tienes ninguna${scope ? '' : ' registrada de aquí en adelante'}.`)
  }
  if (want.tasks) {
    lines.push(taskErr ? '• Tareas: no he podido consultarlas ahora mismo.'
      : taskN ? `• Tareas${periodoT}: **sí**, tienes ${taskN}.` : `• Tareas${periodoT}: **no**, no tienes ninguna.`)
  }
  const detail: string[] = []
  if (want.calendar && calN) detail.push(...calRows.slice(0, 5).map(formatEventLine))
  if (want.tasks && taskN) detail.push(...taskRows.slice(0, 5).map(formatTaskLine))
  const both = want.calendar && want.tasks
  const head = both ? 'Te lo dejo claro, mirando calendario y tareas:' : ''
  const answer = [head, lines.join('\n'), detail.length ? '\n' + detail.join('\n') : ''].filter(Boolean).join('\n')
  // P71·It2 — persistir módulo temporal + alcance (para continuar «¿y la siguiente?») + última consulta viva.
  const primaryType: ConvEntityType = want.tasks && !want.calendar ? 'task' : 'calendar_event'
  const primaryModule = want.tasks && !want.calendar ? 'tasks' : 'calendar'
  const primaryRows = want.tasks && !want.calendar ? taskRows : calRows
  const stateUpdate: StateUpdate = {
    resolvedModule: primaryModule,
    temporalScopeUpdate: scope ?? null,
    lastDataQueryUpdate: { module: primaryModule, capability: 'local_agenda', entityType: primaryType, resultRefs: toResultRefs(primaryType, primaryRows), executedAt: new Date().toISOString() },
  }
  return { handled: true, usedTool: 'local_agenda', entity: want.tasks && !want.calendar ? 'tasks' : 'calendar', answer, referencedList: detail.length ? [...calRows.slice(0, 5), ...taskRows.slice(0, 5)] : undefined, stateUpdate }
}

// ── P61 · Resumen con DATOS de Cartera (conteo por estado, en vivo) ───────────────────────────────────
async function handlePortfolioSummary(supabase: SupabaseClient, ws: string): Promise<LocalAnswer> {
  const r = await crmReadQuery(supabase, ws, { entity: 'properties', limit: 200 })
  if ('error' in r) return fail('properties', 'local_portfolio_summary', ws)
  const rows = r.rows as Row[]
  if (!rows.length) return { handled: true, usedTool: 'local_portfolio_summary', entity: 'properties', answer: 'Tu cartera está vacía por ahora: no hay inmuebles registrados. Cuando añadas alguno, te lo resumo aquí.' }
  const by: Record<string, number> = {}
  for (const p of rows) { const l = normalizePropertyState(p.status).labelEs; by[l] = (by[l] ?? 0) + 1 }
  const parts = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `• ${k}: ${v}`)
  const head = `Tu cartera tiene **${rows.length}** ${rows.length === 1 ? 'inmueble' : 'inmuebles'} en total:`
  return { handled: true, usedTool: 'local_portfolio_summary', entity: 'properties', answer: `${head}\n${parts.join('\n')}\n\n${followUpCTA.properties}`, referencedList: rows.slice(0, 6) }
}

// ── P61 · Ficha (detalle) de cliente con DEGRADACIÓN PARCIAL: core primero, secciones opcionales aparte ─
async function handleClientDetail(supabase: SupabaseClient, ws: string, name: string): Promise<LocalAnswer> {
  const found = await searchClients(supabase, ws, { query: name, limit: 5 })
  if ('error' in found) return found.error === 'invalid_input' ? { handled: false } : fail('clients', 'local_client_detail', ws)
  if (!found.results.length) return { handled: true, usedTool: 'local_client_detail', entity: 'clients', answer: `No encuentro ningún cliente que coincida con «${name}». ¿Quieres que te liste todos los clientes?` }
  if (found.results.length > 1) {
    const names = found.results.map((c) => `• ${str(c.name)}`).join('\n')
    return { handled: true, usedTool: 'local_client_detail', entity: 'clients', answer: `Hay varios clientes que coinciden con «${name}»:\n${names}\n¿De cuál quieres la ficha?` }
  }
  const target = found.results[0] as Row
  const cid = str(target.id)
  const r = await getClient360(supabase, ws, { clientId: cid })
  if ('error' in r) {
    // El core no se pudo leer: mostramos al menos la tarjeta que ya teníamos (nunca «no tengo acceso»).
    return { handled: true, usedTool: 'local_client_detail', entity: 'clients', answer: `Ficha de ${str(target.name)}:\n${formatClientLine(target)}\n(No he podido cargar el resto de la ficha ahora mismo.)`, referencedList: [target] }
  }
  const c = r.client
  const core = [
    `**Ficha de ${c.name}**`,
    [c.company, c.email, c.phone].filter(Boolean).join(' · ') || null,
    c.status ? `Estado: ${cap(c.status)}` : null,
    c.notes ? `Notas: ${c.notes}` : null,
  ].filter(Boolean)
  // P64 — VERDAD TEMPORAL en la ficha: una cita pasada NUNCA se presenta como próxima; una tarea
  // completada NUNCA como pendiente/vencida (evidencia del incidente: cita 24/06 mostrada como próxima).
  const pendingTasks = r.tasks.filter((t) => isPendingTask(t.status))
  const overdue = r.tasks.filter((t) => isOverdueTask(t.due_date, t.status))
  const doneTasks = r.tasks.length - pendingTasks.length
  const upcomingEv = r.calendarEvents.filter((e) => isUpcoming(e.date ?? e.start_at, e.status))
  const pastEv = r.calendarEvents.filter((e) => isPast(e.date ?? e.start_at) && String(e.status ?? '').toLowerCase() !== 'cancelled')
  const sections: string[] = []
  sections.push(pendingTasks.length
    ? `• Tareas pendientes: ${pendingTasks.length}${overdue.length ? ` (${overdue.length} vencida${overdue.length === 1 ? '' : 's'})` : ''}${doneTasks ? ` · completadas: ${doneTasks}` : ''}`
    : `• Tareas pendientes: ninguna${doneTasks ? ` (completadas: ${doneTasks})` : ''}`)
  sections.push(upcomingEv.length
    ? `• Citas próximas: ${upcomingEv.length}${pastEv.length ? ` · pasadas: ${pastEv.length}` : ''}`
    : `• Citas próximas: ninguna${pastEv.length ? ` (pasadas: ${pastEv.length})` : ''}`)
  sections.push(r.documents.length ? `• Documentos: ${r.documents.length}` : '• Documentos: ninguno')
  sections.push(r.activity.length ? `• Actividad reciente: ${r.activity.length} eventos` : '• Actividad reciente: sin registros')
  return { handled: true, usedTool: 'local_client_detail', entity: 'clients', answer: `${core.join('\n')}\n${sections.join('\n')}`, referencedList: [target] }
}

// ── P58 · VENTAS/VENDIDOS transversal (Cartera + Operaciones) con fallback PARCIAL ───────────────────
async function handleSales(supabase: SupabaseClient, ws: string, intent: SalesQueryIntent): Promise<LocalAnswer> {
  // Explicación (diferencia inmueble vendido vs operación cerrada): NO lee datos.
  if (intent.asksExplanation) {
    return { handled: true, usedTool: 'local_sales:explain', entity: 'operations', answer: SALES_DIFFERENCE_EXPLANATION }
  }
  const wantPortfolio = intent.scope === 'portfolio_only' || intent.scope === 'both'
  const wantOps = intent.scope === 'operations_only' || intent.scope === 'both'

  // Lecturas VIVAS (crmReadQuery = endpoint/reader real, RLS del usuario; nunca lastResults).
  let sold: Row[] | null = null, rented: Row[] | null = null, portfolioErr = false
  if (wantPortfolio) {
    const r = await crmReadQuery(supabase, ws, { entity: 'properties', limit: 100 })
    if ('error' in r) portfolioErr = true
    else { const rows = r.rows as Row[]; sold = rows.filter((p) => matchesStatusIntent(p.status, 'sold')); rented = rows.filter((p) => matchesStatusIntent(p.status, 'rented')) }
  }
  let won: Row[] | null = null, opsErr = false
  if (wantOps) {
    const r = await crmReadQuery(supabase, ws, { entity: 'opportunities', limit: 100, filters: { stage: 'won' } })
    if ('error' in r) opsErr = true
    else won = r.rows as Row[]
  }

  // Fallback PARCIAL: solo si TODAS las fuentes pedidas fallaron devolvemos error; si una responde,
  // damos la parcial (nunca el «fallo temporal total» del transcript cuando una fuente sí funciona).
  const anyOk = (wantPortfolio && !portfolioErr) || (wantOps && !opsErr)
  if (!anyOk) return fail(wantOps ? 'operations' : 'properties', 'local_sales', ws)

  const parts: string[] = []
  const refs: Row[] = []
  const n = (arr: Row[] | null) => (arr ? arr.length : 0)

  // — Cartera —
  if (wantPortfolio) {
    if (portfolioErr) parts.push('• Cartera: no he podido consultarla ahora mismo (puedes pedirme «mira otra vez»).')
    else if (intent.operationType === 'rent') {
      parts.push(`• Cartera: **${n(rented)}** ${n(rented) === 1 ? 'inmueble alquilado' : 'inmuebles alquilados'}.`)
      if (rented) refs.push(...rented.slice(0, 6))
    } else {
      const extra = n(rented) ? ` (y ${n(rented)} ${n(rented) === 1 ? 'alquilado' : 'alquilados'})` : ''
      parts.push(`• Cartera: **${n(sold)}** ${n(sold) === 1 ? 'inmueble con estado Vendido' : 'inmuebles con estado Vendido'}${extra}.`)
      if (sold) refs.push(...sold.slice(0, 6))
    }
  }
  // — Operaciones —
  if (wantOps) {
    if (opsErr) parts.push('• Operaciones: no he podido consultarlas ahora mismo (puedes pedirme «mira otra vez»).')
    else parts.push(`• Operaciones: **${n(won)}** ${n(won) === 1 ? 'operación ganada' : 'operaciones ganadas'} (cerradas con éxito).`)
  }

  // Listado concreto si lo pidió y hay inmuebles vendidos/alquilados (los ítems «listables»).
  const listBlock = intent.asksList && refs.length
    ? '\n' + refs.map((p) => `${formatPropertyLine(p)} · ${normalizePropertyState(p.status).labelEs}`).join('\n')
    : ''

  // Cabecera según el acto (sí/no, cuenta, resumen), honesta cuando todo es 0.
  const totalSold = n(sold), totalWon = n(won), totalRented = n(rented)
  const nothing = (!wantPortfolio || (totalSold === 0 && totalRented === 0)) && (!wantOps || totalWon === 0) && !portfolioErr && !opsErr
  let head: string
  if (nothing) {
    head = intent.scope === 'operations_only'
      ? 'No veo operaciones ganadas (cerradas) todavía.'
      : intent.scope === 'portfolio_only'
        ? `No veo inmuebles ${intent.operationType === 'rent' ? 'alquilados' : 'con estado Vendido'} en tu cartera.`
        : 'De momento no consta nada vendido: ni inmuebles en estado Vendido ni operaciones ganadas.'
    return { handled: true, usedTool: 'local_sales', entity: 'operations', answer: `${head} ¿Quieres que revise los inmuebles disponibles o las operaciones abiertas?` }
  }
  head = intent.scope === 'both'
    ? '«Vendido» puede referirse a dos cosas y te doy las dos:'
    : intent.scope === 'operations_only'
      ? 'En Operaciones:' : 'En tu cartera:'
  const cta = intent.scope === 'both' ? '\n\n¿Quieres que te liste los inmuebles vendidos o las operaciones ganadas?' : `\n\n${followUpCTA.properties ?? ''}`.trimEnd()
  return { handled: true, usedTool: 'local_sales', entity: intent.scope === 'operations_only' ? 'operations' : 'properties', answer: `${head}\n${parts.join('\n')}${listBlock}${cta}`, referencedList: refs.length ? refs : undefined }
}

// ── Punto de entrada ─────────────────────────────────────────────────────────
// P64 — SANITIZADOR de respuesta visible: sin dobles asteriscos (markdown crudo en el chat). Se aplica a
// TODA respuesta local en un único punto; los generadores internos pueden seguir usando **…** como énfasis.
// ── P71 · MAPEOS entidad↔tipo↔módulo + construcción de referencias ligeras (ids, no datos) ────────────
const ENTITY_TO_CONV: Partial<Record<CrmEntity, ConvEntityType>> = {
  clients: 'client', properties: 'property', operations: 'opportunity',
  calendar: 'calendar_event', tasks: 'task', service_cases: 'service_case', documents: 'document',
}
const ENTITY_TO_MODULE: Partial<Record<CrmEntity, string>> = {
  clients: 'clients', properties: 'portfolio', operations: 'operations',
  calendar: 'calendar', tasks: 'tasks', service_cases: 'cases', documents: 'documents', commissions: 'commissions',
}
function refSortValue(entityType: ConvEntityType | null, row: Row): number | undefined {
  if (entityType === 'property') return numOrNull(row.price) ?? undefined
  if (entityType === 'opportunity') return numOrNull(row.value) ?? undefined
  const d = str(row.start_at) || str(row.date) || str(row.due_date) || str(row.created_at)
  return d ? Date.parse(d) || undefined : undefined
}
function toResultRefs(entityType: ConvEntityType | null, list: Array<Record<string, unknown>>): Array<{ entityId: string; label: string; sortValue?: number }> {
  const out: Array<{ entityId: string; label: string; sortValue?: number }> = []
  for (const row of list.slice(0, 25)) {
    const id = str(row.id)
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue
    const label = str(row.title) || str(row.name) || str(row.file_name) || 'elemento'
    const sv = refSortValue(entityType, row)
    out.push({ entityId: id, label, ...(sv !== undefined ? { sortValue: sv } : {}) })
  }
  return out
}

// Enriquecer el stateUpdate de CUALQUIER lectura con la última consulta (referencias ligeras) + módulo.
// Si el handler ya emitió stateUpdate (p. ej. contextual), se respeta y solo se completa lo que falte.
function enrichReadStateUpdate(r: Extract<LocalAnswer, { handled: true }>, message: string, turnId: string): Extract<LocalAnswer, { handled: true }> {
  const convType = ENTITY_TO_CONV[r.entity] ?? null
  const moduleId = ENTITY_TO_MODULE[r.entity] ?? null
  const isRead = r.usedTool.startsWith('local_') && !r.usedTool.startsWith('local_turn') && !r.usedTool.startsWith('local_automation') && !r.usedTool.startsWith('local_action') && !r.usedTool.startsWith('local_ui_action')
  const base: StateUpdate = r.stateUpdate ?? {}
  const update: StateUpdate = { ...base }
  if (update.resolvedModule === undefined && moduleId) update.resolvedModule = moduleId
  // Entidad activa: una lectura que resuelve UNA sola entidad la deja disponible para el siguiente turno
  // («busca X» / ficha / búsqueda con 1 resultado). Un listado con varias NO fija entidad activa.
  if (update.resolvedEntities === undefined && isRead && convType && r.referencedList && r.referencedList.length === 1) {
    const row = r.referencedList[0]
    const id = str(row.id)
    if (/^[0-9a-f-]{36}$/i.test(id)) update.resolvedEntities = [{ entityType: convType, entityId: id, displayLabel: str(row.name) || str(row.title) || '', confidence: 0.8, sourceTurnId: turnId }]
  }
  // Última consulta: CUALQUIER lectura (incluso un conteo sin lista) → permite «otra vez» (grounding);
  // los ordinales/extremos requieren además resultRefs (que solo existen si hubo lista).
  if (update.lastDataQueryUpdate === undefined && isRead && moduleId) {
    update.lastDataQueryUpdate = { module: moduleId, capability: r.usedTool, entityType: convType, resultRefs: r.referencedList ? toResultRefs(convType, r.referencedList) : [], executedAt: new Date().toISOString() }
  }
  if (update.lastAssistantResultUpdate === undefined) {
    const type: 'explanation' | 'read' | 'action' | 'automation' = r.usedTool.startsWith('local_turn') ? 'explanation' : r.usedTool.startsWith('local_automation') ? 'automation' : r.usedTool.startsWith('local_action') || r.usedTool.startsWith('local_ui_action') ? 'action' : 'read'
    update.lastAssistantResultUpdate = { type, module: moduleId, capability: r.usedTool, entityIds: (update.resolvedEntities ?? []).map((e) => e.entityId), turnId }
  }
  return { ...r, stateUpdate: update }
}

// ── P71·F3.1 · ENTIDAD EXPLÍCITA por CANDIDATOS REALES del workspace ──────────────────────────────────
// La regex solo EXTRAE spans de nombre propio (secuencias Capitalizadas, sin palabras funcionales/de módulo/
// temporales); la DECISIÓN es siempre de los datos: searchClients + desambiguación. Nunca elige en silencio.
const NAME_SPAN_STOP: ReadonlySet<string> = new Set([
  // interrogativos / imperativos de lectura frecuentes (arranque de frase capitalizado)
  'que', 'cual', 'cuales', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'como', 'cuando', 'donde', 'quien', 'quienes',
  'dame', 'dime', 'muestrame', 'muestra', 'ensename', 'lista', 'listame', 'abre', 'busca', 'buscame', 'ver',
  'hola', 'buenas', 'buenos', 'oye', 'mira', 'vale', 'ok', 'gracias', 'quiero', 'necesito', 'puedes', 'tengo',
  // funcionales / conectores
  'el', 'la', 'los', 'las', 'un', 'una', 'este', 'esta', 'ese', 'esa', 'y', 'o', 'de', 'del', 'para', 'por', 'con', 'sin', 'pero', 'si', 'no',
  // sustantivos de módulo/entidad (un tipo no es un nombre)
  'cliente', 'clientes', 'inmueble', 'inmuebles', 'piso', 'pisos', 'propiedad', 'propiedades', 'casa', 'chalet', 'atico', 'local',
  'operacion', 'operaciones', 'oportunidad', 'oportunidades', 'tarea', 'tareas', 'cita', 'citas', 'visita', 'visitas',
  'reunion', 'reuniones', 'tramite', 'tramites', 'expediente', 'expedientes', 'cartera', 'calendario', 'agenda',
  'documento', 'documentos', 'ficha', 'crm', 'asistente', 'resumen',
  // temporales (días/meses/palabras de periodo capitalizables)
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  'hoy', 'manana', 'ayer', 'semana', 'mes', 'dia', 'ano',
])
// Un span puede ser FUERTE (Capitalizado: señal ortográfica de nombre propio) o DÉBIL (minúsculas tras un
// marcador relacional). La fuerza gradúa la reacción ante un 0-match: un span FUERTE inexistente se dice
// («no encuentro a X»); un span DÉBIL que no resuelve se ignora (era predicado/andamiaje, no un nombre:
// «tienen cierre previsto» jamás debe bloquear una lectura legítima).
type NameSpan = { span: string; strong: boolean }
function extractProperNameSpans(raw: string): NameSpan[] {
  const spans: NameSpan[] = []
  const push = (words: string[], strong: boolean) => {
    while (words.length && NAME_SPAN_STOP.has(foldText(words[0]))) words.shift()
    while (words.length && NAME_SPAN_STOP.has(foldText(words[words.length - 1]))) words.pop()
    if (!words.length) return
    const cleaned = words.join(' ')
    if (cleaned.length < 3 || NAME_SPAN_STOP.has(foldText(cleaned))) return
    if (!spans.some((s) => foldText(s.span) === foldText(cleaned))) spans.push({ span: cleaned, strong })
  }
  // (a) Secuencias Capitalizadas (señal FUERTE de nombre propio).
  const re = /[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:de(?:l)?\s+|de la\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*/g
  for (const m of raw.matchAll(re)) push(m[0].split(/\s+/), true)
  // (b) Tras un MARCADOR RELACIONAL, también en minúsculas («las citas de maría garcía la semana que
  //     viene»): candidato DÉBIL — solo cuenta si RESUELVE contra clientes reales. Se recortan por la cola
  //     los PARTICIPIOS/ADJETIVOS (clase morfológica del español: -ado/-ido/-iente/-ivo…): «tiene
  //     programadas», «cierre previsto» son predicado, no nombre.
  const PREDICATE_SUFFIX = /(?:ad[oa]s?|id[oa]s?|ient?es?|iv[oa]s?|os[oa]s?|ist[oa]s?)$/
  const rel = /\b(?:de|del|con|tiene|tienen)\s+((?:[a-záéíóúñA-ZÁÉÍÓÚÑ][\wáéíóúñ'-]*\s*){1,3})/g
  for (const m of raw.matchAll(rel)) {
    const words = m[1].trim().split(/\s+/)
    const cut: string[] = []
    for (const w of words) { if (NAME_SPAN_STOP.has(foldText(w))) break; cut.push(w) }
    while (cut.length && PREDICATE_SUFFIX.test(foldText(cut[cut.length - 1]))) cut.pop()
    push(cut, false)
  }
  // Fuertes primero: la señal ortográfica manda.
  return spans.sort((a, b) => Number(b.strong) - Number(a.strong))
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type ExplicitClientResolution =
  | { kind: 'one'; ref: EntityRef }
  | { kind: 'many'; names: string[]; span: string }
  | { kind: 'none'; span: string }        // span FUERTE (Capitalizado) sin coincidencias → se dice
  | { kind: 'weak_miss'; span: string }   // solo spans débiles sin resolución → el llamador decide
  | null
async function resolveExplicitClientScope(
  supabase: SupabaseClient, ws: string, message: string,
  opts: { requireRelationMarker?: boolean } = {},
): Promise<ExplicitClientResolution> {
  let spans = extractProperNameSpans(message)
  if (opts.requireRelationMarker) {
    // Solo spans en posición RELACIONAL («de/del/con X», «tiene X»): un topónimo suelto no bloquea nada.
    spans = spans.filter((s) => new RegExp(`\\b(?:de|del|con|para)\\s+(?:el |la )?${escapeRe(s.span)}`, 'i').test(message)
      || new RegExp(`\\b(?:tiene|tienen)\\s+${escapeRe(s.span)}`, 'i').test(message))
  }
  if (!spans.length) return null
  let firstStrongMiss: string | null = null
  let firstWeakMiss: string | null = null
  for (const { span, strong } of spans) {
    const res = await searchClients(supabase, ws, { query: span, limit: 5 })
    if ('error' in res) continue
    const one = (c: { id: string; name: string }): ExplicitClientResolution =>
      ({ kind: 'one', ref: { entityType: 'client', entityId: String(c.id), displayLabel: String(c.name), confidence: 0.85, sourceTurnId: '' } })
    if (res.results.length === 1) return one(res.results[0])
    if (res.results.length > 1) {
      const exact = res.results.filter((c) => foldText(String(c.name)) === foldText(span) || foldText(String(c.name)).startsWith(foldText(span) + ' '))
      if (exact.length === 1) return one(exact[0])
      return { kind: 'many', names: res.results.slice(0, 4).map((c) => String(c.name)), span }
    }
    // 0-match: solo un span FUERTE (Capitalizado) inexistente merece bloquear con «no encuentro a X»;
    // un span débil sin resolución suele ser andamiaje («tienen cierre previsto») — el llamador decide.
    if (strong && !firstStrongMiss) firstStrongMiss = span
    if (!strong && !firstWeakMiss) firstWeakMiss = span
  }
  if (firstStrongMiss) return { kind: 'none', span: firstStrongMiss }
  if (firstWeakMiss) return { kind: 'weak_miss', span: firstWeakMiss }
  return null
}

// ── P71·F3.2 · LECTURA de un módulo TEMPORAL acotada a periodo (y opcionalmente a cliente) ────────────
// Ejecuta crmReadQuery con dateRange sobre el dateCol REAL de la entidad (metadata, server-side, RLS) y
// clientRef opcional. Sin resultados → vacío REAL del scope pedido, jamás datos globales.
async function handleModuleInPeriod(supabase: SupabaseClient, ws: string, mod: string, scope: TemporalScope, client: EntityRef | null, turnId: string): Promise<LocalAnswer> {
  const capMeta = TEMPORAL_READ_CAPABILITIES[mod]
  const entity: CrmEntity = mod === 'operations' ? 'operations' : 'service_cases'
  const T = `local_period:${mod}`
  const rq = await crmReadQuery(supabase, ws, {
    entity: capMeta.queryEntity, limit: 20,
    ...(client ? { clientRef: client.entityId } : {}),
    dateRange: { from: scope.start, to: scope.end },
    orderBy: capMeta.dateField, orderDirection: 'asc',
  })
  if ('error' in rq) return fail(entity, T, ws)
  const rows = rq.rows as Row[]
  const who = client ? ` de ${client.displayLabel}` : ''
  const noun = mod === 'operations' ? 'operaciones' : 'trámites'
  const convType: ConvEntityType = mod === 'operations' ? 'opportunity' : 'service_case'
  const su: StateUpdate = {
    resolvedModule: mod, temporalScopeUpdate: scope,
    ...(client ? { resolvedEntities: [{ ...client, sourceTurnId: turnId }] } : {}),
    lastDataQueryUpdate: { module: mod, capability: T, entityType: convType, resultRefs: toResultRefs(convType, rows), executedAt: new Date().toISOString() },
  }
  const label = formatScopeLabel(scope)
  if (!rows.length) return { handled: true, usedTool: T, entity, answer: `No hay ${noun}${who} ${capMeta.periodLabel} ${label}.`, stateUpdate: su }
  const fmt = mod === 'operations' ? formatOperationLine : formatCaseLine
  return { handled: true, usedTool: T, entity, answer: `${cap(noun)}${who} ${capMeta.periodLabel} ${label} (${rows.length}):\n${rows.slice(0, 8).map(fmt).join('\n')}`, referencedList: rows, stateUpdate: su }
}

// ── P71 · RESOLUCIÓN CONTEXTUAL: referencia → ancla → RECONSULTA de la fuente real ────────────────────
async function handleContextualFollowup(supabase: SupabaseClient, ws: string, message: string, state: ConversationState, turnId: string): Promise<LocalAnswer | null> {
  const n = foldText(message)
  // Nunca sobre una escritura/confirmación de acción (eso es del plano de acciones): verbos mutadores
  // generales + confirmación/cancelación. La resolución contextual es SOLO de lectura.
  if (/\b(cambia|cambiale|actualiza|modifica|pon(le|lo)?|sube|baja|edita|corrige|crea|anade|añade|marca|mueve|pasa|reprograma|activa|programa|elimina|borra|confirma|confirmo|cancela|descarta|adelante|hazlo)\b/.test(n)) return null
  const ref = detectReference(message)
  let anchor = ref ? resolveAnchor(ref, state) : null
  // P71 — ORDINAL sobre un CONTEO: «¿cuántos clientes tengo?» responde un número sin lista, pero «la ficha
  // del primero» sigue siendo resoluble: se RECONSULTA la lista del módulo con orden estable y se indexa.
  // (El estado solo dice QUÉ se consultó; la lista se lee fresca — nunca de memoria.)
  if (!anchor && ref?.kind === 'ordinal' && state.lastDataQuery && !state.lastDataQuery.resultRefs.length && state.lastDataQuery.entityType) {
    const QE: Record<string, string> = { client: 'clients', property: 'properties', opportunity: 'opportunities', task: 'tasks', calendar_event: 'calendar_events', service_case: 'service_cases' }
    const qe = QE[state.lastDataQuery.entityType]
    if (qe) {
      const rq = await crmReadQuery(supabase, ws, { entity: qe, limit: 25 })
      if (!('error' in rq)) {
        const rows = rq.rows as Row[]
        const idx = ref.index < 0 ? rows.length + ref.index : ref.index
        const row = rows[idx]
        const id = row ? str(row.id) : ''
        if (row && /^[0-9a-f-]{36}$/i.test(id)) {
          anchor = { type: 'entity', entity: { entityType: state.lastDataQuery.entityType, entityId: id, displayLabel: str(row.name) || str(row.title) || 'elemento', confidence: 0.8, sourceTurnId: turnId }, via: 'ordinal:requery', confidence: 0.8 }
        }
      }
    }
  }
  // P71 — BÚSQUEDA por nombre sin la palabra «cliente» y sin mayúsculas: «busca a roberto diaz». El verbo
  // de búsqueda define la intención; el NOMBRE lo validan los candidatos reales (jamás se adivina).
  if (!anchor && /\b(busca(me)?|encuentra|localiza)\b/.test(n)) {
    const tail = message.match(/\b(?:busca(?:me)?|encuentra|localiza)\s+(?:a\s+|al\s+|el\s+|la\s+)?(.+)$/i)?.[1]?.trim()
    if (tail && tail.length >= 3 && !/\b(cliente|inmueble|piso|operacion|tarea|cita|tramite)\b/.test(foldText(tail))) {
      const res = await searchClients(supabase, ws, { query: tail.slice(0, 80), limit: 5 })
      if (!('error' in res)) {
        if (res.results.length === 1) {
          const c0 = res.results[0]
          anchor = { type: 'entity', entity: { entityType: 'client', entityId: String(c0.id), displayLabel: String(c0.name), confidence: 0.85, sourceTurnId: turnId }, via: 'search', confidence: 0.85 }
        } else if (res.results.length > 1) {
          return { handled: true, usedTool: 'local_scope:clarify', entity: 'clients', answer: `He encontrado varios clientes que coinciden con «${tail}»:\n${res.results.slice(0, 4).map((c) => `• ${String(c.name)}`).join('\n')}\n¿A cuál te refieres?` }
        }
        // 0 coincidencias → flujo normal (puede ser un inmueble u otra búsqueda que resuelven otros handlers)
      }
    }
  }
  // ELISIÓN de 3ª persona: «¿qué operaciones tiene?», «¿cuántas citas tiene?» — sin sujeto explícito el
  // sujeto es la ENTIDAD ACTIVA. Se distingue de 1ª/2ª persona (tengo/tienes/tenemos = el USUARIO, global).
  // P71·F3.1 — un SUJETO EXPLÍCITO gana SIEMPRE a la entidad activa: «¿qué operaciones tiene María?» debe
  // resolver a María contra candidatos reales; si no existe → decirlo (jamás usar la activa por accidente).
  if (!anchor && /\b(tiene|tienen|tenia|tenian)\b/.test(n) && !/\b(tengo|tienes|tenemos|teneis)\b/.test(n)) {
    const explicit = await resolveExplicitClientScope(supabase, ws, message)
    if (explicit?.kind === 'one') anchor = { type: 'entity', entity: explicit.ref, via: 'explicit', confidence: 0.85 }
    else if (explicit?.kind === 'many') {
      return { handled: true, usedTool: 'local_scope:clarify', entity: 'clients', answer: `Hay varios clientes que coinciden con «${explicit.span}»:\n${explicit.names.map((x) => `• ${x}`).join('\n')}\n¿A cuál te refieres?` }
    } else if (explicit?.kind === 'none') {
      return { handled: true, usedTool: 'local_scope:notfound', entity: 'clients', answer: `No encuentro ningún cliente que coincida con «${explicit.span}». ¿Puedes darme el nombre completo o comprobar cómo está registrado?` }
    } else if (explicit?.kind === 'weak_miss' && state.activeEntities.length) {
      // El sujeto tras «tiene» podría ser un nombre que no resuelve: JAMÁS usar la entidad activa por
      // accidente — se pregunta (mejor una aclaración de más que datos de la entidad equivocada).
      const active = state.activeEntities.find((x) => x.entityType === 'client') ?? state.activeEntities[0]
      return { handled: true, usedTool: 'local_scope:clarify', entity: 'clients', answer: `No encuentro ningún cliente llamado «${explicit.span}». ¿Te refieres a ${active.displayLabel} (el último que miramos) o a otra persona?` }
    } else {
      const owner = state.activeEntities.find((x) => x.entityType === 'client') ?? state.activeEntities[0]
      if (owner) anchor = { type: 'entity', entity: owner, via: 'elision', confidence: 0.7 }
    }
  }
  // P71·F3.1 — relación EXPLÍCITA sin referencia previa: «las operaciones de maría» (sin pronombre ni
  // elisión, con o sin mayúsculas). Solo con marcador relacional y candidatos reales; 0 coincidencias →
  // flujo normal (no bloquea lecturas globales legítimas ni búsquedas por título de inmueble/operación).
  // El módulo puede venir del mensaje o HEREDARSE de la última consulta («¿y las de María?» tras citas).
  if (!anchor) {
    const targetMod = resolveModuleFromText(message)
    const inheritedMod = state.lastDataQuery && TEMPORAL_READ_CAPABILITIES[state.lastDataQuery.module] ? state.lastDataQuery.module : null
    const relational = ['operations', 'tasks', 'calendar', 'portfolio', 'cases'].includes(targetMod ?? '') || (!targetMod && !!inheritedMod)
    if (relational && /\b(de|del|con)\s+\p{L}/iu.test(message)) {
      const explicit = await resolveExplicitClientScope(supabase, ws, message, { requireRelationMarker: true })
      if (explicit?.kind === 'one') anchor = { type: 'entity', entity: explicit.ref, via: 'explicit', confidence: 0.85 }
      else if (explicit?.kind === 'many') {
        return { handled: true, usedTool: 'local_scope:clarify', entity: 'clients', answer: `Hay varios clientes que coinciden con «${explicit.span}»:\n${explicit.names.map((x) => `• ${x}`).join('\n')}\n¿A cuál te refieres?` }
      }
    }
  }
  if (!anchor) return null

  if (anchor.type === 'same_query') return rerunLastQuery(supabase, ws, state)
  if (anchor.type === 'ambiguous') {
    const opts = anchor.candidates.map((c) => `• ${c.displayLabel || c.entityType}`).join('\n')
    return { handled: true, usedTool: 'local_ref:clarify', entity: 'help', answer: `¿A cuál te refieres?\n${opts}` }
  }
  if (anchor.type === 'extreme') return resolveExtreme(supabase, ws, anchor, state, turnId)

  // anchor.type === 'entity': el llamador SIEMPRE reconsulta la fuente por id.
  const e = anchor.entity
  // P71·F3.1 — módulo: el del mensaje o, si el mensaje es elíptico («¿y las de María?»), el HEREDADO de la
  // última consulta temporal-capaz. El periodo vigente se hereda SOLO si esa última consulta era del mismo
  // módulo (una continuación habla «de lo mismo»); si no, la lectura scoped usa su ventana por defecto.
  const targetModule = resolveModuleFromText(message)
    ?? (state.lastDataQuery && TEMPORAL_READ_CAPABILITIES[state.lastDataQuery.module] ? state.lastDataQuery.module as ReturnType<typeof resolveModuleFromText> : null)
  const inheritScope = (m: string): TemporalScope | undefined =>
    state.temporalScope && state.lastDataQuery?.module === m ? state.temporalScope : undefined
  if (e.entityType === 'client') {
    if (targetModule === 'operations') return readClientOperations(supabase, ws, e, turnId)
    if (targetModule === 'tasks') return readClientTasks(supabase, ws, e, turnId, inheritScope('tasks'))
    if (targetModule === 'calendar') return readClientEvents(supabase, ws, e, turnId, inheritScope('calendar'))
    if (targetModule === 'portfolio') return readClientProperties(supabase, ws, e, turnId)
    return readClientDetailById(supabase, ws, e, turnId)
  }
  return readEntityDetailById(supabase, ws, e, turnId)
}

// ── P71·It2 · CONTINUIDAD TEMPORAL: hereda módulo/capability y SUSTITUYE solo el periodo → reconsulta BD ─
// «¿y la semana que viene?», «¿y la siguiente?», «¿y este mes?» tras una consulta de agenda: se resuelve el
// nuevo alcance (absoluto o desplazando el previo) y se vuelve a consultar. Nunca responde del resultado
// anterior. No secuestra un mensaje que trae su propio módulo no-temporal (cartera/clientes/operaciones).
async function handleTemporalFollowup(supabase: SupabaseClient, ws: string, message: string, state: ConversationState, turnId: string): Promise<LocalAnswer | null> {
  const today = todayMadridIso()
  const resolved = resolveTemporalScope(message, state.temporalScope, today, turnId)
  if (!resolved) return null
  const n = foldText(message)
  // La continuidad temporal es de LECTURA: nunca secuestra una ACCIÓN (crear/mover una cita, cambiar un
  // valor…) ni un COMANDO de automatización. «agéndame una visita mañana» o «activa la agenda de la mañana»
  // NO son consultas de citas de mañana. parseActionIntent cubre las acciones P65; el verbo cubre la
  // creación/gestión de automatizaciones (que no es una acción P65).
  if (parseActionIntent(message)) return null
  if (/\b(activa|crea|programa|configura|desactiva|pausa|reactiva|ejecuta|lanza|cambia|cambiale|modifica|actualiza|pon|ponle|edita|corrige|marca|mueve|reprograma|apunta|recuerdame|anade|añade|agendar|agendame)\b/.test(n)) return null
  // Sin semántica temporal de lectura: cartera (un inmueble no «ocurre» en una semana), ventas, facturación.
  if (PROPERTY_VOCAB.test(n) || /\b(vendid|ventas|factura)\b/.test(n)) return null
  // P71·F3.2 — módulo temporal por METADATA (no por frases): el que nombre el mensaje, o el heredable del
  // estado si su capability declara continuidad (TEMPORAL_READ_CAPABILITIES).
  const mentionsTareas = /\b(tarea|tareas|pendientes?)\b/.test(n)
  const mentionsCitas = /\b(cita|citas|calendario|agenda|reunion(es)?|visitas?)\b/.test(n)
  const mentionsOps = /\b(operacion(es)?|oportunidad(es)?)\b/.test(n)
  const mentionsCases = /\b(tramite|tramites|expediente|expedientes)\b/.test(n)
  let mod: string | null = mentionsTareas ? 'tasks' : mentionsCitas ? 'calendar' : mentionsOps ? 'operations' : mentionsCases ? 'cases' : null
  if (!mod) {
    const inheritable = (m: string | null | undefined) => (m && TEMPORAL_READ_CAPABILITIES[m]?.allowsContinuity ? m : null)
    mod = inheritable(state.activeModule) ?? inheritable(state.lastDataQuery?.module)
  }
  if (!mod || !TEMPORAL_READ_CAPABILITIES[mod]) return null

  // ── COMPOSICIÓN entidad + periodo (entityScope y temporalScope COEXISTEN, nunca se pisan) ────────────
  // P71·F3.1 — la entidad puede venir (a) EXPLÍCITA por nombre → candidatos reales del workspace (gana a
  // todo; N→aclarar; 0→decirlo, jamás global bajo referencia de entidad); (b) por referencia/elisión del
  // estado; (c) por continuidad del scope relacional anterior.
  const explicit = await resolveExplicitClientScope(supabase, ws, message, { requireRelationMarker: true })
  if (explicit?.kind === 'many') {
    return { handled: true, usedTool: 'local_scope:clarify', entity: 'clients', answer: `Hay varios clientes que coinciden con «${explicit.span}»:\n${explicit.names.map((x) => `• ${x}`).join('\n')}\n¿A cuál te refieres?` }
  }
  if (explicit?.kind === 'none') {
    return { handled: true, usedTool: 'local_scope:notfound', entity: 'clients', answer: `No encuentro ningún cliente que coincida con «${explicit.span}», así que no te muestro datos de otra cosa. Si te referías a una zona o a un inmueble, dímelo de otra forma.` }
  }
  let scopedClient: EntityRef | null = explicit?.kind === 'one' ? explicit.ref : null
  const refk = scopedClient ? null : detectReference(message)
  if (!scopedClient && refk) { const a = resolveAnchor(refk, state); if (a && a.type === 'entity' && a.entity.entityType === 'client') scopedClient = a.entity }
  if (!scopedClient && /\b(tiene|tienen|tenia|tenian)\b/.test(n) && !/\b(tengo|tienes|tenemos|teneis)\b/.test(n)) {
    scopedClient = state.activeEntities.find((x) => x.entityType === 'client') ?? null
  }
  // CONTINUIDAD del scope: si la ÚLTIMA consulta ya era relacional (de un cliente), la continuación
  // temporal sin nueva referencia sigue acotada al MISMO cliente (no salta a lo global). El scope de
  // cliente de un local_period se reconoce porque la entidad activa participó en esa consulta.
  if (!scopedClient && /^local_client_(events|tasks)$/.test(state.lastDataQuery?.capability ?? '')) {
    scopedClient = state.activeEntities.find((x) => x.entityType === 'client') ?? null
  }

  if (mod === 'calendar' || mod === 'tasks') {
    if (scopedClient) {
      return mod === 'tasks'
        ? readClientTasks(supabase, ws, scopedClient, turnId, resolved.scope)
        : readClientEvents(supabase, ws, scopedClient, turnId, resolved.scope)
    }
    // Absoluto SIN contexto temporal previo y sin ser continuación explícita («y…») → flujo normal (que
    // también registra el alcance). No cambia el comportamiento de una primera consulta con fecha.
    const startsWithContinuation = /^\s*¿?\s*y\b/i.test(message.trim())
    if (resolved.via === 'absolute' && !state.temporalScope && !startsWithContinuation && !mentionsCitas && !mentionsTareas) return null
    const want = mod === 'tasks' ? { calendar: false, tasks: true } : { calendar: true, tasks: false }
    return handleAgenda(supabase, ws, want, { scope: resolved.scope, turnId })
  }
  // operations / cases — P71·F3.2: crmReadQuery con dateRange sobre el dateCol real (+ clientRef opcional).
  return handleModuleInPeriod(supabase, ws, mod, resolved.scope, scopedClient, turnId)
}

// Reconsulta la MISMA lectura anterior con datos ACTUALES (grounding; reemplaza el atajo confirm_prior).
async function rerunLastQuery(supabase: SupabaseClient, ws: string, state: ConversationState): Promise<LocalAnswer> {
  const q = state.lastDataQuery
  if (!q) return { handled: false } as LocalAnswer
  const et = q.entityType
  const mod = q.module
  let r: LocalAnswer
  if (et === 'client' || mod === 'clients') r = await handleClients(supabase, ws, classifyIntent('muéstrame los clientes'))
  else if (et === 'property' || mod === 'portfolio') r = await handlePortfolioSummary(supabase, ws)
  else if (et === 'opportunity' || mod === 'operations') r = await handleList(supabase, ws, 'operations', 'local_operations', async () => { const x = await crmReadQuery(supabase, ws, { entity: 'opportunities', limit: 10 }); return 'error' in x ? { error: true } : { rows: x.rows } }, formatOperationLine, 'operación', 'operaciones')
  else if (et === 'task' || mod === 'tasks') r = await handleAgenda(supabase, ws, { calendar: false, tasks: true })
  else if (et === 'calendar_event' || mod === 'calendar') r = await handleAgenda(supabase, ws, { calendar: true, tasks: false })
  else if (et === 'service_case' || mod === 'cases') r = await handleList(supabase, ws, 'service_cases', 'local_cases', async () => { const x = await crmReadQuery(supabase, ws, { entity: 'service_cases', limit: 10 }); return 'error' in x ? { error: true } : { rows: x.rows } }, formatCaseLine, 'trámite', 'trámites')
  else return { handled: false } as LocalAnswer
  if (!r.handled) return r
  return { ...r, usedTool: `${r.usedTool}:rerun`, answer: `Lo he vuelto a consultar ahora mismo:\n${r.answer}` }
}

// Extremo (más caro/reciente…): reconsulta la lista del módulo con orden real y muestra el primero.
async function resolveExtreme(supabase: SupabaseClient, ws: string, anchor: Extract<AnchorResolution, { type: 'extreme' }>, state: ConversationState, turnId: string): Promise<LocalAnswer | null> {
  const mod = state.lastDataQuery?.module ?? state.activeModule
  if (mod === 'portfolio' || anchor.field === 'price') {
    const rq = await crmReadQuery(supabase, ws, { entity: 'properties', limit: 200 })
    if ('error' in rq) return fail('properties', 'local_ref:extreme', ws)
    const rows = (rq.rows as Row[]).filter((p) => numOrNull(p.price) != null)
    rows.sort((a, b) => anchor.dir === 'desc' ? numOrNull(b.price)! - numOrNull(a.price)! : numOrNull(a.price)! - numOrNull(b.price)!)
    const top = rows[0]
    if (!top) return { handled: true, usedTool: 'local_ref:extreme', entity: 'properties', answer: 'No hay inmuebles con precio para comparar.' }
    const su: StateUpdate = { resolvedModule: 'portfolio', resolvedEntities: [{ entityType: 'property', entityId: str(top.id), displayLabel: str(top.title), confidence: 0.8, sourceTurnId: turnId }] }
    return { handled: true, usedTool: 'local_ref:extreme', entity: 'properties', answer: `El ${anchor.dir === 'desc' ? 'más' : 'menos'} caro:\n${formatPropertyLine(top)}`, referencedList: [top], stateUpdate: su }
  }
  return null
}

// Ficha de cliente por ID (reconsulta getClient360, datos ACTUALES).
async function readClientDetailById(supabase: SupabaseClient, ws: string, e: { entityId: string; displayLabel: string }, turnId: string): Promise<LocalAnswer> {
  const r = await getClient360(supabase, ws, { clientId: e.entityId })
  const su: StateUpdate = { resolvedModule: 'clients', resolvedEntities: [{ entityType: 'client', entityId: e.entityId, displayLabel: e.displayLabel, confidence: 0.85, sourceTurnId: turnId }] }
  if ('error' in r) return { handled: true, usedTool: 'local_client_detail', entity: 'clients', answer: `No he podido cargar la ficha ahora mismo.`, stateUpdate: su }
  const c = r.client
  const pend = r.tasks.filter((t) => isPendingTask(t.status)).length
  const up = r.calendarEvents.filter((ev) => isUpcoming(ev.date ?? ev.start_at, ev.status)).length
  const lines = [`Ficha de ${c.name}`, [c.company, c.email, c.phone].filter(Boolean).join(' · ') || null, c.status ? `Estado: ${cap(c.status)}` : null, `• Tareas pendientes: ${pend} · Citas próximas: ${up} · Documentos: ${r.documents.length}`].filter(Boolean)
  return { handled: true, usedTool: 'local_client_detail', entity: 'clients', answer: lines.join('\n'), referencedList: [{ id: e.entityId, name: c.name }], stateUpdate: su }
}

async function readClientOperations(supabase: SupabaseClient, ws: string, e: { entityId: string; displayLabel: string }, turnId: string): Promise<LocalAnswer> {
  const r = await getClientOpportunities(supabase, ws, { clientId: e.entityId })
  const su: StateUpdate = { resolvedModule: 'operations', resolvedEntities: [{ entityType: 'client', entityId: e.entityId, displayLabel: e.displayLabel, confidence: 0.85, sourceTurnId: turnId }] }
  if ('error' in r) return fail('operations', 'local_client_operations', ws)
  const ops = r.opportunities as Array<Record<string, unknown>>
  if (!ops.length) return { handled: true, usedTool: 'local_client_operations', entity: 'operations', answer: `${e.displayLabel} no tiene operaciones registradas.`, stateUpdate: su }
  const lines = ops.slice(0, 8).map((o) => formatOperationLine({ ...o, client_name: e.displayLabel }))
  return { handled: true, usedTool: 'local_client_operations', entity: 'operations', answer: `Operaciones de ${e.displayLabel} (${ops.length}):\n${lines.join('\n')}`, referencedList: ops, stateUpdate: { ...su, lastDataQueryUpdate: { module: 'operations', capability: 'local_client_operations', entityType: 'opportunity', resultRefs: toResultRefs('opportunity', ops), executedAt: new Date().toISOString() } } }
}

async function readClientTasks(supabase: SupabaseClient, ws: string, e: { entityId: string; displayLabel: string }, turnId: string, scope?: TemporalScope | null): Promise<LocalAnswer> {
  const { data, error } = await supabase.from('tasks').select('id, title, due_date, status, priority, client_name').eq('workspace_id', ws).eq('client_id', e.entityId).order('due_date', { ascending: true, nullsFirst: false }).limit(30)
  const su: StateUpdate = { resolvedModule: 'tasks', resolvedEntities: [{ entityType: 'client', entityId: e.entityId, displayLabel: e.displayLabel, confidence: 0.85, sourceTurnId: turnId }], ...(scope !== undefined ? { temporalScopeUpdate: scope } : {}) }
  if (error) return fail('tasks', 'local_client_tasks', ws)
  let rows = ((data ?? []) as Row[]).filter((t) => isPendingTask(t.status as string | null))
  // COMPOSICIÓN entidad+periodo: se acota por fecha límite dentro del rango (empty REAL, nunca global).
  if (scope && scope.start && scope.end) rows = rows.filter((t) => { const d = str(t.due_date).slice(0, 10); return d && d >= scope.start! && d <= scope.end! })
  const per = scope ? ` (${formatScopeLabel(scope)})` : ' pendientes'
  if (!rows.length) return { handled: true, usedTool: 'local_client_tasks', entity: 'tasks', answer: `${e.displayLabel} no tiene tareas${per}.`, stateUpdate: su }
  return { handled: true, usedTool: 'local_client_tasks', entity: 'tasks', answer: `Tareas de ${e.displayLabel}${per} (${rows.length}):\n${rows.slice(0, 8).map(formatTaskLine).join('\n')}`, referencedList: rows, stateUpdate: { ...su, lastDataQueryUpdate: { module: 'tasks', capability: 'local_client_tasks', entityType: 'task', resultRefs: toResultRefs('task', rows), executedAt: new Date().toISOString() } } }
}

async function readClientEvents(supabase: SupabaseClient, ws: string, e: { entityId: string; displayLabel: string }, turnId: string, scope?: TemporalScope | null): Promise<LocalAnswer> {
  const { data, error } = await supabase.from('calendar_events').select('id, title, date, start_at, status, client_name').eq('workspace_id', ws).eq('client_id', e.entityId).neq('status', 'cancelled').order('start_at', { ascending: true }).limit(50)
  const su: StateUpdate = { resolvedModule: 'calendar', resolvedEntities: [{ entityType: 'client', entityId: e.entityId, displayLabel: e.displayLabel, confidence: 0.85, sourceTurnId: turnId }], ...(scope !== undefined ? { temporalScopeUpdate: scope } : {}) }
  if (error) return fail('calendar', 'local_client_events', ws)
  // Con periodo: se acota a [start,end] (Europe/Madrid). Sin periodo: próximas (comportamiento previo).
  const rows = ((data ?? []) as Row[]).filter((ev) => {
    const d = (str(ev.date) || str(ev.start_at)).slice(0, 10)
    if (scope && scope.start && scope.end) return d >= scope.start && d <= scope.end
    return isUpcoming(str(ev.date) || str(ev.start_at), ev.status as string | null)
  })
  const per = scope ? ` para ${formatScopeLabel(scope)}` : ' próximas'
  if (!rows.length) return { handled: true, usedTool: 'local_client_events', entity: 'calendar', answer: `${e.displayLabel} no tiene citas${per}.`, stateUpdate: su }
  return { handled: true, usedTool: 'local_client_events', entity: 'calendar', answer: `Citas de ${e.displayLabel}${per} (${rows.length}):\n${rows.slice(0, 8).map(formatEventLine).join('\n')}`, referencedList: rows, stateUpdate: { ...su, lastDataQueryUpdate: { module: 'calendar', capability: 'local_client_events', entityType: 'calendar_event', resultRefs: toResultRefs('calendar_event', rows), executedAt: new Date().toISOString() } } }
}

async function readClientProperties(supabase: SupabaseClient, ws: string, e: { entityId: string; displayLabel: string }, turnId: string): Promise<LocalAnswer> {
  const { data, error } = await supabase.from('properties').select('id, title, status, price, operation_type, city, area').eq('workspace_id', ws).eq('client_id', e.entityId).is('deleted_at', null).limit(15)
  const su: StateUpdate = { resolvedModule: 'portfolio', resolvedEntities: [{ entityType: 'client', entityId: e.entityId, displayLabel: e.displayLabel, confidence: 0.85, sourceTurnId: turnId }] }
  if (error) return fail('properties', 'local_client_properties', ws)
  const rows = (data ?? []) as Row[]
  if (!rows.length) return { handled: true, usedTool: 'local_client_properties', entity: 'properties', answer: `${e.displayLabel} no tiene inmuebles vinculados.`, stateUpdate: su }
  return { handled: true, usedTool: 'local_client_properties', entity: 'properties', answer: `Inmuebles de ${e.displayLabel} (${rows.length}):\n${rows.slice(0, 8).map((p) => formatPropertyLine(p)).join('\n')}`, referencedList: rows, stateUpdate: { ...su, lastDataQueryUpdate: { module: 'portfolio', capability: 'local_client_properties', entityType: 'property', resultRefs: toResultRefs('property', rows), executedAt: new Date().toISOString() } } }
}

// Detalle de una entidad no-cliente por id (reconsulta la fila real).
async function readEntityDetailById(supabase: SupabaseClient, ws: string, e: { entityType: ConvEntityType; entityId: string; displayLabel: string }, turnId: string): Promise<LocalAnswer> {
  const table = e.entityType === 'property' ? 'properties' : e.entityType === 'opportunity' ? 'opportunities' : e.entityType === 'task' ? 'tasks' : e.entityType === 'calendar_event' ? 'calendar_events' : e.entityType === 'service_case' ? 'service_cases' : null
  const entity: CrmEntity = e.entityType === 'property' ? 'properties' : e.entityType === 'opportunity' ? 'operations' : e.entityType === 'task' ? 'tasks' : e.entityType === 'calendar_event' ? 'calendar' : e.entityType === 'service_case' ? 'service_cases' : 'help'
  const su: StateUpdate = { resolvedEntities: [{ ...e, confidence: 0.85, sourceTurnId: turnId }] }
  if (!table) return { handled: true, usedTool: 'local_ref:detail', entity, answer: `Es «${e.displayLabel}». ¿Qué quieres saber de él?`, stateUpdate: su }
  const { data } = await supabase.from(table).select('*').eq('workspace_id', ws).eq('id', e.entityId).maybeSingle()
  if (!data) return { handled: true, usedTool: 'local_ref:detail', entity, answer: `Ya no encuentro «${e.displayLabel}» (puede haberse eliminado).`, stateUpdate: su }
  const row = data as Row
  const line = e.entityType === 'property' ? formatPropertyLine(row) : e.entityType === 'opportunity' ? formatOperationLine(row) : e.entityType === 'task' ? formatTaskLine(row) : e.entityType === 'calendar_event' ? formatEventLine(row) : formatCaseLine(row)
  return { handled: true, usedTool: 'local_ref:detail', entity, answer: line, referencedList: [row], stateUpdate: su }
}

export async function tryLocalAnswer(
  supabase: SupabaseClient,
  workspaceId: string,
  message: string,
  opts: LocalOpts = {},
): Promise<LocalAnswer> {
  const r = await tryLocalAnswerInner(supabase, workspaceId, message, opts)
  if (!r.handled) return r
  // P71 — enriquecer el stateUpdate con la última consulta de datos (referencias ligeras, NO datos),
  // de forma general: cualquier lectura que devuelva una lista deja resolubles ordinales/extremos.
  const withState = enrichReadStateUpdate(r, message, opts.turnId ?? '')
  // P71·It2 — CAMBIO DE TEMA: si había una intención pendiente y este turno resolvió OTRO objetivo (su tool
  // no es del flujo de intención pendiente), la intención anterior queda cancelada (no contamina el hilo).
  let stateUpdate = withState.stateUpdate
  if (opts.state?.pendingIntent && !withState.usedTool.startsWith('local_pending')) {
    stateUpdate = { ...(stateUpdate ?? {}), clearPendingIntent: true }
  }
  // P71·F5 — traza SEGURA del cerebro por turno (tipos y conteos; jamás labels, texto del usuario ni PII).
  // Permite responder: por qué esta ruta, con qué scope de entidad/tiempo, y si quedó intención pendiente.
  console.log('[assistant.brain]', {
    turnId: opts.turnId ?? '',
    tool: withState.usedTool,
    module: stateUpdate?.resolvedModule ?? opts.state?.activeModule ?? null,
    entityScope: (stateUpdate?.resolvedEntities?.length ?? 0) > 0
      ? { type: stateUpdate!.resolvedEntities![0].entityType, count: stateUpdate!.resolvedEntities!.length }
      : (opts.state?.activeEntities?.length ? { type: opts.state.activeEntities[0].entityType, count: opts.state.activeEntities.length, inherited: true } : null),
    temporal: stateUpdate?.temporalScopeUpdate?.interpretation ?? null,
    pendingSlots: stateUpdate?.pendingIntentUpdate?.requiredSlots ?? (stateUpdate?.clearPendingIntent ? [] : opts.state?.pendingIntent?.requiredSlots ?? null),
    listRefs: stateUpdate?.lastDataQueryUpdate?.resultRefs?.length ?? null,
    freshness: 'live',
  })
  return { ...withState, stateUpdate, answer: withState.answer.replace(/\*\*/g, '') }
}

async function tryLocalAnswerInner(
  supabase: SupabaseClient,
  workspaceId: string,
  message: string,
  opts: LocalOpts = {},
): Promise<LocalAnswer> {
  const recentContext = opts.recentContext ?? ''
  const state = opts.state ?? emptyState()
  const turnId = opts.turnId ?? ''
  const today = todayMadridIso()

  // ── P71·It2 · INTENCIÓN PENDIENTE — completar con el complemento del turno, o cancelar ────────────────
  // Si hay una acción pendiente y este turno la CANCELA o la COMPLETA, se resuelve aquí (antes de re-enrutar).
  // Completar NUNCA ejecuta: produce un PREVIEW (prepare→confirm→execute→verify de P70). Un mensaje que trae
  // su propia acción completa o un objetivo nuevo NO se fuerza como complemento (cae al flujo normal y el
  // wrapper cancela la intención anterior).
  if (state.pendingIntent && state.pendingIntent.kind === 'action') {
    const pi = state.pendingIntent
    if (detectExplicitCancel(message)) {
      return { handled: true, usedTool: 'local_pending:cancel', entity: 'help', answer: 'Vale, lo dejo. He descartado el cambio pendiente; no se ha tocado nada.', stateUpdate: { clearPendingIntent: true } }
    }
    const ownAction = parseActionIntent(message)
    const isOwnComplete = !!ownAction && ownAction.act === 'prepare' && !ownAction.missingFields.length
    if (!isOwnComplete) {
      const comp = completePendingAction(pi, message, today)
      // P71·F3.4 — «sí / vale / adelante» con una intención INCOMPLETA: no hay preview que confirmar
      // todavía; se re-pregunta el slot que falta (la intención se conserva, con expiración renovada).
      if (comp && !comp.done && isAffirmativeParticleOnly(message)) {
        const expiresAt = new Date(Date.now() + PENDING_INTENT_TTL_MS).toISOString()
        return { handled: true, usedTool: 'local_pending:ask', entity: 'help', answer: `Aún no tengo todo para prepararlo. ${askForSlot(comp.askSlot, comp.askEntityNoun)}`, stateUpdate: { pendingIntentUpdate: { ...pi, requiredSlots: comp.stillMissing, collectedSlots: comp.collected, expiresAt, status: 'awaiting_slot' } } }
      }
      // Progreso = más slots llenos O una CORRECCIÓN (mismo slot, valor distinto). Ignora metadatos «__».
      const filled = (o: Record<string, unknown>) => Object.entries(o).filter(([k, v]) => !k.startsWith('__') && v !== undefined && v !== null && v !== '').length
      const corrected = !!comp && Object.keys(comp.collected).some((k) => !k.startsWith('__') && pi.collectedSlots[k] !== undefined && comp.collected[k] !== pi.collectedSlots[k])
      const madeProgress = !!comp && (comp.done || corrected || filled(comp.collected) > filled(pi.collectedSlots))
      if (comp && madeProgress && (looksLikeSlotFiller(message) || comp.done)) {
        if (comp.done) {
          const handled = await handleChatAction(supabase, workspaceId, comp.intent)
          if (handled.handled) return { ...handled, usedTool: 'local_pending:complete', stateUpdate: { ...(handled.stateUpdate ?? {}), clearPendingIntent: true } }
        } else {
          const expiresAt = new Date(Date.now() + PENDING_INTENT_TTL_MS).toISOString()
          return { handled: true, usedTool: 'local_pending:ask', entity: 'help', answer: askForSlot(comp.askSlot, comp.askEntityNoun), stateUpdate: { pendingIntentUpdate: { ...pi, collectedSlots: comp.collected, requiredSlots: comp.stillMissing, expiresAt, status: 'awaiting_slot' } } }
        }
      }
    }
    // Sin progreso ni cancelación → objetivo nuevo: sigue el flujo normal (el wrapper cancela lo pendiente).
  }

  // ── P71·It2 · CONTINUIDAD TEMPORAL antes de referencias: «¿y la semana que viene?» hereda módulo y periodo.
  const tmpFollow = await handleTemporalFollowup(supabase, workspaceId, message, state, turnId)
  if (tmpFollow && tmpFollow.handled) return tmpFollow

  // ── P71 · RESOLUCIÓN CONTEXTUAL (referencias/ordinales/extremos/«otra vez») ─────────────────
  // Antes del enrutado general: si el mensaje es una referencia y el estado tiene contexto, se resuelve
  // el ancla (id/criterio) y se RECONSULTA la fuente real. Nunca responde desde el estado. No corre si el
  // mensaje es una escritura (verbo mutador) — eso lo maneja el plano de acciones.
  const ctxFollow = await handleContextualFollowup(supabase, workspaceId, message, state, turnId)
  if (ctxFollow && ctxFollow.handled) return ctxFollow

  // ── P50: DECISIÓN ÚNICA DE TURNO — razona el acto comunicativo ANTES de leer/escribir/llamar a n8n ──
  // Ninguna entidad del CRM provoca una consulta por sí sola. Los turnos META (el usuario habla de la
  // respuesta del Asistente, corrige, se queja o discrepa) y los conceptuales (capacidad/cómo-funciona/
  // futuro/social/ayuda) se responden SIN leer datos, aunque mencionen cualquier entidad.
  const priorEntity = recentContext ? classifyIntent(recentContext).entity : undefined
  // P53/P56 — módulo del contexto: se hereda el del ÚLTIMO mensaje del hilo que nombre un módulo (no el
  // alias más largo de toda la conversación — evita que «no entiendo» tras hablar de Cartera salte a otro
  // módulo mencionado antes). Si el mensaje nombra uno nuevo, gana el nuevo (sin arrastre).
  // P62: se limpia el prefijo de hablante («asistente:», «usuario:») — si no, la palabra «asistente» del
  // propio hilo se resolvía como módulo Asistente y contaminaba el contexto.
  const stripSpeaker = (l: string) => l.replace(/^(usuario|asistente|user|assistant)\s*:\s*/i, '')
  const priorModule = (() => {
    if (!recentContext) return null
    const lines = recentContext.split('\n').map((l) => stripSpeaker(l.trim())).filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = resolveModuleFromText(lines[i])
      if (m) return m
    }
    return null
  })()
  const turn = decideTurn(message, { priorEntity, priorModule, hasLastResult: Array.isArray(opts.lastResults) && opts.lastResults.length > 0 })
  const topicEntity = classifyIntent(message, { priorEntity }).entity
  // Traza segura por turno (sin PII ni cuerpo del mensaje): por qué se leerá o NO se leerán datos.
  console.log('[assistant.turn]', { turnType: turn.turnType, domain: turn.domain, module: turn.module, action: turn.action, shouldReadData: turn.shouldReadData, shouldCallN8n: turn.shouldCallN8n, reason: turn.reason })

  // P61 — CONFIRMACIÓN de un resultado vacío previo: «¿no tengo nada?», «entonces no?», «me quieres decir
  // que no?». NO es smalltalk social: reconsulta y RE-AFIRMA la agenda (citas/tareas) del turno anterior.
  const ctxAgenda = /\b(cita|citas|tarea|tareas|agenda|calendario)\b/.test(foldText(recentContext))
  const isEmptyConfirm = /\b(no tengo nada|entonces no|o sea que no|no hay nada|me quieres decir|son cero|es cero|ninguna\b|no tengo ni)\b/.test(foldText(message))
  if (ctxAgenda && isEmptyConfirm && turn.turnType !== 'module_explanation' && turn.turnType !== 'user_correction' && turn.domain !== 'invoicing') {
    const wantTsk = /\btarea/.test(foldText(recentContext))
    const wantCal = /\bcita|calendario|agenda\b/.test(foldText(recentContext))
    return handleAgenda(supabase, workspaceId, { calendar: wantCal || !wantTsk, tasks: wantTsk })
  }

  // P66 — ACCIONES DE ESCRITURA (plano P65 desde el chat). Prioridad: cancel > modify > status > confirm >
  // prepare. Confirm/cancel solo actúan si EXISTE una pending action válida en BD (si no, se sigue el flujo
  // normal: un «sí» sin acción pendiente puede ser aceptación de oferta, nunca ejecuta escrituras).
  // Nunca en turnos meta/corrección/queja ni en Facturación.
  if (turn.domain !== 'invoicing' && !['user_correction', 'user_complaint', 'assistant_meta', 'disagreement'].includes(turn.turnType)) {
    const askPending = (build: ReturnType<typeof detectIncompleteAction>): LocalAnswer => {
      const expiresAt = new Date(Date.now() + PENDING_INTENT_TTL_MS).toISOString()
      return { handled: true, usedTool: 'local_pending:ask', entity: 'help', answer: askForSlot(build!.askSlot, build!.askEntityNoun), stateUpdate: { pendingIntentUpdate: { ...build!.pending, sourceTurnId: turnId, expiresAt } } }
    }
    const actionIntent = parseActionIntent(message)
    if (actionIntent) {
      // P71·It3 — acción IMPERATIVA pero INCOMPLETA (le faltan slots): en vez de pedir y olvidar, se crea una
      // intención pendiente (derivada del registry) que combinará el turno siguiente hasta producir el preview.
      if (actionIntent.act === 'prepare' && actionIntent.missingFields.length && !state.pendingIntent) {
        const build = buildPendingFromIntent(actionIntent, message)
        if (build) return askPending(build)
      }
      const handled = await handleChatAction(supabase, workspaceId, actionIntent)
      if (handled.handled) return handled
    }
    // P71·It2 — acción con INTENCIÓN clara pero INCOMPLETA en forma DESIDERATIVA («quiero cambiar el precio de
    // un inmueble»), que parseActionIntent no captura: crea intención pendiente y pregunta SOLO por lo que falta.
    if (!state.pendingIntent) {
      const inc = detectIncompleteAction(message, today)
      if (inc) return askPending(inc)
    }
  }

  // P70 Wave A — CANCELAR un preview de automatización pendiente («mejor no, descártala», botón de la
  // card). Deterministra e independiente del turno: exige marcador [AUTO:…] en el hilo. La respuesta deja
  // el marcador [AUTO:cancelled] en el hilo para NEUTRALIZAR el preview: un «confirma» posterior ya no
  // activa nada (la confirmación exige que el último marcador sea un preview, no una cancelación).
  {
    const nm = foldText(message).trim()
    const nmWords = nm.replace(/[¿?¡!.,;:]/g, ' ').split(/\s+/).filter(Boolean)
    // Solo frases CORTAS de rechazo (o mención explícita): «no quiero ver los clientes» nunca se secuestra.
    const wantsAutoCancel = (nmWords.length <= 5 && /^(no( gracias)?|mejor no|cancela(la|lo)?|descarta(la|lo)?|dejalo|olvidalo)\b/.test(nm))
      || /\b(cancela|descarta|no (la )?actives?|no (lo )?cambies)\b.*\b(automatizacion|horario)/.test(nm)
    const liveMarker = lastLiveAutoMarker(recentContext)
    if (wantsAutoCancel && liveMarker && !(await latestPendingAction(supabase, workspaceId))) {
      const ui: AssistantUiPayload = { kind: 'automation_status', automation: { type: 'automation', name: 'Automatización', status: 'disabled', scheduleLabel: '', timezone: 'Europe/Madrid', allowedUiActions: [] } }
      const answer = liveMarker.kind === 'edit'
        ? 'Vale, no cambio el horario. La automatización sigue como estaba. [AUTO:cancelled]'
        : 'Vale, no activo la automatización. No se ha creado nada; pídemela de nuevo cuando quieras. [AUTO:cancelled]'
      return { handled: true, usedTool: 'local_automation:cancel', entity: 'help', answer, ui }
    }
  }

  // ── P70 Wave D · GESTIÓN CONVERSACIONAL de automatizaciones ──────────────────────────────────────
  // Editar horario (SIEMPRE preview antes→después + confirmación; nunca escritura directa), pausar,
  // reactivar, ejecutar ahora, «¿cuándo toca?», configuración, última ejecución e historial.
  {
    const nm = foldText(message)
    const AUTO_CTX = /\b(automatizacion(es)?|resumen (ejecutivo )?diario|auditoria|agenda de la manana|tareas vencidas|citas proximas|vencimientos de tramites|reconciliacion|acciones fallidas|operaciones sin movimiento|clientes inactivos|planificador)\b/
    const mentionsAutomation = AUTO_CTX.test(nm) || detectAutomationType(nm) !== null
    const contextHasAutomation = AUTO_CTX.test(foldText(recentContext)) || /\[AUTO(EDIT)?:/.test(recentContext)
    const inScope = mentionsAutomation || contextHasAutomation
    const timeReq = parseTimeEs(message)
    const freqWeekdays = /\b(solo )?(de )?lunes a viernes\b|\bentre semana\b/.test(nm)
    const freqDaily = /\btodos los dias\b|\bcada dia\b/.test(nm)
    const weeklyDay = nm.match(/\btodos los (lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)\b/)?.[1] ?? null
    const WEEKDAY_NUM: Record<string, number> = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sabados: 6, domingo: 7, domingos: 7 }
    const wantsReschedule = /\b(cambia(lo|la)?|pon(lo|la)?|mueve(lo|la)?|pasa(lo|la)?|ajusta(lo|la)?)\b/.test(nm)
      && (timeReq !== null || freqWeekdays || freqDaily || weeklyDay !== null)
      && !/\b(cita|visita|reunion|llamada|tarea|tramite|expediente|precio|valor|zona|nota|cliente|inmueble|operacion)\b/.test(nm)
    const wantsPause = /\b(pausa(la)?|pausar|apaga(la)?|desactiva(la)?|deten(la)?)\b/.test(nm) && mentionsAutomation
    const wantsResume = /\b(reactiva(la)?|reanuda(la)?|enciende(la)?|activa(la)? (otra vez|de nuevo)|vuelve a activar(la)?)\b/.test(nm)
    const wantsRunNow = /\b(ejecuta(la|lo)?|lanza(la|lo)?|corre(la|lo)?)\b/.test(nm) && /\b(ahora|ya)\b/.test(nm)
    const wantsWhen = /\bcuando (se ejecuta|toca|corre|se lanza|sera la proxima)\b/.test(nm) || /\bproxima ejecucion\b/.test(nm)
    const wantsConfig = (/\b(muestrame|ver|ensename|dime|cual es)\b.*\bconfiguracion\b/.test(nm) || /\bcomo esta configurad[oa]\b/.test(nm)) && inScope
    const wantsLastRun = (/\b(que (encontro|detecto)|resultado)\b/.test(nm) && /\b(ultima|ultimo|anoche|ayer)\b/.test(nm)) || /\bultima ejecucion\b/.test(nm)
    const wantsRuns = /\b(muestrame|ver|lista|ensename)\b.*\b(ejecuciones|historial)\b/.test(nm) || /\bsus ejecuciones\b/.test(nm)
    const anyIntent = wantsReschedule || wantsPause || wantsResume || wantsRunNow || wantsWhen || wantsConfig || wantsLastRun || wantsRuns

    if (inScope && anyIntent) {
      const T = 'local_automation:manage'
      const fmtWhen = (iso: unknown) => iso ? new Date(String(iso)).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
      const RUN_STATUS_ES: Record<string, string> = { success: 'correcta', partial: 'parcial', error: 'con error', skipped: 'ventanas omitidas', skipped_duplicate: 'duplicada (omitida)', running: 'en curso' }
      const rulesRes = await actionApi2('automation', { operation: 'list_rules', workspace_id: workspaceId })
      if (rulesRes.status !== 200) return { handled: true, usedTool: T, entity: 'help', answer: 'No he podido consultar tus automatizaciones ahora mismo. Inténtalo de nuevo en un momento.' }
      const rules = (rulesRes.json.rules ?? []) as Array<{ id: string; type: string; name: string; enabled: boolean; schedule_json?: Row; schedule_label?: string; next_run_at: string | null; last_run_at: string | null }>
      if (!rules.length) return { handled: true, usedTool: T, entity: 'help', answer: 'No tienes automatizaciones configuradas todavía. Puedes decirme, por ejemplo: «activa un resumen diario a las 8».' }
      const wantedType = detectAutomationType(nm) ?? (contextHasAutomation ? detectAutomationType(foldText(recentContext)) : null)
      let target = wantedType ? rules.filter((r) => r.type === wantedType) : [...rules]
      if (target.length > 1) { const on = target.filter((r) => r.enabled); if (on.length === 1) target = on }
      if (!target.length) return { handled: true, usedTool: T, entity: 'help', answer: `No tienes una automatización de ${AUTOMATION_LABELS[wantedType ?? ''] ?? 'ese tipo'}. Di «lista mis automatizaciones» para ver las que hay.` }
      if (target.length > 1) {
        return { handled: true, usedTool: T, entity: 'help', answer: `Tienes varias automatizaciones:\n${target.slice(0, 5).map((r) => `• ${r.name}`).join('\n')}\n¿A cuál te refieres?` }
      }
      const rule = target[0]
      const curSchedule = parseScheduleJson(rule.schedule_json) ?? { frequency: 'daily' as const, hour: 8 }
      const cardBase = { ruleId: rule.id, type: rule.type, name: AUTOMATION_LABELS[rule.type] ?? rule.name, timezone: 'Europe/Madrid' as const }

      if (wantsReschedule) {
        const after: ScheduleJson = {
          frequency: weeklyDay ? 'weekly' : freqWeekdays ? 'weekdays' : freqDaily ? 'daily' : curSchedule.frequency,
          hour: timeReq ? timeReq.hour : curSchedule.hour,
          ...(timeReq && timeReq.minute ? { minute: timeReq.minute } : !timeReq && curSchedule.minute ? { minute: curSchedule.minute } : {}),
          ...(weeklyDay ? { weekday: WEEKDAY_NUM[weeklyDay] ?? 1 } : curSchedule.frequency === 'weekly' && !freqWeekdays && !freqDaily ? { weekday: curSchedule.weekday } : {}),
        }
        const prep = await actionApi2('automation', { operation: 'prepare_update_rule', workspace_id: workspaceId, rule_id: rule.id, schedule: after })
        if (prep.status !== 200) {
          const code = String(prep.json.error ?? '')
          return { handled: true, usedTool: T, entity: 'help', answer: code === 'AUTOMATION_INVALID_SCHEDULE' ? String(prep.json.message ?? 'Ese horario no es válido para esta automatización.') : 'No he podido preparar el cambio de horario. No se ha modificado nada.' }
        }
        const before = (prep.json.before ?? {}) as { label?: string }
        const afterJ = (prep.json.after ?? {}) as { label?: string; next_run_at?: string; schedule?: ScheduleJson }
        const hash = String(prep.json.update_hash ?? '')
        const marker = `[AUTOEDIT:${rule.id}:${hash}:h${after.hour}${after.minute ? `:m${after.minute}` : ''}:f${after.frequency}${after.frequency === 'weekly' ? `:w${after.weekday ?? 1}` : ''}]`
        const ui: AssistantUiPayload = { kind: 'automation_preview', automation: { ...cardBase, status: 'awaiting_confirmation', scheduleLabel: String(afterJ.label ?? ''), nextRunAt: afterJ.next_run_at, allowedUiActions: ['confirm', 'cancel'] } }
        return {
          handled: true, usedTool: 'local_automation:edit_preview', entity: 'help',
          answer: `Cambio de horario preparado\n• Automatización: ${cardBase.name}\n• Antes: ${before.label ?? scheduleLabelOf(curSchedule)}\n• Después: ${afterJ.label}\n• Próxima ejecución: ${fmtWhen(afterJ.next_run_at)} (Europe/Madrid)\n\nAún no lo he cambiado. ¿Confirmo? ${marker}`, ui,
        }
      }
      if (wantsPause) {
        const r = await actionApi2('automation', { operation: 'set_rule_enabled', workspace_id: workspaceId, rule_id: rule.id, enabled: false })
        const ok = r.status === 200
        const ui: AssistantUiPayload = { kind: 'automation_status', automation: { ...cardBase, status: ok ? 'disabled' : 'failed', scheduleLabel: String(rule.schedule_label ?? scheduleLabelOf(curSchedule)), allowedUiActions: ok ? ['enable'] : [] } }
        return { handled: true, usedTool: T, entity: 'help', answer: ok ? `Hecho: «${cardBase.name}» queda desactivada (en pausa). Conserva su historial y puedes reactivarla cuando quieras («reactívala»).` : 'No he podido pausarla ahora mismo.', ui }
      }
      if (wantsResume) {
        const r = await actionApi2('automation', { operation: 'set_rule_enabled', workspace_id: workspaceId, rule_id: rule.id, enabled: true })
        const ok = r.status === 200
        const ui: AssistantUiPayload = { kind: 'automation_status', automation: { ...cardBase, status: ok ? 'enabled' : 'failed', scheduleLabel: String(r.json.schedule_label ?? scheduleLabelOf(curSchedule)), nextRunAt: typeof r.json.next_run_at === 'string' ? r.json.next_run_at : undefined, allowedUiActions: ok ? ['run_now', 'view_runs', 'disable'] : [] } }
        return { handled: true, usedTool: T, entity: 'help', answer: ok ? `«${cardBase.name}» vuelve a estar activa.\n• Próxima ejecución: ${fmtWhen(r.json.next_run_at)} (Europe/Madrid; recalculada, nunca una ventana antigua).` : 'No he podido reactivarla ahora mismo.', ui }
      }
      if (wantsRunNow) {
        const r = await actionApi2('automation', { operation: 'run_rule_now', workspace_id: workspaceId, rule_id: rule.id })
        if (r.status !== 200) {
          const code = String(r.json.error ?? '')
          return { handled: true, usedTool: T, entity: 'help', answer: code === 'AUTOMATION_DISABLED' ? `«${cardBase.name}» está en pausa; dime «reactívala» y luego la ejecuto.` : 'No he podido ejecutarla ahora mismo. No se ha registrado ninguna ejecución.' }
        }
        if (r.json.status === 'skipped_duplicate') {
          return { handled: true, usedTool: T, entity: 'help', answer: 'Ya hay una ejecución en marcha de hace unos segundos; no la duplico. Pide «muéstrame sus ejecuciones» para ver el resultado.' }
        }
        const newN = Number(r.json.new_findings ?? 0)
        const dupN = Number(r.json.duplicates ?? 0)
        const st = String(r.json.status ?? 'success')
        const ui: AssistantUiPayload = { kind: 'automation_result', automation: { ...cardBase, status: st === 'success' ? 'completed' : st === 'partial' ? 'partial' : 'failed', scheduleLabel: String(rule.schedule_label ?? scheduleLabelOf(curSchedule)), findingCount: newN, allowedUiActions: ['view_runs'] } }
        const partialNote = st === 'partial' ? ' (alguna fuente no respondió; resultado parcial)' : ''
        return { handled: true, usedTool: 'local_automation:run_now', entity: 'help', answer: `Ejecutada ahora mismo${partialNote}.\n• ${String(r.json.summary ?? '')}\n• Incidencias nuevas: ${newN}${dupN ? ` · ya registradas (no duplicadas): ${dupN}` : ''}`, ui }
      }
      if (wantsWhen || wantsConfig) {
        const def = AUTOMATION_RULES[rule.type as keyof typeof AUTOMATION_RULES]
        const ui: AssistantUiPayload = { kind: 'automation_status', automation: { ...cardBase, status: rule.enabled ? 'enabled' : 'disabled', scheduleLabel: String(rule.schedule_label ?? scheduleLabelOf(curSchedule)), nextRunAt: rule.enabled ? rule.next_run_at ?? undefined : undefined, lastRunAt: rule.last_run_at ?? undefined, allowedUiActions: rule.enabled ? ['run_now', 'view_runs', 'disable'] : ['enable'] } }
        const lines = [
          `«${cardBase.name}» — ${rule.enabled ? 'activa' : 'en pausa'}.`,
          `• Horario: ${rule.schedule_label ?? scheduleLabelOf(curSchedule)} (Europe/Madrid)`,
          rule.enabled ? `• Próxima ejecución: ${fmtWhen(rule.next_run_at)}` : '• No se ejecutará hasta que la reactives.',
          ...(wantsConfig && def ? [`• Qué vigila: ${def.criterion}`] : []),
        ]
        return { handled: true, usedTool: T, entity: 'help', answer: lines.join('\n'), ui }
      }
      if (wantsLastRun || wantsRuns) {
        const r = await actionApi2('automation', { operation: 'list_runs', workspace_id: workspaceId, rule_id: rule.id, limit: wantsRuns ? 5 : 1 })
        const runs = (r.json.runs ?? []) as Array<{ status: string; scheduled_for: string; started_at: string; finished_at: string | null; result_count: number | null }>
        if (!runs.length) return { handled: true, usedTool: T, entity: 'help', answer: `«${cardBase.name}» todavía no se ha ejecutado. Puedes decirme «ejecútala ahora».` }
        if (wantsLastRun) {
          const lr = runs[0]
          return { handled: true, usedTool: T, entity: 'help', answer: `Última ejecución de «${cardBase.name}»: ${fmtWhen(lr.started_at)} — ${RUN_STATUS_ES[lr.status] ?? lr.status}.\n• Incidencias nuevas: ${lr.result_count ?? 0}.\nPide «¿qué incidencias hay?» para ver el detalle.` }
        }
        const lines = runs.map((x) => `• ${fmtWhen(x.started_at)} — ${RUN_STATUS_ES[x.status] ?? x.status}${x.result_count != null ? ` · ${x.result_count} incidencia(s)` : ''}`)
        return { handled: true, usedTool: T, entity: 'help', answer: `Ejecuciones de «${cardBase.name}»:\n${lines.join('\n')}` }
      }
    }
  }

  // P62 — OFERTA → ACEPTACIÓN. «ofréceme algo» → propuesta concreta. «sí/venga/muéstramela» tras una
  // oferta → ejecutar la lectura ofrecida (nunca re-explicar, nunca n8n sin plan). Referencia ambigua con
  // varias opciones → UNA aclaración concreta. Solo en turnos sin objetivo explícito propio.
  if ((turn.turnType === 'ambiguous' || turn.turnType === 'social' || turn.turnType === 'data_followup') && turn.domain !== 'invoicing') {
    if (detectOfferRequest(message)) {
      return { handled: true, usedTool: 'local_offer:suggest', entity: 'help', answer: suggestionsAnswer() }
    }
    const acc = detectAcceptance(message)
    if (acc) {
      const offered = resolveOfferedModules(recentContext)
      if (offered.length === 1 && offered[0]) {
        return executeOfferedModule(supabase, workspaceId, offered[0])
      }
      if (offered.length > 1) {
        // Referencia por módulo explícito en la aceptación («venga, las citas»).
        const explicit = resolveModuleFromText(message)
        if (explicit && offered.includes(explicit)) return executeOfferedModule(supabase, workspaceId, explicit)
        // «muéstramela» (singular femenino) → la cartera es la única opción singular femenina de la oferta.
        if (acc.sing && acc.fem && offered.includes('portfolio')) return executeOfferedModule(supabase, workspaceId, 'portfolio')
        const labels: Record<string, string> = { portfolio: 'la cartera', operations: 'las operaciones', calendar: 'las citas', clients: 'los clientes', tasks: 'las tareas', cases: 'los trámites', dashboard: 'el resumen del día' }
        const opts = offered.filter(Boolean).map((m) => labels[m as string] ?? m).join(', ')
        return { handled: true, usedTool: 'local_offer:clarify', entity: 'help', answer: `¿Cuál te muestro: ${opts}?` }
      }
      // No hay oferta previa: si el mensaje trae módulo explícito («venga, la cartera»), ejecutarlo.
      const explicit = resolveModuleFromText(message)
      if (explicit) return executeOfferedModule(supabase, workspaceId, explicit)
    }
  }

  // P58 — VENTAS/VENDIDOS transversal: se resuelve ANTES del enrutado por entidad porque «vendido/ventas/
  // he vendido» no tiene vocab de módulo → el clasificador lo marcaba unknown/ambiguous y caía a n8n (que
  // alucinaba «no consta ninguna operación vendida»). Solo en turnos de datos/ambiguo (nunca meta/guía/
  // social/corrección, que no leen), y nunca en Facturación.
  const SALES_TURNS = new Set<TurnType>(['data_read', 'data_followup', 'ambiguous'])
  if (SALES_TURNS.has(turn.turnType) && turn.domain !== 'invoicing') {
    // P70 Wave D — CREACIÓN de automatización ANTES del parser de ventas: «activa la reconciliación de
    // operaciones ganadas» es un imperativo de automatización inequívoco (verbo de activación + tipo
    // del registry), no una consulta de ventas.
    const nmsgAuto = foldText(message)
    // P71 — morfología abierta («actívame», «créame», «prográmame»): sufijo \w*, no formas exactas.
    if (/\b(activa\w*|crea\w*|programa\w*|configura\w*|quiero)\b/.test(nmsgAuto) && !/\botra vez\b|\bde nuevo\b/.test(nmsgAuto) && detectAutomationType(nmsgAuto) !== null) {
      const early = handleAutomationCreatePreview(nmsgAuto)
      if (early) return early
    }
    // priorWasSales: si la respuesta anterior fue de ventas, una corrección de solo alcance
    // («te he preguntado por cartera») se reinterpreta como ventas con ese alcance.
    const priorWasSales = /\b(vendid|ventas|operaciones ganadas|estado vendido|operacion(es)? ganad|cerradas con exito)\b/.test(foldText(recentContext))
    const sales = parseSalesIntent(message, { priorWasSales })
    if (sales) return handleSales(supabase, workspaceId, sales)

    // P61 — AGENDA (citas + tareas), RESUMEN de módulo con datos, y FICHA de entidad — resueltos localmente
    // y en vivo, ANTES del enrutado por entidad (para no caer a n8n en preguntas binarias/multi-fuente/detalle).
    const nmsg = foldText(message)
    // P64 — RESUMEN OPERATIVO GLOBAL («resumen del día con mis datos», «resumen ejecutivo», «cómo va el
    // negocio», «ponme al día»): antes caía a n8n (entity unknown). Multi-fuente local con degradación
    // parcial. Solo si NO nombra un módulo concreto (eso lo maneja su handler).
    const summaryKind = classifySummaryIntent(message)
    const explicitExec = /\b(resumen (ejecutivo|del negocio|general de (mis datos|todo))|como va (el negocio|todo el negocio)|estado general del crm|ponme al dia con mis datos)\b/.test(foldText(message))
    if (explicitExec || (summaryKind === 'operational' && (!resolveModuleFromText(message) || resolveModuleFromText(message) === 'dashboard'))) {
      return handleExecutiveSummary(supabase, workspaceId)
    }

    // P69 — AUTOMATIZACIONES DESDE EL CHAT (opt-in con preview + confirmación; endpoint P68 real).
    // «activa un resumen diario a las 8» → preview; «sí, confirma» tras el preview → create_rule
    // confirmed:true. «lista mis automatizaciones» / «desactiva …» también soportados.
    const autoIntent = (() => {
      if (/\b(lista|muestra|ver|cuales son)\b.*\bautomatizacion(es)?\b/.test(nmsg) || /\bmis automatizaciones\b/.test(nmsg)) return { kind: 'list' as const }
      // P70 Wave D — creación para CUALQUIER tipo del registry (vocabulario canónico) + frecuencia.
      // P71 — morfología abierta («actívame», «créame»): sufijo \w*.
      if (/\b(activa\w*|crea\w*|programa\w*|configura\w*|quiero)\b/.test(nmsg) && !/\botra vez\b|\bde nuevo\b/.test(nmsg) && detectAutomationType(nmsg) !== null) {
        return { kind: 'activate' as const }
      }
      if (/\bdesactiva\b.*\b(resumen|auditoria|automatizacion|aviso)\b/.test(nmsg)) return { kind: 'disable' as const }
      return null
    })()
    if (autoIntent) {
      if (autoIntent.kind === 'list') {
        const r = await actionApi2('automation', { operation: 'list_rules', workspace_id: workspaceId })
        const rules = (r.json.rules ?? []) as Array<{ type: string; name: string; enabled: boolean; next_run_at: string | null }>
        if (!rules.length) return { handled: true, usedTool: 'local_automation', entity: 'help', answer: 'No tienes automatizaciones configuradas. Puedes decirme, por ejemplo: «activa una auditoría de calidad diaria a las 8».' }
        const lines = rules.map((x) => `• ${x.name} — ${x.enabled ? 'activa' : 'desactivada'}${x.enabled && x.next_run_at ? ` · próxima: ${String(x.next_run_at).slice(0, 16).replace('T', ' ')}` : ''}`)
        return { handled: true, usedTool: 'local_automation', entity: 'help', answer: `Tus automatizaciones:\n${lines.join('\n')}` }
      }
      if (autoIntent.kind === 'disable') {
        const r = await actionApi2('automation', { operation: 'list_rules', workspace_id: workspaceId })
        const rules = (r.json.rules ?? []) as Array<{ id: string; type?: string; name: string; enabled: boolean }>
        const on = rules.filter((x) => x.enabled)
        if (!on.length) return { handled: true, usedTool: 'local_automation', entity: 'help', answer: 'No hay automatizaciones activas que desactivar.' }
        const off = await actionApi2('automation', { operation: 'set_rule_enabled', workspace_id: workspaceId, rule_id: on[0].id, enabled: false })
        const ok = off.status === 200
        const ui: AssistantUiPayload = { kind: 'automation_status', automation: { ruleId: on[0].id, type: String(on[0].type ?? 'automation'), name: on[0].name, status: ok ? 'disabled' : 'failed', scheduleLabel: '', timezone: 'Europe/Madrid', allowedUiActions: [] } }
        return { handled: true, usedTool: 'local_automation', entity: 'help', answer: ok ? `Hecho: «${on[0].name}» queda desactivada. No se ejecutará más hasta que la reactives.` : 'No he podido desactivarla ahora mismo.', ui }
      }
      // activate → PREVIEW (opt-in: nunca se crea sin confirmación). El bloque `ui` alimenta la card;
      // el marcador [AUTO:…] queda en el texto persistido (la UI lo oculta al renderizar).
      const preview = handleAutomationCreatePreview(nmsg)
      if (preview) return preview
    }
    // Confirmación de una automatización previamente previsualizada (CREACIÓN o EDICIÓN de horario).
    // Solo si el ÚLTIMO marcador del hilo es un preview VIVO ([AUTO:cancelled]/[AUTO:done] neutralizan).
    // Tras aplicar, la respuesta deja [AUTO:done] para que un «confirma» posterior no re-aplique nada.
    if (/^(si|sí)?[\s,]*(confirma(lo)?|confirmo|adelante|activa(la)?|dale|hazlo)\b/.test(nmsg.trim())) {
      const live = lastLiveAutoMarker(recentContext)
      if (live?.kind === 'create') {
        const schedule = { hour: live.hour, ...(live.minute ? { minute: live.minute } : {}), frequency: live.frequency, ...(live.frequency === 'weekly' ? { weekday: live.weekday ?? 1 } : {}) }
        const r = await actionApi2('automation', { operation: 'create_rule', workspace_id: workspaceId, type: live.type, confirmed: true, schedule })
        if (r.status === 200) {
          const nextRunAt = typeof r.json.next_run_at === 'string' ? r.json.next_run_at : undefined
          const schLabel = String(r.json.schedule_label ?? scheduleLabelOf(schedule as ScheduleJson))
          const ui: AssistantUiPayload = { kind: 'automation_result', automation: { ruleId: typeof r.json.rule_id === 'string' ? r.json.rule_id : undefined, type: live.type, name: AUTOMATION_LABELS[live.type] ?? 'Automatización', status: 'enabled', scheduleLabel: schLabel, timezone: 'Europe/Madrid', nextRunAt, allowedUiActions: ['run_now', 'view_runs', 'disable'] } }
          return { handled: true, usedTool: 'local_automation:confirm', entity: 'help', answer: `Automatización activada y programada.\n• Horario: ${schLabel} (Europe/Madrid)\n• Próxima ejecución: ${String(r.json.next_run_at ?? '').slice(0, 16).replace('T', ' ')}\nEl planificador la ejecutará automáticamente; los resultados aparecerán como incidencias. Puedes decir «lista mis automatizaciones», «cámbiala a las 9», «ejecútala ahora» o «desactívala». [AUTO:done]`, ui }
        }
        return { handled: true, usedTool: 'local_automation:confirm', entity: 'help', answer: 'No he podido activar la automatización ahora mismo. No se ha creado nada; inténtalo de nuevo.' }
      }
      if (live?.kind === 'edit') {
        const schedule = { hour: live.hour, ...(live.minute ? { minute: live.minute } : {}), frequency: live.frequency, ...(live.frequency === 'weekly' ? { weekday: live.weekday ?? 1 } : {}) }
        const r = await actionApi2('automation', { operation: 'confirm_update_rule', workspace_id: workspaceId, rule_id: live.ruleId, update_hash: live.hash, confirmed: true, schedule })
        if (r.status === 200) {
          const schLabel = String(r.json.schedule_label ?? '')
          const nextRunAt = typeof r.json.next_run_at === 'string' ? r.json.next_run_at : undefined
          const name = AUTOMATION_LABELS[String(r.json.type ?? '')] ?? String(r.json.name ?? 'Automatización')
          const ui: AssistantUiPayload = { kind: 'automation_status', automation: { ruleId: live.ruleId, type: String(r.json.type ?? 'automation'), name, status: r.json.enabled === true ? 'enabled' : 'disabled', scheduleLabel: schLabel, timezone: 'Europe/Madrid', nextRunAt, allowedUiActions: ['run_now', 'view_runs', 'disable'] } }
          return { handled: true, usedTool: 'local_automation:edit_confirm', entity: 'help', answer: `Horario actualizado y verificado.\n• Nuevo horario: ${schLabel} (Europe/Madrid)\n• Próxima ejecución: ${String(r.json.next_run_at ?? '').slice(0, 16).replace('T', ' ')} [AUTO:done]`, ui }
        }
        if (String(r.json.error ?? '') === 'AUTOMATION_UPDATE_CONFLICT') {
          return { handled: true, usedTool: 'local_automation:edit_confirm', entity: 'help', answer: 'La automatización cambió después del preview y no he aplicado nada. Pídeme el cambio de horario otra vez. [AUTO:cancelled]' }
        }
        return { handled: true, usedTool: 'local_automation:edit_confirm', entity: 'help', answer: 'No he podido cambiar el horario. La automatización sigue como estaba. [AUTO:cancelled]' }
      }
    }

    // P67 — INTELIGENCIA PROACTIVA: «¿qué requiere atención?», «¿qué incidencias hay?», «auditoría de
    // calidad» → auditoría VIVA (reglas objetivas con criterio) + findings abiertos, con dedupe.
    if (/\b(que requiere atencion|que necesita atencion|incidencias|auditoria de (calidad|datos)|revisa la calidad|problemas de datos|que deberia revisar)\b/.test(nmsg)) {
      const secretOk = !!process.env.AGENT_TOOL_SECRET
      if (secretOk) {
        const r = await actionApi2('automation', { operation: 'run_data_quality', workspace_id: workspaceId })
        if (r.status === 200) {
          const open = (r.json.open_findings ?? []) as Array<{ id?: string; finding_type?: string; entity_type?: string | null; title: string; summary: string; severity: string; detected_at?: string }>
          // P70 Wave A — bloque estructurado de findings (la card y el centro los consumen; el texto queda de fallback).
          const toUiFinding = (f: typeof open[number]) => {
            const [sum, crit] = String(f.summary ?? '').split(/\s*Criterio:\s*/)
            return {
              findingId: String(f.id ?? f.title), severity: (f.severity === 'critical' || f.severity === 'warning' ? f.severity : 'info') as 'critical' | 'warning' | 'info',
              status: 'open' as const, title: String(f.title), summary: (sum ?? '').trim(),
              criterion: (crit ?? 'Regla objetiva registrada en el CRM').trim(), module: f.entity_type ? String(f.entity_type) : undefined,
              detectedAt: String(f.detected_at ?? ''), allowedUiActions: [],
            }
          }
          if (!open.length) {
            const ui: AssistantUiPayload = { kind: 'finding', findings: [] }
            return { handled: true, usedTool: 'local_findings', entity: 'help', answer: 'He revisado la calidad de tus datos ahora mismo y no hay incidencias abiertas. Todo cuadra: operaciones, inmuebles, precios y tareas.', ui }
          }
          const sev = (s: string) => s === 'critical' ? 'CRÍTICO' : s === 'warning' ? 'aviso' : 'info'
          const lines = open.slice(0, 8).map((f) => `• [${sev(f.severity)}] ${f.title}`)
          const ui: AssistantUiPayload = { kind: 'finding', findings: open.slice(0, 8).map(toUiFinding) }
          return { handled: true, usedTool: 'local_findings', entity: 'help', answer: `He revisado tus datos ahora mismo. Incidencias abiertas: ${open.length}\n${lines.join('\n')}\n\nCada una tiene su criterio registrado; dime cuál quieres revisar y te doy el detalle.`, ui }
        }
      }
      return { handled: true, usedTool: 'local_findings', entity: 'help', answer: 'No he podido ejecutar la auditoría ahora mismo. Puedes pedírmelo de nuevo en un momento.' }
    }

    // P63: PROHIBIDO `to ?do` — hacía match con la palabra española «todo» («lístame TODO lo que tengo en
    // inmuebles» → secuestro por Tareas). Además, el módulo EXPLÍCITO del mensaje actual manda: si nombra
    // inmuebles/cartera, los gates de agenda NO aplican salvo consulta combinada expresa.
    const mentionsPortfolio = PROPERTY_VOCAB.test(nmsg)
    const mentionsCitas = !mentionsPortfolio && /\b(citas?|calendario|agenda|reunion(es)?|visitas?)\b/.test(nmsg)
    const mentionsTareas = !mentionsPortfolio && /\b(tareas?|pendientes?|to-do|checklist)\b/.test(nmsg)
    const agendaGeneric = !mentionsPortfolio && /\b(que tengo (pendiente|proximo|para hoy|hoy|esta semana|en la agenda|manana)|tengo algo (pendiente|proximo|hoy|manana)|que hay (hoy|manana|en la agenda)|mi agenda|proximamente)\b/.test(nmsg)
    // Existencia O verbo de lectura («en el calendario me puedes mirar?» debe leer, answer-first).
    const asksExistence = /\b(tengo|tienes|tenemos|hay|queda(n)?|proximas?|proximos?|pendientes?|alguna|algun|cuant[oa]s|o no|mira(me|lo|la)?|mirar|muestra(me)?|ensename|ver|consulta|revisa|lee|dime)\b/.test(nmsg)
    // P71·It2 — alcance temporal explícito en la consulta («citas de esta semana», «tareas de hoy»): se acota
    // la lectura al periodo y se registra en el estado para poder continuar («¿y la siguiente?»).
    const agendaScope = parseAbsoluteTemporal(message, today, turnId)
    if (agendaGeneric || (mentionsCitas && mentionsTareas)) return handleAgenda(supabase, workspaceId, { calendar: true, tasks: true }, { scope: agendaScope, turnId })
    if (mentionsCitas && !mentionsTareas && asksExistence) return handleAgenda(supabase, workspaceId, { calendar: true, tasks: false }, { scope: agendaScope, turnId })
    if (mentionsTareas && !mentionsCitas && asksExistence) return handleAgenda(supabase, workspaceId, { calendar: false, tasks: true }, { scope: agendaScope, turnId })

    // P63 — Cartera con intención de ESTADO en turno ambiguo («todo lo de propiedades»): la resuelve el
    // handler de properties (listado por estado), nunca n8n ni otro módulo.
    if (parseStatusIntent(message) && PROPERTY_VOCAB.test(nmsg)) {
      return handleProperties(supabase, workspaceId, message)
    }

    // Resumen de Cartera con datos: «resumen de mi cartera», «cómo está mi cartera», «qué tengo en cartera».
    const portfolioSummary = /\b(cartera|inmuebles|propiedades)\b/.test(nmsg)
      && /\b(resumen|como (esta|va|van)|que tengo en|estado de|todo (lo que hay|eso)|de inmuebles)\b/.test(nmsg)
      && !parseStatusIntent(message)
    if (portfolioSummary) return handlePortfolioSummary(supabase, workspaceId)

    // Ficha/detalle de un cliente concreto: «ficha (completa) de X», «imprime toda la ficha de X».
    const detailName = extractDetailName(message)
    if (detailName) return handleClientDetail(supabase, workspaceId, detailName)
  }

  switch (turn.turnType) {
    case 'social': {
      const isThanks = /\b(gracias|genial|perfecto|estupendo|entendido|de acuerdo|okay)\b/.test(foldText(message))
      return { handled: true, usedTool: 'local_turn:social', entity: 'help', answer: isThanks ? smalltalkAnswer() : greetingAnswer() }
    }
    case 'help': return helpAnswer()
    case 'capability': return { handled: true, usedTool: 'local_turn:capability', entity: topicEntity, answer: capabilityAnswer(topicEntity) }
    case 'how_it_works':
      // Con módulo resuelto, la explicación sale del catálogo (más rica y consistente).
      if (turn.module) return { handled: true, usedTool: 'local_turn:how', entity: topicEntity, answer: explainModule(turn.module) }
      return { handled: true, usedTool: 'local_turn:how', entity: topicEntity, answer: howItWorksAnswer(topicEntity) }
    // P53/P60 — guía de producto: SIEMPRE explican, NUNCA leen. Tour completo si lo pide («resumen de
    // todo el CRM», «tour»); si no, bienvenida corta. El módulo resuelto («empezando por Dashboard») es
    // el punto de partida del recorrido.
    case 'onboarding':
      return wantsFullTour(message)
        ? { handled: true, usedTool: 'local_turn:tour', entity: 'help', answer: generateFullCrmTour(turn.module ?? undefined) }
        : { handled: true, usedTool: 'local_turn:onboarding', entity: 'help', answer: onboardingAnswer() }
    case 'module_explanation': {
      if (turn.module) return { handled: true, usedTool: 'local_turn:module', entity: topicEntity, answer: explainModule(turn.module) }
      // «explícame el CRM / la aplicación» (sin módulo concreto) → visión general, no «¿qué pantalla?».
      const general = /\b(crm|aplicacion|app|programa|sistema|herramienta|plataforma)\b/.test(foldText(message))
      return { handled: true, usedTool: 'local_turn:module', entity: topicEntity, answer: general ? onboardingAnswer() : confusedAnswer(null) }
    }
    case 'navigation_help':
      return { handled: true, usedTool: 'local_turn:navigation', entity: topicEntity, answer: turn.module ? navigationAnswer(turn.module) : confusedAnswer(null) }
    case 'user_confused': return { handled: true, usedTool: 'local_turn:confused', entity: 'help', answer: confusedAnswer(turn.module) }
    case 'hypothetical': return { handled: true, usedTool: 'local_turn:future', entity: topicEntity, answer: futureAnswer(topicEntity) }
    case 'assistant_meta': return { handled: true, usedTool: 'local_turn:meta', entity: 'help', answer: assistantMetaAnswer(turn.domain) }
    case 'user_correction': return { handled: true, usedTool: 'local_turn:correction', entity: topicEntity, answer: userCorrectionAnswer(turn.domain) }
    case 'user_complaint': return { handled: true, usedTool: 'local_turn:complaint', entity: 'help', answer: userComplaintAnswer() }
    case 'disagreement': return { handled: true, usedTool: 'local_turn:disagreement', entity: 'help', answer: disagreementAnswer() }
    case 'data_write': return { handled: false } // escritura → cerebro general / fallback determinista
    case 'ambiguous':
      // P60 — «hazme un resumen» a secas: NO se lee a ciegas; se pregunta conceptual vs datos.
      if (turn.reason === 'p60:ambiguous-summary') {
        return { handled: true, usedTool: 'local_turn:summary-clarify', entity: 'help', answer: '¿Quieres un resumen para **entender** el CRM (cómo funciona) o un resumen con **tus datos actuales** (tareas, citas y operaciones de hoy)?' }
      }
      return { handled: false } // cerebro general (nunca lectura a ciegas)
    default: break // data_read / data_followup → enrutado de datos
  }

  // Facturación aislada (data_read invoicing → redirección, sin tools de lectura).
  if (turn.domain === 'invoicing') return invoicingRedirect()

  const intent = classifyIntent(message, { priorEntity })
  if (intent.entity === 'help' || intent.entity === 'unknown') return { handled: false }

  // Política de contexto / anti-contradicción para seguimientos.
  const prior: PriorRead = Array.isArray(opts.lastResults) && opts.lastResults.length
    ? { entity: priorEntity ?? intent.entity, count: opts.lastResults.length, ok: true }
    : null
  const ctxDecision = decideFollowUp({ followUpType: intent.followUpType, prior })

  // Enrutado local por entidad.
  const runFresh = async (): Promise<LocalAnswer> => {
    switch (intent.entity) {
      case 'clients': return handleClients(supabase, workspaceId, intent)
      case 'properties': return handleProperties(supabase, workspaceId, message)
      case 'commissions': return commissionsRedirectFallback()
      case 'operations':
        return handleList(supabase, workspaceId, 'operations', 'local_operations',
          async () => { const r = await crmReadQuery(supabase, workspaceId, { entity: 'opportunities', limit: 10 }); return 'error' in r ? { error: true } : { rows: r.rows } },
          formatOperationLine, 'operación', 'operaciones')
      case 'calendar':
        return handleList(supabase, workspaceId, 'calendar', 'local_calendar',
          async () => { const r = await getCalendarSummary(supabase, workspaceId, { range: 'this week' }); return 'error' in r ? { error: true } : { rows: r.events as unknown as Row[] } },
          formatEventLine, 'cita', 'citas')
      case 'tasks':
        return handleList(supabase, workspaceId, 'tasks', 'local_tasks',
          async () => { const r = await getPendingTasks(supabase, workspaceId, {}); return 'error' in r ? { error: true } : { rows: r.tasks as unknown as Row[] } },
          formatTaskLine, 'tarea pendiente', 'tareas pendientes')
      case 'service_cases':
        return handleList(supabase, workspaceId, 'service_cases', 'local_cases',
          async () => { const r = await crmReadQuery(supabase, workspaceId, { entity: 'service_cases', limit: 10 }); return 'error' in r ? { error: true } : { rows: r.rows } },
          formatCaseLine, 'trámite', 'trámites')
      case 'documents':
        return handleList(supabase, workspaceId, 'documents', 'local_documents',
          async () => { const r = await getDocumentsMetadata(supabase, workspaceId, {}); return 'error' in r ? { error: true } : { rows: r.documents as unknown as Row[] } },
          formatDocLine, 'documento', 'documentos')
      default: return { handled: false }
    }
  }

  // P71 — GROUNDING + aclaración inteligente (tras definir runFresh):
  // · confirm_prior («¿seguro?/confírmame»): RECONSULTA la fuente en vivo — jamás repite el conteo cacheado.
  // · ask_clarify: si el mensaje NOMBRA una entidad concreta (adjetivo atributivo tipo «operaciones
  //   abiertas»), se lee fresco; solo se pide aclaración si de verdad no hay entidad reconocible.
  if (ctxDecision === 'confirm_prior') return await runFresh()
  if (ctxDecision === 'ask_clarify') {
    const ownEntity = classifyIntent(message).entity
    if (ownEntity === 'help' || ownEntity === 'unknown') {
      return { handled: true, usedTool: 'local_context', entity: intent.entity, answer: 'No estoy seguro de a qué te refieres. ¿Hablamos de clientes, inmuebles, operaciones o citas?' }
    }
    // el mensaje nombra la entidad → cae a lectura fresca (runFresh) abajo.
  }

  const fresh = await runFresh()
  // Anti-contradicción: si el seguimiento se re-consultó y falló pero había un resultado válido, no lo
  // sustituimos por un error; lo conservamos con un prefacio honesto.
  if (fresh.handled && intent.followUpType !== 'none' && prior && prior.ok) {
    const freshFailed = /Código: [A-Z_]+/.test(fresh.answer)
    if (freshFailed && shouldAnswerFromPrior(decideFollowUp({ followUpType: intent.followUpType, prior, freshOk: false }))) {
      return { handled: true, usedTool: 'local_context', entity: prior.entity, answer: `${stalePreface()}\n${confirmPriorText(prior)}` }
    }
  }
  return fresh
}
