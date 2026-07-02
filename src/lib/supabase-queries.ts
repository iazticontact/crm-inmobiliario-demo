import { getSupabaseBrowserClient } from '@/lib/supabase'
import { buildCalendarEventTimes, type CalendarTimeInput } from '@/lib/calendar-time'
import { getErrorMessage, toError } from '@/lib/error-utils'
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
  metadata?: Record<string, unknown>
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
  clientId?: string | null
  propertyId?: string | null
  opportunityId?: string | null
  caseId?: string | null
  title: string
  type?: EventType
  clientName?: string
  location?: string
  notes?: string
  description?: string
  status?: string
  metadata?: Record<string, unknown>
}

export type CalendarEventsQueryOptions = {
  from?: string
  to?: string
  limit?: number
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

export type GoogleCalendarConnectionPayload = {
  calendarId?: string
  syncEnabled?: boolean
  lastSyncAt?: string | null
  status?: string
}

export type WhatsappConnectionPayload = {
  provider?: string
  phoneNumber?: string
  phoneNumberId?: string
  whatsappBusinessAccountId?: string
  metaBusinessId?: string
  status?: string
  webhookUrl?: string | null
  syncEnabled?: boolean
}

export type InboxAgentSettingsPayload = {
  autoReplyEnabled?: boolean
  mode?: string
  status?: string
}

export type AutomationWorkflowPayload = {
  name: string
  description?: string
  trigger?: string
  enabledInApp?: boolean
  n8nEvent?: string
  status?: string
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

function normalizeChannelKey(value: unknown): Channel {
  if (typeof value === 'string') {
    const normalized = value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (normalized === 'whatsapp' || normalized === 'wa') return 'whatsapp'
    if (normalized === 'instagram') return 'instagram'
    if (normalized === 'email' || normalized === 'mail') return 'email'
    if (normalized === 'internal' || normalized === 'crm' || normalized === 'copilot' || normalized === 'nowlabs') return 'crm'
    if (normalized === 'web' || normalized === 'inbox' || normalized === 'general') return 'web'
  }
  return 'web'
}

function inferAssistantMode(row: DataRecord): AssistantMode {
  const metadata = asRecord(row.metadata)
  const explicit =
    normalizeAssistantMode(row.assistant_mode) ||
    normalizeAssistantMode(metadata.assistant_mode) ||
    normalizeAssistantMode(metadata.mode)
  if (explicit) return explicit

  const channel = normalizeChannelKey(row.channel)
  const source = asString(metadata.source).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  if (channel === 'whatsapp' || source === 'whatsapp_inbound' || source === 'settings_simulator') {
    return 'inbox'
  }

  const marker = [
    asString(row.intent ?? row.intention),
    channel,
    asString(row.ai_summary),
  ].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  if (marker.includes('assistant_copilot') || marker.includes('copilot') || marker.includes('consulta crm') || marker.includes('consulta asistente ia') || marker.includes('asistente ia') || marker.includes('consulta nowlabs ai') || marker.includes('operacion comercial') || marker.includes('asistente interno') || marker.includes('crm')) {
    return 'copilot'
  }

  if (channel === 'crm' || channel === 'web') {
    return 'copilot'
  }

  return 'inbox'
}

function assistantIntentForMode(mode?: AssistantMode) {
  return mode === 'copilot' ? 'assistant_copilot' : 'assistant_inbox'
}

function assistantChannelForMode() {
  return 'crm'
}

function assistantChannelForPayload(mode: AssistantMode | undefined, channel: Channel) {
  if (mode === 'copilot') return assistantChannelForMode()
  const normalized = normalizeChannelKey(channel)
  return normalized === 'whatsapp' ? 'whatsapp' : 'web'
}

function isMissingColumn(error: unknown, column: string) {
  const message = getErrorMessage(error)
  return message.toLowerCase().includes(column.toLowerCase())
}

function isSchemaError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const e = error as Record<string, unknown>
  const code = String(e.code ?? '')
  if (code === 'PGRST204' || code === '42703') return true
  const msg = getErrorMessage(error).toLowerCase()
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

function removeSchemaProblemColumn(row: DataRecord, error: unknown, optionalColumns: string[]) {
  if (!isSchemaError(error)) return null
  const direct = optionalColumns.find((column) => Object.prototype.hasOwnProperty.call(row, column) && isMissingColumn(error, column))
  const fallback = optionalColumns.find((column) => Object.prototype.hasOwnProperty.call(row, column))
  const missing = direct || fallback
  if (!missing) return null
  const next = { ...row }
  delete next[missing]
  return next
}

function throwNormalized(error: unknown): never {
  throw toError(error)
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
  return normalizeChannelKey(value)
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
  if (value === 'demo') return 'visit' // legacy: "demo" era una visita a inmueble
  if (value === 'visit' || value === 'call' || value === 'meeting' || value === 'follow-up'
    || value === 'signing' || value === 'valuation' || value === 'other') return value
  return 'other'
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

function displayClientActivity(row: DataRecord) {
  const value = row.lastInteraction ?? row.updated_at ?? row.created_at
  if (!value) return 'Sin actividad registrada'
  return displayTime(value, 'Sin actividad registrada')
}

const CLIENT_COLUMNS = 'id, workspace_id, name, company, email, phone, channel, status, lead_score, notes, metadata, created_at, updated_at'
const MESSAGE_COLUMNS = 'id, workspace_id, conversation_id, sender, body, is_ai, created_at'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeQueryLimit(limit?: number) {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return undefined
  return Math.floor(limit)
}

export async function getCurrentUser() {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) throwNormalized(error)
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

// Workspace members for the "responsable" selector. Returns display-ready
// members (name/email/role) — never raw UUIDs to the UI. Scoped by RLS.
export type WorkspaceMember = { id: string; name: string; email: string | null; role: string | null }

export async function listWorkspaceProfiles(workspaceId: string): Promise<WorkspaceMember[]> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('workspace_id', workspaceId)
    .order('full_name', { ascending: true })
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[listWorkspaceProfiles]', error.message)
    return []
  }
  return ((data as DataRecord[] | null) ?? []).map((r) => {
    const fullName = asString(r.full_name)
    const email = asString(r.email) || null
    return {
      id: asString(r.id),
      name: fullName || (email ? email.split('@')[0] : '') || 'Miembro',
      email,
      role: asString(r.role) || null,
    }
  })
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

// ---------------------------------------------------------------------------
// Workspace identity cache (client-only) — S3 navigation performance.
//
// Every navigation used to re-resolve identity (auth.getUser -> profiles ->
// workspaces) independently from AuthGate, Sidebar/Topbar (useCurrentUser) and
// each page (getWorkspaceContext). On a VPS with latency to Supabase that is a
// chain of sequential round-trips per page, repeated 3-4x. This memoizes ONE
// resolution per browser session, shared by every consumer, with strict
// multi-tenant invalidation:
//   - cache is keyed by the resolved user.id and only stored for a real user;
//   - concurrent callers share a single in-flight promise (no thundering herd);
//   - a short TTL bounds staleness of profile/workspace *display* data only;
//   - onAuthStateChange clears the cache on SIGNED_OUT and whenever the live
//     session user differs from the cached one (login as another user);
//   - on the server (no window) the cache is bypassed entirely, so it can never
//     become a process-wide cache shared between users/requests.
// ---------------------------------------------------------------------------

export type ResolvedWorkspaceContext = {
  user: Awaited<ReturnType<typeof getCurrentUser>>
  profile: ProfileRecord | null
  workspace: WorkspaceRecord | null
  workspaceId: string | null
  resolvedWorkspaceId: string | null
  error: string | null
  profileLookupMethod: 'id' | 'email' | 'none'
  profileByIdError: string | null
  profileByEmailError: string | null
}

// Staleness bound for profile/workspace *display* data. Multi-tenant isolation
// does NOT depend on this value — it depends on the auth-event invalidation
// below. A full page reload always resolves from scratch.
const WORKSPACE_IDENTITY_TTL_MS = 120_000

let identityCache: { userId: string; value: ResolvedWorkspaceContext; at: number } | null = null
let identityPending: Promise<ResolvedWorkspaceContext> | null = null
let identityAuthSubscribed = false

/** Drop any cached identity. Call on logout (belt-and-suspenders alongside the
 *  auth-event listener) or after a profile/workspace edit that must reflect in
 *  the app chrome immediately. */
export function clearWorkspaceIdentityCache() {
  identityCache = null
  identityPending = null
}

function ensureIdentityInvalidation() {
  if (identityAuthSubscribed) return
  if (typeof window === 'undefined') return
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return
  identityAuthSubscribed = true
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      clearWorkspaceIdentityCache()
      return
    }
    // Never serve a cached identity whose user no longer matches the live
    // session (e.g. logout + login as a different user in the same tab).
    const sessionUserId = session?.user?.id ?? null
    if (identityCache && identityCache.userId !== sessionUserId) {
      clearWorkspaceIdentityCache()
    }
  })
}

async function resolveWorkspaceIdentityUncached(): Promise<ResolvedWorkspaceContext> {
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

/** Resolve `{ user, profile, workspace, workspaceId, ... }`. Cached per browser
 *  session (see notes above). Pass `{ force: true }` to bypass the cache. */
export async function getResolvedWorkspaceContext(options?: { force?: boolean }): Promise<ResolvedWorkspaceContext> {
  // Server-side: never use the module cache (it would be shared across users).
  if (typeof window === 'undefined') {
    return resolveWorkspaceIdentityUncached()
  }

  ensureIdentityInvalidation()

  const force = options?.force === true
  if (!force) {
    if (identityCache && Date.now() - identityCache.at < WORKSPACE_IDENTITY_TTL_MS) {
      return identityCache.value
    }
    if (identityPending) return identityPending
  }

  const pending = (async () => {
    const value = await resolveWorkspaceIdentityUncached()
    if (value.user) {
      identityCache = { userId: value.user.id, value, at: Date.now() }
    } else {
      // No real user (logged out / error): do not cache, so the next call
      // re-checks instead of pinning an unauthenticated result.
      identityCache = null
    }
    return value
  })()

  identityPending = pending
  try {
    return await pending
  } finally {
    if (identityPending === pending) identityPending = null
  }
}

export async function getWorkspaceContext(options?: { force?: boolean }) {
  const context = await getResolvedWorkspaceContext(options)
  if (!context.user) return null
  return { user: context.user, profile: context.profile, workspace: context.workspace }
}

export function mapSupabaseClient(row: DataRecord): Client {
  const name = asString(row.name ?? row.nombre ?? row.full_name, 'No consta')
  return {
    id: asString(row.id),
    name,
    company: asString(row.company ?? row.company_name ?? row.empresa ?? row.organization, 'No consta'),
    email: asString(row.email ?? row.correo ?? row.mail, 'No consta'),
    phone: asString(row.phone ?? row.telefono ?? row.phone_number ?? row.mobile, 'No consta'),
    channel: normalizeChannel(row.channel ?? row.canal),
    status: normalizeStatus(row.status ?? row.estado),
    leadScore: asNumber(row.lead_score ?? row.leadScore ?? row.score, 50),
    lastInteraction: displayClientActivity(row),
    avatar: asString(row.avatar, getInitials(name === 'No consta' ? 'C' : name)),
    notes: asString(row.notes ?? row.notas ?? row.description, 'No consta'),
    createdAt: asString(row.created_at ?? row.createdAt) || undefined,
    metadata: asRecord(row.metadata),
  }
}

function toClientRow(workspaceId: string, payload: ClientPayload): DataRecord {
  const row: DataRecord = {
    workspace_id: workspaceId,
    name: payload.name.trim(),
    company: payload.company?.trim() || null,
    email: payload.email.trim(),
    phone: payload.phone?.trim() || null,
    channel: payload.channel,
    status: payload.status,
    lead_score: payload.leadScore ?? 0,
    notes: payload.notes?.trim() || null,
  }
  if (payload.metadata) row.metadata = payload.metadata
  return row
}

export async function getClients(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
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
    .select(CLIENT_COLUMNS)
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
    .select(CLIENT_COLUMNS)
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
    if (!nextRow) throwNormalized(result.error)
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
    if (!nextPatch) throwNormalized(result.error)
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
    if (!nextPatch) throwNormalized(result.error)
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
    propertyId: asString(row.property_id) || undefined,
    opportunityId: asString(row.opportunity_id) || undefined,
    caseId: asString(row.case_id) || undefined,
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
    isReadOnly: row.is_read_only === true,
  }
}

function toCalendarEventRow(workspaceId: string, payload: CalendarEventPayload): DataRecord {
  const times = buildCalendarEventTimes(payload)
  const description = payload.description?.trim() || payload.notes?.trim() || null
  return {
    workspace_id: workspaceId,
    client_id: payload.clientId || null,
    // Vínculos CRM: solo se escriben si el payload los trae explícitamente (undefined → no se toca,
    // para no borrar relaciones en updates parciales como el reprogramado del Asistente).
    property_id: payload.propertyId === undefined ? undefined : (payload.propertyId || null),
    opportunity_id: payload.opportunityId === undefined ? undefined : (payload.opportunityId || null),
    case_id: payload.caseId === undefined ? undefined : (payload.caseId || null),
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

export async function getCalendarEvents(workspaceId: string, options?: CalendarEventsQueryOptions) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const limit = normalizeQueryLimit(options?.limit)
  let query = supabase
    .from('calendar_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .neq('status', 'cancelled')

  if (options?.from) query = query.gte('end_at', options.from)
  if (options?.to) query = query.lte('start_at', options.to)

  let orderedQuery = query.order('start_at', { ascending: true })
  if (limit) orderedQuery = orderedQuery.limit(limit)

  let result = await orderedQuery

  if (result.error && isSchemaError(result.error) && (isMissingColumn(result.error, 'start_at') || isMissingColumn(result.error, 'end_at'))) {
    let fallbackQuery = supabase
      .from('calendar_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .neq('status', 'cancelled')

    if (options?.from) fallbackQuery = fallbackQuery.gte('date', options.from.slice(0, 10))
    if (options?.to) fallbackQuery = fallbackQuery.lte('date', options.to.slice(0, 10))

    let orderedFallbackQuery = fallbackQuery.order('date', { ascending: true })
    if (limit) orderedFallbackQuery = orderedFallbackQuery.limit(limit)

    result = await orderedFallbackQuery
  }

  if (result.error) throwNormalized(result.error)
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

  const { data: deletedConv, error: deleteConversationError } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .select('id')

  if (deleteConversationError) throw deleteConversationError
  // Supabase returns empty array (no error) when RLS blocks the delete silently.
  // Throw so the caller can show a meaningful error instead of a ghost entry on reload.
  if (!deletedConv?.length) {
    throw new Error('La conversación no fue eliminada. Verifica que los permisos de Supabase (RLS) permitan el borrado para este workspace.')
  }
}

export async function getLatestClient(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
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
    .select(CLIENT_COLUMNS)
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

export async function getClientById(workspaceId: string, clientId: string) {
  return getClientDetail(workspaceId, clientId)
}

export async function getClientByName(workspaceId: string, name: string) {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return []
  const clients = await searchClients(workspaceId, normalized)
  return clients.filter((client) => client.name.toLowerCase().includes(normalized))
}

export async function getClientFullProfile(workspaceId: string, clientId: string) {
  return getClientDetail(workspaceId, clientId)
}

export async function getClientDetail(workspaceId: string, clientId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
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

// Per-client activity feed — scoped at the DB level by client_id OR client_name
// so it does not depend on the workspace-wide recent-activities limit (which can
// hide a specific client's history). Returns newest first.
export async function getClientActivityFeed(workspaceId: string, clientId: string, clientName?: string, limit = 20) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId) return [] as Activity[]
  const ors: string[] = []
  if (clientId) ors.push(`client_id.eq.${clientId}`)
  const term = (clientName ?? '').trim().replace(/[%,()]/g, '')
  if (term) ors.push(`client_name.ilike.%${term}%`)
  let query = supabase
    .from('activities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (ors.length) query = query.or(ors.join(','))
  const { data, error } = await query
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[getClientActivityFeed]', error.message)
    return [] as Activity[]
  }
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseActivity)
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

export async function getLatestClients(workspaceId: string, limit = 5) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseClient)
}

export async function getTopClientsByLeadScore(workspaceId: string, limit = 10) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('lead_score', { ascending: false })
    .limit(limit)

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseClient)
}

export async function getClientsByStatus(workspaceId: string, status: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('status', status)
    .order('lead_score', { ascending: false })
    .limit(50)

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseClient)
}

export async function getClientsByChannel(workspaceId: string, channel: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('channel', channel)
    .order('lead_score', { ascending: false })
    .limit(50)

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseClient)
}

export async function getOverdueInvoices(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'overdue')
    .order('due_date', { ascending: true })
    .limit(50)

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseInvoice)
}

export async function getHotLeads(workspaceId: string, minScore = 70) {
  const clients = await getClients(workspaceId).catch(() => [] as ReturnType<typeof mapSupabaseClient>[])
  return clients
    .filter((c) => c.leadScore >= minScore && (c.status === 'lead' || c.status === 'active'))
    .sort((a, b) => b.leadScore - a.leadScore)
}

export async function getPendingTasks(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return []
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseTask)
}

export async function getWorkspaceFullOverview(workspaceId: string) {
  const [clients, invoices, events, conversations, activities, tasks] = await Promise.all([
    getClients(workspaceId).catch(() => [] as ReturnType<typeof mapSupabaseClient>[]),
    getInvoices(workspaceId).catch(() => [] as ReturnType<typeof mapSupabaseInvoice>[]),
    getCalendarEvents(workspaceId).catch(() => [] as ReturnType<typeof mapSupabaseCalendarEvent>[]),
    getAssistantConversations(workspaceId).catch(() => []),
    getActivities(workspaceId).catch(() => [] as ReturnType<typeof mapSupabaseActivity>[]),
    listTasks(workspaceId).catch(() => [] as ReturnType<typeof mapSupabaseTask>[]),
  ])

  const now = new Date().toISOString()
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  return {
    totalClients: clients.length,
    activeClients: clients.filter((c) => c.status === 'active').length,
    leads: clients.filter((c) => c.status === 'lead').length,
    inactiveClients: clients.filter((c) => c.status === 'inactive').length,
    lostClients: clients.filter((c) => c.status === 'churned').length,
    topLeadScoreClients: clients.filter((c) => c.leadScore >= 70).sort((a, b) => b.leadScore - a.leadScore).slice(0, 5),
    recentClients: clients.filter((c) => c.createdAt && c.createdAt >= weekAgo).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 5),
    pendingInvoices: invoices.filter((i) => i.status === 'pending').length,
    overdueInvoices: invoices.filter((i) => i.status === 'overdue').length,
    paidInvoices: invoices.filter((i) => i.status === 'paid').length,
    upcomingEvents: events.filter((e) => (e.startAt ?? '') >= now).slice(0, 5),
    pendingTasks: tasks.filter((t) => t.status === 'pending').slice(0, 5),
    recentConversations: conversations.filter((c) => c.status !== 'resolved').slice(0, 5),
    recentActivities: activities.slice(0, 5),
  }
}

export async function getUpcomingCalendarEvents(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const nowIso = new Date().toISOString()
  let result = await supabase
    .from('calendar_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .neq('status', 'cancelled')
    .gte('start_at', nowIso)
    .order('start_at', { ascending: true })
    .limit(20)

  if (result.error && isSchemaError(result.error) && isMissingColumn(result.error, 'start_at')) {
    const today = todayIso()
    result = await supabase
      .from('calendar_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .neq('status', 'cancelled')
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(20)
  }

  if (result.error) throwNormalized(result.error)
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
  const optionalColumns = ['client_id', 'property_id', 'opportunity_id', 'case_id', 'client_name', 'date', 'start_hour', 'start_minute', 'duration', 'location', 'notes', 'description', 'metadata']

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const result = await supabase.from('calendar_events').insert(row).select('*').single()
    if (!result.error) return mapSupabaseCalendarEvent(result.data as DataRecord)
    const nextRow = removeMissingSchemaColumn(row, result.error, optionalColumns)
    if (!nextRow) throwNormalized(result.error)
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
  const optionalColumns = ['client_id', 'property_id', 'opportunity_id', 'case_id', 'client_name', 'date', 'start_hour', 'start_minute', 'duration', 'location', 'notes', 'description', 'metadata']

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

// Cancels a calendar event by setting status='cancelled'.
// Verifies that at least 1 row was affected. Falls back to hard delete if status column doesn't exist.
// Throws if 0 rows affected after both attempts — never silently reports success on a no-op.
export async function cancelCalendarEvent(id: string, workspaceId?: string): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  // Attempt 1: UPDATE status='cancelled', using .select('id') to count affected rows
  let uq = supabase.from('calendar_events').update({ status: 'cancelled' }).eq('id', id)
  if (workspaceId) uq = uq.eq('workspace_id', workspaceId)
  const { data: updData, error: updError } = await uq.select('id')

  if (!updError && updData && updData.length > 0) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[cancelCalendarEvent] update ok', { id, rowsAffected: updData.length, operation: 'update' })
    }
    return
  }

  // Attempt 2: DELETE — fallback when status column doesn't exist or update matched 0 rows
  if (process.env.NODE_ENV === 'development') {
    console.log('[cancelCalendarEvent] update insufficient, trying delete', {
      id, updateError: updError?.message ?? null, updateRows: updData?.length ?? 0,
    })
  }
  let dq = supabase.from('calendar_events').delete().eq('id', id)
  if (workspaceId) dq = dq.eq('workspace_id', workspaceId)
  const { data: delData, error: delError } = await dq.select('id')

  if (delError) throw delError

  const deleted = delData?.length ?? 0
  if (process.env.NODE_ENV === 'development') {
    console.log('[cancelCalendarEvent] delete result', { id, rowsAffected: deleted, operation: 'delete', success: deleted > 0 })
  }
  if (deleted === 0) {
    throw new Error(`No se pudo cancelar el evento ${id}: no se encontró en la base de datos (0 filas afectadas).`)
  }
}

export function mapSupabaseConversation(row: DataRecord): Conversation {
  const metadata = asRecord(row.metadata)
  const assistantMode = inferAssistantMode(row)
  const metadataTitle = typeof metadata.title === 'string' && metadata.title ? metadata.title : undefined
  const metadataClientName = typeof metadata.clientName === 'string' && metadata.clientName ? metadata.clientName : undefined
  const clientName = asString(row.client_name) || metadataTitle || metadataClientName || asString(row.title ?? row.name, '') || (assistantMode === 'copilot' ? 'Consulta Asistente IA' : 'Conversacion cliente')
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
  const title = payload.clientName || (assistantMode === 'copilot' ? 'Consulta Asistente IA' : 'Conversacion Inbox Assistant')
  return {
    workspace_id: workspaceId,
    channel: assistantChannelForPayload(assistantMode, payload.channel),
    status: payload.status || 'open',
    sentiment: payload.sentiment || 'neutral',
    intent: assistantIntentForMode(assistantMode),
    ai_summary: payload.lastMessage || (assistantMode === 'copilot' ? 'Consulta Asistente IA' : 'Conversacion Inbox Assistant'),
    metadata: { ...metadataBase, assistant_mode: assistantMode, title, clientName: title, clientId: payload.clientId || null, clientAvatar: payload.clientAvatar || null, unread: payload.unread ?? false },
    created_at: new Date().toISOString(),
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

  let row = toConversationRow(workspaceId, payload)
  const optionalColumns = ['channel', 'status', 'sentiment', 'intent', 'ai_summary', 'metadata', 'created_at', 'updated_at']

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const { data, error } = await supabase
      .from('conversations')
      .insert(row)
      .select('*')
      .single()

    if (!error) return mapSupabaseConversation(data as DataRecord)

    const next = removeSchemaProblemColumn(row, error, optionalColumns)
    if (!next) throwNormalized(error)
    row = next
  }

  throw new Error('No se pudo crear la conversacion con el schema disponible.')
}

export async function createAssistantConversation(workspaceId: string, mode: AssistantMode, input: Partial<ConversationPayload> = {}) {
  const isCopilot = mode === 'copilot'
  return createConversation(workspaceId, {
    clientName: input.clientName || (isCopilot ? 'Consulta Asistente IA' : 'Nueva conversacion'),
    clientAvatar: input.clientAvatar || (isCopilot ? 'CRM' : 'IN'),
    channel: input.channel || (isCopilot ? 'crm' : 'web'),
    sentiment: input.sentiment || 'neutral',
    intent: input.intent || assistantIntentForMode(mode),
    lastMessage: input.lastMessage || (isCopilot ? 'Consulta Asistente IA' : 'Conversacion Inbox Assistant'),
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
    metadata: {},
    createdAt: asString(row.created_at) || undefined,
  }
}

export async function getConversationMessages(conversationId: string, workspaceId?: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  let query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
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

  const dbSender = payload.sender === 'ai' ? 'ai' : payload.sender === 'agent' ? 'agent' : 'client'
  let row: DataRecord = {
    conversation_id: conversationId,
    workspace_id: workspaceId,
    sender: dbSender,
    body: payload.content.trim(),
    is_ai: payload.sender === 'ai',
    created_at: new Date().toISOString(),
  }
  const optionalColumns = ['created_at', 'is_ai']

  for (let attempt = 0; attempt <= optionalColumns.length + 1; attempt += 1) {
    const result = await supabase
      .from('messages')
      .insert(row)
      .select('*')
      .single()

    if (!result.error) return mapSupabaseMessage(result.data as DataRecord)

    if (isSchemaError(result.error) && isMissingColumn(result.error, 'body') && 'body' in row) {
      row = { ...row, message: row.body }
      delete row.body
      continue
    }

    const next = removeSchemaProblemColumn(row, result.error, optionalColumns)
    if (!next) throwNormalized(result.error)
    row = next
  }

  throw new Error('No se pudo guardar el mensaje con el schema disponible.')
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

// NOTA (P37/P38): no existe tabla `documents` en esta BD. Los documentos por entidad viven en
// `entity_files` (ver EntityDocumentsManager / entity-files.ts). Aquí solo quedan los helpers de STORAGE
// (subir a un bucket + firmar URL) que usa el generador de PDF del Asistente; NO se escribe en ninguna
// tabla `documents`. Los antiguos list/create/mapSupabaseDocument se eliminaron por apuntar a esa tabla.

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

// Sube el PDF generado (informe/factura del Asistente) a su bucket de Storage y devuelve la ubicación.
// Ya NO escribe en la tabla `documents` (inexistente). `doc.id` se mantiene por compatibilidad de firma con
// los llamantes, pero es null (el enlace se firma a partir de bucket/path). `_workspaceId` se conserva en la
// firma para no romper las llamadas posicionales.
export async function saveGeneratedDocument(_workspaceId: string, payload: DocumentPayload, content: string | Uint8Array | Blob) {
  const uploaded = await uploadDocumentToStorage(payload.storageBucket, payload.storagePath, content, payload.mimeType)
  return { uploaded, doc: { id: null as string | null } }
}

function requiresFromRow(row: DataRecord): N8nRequirement[] {
  const legacy = asRequirements(row.requires ?? row.requirements)
  if (legacy.length) return legacy
  const out: N8nRequirement[] = []
  if (row.requires_supabase === true) out.push('Supabase')
  if (row.requires_whatsapp === true) out.push('WhatsApp/API')
  if (row.requires_payment_api === true) out.push('Payment/API')
  if (!out.length) out.push('n8n')
  return out
}

export function mapSupabaseN8nFlow(row: DataRecord): N8nFlow {
  const event = asString(row.trigger_event ?? row.event ?? row.event_type ?? row.name, 'custom_flow')
  return {
    id: asString(row.id, event),
    event,
    label: asString(row.name ?? row.label, event),
    description: asString(row.description, 'Flujo preparado para n8n.'),
    trigger: asString(row.trigger_event ?? row.trigger, 'Evento del CRM'),
    webhookUrl: asString(row.webhook_url ?? row.endpoint ?? row.url),
    status: normalizeN8nFlowStatus(row.status ?? (row.enabled === true ? 'active' : undefined)),
    requires: requiresFromRow(row),
    updatedAt: asString(row.updated_at ?? row.created_at) || undefined,
  }
}

function toN8nFlowRow(workspaceId: string, payload: N8nFlowPayload): DataRecord {
  const requires = payload.requires || ['Supabase', 'n8n']
  const name = payload.label || payload.event
  return {
    workspace_id: workspaceId,
    name,
    trigger_event: payload.event,
    description: payload.description || null,
    webhook_url: payload.webhookUrl || null,
    status: normalizeN8nFlowStatus(payload.status),
    requires_supabase: requires.includes('Supabase'),
    requires_whatsapp: requires.includes('WhatsApp/API'),
    requires_payment_api: requires.includes('Payment/API') || requires.includes('Billing/API'),
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
    .eq('trigger_event', payload.event)
    .maybeSingle()

  const row = toN8nFlowRow(workspaceId, payload)

  if (existing.data) {
    delete row.workspace_id
    delete row.trigger_event
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
    name: payload.label,
    description: payload.description,
    webhook_url: payload.webhookUrl,
    status: payload.status ? normalizeN8nFlowStatus(payload.status) : undefined,
  }
  if (payload.requires) {
    row.requires_supabase = payload.requires.includes('Supabase')
    row.requires_whatsapp = payload.requires.includes('WhatsApp/API')
    row.requires_payment_api = payload.requires.includes('Payment/API') || payload.requires.includes('Billing/API')
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
  const config = asRecord(row.config)
  const key = asString(row.provider ?? row.key ?? row.slug ?? row.name ?? config.key, 'integration')
  return {
    id: asString(row.id, key),
    key,
    name: asString(row.name ?? row.label, key),
    description: asString(row.description ?? config.description, 'Integracion preparada para la fase real.'),
    status: normalizeIntegrationStatus(row.status),
    category: asString(row.category ?? config.category, 'Sistema'),
    info: asString(row.info ?? config.info ?? row.public_label) || undefined,
  }
}

function toIntegrationRow(workspaceId: string, payload: IntegrationPayload): DataRecord {
  return {
    workspace_id: workspaceId,
    provider: payload.key,
    name: payload.name,
    status: normalizeIntegrationStatus(payload.status),
    config: {
      description: payload.description || null,
      category: payload.category || 'Sistema',
      info: payload.info || null,
    },
  }
}

export async function getIntegrationSettings(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('vw_integrations_status')
    .select('id, workspace_id, provider, name, status, created_at, updated_at')
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
    .select('id, workspace_id, provider, phone_number, phone_number_id, whatsapp_business_account_id, meta_business_id, connection_status, webhook_url, last_webhook_at, created_at, updated_at')
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
    .select('id, workspace_id, enabled, mode, agent_name, auto_reply_enabled, handoff_enabled, business_context, tone, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error) {
    if (isSchemaError(error)) return null
    throw error
  }
  return data as DataRecord | null
}

export async function getGoogleCalendarConnection(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('vw_google_calendar_status')
    .select('id, workspace_id, calendar_id, default_calendar_id, status, sync_enabled, has_refresh_token, last_sync_at, updated_at, selected_calendar_ids, calendar_metadata')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error) {
    if (isSchemaError(error)) return null
    throw error
  }
  return data as DataRecord | null
}

export async function upsertGoogleCalendarConnection(workspaceId: string, payload: GoogleCalendarConnectionPayload) {
  const selectedCalendarIds = [payload.calendarId || 'primary']
  const res = await fetch('/api/integrations/google/calendar/save-selected-calendars', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedCalendarIds, syncEnabled: payload.syncEnabled }),
  })
  let body: { ok?: boolean; error?: string } | null = null
  try { body = await res.json() } catch { /* ignore */ }
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error ?? `Google Calendar HTTP ${res.status}`)
  }
  return getGoogleCalendarConnection(workspaceId)
}

export async function disconnectGoogleCalendar(_workspaceId: string) {
  // Calls the server-side disconnect endpoint, which:
  //   - revokes the refresh_token at Google (best-effort)
  //   - clears refresh_token_enc, calendar_id, selected_calendar_ids, calendar_metadata
  //   - marks status='disconnected'
  // The browser can't safely revoke or use the service_role, so we delegate to /api.
  // workspace_id is resolved server-side from the authenticated user's profile.
  void _workspaceId
  const res = await fetch('/api/integrations/google/calendar/disconnect', { method: 'POST' })
  let data: { ok?: boolean; error?: string; revoked?: string } | null = null
  try { data = await res.json() } catch { /* ignore body parse errors */ }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? `Disconnect HTTP ${res.status}`)
  }
}

export async function upsertWhatsappConnection(workspaceId: string, payload: WhatsappConnectionPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row: DataRecord = compactRow({
    workspace_id: workspaceId,
    provider: payload.provider ?? 'meta',
    phone_number: payload.phoneNumber ?? null,
    phone_number_id: payload.phoneNumberId ?? null,
    whatsapp_business_account_id: payload.whatsappBusinessAccountId ?? null,
    meta_business_id: payload.metaBusinessId ?? null,
    connection_status: payload.status ?? 'pending',
    webhook_url: payload.webhookUrl ?? null,
    sync_enabled: payload.syncEnabled ?? false,
    updated_at: new Date().toISOString(),
  })

  const existing = await supabase
    .from('whatsapp_connections')
    .select('id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (existing.data) {
    const { data, error } = await supabase
      .from('whatsapp_connections')
      .update(row)
      .eq('id', asString((existing.data as DataRecord).id))
      .select('*')
      .single()
    if (error) { if (isSchemaError(error)) return null; throw error }
    return data as DataRecord
  }

  const { data, error } = await supabase
    .from('whatsapp_connections')
    .insert(row)
    .select('*')
    .single()
  if (error) { if (isSchemaError(error)) return null; throw error }
  return data as DataRecord
}

export async function disconnectWhatsapp(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { error } = await supabase
    .from('whatsapp_connections')
    .update({ connection_status: 'disconnected', sync_enabled: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)

  if (error && !isSchemaError(error)) throw error
}

export async function upsertInboxAgentSettings(workspaceId: string, payload: InboxAgentSettingsPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row: DataRecord = compactRow({
    workspace_id: workspaceId,
    auto_reply_enabled: payload.autoReplyEnabled ?? false,
    mode: payload.mode ?? 'manual',
    enabled: payload.status ? payload.status === 'active' : true,
    updated_at: new Date().toISOString(),
  })

  const existing = await supabase
    .from('inbox_agent_settings')
    .select('id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (existing.data) {
    const { data, error } = await supabase
      .from('inbox_agent_settings')
      .update(row)
      .eq('id', asString((existing.data as DataRecord).id))
      .select('*')
      .single()
    if (error) { if (isSchemaError(error)) return null; throw error }
    return data as DataRecord
  }

  const { data, error } = await supabase
    .from('inbox_agent_settings')
    .insert(row)
    .select('*')
    .single()
  if (error) { if (isSchemaError(error)) return null; throw error }
  return data as DataRecord
}

export async function getAutomationWorkflows(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('automation_workflows')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (error) {
    if (isSchemaError(error)) return []
    throw error
  }
  return (data as DataRecord[] | null) ?? []
}

export async function upsertAutomationWorkflow(workspaceId: string, payload: AutomationWorkflowPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row: DataRecord = compactRow({
    workspace_id: workspaceId,
    name: payload.name,
    description: payload.description ?? null,
    trigger: payload.trigger ?? null,
    enabled_in_app: payload.enabledInApp ?? false,
    n8n_event: payload.n8nEvent ?? null,
    status: payload.status ?? 'active',
    updated_at: new Date().toISOString(),
  })

  const existing = await supabase
    .from('automation_workflows')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('name', payload.name)
    .maybeSingle()

  if (existing.data) {
    const { data, error } = await supabase
      .from('automation_workflows')
      .update(row)
      .eq('id', asString((existing.data as DataRecord).id))
      .select('*')
      .single()
    if (error) { if (isSchemaError(error)) return null; throw error }
    return data as DataRecord
  }

  const { data, error } = await supabase
    .from('automation_workflows')
    .insert(row)
    .select('*')
    .single()
  if (error) { if (isSchemaError(error)) return null; throw error }
  return data as DataRecord
}

export async function toggleAutomationWorkflow(workspaceId: string, id: string, enabled: boolean) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('automation_workflows')
    .update({ enabled_in_app: enabled, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()

  if (error) {
    if (isSchemaError(error)) return null
    throw error
  }
  return data as DataRecord
}

export async function upsertIntegrationSetting(workspaceId: string, payload: IntegrationPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const existing = await supabase
    .from('vw_integrations_status')
    .select('id, workspace_id, provider, name, status, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('provider', payload.key)
    .maybeSingle()

  const row = toIntegrationRow(workspaceId, payload)

  if (existing.data) {
    delete row.workspace_id
    delete row.provider
    const { error } = await supabase
      .from('integrations')
      .update(row)
      .eq('id', asString((existing.data as DataRecord).id))

    if (error) throw error
    return mapSupabaseIntegrationSetting({ ...(existing.data as DataRecord), ...row, provider: payload.key })
  }

  const { error } = await supabase
    .from('integrations')
    .insert(row)

  if (error) throw error
  const { data: created, error: readErr } = await supabase
    .from('vw_integrations_status')
    .select('id, workspace_id, provider, name, status, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('provider', payload.key)
    .maybeSingle()

  if (readErr) throw readErr
  return mapSupabaseIntegrationSetting((created as DataRecord | null) ?? row)
}

export async function updateIntegrationSetting(id: string, payload: Partial<IntegrationPayload>) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row: DataRecord = {
    name: payload.name,
    status: payload.status ? normalizeIntegrationStatus(payload.status) : undefined,
  }
  if (payload.description !== undefined || payload.category !== undefined || payload.info !== undefined) {
    row.config = {
      description: payload.description ?? null,
      category: payload.category ?? 'Sistema',
      info: payload.info ?? null,
    }
  }
  Object.keys(row).forEach((key) => {
    if (row[key] === undefined) delete row[key]
  })

  const { error } = await supabase
    .from('integrations')
    .update(row)
    .eq('id', id)

  if (error) throw error

  const { data, error: readErr } = await supabase
    .from('vw_integrations_status')
    .select('id, workspace_id, provider, name, status, created_at, updated_at')
    .eq('id', id)
    .maybeSingle()

  if (readErr) throw readErr
  return mapSupabaseIntegrationSetting((data as DataRecord | null) ?? { id, ...row })
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
    if (!nextRow) throwNormalized(result.error)
    insertRow = nextRow
  }

  throw new Error('No se pudo crear la tarea con el schema disponible')
}

export type UpdateTaskInput = {
  title?: string
  description?: string | null
  status?: string
  priority?: string
  dueDate?: string | null
  assignedTo?: string | null
}

// La columna tasks.status solo admite 'pending' | 'done' (constraint tasks_status_check).
// Normalizamos sinonimos habituales de "completada"/"pendiente" para que un 'completed'
// (u otra variante) no rompa el guardado con un error de constraint poco util.
export function normalizeTaskStatus(status: string): string {
  const s = status.trim().toLowerCase()
  if (['done', 'completed', 'complete', 'closed', 'finished', 'completada', 'finalizada', 'hecha'].includes(s)) return 'done'
  if (['pending', 'open', 'todo', 'pendiente', 'abierta'].includes(s)) return 'pending'
  return status
}

export async function updateTask(workspaceId: string, id: string, input: UpdateTaskInput) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !id) return null
  const patch: Record<string, unknown> = {}
  if (typeof input.title === 'string' && input.title.trim()) patch.title = input.title.trim()
  if (input.description !== undefined) patch.description = input.description
  if (input.status) patch.status = normalizeTaskStatus(input.status)
  if (input.priority) patch.priority = input.priority
  if (input.dueDate !== undefined) patch.due_date = input.dueDate
  if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()
  // Antes se tragaba el error y se devolvia null -> el toast no podia explicar la causa.
  // Ahora propagamos un Error normalizado para que la UI muestre el motivo real.
  if (error) throwNormalized(error)
  return mapSupabaseTask(data as DataRecord)
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
