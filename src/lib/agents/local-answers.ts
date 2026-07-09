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
  type SearchPropertyItem,
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

export type LocalAnswer =
  | { handled: true; answer: string; usedTool: string; entity: CrmEntity; referencedList?: Array<Record<string, unknown>> }
  | { handled: false }

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
export async function tryLocalAnswer(
  supabase: SupabaseClient,
  workspaceId: string,
  message: string,
  opts: { recentContext?: string; lastResults?: unknown[] } = {},
): Promise<LocalAnswer> {
  const recentContext = opts.recentContext ?? ''

  // ── P50: DECISIÓN ÚNICA DE TURNO — razona el acto comunicativo ANTES de leer/escribir/llamar a n8n ──
  // Ninguna entidad del CRM provoca una consulta por sí sola. Los turnos META (el usuario habla de la
  // respuesta del Asistente, corrige, se queja o discrepa) y los conceptuales (capacidad/cómo-funciona/
  // futuro/social/ayuda) se responden SIN leer datos, aunque mencionen cualquier entidad.
  const priorEntity = recentContext ? classifyIntent(recentContext).entity : undefined
  // P53/P56 — módulo del contexto: se hereda el del ÚLTIMO mensaje del hilo que nombre un módulo (no el
  // alias más largo de toda la conversación — evita que «no entiendo» tras hablar de Cartera salte a otro
  // módulo mencionado antes). Si el mensaje nombra uno nuevo, gana el nuevo (sin arrastre).
  const priorModule = (() => {
    if (!recentContext) return null
    const lines = recentContext.split('\n').map((l) => l.trim()).filter(Boolean)
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

  // P58 — VENTAS/VENDIDOS transversal: se resuelve ANTES del enrutado por entidad porque «vendido/ventas/
  // he vendido» no tiene vocab de módulo → el clasificador lo marcaba unknown/ambiguous y caía a n8n (que
  // alucinaba «no consta ninguna operación vendida»). Solo en turnos de datos/ambiguo (nunca meta/guía/
  // social/corrección, que no leen), y nunca en Facturación.
  const SALES_TURNS = new Set<TurnType>(['data_read', 'data_followup', 'ambiguous'])
  if (SALES_TURNS.has(turn.turnType) && turn.domain !== 'invoicing') {
    // priorWasSales: si la respuesta anterior fue de ventas, una corrección de solo alcance
    // («te he preguntado por cartera») se reinterpreta como ventas con ese alcance.
    const priorWasSales = /\b(vendid|ventas|operaciones ganadas|estado vendido|operacion(es)? ganad|cerradas con exito)\b/.test(foldText(recentContext))
    const sales = parseSalesIntent(message, { priorWasSales })
    if (sales) return handleSales(supabase, workspaceId, sales)
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
  if (ctxDecision === 'confirm_prior') {
    return { handled: true, usedTool: 'local_context', entity: prior?.entity ?? intent.entity, answer: confirmPriorText(prior) }
  }
  if (ctxDecision === 'ask_clarify') {
    return { handled: true, usedTool: 'local_context', entity: intent.entity, answer: 'No estoy seguro de a qué te refieres. ¿Hablamos de clientes, inmuebles, operaciones o citas?' }
  }

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
