// Server-side only. Fires an OPTIONAL n8n webhook after a NowLabs AI action
// has been confirmed and written to Supabase. The contract:
//
//   - n8n is a downstream automation arm, NOT the brain. The Supabase write
//     has already succeeded before this helper is called. If this helper
//     fails for any reason — missing env, SSRF guard, network error, n8n
//     5xx — the caller MUST NOT roll back. The CRM stays consistent.
//   - Always fail-soft: returns `{ ok, reason }`. Never throws.
//   - No tokens or PII in error logs. We log the event type and a short
//     reason code only.
//
// Security model (mirrors /api/n8n/trigger):
//   - Destination URL is built server-side from N8N_BASE_URL + a closed
//     allowlist of slugs. Caller cannot influence the URL.
//   - SSRF defense: target host must match base host. In production we
//     refuse loopback, private IPv4, ULA/link-local IPv6 and cloud
//     metadata endpoints, even if N8N_BASE_URL itself points there.
//   - N8N_WEBHOOK_SECRET only goes to the validated internal URL.

export type AssistantN8nEvent =
  | 'assistant.task_created'
  | 'assistant.booking_created'
  | 'assistant.invoice_prepared'
  | 'assistant.report_prepared'

const SLUGS: Record<AssistantN8nEvent, string> = {
  'assistant.task_created': 'assistant-task-created',
  'assistant.booking_created': 'assistant-booking-created',
  'assistant.invoice_prepared': 'assistant-invoice-prepared',
  'assistant.report_prepared': 'assistant-report-prepared',
}

export type AssistantN8nPayload = {
  /** Workspace owning the entity. Resolved from the user's session, never
   *  from the client. */
  workspaceId: string
  /** UUID of the row that was just created (calendar_event, task, invoice or
   *  activity). May be undefined for `report_prepared` if no row exists. */
  entityId?: string
  /** Client UUID if the action is bound to one. */
  clientId?: string | null
  /** Display name of the client. */
  clientName?: string | null
  /** One-line human summary the workflow may use as a Slack/Email subject.
   *  Never include tokens, secrets, customer documents or internal IDs. */
  summary?: string | null
}

export type AssistantN8nResult = { ok: true } | { ok: false; reason: string }

const TIMEOUT_MS = 5000

function destinationSafe(target: URL, baseUrl: URL): boolean {
  const isLocalhostHost = target.hostname === 'localhost' || target.hostname === '127.0.0.1' || target.hostname === '::1'
  const isProduction = process.env.NODE_ENV === 'production'

  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && isLocalhostHost && !isProduction)) return false
  if (target.hostname !== baseUrl.hostname) return false
  if ((target.port || '') !== (baseUrl.port || '')) return false

  if (isProduction) {
    if (isLocalhostHost) return false
    if (target.hostname === '0.0.0.0' || target.hostname === '::') return false
    if (/^127\./.test(target.hostname)) return false
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(target.hostname)) return false
    const lower = target.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return false
    if (lower.startsWith('::ffff:')) return false
    if (target.hostname === '169.254.169.254' || target.hostname === 'metadata.google.internal') return false
  }

  return true
}

export async function fireAssistantN8nHook(
  eventType: AssistantN8nEvent,
  payload: AssistantN8nPayload,
): Promise<AssistantN8nResult> {
  const rawBase = process.env.N8N_BASE_URL?.trim()
  if (!rawBase) return { ok: false, reason: 'n8n_base_url_missing' }

  let baseUrl: URL
  try {
    baseUrl = new URL(rawBase.replace(/\/$/, ''))
  } catch {
    return { ok: false, reason: 'n8n_base_url_invalid' }
  }

  const slug = SLUGS[eventType]
  if (!slug) return { ok: false, reason: 'event_not_allowed' }

  let target: URL
  try {
    target = new URL(`${baseUrl.origin}${baseUrl.pathname.replace(/\/$/, '')}/webhook/${slug}`)
  } catch {
    return { ok: false, reason: 'url_build_failed' }
  }

  if (!destinationSafe(target, baseUrl)) return { ok: false, reason: 'unsafe_destination' }

  // Whitelisted body. We never echo back the caller's raw object — only the
  // exact fields the contract documents. Keeps the wire surface predictable
  // and prevents accidental token/PII leakage into the workflow.
  const body = {
    eventType,
    source: 'nowcrm',
    timestamp: new Date().toISOString(),
    workspaceId: payload.workspaceId,
    entityId: payload.entityId ?? null,
    clientId: payload.clientId ?? null,
    clientName: payload.clientName ?? null,
    summary: payload.summary ?? null,
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const secret = process.env.N8N_WEBHOOK_SECRET?.trim()
  if (secret) headers['x-nowcrm-secret'] = secret

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (res.ok) return { ok: true }
    console.warn(`[assistant/n8n-hook] ${eventType} http=${res.status}`)
    return { ok: false, reason: `http_${res.status}` }
  } catch (err) {
    clearTimeout(timer)
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[assistant/n8n-hook] ${eventType} failed: ${message.slice(0, 200)}`)
    return { ok: false, reason: 'fetch_failed' }
  }
}
