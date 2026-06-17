// Server-side CRM tools for assistant API routes.
// Each tool accepts a Supabase server client (anon key) + workspaceId.
// Never uses getSupabaseBrowserClient — that's browser-only.
import type { SupabaseClient } from '@supabase/supabase-js'

const CLIENT_COLUMNS = 'id, workspace_id, name, company, email, phone, channel, status, lead_score, notes, metadata, created_at, updated_at'

// Business/fiscal/custom fields the user can enter in the client form live in
// clients.metadata (jsonb) — e.g. document_id (DNI/NIF), address, city_area.
// These maps let the assistant read them and answer exact-field questions
// ("¿cuál es su DNI?") without dumping raw JSON or technical keys.
//
// Each canonical field lists the metadata keys (and dedicated columns) to probe,
// in priority order, plus a human label. Accent-insensitive aliases route a user
// request ("dni", "nif", "correo"…) to the canonical field.
type FieldSpec = { label: string; columns?: string[]; metaKeys: string[] }
const CLIENT_FIELD_SPECS: Record<string, FieldSpec> = {
  document: { label: 'DNI/NIF/CIF', metaKeys: ['document_id', 'dni', 'nif', 'cif', 'nie', 'tax_id', 'fiscal_id', 'vat_id', 'document_number', 'id_number', 'national_id', 'documento'] },
  email: { label: 'Email', columns: ['email'], metaKeys: ['email', 'correo', 'mail'] },
  phone: { label: 'Teléfono', columns: ['phone'], metaKeys: ['phone', 'telefono', 'movil', 'mobile', 'whatsapp'] },
  company: { label: 'Empresa', columns: ['company'], metaKeys: ['company', 'empresa'] },
  address: { label: 'Dirección', metaKeys: ['address', 'direccion'] },
  area: { label: 'Zona', metaKeys: ['city_area', 'zona', 'area', 'preferred_area', 'city', 'ciudad'] },
  budget: { label: 'Presupuesto', metaKeys: ['budget', 'presupuesto'] },
  nationality: { label: 'Nacionalidad', metaKeys: ['nationality', 'nacionalidad'] },
  language: { label: 'Idioma', metaKeys: ['preferred_language', 'idioma', 'language'] },
  client_type: { label: 'Tipo de cliente', metaKeys: ['client_type', 'tipo'] },
}
// Free-text request → canonical field key.
const FIELD_ALIASES: Record<string, string> = {
  dni: 'document', nif: 'document', cif: 'document', nie: 'document', documento: 'document', 'tax id': 'document', 'numero fiscal': 'document', fiscal: 'document', identificacion: 'document',
  email: 'email', correo: 'email', mail: 'email', 'e-mail': 'email',
  telefono: 'phone', tel: 'phone', movil: 'phone', whatsapp: 'phone', numero: 'phone', contacto: 'phone',
  empresa: 'company', company: 'company',
  direccion: 'address', domicilio: 'address',
  zona: 'area', area: 'area', ciudad: 'area', poblacion: 'area',
  presupuesto: 'budget', budget: 'budget',
  nacionalidad: 'nationality',
  idioma: 'language', lengua: 'language',
  tipo: 'client_type',
}

function normalizeKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

// Resolve a canonical field value from a client row (dedicated column first, then
// metadata keys). Returns { label, value } or null if not present anywhere.
function resolveClientField(clientRow: Row, canonical: string): { label: string; value: string } | null {
  const spec = CLIENT_FIELD_SPECS[canonical]
  if (!spec) return null
  for (const col of spec.columns ?? []) {
    if (hasValue(clientRow[col])) return { label: spec.label, value: String(clientRow[col]) }
  }
  const meta = asMetadata(clientRow.metadata)
  const metaByNorm: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) metaByNorm[normalizeKey(k)] = v
  for (const key of spec.metaKeys) {
    const v = metaByNorm[normalizeKey(key)]
    if (hasValue(v)) return { label: spec.label, value: String(v) }
  }
  return null
}

// Human-readable lines for the business-relevant metadata of a client (skips
// technical/internal keys). Used in the full profile so DNI/dirección/zona show up.
function describeClientMetadata(clientRow: Row): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const canonical of ['document', 'address', 'area', 'budget', 'nationality', 'language', 'client_type']) {
    const found = resolveClientField(clientRow, canonical)
    if (found && !seen.has(found.label)) {
      lines.push(`${found.label}: ${found.value}`)
      seen.add(found.label)
    }
  }
  return lines
}

export type ToolResult = {
  text: string
  data: unknown
  referencedClientId?: string
  referencedClientName?: string
  referencedList?: Record<string, unknown>[]
}

export type PreparedActionData = {
  type: 'booking' | 'invoice' | 'task'
  clientId?: string
  clientName?: string
  service?: string
  date?: string
  time?: string
  duration?: number
  amount?: number
  concept?: string
  dueDate?: string
  taskTitle?: string
  description?: string
  missingFields: string[]
}

type Row = Record<string, unknown>

function hasValue(x: unknown): boolean {
  const s = x === null || x === undefined ? '' : String(x).trim()
  return s.length > 0 && s !== 'No consta'
}

// Client one-liner for the model. Includes email + phone (so questions like
// "¿cuál es el email de X?" can be answered) and intentionally OMITS the internal
// lead score (never shown to the user, per product rules).
function fmtClient(c: Row, i?: number): string {
  const prefix = i !== undefined ? `${i + 1}. ` : ''
  const name = String(c.name || 'Sin nombre')
  const co = hasValue(c.company) ? ` (${c.company})` : ''
  const st = c.status ? ` · ${c.status}` : ''
  const email = hasValue(c.email) ? ` · email ${c.email}` : ''
  const phone = hasValue(c.phone) ? ` · tel ${c.phone}` : ''
  return `${prefix}${name}${co}${st}${email}${phone}`
}

// 1. CRM overview — workspace-level counts
export async function toolCrmOverview(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const today = new Date().toISOString().slice(0, 10)
  const [clients, invoices, events, tasks] = await Promise.all([
    supabase.from('clients').select('status, lead_score').eq('workspace_id', workspaceId),
    supabase.from('invoices').select('status, amount').eq('workspace_id', workspaceId),
    supabase.from('calendar_events').select('date').eq('workspace_id', workspaceId).neq('status', 'cancelled').gte('date', today).limit(20),
    supabase.from('tasks').select('status').eq('workspace_id', workspaceId).eq('status', 'pending').limit(50),
  ])

  const cls = (clients.data ?? []) as Row[]
  const invs = (invoices.data ?? []) as Row[]
  const evts = events.data ?? []
  const tks = tasks.data ?? []

  const total = cls.length
  const active = cls.filter((c) => c.status === 'active').length
  const leads = cls.filter((c) => c.status === 'lead').length
  const inactive = cls.filter((c) => c.status === 'inactive').length
  const lost = cls.filter((c) => c.status === 'churned' || c.status === 'lost').length
  const pending = invs.filter((i) => i.status === 'pending').length
  const overdue = invs.filter((i) => i.status === 'overdue').length

  const lines = [
    `📊 Tienes ${total} cliente(s): ${active} activo(s), ${leads} lead(s)${inactive ? `, ${inactive} inactivo(s)` : ''}${lost ? ` y ${lost} perdido(s)` : ''}.`,
  ]
  if (overdue) lines.push(`⚠️ ${overdue} factura(s) vencida(s) — acción urgente.`)
  if (pending) lines.push(`💸 ${pending} factura(s) pendiente(s) de cobro.`)
  if (evts.length) lines.push(`📅 ${evts.length} cita(s) próxima(s) en calendario.`)
  else lines.push('📅 Sin citas próximas en el calendario.')
  if (tks.length) lines.push(`✅ ${tks.length} tarea(s) pendiente(s).`)
  if (!overdue && !pending && !tks.length) lines.push('Todo al día — buen trabajo.')

  return {
    text: lines.join(' '),
    data: { total, active, leads, inactive, lost, pending, overdue, upcomingEvents: evts.length, pendingTasks: tks.length },
  }
}

// 2. List clients with optional status/channel/score filters
export async function toolListClients(
  supabase: SupabaseClient,
  workspaceId: string,
  filter?: { status?: string; channel?: string; minScore?: number; limit?: number }
): Promise<ToolResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase.from('clients').select(CLIENT_COLUMNS).eq('workspace_id', workspaceId)
  if (filter?.status) q = q.eq('status', filter.status)
  // ilike for case-insensitive match: DB may store 'WhatsApp', 'whatsapp', 'Web', 'web', etc.
  if (filter?.channel) q = q.ilike('channel', filter.channel)
  const { data } = await q.order('lead_score', { ascending: false }).limit(filter?.limit ?? 50) as { data: Row[] | null }

  const rows = data ?? []
  const filtered = filter?.minScore !== undefined ? rows.filter((c) => Number(c.lead_score ?? 0) >= (filter.minScore ?? 0)) : rows
  const label = filter?.status ? `clientes ${filter.status}` : filter?.channel ? `clientes por ${filter.channel}` : 'clientes'

  if (!filtered.length) return { text: `Sin ${label} registrados todavía.`, data: [], referencedList: [] }

  const shown = filtered.slice(0, 15)
  const header = filtered.length > 15 ? `Mostrando ${shown.length} de ${filtered.length}` : `${filtered.length}`
  return {
    text: `${header} ${label}:\n${shown.map((c, i) => fmtClient(c, i)).join('\n')}`,
    data: filtered,
    referencedList: filtered,
  }
}

// 3. Search clients by name/company/email
export async function toolSearchClients(supabase: SupabaseClient, workspaceId: string, query: string): Promise<ToolResult> {
  const q = query.trim()
  const { data } = await supabase
    .from('clients').select(CLIENT_COLUMNS).eq('workspace_id', workspaceId)
    .or(`name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%`)
    .order('lead_score', { ascending: false }).limit(20)

  const rows = (data ?? []) as Row[]
  if (!rows.length) return { text: `Sin resultados para "${q}". Prueba con otro término o el nombre completo.`, data: [], referencedList: [] }

  if (rows.length === 1) {
    return {
      text: fmtClient(rows[0]),
      data: rows[0],
      referencedClientId: String(rows[0].id),
      referencedClientName: String(rows[0].name),
      referencedList: rows,
    }
  }

  return {
    text: `Encontré ${rows.length} cliente(s) para "${q}":\n${rows.slice(0, 10).map((c, i) => fmtClient(c, i)).join('\n')}`,
    data: rows,
    referencedList: rows,
  }
}

// 4. Full client profile — real CRM entities by client_id:
//    basic data + opportunities + service_cases + tasks + calendar_events + activity.
//    Reads the live workspace tables (NOT the legacy invoices module). Every query
//    is workspace-scoped + client-scoped under RLS. Null fields surface as "No consta".
export async function toolGetClientContext(
  supabase: SupabaseClient,
  workspaceId: string,
  clientId?: string,
  clientName?: string
): Promise<ToolResult> {
  let clientRow: Row | null = null

  if (clientId) {
    const { data } = await supabase.from('clients').select(CLIENT_COLUMNS).eq('workspace_id', workspaceId).eq('id', clientId).maybeSingle()
    clientRow = data as Row | null
  } else if (clientName) {
    const { data } = await supabase.from('clients').select(CLIENT_COLUMNS).eq('workspace_id', workspaceId).ilike('name', `%${clientName}%`).limit(1).maybeSingle()
    clientRow = data as Row | null
  }

  if (!clientRow) return { text: 'No encontré ese cliente en el CRM. Prueba con el nombre completo o parte del email.', data: null }

  const id = String(clientRow.id)
  const name = String(clientRow.name)
  const show = (x: unknown) => (hasValue(x) ? String(x) : 'No consta')

  const [opps, cases, tasks, events, acts] = await Promise.all([
    supabase.from('opportunities').select('id, title, stage, value, probability, expected_close_date, notes').eq('workspace_id', workspaceId).eq('client_id', id).is('deleted_at', null).order('updated_at', { ascending: false }).limit(10),
    supabase.from('service_cases').select('id, title, case_type, status, priority, due_date').eq('workspace_id', workspaceId).eq('client_id', id).is('deleted_at', null).order('updated_at', { ascending: false }).limit(10),
    supabase.from('tasks').select('id, title, status, priority, due_date').eq('workspace_id', workspaceId).eq('client_id', id).order('due_date', { ascending: true }).limit(10),
    supabase.from('calendar_events').select('id, title, type, date, start_at, location, status').eq('workspace_id', workspaceId).eq('client_id', id).neq('status', 'cancelled').order('date', { ascending: false }).limit(6),
    supabase.from('activities').select('type, title, description, created_at').eq('workspace_id', workspaceId).eq('client_id', id).order('created_at', { ascending: false }).limit(6),
  ])

  const oppRows = (opps.data ?? []) as Row[]
  const caseRows = (cases.data ?? []) as Row[]
  const taskRows = (tasks.data ?? []) as Row[]
  const eventRows = (events.data ?? []) as Row[]
  const actRows = (acts.data ?? []) as Row[]

  const lines = [
    `Cliente: ${name}${hasValue(clientRow.company) ? ` (${clientRow.company})` : ''}`,
    `Estado: ${show(clientRow.status)} · Canal: ${show(clientRow.channel)}`,
    `Email: ${show(clientRow.email)} · Teléfono: ${show(clientRow.phone)}`,
  ]
  // Business/fiscal/custom fields from metadata (DNI/NIF, dirección, zona…).
  for (const metaLine of describeClientMetadata(clientRow)) lines.push(metaLine)
  if (hasValue(clientRow.notes)) lines.push(`Notas: ${String(clientRow.notes)}`)

  lines.push(
    oppRows.length
      ? `Operaciones (${oppRows.length}): ${oppRows.map((o) => `${hasValue(o.title) ? o.title : 'Operación'} [${show(o.stage)}${hasValue(o.value) ? `, ${o.value}€` : ''}${hasValue(o.expected_close_date) ? `, cierre ${o.expected_close_date}` : ''}]`).join('; ')}`
      : 'Operaciones: ninguna registrada.',
  )
  lines.push(
    caseRows.length
      ? `Expedientes (${caseRows.length}): ${caseRows.map((c) => `${hasValue(c.title) ? c.title : show(c.case_type)} [${show(c.status)}${hasValue(c.priority) ? `, ${c.priority}` : ''}${hasValue(c.due_date) ? `, vence ${c.due_date}` : ''}]`).join('; ')}`
      : 'Expedientes: ninguno registrado.',
  )
  lines.push(
    taskRows.length
      ? `Tareas (${taskRows.length}): ${taskRows.map((t) => `${hasValue(t.title) ? t.title : 'Tarea'} [${show(t.status)}${hasValue(t.due_date) ? `, vence ${t.due_date}` : ''}]`).join('; ')}`
      : 'Tareas: ninguna registrada.',
  )
  if (eventRows.length) {
    lines.push(`Citas (${eventRows.length}): ${eventRows.map((e) => `${hasValue(e.title) ? e.title : 'Cita'} el ${hasValue(e.date) ? e.date : (hasValue(e.start_at) ? String(e.start_at).slice(0, 10) : 'fecha no consta')}`).join('; ')}`)
  }
  if (actRows.length) {
    lines.push(`Actividad reciente: ${actRows.map((a) => (hasValue(a.description) ? a.description : hasValue(a.title) ? a.title : a.type)).filter(Boolean).slice(0, 4).join(' · ')}`)
  }

  return {
    text: lines.join('\n'),
    data: {
      client: clientRow,
      opportunities: oppRows,
      service_cases: caseRows,
      tasks: taskRows,
      calendar_events: eventRows,
      activities: actRows,
    },
    referencedClientId: id,
    referencedClientName: name,
  }
}

// 4b. Latest registered client(s) — "nuevo cliente", "último cliente registrado".
//     Returns the single newest as the ACTIVE entity (referencedClientId) so the
//     thread remembers it for follow-ups ("su DNI", "este cliente").
export async function toolGetLatestClient(supabase: SupabaseClient, workspaceId: string, limit = 1): Promise<ToolResult> {
  const n = Math.max(1, Math.min(limit, 10))
  const { data } = await supabase
    .from('clients').select(CLIENT_COLUMNS).eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false }).limit(n)
  const rows = (data ?? []) as Row[]
  if (!rows.length) return { text: 'Aún no hay clientes registrados en el workspace.', data: [], referencedList: [] }
  const top = rows[0]
  if (n === 1) {
    return {
      text: `El último cliente registrado es ${fmtClient(top)}.`,
      data: top,
      referencedClientId: String(top.id),
      referencedClientName: String(top.name),
      referencedList: rows,
    }
  }
  return {
    text: `Últimos ${rows.length} clientes registrados:\n${rows.map((c, i) => fmtClient(c, i)).join('\n')}`,
    data: rows,
    referencedClientId: String(top.id),
    referencedClientName: String(top.name),
    referencedList: rows,
  }
}

// 4c. Exact field retrieval ("¿cuál es su DNI?", "dame el email de X"). Resolves
//     the client (id or name) then the requested field via aliases across
//     dedicated columns + metadata. Returns the exact value or a clear "No consta".
export async function toolGetClientFieldExact(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { clientId?: string; clientName?: string; field: string }
): Promise<ToolResult> {
  const req = normalizeKey(opts.field || '')
  const canonical = FIELD_ALIASES[req] ?? (CLIENT_FIELD_SPECS[req] ? req : '')

  let clientRow: Row | null = null
  let candidates: Row[] = []
  if (opts.clientId) {
    const { data } = await supabase.from('clients').select(CLIENT_COLUMNS).eq('workspace_id', workspaceId).eq('id', opts.clientId).maybeSingle()
    clientRow = data as Row | null
  } else if (opts.clientName) {
    const { data } = await supabase.from('clients').select(CLIENT_COLUMNS).eq('workspace_id', workspaceId)
      .or(`name.ilike.%${opts.clientName}%,company.ilike.%${opts.clientName}%`).limit(5)
    candidates = (data ?? []) as Row[]
    if (candidates.length === 1) clientRow = candidates[0]
  }

  if (!clientRow) {
    if (candidates.length > 1) {
      return { text: `Hay ${candidates.length} clientes que coinciden:\n${candidates.map((c, i) => fmtClient(c, i)).join('\n')}\n¿De cuál necesitas el dato?`, data: candidates, referencedList: candidates }
    }
    return { text: 'No encontré ese cliente. Dime el nombre completo o el email.', data: null }
  }

  const name = String(clientRow.name)
  if (!canonical) {
    return { text: `Cliente ${name}. Dime qué campo necesitas (DNI/NIF, email, teléfono, dirección, zona…).`, data: clientRow, referencedClientId: String(clientRow.id), referencedClientName: name }
  }

  const found = resolveClientField(clientRow, canonical)
  const label = CLIENT_FIELD_SPECS[canonical]?.label ?? canonical
  return {
    text: found ? `${label} de ${name}: ${found.value}` : `No consta ${label} registrado de ${name}.`,
    data: { client_name: name, field: label, value: found?.value ?? null, found: Boolean(found) },
    referencedClientId: String(clientRow.id),
    referencedClientName: name,
  }
}

// 4d. Documents attached to a client — METADATA ONLY. The CRM stores files
//     (Storage bucket + documents table) but does NOT index their content (no
//     extraction/RAG). So this lists what's attached (title, type) and the
//     assistant must be honest: it can see the list, not read the contents.
export async function toolListClientDocuments(
  supabase: SupabaseClient,
  workspaceId: string,
  clientId?: string,
  clientName?: string,
): Promise<ToolResult> {
  let id = clientId
  let name = clientName
  if (!id && clientName) {
    const { data } = await supabase.from('clients').select('id, name').eq('workspace_id', workspaceId).ilike('name', `%${clientName}%`).limit(1).maybeSingle()
    if (data) { id = String((data as Row).id); name = String((data as Row).name) }
  }
  if (!id) return { text: 'Dime de qué cliente quieres ver los documentos.', data: null }

  const { data } = await supabase
    .from('documents')
    .select('id, title, type, mime_type, size, created_at')
    .eq('workspace_id', workspaceId).eq('client_id', id)
    .order('created_at', { ascending: false }).limit(50)
  const rows = (data ?? []) as Row[]
  if (!rows.length) {
    return { text: `No hay documentos adjuntos${name ? ` de ${name}` : ''}.`, data: [], referencedClientId: id, referencedClientName: name }
  }
  const list = rows.map((d, i) => `${i + 1}. ${hasValue(d.title) ? d.title : 'Documento'}${hasValue(d.type) ? ` · ${d.type}` : ''}`).join('\n')
  return {
    text: `${rows.length} documento(s) adjunto(s)${name ? ` de ${name}` : ''}:\n${list}\nVeo el listado, pero el contenido de los archivos no está indexado todavía, así que no puedo leerlos por dentro.`,
    data: rows,
    referencedClientId: id,
    referencedClientName: name,
  }
}

// 5. Hot leads (lead_score >= 70)
export async function toolHotLeads(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const { data } = await supabase
    .from('clients').select(CLIENT_COLUMNS).eq('workspace_id', workspaceId)
    .in('status', ['lead', 'active'])
    .gte('lead_score', 70)
    .order('lead_score', { ascending: false }).limit(10)

  const rows = (data ?? []) as Row[]
  if (!rows.length) return { text: 'Sin leads con score ≥ 70 ahora mismo. Dime un cliente en concreto y miro su situación.', data: [], referencedList: [] }

  const top = rows[0]
  return {
    text: `🔥 ${rows.length} lead${rows.length > 1 ? 's' : ''} con alto potencial:\n${rows.map((c, i) => fmtClient(c, i)).join('\n')}\nPriorizaría a ${String(top.name)} — tiene el mayor score.`,
    data: rows,
    referencedClientId: String(top.id),
    referencedClientName: String(top.name),
    referencedList: rows,
  }
}

// 6. Ordinal selection from last results ("el primero", "el segundo"...)
export function toolSelectByOrdinal(list: Row[], index: number): ToolResult {
  if (!list.length) return { text: 'No tengo lista activa ahora mismo. Haz primero una consulta y luego dime cuál quieres ver.', data: null }
  if (index < 0 || index >= list.length) return { text: `Solo tengo ${list.length} resultado${list.length !== 1 ? 's' : ''} en la lista. Prueba con un número del 1 al ${list.length}.`, data: null }
  const item = list[index]
  const name = String(item.name ?? item.title ?? item.client_name ?? `Elemento ${index + 1}`)
  return {
    text: fmtClient(item),
    data: item,
    referencedClientId: item.id ? String(item.id) : undefined,
    referencedClientName: name,
  }
}

// 7. Latest N clients by creation date
export async function toolLatestClients(supabase: SupabaseClient, workspaceId: string, limit = 5): Promise<ToolResult> {
  const { data } = await supabase
    .from('clients').select(CLIENT_COLUMNS).eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false }).limit(limit)

  const rows = (data ?? []) as Row[]
  if (!rows.length) return { text: 'Sin clientes registrados todavía.', data: [], referencedList: [] }

  const list = rows.map((c, i) => {
    const date = c.created_at ? (() => { try { return new Date(String(c.created_at)).toLocaleDateString('es-ES') } catch { return '' } })() : ''
    return `${i + 1}. ${String(c.name)}${date ? ` · ${date}` : ''} · ${String(c.status)}`
  }).join('\n')

  return { text: `Últimos ${rows.length} cliente${rows.length > 1 ? 's' : ''} registrados:\n${list}`, data: rows, referencedList: rows }
}

// 7b. Oldest client by creation date (primer cliente que tuvimos)
export async function toolOldestClient(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const { data } = await supabase
    .from('clients').select(CLIENT_COLUMNS).eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true }).limit(1)

  const rows = (data ?? []) as Row[]
  if (!rows.length) return { text: 'No hay clientes registrados todavía.', data: null }

  const c = rows[0]
  const date = c.created_at ? (() => { try { return new Date(String(c.created_at)).toLocaleDateString('es-ES') } catch { return '' } })() : ''
  return {
    text: `El primer cliente que registraste fue ${String(c.name)}${date ? `, el ${date}` : ''}. ${fmtClient(c)}`,
    data: c,
    referencedClientId: String(c.id),
    referencedClientName: String(c.name),
    referencedList: rows,
  }
}

async function resolveClientNames(supabase: SupabaseClient, rows: Row[]): Promise<Map<string, string>> {
  const orphanIds = [...new Set(
    rows.filter((i) => !i.client_name && i.client_id).map((i) => String(i.client_id))
  )]
  const map = new Map<string, string>()
  if (!orphanIds.length) return map
  const { data } = await supabase.from('clients').select('id, name').in('id', orphanIds)
  for (const c of (data ?? [])) map.set(String(c.id), String(c.name))
  return map
}

// 8. Pending invoices (pending + overdue)
export async function toolPendingInvoices(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const { data } = await supabase
    .from('invoices').select('*').eq('workspace_id', workspaceId)
    .in('status', ['pending', 'overdue'])
    .order('due_date', { ascending: true }).limit(20)

  const rows = (data ?? []) as Row[]
  if (!rows.length) return { text: 'Sin facturas pendientes. Los cobros están al día. 👌', data: [] }

  const clientNames = await resolveClientNames(supabase, rows)
  const total = rows.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const list = rows.slice(0, 10).map((i, idx) => {
    const label = i.client_name || (i.client_id ? clientNames.get(String(i.client_id)) : undefined) || 'cliente no asociado'
    return `${idx + 1}. ${label} · ${i.amount}€ (${i.status}) · vence ${i.due_date || 'sin fecha'}`
  }).join('\n')

  return { text: `💸 ${rows.length} factura${rows.length > 1 ? 's' : ''} pendiente${rows.length > 1 ? 's' : ''} — ${total.toFixed(0)}€ por cobrar:\n${list}`, data: rows }
}

// 9. Overdue invoices
export async function toolOverdueInvoices(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const { data } = await supabase
    .from('invoices').select('*').eq('workspace_id', workspaceId)
    .eq('status', 'overdue')
    .order('due_date', { ascending: true }).limit(20)

  const rows = (data ?? []) as Row[]
  if (!rows.length) return { text: 'Sin facturas vencidas. Todo cobrado a tiempo. 👌', data: [] }

  const clientNames = await resolveClientNames(supabase, rows)
  const total = rows.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const list = rows.map((i, idx) => {
    const label = i.client_name || (i.client_id ? clientNames.get(String(i.client_id)) : undefined) || 'cliente no asociado'
    return `${idx + 1}. ${label} · ${i.amount}€ · venció ${i.due_date || 'sin fecha'}`
  }).join('\n')

  return { text: `⚠️ ${rows.length} factura${rows.length > 1 ? 's' : ''} vencida${rows.length > 1 ? 's' : ''} — ${total.toFixed(0)}€ sin cobrar:\n${list}\nPriorizaría el cobro hoy.`, data: rows }
}

// 10. Upcoming calendar events
export async function toolUpcomingEvents(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('calendar_events').select('*').eq('workspace_id', workspaceId).neq('status', 'cancelled')
    .gte('date', today).order('date', { ascending: true }).order('start_hour', { ascending: true }).limit(10)

  const rows = data ?? []
  if (!rows.length) return { text: 'Sin citas próximas en el calendario.', data: [] }

  const list = rows.map((e, i) => {
    const time = e.start_hour !== undefined ? ` a las ${String(e.start_hour).padStart(2, '0')}:${String(e.start_minute ?? 0).padStart(2, '0')}` : ''
    return `${i + 1}. ${e.title || 'Sin título'} · ${e.date}${time}${e.client_name ? ` · ${e.client_name}` : ''}`
  }).join('\n')

  return { text: `📅 ${rows.length} cita${rows.length > 1 ? 's' : ''} próxima${rows.length > 1 ? 's' : ''}:\n${list}`, data: rows }
}

// 11. Pending tasks
export async function toolPendingTasks(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const { data, error } = await supabase
    .from('tasks').select('*').eq('workspace_id', workspaceId)
    .eq('status', 'pending').order('created_at', { ascending: false }).limit(20)

  if (error) return { text: 'No pude acceder a las tareas ahora mismo. Prueba de nuevo.', data: [] }

  const rows = data ?? []
  if (!rows.length) return { text: 'Sin tareas pendientes. La agenda está limpia. 👌', data: [] }

  const list = rows.map((t, i) => {
    const due = t.due_date ? ` · vence ${t.due_date}` : ''
    const client = t.client_name ? ` · ${t.client_name}` : ''
    return `${i + 1}. ${t.title || 'Tarea'}${client}${due}`
  }).join('\n')

  return { text: `✅ ${rows.length} tarea${rows.length > 1 ? 's' : ''} pendiente${rows.length > 1 ? 's' : ''}:\n${list}`, data: rows }
}

// 11b. Recent activity from public.activities (real CRM events: creations, edits,
// notes). Distinct from the deferred Inbox/WhatsApp messages. Read-only, RLS.
export async function toolRecentActivity(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const { data, error } = await supabase
    .from('activities').select('type, description, client_name, created_at').eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false }).limit(15)
  if (error) return { text: 'No pude leer la actividad reciente ahora mismo. Prueba de nuevo.', data: [] }
  const rows = data ?? []
  if (!rows.length) return { text: 'Aún no hay actividad registrada en este workspace.', data: [] }
  const list = rows.map((a, i) => {
    const who = a.client_name ? ` · ${a.client_name}` : ''
    const when = a.created_at ? ` · ${String(a.created_at).slice(0, 10)}` : ''
    return `${i + 1}. ${a.description || a.type || 'Actividad'}${who}${when}`
  }).join('\n')
  return { text: `🗒️ Últimas ${rows.length} actividad(es):\n${list}`, data: rows }
}

// 12. Recent open conversations (uses actual schema: no client_name or last_message columns)
export async function toolRecentConversations(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const { data } = await supabase
    .from('conversations')
    .select('id, channel, status, sentiment, ai_summary, updated_at')
    .eq('workspace_id', workspaceId)
    .neq('status', 'resolved')
    .order('updated_at', { ascending: false }).limit(10)

  const rows = data ?? []
  if (!rows.length) return { text: 'Sin conversaciones abiertas ahora mismo.', data: [] }

  const list = rows.map((c, i) => {
    const ch = String(c.channel || '?').toLowerCase()
    const st = c.status || 'abierta'
    const sent = c.sentiment || 'neutral'
    const summary = c.ai_summary ? ` · "${String(c.ai_summary).slice(0, 60)}"` : ''
    return `${i + 1}. Canal ${ch} · ${st} · ${sent}${summary}`
  }).join('\n')

  return { text: `${rows.length} conversación${rows.length > 1 ? 'es' : ''} abierta${rows.length > 1 ? 's' : ''}:\n${list}`, data: rows }
}

// 13. Recent messages, optionally filtered by conversation channel
export async function toolRecentMessages(supabase: SupabaseClient, workspaceId: string, channel?: string): Promise<ToolResult> {
  // First find conversations for this workspace (optionally by channel)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let convQuery: any = supabase.from('conversations').select('id, channel').eq('workspace_id', workspaceId)
  if (channel) convQuery = convQuery.ilike('channel', `%${channel}%`)
  const { data: convs } = await convQuery.order('updated_at', { ascending: false }).limit(10) as { data: { id: string; channel: string }[] | null }

  const convIds = (convs ?? []).map((c) => String(c.id))
  if (!convIds.length) return { text: `No hay conversaciones${channel ? ` de ${channel}` : ''}.`, data: [] }

  const { data: msgs } = await supabase
    .from('messages')
    .select('id, workspace_id, conversation_id, sender, body, is_ai, created_at')
    .eq('workspace_id', workspaceId)
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false }).limit(15)

  const rows = msgs ?? []
  if (!rows.length) return { text: `No hay mensajes recientes${channel ? ` en conversaciones de ${channel}` : ''}.`, data: [] }

  const list = rows.map((m, i) => {
    const who = m.sender === 'client' ? 'Cliente' : m.is_ai ? 'IA' : 'Agente'
    const date = m.created_at ? (() => { try { return new Date(String(m.created_at)).toLocaleDateString('es-ES') } catch { return '' } })() : ''
    return `${i + 1}. [${who}] ${String(m.body || '').slice(0, 80)}${date ? ` · ${date}` : ''}`
  }).join('\n')

  return {
    text: `${rows.length} mensaje(s) reciente(s)${channel ? ` en conversaciones de ${channel}` : ''}:\n${list}`,
    data: rows,
  }
}

// 14. Priority commercial actions
export async function toolRecommendedActions(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const today = new Date().toISOString().slice(0, 10)
  const [overdueRes, pendingRes, eventsRes, hotRes] = await Promise.all([
    supabase.from('invoices').select('client_name, amount').eq('workspace_id', workspaceId).eq('status', 'overdue').limit(5),
    supabase.from('invoices').select('client_name, amount').eq('workspace_id', workspaceId).eq('status', 'pending').limit(10),
    supabase.from('calendar_events').select('title, date, client_name').eq('workspace_id', workspaceId).neq('status', 'cancelled').gte('date', today).order('date').limit(3),
    supabase.from('clients').select('name, lead_score').eq('workspace_id', workspaceId).in('status', ['lead', 'active']).gte('lead_score', 70).order('lead_score', { ascending: false }).limit(3),
  ])

  const overdue = overdueRes.data ?? []
  const pending = pendingRes.data ?? []
  const events = eventsRes.data ?? []
  const hot = hotRes.data ?? []
  const actions: string[] = []

  if (overdue.length) {
    const names = overdue.slice(0, 3).map((i) => `${i.client_name} (${i.amount}€)`).join(', ')
    actions.push(`⚠️ ${overdue.length} factura(s) vencida(s): ${names}`)
  }
  if (pending.length) actions.push(`💸 ${pending.length} factura(s) pendiente(s) de cobro`)
  if (events.length) {
    const next = events[0]
    actions.push(`📅 Próxima cita: ${next.title} el ${next.date}${next.client_name ? ` con ${next.client_name}` : ''}`)
  }
  if (hot.length) {
    const topHot = hot[0]
    actions.push(`🔥 Lead caliente: ${String(topHot.name)} (score ${topHot.lead_score}) — no dejes pasar este`)
  }

  if (!actions.length) return { text: '✅ No hay acciones urgentes ahora mismo. Todo al día.', data: [] }

  const todayLabel = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  const sections: string[] = [`📊 Para hoy, ${todayLabel}, priorizaría:\n`]

  let i = 1
  if (overdue.length) {
    const names = overdue.slice(0, 2).map((inv) => `${inv.client_name} (${inv.amount}€)`).join(', ')
    sections.push(`💸 ${i++}. Resolver la${overdue.length > 1 ? 's' : ''} factura${overdue.length > 1 ? 's' : ''} vencida${overdue.length > 1 ? 's' : ''} — ${names}${overdue.length > 2 ? ` y ${overdue.length - 2} más` : ''}.`)
  }
  if (hot.length) {
    const topHot = hot[0]
    const rest = hot.slice(1).map((c) => String(c.name)).join(', ')
    sections.push(`🔥 ${i++}. Contactar a ${String(topHot.name)} (score ${topHot.lead_score})${rest ? ` — también ${rest}` : ''}: son los leads con más potencial ahora mismo.`)
  }
  if (events.length) {
    const next = events[0]
    sections.push(`📅 ${i++}. Preparar la cita "${next.title}"${next.client_name ? ` con ${next.client_name}` : ''} del ${next.date}.`)
  }
  if (pending.length && !overdue.length) {
    sections.push(`💸 ${i++}. Revisar las ${pending.length} facturas pendientes de cobro.`)
  }
  if (!hot.length && !overdue.length && !events.length) {
    sections.push(`✅ ${i++}. Crear tareas de seguimiento para los clientes más activos.`)
  }

  return { text: sections.join('\n'), data: actions }
}

// 15. n8n-compatible automation recommendations based on live CRM state
export async function toolAutomationRecommendations(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const [overdueRes, hotRes, allRes] = await Promise.all([
    supabase.from('invoices').select('client_name, amount').eq('workspace_id', workspaceId).eq('status', 'overdue').limit(5),
    supabase.from('clients').select('name, lead_score').eq('workspace_id', workspaceId).in('status', ['lead', 'active']).gte('lead_score', 70).order('lead_score', { ascending: false }).limit(3),
    supabase.from('clients').select('name, status').eq('workspace_id', workspaceId),
  ])

  const overdue = overdueRes.data ?? []
  const hot = hotRes.data ?? []
  const allClients = allRes.data ?? []
  const inactive = allClients.filter((c) => c.status === 'inactive')
  const inactiveCount = inactive.length

  const lines: string[] = ['⚙️ Automatizaciones recomendadas basadas en tu CRM real:\n']

  if (overdue.length) {
    const names = overdue.slice(0, 2).map((i) => `${i.client_name} (${i.amount}€)`).join(', ')
    lines.push(`1. 💸 [URGENTE] Recordatorio de facturas vencidas\n   → Tienes ${overdue.length} factura(s) sin cobrar: ${names}\n   → Automatiza: WhatsApp/email al cliente a los 3 días del vencimiento`)
  } else {
    lines.push(`1. 💸 Recordatorio de facturas vencidas\n   → Sin facturas vencidas ahora mismo — actívalo de forma preventiva`)
  }

  if (hot.length) {
    const topNames = hot.slice(0, 2).map((c) => `${c.name} (score ${c.lead_score})`).join(', ')
    lines.push(`2. 🔥 [URGENTE] Seguimiento de leads calientes\n   → ${hot.length} lead(s) con score ≥ 70: ${topNames}\n   → Automatiza: alerta interna + mensaje directo si no hay respuesta en 48h`)
  } else {
    lines.push(`2. 🔥 Seguimiento de leads calientes\n   → Sin leads calientes ahora mismo — actívalo para cuando lleguen`)
  }

  lines.push(`3. 👋 Bienvenida automática a nuevos clientes\n   → Automatiza: WhatsApp de bienvenida + PDF propuesta al crear un cliente nuevo`)

  if (inactiveCount > 0) {
    const names = inactive.slice(0, 2).map((c) => c.name).join(', ')
    lines.push(`4. 💤 [${inactiveCount > 3 ? 'ALTA' : 'MEDIA'}] Reactivación de clientes inactivos\n   → ${inactiveCount} cliente(s) sin actividad: ${names}${inactiveCount > 2 ? '...' : ''}\n   → Automatiza: email/WhatsApp mensual con oferta de reactivación`)
  } else {
    lines.push(`4. 💤 Reactivación de clientes inactivos\n   → Sin inactivos ahora mismo — configúralo para 60 días sin actividad`)
  }

  lines.push(`5. 📅 Confirmación automática de citas\n   → Automatiza: WhatsApp de confirmación 24h antes de cada cita`)
  lines.push(`6. ⏰ Alerta diaria de agenda\n   → Automatiza: resumen a las 8:00 con citas del día y clientes a contactar`)

  if (hot.length) {
    const topLead = hot[0]
    lines.push(`7. 📄 Propuesta automática a lead cualificado\n   → ${String(topLead.name)} (score ${topLead.lead_score}) podría recibir una propuesta ahora mismo\n   → Automatiza: envío de PDF cuando un lead supera score 80`)
  }

  const recs = [
    { title: 'Recordatorio facturas vencidas', priority: overdue.length > 0 ? 'alta' : 'media', automationSlug: 'overdue-invoice-reminder' },
    { title: 'Seguimiento leads calientes', priority: hot.length > 0 ? 'alta' : 'media', automationSlug: 'hot-lead-followup' },
    { title: 'Bienvenida nuevos clientes', priority: 'media', automationSlug: 'new-client-welcome' },
    { title: 'Reactivación inactivos', priority: inactiveCount > 3 ? 'alta' : 'baja', automationSlug: 'inactive-client-reactivation' },
    { title: 'Confirmación citas', priority: 'media', automationSlug: 'appointment-confirmation' },
    { title: 'Alerta agenda diaria', priority: 'media', automationSlug: 'daily-agenda-alert' },
    { title: 'Propuesta lead cualificado', priority: 'media', automationSlug: 'qualified-lead-proposal' },
  ]

  return { text: lines.join('\n'), data: recs }
}

// 16b. Prepare a task action card (no Supabase needed).
// Tasks do not structurally require a client: /api/assistant/confirm inserts
// tasks with client_id/client_name=null cleanly. Title is the only mandatory
// field. Keeping clientName out of missingFields lets the user confirm a
// no-client task without having to satisfy a phantom gate in the UI.
export function toolPrepareTask(
  extracted: { clientId?: string; clientName?: string; taskTitle?: string; description?: string; dueDate?: string }
): ToolResult & { preparedAction: PreparedActionData } {
  const { clientId, clientName, taskTitle, description, dueDate } = extracted
  const missingFields = !taskTitle ? ['título'] : []
  const action: PreparedActionData = { type: 'task', clientId, clientName, taskTitle, description, dueDate, missingFields }
  const text = missingFields.length
    ? `✅ Tarea casi lista — falta: ${missingFields.join(', ')}. Dímelo y la dejo lista para confirmar.`
    : `✅ Tarea lista${clientName ? ` para ${clientName}` : ''}: ${taskTitle}. Confirma cuando quieras.`
  return { text, data: action, preparedAction: action }
}

// 16. Prepare a booking or invoice action card (no Supabase needed)
export function toolPrepareAction(
  type: 'booking' | 'invoice',
  extracted: { clientId?: string; clientName?: string; service?: string; date?: string; time?: string; duration?: number; amount?: number; concept?: string; dueDate?: string }
): ToolResult & { preparedAction: PreparedActionData } {
  const { clientId, clientName, service, date, time, duration, amount, concept, dueDate } = extracted

  if (type === 'booking') {
    const durationMin = typeof duration === 'number' && duration > 0 ? duration : 60
    const missingFields = [!clientName && 'cliente', !date && 'fecha', !time && 'hora'].filter(Boolean) as string[]
    const action: PreparedActionData = { type: 'booking', clientId, clientName, service, date, time, duration: durationMin, missingFields }
    const text = missingFields.length
      ? `📅 Casi lista — falta: ${missingFields.join(', ')}. Dímelos y la preparo para confirmar.`
      : `📅 Cita lista (${durationMin} min). Revísala y confirma cuando quieras.`
    return { text, data: action, preparedAction: action }
  }

  const missingFields = [!clientName && 'cliente', !amount && 'importe', !concept && 'concepto', !dueDate && 'vencimiento'].filter(Boolean) as string[]
  const action: PreparedActionData = { type: 'invoice', clientId, clientName, concept, amount, dueDate, missingFields }
  const text = missingFields.length
    ? `💸 Factura casi lista — falta: ${missingFields.join(', ')}. Dímelos y confirma.`
    : '💸 Factura lista. Revísala y confirma.'
  return { text, data: action, preparedAction: action }
}

// 17. Workspace overview — executive cross-vertical snapshot.
// Differs from crm_overview (which is clients+invoices+events+tasks only): also includes
// opportunities, service_cases, properties and inbox pending in one parallel read.
// Caps each query for latency; returns numbers, not rows.
export async function toolWorkspaceOverview(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const today = new Date().toISOString().slice(0, 10)

  const [clients, invoices, events, tasks, opps, cases, props, convs] = await Promise.all([
    supabase.from('clients').select('status, lead_score', { count: 'exact', head: false }).eq('workspace_id', workspaceId).limit(500),
    supabase.from('invoices').select('status, amount').eq('workspace_id', workspaceId).limit(500),
    supabase.from('calendar_events').select('date').eq('workspace_id', workspaceId).neq('status', 'cancelled').gte('date', today).limit(50),
    supabase.from('tasks').select('status').eq('workspace_id', workspaceId).eq('status', 'pending').limit(100),
    supabase.from('opportunities').select('stage, value').eq('workspace_id', workspaceId).limit(300),
    supabase.from('service_cases').select('status, due_date, priority').eq('workspace_id', workspaceId).limit(300),
    supabase.from('properties').select('status').eq('workspace_id', workspaceId).limit(300),
    supabase.from('conversations').select('status, channel').eq('workspace_id', workspaceId).limit(300),
  ])

  const cls = (clients.data ?? []) as Row[]
  const invs = (invoices.data ?? []) as Row[]
  const oppRows = (opps.data ?? []) as Row[]
  const caseRows = (cases.data ?? []) as Row[]
  const propRows = (props.data ?? []) as Row[]
  const convRows = (convs.data ?? []) as Row[]

  const clientsTotal = cls.length
  const clientsActive = cls.filter((c) => c.status === 'active').length
  const clientsLead = cls.filter((c) => c.status === 'lead').length
  const clientsHot = cls.filter((c) => Number(c.lead_score ?? 0) >= 70).length

  const invPending = invs.filter((i) => i.status === 'pending').length
  const invOverdue = invs.filter((i) => i.status === 'overdue').length
  const invTotalPendingAmount = invs
    .filter((i) => i.status === 'pending' || i.status === 'overdue')
    .reduce((s, i) => s + (Number(i.amount) || 0), 0)

  const closedStages = new Set(['won', 'lost', 'closed', 'resolved'])
  const oppsOpen = oppRows.filter((o) => !closedStages.has(String(o.stage ?? ''))).length
  const oppsWon = oppRows.filter((o) => o.stage === 'won').length

  const caseTerminalStatuses = new Set(['resolved', 'closed'])
  const casesOpen = caseRows.filter((c) => !caseTerminalStatuses.has(String(c.status ?? ''))).length
  const casesOverdue = caseRows.filter((c) => {
    if (caseTerminalStatuses.has(String(c.status ?? ''))) return false
    const d = c.due_date ? String(c.due_date) : null
    return d !== null && d < today
  }).length

  const propsActive = propRows.filter((p) => ['prospecting', 'listed', 'under_contract'].includes(String(p.status ?? ''))).length

  const convsOpen = convRows.filter((c) => c.status && c.status !== 'resolved').length

  const lines: string[] = []
  lines.push(`📊 Resumen del workspace:`)
  lines.push(`Clientes: ${clientsTotal} total (${clientsActive} activos · ${clientsLead} leads · ${clientsHot} con score ≥ 70).`)
  if (oppsOpen || oppsWon) lines.push(`Oportunidades: ${oppsOpen} abiertas${oppsWon ? ` · ${oppsWon} ganadas` : ''}.`)
  if (casesOpen) lines.push(`Expedientes: ${casesOpen} abiertos${casesOverdue ? ` · ⚠️ ${casesOverdue} fuera de plazo` : ''}.`)
  if (propsActive) lines.push(`Propiedades activas: ${propsActive}.`)
  if (invOverdue) lines.push(`⚠️ Facturas vencidas: ${invOverdue}.`)
  if (invPending) lines.push(`💸 Facturas pendientes: ${invPending} (${invTotalPendingAmount.toFixed(0)}€ total).`)
  if (events.data?.length) lines.push(`📅 ${events.data.length} cita(s) próxima(s).`)
  if (tasks.data?.length) lines.push(`✅ ${tasks.data.length} tarea(s) pendiente(s).`)
  if (convsOpen) lines.push(`💬 ${convsOpen} conversación(es) abierta(s) en Inbox.`)
  if (lines.length === 1) lines.push('Sin datos aún en el workspace.')

  const data = {
    clientsTotal, clientsActive, clientsLead, clientsHot,
    opportunitiesOpen: oppsOpen, opportunitiesWon: oppsWon,
    casesOpen, casesOverdue,
    propertiesActive: propsActive,
    invoicesPending: invPending, invoicesOverdue: invOverdue, invoicesPendingAmount: invTotalPendingAmount,
    upcomingEvents: events.data?.length ?? 0,
    pendingTasks: tasks.data?.length ?? 0,
    conversationsOpen: convsOpen,
  }

  return { text: lines.join('\n'), data }
}

// 18. List pending items — consolidates everything that needs attention into one tool.
// Useful for "qué tengo pendiente hoy", "qué tengo abierto", "muéstrame lo urgente".
export async function toolListPendingItems(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const today = new Date().toISOString().slice(0, 10)

  const [overdueInv, pendingInv, pendingTasks, upcomingEvts, openCases, openConvs] = await Promise.all([
    supabase.from('invoices').select('client_name, amount, due_date').eq('workspace_id', workspaceId).eq('status', 'overdue').order('due_date').limit(10),
    supabase.from('invoices').select('client_name, amount, due_date').eq('workspace_id', workspaceId).eq('status', 'pending').order('due_date').limit(10),
    supabase.from('tasks').select('title, due_date, client_name').eq('workspace_id', workspaceId).eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
    supabase.from('calendar_events').select('title, date, start_hour, client_name').eq('workspace_id', workspaceId).neq('status', 'cancelled').gte('date', today).order('date').limit(5),
    supabase.from('service_cases').select('title, status, due_date, priority').eq('workspace_id', workspaceId).not('status', 'in', '("resolved","closed")').order('due_date', { ascending: true, nullsFirst: false }).limit(10),
    supabase.from('conversations').select('id, channel, status, sentiment, updated_at').eq('workspace_id', workspaceId).neq('status', 'resolved').order('updated_at', { ascending: false }).limit(5),
  ])

  const sections: string[] = []
  const overdueRows = (overdueInv.data ?? []) as Row[]
  const pendingRows = (pendingInv.data ?? []) as Row[]
  const taskRows = (pendingTasks.data ?? []) as Row[]
  const evtRows = (upcomingEvts.data ?? []) as Row[]
  const caseRows = (openCases.data ?? []) as Row[]
  const convRows = (openConvs.data ?? []) as Row[]

  if (overdueRows.length) {
    const list = overdueRows.slice(0, 5).map((i, idx) => `  ${idx + 1}. ${i.client_name ?? 'sin cliente'} · ${i.amount}€ · venció ${i.due_date ?? 'sin fecha'}`).join('\n')
    sections.push(`⚠️ Facturas vencidas (${overdueRows.length}):\n${list}`)
  }
  if (pendingRows.length) {
    const list = pendingRows.slice(0, 5).map((i, idx) => `  ${idx + 1}. ${i.client_name ?? 'sin cliente'} · ${i.amount}€ · vence ${i.due_date ?? 'sin fecha'}`).join('\n')
    sections.push(`💸 Facturas pendientes (${pendingRows.length}):\n${list}`)
  }
  if (caseRows.length) {
    const overdueCount = caseRows.filter((c) => c.due_date && String(c.due_date) < today).length
    const list = caseRows.slice(0, 5).map((c, idx) => {
      const due = c.due_date ? ` · vence ${c.due_date}` : ''
      const prio = c.priority && c.priority !== 'normal' ? ` · ${c.priority}` : ''
      return `  ${idx + 1}. ${c.title} · ${c.status}${prio}${due}`
    }).join('\n')
    sections.push(`📁 Expedientes abiertos (${caseRows.length}${overdueCount ? `, ${overdueCount} fuera de plazo` : ''}):\n${list}`)
  }
  if (taskRows.length) {
    const list = taskRows.slice(0, 5).map((t, idx) => {
      const client = t.client_name ? ` · ${t.client_name}` : ''
      const due = t.due_date ? ` · vence ${t.due_date}` : ''
      return `  ${idx + 1}. ${t.title ?? 'Tarea'}${client}${due}`
    }).join('\n')
    sections.push(`✅ Tareas pendientes (${taskRows.length}):\n${list}`)
  }
  if (evtRows.length) {
    const list = evtRows.slice(0, 5).map((e, idx) => {
      const h = e.start_hour !== undefined ? ` ${String(e.start_hour).padStart(2, '0')}:00` : ''
      const client = e.client_name ? ` · ${e.client_name}` : ''
      return `  ${idx + 1}. ${e.title ?? 'Cita'} · ${e.date}${h}${client}`
    }).join('\n')
    sections.push(`📅 Próximas citas (${evtRows.length}):\n${list}`)
  }
  if (convRows.length) {
    sections.push(`💬 Conversaciones abiertas en Inbox: ${convRows.length}`)
  }

  if (!sections.length) {
    return { text: '✅ No tienes nada pendiente ahora mismo. Todo al día.', data: { empty: true } }
  }

  return {
    text: sections.join('\n\n'),
    data: {
      overdueInvoices: overdueRows.length,
      pendingInvoices: pendingRows.length,
      pendingTasks: taskRows.length,
      upcomingEvents: evtRows.length,
      openCases: caseRows.length,
      openConversations: convRows.length,
    },
  }
}

// 19. Summarize inbox status — conversations broken down by channel and unresolved state.
export async function toolSummarizeInboxStatus(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const { data } = await supabase
    .from('conversations')
    .select('id, channel, status, sentiment, updated_at')
    .eq('workspace_id', workspaceId)
    .limit(500)

  const rows = (data ?? []) as Row[]
  if (!rows.length) return { text: 'Sin conversaciones registradas en Inbox.', data: { total: 0 } }

  const byChannel: Record<string, { total: number; open: number; negative: number }> = {}
  let total = 0
  let open = 0
  let negative = 0
  for (const r of rows) {
    const ch = String(r.channel ?? 'desconocido').toLowerCase()
    if (!byChannel[ch]) byChannel[ch] = { total: 0, open: 0, negative: 0 }
    byChannel[ch].total += 1
    total += 1
    if (r.status && r.status !== 'resolved') {
      byChannel[ch].open += 1
      open += 1
    }
    if (r.sentiment === 'negative') {
      byChannel[ch].negative += 1
      negative += 1
    }
  }

  const lines: string[] = [`💬 Inbox: ${total} conversación(es), ${open} abierta(s)${negative ? `, ${negative} con sentimiento negativo` : ''}.`]
  for (const [ch, stats] of Object.entries(byChannel)) {
    if (!stats.open) continue
    lines.push(`  · ${ch}: ${stats.open}/${stats.total} abierta(s)${stats.negative ? `, ${stats.negative} negativa(s)` : ''}`)
  }
  if (open === 0) lines.push('Todo respondido. 👌')

  return { text: lines.join('\n'), data: { total, open, negative, byChannel } }
}
