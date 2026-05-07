import { getSupabaseBrowserClient } from '@/lib/supabase'
import type {
  Activity,
  ActivityType,
  CalendarEvent,
  Channel,
  Client,
  ClientStatus,
  Conversation,
  ConversationSentiment,
  EventType,
  Invoice,
  InvoiceStatus,
  Message,
  MessageSender,
} from '@/lib/types'

export type ProfileRecord = {
  id: string
  user_id?: string | null
  workspace_id?: string | null
  full_name?: string | null
  email?: string | null
  role?: string | null
  trial_status?: string | null
}

export type WorkspaceRecord = {
  id: string
  owner_id?: string | null
  name?: string | null
  trial_status?: string | null
  plan?: string | null
  status?: string | null
}

export type ClientPayload = {
  name: string
  company?: string
  email: string
  phone?: string
  channel: Channel
  status: ClientStatus
  leadScore?: number
  notes?: string
}

export type InvoicePayload = {
  clientName: string
  amount: number
  status: InvoiceStatus
  date?: string
  dueDate: string
  plan: string
  notes?: string
}

export type CalendarEventPayload = {
  title: string
  date: string
  startHour: number
  startMinute: number
  duration: number
  type: EventType
  clientName?: string
  description?: string
}

export type ConversationPayload = {
  clientId?: string
  clientName: string
  clientAvatar?: string
  channel: Channel
  sentiment?: ConversationSentiment
  intent?: string
  lastMessage?: string
  unread?: boolean
}

export type MessagePayload = {
  content: string
  sender: MessageSender
}

export type ActivityPayload = {
  type: ActivityType
  description: string
  clientName?: string
}

export type N8nFlowPayload = {
  event: string
  label?: string
  status?: string
  webhookUrl?: string
}

type RecordValue = string | number | boolean | null | undefined
type DataRecord = Record<string, RecordValue>

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.trim().slice(0, 2).toUpperCase() || 'C'
}

function normalizeChannel(value: unknown): Channel {
  if (value === 'WhatsApp' || value === 'Instagram' || value === 'Web' || value === 'Email') return value
  return 'WhatsApp'
}

function normalizeStatus(value: unknown): ClientStatus {
  if (value === 'active' || value === 'lead' || value === 'inactive' || value === 'churned') return value
  return 'lead'
}

function normalizeInvoiceStatus(value: unknown): InvoiceStatus {
  if (value === 'paid' || value === 'pending' || value === 'overdue') return value
  return 'pending'
}

function normalizeEventType(value: unknown): EventType {
  if (value === 'call' || value === 'demo' || value === 'meeting' || value === 'follow-up') return value
  return 'demo'
}

function normalizeSentiment(value: unknown): ConversationSentiment {
  if (value === 'positive' || value === 'neutral' || value === 'negative') return value
  return 'neutral'
}

function normalizeSender(value: unknown): MessageSender {
  if (value === 'client' || value === 'agent' || value === 'ai') return value
  if (value === 'assistant') return 'ai'
  if (value === 'user') return 'agent'
  return 'client'
}

function normalizeActivityType(value: unknown): ActivityType {
  if (value === 'email' || value === 'call' || value === 'message' || value === 'deal' || value === 'note') return value
  return 'note'
}

function displayTime(value: unknown, fallback = 'Ahora mismo') {
  if (typeof value !== 'string' || !value.trim()) return fallback
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export async function getCurrentUser() {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return data.user
}

export async function getCurrentProfile(userId?: string) {
  const user = userId ? null : await getCurrentUser()
  const id = userId ?? user?.id
  if (!id) return null

  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const byId = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (byId.data) return byId.data as ProfileRecord

  const byUserId = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', id)
    .maybeSingle()

  if (byUserId.data) return byUserId.data as ProfileRecord
  if (byId.error && byUserId.error) throw byId.error
  return null
}

export async function getCurrentWorkspace(profile?: ProfileRecord | null, ownerId?: string) {
  const resolvedProfile = profile ?? (await getCurrentProfile())
  const workspaceId = resolvedProfile?.workspace_id

  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  if (workspaceId) {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .maybeSingle()

    if (error) throw error
    if (data) return data as WorkspaceRecord
  }

  if (!ownerId) return null

  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('owner_id', ownerId)
    .maybeSingle()

  if (error) throw error
  return data as WorkspaceRecord | null
}

export async function getWorkspaceContext() {
  const user = await getCurrentUser()
  if (!user) return null
  const profile = await getCurrentProfile(user.id)
  const workspace = await getCurrentWorkspace(profile, user.id)
  return { user, profile, workspace }
}

export function mapSupabaseClient(row: DataRecord): Client {
  const name = asString(row.name, 'Cliente')
  return {
    id: asString(row.id),
    name,
    company: asString(row.company, 'Sin empresa'),
    email: asString(row.email),
    phone: asString(row.phone, '-'),
    channel: normalizeChannel(row.channel),
    status: normalizeStatus(row.status),
    leadScore: asNumber(row.lead_score, 50),
    lastInteraction: asString(row.last_interaction, 'Ahora mismo'),
    avatar: asString(row.avatar, getInitials(name)),
    notes: asString(row.notes),
  }
}

function toClientRow(workspaceId: string, payload: ClientPayload): DataRecord {
  return {
    workspace_id: workspaceId,
    name: payload.name.trim(),
    company: payload.company?.trim() || null,
    email: payload.email.trim(),
    phone: payload.phone?.trim() || null,
    channel: payload.channel,
    status: payload.status,
    lead_score: payload.leadScore ?? 50,
    notes: payload.notes?.trim() || null,
    last_interaction: 'Ahora mismo',
  }
}

export async function getClients(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseClient)
}

export async function createClientLead(workspaceId: string, payload: ClientPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('clients')
    .insert(toClientRow(workspaceId, payload))
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseClient(data as DataRecord)
}

export async function updateClient(id: string, payload: ClientPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row = toClientRow('', payload)
  delete row.workspace_id
  const { data, error } = await supabase
    .from('clients')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseClient(data as DataRecord)
}

export async function deleteClient(id: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export function mapSupabaseInvoice(row: DataRecord): Invoice {
  return {
    id: asString(row.id),
    clientName: asString(row.client_name ?? row.customer_name ?? row.clientName, 'Cliente'),
    amount: asNumber(row.amount, 0),
    status: normalizeInvoiceStatus(row.status),
    date: asString(row.date ?? row.issued_at ?? row.created_at, todayIso()).slice(0, 10),
    dueDate: asString(row.due_date ?? row.dueDate, todayIso()).slice(0, 10),
    plan: asString(row.plan ?? row.concept ?? row.description, 'Pro'),
    notes: asString(row.notes),
  }
}

function toInvoiceRow(workspaceId: string, payload: InvoicePayload): DataRecord {
  return {
    workspace_id: workspaceId,
    client_name: payload.clientName.trim(),
    amount: payload.amount,
    status: payload.status,
    date: payload.date || todayIso(),
    due_date: payload.dueDate,
    plan: payload.plan.trim() || 'Pro',
    notes: payload.notes?.trim() || null,
  }
}

export async function getInvoices(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseInvoice)
}

export async function createInvoice(workspaceId: string, payload: InvoicePayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('invoices')
    .insert(toInvoiceRow(workspaceId, payload))
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseInvoice(data as DataRecord)
}

export async function updateInvoice(id: string, payload: InvoicePayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row = toInvoiceRow('', payload)
  delete row.workspace_id
  const { data, error } = await supabase
    .from('invoices')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseInvoice(data as DataRecord)
}

export async function markInvoicePaid(id: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('invoices')
    .update({ status: 'paid' })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseInvoice(data as DataRecord)
}

export async function deleteInvoice(id: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export function mapSupabaseCalendarEvent(row: DataRecord): CalendarEvent {
  return {
    id: asString(row.id),
    title: asString(row.title, 'Evento'),
    date: asString(row.date ?? row.event_date ?? row.start_date, todayIso()).slice(0, 10),
    startHour: asNumber(row.start_hour, 10),
    startMinute: asNumber(row.start_minute, 0),
    duration: asNumber(row.duration, 60),
    type: normalizeEventType(row.type),
    clientName: asString(row.client_name ?? row.clientName) || undefined,
    description: asString(row.description ?? row.notes) || undefined,
  }
}

function toCalendarEventRow(workspaceId: string, payload: CalendarEventPayload): DataRecord {
  return {
    workspace_id: workspaceId,
    title: payload.title.trim(),
    date: payload.date,
    start_hour: payload.startHour,
    start_minute: payload.startMinute,
    duration: payload.duration,
    type: payload.type,
    client_name: payload.clientName?.trim() || null,
    description: payload.description?.trim() || null,
  }
}

export async function getCalendarEvents(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('date', { ascending: true })

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseCalendarEvent)
}

export async function createCalendarEvent(workspaceId: string, payload: CalendarEventPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('calendar_events')
    .insert(toCalendarEventRow(workspaceId, payload))
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseCalendarEvent(data as DataRecord)
}

export async function updateCalendarEvent(id: string, payload: CalendarEventPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row = toCalendarEventRow('', payload)
  delete row.workspace_id
  const { data, error } = await supabase
    .from('calendar_events')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseCalendarEvent(data as DataRecord)
}

export async function deleteCalendarEvent(id: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { error } = await supabase
    .from('calendar_events')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export function mapSupabaseConversation(row: DataRecord): Conversation {
  const clientName = asString(row.client_name ?? row.title ?? row.name, 'Conversacion')
  return {
    id: asString(row.id),
    clientId: asString(row.client_id),
    clientName,
    clientAvatar: asString(row.client_avatar ?? row.avatar, getInitials(clientName)),
    lastMessage: asString(row.last_message ?? row.summary, 'Sin mensajes todavia'),
    timestamp: displayTime(row.updated_at ?? row.created_at),
    unread: asBoolean(row.unread, false),
    sentiment: normalizeSentiment(row.sentiment),
    channel: normalizeChannel(row.channel),
    intent: asString(row.intent ?? row.intention) || undefined,
  }
}

function toConversationRow(workspaceId: string, payload: ConversationPayload): DataRecord {
  return {
    workspace_id: workspaceId,
    client_id: payload.clientId || null,
    client_name: payload.clientName.trim(),
    client_avatar: payload.clientAvatar || getInitials(payload.clientName),
    last_message: payload.lastMessage || 'Conversacion iniciada',
    unread: payload.unread ?? false,
    sentiment: payload.sentiment || 'neutral',
    channel: payload.channel,
    intent: payload.intent?.trim() || null,
    status: 'open',
  }
}

export async function getConversations(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseConversation)
}

export async function createConversation(workspaceId: string, payload: ConversationPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('conversations')
    .insert(toConversationRow(workspaceId, payload))
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseConversation(data as DataRecord)
}

export async function updateConversation(id: string, payload: Partial<ConversationPayload>) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row: DataRecord = {
    last_message: payload.lastMessage,
    unread: payload.unread,
    sentiment: payload.sentiment,
    intent: payload.intent,
  }
  Object.keys(row).forEach((key) => {
    if (row[key] === undefined) delete row[key]
  })

  const { data, error } = await supabase
    .from('conversations')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseConversation(data as DataRecord)
}

export async function markConversationResolved(id: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'resolved', unread: false })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseConversation(data as DataRecord)
}

export function mapSupabaseMessage(row: DataRecord): Message {
  return {
    id: asString(row.id),
    conversationId: asString(row.conversation_id),
    content: asString(row.content ?? row.body ?? row.message),
    sender: normalizeSender(row.sender ?? row.role),
    timestamp: displayTime(row.created_at ?? row.timestamp),
  }
}

export async function getConversationMessages(conversationId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseMessage)
}

export async function createMessage(conversationId: string, payload: MessagePayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row = {
    conversation_id: conversationId,
    content: payload.content.trim(),
    sender: payload.sender,
    role: payload.sender === 'ai' ? 'assistant' : payload.sender,
  }

  let result = await supabase
    .from('messages')
    .insert(row)
    .select('*')
    .single()

  if (result.error && result.error.message.toLowerCase().includes('role')) {
    const fallbackRow = {
      conversation_id: row.conversation_id,
      content: row.content,
      sender: row.sender,
    }
    result = await supabase
      .from('messages')
      .insert(fallbackRow)
      .select('*')
      .single()
  }

  if (result.error) throw result.error
  return mapSupabaseMessage(result.data as DataRecord)
}

export function mapSupabaseActivity(row: DataRecord): Activity {
  return {
    id: asString(row.id),
    type: normalizeActivityType(row.type),
    description: asString(row.description, 'Actividad registrada'),
    timestamp: displayTime(row.created_at ?? row.timestamp),
    clientName: asString(row.client_name) || undefined,
  }
}

export async function getActivities(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(12)

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseActivity)
}

export async function createActivity(workspaceId: string, payload: ActivityPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('activities')
    .insert({
      workspace_id: workspaceId,
      type: payload.type,
      description: payload.description,
      client_name: payload.clientName || null,
    })
    .select('*')
    .single()

  if (error) return null
  return mapSupabaseActivity(data as DataRecord)
}
