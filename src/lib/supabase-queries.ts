import { getSupabaseBrowserClient } from '@/lib/supabase'
import { buildCalendarEventTimes, type CalendarTimeInput } from '@/lib/calendar-time'
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

export { buildCalendarEventTimes } from '@/lib/calendar-time'

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
  clientId?: string
  clientName: string
  invoiceNumber?: string
  number?: string
  amount: number
  currency?: string
  status: InvoiceStatus
  date?: string
  issueDate?: string
  dueDate?: string
  paidAt?: string
  concept?: string
  plan?: string
  notes?: string
  metadata?: Record<string, unknown>
}

export type CalendarEventPayload = CalendarTimeInput & {
  clientId?: string
  title: string
  type?: EventType
  clientName?: string
  location?: string
  notes?: string
  description?: string
  status?: string
  metadata?: Record<string, unknown>
}

export type TaskPayload = {
  clientId?: string
  clientName?: string
  title: string
  description?: string
  assigned_to?: string
  status?: string
  priority?: string
  due_date?: string
  dueDate?: string
  metadata?: Record<string, unknown>
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

  if (marker.includes('assistant_copilot') || marker.includes('copilot') || marker.includes('consulta crm') || marker.includes('consulta nowlabs ai') || marker.includes('operacion comercial') || marker.includes('asistente interno') || marker.includes('crm')) {
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

function isSchemaError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const e = error as Record<string, unknown>
  const code = String(e.code ?? '')
  if (code === 'PGRST204' || code === '42703') return true
  const msg = String(e.message ?? '').toLowerCase()
  return msg.includes('column') || msg.includes('could not find') || msg.includes('schema cache')
}

function compactRow(row: DataRecord): DataRecord {
  const next = { ...row }
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined) delete next[key]
  })
  return next
}

function removeMissingSchemaColumn(row: DataRecord, error: unknown, optionalColumns: string[]) {
  if (!isSchemaError(error)) return null
  const missing = optionalColumns.find((column) => Object.prototype.hasOwnProperty.call(row, column) && isMissingColumn(error, column))
  if (!missing) return null
  const next = { ...row }
  delete next[missing]
  return next
}

function warnBestEffort(label: string, error: unknown) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[best-effort:${label}]`, error)
  }
}

function dateOnly(value: unknown, fallback = todayIso()) {
  const raw = asString(value, fallback)
  return raw ? raw.slice(0, 10) : fallback
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
  if (typeof value === 'string') {
    const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (normalized === 'pagada' || normalized === 'pagado' || normalized === 'paid') return 'paid'
    if (normalized === 'vencida' || normalized === 'vencido' || normalized === 'overdue') return 'overdue'
    if (normalized === 'pendiente' || normalized === 'pending') return 'pending'
  }
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

interface ResolveProfileResult {
  profile: ProfileRecord | null
  profileLookupMethod: 'id' | 'email' | 'none'
  profileByIdError?: string | null
  profileByEmailError?: string | null
}

async function resolveCurrentProfile(userId?: string, email?: string): Promise<ResolveProfileResult> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { profile: null, profileLookupMethod: 'none' }

  const userResult = await supabase.auth.getUser()
  const authUser = userResult.data.user
  const resolvedUserId = userId ?? authUser?.id ?? null
  const resolvedEmail = email ?? authUser?.email ?? null

  let profile: ProfileRecord | null = null
  let profileLookupMethod: ResolveProfileResult['profileLookupMethod'] = 'none'
  let profileByIdError: string | null = null
  let profileByEmailError: string | null = null

  if (resolvedUserId) {
    const result = await supabase
      .from('profiles')
      .select('*')
      .eq('id', resolvedUserId)
      .maybeSingle()

    profileByIdError = result.error?.message ?? null
    if (result.data) {
      profile = result.data as ProfileRecord
      profileLookupMethod = 'id'
    }
  }

  if (!profile && resolvedEmail) {
    const result = await supabase
      .from('profiles')
      .select('*')
      .ilike('email', resolvedEmail)
      .maybeSingle()

    profileByEmailError = result.error?.message ?? null
    if (result.data) {
      profile = result.data as ProfileRecord
      profileLookupMethod = 'email'
    }
  }

  return {
    profile,
    profileLookupMethod,
    profileByIdError,
    profileByEmailError,
  }
}

export async function getCurrentProfile(userId?: string, email?: string) {
  const result = await resolveCurrentProfile(userId, email)
  return result.profile
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

export async function getWorkspaceContext() {
  const user = await getCurrentUser()
  if (!user) return null

  const profile = await getCurrentProfile(user.id, user.email ?? undefined)
  const workspace = await getCurrentWorkspace(profile)
  return { user, profile, workspace }
}

export async function getResolvedWorkspaceContext() {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) {
    return {
      user: null,
      profile: null,
      workspace: null,
      workspaceId: null,
      resolvedWorkspaceId: null,
      error: 'Supabase client no configurado',
      profileLookupMethod: 'none',
      profileByIdError: null,
      profileByEmailError: null,
    }
  }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  const user = userData?.user ?? null
  if (userError || !user) {
    return {
      user: null,
      profile: null,
      workspace: null,
      workspaceId: null,
      resolvedWorkspaceId: null,
      error: userError?.message ?? 'No se ha obtenido usuario autenticado',
      profileLookupMethod: 'none',
      profileByIdError: null,
      profileByEmailError: null,
    }
  }

  const profileResult = await resolveCurrentProfile(user.id, user.email ?? undefined)
  const profile = profileResult.profile

  const isEmergencyDemoOwner =
    user.id === '91b65a40-222d-4f97-870c-8e4119278c2c' ||
    user.email === 'oier.dunabeitia@opendeusto.es'
  const emergencyWorkspaceId = '7d1ad8e8-e9f7-47fb-92d5-299516b6dc1b'

  if (!profile && isEmergencyDemoOwner) {
    const fallbackProfile: ProfileRecord = {
      id: '91b65a40-222d-4f97-870c-8e4119278c2c',
      workspace_id: emergencyWorkspaceId,
      full_name: 'Oier Duñabeitia',
      email: 'oier.dunabeitia@opendeusto.es',
      role: 'owner',
    }

    const fallbackWorkspace: WorkspaceRecord = {
      id: emergencyWorkspaceId,
      name: 'Arturito',
      plan: 'demo',
      status: 'active',
    }

    return {
      user,
      profile: fallbackProfile,
      workspace: fallbackWorkspace,
      workspaceId: emergencyWorkspaceId,
      resolvedWorkspaceId: emergencyWorkspaceId,
      error: null,
      profileLookupMethod: 'emergency-fallback-no-profile',
      profileByIdError: profileResult.profileByIdError ?? null,
      profileByEmailError: profileResult.profileByEmailError ?? null,
    }
  }

  if (!profile) {
    return {
      user,
      profile: null,
      workspace: null,
      workspaceId: null,
      resolvedWorkspaceId: null,
      error:
        profileResult.profileByIdError ||
        profileResult.profileByEmailError ||
        'Authenticated user but profile not found',
      profileLookupMethod: profileResult.profileLookupMethod,
      profileByIdError: profileResult.profileByIdError ?? null,
      profileByEmailError: profileResult.profileByEmailError ?? null,
    }
  }

  const workspaceId = profile.workspace_id ?? null
  if (!workspaceId) {
    return {
      user,
      profile,
      workspace: null,
      workspaceId: null,
      resolvedWorkspaceId: null,
      error: 'Profile has no workspace_id',
      profileLookupMethod: profileResult.profileLookupMethod,
      profileByIdError: profileResult.profileByIdError ?? null,
      profileByEmailError: profileResult.profileByEmailError ?? null,
    }
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .maybeSingle()

  // Emergency local fallback for demo owner while Supabase profile resolver is being verified.
  if (
    !workspace &&
    (user.id === '91b65a40-222d-4f97-870c-8e4119278c2c' ||
     user.email === 'oier.dunabeitia@opendeusto.es')
  ) {
    const fallbackWorkspaceId = '7d1ad8e8-e9f7-47fb-92d5-299516b6dc1b'
    const fallbackProfile: ProfileRecord = {
      id: '91b65a40-222d-4f97-870c-8e4119278c2c',
      workspace_id: fallbackWorkspaceId,
      full_name: 'Oier Duñabeitia',
      email: 'oier.dunabeitia@opendeusto.es',
      role: 'owner',
    }
    const fallbackWorkspace: WorkspaceRecord = {
      id: fallbackWorkspaceId,
      name: 'Arturito',
      plan: 'demo',
      status: 'active',
    }
    return {
      user,
      profile: fallbackProfile,
      workspace: fallbackWorkspace,
      workspaceId: fallbackWorkspaceId,
      resolvedWorkspaceId: fallbackWorkspaceId,
      error: null,
      profileLookupMethod: 'emergency-fallback',
      profileByIdError: null,
      profileByEmailError: null,
    }
  }

  return {
    user,
    profile,
    workspace: workspace ? (workspace as WorkspaceRecord) : null,
    workspaceId,
    resolvedWorkspaceId: workspaceId,
    error: workspaceError?.message ?? null,
    profileLookupMethod: profileResult.profileLookupMethod,
    profileByIdError: profileResult.profileByIdError ?? null,
    profileByEmailError: profileResult.profileByEmailError ?? null,
  }
}

export function mapSupabaseClient(row: DataRecord): Client {
  const name = asString(row.name, 'No consta')
  return {
    id: asString(row.id),
    name,
    company: asString(row.company, 'No consta'),
    email: asString(row.email, 'No consta'),
    phone: asString(row.phone, 'No consta'),
    channel: normalizeChannel(row.channel),
    status: normalizeStatus(row.status),
    leadScore: asNumber(row.lead_score, 50),
    lastInteraction: asString(row.last_interaction, 'Ahora mismo'),
    avatar: asString(row.avatar, getInitials(name === 'No consta' ? 'C' : name)),
    notes: asString(row.notes, 'No consta'),
    createdAt: asString(row.created_at, 'No consta'),
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

  if (!workspaceId) throw new Error('workspaceId es requerido para crear un cliente')

  const row = toClientRow(workspaceId, payload)
  const { data, error } = await supabase
    .from('clients')
    .insert(row)
    .select('*')
    .single()

  if (error) {
    const errorMsg = `[Supabase Error] ${error.message || error.code || 'Error desconocido'} ${error.details ? `- ${error.details}` : ''} ${error.hint ? `- Hint: ${error.hint}` : ''}`
    console.error('[DEBUG] createClientLead error:', { workspaceId, row, error, fullErrorMsg: errorMsg })
    throw new Error(errorMsg)
  }
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
  const concept = asString(row.concept ?? row.concepto ?? row.plan ?? row.description, 'Servicio')
  const issueDate = dateOnly(row.issue_date ?? row.fecha_de_asunto ?? row.fecha_de_emision ?? row.date ?? row.issued_at ?? row.created_at)
  const dueDate = dateOnly(row.due_date ?? row.fecha_de_vencimiento ?? row.dueDate, todayIso())
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id) || undefined,
    clientId: asString(row.client_id) || undefined,
    clientName: asString(row.client_name ?? row.customer_name ?? row.clientName ?? row.cliente, 'Cliente'),
    invoiceNumber: asString(row.invoice_number ?? row.numero_factura) || undefined,
    number: asString(row.number ?? row.numero) || undefined,
    amount: asNumber(row.amount ?? row.cantidad, 0),
    currency: asString(row.currency ?? row.divisa, 'EUR'),
    status: normalizeInvoiceStatus(row.status ?? row.estado),
    date: issueDate,
    issueDate,
    dueDate,
    paidAt: asString(row.paid_at ?? row.pagado_en) || undefined,
    concept,
    plan: asString(row.plan ?? concept, concept),
    notes: asString(row.notes),
    metadata: asRecord(row.metadata),
  }
}

function toInvoiceRow(workspaceId: string, payload: InvoicePayload): DataRecord {
  const concept = payload.concept?.trim() || payload.plan?.trim() || 'Servicio'
  const issueDate = payload.issueDate || payload.date || todayIso()
  const dueDate = payload.dueDate || issueDate
  const invoiceNumber = payload.invoiceNumber || payload.number || undefined
  return {
    workspace_id: workspaceId,
    client_id: payload.clientId || null,
    client_name: payload.clientName.trim(),
    invoice_number: invoiceNumber || null,
    number: invoiceNumber || null,
    concept,
    plan: payload.plan?.trim() || concept,
    amount: payload.amount,
    currency: payload.currency || 'EUR',
    status: payload.status,
    issue_date: issueDate,
    due_date: dueDate,
    paid_at: payload.paidAt || null,
    notes: payload.notes?.trim() || null,
    metadata: payload.metadata || {},
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

  let row = compactRow(toInvoiceRow(workspaceId, payload))
  const optionalColumns = ['client_id', 'invoice_number', 'number', 'concept', 'plan', 'currency', 'issue_date', 'due_date', 'paid_at', 'notes', 'metadata']

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const result = await supabase.from('invoices').insert(row).select('*').single()
    if (!result.error) return mapSupabaseInvoice(result.data as DataRecord)
    const nextRow = removeMissingSchemaColumn(row, result.error, optionalColumns)
    if (!nextRow) throw result.error
    row = nextRow
  }

  throw new Error('No se pudo crear la factura con el schema disponible')
}


export async function updateInvoice(id: string, payload: InvoicePayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row = toInvoiceRow('', payload)
  delete row.workspace_id
  let patch = compactRow(row)
  const optionalColumns = ['client_id', 'invoice_number', 'number', 'concept', 'plan', 'currency', 'issue_date', 'due_date', 'paid_at', 'notes', 'metadata']

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const result = await supabase.from('invoices').update(patch).eq('id', id).select('*').single()
    if (!result.error) return mapSupabaseInvoice(result.data as DataRecord)
    const nextPatch = removeMissingSchemaColumn(patch, result.error, optionalColumns)
    if (!nextPatch) throw result.error
    patch = nextPatch
  }

  throw new Error('No se pudo actualizar la factura con el schema disponible')
}

export async function markInvoicePaid(id: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  let patch: DataRecord = { status: 'paid', paid_at: new Date().toISOString() }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await supabase.from('invoices').update(patch).eq('id', id).select('*').single()
    if (!result.error) return mapSupabaseInvoice(result.data as DataRecord)
    const nextPatch = removeMissingSchemaColumn(patch, result.error, ['paid_at'])
    if (!nextPatch) throw result.error
    patch = nextPatch
  }

  throw new Error('No se pudo marcar la factura como pagada')
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
  const hasStartAt = Boolean(row.start_at)
  const times = hasStartAt
    ? buildCalendarEventTimes({
        startAt: asString(row.start_at),
        endAt: asString(row.end_at) || undefined,
        duration: asNumber(row.duration, 60),
      })
    : buildCalendarEventTimes({
        date: dateOnly(row.date ?? row.event_date ?? row.start_date),
        startHour: asNumber(row.start_hour, 10),
        startMinute: asNumber(row.start_minute, 0),
        duration: asNumber(row.duration, 60),
      })
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id) || undefined,
    clientId: asString(row.client_id) || undefined,
    title: asString(row.title, 'Evento'),
    startAt: times.startAtIso,
    endAt: times.endAtIso,
    date: times.date,
    startHour: times.startHour,
    startMinute: times.startMinute,
    duration: times.duration,
    type: normalizeEventType(row.type),
    clientName: asString(row.client_name ?? row.clientName) || undefined,
    location: asString(row.location) || undefined,
    notes: asString(row.notes) || undefined,
    description: asString(row.description ?? row.notes) || undefined,
    status: asString(row.status, 'scheduled'),
    metadata: asRecord(row.metadata),
    createdAt: asString(row.created_at) || undefined,
    updatedAt: asString(row.updated_at) || undefined,
    googleEventId: asString(row.google_event_id) || undefined,
    googleCalendarId: asString(row.google_calendar_id) || undefined,
    syncSource: asString(row.sync_source) || undefined,
    lastSyncedAt: asString(row.last_synced_at) || undefined,
  }
}

function toCalendarEventRow(workspaceId: string, payload: CalendarEventPayload): DataRecord {
  const times = buildCalendarEventTimes(payload)
  const description = payload.description?.trim() || payload.notes?.trim() || null
  return {
    workspace_id: workspaceId,
    client_id: payload.clientId || null,
    client_name: payload.clientName?.trim() || null,
    title: payload.title.trim(),
    type: payload.type || 'meeting',
    start_at: times.startAtIso,
    end_at: times.endAtIso,
    date: times.date,
    start_hour: times.startHour,
    start_minute: times.startMinute,
    duration: times.duration,
    location: payload.location?.trim() || null,
    notes: payload.notes?.trim() || null,
    description,
    status: payload.status || 'scheduled',
    metadata: payload.metadata || {},
  }
}

export async function getCalendarEvents(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  let result = await supabase
    .from('calendar_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('start_at', { ascending: true })

  if (result.error && isSchemaError(result.error) && isMissingColumn(result.error, 'start_at')) {
    result = await supabase
      .from('calendar_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('date', { ascending: true })
  }

  if (result.error) throw result.error
  return ((result.data as DataRecord[] | null) ?? []).map(mapSupabaseCalendarEvent)
}

export async function deleteConversationPermanently(conversationId: string, workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { error: deleteMessagesError } = await supabase
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('workspace_id', workspaceId)

  if (deleteMessagesError) throw deleteMessagesError

  const { error: deleteConversationError } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)

  if (deleteConversationError) throw deleteConversationError
}

export async function getLatestClient(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ? mapSupabaseClient(data as DataRecord) : null
}

export async function getClientStats(workspaceId: string) {
  const clients = await getClients(workspaceId)
  const totalClients = clients.length
  return {
    total_clients: totalClients,
    leads: clients.filter((client) => client.status === 'lead').length,
    active: clients.filter((client) => client.status === 'active').length,
    inactive: clients.filter((client) => client.status === 'inactive').length,
    churned: clients.filter((client) => client.status === 'churned').length,
  }
}

export async function searchClients(workspaceId: string, query = '') {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const normalized = query.trim().toLowerCase()
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  const clients = ((data as DataRecord[] | null) ?? []).map(mapSupabaseClient)
  if (!normalized) return clients

  return clients.filter((client) =>
    [client.name, client.company, client.email, client.phone]
      .map((value) => String(value ?? '').toLowerCase())
      .some((value) => value.includes(normalized))
  )
}

export async function getClientDetail(workspaceId: string, clientId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', clientId)
    .maybeSingle()

  if (error) throw error
  return data ? mapSupabaseClient(data as DataRecord) : null
}

export async function getClientByNameOrEmail(workspaceId: string, query: string) {
  const clients = await searchClients(workspaceId, query)
  return clients.length === 1 ? clients[0] : null
}

export async function getClientConversations(workspaceId: string, clientIdOrName: string) {
  const conversations = await getAssistantConversations(workspaceId)
  return conversations.filter(c => c.clientId === clientIdOrName || c.clientName.toLowerCase().includes(clientIdOrName.toLowerCase()))
}

export async function getClientInvoices(workspaceId: string, clientIdOrName: string) {
  const invoices = await getInvoices(workspaceId)
  return invoices.filter(i => i.clientId === clientIdOrName || i.clientName.toLowerCase().includes(clientIdOrName.toLowerCase()))
}

export async function getClientCalendarEvents(workspaceId: string, clientIdOrName: string) {
  const events = await getCalendarEvents(workspaceId)
  return events.filter(e => e.clientId === clientIdOrName || (e.clientName && e.clientName.toLowerCase().includes(clientIdOrName.toLowerCase())))
}

export async function getRecentActivities(workspaceId: string) {
  return getActivities(workspaceId)
}

export async function getClientActivities(workspaceId: string, clientIdOrName: string) {
  const activities = await getActivities(workspaceId)
  return activities.filter(a => a.clientName && a.clientName.toLowerCase().includes(clientIdOrName.toLowerCase()))
}

export async function getClientFullContext(workspaceId: string, clientId: string) {
  const client = await getClientDetail(workspaceId, clientId)
  if (!client) return null
  const [invoices, calendarEvents, conversations, activities] = await Promise.all([
    getClientInvoices(workspaceId, client.name).catch(() => []),
    getClientCalendarEvents(workspaceId, client.name).catch(() => []),
    getClientConversations(workspaceId, clientId).catch(() => []),
    getClientActivities(workspaceId, client.name).catch(() => []),
  ])
  return { client, invoices, calendarEvents, conversations, activities }
}

export async function getPendingInvoices(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .order('due_date', { ascending: true })
    .limit(50)

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseInvoice)
}

export async function getUpcomingCalendarEvents(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const nowIso = new Date().toISOString()
  let result = await supabase
    .from('calendar_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('start_at', nowIso)
    .order('start_at', { ascending: true })
    .limit(20)

  if (result.error && isSchemaError(result.error) && isMissingColumn(result.error, 'start_at')) {
    const today = todayIso()
    result = await supabase
      .from('calendar_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(20)
  }

  if (result.error) throw result.error
  return ((result.data as DataRecord[] | null) ?? []).map(mapSupabaseCalendarEvent)
}

export async function getWorkspaceSummary(workspaceId: string) {
  const [clients, invoices, events, conversations] = await Promise.all([
    getClients(workspaceId),
    getInvoices(workspaceId),
    getCalendarEvents(workspaceId),
    getAssistantConversations(workspaceId),
  ])

  return {
    total_clients: clients.length,
    leads: clients.filter((client) => client.status === 'lead').length,
    pending_invoices: invoices.filter((invoice) => invoice.status === 'pending').length,
    overdue_invoices: invoices.filter((invoice) => invoice.status === 'overdue').length,
    upcoming_events: events.length,
    open_conversations: conversations.filter((conversation) => conversation.status !== 'resolved').length,
    recent_activities: [],
  }
}

export async function getNextBestActions(workspaceId: string) {
  const [invoices, clients, conversations, events] = await Promise.all([
    getInvoices(workspaceId),
    getClients(workspaceId),
    getAssistantConversations(workspaceId),
    getUpcomingCalendarEvents(workspaceId),
  ])

  const overdueInvoices = invoices.filter((invoice) => invoice.status === 'overdue')
  const hotLeads = clients.filter((client) => client.status === 'lead' && client.leadScore >= 75)
  const openConversations = conversations.filter((conversation) => conversation.status !== 'resolved')
  const upcomingEvents = events.slice(0, 3)

  return [
    overdueInvoices.length ? `Prioriza ${overdueInvoices.length} factura(s) vencida(s) y haz seguimiento.` : '',
    hotLeads.length ? `Contacta ${hotLeads.length} lead(s) con score alto.` : '',
    openConversations.length ? `Resuelve ${openConversations.length} conversación(es) abiertas.` : '',
    upcomingEvents.length ? `Prepara ${upcomingEvents.length} cita(s) próximas.` : '',
  ].filter(Boolean)
}

export async function createCalendarEvent(workspaceId: string, payload: CalendarEventPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  let row = compactRow(toCalendarEventRow(workspaceId, payload))
  if (!row.start_at || !row.end_at) throw new Error('start_at y end_at son obligatorios para calendar_events')
  const optionalColumns = ['client_id', 'client_name', 'date', 'start_hour', 'start_minute', 'duration', 'location', 'notes', 'description', 'metadata']

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const result = await supabase.from('calendar_events').insert(row).select('*').single()
    if (!result.error) return mapSupabaseCalendarEvent(result.data as DataRecord)
    const nextRow = removeMissingSchemaColumn(row, result.error, optionalColumns)
    if (!nextRow) throw result.error
    row = nextRow
  }

  throw new Error('No se pudo crear el evento con el schema disponible')
}


export async function updateCalendarEvent(id: string, workspaceIdOrPayload: string | CalendarEventPayload, maybePayload?: CalendarEventPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const workspaceId = typeof workspaceIdOrPayload === 'string' ? workspaceIdOrPayload : undefined
  const payload = typeof workspaceIdOrPayload === 'string' ? maybePayload : workspaceIdOrPayload
  if (!payload) throw new Error('payload es obligatorio para actualizar calendar_events')
  const row = toCalendarEventRow('', payload)
  delete row.workspace_id
  let patch = compactRow(row)
  if (!patch.start_at || !patch.end_at) throw new Error('start_at y end_at son obligatorios para calendar_events')
  const optionalColumns = ['client_id', 'client_name', 'date', 'start_hour', 'start_minute', 'duration', 'location', 'notes', 'description', 'metadata']

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    let query = supabase.from('calendar_events').update(patch).eq('id', id)
    if (workspaceId) query = query.eq('workspace_id', workspaceId)
    const result = await query.select('*').single()
    if (!result.error) return mapSupabaseCalendarEvent(result.data as DataRecord)
    const nextPatch = removeMissingSchemaColumn(patch, result.error, optionalColumns)
    if (!nextPatch) throw result.error
    patch = nextPatch
  }

  throw new Error('No se pudo actualizar el evento con el schema disponible')
}

export async function deleteCalendarEvent(id: string, workspaceId?: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  let query = supabase
    .from('calendar_events')
    .delete()
    .eq('id', id)

  if (workspaceId) query = query.eq('workspace_id', workspaceId)
  const { error } = await query
  if (error) throw error
}

export function mapSupabaseConversation(row: DataRecord): Conversation {
  const metadata = asRecord(row.metadata)
  const assistantMode = inferAssistantMode(row)
  const metadataTitle = typeof metadata.title === 'string' && metadata.title ? metadata.title : undefined
  const clientName = metadataTitle ?? (asString(row.title ?? row.name, '') || (assistantMode === 'copilot' ? 'Consulta NowLabs AI' : 'Conversacion cliente'))
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id) || undefined,
    clientId: asString(row.client_id || metadata.last_client_id || metadata.clientId),
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
  const metadataBase = payload.metadata ?? {}
  return {
    workspace_id: workspaceId,
    client_id: payload.clientId || null,
    channel: assistantChannelForPayload(assistantMode, payload.channel),
    status: payload.status || 'open',
    sentiment: payload.sentiment || 'neutral',
    intent: assistantIntentForMode(assistantMode),
    ai_summary: payload.lastMessage || (assistantMode === 'copilot' ? 'Consulta NowLabs AI' : 'Conversacion Inbox Assistant'),
    metadata: { ...metadataBase, assistant_mode: assistantMode },
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
  const conversations = ((result.data as DataRecord[] | null) ?? [])
    .map(mapSupabaseConversation)
    .filter((conversation) => conversation.status !== 'deleted')
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
    clientName: input.clientName || (isCopilot ? 'Consulta NowLabs AI' : 'Nueva conversacion'),
    clientAvatar: input.clientAvatar || (isCopilot ? 'CRM' : 'IN'),
    channel: input.channel || 'Web',
    sentiment: input.sentiment || 'neutral',
    intent: input.intent || assistantIntentForMode(mode),
    lastMessage: input.lastMessage || (isCopilot ? 'Consulta NowLabs AI' : 'Conversacion Inbox Assistant'),
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

export async function updateConversationTitle(id: string, workspaceId: string, title: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return

  const { data } = await supabase
    .from('conversations')
    .select('metadata')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const existing = (data?.metadata && typeof data.metadata === 'object') ? data.metadata as Record<string, unknown> : {}
  await supabase
    .from('conversations')
    .update({ metadata: { ...existing, title }, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
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

export async function archiveConversationScoped(id: string, workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
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

  if (error) {
    warnBestEffort('createActivity', error)
    return null
  }
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

export async function uploadDocumentToStorage(
  bucket: string,
  path: string,
  content: string | Uint8Array | Blob,
  contentType = 'text/plain; charset=utf-8'
) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')
  let body: Blob
  if (typeof content === 'string') {
    body = new Blob([content], { type: contentType })
  } else if (content instanceof Uint8Array) {
    body = new Blob([content.slice(0).buffer], { type: contentType })
  } else {
    body = content
  }
  const { data, error } = await supabase.storage.from(bucket).upload(path, body, { contentType, upsert: true })
  if (error) throw error
  return data
}

export async function saveGeneratedDocument(workspaceId: string, payload: DocumentPayload, content: string | Uint8Array | Blob) {
  const uploaded = await uploadDocumentToStorage(payload.storageBucket, payload.storagePath, content, payload.mimeType)
  const doc = await createDocumentRecord(workspaceId, payload)
  return { uploaded, doc }
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

export async function getWhatsappConnection(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('whatsapp_connections')
    .select('id, workspace_id, provider, phone_number, status, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error) {
    if (isSchemaError(error)) return null
    throw error
  }
  return data as DataRecord | null
}

export async function getInboxAgentSettings(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('inbox_agent_settings')
    .select('id, workspace_id, auto_reply_enabled, status, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error) {
    if (isSchemaError(error)) return null
    throw error
  }
  return data as DataRecord | null
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

// Tasks helpers
export async function listTasks(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as DataRecord[]).map(mapSupabaseTask)
}

export async function createTask(workspaceId: string, payload: TaskPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const dueDate = payload.dueDate || payload.due_date
  const row = compactRow({
    workspace_id: workspaceId,
    client_id: payload.clientId || null,
    client_name: payload.clientName || null,
    title: payload.title,
    description: payload.description || null,
    assigned_to: payload.assigned_to || null,
    status: payload.status || 'pending',
    priority: payload.priority || 'normal',
    due_date: dueDate || null,
    metadata: payload.metadata || {},
    created_at: new Date().toISOString(),
  })
  let insertRow = row
  const optionalColumns = ['client_id', 'client_name', 'assigned_to', 'priority', 'due_date', 'metadata', 'created_at']

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const result = await supabase.from('tasks').insert(insertRow).select('*').single()
    if (!result.error) return mapSupabaseTask(result.data as DataRecord)
    const nextRow = removeMissingSchemaColumn(insertRow, result.error, optionalColumns)
    if (!nextRow) throw result.error
    insertRow = nextRow
  }

  throw new Error('No se pudo crear la tarea con el schema disponible')
}

// Notifications helpers
export async function listNotifications(profileId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as DataRecord[]).map(mapSupabaseNotification)
}

export async function markNotificationRead(id: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('notifications')
    .update({ read: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseNotification(data as DataRecord)
}

// Agent action logs helpers
export async function createAgentActionLog(workspaceId: string, payload: { action: string; details?: Record<string, unknown> }) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  let result = await supabase
    .from('agent_action_logs')
    .insert({
      workspace_id: workspaceId,
      action: payload.action,
      details: payload.details || {},
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (result.error && isSchemaError(result.error) && isMissingColumn(result.error, 'details')) {
    result = await supabase.from('agent_action_logs').insert({
      workspace_id: workspaceId,
      action: payload.action,
      created_at: new Date().toISOString(),
    }).select('*').single()
  }

  if (result.error && isSchemaError(result.error) && isMissingColumn(result.error, 'created_at')) {
    result = await supabase.from('agent_action_logs').insert({
      workspace_id: workspaceId,
      action: payload.action,
    }).select('*').single()
  }

  if (result.error) {
    warnBestEffort('createAgentActionLog', result.error)
    return null
  }
  return result.data
}

// N8n trigger logs helpers
export async function createN8nTriggerLog(workspaceId: string, payload: { trigger: string; details?: Record<string, unknown> }) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('n8n_trigger_logs')
    .insert({
      workspace_id: workspaceId,
      trigger: payload.trigger,
      details: payload.details || {},
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

// Mappers for new tables
export function mapSupabaseTask(row: DataRecord) {
  return {
    id: asString(row.id),
    workspace_id: asString(row.workspace_id),
    client_id: asString(row.client_id) || undefined,
    client_name: asString(row.client_name) || undefined,
    title: asString(row.title),
    description: asString(row.description),
    assigned_to: asString(row.assigned_to) || undefined,
    due_date: asString(row.due_date) || undefined,
    status: asString(row.status, 'pending'),
    priority: asString(row.priority, 'normal'),
    metadata: asRecord(row.metadata),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
  }
}

function mapSupabaseNotification(row: DataRecord) {
  return {
    id: asString(row.id),
    profile_id: asString(row.profile_id),
    title: asString(row.title),
    message: asString(row.message),
    read: asBoolean(row.read, false),
    created_at: asString(row.created_at),
  }
}
