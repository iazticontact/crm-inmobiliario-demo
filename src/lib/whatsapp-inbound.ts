// Shared, server-side processor for inbound WhatsApp messages.
//
// Why this exists:
//   The Meta webhook (/api/integrations/meta/whatsapp/webhook) used to forward
//   each message via `void fetch('/api/inbox/whatsapp/inbound')`. In serverless
//   that fire-and-forget can be cut off before the persistence call completes,
//   so real messages could be lost. This module exposes the persistence logic
//   directly so the webhook route can `await` it server-side, without any HTTP
//   bounce or NEXT_PUBLIC_APP_URL dependency.
//
// Responsibilities:
//   - Resolve the workspace for a message (phone_number_id → phone fallback).
//   - Dedupe by external message id (best-effort: searches recent rows by
//     metadata.externalMessageId; if a unique-index exists in DB, it also
//     protects against races).
//   - Find or create a conversation row, tolerating column drift.
//   - Insert the message with sanitized metadata. Never store raw Meta payloads.
//   - Link the conversation to a client by normalized phone, when an
//     unambiguous match exists. Never auto-create clients.
//   - Stamp last_webhook_at on the workspace connection so Settings can show
//     when the last real Meta message arrived.
//
// What this does NOT do:
//   - Send auto-replies.
//   - Call OpenAI / Asistente IA.
//   - Trigger n8n.
//   - Re-broadcast the message anywhere.

import type { SupabaseClient } from '@supabase/supabase-js'

type DataRecord = Record<string, unknown>

export type ProcessInboundProvider = 'meta' | 'test'

export type ProcessInboundInput = {
  workspaceId?: string          // pre-resolved; if absent, resolveWorkspace runs
  provider: ProcessInboundProvider
  phone: string                 // customer wa_id / phone (E.164 without "+" usually)
  phoneNumberId?: string        // Meta business phone number id
  displayPhoneNumber?: string   // Meta business display phone number (UI hint)
  customerName?: string
  customerEmail?: string
  message: string
  externalConversationId?: string
  externalMessageId?: string
  timestamp: string             // ISO
  metadata: Record<string, unknown>
}

export type ProcessInboundOk = {
  ok: true
  workspaceId: string
  conversationId: string
  messageId: string
  deduped: boolean
  clientLinked: boolean
}

export type ProcessInboundError = {
  ok: false
  step:
    | 'resolve_workspace'
    | 'find_conversation'
    | 'create_conversation'
    | 'create_message'
  error: string
  code?: string
  details?: string
}

export type ProcessInboundResult = ProcessInboundOk | ProcessInboundError

function asRecord(value: unknown): DataRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as DataRecord) : {}
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function safeError(error: unknown) {
  if (!error) return { message: 'Unknown error' }
  if (typeof error === 'string') return { message: error }
  if (error instanceof Error) return { message: error.message }
  if (typeof error === 'object') {
    const record = error as DataRecord
    return {
      message: asString(record.message, 'Unknown error'),
      code: asString(record.code) || undefined,
      details: asString(record.details) || undefined,
      hint: asString(record.hint) || undefined,
    }
  }
  return { message: String(error) }
}

function isSchemaError(error: unknown) {
  const normalized = safeError(error)
  const code = normalized.code ?? ''
  const message = (normalized.message || '').toLowerCase()
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    message.includes('schema cache') ||
    message.includes('could not find') ||
    message.includes('column')
  )
}

function missingColumn(error: unknown) {
  const text = [safeError(error).message, safeError(error).details, safeError(error).hint]
    .filter(Boolean)
    .join(' ')
  const quoted = text.match(/'([^']+)'/)
  if (quoted?.[1]) return quoted[1]
  const column = text.match(/column\s+([a-zA-Z0-9_]+)/i)
  return column?.[1] ?? null
}

function preview(value: string, max = 300) {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

// Normalize a phone string to a set of candidate variants for matching against
// stored clients. We deliberately avoid silently dropping the "+" or country
// codes — instead we generate variants and let the lookup match any of them.
function normalizePhoneVariants(value: string): string[] {
  const trimmed = (value || '').trim()
  if (!trimmed) return []

  const digitsOnly = trimmed.replace(/[^\d+]/g, '')
  const withoutPlus = digitsOnly.replace(/^\+/, '')

  const variants = new Set<string>()
  if (digitsOnly) variants.add(digitsOnly)
  if (withoutPlus) variants.add(withoutPlus)
  if (withoutPlus) variants.add(`+${withoutPlus}`)

  // Spanish convenience: many CRMs store national 9-digit numbers without prefix.
  if (withoutPlus.startsWith('34') && withoutPlus.length === 11) {
    variants.add(withoutPlus.slice(2)) // strip "34"
  }
  // Generic last-9 fallback (helps some legacy data) — only added if reasonable.
  if (withoutPlus.length >= 9) {
    variants.add(withoutPlus.slice(-9))
  }
  return Array.from(variants).filter(Boolean)
}

async function resolveWorkspaceFromProvider(admin: SupabaseClient, input: ProcessInboundInput): Promise<string | null> {
  if (input.workspaceId) return input.workspaceId

  if (input.phoneNumberId) {
    const { data, error } = await admin
      .from('whatsapp_connections')
      .select('workspace_id')
      .eq('phone_number_id', input.phoneNumberId)
      .maybeSingle()
    if (error && !isSchemaError(error)) throw error
    const wsId = asString((data as DataRecord | null)?.workspace_id)
    if (wsId) return wsId
  }

  // Fallback: by business phone display number (the customer phone is NOT useful here)
  if (input.displayPhoneNumber) {
    const { data, error } = await admin
      .from('whatsapp_connections')
      .select('workspace_id')
      .eq('phone_number', input.displayPhoneNumber)
      .maybeSingle()
    if (error && !isSchemaError(error)) throw error
    const wsId = asString((data as DataRecord | null)?.workspace_id)
    if (wsId) return wsId
  }

  return null
}

async function findExistingMessageByExternalId(
  admin: SupabaseClient,
  workspaceId: string,
  externalMessageId: string,
): Promise<{ id: string; conversationId: string } | null> {
  // Strategy 1: direct column (only if it exists in the schema).
  // We try it and silently fall back on schema errors.
  try {
    const { data, error } = await admin
      .from('messages')
      .select('id, conversation_id')
      .eq('workspace_id', workspaceId)
      .eq('external_message_id', externalMessageId)
      .limit(1)
      .maybeSingle()
    if (!error && data) {
      return { id: asString((data as DataRecord).id), conversationId: asString((data as DataRecord).conversation_id) }
    }
    if (error && !isSchemaError(error)) throw error
  } catch (error) {
    if (!isSchemaError(error)) throw error
  }

  // Strategy 2: JSONB metadata.externalMessageId.
  try {
    const { data, error } = await admin
      .from('messages')
      .select('id, conversation_id, metadata')
      .eq('workspace_id', workspaceId)
      .contains('metadata', { externalMessageId })
      .limit(1)
      .maybeSingle()
    if (!error && data) {
      return { id: asString((data as DataRecord).id), conversationId: asString((data as DataRecord).conversation_id) }
    }
    if (error && !isSchemaError(error)) {
      // .contains on missing metadata column → schema error → ignore
      if (!isSchemaError(error)) throw error
    }
  } catch (error) {
    if (!isSchemaError(error)) throw error
  }

  return null
}

// Find the conversation for an inbound message. Order of preference:
//   1. exact externalConversationId match inside metadata (when provided),
//   2. exact phone match inside metadata,
//   3. fallback: scan up to 200 recent conversations (only when schema doesn't
//      support .contains on metadata yet).
//
// We deliberately avoid the previous "fetch 50 most recent and filter in JS"
// approach: it didn't scale to multi-thousand-conversation workspaces and
// silently caused duplicates once a phone moved past the 50-row window.
async function findConversation(admin: SupabaseClient, workspaceId: string, input: ProcessInboundInput) {
  // Strategy 1: direct lookup by externalConversationId via JSONB contains.
  if (input.externalConversationId) {
    try {
      const { data, error } = await admin
        .from('conversations')
        .select('*')
        .eq('workspace_id', workspaceId)
        .contains('metadata', { externalConversationId: input.externalConversationId })
        .limit(1)
        .maybeSingle()
      if (!error && data) return data as DataRecord
      if (error && !isSchemaError(error)) throw error
    } catch (error) {
      if (!isSchemaError(error)) throw error
    }
  }

  // Strategy 2: direct lookup by phone via JSONB contains.
  try {
    const { data, error } = await admin
      .from('conversations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .contains('metadata', { phone: input.phone })
      .in('channel', ['whatsapp', 'test', 'web'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error && data) return data as DataRecord
    if (error && !isSchemaError(error)) throw error
  } catch (error) {
    if (!isSchemaError(error)) throw error
  }

  // Strategy 3: schema-tolerant fallback when metadata column or .contains is
  // not supported. We scan a larger window and filter in JS — slower, but only
  // runs on legacy schemas where metadata isn't available anyway.
  let result = await admin
    .from('conversations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (result.error && isSchemaError(result.error)) {
    result = await admin.from('conversations').select('*').eq('workspace_id', workspaceId).limit(200)
  }
  if (result.error) throw result.error
  const rows = (result.data as DataRecord[] | null) ?? []
  const whatsappRows = rows.filter((row) => {
    const channel = asString(row.channel).toLowerCase()
    return !channel || channel === 'whatsapp' || channel === 'test' || channel === 'web'
  })

  if (input.externalConversationId) {
    const byExternalId = whatsappRows.find(
      (row) => asString(asRecord(row.metadata).externalConversationId) === input.externalConversationId,
    )
    if (byExternalId) return byExternalId
  }

  return whatsappRows.find((row) => asString(asRecord(row.metadata).phone) === input.phone) ?? null
}

async function insertConversationWithFallback(admin: SupabaseClient, row: DataRecord) {
  const optionalColumns = [
    'client_name',
    'client_avatar',
    'channel',
    'status',
    'sentiment',
    'intent',
    'ai_summary',
    'unread',
    'metadata',
    'updated_at',
    'created_at',
  ]
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

async function updateConversationBestEffort(
  admin: SupabaseClient,
  workspaceId: string,
  conversation: DataRecord,
  patch: DataRecord,
) {
  const id = asString(conversation.id)
  if (!id) return

  const optionalColumns = ['client_name', 'client_id', 'status', 'intent', 'ai_summary', 'unread', 'metadata', 'updated_at']
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

async function insertMessage(
  admin: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  input: ProcessInboundInput,
) {
  const baseMetadata = {
    direction: 'inbound',
    provider: input.provider,
    phone: input.phone,
    phoneNumberId: input.phoneNumberId,
    externalMessageId: input.externalMessageId,
    timestamp: input.timestamp,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    source: 'whatsapp_inbound',
  }

  const base: DataRecord = {
    workspace_id: workspaceId,
    conversation_id: conversationId,
    sender: 'client',
    body: input.message,
    is_ai: false,
    metadata: baseMetadata,
    created_at: input.timestamp,
  }

  // Some schemas have a dedicated external_message_id column.
  // Try with it first; fall back if Supabase complains.
  let current: DataRecord = input.externalMessageId
    ? { ...base, external_message_id: input.externalMessageId }
    : { ...base }

  const optionalColumns = ['metadata', 'created_at', 'is_ai', 'external_message_id']

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

async function findClientIdByPhone(
  admin: SupabaseClient,
  workspaceId: string,
  phone: string,
): Promise<string | null> {
  const variants = normalizePhoneVariants(phone)
  if (variants.length === 0) return null

  try {
    const { data, error } = await admin
      .from('clients')
      .select('id, phone')
      .eq('workspace_id', workspaceId)
      .in('phone', variants)
      .limit(2)
    if (error && !isSchemaError(error)) throw error
    const rows = (data as DataRecord[] | null) ?? []
    if (rows.length === 1) return asString(rows[0].id) || null
    return null
  } catch (error) {
    if (!isSchemaError(error)) throw error
    return null
  }
}

async function createActivityBestEffort(admin: SupabaseClient, workspaceId: string, input: ProcessInboundInput) {
  const description = preview(input.message, 180)
  const row: DataRecord = {
    workspace_id: workspaceId,
    type: 'whatsapp_message_inbound',
    title: 'Mensaje WhatsApp recibido',
    description,
    client_name: input.customerName || input.phone,
    metadata: {
      source: 'whatsapp_inbound',
      provider: input.provider,
      phone: input.phone,
      direction: 'inbound',
      externalMessageId: input.externalMessageId,
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

async function stampLastWebhookAt(admin: SupabaseClient, workspaceId: string) {
  // Best-effort: connection row may not exist if the workspace hasn't filled
  // Settings yet. Either way, we don't want to fail the message persistence.
  void admin
    .from('whatsapp_connections')
    .update({ last_webhook_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('provider', 'meta')
}

/**
 * Persist an inbound WhatsApp message end-to-end. Idempotent on
 * externalMessageId when the schema supports it (column or jsonb metadata).
 * Never throws — returns a typed result instead.
 */
export async function processInboundWhatsAppMessage(
  admin: SupabaseClient,
  input: ProcessInboundInput,
): Promise<ProcessInboundResult> {
  let workspaceId = input.workspaceId
  if (!workspaceId) {
    try {
      const resolved = await resolveWorkspaceFromProvider(admin, input)
      if (!resolved) {
        return { ok: false, step: 'resolve_workspace', error: 'No se pudo resolver workspace para el mensaje entrante.' }
      }
      workspaceId = resolved
    } catch (error) {
      const e = safeError(error)
      return { ok: false, step: 'resolve_workspace', error: e.message, code: e.code, details: e.details }
    }
  }

  // 1) Dedupe by externalMessageId before doing anything else.
  if (input.externalMessageId) {
    try {
      const existing = await findExistingMessageByExternalId(admin, workspaceId, input.externalMessageId)
      if (existing) {
        return {
          ok: true,
          workspaceId,
          conversationId: existing.conversationId,
          messageId: existing.id,
          deduped: true,
          clientLinked: false,
        }
      }
    } catch (error) {
      // Dedupe is best-effort. Only block if it's not a schema problem.
      if (!isSchemaError(error)) {
        const e = safeError(error)
        return { ok: false, step: 'find_conversation', error: e.message, code: e.code, details: e.details }
      }
    }
  }

  // 2) Stamp last_webhook_at (best effort, never blocks)
  if (input.provider === 'meta') stampLastWebhookAt(admin, workspaceId)

  // 3) Find or create conversation
  let conversation: DataRecord | null = null
  try {
    conversation = await findConversation(admin, workspaceId, input)
  } catch (error) {
    const e = safeError(error)
    return { ok: false, step: 'find_conversation', error: e.message, code: e.code, details: e.details }
  }

  if (!conversation) {
    try {
      const customerLabel = input.customerName || input.phone
      const summary = preview(input.message)
      const metadata = {
        ...input.metadata,
        assistant_mode: 'inbox',
        source: 'whatsapp_inbound',
        provider: input.provider,
        phone: input.phone,
        title: customerLabel,
        clientName: customerLabel,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        externalConversationId: input.externalConversationId,
        lastInboundAt: input.timestamp,
        lastMessagePreview: summary,
        lastExternalMessageId: input.externalMessageId,
      }
      const now = new Date().toISOString()
      conversation = await insertConversationWithFallback(admin, {
        workspace_id: workspaceId,
        client_name: customerLabel,
        client_avatar:
          customerLabel
            .split(/\s+/)
            .map((p) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || 'WA',
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
    } catch (error) {
      const e = safeError(error)
      return { ok: false, step: 'create_conversation', error: e.message, code: e.code, details: e.details }
    }
  } else {
    const summary = preview(input.message)
    const existingMetadata = asRecord(conversation.metadata)
    const mergedMetadata = {
      ...existingMetadata,
      ...input.metadata,
      assistant_mode: 'inbox',
      source: 'whatsapp_inbound',
      provider: input.provider,
      phone: input.phone,
      title: asString(existingMetadata.title, input.customerName || input.phone),
      clientName: asString(existingMetadata.clientName, input.customerName || input.phone),
      customerName: input.customerName ?? existingMetadata.customerName,
      customerEmail: input.customerEmail ?? existingMetadata.customerEmail,
      externalConversationId: input.externalConversationId ?? existingMetadata.externalConversationId,
      lastInboundAt: input.timestamp,
      lastMessagePreview: summary,
      lastExternalMessageId: input.externalMessageId,
    }
    try {
      await updateConversationBestEffort(admin, workspaceId, conversation, {
        client_name: asString(conversation.client_name, input.customerName || input.phone),
        status: 'open',
        intent: 'assistant_inbox',
        ai_summary: summary,
        unread: true,
        metadata: mergedMetadata,
        updated_at: new Date().toISOString(),
      })
    } catch {
      // Non-fatal — message will still be inserted into the existing row.
    }
  }

  const conversationId = asString(conversation?.id)
  if (!conversationId) {
    return { ok: false, step: 'create_conversation', error: 'Conversation creada sin id valido.' }
  }

  // 4) Insert the inbound message
  let messageId: string
  try {
    messageId = await insertMessage(admin, workspaceId, conversationId, input)
  } catch (error) {
    const e = safeError(error)
    return { ok: false, step: 'create_message', error: e.message, code: e.code, details: e.details }
  }

  // 5) Link client by phone (best effort, never blocks)
  let clientLinked = false
  try {
    const existingClientId = asString((conversation as DataRecord | null)?.client_id)
    if (!existingClientId) {
      const matchedClientId = await findClientIdByPhone(admin, workspaceId, input.phone)
      if (matchedClientId) {
        await updateConversationBestEffort(admin, workspaceId, { id: conversationId } as DataRecord, {
          client_id: matchedClientId,
          updated_at: new Date().toISOString(),
        })
        clientLinked = true
      }
    }
  } catch {
    // Non-fatal.
  }

  // 6) Activity log (best effort)
  void createActivityBestEffort(admin, workspaceId, input).catch(() => undefined)

  return { ok: true, workspaceId, conversationId, messageId, deduped: false, clientLinked }
}
