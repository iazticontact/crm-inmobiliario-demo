// Server-only readers used by /api/agent/tool to serve the n8n CRM Agent Brain.
//
// Every reader:
//   - Is READ-ONLY. No inserts, updates, deletes.
//   - Is workspace-scoped via `.eq('workspace_id', workspaceId)` on EVERY query.
//   - Never returns tokens, signed URLs, raw notes or PII beyond what the
//     brain needs to reason. String fields are length-clamped.
//   - Returns a shape-stable JSON object. Errors are returned as
//     `{ error: <code>, message: <safe copy> }` — never throws.
//
// The supabase client passed in is the SERVICE-ROLE client built by
// /api/agent/tool. RLS is bypassed by service role; workspace scoping is
// enforced manually here on every query, no exceptions.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildCriteriaFromText, normalizePropertyType, normalizeOperation, rankProperties, foldText,
  type PropertyCriteria, type AvailabilityMode, type ScorableProperty, type RankedProperty,
} from '@/lib/real-estate-search'

// Versión del CONTRATO de salida de las tools read-only (P24). Se incluye en `meta.toolVersion` de cada
// respuesta y la expone /api/agent/diag, para que se pueda verificar que el backend desplegado al que
// llama n8n (CRM_BASE_URL) es el esperado. Súbela cuando cambie el contrato de forma incompatible.
export const TOOL_CONTRACT_VERSION = '2026-07-14.p69'

type Row = Record<string, unknown>
type Json = unknown

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function asPositiveInt(v: unknown, def: number, max: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.min(Math.floor(v), max)
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), max)
  }
  return def
}

function clampString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function parseIsoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return null
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null
  return v
}

function todayMadridIso(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Interpreta una palabra clave de rango temporal en Europe/Madrid → { from, to } (ISO yyyy-mm-dd,
// día completo local). Semana natural lunes–domingo. Acepta español e inglés (el LLM puede enviar
// cualquiera). Devuelve null si no reconoce la palabra (el llamante usa from/to explícitos).
export function madridDateRange(keyword: string, todayIso: string): { from: string; to: string } | null {
  const k = (keyword || '').toLowerCase().trim().replace(/\s+/g, ' ')
  if (!k) return null
  const dow = new Date(`${todayIso}T00:00:00Z`).getUTCDay() // 0=domingo … 6=sábado
  const sinceMonday = (dow + 6) % 7
  const monday = addDaysIso(todayIso, -sinceMonday)
  switch (k) {
    case 'today': case 'hoy': case 'ahora': case 'ya':
      return { from: todayIso, to: todayIso }
    case 'tomorrow': case 'mañana': case 'manana':
      return { from: addDaysIso(todayIso, 1), to: addDaysIso(todayIso, 1) }
    case 'day after tomorrow': case 'pasado mañana': case 'pasado manana':
      return { from: addDaysIso(todayIso, 2), to: addDaysIso(todayIso, 2) }
    case 'this week': case 'esta semana': case 'la semana': case 'semana':
      return { from: monday, to: addDaysIso(monday, 6) }
    case 'next week': case 'la semana que viene': case 'semana que viene': case 'proxima semana': case 'próxima semana':
      return { from: addDaysIso(monday, 7), to: addDaysIso(monday, 13) }
    case 'next 7 days': case 'proximos 7 dias': case 'próximos 7 días': case 'proximos dias': case 'próximos días': case 'proximos días': case 'estos dias': case 'estos días':
      return { from: todayIso, to: addDaysIso(todayIso, 7) }
    case 'this month': case 'este mes': {
      const [y, m] = todayIso.split('-').map(Number)
      const first = `${y}-${String(m).padStart(2, '0')}-01`
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
      return { from: first, to: last }
    }
    default:
      return null
  }
}

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clientIdFromInput(input: Json): { clientId?: string; error?: ReaderError } {
  const raw = asString(asObject(input).clientId)
  if (!raw) return {}
  if (!isUuid(raw)) {
    return { error: { error: 'invalid_input', message: 'clientId tiene que ser un UUID válido o nulo.' } }
  }
  return { clientId: raw }
}

export type ReaderError = { error: string; message: string }
export type ReaderResult<T> = T | ReaderError

export function isReaderError<T>(r: ReaderResult<T>): r is ReaderError {
  return Boolean(r && typeof r === 'object' && 'error' in (r as Record<string, unknown>))
}

// ─────────────────────────────────────────────────────────────── get_crm_overview

export type CrmOverview = {
  clients: {
    total: number
    recent: Array<{
      id: string
      name: string
      company: string | null
      status: string | null
      lead_score: number | null
      created_at: string | null
    }>
  }
  tasks: {
    pendingCount: number
    upcoming: Array<{
      id: string
      title: string
      due_date: string | null
      client_id: string | null
      client_name: string | null
      status: string | null
    }>
  }
  calendar: {
    upcomingCount: number
    upcoming: Array<{
      id: string
      title: string
      start_at: string | null
      end_at: string | null
      client_name: string | null
      status: string | null
    }>
  }
  activity: {
    recent: Array<{
      id: string
      type: string | null
      description: string | null
      client_name: string | null
      created_at: string | null
    }>
  }
  conversations: {
    openCount: number
    recent: Array<{
      id: string
      channel: string | null
      status: string | null
      sentiment: string | null
      intent: string | null
      ai_summary: string | null
      updated_at: string | null
    }>
  }
}

export async function getCrmOverview(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<CrmOverview> {
  const todayIso = todayMadridIso()

  // Facturación NO se lee desde el Asistente (P35: módulo aislado). Sin query a `invoices`.
  const [clients, tasks, events, activities, conversations] = await Promise.all([
    supabase.from('clients')
      .select('id, name, company, status, lead_score, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('tasks')
      .select('id, title, due_date, client_id, client_name, status, priority, created_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(20),
    supabase.from('calendar_events')
      .select('id, title, date, start_at, end_at, status, client_id, client_name')
      .eq('workspace_id', workspaceId)
      .neq('status', 'cancelled')
      .gte('date', todayIso)
      .order('date', { ascending: true })
      .order('start_at', { ascending: true, nullsFirst: false })
      .limit(20),
    supabase.from('activities')
      .select('id, type, description, client_id, client_name, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('conversations')
      .select('id, channel, status, sentiment, intent, ai_summary, updated_at')
      .eq('workspace_id', workspaceId)
      .neq('status', 'resolved')
      .order('updated_at', { ascending: false })
      .limit(20),
  ])

  const clientRows = (clients.data ?? []) as Row[]
  const taskRows = (tasks.data ?? []) as Row[]
  const eventRows = (events.data ?? []) as Row[]
  const actRows = (activities.data ?? []) as Row[]
  const convRows = (conversations.data ?? []) as Row[]

  return {
    clients: {
      total: clientRows.length,
      recent: clientRows.slice(0, 5).map((c) => ({
        id: String(c.id),
        name: clampString(c.name, 120) ?? '',
        company: clampString(c.company, 120),
        status: clampString(c.status, 40),
        lead_score: typeof c.lead_score === 'number' ? c.lead_score : null,
        created_at: typeof c.created_at === 'string' ? c.created_at : null,
      })),
    },
    tasks: {
      pendingCount: taskRows.length,
      upcoming: taskRows.slice(0, 5).map((t) => ({
        id: String(t.id),
        title: clampString(t.title, 200) ?? '',
        due_date: typeof t.due_date === 'string' ? t.due_date : null,
        client_id: t.client_id ? String(t.client_id) : null,
        client_name: clampString(t.client_name, 120),
        status: clampString(t.status, 40),
      })),
    },
    calendar: {
      upcomingCount: eventRows.length,
      upcoming: eventRows.slice(0, 5).map((e) => ({
        id: String(e.id),
        title: clampString(e.title, 200) ?? '',
        start_at: typeof e.start_at === 'string' ? e.start_at : null,
        end_at: typeof e.end_at === 'string' ? e.end_at : null,
        client_name: clampString(e.client_name, 120),
        status: clampString(e.status, 40),
      })),
    },
    activity: {
      recent: actRows.slice(0, 8).map((a) => ({
        id: String(a.id),
        type: clampString(a.type, 60),
        description: clampString(a.description, 280),
        client_name: clampString(a.client_name, 120),
        created_at: typeof a.created_at === 'string' ? a.created_at : null,
      })),
    },
    conversations: {
      openCount: convRows.length,
      recent: convRows.slice(0, 5).map((c) => ({
        id: String(c.id),
        channel: clampString(c.channel, 40),
        status: clampString(c.status, 40),
        sentiment: clampString(c.sentiment, 40),
        intent: clampString(c.intent, 60),
        ai_summary: clampString(c.ai_summary, 280),
        updated_at: typeof c.updated_at === 'string' ? c.updated_at : null,
      })),
    },
  }
}

// ─────────────────────────────────────────────────────────────── search_clients

export type SearchClientsResult = {
  results: Array<{
    id: string
    name: string
    company: string | null
    email: string | null
    phone: string | null
    status: string | null
    lead_score: number | null
    created_at: string | null
  }>
}

export async function searchClients(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<SearchClientsResult>> {
  const o = asObject(input)
  const query = asString(o.query)
  if (!query || query.length < 2) {
    return { error: 'invalid_input', message: 'Necesito un término de búsqueda de al menos 2 caracteres.' }
  }
  const limit = asPositiveInt(o.limit, 10, 10)

  // Escape ilike wildcards so a hostile user can't widen the search with % / _.
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`)
  const needle = `%${escaped}%`

  const { data, error } = await supabase
    .from('clients')
    .select('id, name, company, email, phone, status, lead_score, created_at')
    .eq('workspace_id', workspaceId)
    .or(`name.ilike.${needle},company.ilike.${needle},email.ilike.${needle},phone.ilike.${needle}`)
    .order('lead_score', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) {
    return { error: 'query_failed', message: 'No pude consultar clientes ahora mismo.' }
  }

  return {
    results: ((data ?? []) as Row[]).map((c) => ({
      id: String(c.id),
      name: clampString(c.name, 120) ?? '',
      company: clampString(c.company, 120),
      email: clampString(c.email, 120),
      phone: clampString(c.phone, 40),
      status: clampString(c.status, 40),
      lead_score: typeof c.lead_score === 'number' ? c.lead_score : null,
      created_at: typeof c.created_at === 'string' ? c.created_at : null,
    })),
  }
}

// ─────────────────────────────────────────────────────────────── get_client_360

export type Client360 = {
  client: {
    id: string
    name: string
    company: string | null
    email: string | null
    phone: string | null
    channel: string | null
    status: string | null
    lead_score: number | null
    notes: string | null
    metadata: Record<string, unknown> | null
    created_at: string | null
  }
  tasks: Array<{
    id: string
    title: string
    description: string | null
    due_date: string | null
    status: string | null
    priority: string | null
  }>
  calendarEvents: Array<{
    id: string
    title: string
    date: string | null
    start_at: string | null
    end_at: string | null
    status: string | null
  }>
  conversations: Array<{
    id: string
    channel: string | null
    status: string | null
    sentiment: string | null
    intent: string | null
    ai_summary: string | null
    updated_at: string | null
  }>
  recentMessages: Array<{
    id: string
    conversation_id: string | null
    sender: string | null
    is_ai: boolean
    body: string | null
    created_at: string | null
  }>
  documents: Array<{
    id: string
    file_name: string
    mime_type: string | null
    size_bytes: number | null
    created_at: string | null
  }>
  activity: Array<{
    id: string
    type: string | null
    description: string | null
    created_at: string | null
  }>
}

export async function getClient360(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<Client360>> {
  const o = asObject(input)
  const clientId = asString(o.clientId)
  if (!isUuid(clientId)) {
    return { error: 'invalid_input', message: 'Necesito un clientId UUID válido.' }
  }

  const { data: clientRow, error: clientErr } = await supabase
    .from('clients')
    .select('id, name, company, email, phone, channel, status, lead_score, notes, metadata, created_at')
    .eq('workspace_id', workspaceId)
    .eq('id', clientId)
    .maybeSingle()
  if (clientErr) return { error: 'query_failed', message: 'No pude consultar el cliente.' }
  if (!clientRow) return { error: 'not_found', message: 'Cliente no encontrado en este workspace.' }

  const clientName = String((clientRow as Row).name ?? '')
  // Escape commas in the name for PostgREST `.or()` filter syntax.
  const safeName = clientName.replace(/[,()]/g, '')

  // P61 — DEGRADACIÓN PARCIAL: el core del cliente YA se leyó arriba. Las secciones opcionales se leen de
  // forma INDEPENDIENTE: si una falla (tabla/relación/schema), devuelve [] y NO tira abajo la ficha entera.
  // (Antes un Promise.all rechazaba todo por una sección; p. ej. las tablas `conversations`/`messages` no
  // existen en este modelo → se eliminan.) Facturación nunca se lee (módulo aislado).
  const safeRows = async (q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> => {
    try { const { data, error } = await q; return error ? [] : ((data ?? []) as Row[]) } catch { return [] }
  }
  const [tasksRows, eventsRows, docsRows, actsRows] = await Promise.all([
    safeRows(supabase.from('tasks')
      .select('id, title, due_date, status, priority')
      .eq('workspace_id', workspaceId).eq('client_id', clientId)
      .order('due_date', { ascending: true, nullsFirst: false }).limit(10)),
    safeRows(supabase.from('calendar_events')
      .select('id, title, date, start_at, end_at, status')
      .eq('workspace_id', workspaceId)
      .or(safeName ? `client_id.eq.${clientId},client_name.eq.${safeName}` : `client_id.eq.${clientId}`)
      .neq('status', 'cancelled')
      .order('date', { ascending: false }).limit(10)),
    // Documentos = tabla real `entity_files` (no existe tabla `documents`). Solo metadata; nunca contenido.
    safeRows(supabase.from('entity_files')
      .select('id, file_name, mime_type, size_bytes, created_at')
      .eq('workspace_id', workspaceId).eq('entity_type', 'client').eq('entity_id', clientId).eq('category', 'document')
      .order('created_at', { ascending: false }).limit(10)),
    safeRows(supabase.from('activities')
      .select('id, type, description, created_at')
      .eq('workspace_id', workspaceId)
      .or(safeName ? `client_id.eq.${clientId},client_name.eq.${safeName}` : `client_id.eq.${clientId}`)
      .order('created_at', { ascending: false }).limit(10)),
  ])
  const tasksRes = { data: tasksRows }
  const eventsRes = { data: eventsRows }
  const docsRes = { data: docsRows }
  const actsRes = { data: actsRows }

  const c = clientRow as Row
  return {
    client: {
      id: String(c.id),
      name: clampString(c.name, 120) ?? '',
      company: clampString(c.company, 120),
      email: clampString(c.email, 120),
      phone: clampString(c.phone, 40),
      channel: clampString(c.channel, 40),
      status: clampString(c.status, 40),
      lead_score: typeof c.lead_score === 'number' ? c.lead_score : null,
      notes: clampString(c.notes, 1000),
      metadata: asObject(c.metadata),
      created_at: typeof c.created_at === 'string' ? c.created_at : null,
    },
    tasks: ((tasksRes.data ?? []) as Row[]).map((t) => ({
      id: String(t.id),
      title: clampString(t.title, 200) ?? '',
      description: clampString(t.description, 500),
      due_date: typeof t.due_date === 'string' ? t.due_date : null,
      status: clampString(t.status, 40),
      priority: clampString(t.priority, 20),
    })),
    calendarEvents: ((eventsRes.data ?? []) as Row[]).map((e) => ({
      id: String(e.id),
      title: clampString(e.title, 200) ?? '',
      date: typeof e.date === 'string' ? e.date : null,
      start_at: typeof e.start_at === 'string' ? e.start_at : null,
      end_at: typeof e.end_at === 'string' ? e.end_at : null,
      status: clampString(e.status, 40),
    })),
    // Tablas `conversations`/`messages` no existen en este modelo (P61): secciones vacías, sin romper la ficha.
    conversations: [],
    recentMessages: [],
    documents: ((docsRes.data ?? []) as Row[]).map((d) => ({
      id: String(d.id),
      file_name: clampString(d.file_name, 200) ?? '',
      mime_type: clampString(d.mime_type, 80),
      size_bytes: typeof d.size_bytes === 'number' ? d.size_bytes : null,
      created_at: typeof d.created_at === 'string' ? d.created_at : null,
    })),
    activity: ((actsRes.data ?? []) as Row[]).map((a) => ({
      id: String(a.id),
      type: clampString(a.type, 60),
      description: clampString(a.description, 280),
      created_at: typeof a.created_at === 'string' ? a.created_at : null,
    })),
  }
}

// ─────────────────────────────────────────────────────────────── get_pending_tasks

export type PendingTasksResult = {
  tasks: Array<{
    id: string
    title: string
    description: string | null
    due_date: string | null
    client_id: string | null
    client_name: string | null
    status: string | null
    priority: string | null
    created_at: string | null
  }>
}

export async function getPendingTasks(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<PendingTasksResult>> {
  const o = asObject(input)
  const limit = asPositiveInt(o.limit, 20, 30)
  const cid = clientIdFromInput(input)
  if (cid.error) return cid.error

  // Nota: la tabla `tasks` NO tiene columna `description` (verificado P51C). Seleccionarla provocaba
  // `query_failed` y rompía "tareas pendientes" (n8n y local-first). Se omite.
  let q = supabase.from('tasks')
    .select('id, title, due_date, client_id, client_name, status, priority, created_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
  if (cid.clientId) q = q.eq('client_id', cid.clientId)
  const { data, error } = await q
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return { error: 'query_failed', message: 'No pude leer las tareas.' }

  return {
    tasks: ((data ?? []) as Row[]).map((t) => ({
      id: String(t.id),
      title: clampString(t.title, 200) ?? '',
      description: clampString(t.description, 500),
      due_date: typeof t.due_date === 'string' ? t.due_date : null,
      client_id: t.client_id ? String(t.client_id) : null,
      client_name: clampString(t.client_name, 120),
      status: clampString(t.status, 40),
      priority: clampString(t.priority, 20),
      created_at: typeof t.created_at === 'string' ? t.created_at : null,
    })),
  }
}

// ─────────────────────────────────────────────────────────────── get_invoices_summary

export type InvoicesSummary = {
  totals: {
    pendingCount: number
    overdueCount: number
    paidCount: number
    pendingTotal: number
    overdueTotal: number
    paidTotal: number
  }
  pending: InvoiceShape[]
  overdue: InvoiceShape[]
  recent: InvoiceShape[]
}

type InvoiceShape = {
  id: string
  client_id: string | null
  client_name: string | null
  amount: number
  status: string | null
  due_date: string | null
  concept: string | null
  created_at: string | null
}

export async function getInvoicesSummary(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<InvoicesSummary>> {
  // P35: Facturación es un módulo MANUAL aislado; el Asistente NO lee facturas todavía. No se consulta la
  // tabla `invoices`. La integración con el Asistente (lectura + prepare_invoice con confirmación) queda
  // como fase futura OPCIONAL. Devuelve un mensaje honesto (no un error de datos).
  void supabase
  void workspaceId
  void input
  return {
    error: 'not_available',
    message: 'La facturación se gestiona manualmente desde el módulo Facturación. El Asistente no consulta facturas todavía.',
  }
}

// ─────────────────────────────────────────────────────────────── get_calendar_summary

export type CalendarSummary = {
  events: Array<{
    id: string
    title: string
    date: string | null
    start_at: string | null
    end_at: string | null
    type: string | null
    location: string | null
    notes: string | null
    client_id: string | null
    client_name: string | null
    property_id: string | null
    opportunity_id: string | null
    service_case_id: string | null
    status: string | null
  }>
}

export async function getCalendarSummary(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<CalendarSummary>> {
  const o = asObject(input)
  const limit = asPositiveInt(o.limit, 20, 50)
  const cid = clientIdFromInput(input)
  if (cid.error) return cid.error

  const today = todayMadridIso()
  // Rango por palabra clave (hoy/mañana/esta semana…) en Europe/Madrid; si no, from/to explícitos.
  const byKeyword = typeof o.range === 'string' ? madridDateRange(o.range, today) : null
  const fromIso = byKeyword?.from ?? parseIsoDate(o.from) ?? today
  const toIso = byKeyword?.to ?? parseIsoDate(o.to) ?? addDaysIso(today, 14)
  if (toIso < fromIso) {
    return { error: 'invalid_input', message: 'Rango de fechas inválido: `to` es anterior a `from`.' }
  }

  let q = supabase.from('calendar_events')
    .select('id, title, date, start_at, end_at, location, notes, description, client_id, client_name, property_id, opportunity_id, case_id, status, type')
    .eq('workspace_id', workspaceId)
    .neq('status', 'cancelled')
    .gte('date', fromIso)
    .lte('date', toIso)
  if (cid.clientId) q = q.eq('client_id', cid.clientId)
  const { data, error } = await q
    .order('date', { ascending: true })
    .order('start_at', { ascending: true, nullsFirst: false })
    .limit(limit)
  if (error) return { error: 'query_failed', message: 'No pude leer el calendario.' }

  return {
    events: ((data ?? []) as Row[]).map((e) => ({
      id: String(e.id),
      title: clampString(e.title, 200) ?? '',
      date: typeof e.date === 'string' ? e.date : null,
      start_at: typeof e.start_at === 'string' ? e.start_at : null,
      end_at: typeof e.end_at === 'string' ? e.end_at : null,
      type: clampString(e.type, 40),
      location: clampString(e.location, 200),
      notes: clampString((e.notes ?? e.description) as unknown, 500),
      client_id: e.client_id ? String(e.client_id) : null,
      client_name: clampString(e.client_name, 120),
      property_id: e.property_id ? String(e.property_id) : null,
      opportunity_id: e.opportunity_id ? String(e.opportunity_id) : null,
      service_case_id: e.case_id ? String(e.case_id) : null,
      status: clampString(e.status, 40),
    })),
  }
}

// ─────────────────────────────────────────────────────────────── get_recent_activity

export type RecentActivity = {
  activity: Array<{
    id: string
    type: string | null
    description: string | null
    client_id: string | null
    client_name: string | null
    created_at: string | null
  }>
}

export async function getRecentActivity(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<RecentActivity>> {
  const o = asObject(input)
  const limit = asPositiveInt(o.limit, 15, 30)
  const cid = clientIdFromInput(input)
  if (cid.error) return cid.error

  let q = supabase.from('activities')
    .select('id, type, description, client_id, client_name, created_at')
    .eq('workspace_id', workspaceId)
  if (cid.clientId) q = q.eq('client_id', cid.clientId)
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return { error: 'query_failed', message: 'No pude leer la actividad.' }

  return {
    activity: ((data ?? []) as Row[]).map((a) => ({
      id: String(a.id),
      type: clampString(a.type, 60),
      description: clampString(a.description, 280),
      client_id: a.client_id ? String(a.client_id) : null,
      client_name: clampString(a.client_name, 120),
      created_at: typeof a.created_at === 'string' ? a.created_at : null,
    })),
  }
}

// ─────────────────────────────────────────────────────────────── get_conversations_summary

export type ConversationsSummary = {
  conversations: Array<{
    id: string
    channel: string | null
    status: string | null
    sentiment: string | null
    intent: string | null
    ai_summary: string | null
    created_at: string | null
    updated_at: string | null
    recentMessages: Array<{
      id: string
      sender: string | null
      is_ai: boolean
      body: string | null
      created_at: string | null
    }>
  }>
}

export async function getConversationsSummary(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<ConversationsSummary>> {
  const o = asObject(input)
  const limit = asPositiveInt(o.limit, 10, 10)
  const cid = clientIdFromInput(input)
  if (cid.error) return cid.error

  let q = supabase.from('conversations')
    .select('id, channel, status, sentiment, intent, ai_summary, created_at, updated_at')
    .eq('workspace_id', workspaceId)
  if (cid.clientId) q = q.eq('client_id', cid.clientId)
  const { data, error } = await q
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) return { error: 'query_failed', message: 'No pude leer las conversaciones.' }

  const convs = (data ?? []) as Row[]
  const convIds = convs.map((c) => String(c.id))

  const msgsMap = new Map<string, Row[]>()
  if (convIds.length) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('id, conversation_id, sender, body, is_ai, created_at')
      .eq('workspace_id', workspaceId)
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(convIds.length * 3)
    for (const m of ((msgs ?? []) as Row[])) {
      const k = String(m.conversation_id ?? '')
      if (!k) continue
      const list = msgsMap.get(k) ?? []
      if (list.length < 3) {
        list.push(m)
        msgsMap.set(k, list)
      }
    }
  }

  return {
    conversations: convs.map((c) => ({
      id: String(c.id),
      channel: clampString(c.channel, 40),
      status: clampString(c.status, 40),
      sentiment: clampString(c.sentiment, 40),
      intent: clampString(c.intent, 60),
      ai_summary: clampString(c.ai_summary, 280),
      created_at: typeof c.created_at === 'string' ? c.created_at : null,
      updated_at: typeof c.updated_at === 'string' ? c.updated_at : null,
      recentMessages: (msgsMap.get(String(c.id)) ?? []).map((m) => ({
        id: String(m.id),
        sender: clampString(m.sender, 40),
        is_ai: m.is_ai === true,
        body: clampString(m.body, 200),
        created_at: typeof m.created_at === 'string' ? m.created_at : null,
      })),
    })),
  }
}

// ─────────────────────────────────────────────────────────────── get_documents_metadata

export type DocumentsMetadata = {
  documents: Array<{
    id: string
    client_id: string | null
    file_name: string
    mime_type: string | null
    size_bytes: number | null
    created_at: string | null
  }>
  capability: 'metadata_only'
}

export async function getDocumentsMetadata(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<DocumentsMetadata>> {
  const o = asObject(input)
  const limit = asPositiveInt(o.limit, 20, 30)
  const cid = clientIdFromInput(input)
  if (cid.error) return cid.error

  // Metadata de documentos = tabla real `entity_files` (category='document'). Solo lectura de metadata
  // (nombre/tipo/tamaño/fecha); NUNCA contenido del archivo. No existe tabla `documents` en esta BD; los
  // archivos se enlazan por entity_type/entity_id (no client_id).
  let q = supabase.from('entity_files')
    .select('id, entity_type, entity_id, file_name, mime_type, size_bytes, created_at')
    .eq('workspace_id', workspaceId)
    .eq('category', 'document')
  if (cid.clientId) q = q.eq('entity_type', 'client').eq('entity_id', cid.clientId)
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return { error: 'query_failed', message: 'No pude leer los documentos.' }

  return {
    documents: ((data ?? []) as Row[]).map((d) => ({
      id: String(d.id),
      client_id: d.entity_type === 'client' && d.entity_id ? String(d.entity_id) : null,
      file_name: clampString(d.file_name, 200) ?? '',
      mime_type: clampString(d.mime_type, 80),
      size_bytes: typeof d.size_bytes === 'number' ? d.size_bytes : null,
      created_at: typeof d.created_at === 'string' ? d.created_at : null,
    })),
    capability: 'metadata_only',
  }
}

// ─────────────────────────────────────────────────────────── get_latest_client

export type LatestClientResult = {
  client: {
    id: string
    name: string
    company: string | null
    email: string | null
    phone: string | null
    status: string | null
    notes: string | null
    metadata: Record<string, unknown>
    created_at: string | null
  } | null
}

// Newest registered client (created_at desc). Includes metadata (DNI/custom
// fields) so the agent can resolve "el nuevo/último cliente" and read exact data.
export async function getLatestClient(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ReaderResult<LatestClientResult>> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, company, email, phone, status, notes, metadata, created_at')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { error: 'query_failed', message: 'No pude leer los clientes.' }
  if (!data) return { client: null }
  const c = data as Row
  return {
    client: {
      id: String(c.id),
      name: clampString(c.name, 120) ?? '',
      company: clampString(c.company, 120),
      email: clampString(c.email, 120),
      phone: clampString(c.phone, 40),
      status: clampString(c.status, 40),
      notes: clampString(c.notes, 1000),
      metadata: asObject(c.metadata),
      created_at: typeof c.created_at === 'string' ? c.created_at : null,
    },
  }
}

// ─────────────────────────────────────────────── get_client_opportunities

export type ClientOpportunitiesResult = {
  opportunities: Array<{
    id: string
    title: string | null
    stage: string | null
    value: number
    probability: number | null
    expected_close_date: string | null
    notes: string | null
  }>
}

export async function getClientOpportunities(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<ClientOpportunitiesResult>> {
  const clientId = asString(asObject(input).clientId)
  if (!isUuid(clientId)) return { error: 'invalid_input', message: 'Necesito un clientId UUID válido.' }
  const { data, error } = await supabase
    .from('opportunities')
    .select('id, title, stage, value, probability, expected_close_date, notes')
    .eq('workspace_id', workspaceId)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(25)
  if (error) return { error: 'query_failed', message: 'No pude leer las operaciones del cliente.' }
  return {
    opportunities: ((data ?? []) as Row[]).map((o) => ({
      id: String(o.id),
      title: clampString(o.title, 200),
      stage: clampString(o.stage, 40),
      value: toNumber(o.value),
      probability: typeof o.probability === 'number' ? o.probability : null,
      expected_close_date: typeof o.expected_close_date === 'string' ? o.expected_close_date : null,
      notes: clampString(o.notes, 300),
    })),
  }
}

// ─────────────────────────────────────────────── get_client_service_cases

export type ClientServiceCasesResult = {
  service_cases: Array<{
    id: string
    title: string | null
    case_type: string | null
    status: string | null
    priority: string | null
    due_date: string | null
    notes: string | null
  }>
}

export async function getClientServiceCases(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<ClientServiceCasesResult>> {
  const clientId = asString(asObject(input).clientId)
  if (!isUuid(clientId)) return { error: 'invalid_input', message: 'Necesito un clientId UUID válido.' }
  const { data, error } = await supabase
    .from('service_cases')
    .select('id, title, case_type, status, priority, due_date, notes')
    .eq('workspace_id', workspaceId)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(25)
  if (error) return { error: 'query_failed', message: 'No pude leer los expedientes del cliente.' }
  return {
    service_cases: ((data ?? []) as Row[]).map((s) => ({
      id: String(s.id),
      title: clampString(s.title, 200),
      case_type: clampString(s.case_type, 60),
      status: clampString(s.status, 40),
      priority: clampString(s.priority, 20),
      due_date: typeof s.due_date === 'string' ? s.due_date : null,
      notes: clampString(s.notes, 300),
    })),
  }
}

// ─────────────────────────────────────────────────────────── pipeline_summary

export type PipelineSummaryResult = {
  total_open: number
  total_value: number
  by_stage: Array<{ stage: string; count: number; value: number }>
}

// Aggregates open opportunities by stage (count + value). Workspace-scoped.
export async function getPipelineSummary(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ReaderResult<PipelineSummaryResult>> {
  const { data, error } = await supabase
    .from('opportunities')
    .select('stage, value')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .not('stage', 'in', '("won","lost","closed")')
    .limit(500)
  if (error) return { error: 'query_failed', message: 'No pude leer el pipeline.' }
  const rows = (data ?? []) as Row[]
  const map = new Map<string, { count: number; value: number }>()
  let totalValue = 0
  for (const r of rows) {
    const stage = clampString(r.stage, 40) ?? 'sin etapa'
    const v = toNumber(r.value)
    totalValue += v
    const cur = map.get(stage) ?? { count: 0, value: 0 }
    cur.count += 1
    cur.value += v
    map.set(stage, cur)
  }
  return {
    total_open: rows.length,
    total_value: round2(totalValue),
    by_stage: [...map.entries()].map(([stage, s]) => ({ stage, count: s.count, value: round2(s.value) })),
  }
}

// ─────────────────────────────────────────────────────────── search_properties

export type SearchPropertyItem = {
  id: string
  title: string | null
  property_type: string | null
  operation_type: string | null
  status: string | null
  city: string | null
  area: string | null
  address: string | null
  price: number | null
  currency: string | null
  area_m2: number | null
  bedrooms: number | null
  bathrooms: number | null
  owner_name: string | null
  owner_phone: string | null
  reference: string | null
  notes: string | null
  matchLevel?: 'exact' | 'partial'
  reasons?: string[]
}
export type SearchPropertiesResult = {
  properties: SearchPropertyItem[] // combinado (exactos + parciales) — compat con countFor
  exactMatches: SearchPropertyItem[]
  partialMatches: SearchPropertyItem[]
  count: number
  appliedFilters: Record<string, unknown>
  availabilityMode: string
  warnings: string[]
}

// Búsqueda SEMÁNTICA de cartera (P29). No es literal: normaliza tipo/operación/ubicación/presupuesto
// (real-estate-search.ts), clasifica disponibilidad y separa exactos de parciales para evitar falsos
// negativos. Acepta `query` libre + filtros explícitos opcionales. Workspace-scoped, payload acotado.
export async function searchProperties(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<SearchPropertiesResult>> {
  const o = asObject(input)
  const query = asString(o.query) || asString(o.searchText)
  const availabilityRaw = asString(o.availabilityMode).toLowerCase()
  const availability: AvailabilityMode =
    availabilityRaw === 'all' ? 'all' : availabilityRaw === 'closed' ? 'closed' : 'available'
  const includePartial = o.includePartialMatches !== false

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const explicit: Partial<PropertyCriteria> = {
    types: normalizePropertyType(asString(o.type)).canonical,
    operation: normalizeOperation(asString(o.operation)),
    availability,
  }
  if (num(o.minPrice) != null) explicit.minPrice = num(o.minPrice)
  if (num(o.maxPrice) != null) explicit.maxPrice = num(o.maxPrice)
  if (num(o.bedrooms) != null) explicit.bedrooms = num(o.bedrooms)
  if (num(o.bathrooms) != null) explicit.bathrooms = num(o.bathrooms)
  if (num(o.minArea) != null) explicit.minArea = num(o.minArea)
  if (num(o.maxArea) != null) explicit.maxArea = num(o.maxArea)

  const criteria = buildCriteriaFromText(query, explicit)
  const localityTokens = [asString(o.locality), asString(o.area), asString(o.city)]
    .map((s) => foldText(s)).filter(Boolean)
  if (localityTokens.length) {
    criteria.locationTokens = [...new Set([...(criteria.locationTokens ?? []), ...localityTokens])]
  }

  // Candidatos amplios: NO se filtra por status en la BD (evita falsos negativos); disponibilidad y
  // criterios se aplican por ranking. Acotado a 120 filas por workspace.
  const { data, error } = await supabase
    .from('properties')
    .select('id, title, property_type, operation_type, status, city, area, address, price, currency, area_m2, bedrooms, bathrooms, owner_name, owner_phone, reference, notes')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(120)
  if (error) return { error: 'query_failed', message: 'No pude leer las propiedades.' }

  const rows = (data ?? []) as Row[]
  const { exact, partial, excludedCount } = rankProperties(rows as unknown as ScorableProperty[], criteria)

  const toItem = (r: RankedProperty<ScorableProperty>): SearchPropertyItem => {
    const p = r.item as Row
    return {
      id: String(p.id),
      title: clampString(p.title, 200),
      property_type: clampString(p.property_type, 60),
      operation_type: clampString(p.operation_type, 60),
      status: clampString(p.status, 40),
      city: clampString(p.city, 80),
      area: clampString(p.area, 80),
      address: clampString(p.address, 200),
      price: typeof p.price === 'number' ? p.price : null,
      currency: clampString(p.currency, 8),
      area_m2: typeof p.area_m2 === 'number' ? p.area_m2 : null,
      bedrooms: typeof p.bedrooms === 'number' ? p.bedrooms : null,
      bathrooms: typeof p.bathrooms === 'number' ? p.bathrooms : null,
      owner_name: clampString(p.owner_name, 120),
      owner_phone: clampString(p.owner_phone, 40),
      reference: clampString(p.reference, 60),
      notes: clampString(p.notes, 400),
      matchLevel: r.matchLevel,
      reasons: r.reasons.slice(0, 6),
    }
  }

  const exactItems = exact.slice(0, 12).map(toItem)
  const partialItems = (includePartial ? partial.slice(0, 8) : []).map(toItem)
  const warnings: string[] = []
  if (!exactItems.length && partialItems.length) warnings.push('sin coincidencias exactas; se muestran parciales relevantes')
  if (!exactItems.length && !partialItems.length && excludedCount > 0 && availability === 'available') {
    warnings.push('hay inmuebles en la cartera pero están cerrados (vendido/alquilado/archivado) para el criterio pedido')
  }

  return {
    properties: [...exactItems, ...partialItems].slice(0, 20),
    exactMatches: exactItems,
    partialMatches: partialItems,
    count: exactItems.length + partialItems.length,
    appliedFilters: {
      types: criteria.types ?? null,
      operation: criteria.operation ?? null,
      location: criteria.locationTokens ?? [],
      minPrice: criteria.minPrice ?? null,
      maxPrice: criteria.maxPrice ?? null,
      bedrooms: criteria.bedrooms ?? null,
      bathrooms: criteria.bathrooms ?? null,
      minArea: criteria.minArea ?? null,
      maxArea: criteria.maxArea ?? null,
    },
    availabilityMode: availability,
    warnings,
  }
}

// Resuelve los nombres legibles de las relaciones por id (cliente/inmueble/operación) en lote, para
// que el agente NUNCA hable de un id técnico: añade client_name / property_title / operation_title a
// las filas que tengan el FK. Acotado por el `limit` de la consulta; RLS por workspace; 3 queries máx.
async function enrichRelationNames(
  supabase: SupabaseClient,
  workspaceId: string,
  rows: Row[],
): Promise<void> {
  const distinct = (key: string) =>
    [...new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === 'string' && v.length > 0))]
  const clientIds = distinct('client_id')
  const propertyIds = distinct('property_id')
  const opportunityIds = distinct('opportunity_id')
  if (!clientIds.length && !propertyIds.length && !opportunityIds.length) return

  const sel = (table: string, ids: string[], col: string) =>
    ids.length
      ? supabase.from(table).select(`id, ${col}`).eq('workspace_id', workspaceId).in('id', ids)
      : Promise.resolve({ data: [] as Row[] })
  const [clients, properties, opportunities] = await Promise.all([
    sel('clients', clientIds, 'name'),
    sel('properties', propertyIds, 'title'),
    sel('opportunities', opportunityIds, 'title'),
  ])
  const toMap = (res: { data: unknown }, col: string) =>
    new Map((((res.data ?? []) as Row[])).map((r) => [String(r.id), clampString(r[col], 200)]))
  const cmap = toMap(clients, 'name')
  const pmap = toMap(properties, 'title')
  const omap = toMap(opportunities, 'title')

  for (const r of rows) {
    if (typeof r.client_id === 'string' && cmap.has(r.client_id)) r.client_name = cmap.get(r.client_id) ?? null
    if (typeof r.property_id === 'string' && pmap.has(r.property_id)) r.property_title = pmap.get(r.property_id) ?? null
    if (typeof r.opportunity_id === 'string' && omap.has(r.opportunity_id)) r.operation_title = omap.get(r.opportunity_id) ?? null
  }
}

// ─────────────────────── Assistant 360: detailLevel + expand (relaciones acotadas) ─────────────
// Protección de payload: solo se expanden las primeras N filas principales y cada relación trae como
// mucho REL_CAP elementos (orden por fecha desc). Allowlist estricta. Nombres resueltos, sin UUIDs ni
// campos técnicos. Si hay más filas de las expandibles, se marca `related_truncated`.
// Nota (P27): 'documents' NO se expande aquí. La metadata de documentos vive en `entity_files` (enlazada
// por entity_type/entity_id, no por FK client_id/property_id) y se sirve por la tool dedicada
// get_documents_metadata. Mantenerla fuera del expand genérico evita consultar una tabla inexistente.
export const EXPAND_ALLOWED = new Set(['operation', 'property', 'client', 'service_case', 'tasks', 'events', 'activity'])
export const REL_CAP = 5
export const EXPAND_PRIMARY_CAP = 5

type RelSpec = { table: string; fk: string; cols: string; order: string; outKey: string }
// Por entidad principal → qué relaciones se pueden expandir y cómo. Solo FKs verificados en el schema.
export const EXPAND_SPECS: Record<string, Partial<Record<string, RelSpec>>> = {
  clients: {
    operation: { table: 'opportunities', fk: 'client_id', cols: 'id, title, stage, value, property_id', order: 'updated_at', outKey: 'operaciones' },
    property: { table: 'properties', fk: 'client_id', cols: 'id, title, city, area, status, price', order: 'updated_at', outKey: 'inmuebles' },
    events: { table: 'calendar_events', fk: 'client_id', cols: 'id, title, date, start_at, location, status, property_id, opportunity_id', order: 'date', outKey: 'citas' },
    tasks: { table: 'tasks', fk: 'client_id', cols: 'id, title, status, priority, due_date, property_id, opportunity_id', order: 'due_date', outKey: 'tareas' },
    service_case: { table: 'service_cases', fk: 'client_id', cols: 'id, title, status, priority, due_date, property_id, opportunity_id', order: 'due_date', outKey: 'tramites' },
    activity: { table: 'activities', fk: 'client_id', cols: 'id, title, type, created_at', order: 'created_at', outKey: 'actividad' },
  },
  properties: {
    operation: { table: 'opportunities', fk: 'property_id', cols: 'id, title, stage, value, client_id', order: 'updated_at', outKey: 'operaciones' },
    events: { table: 'calendar_events', fk: 'property_id', cols: 'id, title, date, start_at, location, status, client_id', order: 'date', outKey: 'citas' },
    tasks: { table: 'tasks', fk: 'property_id', cols: 'id, title, status, priority, due_date, client_id', order: 'due_date', outKey: 'tareas' },
    service_case: { table: 'service_cases', fk: 'property_id', cols: 'id, title, status, priority, due_date, client_id', order: 'due_date', outKey: 'tramites' },
  },
  opportunities: {
    events: { table: 'calendar_events', fk: 'opportunity_id', cols: 'id, title, date, start_at, location, status, client_id', order: 'date', outKey: 'citas' },
    tasks: { table: 'tasks', fk: 'opportunity_id', cols: 'id, title, status, priority, due_date, client_id', order: 'due_date', outKey: 'tareas' },
    service_case: { table: 'service_cases', fk: 'opportunity_id', cols: 'id, title, status, priority, due_date, client_id', order: 'due_date', outKey: 'tramites' },
  },
  service_cases: {
    tasks: { table: 'tasks', fk: 'case_id', cols: 'id, title, status, priority, due_date, client_id', order: 'due_date', outKey: 'tareas' },
    events: { table: 'calendar_events', fk: 'case_id', cols: 'id, title, date, start_at, location, status, client_id', order: 'date', outKey: 'citas' },
  },
}

function sanitizeRelatedRow(r: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(r)) {
    if (k === 'workspace_id' || k === 'deleted_at' || k === 'metadata') continue
    out[k] = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) : v
  }
  return out
}

async function applyExpand(
  supabase: SupabaseClient,
  workspaceId: string,
  entity: string,
  rows: Row[],
  expandKeys: string[],
): Promise<boolean> {
  const specs = EXPAND_SPECS[entity]
  if (!specs) return false
  const targets = expandKeys.filter((k) => EXPAND_ALLOWED.has(k) && specs[k])
  if (!targets.length) return false
  const primaries = rows.slice(0, EXPAND_PRIMARY_CAP)
  for (const row of primaries) {
    const id = typeof row.id === 'string' ? row.id : null
    if (!id) continue
    const related: Record<string, Row[]> = {}
    await Promise.all(targets.map(async (key) => {
      const spec = specs[key]!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rq: any = supabase.from(spec.table).select(spec.cols).eq('workspace_id', workspaceId).eq(spec.fk, id)
      rq = rq.order(spec.order, { ascending: false, nullsFirst: false }).limit(REL_CAP)
      const { data } = await rq
      const childRows = ((data ?? []) as Row[]).map(sanitizeRelatedRow)
      await enrichRelationNames(supabase, workspaceId, childRows)
      related[spec.outKey] = childRows
    }))
    row.related = related
  }
  return rows.length > EXPAND_PRIMARY_CAP
}

// ─────────────────────────────────────────────────────────── crm_read_query
// Universal CONTROLLED read: the agent picks an allowlisted ENTITY + safe
// filters/searchText/clientRef/dateRange. NO free SQL. workspace_id is pinned by
// the route (never the LLM). Column allowlist per entity, limit clamped (<=20),
// metadata only for clients, documents = metadata only. Read-only.

type CrmEntityCfg = {
  table: string
  cols: string
  search: string[]
  filters: string[]
  dateCol?: string
  orderCol: string
  soft?: boolean
  includeMeta?: boolean
}

const CRM_QUERY_ENTITIES: Record<string, CrmEntityCfg> = {
  // País/idioma del cliente viven en metadata (nationality/preferred_language, patrón de perfil
  // extendido); `includeMeta: true` ya los entrega al Asistente. Las columnas dedicadas country/
  // preferred_language quedan additivas para uso futuro (ver migración P29).
  clients: { table: 'clients', cols: 'id, name, company, email, phone, channel, status, notes, metadata, created_at', search: ['name', 'company', 'email', 'phone'], filters: ['status', 'channel'], dateCol: 'created_at', orderCol: 'updated_at', soft: true, includeMeta: true },
  opportunities: { table: 'opportunities', cols: 'id, title, stage, value, currency, probability, expected_close_date, commission_rate, commission_status, commission_paid_amount, notes, client_id, property_id', search: ['title', 'notes'], filters: ['stage'], dateCol: 'expected_close_date', orderCol: 'updated_at', soft: true },
  service_cases: { table: 'service_cases', cols: 'id, title, case_type, status, priority, due_date, notes, client_id, property_id, opportunity_id', search: ['title', 'notes'], filters: ['status', 'priority', 'case_type'], dateCol: 'due_date', orderCol: 'updated_at', soft: true },
  tasks: { table: 'tasks', cols: 'id, title, status, priority, due_date, client_id, client_name, property_id, opportunity_id', search: ['title'], filters: ['status', 'priority'], dateCol: 'due_date', orderCol: 'due_date' },
  calendar_events: { table: 'calendar_events', cols: 'id, title, type, date, start_at, end_at, location, notes, status, client_id, client_name, property_id, opportunity_id, case_id', search: ['title', 'location'], filters: ['type', 'status'], dateCol: 'date', orderCol: 'date' },
  // P56B: `soft: true` — la UI de Cartera filtra deleted_at; el Asistente debe leer LO MISMO (reconciliación).
  properties: { table: 'properties', cols: 'id, title, reference, property_type, operation_type, status, city, area, address, price, currency, area_m2, bedrooms, bathrooms, owner_name, owner_phone, notes', search: ['title', 'city', 'area', 'address', 'notes', 'reference'], filters: ['status', 'property_type', 'operation_type', 'city'], orderCol: 'updated_at', soft: true },
  activities: { table: 'activities', cols: 'id, type, title, description, created_at, client_id', search: ['title', 'description'], filters: ['type'], dateCol: 'created_at', orderCol: 'created_at' },
}

export type CrmQueryResult = { entity: string; count: number; rows: Row[]; orderBy?: string; orderDirection?: 'asc' | 'desc'; offset?: number; detailLevel?: string; related_truncated?: boolean }

function sanitizeQueryRow(cfg: CrmEntityCfg, r: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(r)) {
    if (k === 'metadata') { if (cfg.includeMeta) out.metadata = asObject(v); continue }
    if (k === 'workspace_id') continue
    out[k] = typeof v === 'string' && v.length > 500 ? v.slice(0, 500) : v
  }
  return out
}

export async function crmReadQuery(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<CrmQueryResult>> {
  const o = asObject(input)
  const entity = asString(o.entity).toLowerCase()
  const cfg = CRM_QUERY_ENTITIES[entity]
  if (!cfg) {
    return { error: 'invalid_input', message: `Entidad no permitida. Usa una de: ${Object.keys(CRM_QUERY_ENTITIES).join(', ')}.` }
  }
  const limit = asPositiveInt(o.limit, 10, 20)
  // Paginación para consultas por posición ("tercer/quinto cliente registrado"): offset 0..1000.
  const rawOffset = Number(o.offset)
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.min(Math.floor(rawOffset), 1000)) : 0
  // Ordenación segura: solo columnas conocidas de la entidad (evita ordenar por columnas arbitrarias).
  const allowedCols = new Set(cfg.cols.split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean))
  if (cfg.orderCol) allowedCols.add(cfg.orderCol)
  if (cfg.dateCol) allowedCols.add(cfg.dateCol)
  const reqOrderBy = asString(o.orderBy).trim()
  const orderBy = reqOrderBy && allowedCols.has(reqOrderBy) ? reqOrderBy : cfg.orderCol
  const ascending = asString(o.orderDirection).toLowerCase() === 'asc'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase.from(cfg.table).select(cfg.cols).eq('workspace_id', workspaceId)
  if (cfg.soft) q = q.is('deleted_at', null)

  const clientRef = asString(o.clientRef)
  if (clientRef) {
    if (!isUuid(clientRef)) return { error: 'invalid_input', message: 'clientRef debe ser un UUID válido.' }
    q = q.eq('client_id', clientRef)
  }

  const filters = asObject(o.filters)
  for (const [k, v] of Object.entries(filters)) {
    if (cfg.filters.includes(k) && (typeof v === 'string' || typeof v === 'number')) q = q.eq(k, v)
  }

  const searchText = asString(o.searchText)
  if (searchText && cfg.search.length) {
    const safe = searchText.replace(/[,()%]/g, '').slice(0, 80)
    if (safe) q = q.or(cfg.search.map((c) => `${c}.ilike.%${safe}%`).join(','))
  }

  // Rango de fecha: palabra clave (hoy/esta semana/…) en Europe/Madrid, o dateRange.{from,to} explícito.
  const byKeyword = typeof o.range === 'string' ? madridDateRange(o.range, todayMadridIso()) : null
  const dr = byKeyword ?? asObject(o.dateRange)
  if (cfg.dateCol) {
    const from = parseIsoDate(dr.from)
    const to = parseIsoDate(dr.to)
    if (from) q = q.gte(cfg.dateCol, from)
    if (to) q = q.lte(cfg.dateCol, to)
  }

  // Orden ESTABLE/determinista: el orden principal puede empatar (p. ej. varios seeds con el mismo
  // created_at). Añadimos `id` como desempate en la misma dirección → "primer/tercer/quinto/último"
  // devuelve SIEMPRE el mismo registro para los mismos datos. (id es UUID: estable, no semánticamente
  // perfecto, pero determinista. Si la tabla tuviera un nº de registro real, sería preferible.)
  const { data, error } = await q
    .order(orderBy, { ascending, nullsFirst: false })
    .order('id', { ascending })
    .range(offset, offset + limit - 1)
  if (error) return { error: 'query_failed', message: `No pude consultar ${entity}.` }
  const rows = ((data ?? []) as Row[]).map((r) => sanitizeQueryRow(cfg, r))
  // 360: resolver nombres de las relaciones por id → el agente nunca muestra UUIDs.
  await enrichRelationNames(supabase, workspaceId, rows)

  // detailLevel + expand (Assistant 360). detailLevel='full' aplica el set de relaciones por defecto de
  // la entidad; `expand` (allowlist) lo acota. Solo se expanden las primeras filas (protección de payload).
  const detailLevel = (() => {
    const dl = asString(o.detailLevel).toLowerCase()
    return dl === 'detail' || dl === 'full' ? dl : 'summary'
  })()
  const rawExpand = Array.isArray(o.expand) ? (o.expand as unknown[]).map((x) => String(x).toLowerCase()) : []
  const defaultExpand = detailLevel === 'full' ? Object.keys(EXPAND_SPECS[entity] ?? {}) : []
  const expandKeys = [...new Set([...rawExpand, ...defaultExpand])].filter((k) => EXPAND_ALLOWED.has(k))
  let relatedTruncated = false
  if (expandKeys.length) relatedTruncated = await applyExpand(supabase, workspaceId, entity, rows, expandKeys)

  // Devolvemos el criterio aplicado para que el agente sepa exactamente qué posición consultó
  // (p. ej. orderBy=created_at, orderDirection=asc, offset=2 → el 3er cliente registrado).
  return { entity, count: rows.length, rows, orderBy, orderDirection: ascending ? 'asc' : 'desc', offset, detailLevel, ...(relatedTruncated ? { related_truncated: true } : {}) }
}
