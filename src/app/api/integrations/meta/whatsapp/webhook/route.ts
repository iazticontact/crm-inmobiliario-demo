import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const runtime = 'nodejs'

// Meta Cloud API Webhook — official WhatsApp Business Platform
//
// GET  — webhook verification challenge (Meta sends hub.challenge to verify ownership)
// POST — incoming messages from Meta Cloud API
//
// Production setup:
//   1. Register this URL in Meta Business Manager > WhatsApp > Configuration > Webhook
//   2. Set META_WEBHOOK_VERIFY_TOKEN in server env (a random secret you generate)
//   3. Set META_APP_SECRET for X-Hub-Signature-256 validation
//   4. Subscribe to events: messages, message_deliveries, message_reads
//
// Required env vars (names only — never commit values):
//   META_WEBHOOK_VERIFY_TOKEN  — token you set in Meta webhook registration
//   META_APP_SECRET            — from Meta App > Settings > Basic (HMAC-SHA256 validation)
//   NOWCRM_WEBHOOK_SECRET      — used to authenticate to /api/inbox/whatsapp/inbound
//
// Schema note:
//   To auto-resolve workspace from Meta's phone_number_id, the whatsapp_connections
//   table needs a phone_number_id column:
//     ALTER TABLE whatsapp_connections ADD COLUMN phone_number_id text;
//   Until then, workspaceId must be passed explicitly or resolved via other means.

type MetaContact = {
  profile?: { name?: string }
  wa_id?: string
}

type MetaMessage = {
  from?: string
  id?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
}

type MetaWebhookValue = {
  messaging_product?: string
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  contacts?: MetaContact[]
  messages?: MetaMessage[]
}

type MetaWebhookEntry = {
  id?: string
  changes?: Array<{ value?: MetaWebhookValue; field?: string }>
}

type MetaWebhookPayload = {
  object?: string
  entry?: MetaWebhookEntry[]
}

function verifyMetaSignature(rawBody: string, signatureHeader: string, appSecret: string) {
  const [algo, providedHex] = signatureHeader.split('=')
  if (algo !== 'sha256' || !providedHex) return false
  const expectedHex = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const provided = Buffer.from(providedHex, 'hex')
  const expected = Buffer.from(expectedHex, 'hex')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// Forward each inbound message to /api/inbox/whatsapp/inbound (fire-and-forget).
// Returns quickly so Meta gets its 200 response without waiting for Supabase writes.
function forwardToInbound(messages: Array<{
  phone: string
  customerName?: string
  message: string
  externalMessageId?: string
  timestamp?: string
  phoneNumberId?: string
}>) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000'
  const webhookSecret = process.env.NOWCRM_WEBHOOK_SECRET?.trim()

  if (!webhookSecret) {
    console.warn('[meta/webhook] NOWCRM_WEBHOOK_SECRET not set — cannot forward to inbound handler')
    return
  }

  for (const msg of messages) {
    void fetch(`${baseUrl}/api/inbox/whatsapp/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nowcrm-webhook-secret': webhookSecret,
      },
      body: JSON.stringify({
        provider: 'meta',
        phone: msg.phone,
        phoneNumberId: msg.phoneNumberId,
        customerName: msg.customerName,
        message: msg.message,
        externalMessageId: msg.externalMessageId,
        timestamp: msg.timestamp,
        metadata: {
          source: 'meta_cloud_api',
          phoneNumberId: msg.phoneNumberId,
        },
      }),
    }).catch((err: unknown) => {
      console.error('[meta/webhook] forwardToInbound error', err instanceof Error ? err.message.slice(0, 100) : String(err).slice(0, 100))
    })
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim()

  if (!verifyToken) {
    console.warn('[meta/webhook] META_WEBHOOK_VERIFY_TOKEN not configured — verification will fail')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[meta/webhook] Webhook verified by Meta')
    return new NextResponse(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  console.warn('[meta/webhook] Verification failed — token mismatch or wrong mode')
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  const xHubSignature = request.headers.get('x-hub-signature-256')
  const appSecret = process.env.META_APP_SECRET?.trim()
  const isProduction = process.env.NODE_ENV === 'production'

  if (!appSecret && isProduction) {
    console.error('[meta/webhook] META_APP_SECRET missing in production — refusing webhook POST')
    return NextResponse.json({ error: 'Webhook signing not configured' }, { status: 503 })
  }

  if (appSecret && !xHubSignature) {
    console.warn('[meta/webhook] Missing X-Hub-Signature-256 header')
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  if (!appSecret && !isProduction) {
    console.warn('[meta/webhook] META_APP_SECRET not set — accepting unsigned POST (dev/local only)')
  }

  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (appSecret && xHubSignature && !verifyMetaSignature(rawBody, xHubSignature, appSecret)) {
    console.warn('[meta/webhook] Invalid X-Hub-Signature-256')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: MetaWebhookPayload
  try {
    body = JSON.parse(rawBody) as MetaWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Only process WhatsApp Business Account events
  if (body.object !== 'whatsapp_business_account') {
    return NextResponse.json({ ok: true })
  }

  // Parse entries and extract inbound text messages
  const inboundMessages: Array<{
    phone: string
    customerName?: string
    message: string
    externalMessageId?: string
    timestamp?: string
    phoneNumberId?: string
  }> = []

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      if (!value?.messages?.length) continue

      const phoneNumberId = asStr(value.metadata?.phone_number_id) || undefined

      // Build a wa_id → name map from contacts
      const nameByWaId: Record<string, string> = {}
      for (const contact of value.contacts ?? []) {
        const waId = asStr(contact.wa_id)
        const name = asStr(contact.profile?.name)
        if (waId && name) nameByWaId[waId] = name
      }

      for (const msg of value.messages) {
        // Only process text messages for now
        if (msg.type !== 'text') continue
        const body = asStr(msg.text?.body)
        if (!body) continue

        const from = asStr(msg.from)
        if (!from) continue

        // Convert Unix timestamp to ISO
        const ts = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : undefined

        inboundMessages.push({
          phone: from,
          customerName: nameByWaId[from] || undefined,
          message: body,
          externalMessageId: asStr(msg.id) || undefined,
          timestamp: ts,
          phoneNumberId,
        })
      }
    }
  }

  console.log('[meta/webhook] POST received', {
    object: body.object,
    entriesCount: body.entry?.length ?? 0,
    inboundTextMessages: inboundMessages.length,
    hasSignature: Boolean(xHubSignature),
  })

  if (inboundMessages.length > 0) {
    forwardToInbound(inboundMessages)
  }

  // Always acknowledge immediately — Meta retries if we don't return 200 fast.
  return NextResponse.json({ ok: true })
}
