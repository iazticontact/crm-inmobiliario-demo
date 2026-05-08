import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { ActivityType, Channel, ClientStatus, EventType, InvoiceStatus, MessageSender } from '@/lib/types'

type AgentTool =
  | 'get_workspace_summary'
  | 'search_clients'
  | 'get_client_summary'
  | 'get_client_detail'
  | 'create_client'
  | 'update_client'
  | 'create_invoice'
  | 'mark_invoice_paid'
  | 'list_invoices'
  | 'create_calendar_event'
  | 'list_calendar_events'
  | 'list_conversations'
  | 'save_message'
  | 'create_activity'
  | 'get_next_best_actions'

type AgentToolBody = {
  tool?: string
  workspace_id?: string
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

type DataRecord = Record<string, unknown>

const allowedTools: AgentTool[] = [
  'get_workspace_summary',
  'search_clients',
  'get_client_summary',
  'get_client_detail',
  'create_client',
  'update_client',
  'create_invoice',
  'mark_invoice_paid',
  'list_invoices',
  'create_calendar_event',
  'list_calendar_events',
  'list_conversations',
  'save_message',
  'create_activity',
  'get_next_best_actions',
]

const writeTools = new Set<AgentTool>([
  'create_client',
  'update_client',
  'create_invoice',
  'mark_invoice_paid',
  'create_calendar_event',
  'save_message',
  'create_activity',
])

function publicSupabaseKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
}

function toolSecret() {
  return process.env.AGENT_TOOL_SECRET?.trim() || process.env.N8N_WEBHOOK_SECRET?.trim()
}

function getServerClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const publicKey = publicSupabaseKey()
  const expectedSecret = toolSecret()
  const providedSecret = request.headers.get('x-nowcrm-secret')?.trim()
  const authorizedService = Boolean(serviceRole && expectedSecret && providedSecret && providedSecret === expectedSecret)
  const key = authorizedService ? serviceRole : publicKey

  if (!url || !key) return { supabase: null, authorizedService, hasServiceRole: Boolean(serviceRole) }

  return {
    supabase: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    authorizedService,
    hasServiceRole: Boolean(serviceRole),
  }
}

function ok(tool: AgentTool, result: unknown, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: true, tool, result, message, ...extra })
}

function fail(tool: string, message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, tool, result: null, message, ...extra }, { status })
}

function fallback(tool: AgentTool, message: string, input: Record<string, unknown>) {
  return ok(tool, {
    fallback: true,
    input,
    next_step: 'Configura SUPABASE_SERVICE_ROLE_KEY y AGENT_TOOL_SECRET/N8N_WEBHOOK_SECRET para ejecutar esta tool desde n8n.',
  }, message, { mode: 'fallback' })
}

function str(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function num(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function channel(value: unknown): Channel {
  return value === 'Instagram' || value === 'Web' || value === 'Email' || value === 'WhatsApp' ? value : 'WhatsApp'
}

function clientStatus(value: unknown): ClientStatus {
  return value === 'active' || value === 'inactive' || value === 'churned' || value === 'lead' ? value : 'lead'
}

function invoiceStatus(value: unknown): InvoiceStatus {
  return value === 'paid' || value === 'overdue' || value === 'pending' ? value : 'pending'
}

function eventType(value: unknown): EventType {
  return value === 'call' || value === 'meeting' || value === 'follow-up' || value === 'demo' ? value : 'demo'
}

function activityType(value: unknown): ActivityType {
  return value === 'email' || value === 'call' || value === 'message' || value === 'deal' || value === 'note' ? value : 'note'
}

function sender(value: unknown): MessageSender {
  return value === 'client' || value === 'agent' || value === 'ai' ? value : 'ai'
}

function toTimeParts(startTime: string, endTime?: string) {
  const [hourRaw, minuteRaw] = startTime.split(':')
  const startHour = Math.max(0, Math.min(23, Number(hourRaw) || 10))
  const startMinute = Math.max(0, Math.min(59, Number(minuteRaw) || 0))
  let duration = 60
  if (endTime?.includes(':')) {
    const [endHourRaw, endMinuteRaw] = endTime.split(':')
    const endMinutes = (Number(endHourRaw) || startHour + 1) * 60 + (Number(endMinuteRaw) || 0)
    const startMinutes = startHour * 60 + startMinute
    duration = Math.max(15, endMinutes - startMinutes)
  }
  return { startHour, startMinute, duration }
}

async function selectWorkspaceData(supabase: NonNullable<ReturnType<typeof getServerClient>['supabase']>, workspaceId: string) {
  const [clients, invoices, events, conversations, activities] = await Promise.all([
    supabase.from('clients').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    supabase.from('invoices').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    supabase.from('calendar_events').select('*').eq('workspace_id', workspaceId).order('date', { ascending: true }),
    supabase.from('conversations').select('*').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }),
    supabase.from('activities').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(8),
  ])

  return {
    clients: clients.error ? [] : clients.data ?? [],
    invoices: invoices.error ? [] : invoices.data ?? [],
    events: events.error ? [] : events.data ?? [],
    conversations: conversations.error ? [] : conversations.data ?? [],
    activities: activities.error ? [] : activities.data ?? [],
  }
}

async function findClientById(supabase: NonNullable<ReturnType<typeof getServerClient>['supabase']>, workspaceId: string, clientId?: string) {
  if (!clientId) return null
  const { data } = await supabase.from('clients').select('*').eq('workspace_id', workspaceId).eq('id', clientId).maybeSingle()
  return data as DataRecord | null
}

function nextBestActions(data: Awaited<ReturnType<typeof selectWorkspaceData>>) {
  const overdueInvoices = data.invoices.filter((invoice) => invoice.status === 'overdue')
  const hotLeads = data.clients.filter((client) => client.status === 'lead' && num(client.lead_score, 0) >= 75)
  const openConversations = data.conversations.filter((conversation) => conversation.status !== 'resolved')
  const upcomingEvents = data.events.slice(0, 3)

  return [
    overdueInvoices.length ? `Prioriza ${overdueInvoices.length} factura(s) vencida(s) con recordatorio n8n.` : '',
    hotLeads.length ? `Contacta ${hotLeads.length} lead(s) con score alto hoy.` : '',
    openConversations.length ? `Resuelve ${openConversations.length} conversacion(es) abiertas.` : '',
    upcomingEvents.length ? `Prepara contexto para ${upcomingEvents.length} evento(s) proximo(s).` : '',
  ].filter(Boolean)
}

export async function POST(request: Request) {
  let body: AgentToolBody

  try {
    body = await request.json()
  } catch {
    return fail('unknown', 'Payload JSON invalido.', 400)
  }

  const tool = allowedTools.find((candidate) => candidate === body.tool)
  if (!tool) return fail(body.tool || 'unknown', 'Tool no permitida.', 400, { allowed_tools: allowedTools })

  const workspaceId = str(body.workspace_id)
  if (!workspaceId) return fail(tool, 'workspace_id es obligatorio.', 400)

  const input = body.input ?? {}
  const { supabase, authorizedService, hasServiceRole } = getServerClient(request)
  const isDemoWorkspace = workspaceId === 'demo' || workspaceId === 'demo-workspace'

  if (!supabase || isDemoWorkspace) {
    return fallback(tool, 'Tool ejecutada en fallback demo.', input)
  }

  if (writeTools.has(tool) && hasServiceRole && !authorizedService) {
    return fail(tool, 'Tool protegida: falta x-nowcrm-secret valido.', 401)
  }

  try {
    if (tool === 'get_workspace_summary') {
      const data = await selectWorkspaceData(supabase, workspaceId)
      const result = {
        total_clients: data.clients.length,
        leads: data.clients.filter((client) => client.status === 'lead').length,
        pending_invoices: data.invoices.filter((invoice) => invoice.status === 'pending').length,
        overdue_invoices: data.invoices.filter((invoice) => invoice.status === 'overdue').length,
        upcoming_events: data.events.length,
        open_conversations: data.conversations.filter((conversation) => conversation.status !== 'resolved').length,
        recent_activities: data.activities,
      }
      return ok(tool, result, 'Resumen del workspace generado.')
    }

    if (tool === 'search_clients') {
      const { data, error } = await supabase.from('clients').select('*').eq('workspace_id', workspaceId).limit(100)
      if (error) throw error
      const query = str(input.query).toLowerCase()
      const status = str(input.status)
      const channelValue = str(input.channel)
      const result = (data ?? []).filter((client) => {
        const matchesQuery = !query || [client.name, client.company, client.email].some((value) => String(value ?? '').toLowerCase().includes(query))
        const matchesStatus = !status || client.status === status
        const matchesChannel = !channelValue || client.channel === channelValue
        return matchesQuery && matchesStatus && matchesChannel
      }).slice(0, 20)
      return ok(tool, result, 'Clientes encontrados.')
    }

    if (tool === 'get_client_detail' || tool === 'get_client_summary') {
      const clientId = str(input.client_id)
      const email = str(input.email).toLowerCase()
      const name = str(input.name).toLowerCase()
      const { data: clients, error } = await supabase.from('clients').select('*').eq('workspace_id', workspaceId).limit(100)
      if (error) throw error
      const client = (clients ?? []).find((item) =>
        (clientId && item.id === clientId) ||
        (email && String(item.email ?? '').toLowerCase() === email) ||
        (name && String(item.name ?? '').toLowerCase().includes(name))
      )
      if (!client) return ok(tool, null, 'Cliente no encontrado.')
      const clientName = String(client.name ?? '')
      const [invoices, events, conversationsRaw, activities] = await Promise.all([
        supabase.from('invoices').select('*').eq('workspace_id', workspaceId).eq('client_name', clientName).limit(20),
        supabase.from('calendar_events').select('*').eq('workspace_id', workspaceId).eq('client_name', clientName).limit(20),
        supabase.from('conversations').select('*').eq('workspace_id', workspaceId).limit(100),
        supabase.from('activities').select('*').eq('workspace_id', workspaceId).eq('client_name', clientName).limit(20),
      ])
      const conversations = conversationsRaw.error ? [] : (conversationsRaw.data ?? []).filter((conversation) => conversation.client_id === client.id || conversation.client_name === clientName)
      return ok(tool, {
        client,
        invoices: invoices.error ? [] : invoices.data ?? [],
        events: events.error ? [] : events.data ?? [],
        conversations,
        activities: activities.error ? [] : activities.data ?? [],
      }, 'Detalle de cliente generado.')
    }

    if (tool === 'create_client') {
      const name = str(input.name)
      const email = str(input.email)
      if (!name || !email) return fail(tool, 'name y email son obligatorios.', 400)
      const { data, error } = await supabase.from('clients').insert({
        workspace_id: workspaceId,
        name,
        company: str(input.company) || null,
        email,
        phone: str(input.phone) || null,
        channel: channel(input.channel),
        status: clientStatus(input.status),
        lead_score: num(input.lead_score, 65),
        notes: str(input.notes) || null,
        last_interaction: 'Ahora mismo',
      }).select('*').single()
      if (error) throw error
      await supabase.from('activities').insert({ workspace_id: workspaceId, type: 'deal', description: `Agente creo cliente: ${name}`, client_name: name })
      return ok(tool, data, 'Cliente creado.')
    }

    if (tool === 'update_client') {
      const clientId = str(input.client_id)
      if (!clientId) return fail(tool, 'client_id es obligatorio.', 400)
      const patch: DataRecord = {}
      if (input.name !== undefined) patch.name = str(input.name)
      if (input.company !== undefined) patch.company = str(input.company) || null
      if (input.email !== undefined) patch.email = str(input.email)
      if (input.phone !== undefined) patch.phone = str(input.phone) || null
      if (input.channel !== undefined) patch.channel = channel(input.channel)
      if (input.status !== undefined) patch.status = clientStatus(input.status)
      if (input.lead_score !== undefined) patch.lead_score = num(input.lead_score, 65)
      if (input.notes !== undefined) patch.notes = str(input.notes) || null
      const { data, error } = await supabase.from('clients').update(patch).eq('workspace_id', workspaceId).eq('id', clientId).select('*').single()
      if (error) throw error
      await supabase.from('activities').insert({ workspace_id: workspaceId, type: 'note', description: `Agente actualizo cliente: ${data.name ?? clientId}`, client_name: data.name ?? null })
      return ok(tool, data, 'Cliente actualizado.')
    }

    if (tool === 'create_invoice') {
      const linkedClient = await findClientById(supabase, workspaceId, str(input.client_id))
      const clientName = str(input.client_name) || str(input.clientName) || str(linkedClient?.name) || 'Cliente'
      const amount = num(input.amount)
      if (!amount) return fail(tool, 'amount es obligatorio.', 400)
      const { data, error } = await supabase.from('invoices').insert({
        workspace_id: workspaceId,
        client_name: clientName,
        amount,
        status: invoiceStatus(input.status),
        date: new Date().toISOString().slice(0, 10),
        due_date: str(input.due_date) || str(input.dueDate) || new Date().toISOString().slice(0, 10),
        plan: str(input.concept) || str(input.plan) || 'Servicio',
        notes: str(input.notes) || null,
      }).select('*').single()
      if (error) throw error
      await supabase.from('activities').insert({ workspace_id: workspaceId, type: 'deal', description: `Agente creo factura: ${clientName}`, client_name: clientName })
      return ok(tool, data, 'Factura creada.')
    }

    if (tool === 'mark_invoice_paid') {
      const invoiceId = str(input.invoice_id)
      if (!invoiceId) return fail(tool, 'invoice_id es obligatorio.', 400)
      const { data, error } = await supabase.from('invoices').update({ status: 'paid' }).eq('workspace_id', workspaceId).eq('id', invoiceId).select('*').single()
      if (error) throw error
      await supabase.from('activities').insert({ workspace_id: workspaceId, type: 'deal', description: `Agente marco factura pagada: ${invoiceId}`, client_name: data.client_name ?? null })
      return ok(tool, data, 'Factura marcada como pagada.')
    }

    if (tool === 'list_invoices') {
      let query = supabase.from('invoices').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false })
      const status = str(input.status)
      if (status) query = query.eq('status', status)
      const { data, error } = await query.limit(50)
      if (error) throw error
      const linkedClient = await findClientById(supabase, workspaceId, str(input.client_id))
      const clientName = str(input.client_name) || str(linkedClient?.name)
      const result = clientName ? (data ?? []).filter((invoice) => invoice.client_name === clientName) : data ?? []
      return ok(tool, result, 'Facturas consultadas.')
    }

    if (tool === 'create_calendar_event') {
      const title = str(input.title)
      const date = str(input.date)
      if (!title || !date) return fail(tool, 'title y date son obligatorios.', 400)
      const time = toTimeParts(str(input.start_time, '10:00'), str(input.end_time))
      const { data, error } = await supabase.from('calendar_events').insert({
        workspace_id: workspaceId,
        title,
        date,
        start_hour: time.startHour,
        start_minute: time.startMinute,
        duration: time.duration,
        type: eventType(input.type),
        client_name: str(input.client_name) || str((await findClientById(supabase, workspaceId, str(input.client_id)))?.name) || null,
        description: str(input.notes) || str(input.description) || null,
      }).select('*').single()
      if (error) throw error
      await supabase.from('activities').insert({ workspace_id: workspaceId, type: 'call', description: `Agente creo evento: ${title}`, client_name: data.client_name ?? null })
      return ok(tool, data, 'Evento creado.')
    }

    if (tool === 'list_calendar_events') {
      const { data, error } = await supabase.from('calendar_events').select('*').eq('workspace_id', workspaceId).order('date', { ascending: true }).limit(80)
      if (error) throw error
      const from = str(input.from)
      const to = str(input.to)
      const linkedClient = await findClientById(supabase, workspaceId, str(input.client_id))
      const clientName = str(input.client_name) || str(linkedClient?.name)
      const filtered = (data ?? []).filter((event) => (!from || String(event.date) >= from) && (!to || String(event.date) <= to) && (!clientName || event.client_name === clientName))
      return ok(tool, filtered, 'Eventos consultados.')
    }

    if (tool === 'list_conversations') {
      const { data, error } = await supabase.from('conversations').select('*').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(50)
      if (error) throw error
      return ok(tool, data ?? [], 'Conversaciones consultadas.')
    }

    if (tool === 'save_message') {
      const conversationId = str(input.conversation_id)
      const content = str(input.content)
      if (!conversationId || !content) return fail(tool, 'conversation_id y content son obligatorios.', 400)
      const normalizedSender = sender(input.sender)
      const { data, error } = await supabase.from('messages').insert({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        sender: normalizedSender === 'ai' ? 'assistant' : normalizedSender === 'agent' ? 'user' : 'client',
        body: content,
        is_ai: normalizedSender === 'ai',
        created_at: new Date().toISOString(),
      }).select('*').single()
      if (error) throw error
      return ok(tool, data, 'Mensaje guardado.')
    }

    if (tool === 'create_activity') {
      const description = str(input.description) || str(input.title)
      if (!description) return fail(tool, 'description es obligatorio.', 400)
      const { data, error } = await supabase.from('activities').insert({
        workspace_id: workspaceId,
        type: activityType(input.type),
        description,
        client_name: str(input.client_name) || null,
      }).select('*').single()
      if (error) throw error
      return ok(tool, data, 'Actividad creada.')
    }

    if (tool === 'get_next_best_actions') {
      const data = await selectWorkspaceData(supabase, workspaceId)
      return ok(tool, nextBestActions(data), 'Proximas acciones sugeridas.')
    }

    return fail(tool, 'Tool no implementada.', 400)
  } catch {
    return fallback(tool, 'No se pudo ejecutar la tool contra Supabase. Se devuelve fallback seguro.', input)
  }
}
