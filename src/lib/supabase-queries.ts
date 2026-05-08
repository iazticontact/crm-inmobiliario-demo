import { getSupabaseBrowserClient } from '@/lib/supabase'
import type {
  Activity,
  ActivityType,
  AssistantMode,
  CalendarEvent,
  Channel,
  Client,
  ClientStatus,
  Conversation,
  ConversationSentiment,
  EventType,
  Invoice,
  InvoiceStatus,
  IntegrationSetting,
  IntegrationStatus,
  Message,
  MessageSender,
  N8nFlow,
  N8nFlowStatus,
  N8nRequirement,
  WorkspaceDocument,
} from '@/lib/types'

export type ProfileRecord = {
  id: string
  workspace_id?: string | null
  full_name?: string | null
  email?: string | null
  role?: string | null
  trial_status?: string | null
}

export type WorkspaceRecord = {
  id: string
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
  assistantMode?: AssistantMode
  metadata?: Record<string, unknown>
  status?: string
}

export type MessagePayload = {
  content: string
  sender: MessageSender
  metadata?: Record<string, unknown>
}

export type ActivityPayload = {
  type: ActivityType
  description: string
  clientName?: string
}

export type N8nFlowPayload = {
  event: string
  label?: string
  description?: string
  trigger?: string
  status?: string
  webhookUrl?: string
  requires?: N8nRequirement[]
}

export type IntegrationPayload = {
  key: string
  name: string
  description?: string
  status?: IntegrationStatus
  category?: string
  info?: string
}

export type DocumentPayload = {
  clientId?: string
  title: string
  type: WorkspaceDocument['type']
  storageBucket: string
  storagePath: string
  mimeType?: string
  size?: number
  createdBy?: string
}

type DataRecord = Record<string, unknown>

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

function asUnread(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') return value === 'true' || value === '1'
  return fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeAssistantMode(value: unknown): AssistantMode | undefined {
  if (value === 'inbox' || value === 'copilot') return value
  return undefined
}

function inferAssistantMode(row: DataRecord): AssistantMode {
  const metadata = asRecord(row.metadata)
  const explicit =
    normalizeAssistantMode(row.assistant_mode) ||
    normalizeAssistantMode(metadata.assistant_mode) ||
    normalizeAssistantMode(metadata.mode)
  if (explicit) return explicit

  const marker = [
    asString(row.intent ?? row.intention),
    asString(row.channel),
    asString(row.ai_summary),
  ].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  if (marker.includes('assistant_copilot') || marker.includes('copilot') || marker.includes('consulta crm') || marker.includes('operacion comercial') || marker.includes('asistente interno') || marker.includes('crm')) {
    return 'copilot'
  }

  return 'inbox'
}

function assistantIntentForMode(mode?: AssistantMode) {
  return mode === 'copilot' ? 'assistant_copilot' : 'assistant_inbox'
}

function assistantChannelForMode(mode?: AssistantMode) {
  return mode === 'copilot' ? 'crm' : 'web'
}

function assistantChannelForPayload(mode: AssistantMode | undefined, channel: Channel) {
  if (mode === 'copilot') return assistantChannelForMode(mode)
  return channel === 'WhatsApp' ? 'whatsapp' : assistantChannelForMode(mode)
}

function isMissingColumn(error: unknown, column: string) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message?: unknown }).message) : String(error ?? '')
  return message.toLowerCase().includes(column.toLowerCase())
}

function compactRow(row: DataRecord): DataRecord {
  const next = { ...row }
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined) delete next[key]
  })
  return next
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.trim().slice(0, 2).toUpperCase() || 'C'
}

function normalizeChannel(value: unknown): Channel {
  if (value === 'WhatsApp' || value === 'Instagram' || value === 'Web' || value === 'Email') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'whatsapp') return 'WhatsApp'
    if (normalized === 'instagram') return 'Instagram'
    if (normalized === 'email') return 'Email'
    if (normalized === 'web' || normalized === 'crm') return 'Web'
  }
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

function normalizeN8nFlowStatus(value: unknown): N8nFlowStatus {
  if (value === 'active' || value === 'inactive' || value === 'demo' || value === 'pending_config' || value === 'error') return value
  if (value === 'pending') return 'pending_config'
  return 'demo'
}

function normalizeIntegrationStatus(value: unknown): IntegrationStatus {
  if (value === 'connected' || value === 'demo_connected' || value === 'demo_ready' || value === 'disconnected' || value === 'pending' || value === 'pending_config' || value === 'error') return value
  if (value === 'demo') return 'demo_ready'
  return 'pending'
}

function asRequirements(value: unknown): N8nRequirement[] {
  const allowed: N8nRequirement[] = ['Supabase', 'n8n', 'WhatsApp/API', 'Email/API', 'Billing/API', 'Payment/API', 'IA/API']
  if (Array.isArray(value)) return value.filter((item): item is N8nRequirement => allowed.includes(item as N8nRequirement))
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter((item): item is N8nRequirement => allowed.includes(item as N8nRequirement))
  }
  return ['Supabase', 'n8n']
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
  if (byId.error) throw byId.error
  return null
}

async function getCurrentProfileByEmail(email?: string | null) {
  if (!email) return null
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email)
    .maybeSingle()

  return data as ProfileRecord | null
}

async function getFirstAccessibleProfile() {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .limit(1)
    .maybeSingle()

  return data as ProfileRecord | null
}

export async function getCurrentWorkspace(profile?: ProfileRecord | null) {
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

  return null
}

async function getWorkspaceById(workspaceId?: string | null) {
  if (!workspaceId) return null
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .maybeSingle()

  return data as WorkspaceRecord | null
}

async function getFirstAccessibleWorkspace() {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data } = await supabase
    .from('workspaces')
    .select('*')
    .limit(1)
    .maybeSingle()

  return data as WorkspaceRecord | null
}

export async function getWorkspaceContext() {
  const user = await getCurrentUser()
  if (!user) return null
  const profile = await getCurrentProfile(user.id)
  const workspace = await getCurrentWorkspace(profile)
  return { user, profile, workspace }
}

export async function getResolvedWorkspaceContext() {
  const user = await getCurrentUser()
  if (!user) return null

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
  const metadataWorkspaceId =
    asString(metadata.workspace_id) ||
    asString(metadata.workspaceId) ||
    asString(metadata.workspace)

  let profile: ProfileRecord | null = null
  let workspace: WorkspaceRecord | null = null

  try {
    profile = await getCurrentProfile(user.id)
  } catch {
    profile = null
  }

  if (!profile) {
    profile = await getCurrentProfileByEmail(user.email).catch(() => null)
  }

  if (!profile) {
    profile = await getFirstAccessibleProfile().catch(() => null)
  }

  try {
    workspace = await getCurrentWorkspace(profile)
  } catch {
    workspace = null
  }

  if (!workspace) {
    workspace = await getWorkspaceById(profile?.workspace_id || metadataWorkspaceId).catch(() => null)
  }

  if (!workspace) {
    workspace = await getFirstAccessibleWorkspace().catch(() => null)
  }

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
  const metadata = asRecord(row.metadata)
  const assistantMode = inferAssistantMode(row)
  const clientName = asString(row.client_name, assistantMode === 'copilot' ? 'Consulta CRM' : 'Conversacion cliente')
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id) || undefined,
    clientId: asString(row.client_id),
    clientName,
    clientAvatar: asString(row.client_avatar ?? row.avatar, getInitials(clientName)),
    lastMessage: asString(row.ai_summary ?? row.summary, 'Sin mensajes todavia'),
    timestamp: displayTime(row.updated_at ?? row.created_at),
    unread: asUnread(row.unread, false),
    sentiment: normalizeSentiment(row.sentiment),
    channel: normalizeChannel(row.channel),
    intent: asString(row.intent ?? row.intention) || undefined,
    assistantMode,
    status: asString(row.status) || undefined,
    metadata,
    createdAt: asString(row.created_at) || undefined,
    updatedAt: asString(row.updated_at) || undefined,
  }
}

function toConversationRow(workspaceId: string, payload: ConversationPayload): DataRecord {
  const assistantMode = payload.assistantMode
  return {
    workspace_id: workspaceId,
    client_id: payload.clientId || null,
    channel: assistantChannelForPayload(assistantMode, payload.channel),
    status: payload.status || 'open',
    sentiment: payload.sentiment || 'neutral',
    intent: assistantIntentForMode(assistantMode),
    ai_summary: payload.lastMessage || (assistantMode === 'copilot' ? 'Consulta Copilot CRM' : 'Conversacion Inbox Assistant'),
    updated_at: new Date().toISOString(),
  }
}

export async function getConversations(workspaceId: string) {
  return getAssistantConversations(workspaceId)
}

export async function getAssistantConversations(workspaceId: string, mode?: AssistantMode) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  let result = await supabase
    .from('conversations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })

  if (result.error && isMissingColumn(result.error, 'updated_at')) {
    result = await supabase
      .from('conversations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
  }

  if (result.error) throw result.error
  const conversations = ((result.data as DataRecord[] | null) ?? []).map(mapSupabaseConversation)
  return mode ? conversations.filter((conversation) => (conversation.assistantMode ?? 'inbox') === mode) : conversations
}

export async function getAssistantConversationById(conversationId: string, workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error) throw error
  return data ? mapSupabaseConversation(data as DataRecord) : null
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

export async function createAssistantConversation(workspaceId: string, mode: AssistantMode, input: Partial<ConversationPayload> = {}) {
  const isCopilot = mode === 'copilot'
  return createConversation(workspaceId, {
    clientName: input.clientName || (isCopilot ? 'Consulta CRM' : 'Nueva conversacion'),
    clientAvatar: input.clientAvatar || (isCopilot ? 'CRM' : 'IN'),
    channel: input.channel || 'Web',
    sentiment: input.sentiment || 'neutral',
    intent: input.intent || assistantIntentForMode(mode),
    lastMessage: input.lastMessage || (isCopilot ? 'Consulta Copilot CRM' : 'Conversacion Inbox Assistant'),
    unread: input.unread ?? false,
    assistantMode: mode,
    metadata: {
      ...input.metadata,
      assistant_mode: mode,
      source: input.metadata?.source || 'assistant_ui',
    },
    status: input.status || 'open',
  })
}

export async function updateConversation(id: string, payload: Partial<ConversationPayload>) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const baseRow: DataRecord = {
    sentiment: payload.sentiment,
    intent: payload.intent,
    ai_summary: payload.lastMessage,
    status: payload.status,
    updated_at: new Date().toISOString(),
  }
  const row = compactRow(baseRow)

  const { data, error } = await supabase
    .from('conversations')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseConversation(data as DataRecord)
}

export async function updateConversationScoped(id: string, workspaceId: string, payload: Partial<ConversationPayload>) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const baseRow: DataRecord = {
    sentiment: payload.sentiment,
    intent: payload.intent,
    ai_summary: payload.lastMessage,
    status: payload.status,
    updated_at: new Date().toISOString(),
  }
  const row = compactRow(baseRow)

  const { data, error } = await supabase
    .from('conversations')
    .update(row)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
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
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseConversation(data as DataRecord)
}

export function mapSupabaseMessage(row: DataRecord): Message {
  const sender = asBoolean(row.is_ai) ? 'ai' : normalizeSender(row.sender)
  return {
    id: asString(row.id),
    conversationId: asString(row.conversation_id),
    workspaceId: asString(row.workspace_id) || undefined,
    content: asString(row.body ?? row.message),
    sender,
    timestamp: displayTime(row.created_at ?? row.timestamp),
    metadata: asRecord(row.metadata),
    createdAt: asString(row.created_at) || undefined,
  }
}

export async function getConversationMessages(conversationId: string, workspaceId?: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  let query = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (workspaceId) query = query.eq('workspace_id', workspaceId)
  const { data, error } = await query

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseMessage)
}

export async function createMessage(conversationId: string, payloadOrWorkspaceId: MessagePayload | string, workspaceIdOrPayload?: string | MessagePayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const payload = typeof payloadOrWorkspaceId === 'string' ? workspaceIdOrPayload as MessagePayload : payloadOrWorkspaceId
  const workspaceId = typeof payloadOrWorkspaceId === 'string' ? payloadOrWorkspaceId : typeof workspaceIdOrPayload === 'string' ? workspaceIdOrPayload : undefined
  if (!payload?.content?.trim()) throw new Error('content es obligatorio para guardar mensaje')
  if (!workspaceId) throw new Error('workspace_id es obligatorio para guardar mensajes del Assistant')

  const dbSender = payload.sender === 'ai' ? 'ai' : payload.sender === 'agent' ? 'user' : 'client'
  const row: DataRecord = {
    conversation_id: conversationId,
    workspace_id: workspaceId,
    sender: dbSender,
    body: payload.content.trim(),
    is_ai: payload.sender === 'ai',
    created_at: new Date().toISOString(),
  }

  const result = await supabase
    .from('messages')
    .insert(row)
    .select('*')
    .single()

  if (result.error) throw result.error
  return mapSupabaseMessage(result.data as DataRecord)
}

export async function ensureAssistantConversation(workspaceId: string, mode: AssistantMode = 'copilot') {
  const conversations = await getAssistantConversations(workspaceId, mode)
  if (conversations.length) return conversations[0]

  return createAssistantConversation(workspaceId, mode)
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

export function mapSupabaseDocument(row: DataRecord): WorkspaceDocument {
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id),
    clientId: asString(row.client_id) || undefined,
    title: asString(row.title, 'Documento'),
    type: normalizeDocumentType(row.type),
    storageBucket: asString(row.storage_bucket),
    storagePath: asString(row.storage_path),
    mimeType: asString(row.mime_type) || undefined,
    size: asNumber(row.size, 0) || undefined,
    createdBy: asString(row.created_by) || undefined,
    createdAt: asString(row.created_at) || undefined,
  }
}

function normalizeDocumentType(value: unknown): WorkspaceDocument['type'] {
  if (value === 'client_file' || value === 'invoice_pdf' || value === 'proposal_pdf' || value === 'conversation_attachment' || value === 'workspace_asset') return value
  return 'client_file'
}

function toDocumentRow(workspaceId: string, payload: DocumentPayload): DataRecord {
  return {
    workspace_id: workspaceId,
    client_id: payload.clientId || null,
    title: payload.title.trim(),
    type: payload.type,
    storage_bucket: payload.storageBucket,
    storage_path: payload.storagePath,
    mime_type: payload.mimeType || null,
    size: payload.size ?? null,
    created_by: payload.createdBy || null,
  }
}

export async function listDocuments(workspaceId: string, clientId?: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  let query = supabase
    .from('documents')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (clientId) query = query.eq('client_id', clientId)
  const { data, error } = await query
  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseDocument)
}

export async function createDocumentRecord(workspaceId: string, payload: DocumentPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('documents')
    .insert(toDocumentRow(workspaceId, payload))
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseDocument(data as DataRecord)
}

export async function getSignedDocumentUrl(document: Pick<WorkspaceDocument, 'storageBucket' | 'storagePath'>, expiresIn = 60 * 10) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .storage
    .from(document.storageBucket)
    .createSignedUrl(document.storagePath, expiresIn)

  if (error) throw error
  return data.signedUrl
}

export function mapSupabaseN8nFlow(row: DataRecord): N8nFlow {
  const event = asString(row.event ?? row.event_type ?? row.name, 'custom_flow')
  return {
    id: asString(row.id, event),
    event,
    label: asString(row.label ?? row.name, event),
    description: asString(row.description, 'Flujo preparado para n8n.'),
    trigger: asString(row.trigger, 'Evento NowCRM'),
    webhookUrl: asString(row.webhook_url ?? row.endpoint ?? row.url),
    status: normalizeN8nFlowStatus(row.status ?? (row.enabled === true ? 'active' : undefined)),
    requires: asRequirements(row.requires ?? row.requirements),
    updatedAt: asString(row.updated_at ?? row.created_at) || undefined,
  }
}

function toN8nFlowRow(workspaceId: string, payload: N8nFlowPayload): DataRecord {
  return {
    workspace_id: workspaceId,
    event: payload.event,
    label: payload.label || payload.event,
    description: payload.description || null,
    trigger: payload.trigger || null,
    webhook_url: payload.webhookUrl || null,
    status: normalizeN8nFlowStatus(payload.status),
    requires: payload.requires || ['Supabase', 'n8n'],
  }
}

export async function getN8nFlows(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('n8n_flows')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseN8nFlow)
}

export async function upsertN8nFlow(workspaceId: string, payload: N8nFlowPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const existing = await supabase
    .from('n8n_flows')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('event', payload.event)
    .maybeSingle()

  const row = toN8nFlowRow(workspaceId, payload)

  if (existing.data) {
    delete row.workspace_id
    delete row.event
    const { data, error } = await supabase
      .from('n8n_flows')
      .update(row)
      .eq('id', asString((existing.data as DataRecord).id))
      .select('*')
      .single()

    if (error) throw error
    return mapSupabaseN8nFlow(data as DataRecord)
  }

  const { data, error } = await supabase
    .from('n8n_flows')
    .insert(row)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseN8nFlow(data as DataRecord)
}

export async function updateN8nFlow(id: string, payload: Partial<N8nFlowPayload>) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row: DataRecord = {
    label: payload.label,
    description: payload.description,
    trigger: payload.trigger,
    webhook_url: payload.webhookUrl,
    status: payload.status ? normalizeN8nFlowStatus(payload.status) : undefined,
    requires: payload.requires,
  }
  Object.keys(row).forEach((key) => {
    if (row[key] === undefined) delete row[key]
  })

  const { data, error } = await supabase
    .from('n8n_flows')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseN8nFlow(data as DataRecord)
}

export async function seedN8nFlows(workspaceId: string, payloads: N8nFlowPayload[]) {
  const seeded: N8nFlow[] = []
  for (const payload of payloads) {
    seeded.push(await upsertN8nFlow(workspaceId, payload))
  }
  return seeded
}

export function mapSupabaseIntegrationSetting(row: DataRecord): IntegrationSetting {
  const key = asString(row.key ?? row.provider ?? row.slug ?? row.name, 'integration')
  return {
    id: asString(row.id, key),
    key,
    name: asString(row.name ?? row.label, key),
    description: asString(row.description, 'Integracion preparada para la fase real.'),
    status: normalizeIntegrationStatus(row.status),
    category: asString(row.category, 'Sistema'),
    info: asString(row.info ?? row.public_label) || undefined,
  }
}

function toIntegrationRow(workspaceId: string, payload: IntegrationPayload): DataRecord {
  return {
    workspace_id: workspaceId,
    key: payload.key,
    name: payload.name,
    description: payload.description || null,
    status: normalizeIntegrationStatus(payload.status),
    category: payload.category || 'Sistema',
    info: payload.info || null,
  }
}

export async function getIntegrationSettings(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseIntegrationSetting)
}

export async function upsertIntegrationSetting(workspaceId: string, payload: IntegrationPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const existing = await supabase
    .from('integrations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('key', payload.key)
    .maybeSingle()

  const row = toIntegrationRow(workspaceId, payload)

  if (existing.data) {
    delete row.workspace_id
    delete row.key
    const { data, error } = await supabase
      .from('integrations')
      .update(row)
      .eq('id', asString((existing.data as DataRecord).id))
      .select('*')
      .single()

    if (error) throw error
    return mapSupabaseIntegrationSetting(data as DataRecord)
  }

  const { data, error } = await supabase
    .from('integrations')
    .insert(row)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseIntegrationSetting(data as DataRecord)
}

export async function updateIntegrationSetting(id: string, payload: Partial<IntegrationPayload>) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row: DataRecord = {
    name: payload.name,
    description: payload.description,
    status: payload.status ? normalizeIntegrationStatus(payload.status) : undefined,
    category: payload.category,
    info: payload.info,
  }
  Object.keys(row).forEach((key) => {
    if (row[key] === undefined) delete row[key]
  })

  const { data, error } = await supabase
    .from('integrations')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseIntegrationSetting(data as DataRecord)
}
