import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { processInboundWhatsAppMessage, type ProcessInboundInput } from '@/lib/whatsapp-inbound'

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
//   SUPABASE_SERVICE_ROLE_KEY  — used by the inbound processor to write through RLS
//
// Important reliability note:
//   This route used to forward inbound messages by `void fetch(...)` to another
//   internal API. In serverless that fire-and-forget can be cut off before the
//   persistence call completes, so real Meta messages could be silently lost.
//   We now `await` the persistence helper directly server-side, with no HTTP
//   self-call and no dependency on NEXT_PUBLIC_APP_URL.

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
  image?: { caption?: string; mime_type?: string }
  audio?: { mime_type?: string; voice?: boolean }
  video?: { caption?: string; mime_type?: string }
  document?: { caption?: string; filename?: string; mime_type?: string }
  sticker?: { mime_type?: string }
  location?: { latitude?: number; longitude?: number; name?: string; address?: string }
  contacts?: Array<{ name?: { formatted_name?: string } }>
  button?: { text?: string }
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
  reaction?: { emoji?: string }
}

type MetaStatusUpdate = {
  id?: string
  status?: string
  timestamp?: string
  recipient_id?: string
}

type MetaWebhookValue = {
  messaging_product?: string
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  contacts?: MetaContact[]
  messages?: MetaMessage[]
  statuses?: MetaStatusUpdate[]
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

function buildAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
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

  // Build the work list: every inbound message in the payload becomes a
  // ProcessInboundInput. We do not store raw Meta payloads.
  type WorkItem = ProcessInboundInput
  const workItems: WorkItem[] = []
  let statusUpdateCount = 0

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      if (!value) continue

      // Statuses (sent / delivered / read / failed) — we acknowledge them but
      // don't persist yet. A future iteration will look up the outbound message
      // by metadata.provider_message_id and patch its send_status.
      if (Array.isArray(value.statuses) && value.statuses.length) {
        statusUpdateCount += value.statuses.length
      }

      if (!value.messages?.length) continue

      const phoneNumberId = asStr(value.metadata?.phone_number_id) || undefined
      const displayPhoneNumber = asStr(value.metadata?.display_phone_number) || undefined

      const nameByWaId: Record<string, string> = {}
      for (const contact of value.contacts ?? []) {
        const waId = asStr(contact.wa_id)
        const name = asStr(contact.profile?.name)
        if (waId && name) nameByWaId[waId] = name
      }

      for (const msg of value.messages) {
        const from = asStr(msg.from)
        if (!from) continue

        const isoTimestamp = msg.timestamp
          ? new Date(Number(msg.timestamp) * 1000).toISOString()
          : new Date().toISOString()
        const externalMessageId = asStr(msg.id) || undefined
        const type = asStr(msg.type) || 'unknown'

        // Build a human-readable body. Non-text types get a typed placeholder
        // so the Inbox operator at least sees something arrived. We never
        // download media here — that would require Meta media tokens and is a
        // separate feature.
        let body = ''
        const extraMetadata: Record<string, unknown> = { messageType: type }

        if (type === 'text') {
          body = asStr(msg.text?.body)
        } else if (type === 'image') {
          body = `[imagen]${msg.image?.caption ? ` ${asStr(msg.image.caption)}` : ''}`
          if (msg.image?.mime_type) extraMetadata.mediaMimeType = msg.image.mime_type
        } else if (type === 'audio') {
          body = msg.audio?.voice ? '[nota de voz]' : '[audio]'
          if (msg.audio?.mime_type) extraMetadata.mediaMimeType = msg.audio.mime_type
        } else if (type === 'video') {
          body = `[video]${msg.video?.caption ? ` ${asStr(msg.video.caption)}` : ''}`
          if (msg.video?.mime_type) extraMetadata.mediaMimeType = msg.video.mime_type
        } else if (type === 'document') {
          const fname = asStr(msg.document?.filename) || 'documento'
          body = `[documento: ${fname}]${msg.document?.caption ? ` ${asStr(msg.document.caption)}` : ''}`
          if (msg.document?.mime_type) extraMetadata.mediaMimeType = msg.document.mime_type
        } else if (type === 'sticker') {
          body = '[sticker]'
        } else if (type === 'location') {
          const name = asStr(msg.location?.name)
          const address = asStr(msg.location?.address)
          body = `[ubicacion${name ? `: ${name}` : ''}${address ? ` - ${address}` : ''}]`
          if (typeof msg.location?.latitude === 'number') extraMetadata.locationLat = msg.location.latitude
          if (typeof msg.location?.longitude === 'number') extraMetadata.locationLng = msg.location.longitude
        } else if (type === 'contacts') {
          const names = (msg.contacts ?? [])
            .map((c) => asStr(c.name?.formatted_name))
            .filter(Boolean)
          body = names.length ? `[contactos: ${names.join(', ')}]` : '[contacto]'
        } else if (type === 'button') {
          body = asStr(msg.button?.text) || '[boton]'
        } else if (type === 'interactive') {
          body = asStr(msg.interactive?.button_reply?.title)
            || asStr(msg.interactive?.list_reply?.title)
            || '[interactivo]'
        } else if (type === 'reaction') {
          const emoji = asStr(msg.reaction?.emoji)
          body = emoji ? `[reaccion ${emoji}]` : '[reaccion]'
        } else {
          body = `[mensaje no soportado: ${type}]`
        }

        if (!body) continue

        workItems.push({
          provider: 'meta',
          phone: from,
          phoneNumberId,
          displayPhoneNumber,
          customerName: nameByWaId[from] || undefined,
          message: body,
          externalMessageId,
          timestamp: isoTimestamp,
          metadata: {
            source: 'meta_cloud_api',
            phoneNumberId,
            displayPhoneNumber,
            ...extraMetadata,
          },
        })
      }
    }
  }

  console.log('[meta/webhook] POST received', {
    object: body.object,
    entriesCount: body.entry?.length ?? 0,
    inboundMessages: workItems.length,
    statusUpdates: statusUpdateCount,
    hasSignature: Boolean(xHubSignature),
  })

  if (workItems.length === 0) {
    return NextResponse.json({ ok: true, statusUpdates: statusUpdateCount })
  }

  const admin = buildAdminClient()
  if (!admin) {
    // Acknowledge to Meta so it doesn't retry forever, but log loudly. Without
    // the service role we cannot resolve workspace nor write the inbound row.
    console.error('[meta/webhook] SUPABASE_SERVICE_ROLE_KEY missing — inbound messages NOT persisted')
    return NextResponse.json({ ok: true, persisted: false, reason: 'service_role_missing' })
  }

  // Process each message server-side. We await so persistence completes before
  // the serverless function returns. Promise.allSettled isolates per-message
  // failures so one bad row doesn't kill the others.
  const results = await Promise.allSettled(workItems.map((item) => processInboundWhatsAppMessage(admin, item)))

  let inserted = 0
  let deduped = 0
  let failed = 0
  let workspaceUnresolved = 0
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      if (r.value.ok && r.value.deduped) deduped += 1
      else if (r.value.ok) inserted += 1
      else {
        failed += 1
        if (r.value.step === 'resolve_workspace') workspaceUnresolved += 1
        // Loud, sanitized failure log — never includes raw Meta payload nor secrets.
        console.warn('[meta/webhook] inbound persist failed', {
          step: r.value.step,
          phoneNumberId: workItems[i]?.phoneNumberId,
          externalMessageId: workItems[i]?.externalMessageId,
          reason: r.value.error?.slice(0, 120),
        })
      }
    } else {
      failed += 1
      console.warn('[meta/webhook] inbound persist threw', {
        phoneNumberId: workItems[i]?.phoneNumberId,
        externalMessageId: workItems[i]?.externalMessageId,
        reason: r.reason instanceof Error ? r.reason.message.slice(0, 120) : String(r.reason).slice(0, 120),
      })
    }
  }

  if (workspaceUnresolved > 0) {
    console.warn('[meta/webhook] workspace unresolved — check whatsapp_connections.phone_number_id for', {
      phoneNumberIds: Array.from(new Set(workItems.map((w) => w.phoneNumberId).filter(Boolean))),
      droppedMessages: workspaceUnresolved,
    })
  }

  console.log('[meta/webhook] persisted batch', { received: workItems.length, inserted, deduped, failed, statusUpdates: statusUpdateCount })

  // Always 200 to Meta — Meta will not retry on 4xx and we have idempotency by
  // externalMessageId for the case where it does retry on transient errors.
  return NextResponse.json({ ok: true, received: workItems.length, inserted, deduped, failed, statusUpdates: statusUpdateCount })
}
