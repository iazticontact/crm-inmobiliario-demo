// Server-side CRM tools for the /api/assistant/chat route.
// Each tool accepts a Supabase server client (anon key) + workspaceId.
// Never uses getSupabaseBrowserClient — that's browser-only.
import type { SupabaseClient } from '@supabase/supabase-js'

const CLIENT_COLUMNS = 'id, workspace_id, name, company, email, phone, channel, status, lead_score, notes, created_at'

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
  amount?: number
  concept?: string
  dueDate?: string
  taskTitle?: string
  description?: string
  missingFields: string[]
}

type Row = Record<string, unknown>

function fmtClient(c: Row, i?: number): string {
  const prefix = i !== undefined ? `${i + 1}. ` : ''
  const name = String(c.name || 'Sin nombre')
  const co = c.company && String(c.company) !== 'No consta' ? ` (${c.company})` : ''
  const st = c.status ? ` · ${c.status}` : ''
  const sc = c.lead_score ? ` · score ${c.lead_score}` : ''
  const ch = c.channel ? ` · ${c.channel}` : ''
  return `${prefix}${name}${co}${st}${sc}${ch}`
}

// 1. CRM overview — workspace-level counts
export async function toolCrmOverview(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const today = new Date().toISOString().slice(0, 10)
  const [clients, invoices, events, tasks] = await Promise.all([
    supabase.from('clients').select('status, lead_score').eq('workspace_id', workspaceId),
    supabase.from('invoices').select('status, amount').eq('workspace_id', workspaceId),
    supabase.from('calendar_events').select('date').eq('workspace_id', workspaceId).gte('date', today).limit(20),
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

// 4. Full client context (invoices + events)
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

  const name = String(clientRow.name)
  const [invoices, events] = await Promise.all([
    supabase.from('invoices').select('amount, status, due_date, plan').eq('workspace_id', workspaceId).eq('client_name', name).order('created_at', { ascending: false }).limit(5),
    supabase.from('calendar_events').select('title, date, start_hour').eq('workspace_id', workspaceId).eq('client_name', name).order('date', { ascending: false }).limit(3),
  ])

  const lines = [fmtClient(clientRow)]
  if (invoices.data?.length) {
    lines.push(`Facturas: ${invoices.data.map((i) => `${i.amount}€ (${i.status})`).join(', ')}`)
  }
  if (events.data?.length) {
    lines.push(`Citas: ${events.data.map((e) => `${e.title} el ${e.date}`).join(', ')}`)
  }

  return {
    text: lines.join('\n'),
    data: { client: clientRow, invoices: invoices.data, events: events.data },
    referencedClientId: String(clientRow.id),
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

// 8. Pending invoices (pending + overdue)
export async function toolPendingInvoices(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const { data } = await supabase
    .from('invoices').select('*').eq('workspace_id', workspaceId)
    .in('status', ['pending', 'overdue'])
    .order('due_date', { ascending: true }).limit(20)

  const rows = data ?? []
  if (!rows.length) return { text: 'Sin facturas pendientes. Los cobros están al día. 👌', data: [] }

  const total = rows.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const list = rows.slice(0, 10).map((i, idx) =>
    `${idx + 1}. ${i.client_name || 'Sin cliente'} · ${i.amount}€ (${i.status}) · vence ${i.due_date || 'sin fecha'}`
  ).join('\n')

  return { text: `💸 ${rows.length} factura${rows.length > 1 ? 's' : ''} pendiente${rows.length > 1 ? 's' : ''} — ${total.toFixed(0)}€ por cobrar:\n${list}`, data: rows }
}

// 9. Overdue invoices
export async function toolOverdueInvoices(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const { data } = await supabase
    .from('invoices').select('*').eq('workspace_id', workspaceId)
    .eq('status', 'overdue')
    .order('due_date', { ascending: true }).limit(20)

  const rows = data ?? []
  if (!rows.length) return { text: 'Sin facturas vencidas. Todo cobrado a tiempo. 👌', data: [] }

  const total = rows.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const list = rows.map((i, idx) =>
    `${idx + 1}. ${i.client_name || 'Sin cliente'} · ${i.amount}€ · venció ${i.due_date || 'sin fecha'}`
  ).join('\n')

  return { text: `⚠️ ${rows.length} factura${rows.length > 1 ? 's' : ''} vencida${rows.length > 1 ? 's' : ''} — ${total.toFixed(0)}€ sin cobrar:\n${list}\nPriorizaría el cobro hoy.`, data: rows }
}

// 10. Upcoming calendar events
export async function toolUpcomingEvents(supabase: SupabaseClient, workspaceId: string): Promise<ToolResult> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('calendar_events').select('*').eq('workspace_id', workspaceId)
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
    supabase.from('calendar_events').select('title, date, client_name').eq('workspace_id', workspaceId).gte('date', today).order('date').limit(3),
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

// 16b. Prepare a task action card (no Supabase needed)
export function toolPrepareTask(
  extracted: { clientId?: string; clientName?: string; taskTitle?: string; description?: string; dueDate?: string }
): ToolResult & { preparedAction: PreparedActionData } {
  const { clientId, clientName, taskTitle, description, dueDate } = extracted
  const missingFields = [!clientName && 'cliente', !taskTitle && 'título'].filter(Boolean) as string[]
  const action: PreparedActionData = { type: 'task', clientId, clientName, taskTitle, description, dueDate, missingFields }
  const text = missingFields.length
    ? `✅ Tarea casi lista — falta: ${missingFields.join(', ')}. Dímelos y la dejo lista para confirmar.`
    : `✅ Tarea lista para ${clientName}: ${taskTitle}. Confirma cuando quieras.`
  return { text, data: action, preparedAction: action }
}

// 16. Prepare a booking or invoice action card (no Supabase needed)
export function toolPrepareAction(
  type: 'booking' | 'invoice',
  extracted: { clientId?: string; clientName?: string; service?: string; date?: string; time?: string; amount?: number; concept?: string; dueDate?: string }
): ToolResult & { preparedAction: PreparedActionData } {
  const { clientId, clientName, service, date, time, amount, concept, dueDate } = extracted

  if (type === 'booking') {
    const missingFields = [!clientName && 'cliente', !date && 'fecha', !time && 'hora'].filter(Boolean) as string[]
    const action: PreparedActionData = { type: 'booking', clientId, clientName, service, date, time, missingFields }
    const text = missingFields.length
      ? `📅 Casi lista — falta: ${missingFields.join(', ')}. Dímelos y la preparo para confirmar.`
      : '📅 Cita lista. Revísala y confirma cuando quieras.'
    return { text, data: action, preparedAction: action }
  }

  const missingFields = [!clientName && 'cliente', !amount && 'importe', !concept && 'concepto', !dueDate && 'vencimiento'].filter(Boolean) as string[]
  const action: PreparedActionData = { type: 'invoice', clientId, clientName, concept, amount, dueDate, missingFields }
  const text = missingFields.length
    ? `💸 Factura casi lista — falta: ${missingFields.join(', ')}. Dímelos y confirma.`
    : '💸 Factura lista. Revísala y confirma.'
  return { text, data: action, preparedAction: action }
}
