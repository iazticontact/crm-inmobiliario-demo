// Server-side ONLY. Adapter that calls the n8n "CRM Agent V2" webhook — the
// real brain of the CRM assistant — and normalizes its response.
//
// NEVER import this from a client component or a file marked 'use client'.
//
// ─────────────────────────────────────────────────────────────────────────────
// Security model
// ─────────────────────────────────────────────────────────────────────────────
//   - URL + secret come from SERVER env only:
//       N8N_ASSISTANT_V2_WEBHOOK_URL  (e.g. https://.../webhook/crm-agent-v2)
//       N8N_ASSISTANT_V2_SECRET       (shared secret; webhook is gated on it)
//     Falls back to N8N_BASE_URL + '/webhook/crm-agent-v2' if the explicit URL
//     is not set. Never NEXT_PUBLIC_, never reaches the browser.
//   - The secret travels only in the `x-nowcrm-agent-secret` header to the
//     validated n8n URL.
//   - `workspaceId` / `userId` are resolved from the caller's session upstream,
//     never from the browser body. This client just forwards them.
//   - Fail-soft: returns a discriminated result; never throws.

export type N8nAssistantActiveEntity =
  | {
      type: string
      id: string
      label?: string
      previous?: { type: string; id: string; label?: string }
      recent?: { type: string; id: string; label?: string }
    }
  | null

export type N8nAssistantParams = {
  message: string
  workspaceId: string
  userId: string
  threadId: string
  activeEntity: N8nAssistantActiveEntity
  recentMessages: Array<{ role: string; content: string }>
  requestId: string
}

export type N8nAssistantErrorCode =
  | 'n8n_not_configured'
  | 'n8n_unauthorized'
  | 'n8n_timeout'
  | 'n8n_bad_response'
  | 'n8n_unreachable'
  | 'n8n_error'

export type N8nAssistantResult =
  | {
      ok: true
      reply: string
      usedTools: string[]
      activeEntityUpdate: N8nAssistantActiveEntity
      limitations: string[]
    }
  | { ok: false; errorCode: N8nAssistantErrorCode; detail?: string }

// The agent loop (OpenAI + read tools + CRM round-trips) can take several
// seconds. Generous but bounded so a hung n8n can't pin the request open.
const TIMEOUT_MS = 45_000

function resolveConfig(): { url: string; secret: string } | null {
  const explicit = process.env.N8N_ASSISTANT_V2_WEBHOOK_URL?.trim()
  const base = process.env.N8N_BASE_URL?.trim().replace(/\/$/, '')
  const url = explicit || (base ? `${base}/webhook/crm-agent-v2` : '')
  const secret = process.env.N8N_ASSISTANT_V2_SECRET?.trim() ?? ''
  if (!url || !secret) return null
  try {
    const u = new URL(url)
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    const httpsOk = u.protocol === 'https:'
    const httpLocalOk = u.protocol === 'http:' && isLocal && process.env.NODE_ENV !== 'production'
    if (!httpsOk && !httpLocalOk) return null
  } catch {
    return null
  }
  return { url, secret }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// n8n's "Respond to Webhook" returns { reply, usedTools, activeEntityUpdate,
// limitations, error, requestId }. But to stay robust against workflow edits
// we also accept `output` (raw AI Agent shape), a bare string, or a nested
// { data: {...} } envelope.
function normalizeReply(data: unknown): string | null {
  if (typeof data === 'string') return data.trim() || null
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    for (const key of ['reply', 'output', 'answer', 'text', 'response']) {
      const v = o[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    if (o.data && typeof o.data === 'object') return normalizeReply(o.data)
    if (Array.isArray(o.data)) return normalizeReply(o.data[0])
  }
  return null
}

function normalizeActiveEntity(v: unknown): N8nAssistantActiveEntity {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const type = typeof o.type === 'string' ? o.type : undefined
    const id = typeof o.id === 'string' ? o.id : undefined
    if (type && id) return { type, id, label: typeof o.label === 'string' ? o.label : undefined }
  }
  return null
}

export async function runN8nAssistant(params: N8nAssistantParams): Promise<N8nAssistantResult> {
  const cfg = resolveConfig()
  if (!cfg) return { ok: false, errorCode: 'n8n_not_configured' }

  const body = {
    message: params.message,
    workspaceId: params.workspaceId,
    userId: params.userId,
    threadId: params.threadId,
    activeEntity: params.activeEntity,
    recentMessages: params.recentMessages,
    requestId: params.requestId,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nowcrm-agent-secret': cfg.secret },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    const aborted = err instanceof Error && err.name === 'AbortError'
    return { ok: false, errorCode: aborted ? 'n8n_timeout' : 'n8n_unreachable' }
  }
  clearTimeout(timer)

  if (res.status === 401 || res.status === 403) return { ok: false, errorCode: 'n8n_unauthorized' }
  if (!res.ok) return { ok: false, errorCode: 'n8n_error', detail: `http_${res.status}` }

  // Read the body once; tolerate JSON or plain text.
  const rawText = await res.text().catch(() => '')
  let data: unknown = rawText
  try {
    data = JSON.parse(rawText)
  } catch {
    // keep rawText as-is (plain-text reply)
  }

  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  if (typeof obj.error === 'string' && obj.error.trim()) {
    return { ok: false, errorCode: 'n8n_error', detail: obj.error.slice(0, 160) }
  }

  const reply = normalizeReply(data)
  if (!reply) return { ok: false, errorCode: 'n8n_bad_response' }

  return {
    ok: true,
    reply,
    usedTools: asStringArray(obj.usedTools),
    activeEntityUpdate: normalizeActiveEntity(obj.activeEntityUpdate),
    limitations: asStringArray(obj.limitations),
  }
}
