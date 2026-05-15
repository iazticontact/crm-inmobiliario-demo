import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

type Provider = 'meta' | 'test'
type AuthMode = 'webhook_secret' | 'user_session'
type DataRecord = Record<string, unknown>

type WhatsappInboundPayload = {
  workspaceId?: string
  provider?: string
  phone?: string
  phoneNumberId?: string
  customerName?: string
  customerEmail?: string
  message?: string
  externalConversationId?: string
  externalMessageId?: string
  timestamp?: string
  metadata?: Record<string, unknown>
}

type NormalizedInboundPayload = {
  workspaceId?: string
  provider: Provider
  phone: string
  phoneNumberId?: string
  customerName?: string
  customerEmail?: string
  message: string
  externalConversationId?: string
  externalMessageId?: string
  timestamp: string
  metadata: Record<string, unknown>
}

type SafeErrorShape = {
  message: string
  code?: string
  details?: string
  hint?: string
  status?: number
  rawType: string
}

type JsonErrorExtra = {
  workspaceId?: string | null
  provider?: string | null
  phone?: string | null
  authMode?: AuthMode | 'none' | null
  [key: string]: unknown
}

function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
}

function serviceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
}

function webhookSecret() {
  return process.env.NOWCRM_WEBHOOK_SECRET?.trim()
}

function createAdminSupabaseClient() {
  const url = supabaseUrl()
  const serviceKey = serviceRoleKey()
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function asRecord(value: unknown): DataRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : {}
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function safeError(error: unknown): SafeErrorShape {
  if (!error) return { message: 'Unknown error', rawType: 'unknown' }
  if (typeof error === 'string') return { message: error, rawType: 'string' }
  if (error instanceof Error) return { message: error.message, rawType: error.name || 'Error' }
  if (typeof error === 'object') {
    const record = error as DataRecord
    return {
      message: asString(record.message, 'Unknown error'),
      code: asString(record.code) || undefined,
      details: asString(record.details) || undefined,
      hint: asString(record.hint) || undefined,
      status: typeof record.status === 'number' ? record.status : undefined,
      rawType: Object.prototype.toString.call(error),
    }
  }
  return { message: String(error), rawType: typeof error }
}

function jsonError(step: string, status: number, message: string, error?: unknown, extra: JsonErrorExtra = {}) {
  const normalized = safeError(error ?? message)

  if (process.env.NODE_ENV === 'development') {
    console.error('[whatsapp-inbound]', {
      step,
      workspaceId: extra.workspaceId ?? null,
      provider: extra.provider ?? null,
      phone: extra.phone ?? null,
      authMode: extra.authMode ?? 'none',
      error: normalized,
    })
  }

  return NextResponse.json({
    ok: false,
    step,
    error: message,
    message,
    code: normalized.code,
    details: normalized.details,
    hint: normalized.hint,
    status: normalized.status ?? status,
    rawType: normalized.rawType,
  }, { status })
}

function isSchemaError(error: unknown) {
  const normalized = safeError(error)
  const code = normalized.code ?? ''
  const message = normalized.message.toLowerCase()
  return code === 'PGRST204' ||
    code === '42703' ||
    message.includes('schema cache') ||
    message.includes('could not find') ||
    message.includes('column')
}

function missingColumn(error: unknown) {
  const text = [
    safeError(error).message,
    safeError(error).details,
    safeError(error).hint,
  ].filter(Boolean).join(' ')

  const quoted = text.match(/'([^']+)'/)
  if (quoted?.[1]) return quoted[1]
  const column = text.match(/column\s+([a-zA-Z0-9_]+)/i)
  return column?.[1] ?? null
}

function preview(value: string, max = 300) {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean
}

function validateTimestamp(value?: string) {
  if (!value) return new Date().toISOString()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function normalizePayload(raw: WhatsappInboundPayload): NormalizedInboundPayload | { error: string } {
  const provider = asString(raw.provider)
  if (provider !== 'meta' && provider !== 'test') {
    return { error: 'provider es requerido y debe ser meta o test.' }
  }

  const phone = asString(raw.phone)
  if (!phone) return { error: 'phone es requerido.' }

  const message = asString(raw.message)
  if (!message) return { error: 'message es requerido.' }

  const timestamp = validateTimestamp(raw.timestamp)
  if (!timestamp) return { error: 'timestamp no es valido.' }

  const metadata = asRecord(raw.metadata)
  return {
    workspaceId: asString(raw.workspaceId) || undefined,
    provider,
    phone,
    phoneNumberId: asString(raw.phoneNumberId) || undefined,
    customerName: asString(raw.customerName) || undefined,
    customerEmail: asString(raw.customerEmail).toLowerCase() || undefined,
    message,
    externalConversationId: asString(raw.externalConversationId) || undefined,
    externalMessageId: asString(raw.externalMessageId) || undefined,
    timestamp,
    metadata,
  }
}

function readAuthMode(request: Request): { authMode: AuthMode; token?: string } | null {
  const expectedSecret = webhookSecret()
  const providedSecret = request.headers.get('x-nowcrm-webhook-secret')?.trim()
  if (expectedSecret && providedSecret && providedSecret === expectedSecret) {
    return { authMode: 'webhook_secret' }
  }

  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (match?.[1]?.trim()) {
    return { authMode: 'user_session', token: match[1].trim() }
  }

  return null
}

async function validateUserToken(admin: SupabaseClient, token: string) {
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw error ?? new Error('Token invalido o expirado.')
  return data.user
}

async function authorizeWorkspace(admin: SupabaseClient, workspaceId: string, user: { id: string; email?: string | null }) {
  const { data, error } = await admin
    .from('profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .limit(100)

  if (error) throw error

  const email = user.email?.toLowerCase() ?? ''
  const rows = (data as DataRecord[] | null) ?? []
  return rows.some((row) =>
    asString(row.id) === user.id ||
    asString(row.user_id) === user.id ||
    (email && asString(row.email).toLowerCase() === email)
  )
}

async function resolveWorkspace(admin: SupabaseClient, payload: NormalizedInboundPayload, authMode: AuthMode) {
  if (payload.workspaceId) return payload.workspaceId
  if (authMode !== 'webhook_secret') return null

  // Primary: resolve by phone_number_id (Meta's business phone number ID — identifies the workspace)
  if (payload.phoneNumberId) {
    const { data, error } = await admin
      .from('whatsapp_connections')
      .select('workspace_id')
      .eq('phone_number_id', payload.phoneNumberId)
      .maybeSingle()
    if (error) throw error
    const wsId = asString((data as DataRecord | null)?.workspace_id)
    if (wsId) return wsId
  }

  // Fallback: resolve by phone_number (business phone, not customer phone)
  const { data, error } = await admin
    .from('whatsapp_connections')
    .select('workspace_id')
    .eq('phone_number', payload.phone)
    .maybeSingle()

  if (error) throw error
  return asString((data as DataRecord | null)?.workspace_id) || null
}

async function getRecentConversationRows(admin: SupabaseClient, workspaceId: string) {
  let result = await admin
    .from('conversations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (result.error && isSchemaError(result.error)) {
    result = await admin
      .from('conversations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .limit(50)
  }

  if (result.error) throw result.error
  return (result.data as DataRecord[] | null) ?? []
}

async function findConversation(admin: SupabaseClient, workspaceId: string, payload: NormalizedInboundPayload) {
  const rows = await getRecentConversationRows(admin, workspaceId)
  const whatsappRows = rows.filter((row) => {
    const channel = asString(row.channel).toLowerCase()
    return !channel || channel === 'whatsapp' || channel === 'test' || channel === 'web'
  })

  if (payload.externalConversationId) {
    const byExternalId = whatsappRows.find((row) => asString(asRecord(row.metadata).externalConversationId) === payload.externalConversationId)
    if (byExternalId) return byExternalId
  }

  return whatsappRows.find((row) => asString(asRecord(row.metadata).phone) === payload.phone) ?? null
}

async function insertConversationWithFallback(admin: SupabaseClient, row: DataRecord) {
  const optionalColumns = ['client_name', 'client_avatar', 'channel', 'status', 'sentiment', 'intent', 'ai_summary', 'unread', 'metadata', 'updated_at', 'created_at']
  const current = { ...row }

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const { data, error } = await admin.from('conversations').insert(current).select('*').single()
    if (!error) return data as DataRecord
    if (!isSchemaError(error)) throw error

    const column = missingColumn(error)
    const nextColumn = column && column in current ? column : optionalColumns.find((key) => key in current)
    if (!nextColumn) throw error
    delete current[nextColumn]
  }

  throw new Error('No se pudo crear conversation con el schema disponible.')
}

async function updateConversationBestEffort(admin: SupabaseClient, workspaceId: string, conversation: DataRecord, patch: DataRecord) {
  const id = asString(conversation.id)
  if (!id) return

  const optionalColumns = ['client_name', 'status', 'intent', 'ai_summary', 'unread', 'metadata', 'updated_at']
  const current = { ...patch }

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const { error } = await admin
      .from('conversations')
      .update(current)
      .eq('id', id)
      .eq('workspace_id', workspaceId)

    if (!error) return
    if (!isSchemaError(error)) throw error

    const column = missingColumn(error)
    const nextColumn = column && column in current ? column : optionalColumns.find((key) => key in current)
    if (!nextColumn) throw error
    delete current[nextColumn]
  }
}

async function createConversation(admin: SupabaseClient, workspaceId: string, payload: NormalizedInboundPayload) {
  const now = new Date().toISOString()
  const customerLabel = payload.customerName || payload.phone
  const summary = preview(payload.message)
  const metadata = {
    ...payload.metadata,
    assistant_mode: 'inbox',
    source: 'whatsapp_inbound',
    provider: payload.provider,
    phone: payload.phone,
    title: customerLabel,
    clientName: customerLabel,
    customerName: payload.customerName,
    customerEmail: payload.customerEmail,
    externalConversationId: payload.externalConversationId,
    lastInboundAt: payload.timestamp,
    lastMessagePreview: summary,
    lastExternalMessageId: payload.externalMessageId,
  }

  const row = await insertConversationWithFallback(admin, {
    workspace_id: workspaceId,
    client_name: customerLabel,
    client_avatar: customerLabel.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'WA',
    channel: 'whatsapp',
    status: 'open',
    sentiment: 'neutral',
    intent: 'assistant_inbox',
    ai_summary: summary,
    unread: true,
    metadata,
    created_at: now,
    updated_at: now,
  })

  return row
}

async function updateExistingConversation(admin: SupabaseClient, workspaceId: string, conversation: DataRecord, payload: NormalizedInboundPayload) {
  const summary = preview(payload.message)
  const existingMetadata = asRecord(conversation.metadata)
  const mergedMetadata = {
    ...existingMetadata,
    ...payload.metadata,
    assistant_mode: 'inbox',
    source: 'whatsapp_inbound',
    provider: payload.provider,
    phone: payload.phone,
    title: asString(existingMetadata.title, payload.customerName || payload.phone),
    clientName: asString(existingMetadata.clientName, payload.customerName || payload.phone),
    customerName: payload.customerName ?? existingMetadata.customerName,
    customerEmail: payload.customerEmail ?? existingMetadata.customerEmail,
    externalConversationId: payload.externalConversationId ?? existingMetadata.externalConversationId,
    lastInboundAt: payload.timestamp,
    lastMessagePreview: summary,
    lastExternalMessageId: payload.externalMessageId,
  }

  await updateConversationBestEffort(admin, workspaceId, conversation, {
    client_name: asString(conversation.client_name, payload.customerName || payload.phone),
    status: 'open',
    intent: 'assistant_inbox',
    ai_summary: summary,
    unread: true,
    metadata: mergedMetadata,
    updated_at: new Date().toISOString(),
  })
}

async function insertMessage(admin: SupabaseClient, workspaceId: string, conversationId: string, payload: NormalizedInboundPayload) {
  const base: DataRecord = {
    workspace_id: workspaceId,
    conversation_id: conversationId,
    sender: 'client',
    body: payload.message,
    is_ai: false,
    metadata: {
      direction: 'inbound',
      provider: payload.provider,
      phone: payload.phone,
      externalMessageId: payload.externalMessageId,
      timestamp: payload.timestamp,
      customerName: payload.customerName,
      customerEmail: payload.customerEmail,
      source: 'whatsapp_inbound',
    },
    created_at: payload.timestamp,
  }

  const optionalColumns = ['metadata', 'created_at', 'is_ai']
  let current = { ...base }

  for (let attempt = 0; attempt <= optionalColumns.length + 1; attempt += 1) {
    const { data, error } = await admin.from('messages').insert(current).select('id').single()
    if (!error) {
      const id = asString((data as DataRecord | null)?.id)
      if (!id) throw new Error('Message insert succeeded but did not return id.')
      return id
    }

    if (!isSchemaError(error)) throw error

    const column = missingColumn(error)
    if (column === 'body' && 'body' in current) {
      current = { ...current, message: current.body }
      delete current.body
      continue
    }

    const nextColumn = column && column in current ? column : optionalColumns.find((key) => key in current)
    if (!nextColumn) throw error
    delete current[nextColumn]
  }

  throw new Error('No se pudo crear message con el schema disponible.')
}

async function createActivityBestEffort(admin: SupabaseClient, workspaceId: string, payload: NormalizedInboundPayload) {
  const description = preview(payload.message, 180)
  const row: DataRecord = {
    workspace_id: workspaceId,
    type: 'whatsapp_message_inbound',
    title: 'Mensaje WhatsApp recibido',
    description,
    client_name: payload.customerName || payload.phone,
    metadata: {
      source: 'whatsapp_inbound',
      provider: payload.provider,
      phone: payload.phone,
      direction: 'inbound',
      externalMessageId: payload.externalMessageId,
    },
  }

  const optionalColumns = ['title', 'client_name', 'metadata']
  const current = { ...row }

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const { error } = await admin.from('activities').insert(current)
    if (!error) return
    if (!isSchemaError(error)) throw error

    const column = missingColumn(error)
    const nextColumn = column && column in current ? column : optionalColumns.find((key) => key in current)
    if (!nextColumn) throw error
    delete current[nextColumn]
  }
}

export async function POST(request: Request) {
  let rawBody: WhatsappInboundPayload

  try {
    rawBody = await request.json() as WhatsappInboundPayload
  } catch (error) {
    return jsonError('parse_payload', 400, 'Payload JSON invalido.', error)
  }

  const normalized = normalizePayload(rawBody)
  if ('error' in normalized) {
    return jsonError('validate_payload', 400, normalized.error, undefined, {
      workspaceId: rawBody.workspaceId,
      provider: rawBody.provider,
      phone: rawBody.phone,
    })
  }

  const admin = createAdminSupabaseClient()
  if (!admin) {
    return jsonError('server_config', 500, 'Supabase service role no esta configurado en el backend.', undefined, {
      workspaceId: normalized.workspaceId,
      provider: normalized.provider,
      phone: normalized.phone,
    })
  }

  const auth = readAuthMode(request)
  if (!auth) {
    return jsonError('authorize_request', 401, 'No autorizado. Usa x-nowcrm-webhook-secret o Authorization Bearer.', undefined, {
      workspaceId: normalized.workspaceId,
      provider: normalized.provider,
      phone: normalized.phone,
      authMode: 'none',
    })
  }

  if (auth.authMode === 'user_session' && !normalized.workspaceId) {
    return jsonError('validate_payload', 400, 'workspaceId es requerido con Authorization Bearer.', undefined, {
      workspaceId: normalized.workspaceId,
      provider: normalized.provider,
      phone: normalized.phone,
      authMode: auth.authMode,
    })
  }

  let workspaceId: string | null = null

  if (auth.authMode === 'user_session') {
    let user: { id: string; email?: string | null }
    try {
      user = await validateUserToken(admin, auth.token ?? '')
    } catch (error) {
      return jsonError('validate_user_token', 401, 'Token de usuario invalido o expirado.', error, {
        workspaceId: normalized.workspaceId,
        provider: normalized.provider,
        phone: normalized.phone,
        authMode: auth.authMode,
      })
    }

    try {
      const allowed = await authorizeWorkspace(admin, normalized.workspaceId!, user)
      if (!allowed) {
        return jsonError('authorize_workspace', 403, 'El usuario no pertenece a este workspace.', undefined, {
          workspaceId: normalized.workspaceId,
          provider: normalized.provider,
          phone: normalized.phone,
          authMode: auth.authMode,
        })
      }
    } catch (error) {
      return jsonError('authorize_workspace', 403, 'No se pudo validar la pertenencia al workspace.', error, {
        workspaceId: normalized.workspaceId,
        provider: normalized.provider,
        phone: normalized.phone,
        authMode: auth.authMode,
      })
    }
  }

  try {
    workspaceId = await resolveWorkspace(admin, normalized, auth.authMode)
  } catch (error) {
    return jsonError('resolve_workspace', 500, 'Error al resolver workspace.', error, {
      workspaceId: normalized.workspaceId,
      provider: normalized.provider,
      phone: normalized.phone,
      authMode: auth.authMode,
    })
  }

  if (!workspaceId) {
    return jsonError('resolve_workspace', 400, 'No se pudo resolver workspace para el mensaje entrante.', undefined, {
      workspaceId: normalized.workspaceId,
      provider: normalized.provider,
      phone: normalized.phone,
      authMode: auth.authMode,
    })
  }

  // Fire-and-forget: stamp last_webhook_at so the settings page can show when the last real message arrived
  if (normalized.provider === 'meta') {
    void admin.from('whatsapp_connections')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('provider', 'meta')
  }

  let conversation: DataRecord | null = null
  try {
    conversation = await findConversation(admin, workspaceId, normalized)
  } catch (error) {
    return jsonError('find_conversation', 500, 'Error buscando conversation existente.', error, {
      workspaceId,
      provider: normalized.provider,
      phone: normalized.phone,
      authMode: auth.authMode,
    })
  }

  if (conversation) {
    try {
      await updateExistingConversation(admin, workspaceId, conversation, normalized)
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[whatsapp-inbound:update_conversation]', safeError(error))
      }
    }
  } else {
    try {
      conversation = await createConversation(admin, workspaceId, normalized)
    } catch (error) {
      return jsonError('create_conversation', 500, 'Error creando conversation.', error, {
        workspaceId,
        provider: normalized.provider,
        phone: normalized.phone,
        authMode: auth.authMode,
      })
    }
  }

  const conversationId = asString(conversation?.id)
  if (!conversationId) {
    return jsonError('create_conversation', 500, 'Conversation creada sin id valido.', undefined, {
      workspaceId,
      provider: normalized.provider,
      phone: normalized.phone,
      authMode: auth.authMode,
    })
  }

  let messageId: string
  try {
    messageId = await insertMessage(admin, workspaceId, conversationId, normalized)
  } catch (error) {
    return jsonError('create_message', 500, 'Error guardando message inbound.', error, {
      workspaceId,
      provider: normalized.provider,
      phone: normalized.phone,
      authMode: auth.authMode,
    })
  }

  void createActivityBestEffort(admin, workspaceId, normalized).catch((error) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[whatsapp-inbound:create_activity]', safeError(error))
    }
  })

  return NextResponse.json({
    ok: true,
    workspaceId,
    conversationId,
    messageId,
    mode: 'stored_only',
    autoReply: false,
    authMode: auth.authMode,
    provider: normalized.provider,
    phone: normalized.phone,
  })
}
