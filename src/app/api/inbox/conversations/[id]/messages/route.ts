// POST /api/inbox/conversations/[id]/messages
//
// Sends a message in a conversation. Two modes:
//   - draft   → only inserts the local message row (no real send)
//   - send    → tries to send via the underlying channel (WhatsApp / Meta).
//               If outbound is not configured, falls back to inserting the
//               message with a "simulated" metadata flag and returns
//               { reason: 'pending_config' | 'simulated' } honestly.
//
// Body:
//   { body: string, mode?: 'draft' | 'send' }

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { sendWhatsAppMessage, type MetaSendResult } from '@/lib/meta-whatsapp'

export const runtime = 'nodejs'

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

  const mode = body.mode === 'send' ? 'send' : 'draft'
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

  let sendResult: MetaSendResult | null = null
  const channel = String(convRes.data.channel ?? '').toLowerCase()
  let recipientPhone: string | undefined

  if (mode === 'send' && channel === 'whatsapp') {
    // Resolve recipient phone from client_id
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
    // Fallback to conversation metadata.phone (some inbound flows store it there)
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

    const admin = adminClient()
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
        to: recipientPhone,
        body: messageBody,
        conversationId: id,
      })
    }
  }

  // Insert message row regardless of send result — Inbox always reflects what the operator wrote.
  // For drafts and simulated sends we still log it; the metadata explains why it wasn't sent.
  const messageMetadata: Record<string, unknown> = {
    mode,
    requested_at: new Date().toISOString(),
  }
  if (sendResult) {
    messageMetadata.send = {
      ok: sendResult.ok,
      reason: sendResult.reason,
      messageId: sendResult.messageId,
    }
  }
  if (mode === 'send' && !sendResult?.ok) {
    messageMetadata.simulated = true
  }

  // Insert via admin client so we don't hit RLS issues for the local row.
  const insertAdmin = adminClient()
  const inserter = insertAdmin ?? supabase
  const { data: msgRow, error: msgErr } = await inserter
    .from('messages')
    .insert({
      workspace_id: workspaceId,
      conversation_id: id,
      sender: isAi ? 'ai' : 'agent',
      body: messageBody,
      is_ai: isAi,
    })
    .select('id, conversation_id, sender, body, is_ai, created_at')
    .single()

  if (msgErr) {
    console.error('[inbox/messages:post] insert error', msgErr.message)
    return NextResponse.json({ ok: false, error: 'No se pudo guardar el mensaje' }, { status: 500 })
  }

  // Bump conversation updated_at and unread=false on outbound
  void inserter
    .from('conversations')
    .update({ updated_at: new Date().toISOString(), unread: false })
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  // Build sanitized response — never expose Meta token or raw API payload
  const response: Record<string, unknown> = {
    ok: true,
    message: msgRow,
  }
  if (sendResult) {
    response.send = {
      ok: sendResult.ok,
      reason: sendResult.reason,
      message: sendResult.message,
      messageId: sendResult.messageId,
    }
    response.mode = sendResult.ok ? 'sent' : 'simulated'
  } else if (mode === 'send' && channel !== 'whatsapp') {
    response.send = { ok: false, reason: 'unsupported_channel', message: `Envío real no implementado para el canal ${channel || 'desconocido'}.` }
    response.mode = 'simulated'
  } else {
    response.mode = 'draft'
  }
  // Hint metadata into the saved row for the UI even if we didn't query it back
  response.metadata = messageMetadata

  return NextResponse.json(response)
}
