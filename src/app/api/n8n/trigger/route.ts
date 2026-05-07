import { NextResponse } from 'next/server'

const validEvents = new Set([
  'new_lead',
  'whatsapp_incoming',
  'payment_registered',
  'appointment_scheduled',
  'invoice_overdue',
  'reengagement_sequence',
  'daily_ai_summary',
  'urgent_conversation',
])

type TriggerStatus = 'ok' | 'simulated' | 'skipped' | 'error'

type N8nTriggerBody = {
  event_type?: string
  workspace_id?: string
  endpoint?: string
  webhook_url?: string
  mode?: 'demo' | 'real'
  payload?: Record<string, unknown>
  client?: Record<string, unknown>
  conversation?: Record<string, unknown>
  message?: Record<string, unknown>
  invoice?: Record<string, unknown>
  event?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

function json(status: TriggerStatus, message: string, init?: ResponseInit, extra?: Record<string, unknown>) {
  return NextResponse.json({
    success: status === 'ok' || status === 'simulated' || status === 'skipped',
    status,
    message,
    ...extra,
  }, init)
}

function normalizeWebhookUrl(value: unknown) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('tudominio.com')) return ''
  return trimmed
}

function buildPayload(body: N8nTriggerBody, mode: 'demo' | 'real') {
  const merged = body.payload ?? {}
  return {
    event_type: body.event_type,
    workspace_id: body.workspace_id || (typeof merged.workspace_id === 'string' ? merged.workspace_id : undefined),
    source: 'nowcrm',
    mode,
    client: body.client ?? merged.client ?? {},
    conversation: body.conversation ?? merged.conversation ?? {},
    message: body.message ?? merged.message ?? {},
    invoice: body.invoice ?? merged.invoice ?? {},
    event: body.event ?? merged.event ?? {},
    metadata: {
      ...(typeof merged.metadata === 'object' && merged.metadata ? merged.metadata : {}),
      ...(body.metadata ?? {}),
      triggered_at: new Date().toISOString(),
    },
  }
}

export async function POST(request: Request) {
  let body: N8nTriggerBody

  try {
    body = await request.json()
  } catch {
    return json('error', 'Payload JSON invalido.', { status: 400 })
  }

  const eventType = body.event_type?.trim()
  if (!eventType || !validEvents.has(eventType)) {
    return json('error', 'event_type no reconocido.', { status: 400 }, { allowed_events: Array.from(validEvents) })
  }

  const webhookUrl = normalizeWebhookUrl(body.webhook_url ?? body.endpoint)
  const mode = body.mode === 'real' && webhookUrl ? 'real' : 'demo'
  const payload = buildPayload({ ...body, event_type: eventType }, mode)

  if (!webhookUrl) {
    return json('simulated', `Webhook "${eventType}" simulado desde NowCRM.`, undefined, { mode: 'demo', payload })
  }

  let url: URL
  try {
    url = new URL(webhookUrl)
  } catch {
    return json('skipped', 'Webhook omitido: URL n8n no valida.', { status: 200 }, { mode: 'demo', payload })
  }

  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    return json('skipped', 'Webhook omitido: usa HTTPS o localhost para pruebas.', { status: 200 }, { mode: 'demo', payload })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeout)
    return json(response.ok ? 'ok' : 'error', response.ok ? `Webhook "${eventType}" enviado a n8n.` : 'n8n respondio con error.', { status: response.ok ? 200 : 502 }, {
      mode: 'real',
      http_status: response.status,
    })
  } catch {
    clearTimeout(timeout)
    return json('error', 'No se pudo contactar con el endpoint n8n.', { status: 502 }, { mode: 'real' })
  }
}
