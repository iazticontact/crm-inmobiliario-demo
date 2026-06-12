// Server-side helper for sending WhatsApp messages via the Meta Cloud API.
//
// Behavior:
//   - Reads phone_number_id from whatsapp_connections.
//   - Reads META_WHATSAPP_ACCESS_TOKEN (or META_ACCESS_TOKEN as fallback) from server env.
//   - If anything is missing → returns a `simulated`/`pending_config` result instead of throwing.
//   - On Meta error → returns a typed reason and never exposes tokens.
//
// IMPORTANT: this module never returns the raw Meta response. Callers receive a
// stable, sanitized shape suitable for UI consumption and DB persistence.

import type { SupabaseClient } from '@supabase/supabase-js'

export type MetaSendReason =
  | 'sent'
  | 'simulated'
  | 'pending_config'
  | 'token_missing'
  | 'phone_number_id_missing'
  | 'invalid_recipient'
  | 'meta_api_error'
  | 'rate_limited'
  | 'network_error'

export type MetaSendResult = {
  ok: boolean
  reason: MetaSendReason
  message: string
  messageId?: string
  phoneNumberId?: string
  to?: string
}

const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || 'v21.0'

function getAccessToken(): string | undefined {
  return (
    process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() ||
    process.env.META_ACCESS_TOKEN?.trim() ||
    undefined
  )
}

function normalizeRecipient(value: string): string {
  return value.replace(/[^\d+]/g, '').replace(/^\+/, '')
}

export type SendWhatsAppArgs = {
  admin: SupabaseClient // service_role client; required to read connection without RLS
  workspaceId: string
  to: string
  body: string
  conversationId?: string
}

/**
 * Sends a WhatsApp text message via Meta Cloud API.
 * If the workspace is not configured or token missing, returns a sanitized result and does NOT throw.
 * Never logs nor returns tokens.
 */
export async function sendWhatsAppMessage(args: SendWhatsAppArgs): Promise<MetaSendResult> {
  const { admin, workspaceId, to, body } = args
  if (!body || !body.trim()) {
    return { ok: false, reason: 'invalid_recipient', message: 'Mensaje vacío.' }
  }
  if (!to || !to.trim()) {
    return { ok: false, reason: 'invalid_recipient', message: 'Destinatario vacío.' }
  }

  const { data: conn, error: connErr } = await admin
    .from('whatsapp_connections')
    .select('phone_number_id, connection_status, provider')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'meta')
    .maybeSingle()

  if (connErr) {
    console.error('[meta-whatsapp:send] connection fetch error', connErr.message)
    return { ok: false, reason: 'pending_config', message: 'No se pudo leer la conexión WhatsApp del workspace.' }
  }

  const phoneNumberId = (conn?.phone_number_id as string | null) || undefined
  if (!phoneNumberId) {
    return {
      ok: false,
      reason: 'phone_number_id_missing',
      message: 'Configura phone_number_id en Settings → WhatsApp para enviar mensajes reales.',
    }
  }

  const accessToken = getAccessToken()
  if (!accessToken) {
    return {
      ok: false,
      reason: 'token_missing',
      message: 'Falta META_WHATSAPP_ACCESS_TOKEN en el servidor. El CRM no enviará mensajes reales sin él.',
      phoneNumberId,
    }
  }

  const recipient = normalizeRecipient(to)
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: body.slice(0, 4000) },
      }),
    })
  } catch (err) {
    console.error('[meta-whatsapp:send] fetch error', err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'network_error', message: 'No se pudo contactar con Meta.', phoneNumberId, to: recipient }
  }

  // Read response — only extract fields we actually want
  type MetaSendResponse = {
    messages?: Array<{ id?: string }>
    error?: { message?: string; code?: number; type?: string }
  }
  const data = await res.json().catch(() => ({})) as MetaSendResponse

  if (res.ok) {
    const messageId = data.messages?.[0]?.id
    return {
      ok: true,
      reason: 'sent',
      message: 'Mensaje enviado.',
      messageId,
      phoneNumberId,
      to: recipient,
    }
  }

  if (res.status === 429) {
    return { ok: false, reason: 'rate_limited', message: 'Meta está limitando peticiones (429).', phoneNumberId, to: recipient }
  }

  if (res.status === 400 || res.status === 422) {
    const metaMsg = (data.error?.message ?? '').toString()
    if (metaMsg.toLowerCase().includes('recipient')) {
      return { ok: false, reason: 'invalid_recipient', message: 'Meta no acepta este destinatario.', phoneNumberId, to: recipient }
    }
  }

  console.error('[meta-whatsapp:send] meta api error', { status: res.status, code: data.error?.code, type: data.error?.type })
  return {
    ok: false,
    reason: 'meta_api_error',
    message: `Meta devolvió ${res.status}.`,
    phoneNumberId,
    to: recipient,
  }
}
