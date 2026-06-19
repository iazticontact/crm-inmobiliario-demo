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
  invoices: {
    pendingCount: number
    overdueCount: number
    pendingTotal: number
    overdueTotal: number
    recent: Array<{
      id: string
      client_name: string | null
      amount: number
      status: string | null
      due_date: string | null
      concept: string | null
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

  const [clients, tasks, invoices, events, activities, conversations] = await Promise.all([
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
    supabase.from('invoices')
      .select('id, client_id, client_name, amount, status, due_date, concept, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100),
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
  const invRows = (invoices.data ?? []) as Row[]
  const eventRows = (events.data ?? []) as Row[]
  const actRows = (activities.data ?? []) as Row[]
  const convRows = (conversations.data ?? []) as Row[]

  const pendingInvoices = invRows.filter((i) => i.status === 'pending' || i.status === 'overdue')
  const overdueInvoices = invRows.filter((i) => i.status === 'overdue')
  const sumAmount = (rows: Row[]) => rows.reduce((s, r) => s + toNumber(r.amount), 0)

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
    invoices: {
      pendingCount: pendingInvoices.length,
      overdueCount: overdueInvoices.length,
      pendingTotal: round2(sumAmount(pendingInvoices)),
      overdueTotal: round2(sumAmount(overdueInvoices)),
      recent: invRows.slice(0, 5).map((i) => ({
        id: String(i.id),
        client_name: clampString(i.client_name, 120),
        amount: toNumber(i.amount),
        status: clampString(i.status, 40),
        due_date: typeof i.due_date === 'string' ? i.due_date : null,
        concept: clampString(i.concept, 200),
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
  invoices: Array<{
    id: string
    amount: number
    status: string | null
    due_date: string | null
    concept: string | null
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

  const [tasksRes, invRes, eventsRes, convRes, docsRes, actsRes] = await Promise.all([
    supabase.from('tasks')
      .select('id, title, description, due_date, status, priority')
      .eq('workspace_id', workspaceId).eq('client_id', clientId)
      .order('due_date', { ascending: true, nullsFirst: false }).limit(10),
    supabase.from('invoices')
      .select('id, amount, status, due_date, concept, created_at')
      .eq('workspace_id', workspaceId)
      .or(safeName ? `client_id.eq.${clientId},client_name.eq.${safeName}` : `client_id.eq.${clientId}`)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('calendar_events')
      .select('id, title, date, start_at, end_at, status')
      .eq('workspace_id', workspaceId)
      .or(safeName ? `client_id.eq.${clientId},client_name.eq.${safeName}` : `client_id.eq.${clientId}`)
      .neq('status', 'cancelled')
      .order('date', { ascending: false }).limit(10),
    supabase.from('conversations')
      .select('id, channel, status, sentiment, intent, ai_summary, updated_at')
      .eq('workspace_id', workspaceId).eq('client_id', clientId)
      .order('updated_at', { ascending: false }).limit(5),
    supabase.from('documents')
      .select('id, title, mime_type, size, created_at')
      .eq('workspace_id', workspaceId).eq('client_id', clientId)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('activities')
      .select('id, type, description, created_at')
      .eq('workspace_id', workspaceId)
      .or(safeName ? `client_id.eq.${clientId},client_name.eq.${safeName}` : `client_id.eq.${clientId}`)
      .order('created_at', { ascending: false }).limit(10),
  ])

  const convRows = (convRes.data ?? []) as Row[]
  const convIds = convRows.map((c) => String(c.id))
  let msgRows: Row[] = []
  if (convIds.length) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('id, conversation_id, sender, body, is_ai, created_at')
      .eq('workspace_id', workspaceId)
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(10)
    msgRows = (msgs ?? []) as Row[]
  }

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
    invoices: ((invRes.data ?? []) as Row[]).map((i) => ({
      id: String(i.id),
      amount: toNumber(i.amount),
      status: clampString(i.status, 40),
      due_date: typeof i.due_date === 'string' ? i.due_date : null,
      concept: clampString(i.concept, 200),
    })),
    calendarEvents: ((eventsRes.data ?? []) as Row[]).map((e) => ({
      id: String(e.id),
      title: clampString(e.title, 200) ?? '',
      date: typeof e.date === 'string' ? e.date : null,
      start_at: typeof e.start_at === 'string' ? e.start_at : null,
      end_at: typeof e.end_at === 'string' ? e.end_at : null,
      status: clampString(e.status, 40),
    })),
    conversations: convRows.map((cv) => ({
      id: String(cv.id),
      channel: clampString(cv.channel, 40),
      status: clampString(cv.status, 40),
      sentiment: clampString(cv.sentiment, 40),
      intent: clampString(cv.intent, 60),
      ai_summary: clampString(cv.ai_summary, 280),
      updated_at: typeof cv.updated_at === 'string' ? cv.updated_at : null,
    })),
    recentMessages: msgRows.map((m) => ({
      id: String(m.id),
      conversation_id: m.conversation_id ? String(m.conversation_id) : null,
      sender: clampString(m.sender, 40),
      is_ai: m.is_ai === true,
      body: clampString(m.body, 280),
      created_at: typeof m.created_at === 'string' ? m.created_at : null,
    })),
    documents: ((docsRes.data ?? []) as Row[]).map((d) => ({
      id: String(d.id),
      file_name: clampString(d.title, 200) ?? '',
      mime_type: clampString(d.mime_type, 80),
      size_bytes: typeof d.size === 'number' ? d.size : null,
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

  let q = supabase.from('tasks')
    .select('id, title, description, due_date, client_id, client_name, status, priority, created_at')
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
  const o = asObject(input)
  const limit = asPositiveInt(o.limit, 10, 10)
  const cid = clientIdFromInput(input)
  if (cid.error) return cid.error

  let q = supabase.from('invoices')
    .select('id, client_id, client_name, amount, status, due_date, concept, created_at')
    .eq('workspace_id', workspaceId)
  if (cid.clientId) q = q.eq('client_id', cid.clientId)
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) return { error: 'query_failed', message: 'No pude leer las facturas.' }

  const rows = (data ?? []) as Row[]
  const pending = rows.filter((r) => r.status === 'pending')
  const overdue = rows.filter((r) => r.status === 'overdue')
  const paid = rows.filter((r) => r.status === 'paid')
  const sum = (rs: Row[]) => rs.reduce((s, r) => s + toNumber(r.amount), 0)

  const shape = (r: Row): InvoiceShape => ({
    id: String(r.id),
    client_id: r.client_id ? String(r.client_id) : null,
    client_name: clampString(r.client_name, 120),
    amount: toNumber(r.amount),
    status: clampString(r.status, 40),
    due_date: typeof r.due_date === 'string' ? r.due_date : null,
    concept: clampString(r.concept, 200),
    created_at: typeof r.created_at === 'string' ? r.created_at : null,
  })

  return {
    totals: {
      pendingCount: pending.length,
      overdueCount: overdue.length,
      paidCount: paid.length,
      pendingTotal: round2(sum(pending)),
      overdueTotal: round2(sum(overdue)),
      paidTotal: round2(sum(paid)),
    },
    pending: pending.slice(0, limit).map(shape),
    overdue: overdue.slice(0, limit).map(shape),
    recent: rows.slice(0, limit).map(shape),
  }
}

// ─────────────────────────────────────────────────────────────── get_calendar_summary

export type CalendarSummary = {
  events: Array<{
    id: string
    title: string
    start_at: string | null
    end_at: string | null
    client_id: string | null
    client_name: string | null
    status: string | null
    source: string | null
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
  const fromIso = parseIsoDate(o.from) ?? today
  const toIso = parseIsoDate(o.to) ?? addDaysIso(today, 14)
  if (toIso < fromIso) {
    return { error: 'invalid_input', message: 'Rango de fechas inválido: `to` es anterior a `from`.' }
  }

  let q = supabase.from('calendar_events')
    .select('id, title, date, start_at, end_at, client_id, client_name, status, type')
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
      start_at: typeof e.start_at === 'string' ? e.start_at : null,
      end_at: typeof e.end_at === 'string' ? e.end_at : null,
      client_id: e.client_id ? String(e.client_id) : null,
      client_name: clampString(e.client_name, 120),
      status: clampString(e.status, 40),
      source: clampString(e.type, 40),
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

  let q = supabase.from('documents')
    .select('id, client_id, title, mime_type, size, created_at')
    .eq('workspace_id', workspaceId)
  if (cid.clientId) q = q.eq('client_id', cid.clientId)
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return { error: 'query_failed', message: 'No pude leer los documentos.' }

  return {
    documents: ((data ?? []) as Row[]).map((d) => ({
      id: String(d.id),
      client_id: d.client_id ? String(d.client_id) : null,
      file_name: clampString(d.title, 200) ?? '',
      mime_type: clampString(d.mime_type, 80),
      size_bytes: typeof d.size === 'number' ? d.size : null,
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

export type SearchPropertiesResult = {
  properties: Array<{
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
  }>
}

// Search the property portfolio. Optional filters: query (title/city/area/
// address), status (e.g. only available), city. Workspace-scoped, limited.
export async function searchProperties(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Json,
): Promise<ReaderResult<SearchPropertiesResult>> {
  const o = asObject(input)
  const query = asString(o.query)
  const status = asString(o.status)
  const city = asString(o.city)
  let q = supabase
    .from('properties')
    .select('id, title, property_type, operation_type, status, city, area, address, price, currency')
    .eq('workspace_id', workspaceId)
  if (status) q = q.eq('status', status)
  if (city) q = q.ilike('city', `%${city}%`)
  if (query) {
    const safe = query.replace(/[,()]/g, '')
    q = q.or(`title.ilike.%${safe}%,city.ilike.%${safe}%,area.ilike.%${safe}%,address.ilike.%${safe}%`)
  }
  const { data, error } = await q.order('updated_at', { ascending: false }).limit(25)
  if (error) return { error: 'query_failed', message: 'No pude leer las propiedades.' }
  return {
    properties: ((data ?? []) as Row[]).map((p) => ({
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
    })),
  }
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
  clients: { table: 'clients', cols: 'id, name, company, email, phone, channel, status, notes, metadata, created_at', search: ['name', 'company', 'email', 'phone'], filters: ['status', 'channel'], dateCol: 'created_at', orderCol: 'updated_at', soft: true, includeMeta: true },
  opportunities: { table: 'opportunities', cols: 'id, title, stage, value, probability, expected_close_date, notes, client_id', search: ['title', 'notes'], filters: ['stage'], dateCol: 'expected_close_date', orderCol: 'updated_at', soft: true },
  service_cases: { table: 'service_cases', cols: 'id, title, case_type, status, priority, due_date, notes, client_id', search: ['title', 'notes'], filters: ['status', 'priority', 'case_type'], dateCol: 'due_date', orderCol: 'updated_at', soft: true },
  tasks: { table: 'tasks', cols: 'id, title, status, priority, due_date, client_id', search: ['title'], filters: ['status', 'priority'], dateCol: 'due_date', orderCol: 'due_date' },
  calendar_events: { table: 'calendar_events', cols: 'id, title, type, date, start_at, location, status, client_id', search: ['title', 'location'], filters: ['type', 'status'], dateCol: 'date', orderCol: 'date' },
  properties: { table: 'properties', cols: 'id, title, property_type, operation_type, status, city, area, address, price, currency', search: ['title', 'city', 'area', 'address'], filters: ['status', 'property_type', 'operation_type', 'city'], orderCol: 'updated_at' },
  documents: { table: 'documents', cols: 'id, title, type, mime_type, size, created_at, client_id', search: ['title'], filters: ['type'], dateCol: 'created_at', orderCol: 'created_at' },
  activities: { table: 'activities', cols: 'id, type, title, description, created_at, client_id', search: ['title', 'description'], filters: ['type'], dateCol: 'created_at', orderCol: 'created_at' },
}

export type CrmQueryResult = { entity: string; count: number; rows: Row[] }

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

  const dr = asObject(o.dateRange)
  if (cfg.dateCol) {
    const from = parseIsoDate(dr.from)
    const to = parseIsoDate(dr.to)
    if (from) q = q.gte(cfg.dateCol, from)
    if (to) q = q.lte(cfg.dateCol, to)
  }

  const { data, error } = await q.order(cfg.orderCol, { ascending: false, nullsFirst: false }).limit(limit)
  if (error) return { error: 'query_failed', message: `No pude consultar ${entity}.` }
  const rows = ((data ?? []) as Row[]).map((r) => sanitizeQueryRow(cfg, r))
  return { entity, count: rows.length, rows }
}
