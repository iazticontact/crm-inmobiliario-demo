import { NextResponse } from 'next/server'
import { normalizeN8nEventType, type N8nEventType, type N8nTriggerMode, type N8nTriggerStatus } from '@/lib/integrations'
import type { N8nFlowStatus } from '@/lib/types'

type N8nTriggerBody = {
  event_type?: string
  workspace_id?: string
  flow_id?: string
  webhook_url?: string
  endpoint?: string
  mode?: N8nTriggerMode
  flow_status?: N8nFlowStatus
  payload?: Record<string, unknown>
  client?: Record<string, unknown>
  conversation?: Record<string, unknown>
  message?: Record<string, unknown>
  invoice?: Record<string, unknown>
  calendar_event?: Record<string, unknown>
  activity?: Record<string, unknown>
  metadata?: Record<string, unknown>
  assistant_mode?: string
  recent_history?: string
}

type RouteResponseExtra = {
  event_type?: N8nEventType
  mode?: N8nTriggerMode
  payload?: Record<string, unknown>
  n8n_response?: unknown
  suggested_response?: string
  activity_created?: boolean
  http_status?: number
  allowed_events?: readonly string[]
  execution_id?: string
  duration_ms?: number
}

// Whitelist a small set of safe fields from n8n response.
// NEVER return the raw response — it can leak headers, full payload, secrets, downstream tokens.
function sanitizeN8nResponse(value: unknown): { executionId?: string; messagePreview?: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const executionRaw = record.executionId ?? record.execution_id ?? record.id
  const messageRaw = record.message ?? record.status_text ?? record.statusText
  const out: { executionId?: string; messagePreview?: string } = {}
  if (typeof executionRaw === 'string' && executionRaw.length < 128) out.executionId = executionRaw
  if (typeof messageRaw === 'string' && messageRaw.length < 256) out.messagePreview = messageRaw.slice(0, 240)
  return Object.keys(out).length ? out : undefined
}

function json(status: N8nTriggerStatus, message: string, init?: ResponseInit, extra?: RouteResponseExtra) {
  const ok = status === 'ok' || status === 'simulated' || status === 'skipped'
  return NextResponse.json({
    ok,
    success: ok,
    status,
    message,
    activity_created: false,
    ...extra,
  }, init)
}

function normalizeWebhookUrl(value: unknown) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('tudominio.com')) return ''
  return trimmed
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readTimeout() {
  const parsed = Number(process.env.N8N_DEFAULT_TIMEOUT_MS)
  if (Number.isFinite(parsed) && parsed >= 1000 && parsed <= 30000) return parsed
  return 8000
}

function buildPayload(body: N8nTriggerBody, eventType: N8nEventType, mode: N8nTriggerMode) {
  const merged = readRecord(body.payload)
  const metadata = {
    ...readRecord(merged.metadata),
    ...readRecord(body.metadata),
    ...(body.assistant_mode ? { assistant_mode: body.assistant_mode } : {}),
    ...(body.recent_history ? { recent_history: body.recent_history } : {}),
    triggered_at: new Date().toISOString(),
  }

  return {
    event_type: eventType,
    workspace_id: body.workspace_id || (typeof merged.workspace_id === 'string' ? merged.workspace_id : undefined),
    flow_id: body.flow_id || (typeof merged.flow_id === 'string' ? merged.flow_id : undefined),
    source: 'nowcrm',
    mode,
    timestamp: new Date().toISOString(),
    client: body.client ?? readRecord(merged.client),
    conversation: body.conversation ?? readRecord(merged.conversation),
    message: body.message ?? readRecord(merged.message),
    invoice: body.invoice ?? readRecord(merged.invoice),
    calendar_event: body.calendar_event ?? readRecord(merged.calendar_event),
    activity: body.activity ?? readRecord(merged.activity),
    metadata,
  }
}

async function readN8nResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json() as Record<string, unknown>
    } catch {
      return null
    }
  }

  const text = await response.text().catch(() => '')
  return text ? { raw: text.slice(0, 1000) } : null
}

function extractSuggestedResponse(value: unknown): string | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const suggestion = extractSuggestedResponse(item)
      if (suggestion) return suggestion
    }
    return undefined
  }
  if (typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const direct = record.suggested_response ?? record.suggestedResponse ?? record.response ?? record.text ?? record.message
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  return extractSuggestedResponse(record.data ?? record.output ?? record.result)
}

export async function POST(request: Request) {
  let body: N8nTriggerBody

  try {
    body = await request.json()
  } catch {
    return json('error', 'Payload JSON invalido.', { status: 400 })
  }

  const eventType = normalizeN8nEventType(body.event_type)
  if (!eventType) {
    return json('error', 'event_type no reconocido.', { status: 400 })
  }

  const workspaceId = body.workspace_id || (typeof body.payload?.workspace_id === 'string' ? body.payload.workspace_id : undefined)
  const flowStatus = body.flow_status || (typeof body.payload?.flow_status === 'string' ? body.payload.flow_status as N8nFlowStatus : undefined)
  if (flowStatus === 'inactive') {
    return json('skipped', `Flujo "${eventType}" omitido porque esta inactivo.`, undefined, { event_type: eventType, mode: 'demo' })
  }

  const webhookUrl = normalizeWebhookUrl(body.webhook_url ?? body.endpoint)
  const requestedRealMode = body.mode === 'real'
  if (requestedRealMode && !workspaceId) {
    return json('error', 'workspace_id es obligatorio para ejecutar en modo real.', { status: 400 }, { event_type: eventType, mode: 'real' })
  }

  const mode: N8nTriggerMode = requestedRealMode && webhookUrl ? 'real' : 'demo'
  const payload = buildPayload({ ...body, workspace_id: workspaceId }, eventType, mode)

  if (!webhookUrl) {
    return json('simulated', `Webhook "${eventType}" simulado desde NowCRM.`, undefined, { event_type: eventType, mode: 'demo', payload })
  }

  let url: URL
  try {
    url = new URL(webhookUrl)
  } catch {
    return json('skipped', 'Webhook omitido: URL n8n no valida.', { status: 200 }, { event_type: eventType, mode: 'demo', payload })
  }

  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    return json('skipped', 'Webhook omitido: usa HTTPS o localhost para pruebas.', { status: 200 }, { event_type: eventType, mode: 'demo', payload })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), readTimeout())
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.N8N_WEBHOOK_SECRET) headers['x-nowcrm-secret'] = process.env.N8N_WEBHOOK_SECRET

  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const durationMs = Date.now() - startedAt

    const n8nResponseRaw = await readN8nResponse(response)
    const suggestedResponse = extractSuggestedResponse(n8nResponseRaw)
    const sanitized = sanitizeN8nResponse(n8nResponseRaw)

    return json(response.ok ? 'ok' : 'error', response.ok ? `Webhook "${eventType}" enviado a n8n.` : 'n8n respondio con error.', { status: response.ok ? 200 : 502 }, {
      event_type: eventType,
      mode: 'real',
      http_status: response.status,
      n8n_response: sanitized,
      suggested_response: suggestedResponse,
      execution_id: sanitized?.executionId,
      duration_ms: durationMs,
      activity_created: false,
    })
  } catch {
    clearTimeout(timeout)
    return json('error', 'No se pudo contactar con el endpoint n8n.', { status: 502 }, { event_type: eventType, mode: 'real', duration_ms: Date.now() - startedAt })
  }
}
