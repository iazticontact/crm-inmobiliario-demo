// POST /api/n8n/trigger
//
// Hardened internal bridge between NowCRM and the workspace's n8n instance.
//
// Security model (do NOT regress):
//   - Requires an authenticated Supabase session (cookie). Anonymous callers get 401.
//   - The destination URL is NEVER taken from the request body. Any incoming
//     webhook_url / endpoint fields are silently ignored. Accepting them in the
//     past would have leaked N8N_WEBHOOK_SECRET to an attacker-controlled host.
//   - The slug to call is resolved server-side from a fixed allowlist keyed on
//     the event_type (which is already a closed set).
//   - The final URL is built as `${N8N_BASE_URL}/webhook/${slug}` and re-validated
//     to live under the configured N8N_BASE_URL host before any fetch.
//   - If N8N_BASE_URL is missing or workspace_id does not match the user's, we
//     return a sanitized "simulated"/"skipped" payload instead of attempting a
//     fetch — never a success-looking response with no real call.
//
// Response shape is whitelisted: we never echo the raw n8n response.

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { normalizeN8nEventType, type N8nEventType, type N8nTriggerMode, type N8nTriggerStatus } from '@/lib/integrations'
import type { N8nFlowStatus } from '@/lib/types'

export const runtime = 'nodejs'

type N8nTriggerBody = {
  event_type?: string
  workspace_id?: string
  flow_id?: string
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
  // webhook_url / endpoint are intentionally omitted — they are ignored by the server.
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
  workflow_slug?: string
  reason?: string
}

// Server-side allowlist: event_type → n8n workflow slug.
// The slug is appended to `${N8N_BASE_URL}/webhook/` and that's the only URL we
// will ever POST to. Keep this list in sync with N8N_EVENT_TYPES in integrations.ts.
const EVENT_TO_WORKFLOW_SLUG: Record<N8nEventType, string> = {
  new_lead: 'new-lead',
  client_updated: 'client-updated',
  client_deleted: 'client-deleted',
  whatsapp_message: 'whatsapp-message',
  assistant_message: 'assistant-message',
  conversation_resolved: 'conversation-resolved',
  appointment_booked: 'appointment-booked',
  calendar_event_created: 'calendar-event-created',
  invoice_created: 'invoice-created',
  invoice_paid: 'invoice-paid',
  invoice_overdue: 'invoice-overdue',
  reengagement_needed: 'reengagement-needed',
  daily_summary: 'daily-summary',
  urgent_conversation: 'urgent-conversation',
  test_flow: 'test-flow',
}

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

// Validate that a constructed URL really lives under N8N_BASE_URL host and uses
// a safe protocol. Defense-in-depth against SSRF: even though the URL is built
// server-side from a trusted env var, we still re-check before fetching so a
// misconfigured N8N_BASE_URL (e.g. someone pasted a loopback / metadata host)
// can't be exploited.
function destinationLooksSafe(target: URL, baseUrl: URL, isProduction: boolean): { ok: boolean; reason?: string } {
  // 1) Protocol: HTTPS in prod, HTTP allowed only against localhost in dev.
  const isLocalhostHost = target.hostname === 'localhost' || target.hostname === '127.0.0.1' || target.hostname === '::1'
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && isLocalhostHost && !isProduction)) {
    return { ok: false, reason: 'unsafe_protocol' }
  }

  // 2) The constructed URL must match the configured base.
  if (target.hostname !== baseUrl.hostname) return { ok: false, reason: 'host_mismatch' }
  if ((target.port || '') !== (baseUrl.port || '')) return { ok: false, reason: 'port_mismatch' }

  // 3) In production, refuse loopback, link-local, private IPv4, IPv6 unique-local,
  //    IPv6 link-local, the unspecified address, and cloud metadata endpoints.
  if (isProduction) {
    if (isLocalhostHost) return { ok: false, reason: 'localhost_in_production' }
    if (target.hostname === '0.0.0.0' || target.hostname === '::') {
      return { ok: false, reason: 'unspecified_address' }
    }
    // IPv4 loopback / link-local / RFC1918
    if (/^127\./.test(target.hostname)) return { ok: false, reason: 'loopback_in_production' }
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(target.hostname)) {
      return { ok: false, reason: 'private_ip_in_production' }
    }
    // IPv6: link-local fe80::/10, ULA fc00::/7, IPv4-mapped ::ffff:*
    const lower = target.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return { ok: false, reason: 'ipv6_private_in_production' }
    }
    if (lower.startsWith('::ffff:')) return { ok: false, reason: 'ipv4_mapped_ipv6_in_production' }
    // Cloud instance metadata services — never legitimate as an n8n host.
    if (target.hostname === '169.254.169.254' || target.hostname === 'metadata.google.internal') {
      return { ok: false, reason: 'metadata_endpoint_in_production' }
    }
  }
  return { ok: true }
}

async function getAuthenticatedWorkspace(): Promise<{ userId: string; workspaceId: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null

  const cookieStore = await cookies()
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => { /* no-op */ } },
  })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .maybeSingle()

  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) return null
  return { userId: user.id, workspaceId }
}

export async function POST(request: Request) {
  let body: N8nTriggerBody
  try {
    body = await request.json()
  } catch {
    return json('error', 'Payload JSON invalido.', { status: 400 })
  }

  // 1) Validate event_type against the closed allowlist BEFORE any auth work.
  const eventType = normalizeN8nEventType(body.event_type)
  if (!eventType) {
    return json('error', 'event_type no reconocido.', { status: 400 })
  }

  // 2) Authenticate caller. n8n is an internal automation arm; only logged-in
  //    workspace members can trigger it. Anonymous callers get 401.
  const session = await getAuthenticatedWorkspace()
  if (!session) {
    return json('error', 'No autenticado.', { status: 401 }, { event_type: eventType })
  }

  // 3) Resolve workspace. If the caller specified one, it must match their own.
  const requestedWorkspaceId = body.workspace_id?.trim()
    || (typeof body.payload?.workspace_id === 'string' ? body.payload.workspace_id.trim() : '')
    || ''
  if (requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) {
    return json('error', 'workspace_id no coincide con la sesion.', { status: 403 }, { event_type: eventType })
  }
  const workspaceId = session.workspaceId

  // 4) Apply flow_status gating (a workspace flow can be "inactive").
  const flowStatus = body.flow_status || (typeof body.payload?.flow_status === 'string' ? body.payload.flow_status as N8nFlowStatus : undefined)
  if (flowStatus === 'inactive') {
    return json('skipped', `Flujo "${eventType}" omitido porque esta inactivo.`, undefined, { event_type: eventType, mode: 'demo' })
  }

  const requestedRealMode = body.mode === 'real'
  const payload = buildPayload({ ...body, workspace_id: workspaceId }, eventType, requestedRealMode ? 'real' : 'demo')

  // 5) Look up the destination INTERNALLY. The client cannot influence this.
  const workflowSlug = EVENT_TO_WORKFLOW_SLUG[eventType]
  if (!workflowSlug) {
    // Defensive: shouldn't happen if event_type is in N8N_EVENT_TYPES.
    return json('error', 'Slug de workflow no permitido.', { status: 400 }, { event_type: eventType })
  }

  const rawBase = process.env.N8N_BASE_URL?.trim()
  if (!rawBase) {
    // No real n8n configured → return a simulated success instead of a fake "ok".
    return json('simulated', `Webhook "${eventType}" simulado (N8N_BASE_URL no configurada).`, undefined, {
      event_type: eventType,
      mode: 'demo',
      payload,
      workflow_slug: workflowSlug,
      reason: 'n8n_base_url_missing',
    })
  }

  let baseUrl: URL
  try {
    baseUrl = new URL(rawBase.replace(/\/$/, ''))
  } catch {
    return json('error', 'N8N_BASE_URL invalida en el servidor.', { status: 500 }, { event_type: eventType, mode: 'demo', reason: 'n8n_base_url_invalid' })
  }

  let target: URL
  try {
    target = new URL(`${baseUrl.origin}${baseUrl.pathname.replace(/\/$/, '')}/webhook/${workflowSlug}`)
  } catch {
    return json('error', 'No se pudo construir la URL del webhook n8n.', { status: 500 }, { event_type: eventType, mode: 'demo', workflow_slug: workflowSlug })
  }

  const isProduction = process.env.NODE_ENV === 'production'
  const safety = destinationLooksSafe(target, baseUrl, isProduction)
  if (!safety.ok) {
    return json('error', 'Destino n8n no autorizado.', { status: 502 }, {
      event_type: eventType,
      mode: 'demo',
      workflow_slug: workflowSlug,
      reason: safety.reason,
    })
  }

  // 6) Real call. N8N_WEBHOOK_SECRET only goes to the validated internal URL.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), readTimeout())
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.N8N_WEBHOOK_SECRET?.trim()) headers['x-nowcrm-secret'] = process.env.N8N_WEBHOOK_SECRET.trim()
  if (process.env.N8N_API_KEY?.trim()) headers['X-N8N-API-KEY'] = process.env.N8N_API_KEY.trim()

  const startedAt = Date.now()
  try {
    const response = await fetch(target, {
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

    // Safe log — no payload, no headers, no secrets.
    if (process.env.NODE_ENV !== 'production' || process.env.N8N_LOG_TRIGGERS === '1') {
      console.log('[n8n/trigger]', {
        workspaceId,
        event_type: eventType,
        workflow_slug: workflowSlug,
        http_status: response.status,
        duration_ms: durationMs,
      })
    }

    return json(response.ok ? 'ok' : 'error', response.ok ? `Webhook "${eventType}" enviado a n8n.` : 'n8n respondio con error.', { status: response.ok ? 200 : 502 }, {
      event_type: eventType,
      mode: 'real',
      http_status: response.status,
      n8n_response: sanitized,
      suggested_response: suggestedResponse,
      execution_id: sanitized?.executionId,
      duration_ms: durationMs,
      workflow_slug: workflowSlug,
      activity_created: false,
    })
  } catch {
    clearTimeout(timeout)
    return json('error', 'No se pudo contactar con el endpoint n8n.', { status: 502 }, {
      event_type: eventType,
      mode: 'real',
      duration_ms: Date.now() - startedAt,
      workflow_slug: workflowSlug,
    })
  }
}
