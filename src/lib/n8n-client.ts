// Server-side only — never import from client components or files marked 'use client'
// Reads N8N_BASE_URL and N8N_API_KEY at call time so hot-reloads pick up changes

export type N8nPlatformStatus = 'pending_config' | 'reachable' | 'unreachable'

export type N8nStatusResult = {
  ok: boolean
  status: N8nPlatformStatus
  baseUrl?: string
  reason?: string
}

export type N8nWorkflowTriggerResult = {
  ok: boolean
  status: 'ok' | 'simulated' | 'error'
  message: string
  httpStatus?: number
}

function getN8nConfig() {
  const baseUrl = (process.env.N8N_BASE_URL ?? '').replace(/\/$/, '')
  const apiKey = process.env.N8N_API_KEY ?? ''
  return { baseUrl, apiKey }
}

export async function checkN8nStatus(): Promise<N8nStatusResult> {
  const { baseUrl, apiKey } = getN8nConfig()
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 'pending_config', reason: 'credentials_not_configured' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`${baseUrl}/api/v1/workflows?limit=1`, {
      headers: { 'X-N8N-API-KEY': apiKey },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return res.ok
      ? { ok: true, status: 'reachable', baseUrl }
      : { ok: false, status: 'unreachable', reason: `http_${res.status}` }
  } catch {
    clearTimeout(timeout)
    return { ok: false, status: 'unreachable', reason: 'connection_failed' }
  }
}

export async function triggerN8nWorkflow(
  slug: string,
  payload: Record<string, unknown>
): Promise<N8nWorkflowTriggerResult> {
  const { baseUrl, apiKey } = getN8nConfig()
  if (!baseUrl) {
    return { ok: false, status: 'simulated', message: 'N8N_BASE_URL no configurada — trigger simulado' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-N8N-API-KEY'] = apiKey
  if (process.env.N8N_WEBHOOK_SECRET) headers['x-nowcrm-secret'] = process.env.N8N_WEBHOOK_SECRET

  try {
    const res = await fetch(`${baseUrl}/webhook/${slug}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return {
      ok: res.ok,
      status: res.ok ? 'ok' : 'error',
      message: res.ok
        ? `Workflow "${slug}" ejecutado correctamente`
        : `n8n respondio con ${res.status}`,
      httpStatus: res.status,
    }
  } catch {
    clearTimeout(timeout)
    return { ok: false, status: 'error', message: 'No se pudo conectar con el servidor n8n' }
  }
}
