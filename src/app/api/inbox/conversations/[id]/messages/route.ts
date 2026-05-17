// POST /api/inbox/conversations/[id]/messages
//
// Sends a message in a conversation. Two modes:
//   - draft   → only inserts the local message row (no real send)
//   - send    → tries to send via the underlying channel (WhatsApp / Meta).
//               If outbound is not configured (no Meta token / no phone_number_id),
//               we honestly persist `send_status='pending_config'` and surface the
//               same reason to the UI — never a fake success.
//
// Body:
//   { body: string, mode?: 'draft' | 'send', isAi?: boolean }
//
// Persistence contract (honest states the UI can render):
//   message.metadata = {
//     mode:           'send' | 'draft',
//     send_status:    'sent' | 'failed' | 'draft' | 'pending_config',
//     provider:       'meta' | undefined,
//     provider_message_id: string | undefined,   // Meta wamid when sent
//     reason:         MetaSendReason | undefined,
//     requested_at:   ISO timestamp,
//     sent_at | failed_at: ISO timestamp,
//   }
//
// Sanitization: the JSON response NEVER contains the Meta access token nor the
// raw Graph API response. Only typed reason strings + Meta message id.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { sendWhatsAppMessage, type MetaSendResult } from '@/lib/meta-whatsapp'

export const runtime = 'nodejs'

type DataRecord = Record<string, unknown>

function isUuid(value?: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

async function buildSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { /* static */ }
      },
    },
  })
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) return null
  return createServiceClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

function isSchemaError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const record = error as DataRecord
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message.toLowerCase() : ''
  return code === 'PGRST204' || code === '42703' || message.includes('schema cache') || message.includes('could not find') || message.includes('column')
}

type InsertMessageInput = {
  workspaceId: string
  conversationId: string
  isAi: boolean
  body: string
  metadata: DataRecord
}

// Insert a message row trying to include `metadata`. Falls back to inserting
// without metadata when the column does not exist in the current schema.
async function insertMessageWithMetadata(
  client: SupabaseClient,
  input: InsertMessageInput,
): Promise<{ row: DataRecord | null; metadataPersisted: boolean; error?: unknown }> {
  const baseRow: DataRecord = {
    workspace_id: input.workspaceId,
    conversation_id: input.conversationId,
    sender: input.isAi ? 'ai' : 'agent',
    body: input.body,
    is_ai: input.isAi,
  }

  const withMetadata: DataRecord = { ...baseRow, metadata: input.metadata }

  const first = await client
    .from('messages')
    .insert(withMetadata)
    .select('id, conversation_id, sender, body, is_ai, created_at, metadata')
    .single()

  if (!first.error) {
    return { row: first.data as DataRecord, metadataPersisted: true }
  }

  if (!isSchemaError(first.error)) {
    return { row: null, metadataPersisted: false, error: first.error }
  }

  // Retry without metadata — older schemas may not have the column.
  const second = await client
    .from('messages')
    .insert(baseRow)
    .select('id, conversation_id, sender, body, is_ai, created_at')
    .single()

  if (!second.error) {
    return { row: second.data as DataRecord, metadataPersisted: false }
  }
  return { row: null, metadataPersisted: false, error: second.error }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ ok: false, error: 'id inválido' }, { status: 400 })

  const supabase = await buildSupabase()
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })

  let body: { body?: unknown; mode?: unknown; isAi?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 })
  }

  const messageBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (!messageBody) return NextResponse.json({ ok: false, error: 'body requerido' }, { status: 400 })
  if (messageBody.length > 4000) return NextResponse.json({ ok: false, error: 'Mensaje demasiado largo' }, { status: 400 })

  const requestedMode: 'send' | 'draft' = body.mode === 'send' ? 'send' : 'draft'
  const isAi = body.isAi === true

  const convRes = await supabase
    .from('conversations')
    .select('id, channel, client_id, client_name, metadata')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (convRes.error) {
    console.error('[inbox/messages:post] conv fetch error', convRes.error.message)
    return NextResponse.json({ ok: false, error: 'Error leyendo conversación' }, { status: 500 })
  }
  if (!convRes.data) return NextResponse.json({ ok: false, error: 'Conversación no encontrada' }, { status: 404 })

  const channel = String(convRes.data.channel ?? '').toLowerCase()

  // Step 1 — for `send` mode on WhatsApp, resolve recipient phone first. If we
  //          don't have one we cannot honestly call it "send" — return 400.
  let recipientPhone: string | undefined
  if (requestedMode === 'send' && channel === 'whatsapp') {
    const clientId = convRes.data.client_id as string | null
    if (clientId) {
      const clientRes = await supabase
        .from('clients')
        .select('phone')
        .eq('workspace_id', workspaceId)
        .eq('id', clientId)
        .maybeSingle()
      const phone = (clientRes.data?.phone as string | null) || undefined
      if (phone) recipientPhone = phone
    }
    if (!recipientPhone) {
      const meta = (convRes.data.metadata as Record<string, unknown> | null) || {}
      const fromMeta = typeof meta.phone === 'string' ? meta.phone : typeof meta.from === 'string' ? meta.from : undefined
      if (fromMeta) recipientPhone = fromMeta
    }
    if (!recipientPhone) {
      return NextResponse.json({
        ok: false,
        reason: 'invalid_recipient',
        message: 'No tengo teléfono del cliente para enviar a WhatsApp. Edita el cliente y añade un teléfono.',
      }, { status: 400 })
    }
  }

  // Step 2 — try the actual outbound when requested. The result is sanitized.
  let sendResult: MetaSendResult | null = null
  const admin = adminClient()
  if (requestedMode === 'send' && channel === 'whatsapp') {
    if (!admin) {
      sendResult = {
        ok: false,
        reason: 'pending_config',
        message: 'NowCRM no tiene service_role configurado para enviar a Meta. Mensaje guardado como borrador.',
      }
    } else {
      sendResult = await sendWhatsAppMessage({
        admin,
        workspaceId,
        to: recipientPhone!,
        body: messageBody,
        conversationId: id,
      })
    }
  }

  // Step 3 — derive an honest send_status. `pending_config` is preferred when
  //          we can identify the reason as "the server is not configured yet"
  //          (no token / no phone_number_id / no service_role).
  let sendStatus: 'sent' | 'failed' | 'draft' | 'pending_config'
  if (requestedMode === 'draft') {
    sendStatus = 'draft'
  } else if (channel !== 'whatsapp') {
    // Other channels not implemented yet — treat as pending_config so the UI
    // doesn't show a misleading "failed" badge.
    sendStatus = 'pending_config'
  } else if (sendResult?.ok) {
    sendStatus = 'sent'
  } else if (sendResult && (
    sendResult.reason === 'pending_config' ||
    sendResult.reason === 'token_missing' ||
    sendResult.reason === 'phone_number_id_missing'
  )) {
    sendStatus = 'pending_config'
  } else {
    sendStatus = 'failed'
  }

  const messageMetadata: DataRecord = {
    mode: requestedMode,
    send_status: sendStatus,
    provider: channel === 'whatsapp' ? 'meta' : undefined,
    provider_message_id: sendResult?.messageId,
    reason: sendResult?.reason,
    requested_at: new Date().toISOString(),
    ...(sendStatus === 'sent' ? { sent_at: new Date().toISOString() } : {}),
    ...(sendStatus === 'failed' ? { failed_at: new Date().toISOString() } : {}),
  }

  // Step 4 — insert via admin client when available to avoid RLS issues.
  const inserter = admin ?? supabase
  const insertResult = await insertMessageWithMetadata(inserter, {
    workspaceId,
    conversationId: id,
    isAi,
    body: messageBody,
    metadata: messageMetadata,
  })

  if (!insertResult.row) {
    console.error('[inbox/messages:post] insert error', (insertResult.error as DataRecord | undefined)?.message)
    return NextResponse.json({ ok: false, error: 'No se pudo guardar el mensaje' }, { status: 500 })
  }

  // Bump conversation updated_at and unread=false on outbound.
  void inserter
    .from('conversations')
    .update({ updated_at: new Date().toISOString(), unread: false })
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  // Step 5 — sanitized response
  const responseMode: 'sent' | 'simulated' | 'draft' =
    sendStatus === 'sent' ? 'sent'
    : sendStatus === 'draft' ? 'draft'
    : 'simulated'

  const response: DataRecord = {
    ok: true,
    mode: responseMode,
    send_status: sendStatus,
    metadata_persisted: insertResult.metadataPersisted,
    message: {
      ...insertResult.row,
      // Always echo metadata to the client so the UI can render a badge even
      // when the schema doesn't have a metadata column yet.
      metadata: (insertResult.row.metadata as DataRecord | undefined) ?? messageMetadata,
    },
  }
  if (sendResult) {
    response.send = {
      ok: sendResult.ok,
      reason: sendResult.reason,
      message: sendResult.message,
      messageId: sendResult.messageId,
    }
  } else if (requestedMode === 'send' && channel !== 'whatsapp') {
    response.send = {
      ok: false,
      reason: 'unsupported_channel',
      message: `Envío real no implementado para el canal ${channel || 'desconocido'}.`,
    }
  }

  return NextResponse.json(response)
}
