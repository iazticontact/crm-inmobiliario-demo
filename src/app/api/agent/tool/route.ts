// POST /api/agent/tool
//
// Internal server-to-server endpoint for n8n / trusted automations.
// NOT for browsers. NOT for user-driven actions. NOT for anything destructive.
//
// ─────────────────────────────────────────────────────────────────────────────
// Auth model
// ─────────────────────────────────────────────────────────────────────────────
//   - Requires the `x-nowcrm-secret` header matching `AGENT_TOOL_SECRET`
//     (constant-time compare via node:crypto).
//   - Uses SUPABASE_SERVICE_ROLE_KEY internally.
//   - If `AGENT_TOOL_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` or
//     `NEXT_PUBLIC_SUPABASE_URL` is missing, the route is hard-disabled (503
//     `endpoint_disabled`). There is no anon-key fallback.
//
// ─────────────────────────────────────────────────────────────────────────────
// Tenant model
// ─────────────────────────────────────────────────────────────────────────────
//   - `workspace_id` is required in the body and must be a UUID belonging to
//     a row in `workspaces`. Every query is explicitly scoped by
//     `.eq('workspace_id', workspace_id)` — the route can never read or write
//     across tenants even though service role bypasses RLS.
//
// ─────────────────────────────────────────────────────────────────────────────
// Tool allowlist (read + log only)
// ─────────────────────────────────────────────────────────────────────────────
//   - `get_workspace_summary`         — workspace KPIs.
//   - `get_client_summary`            — one client + tiny recent context.
//   - `log_external_automation_event` — single activity row, length-capped.
//
// All previously-available mutating tools (create_client, update_client,
// create_invoice, mark_invoice_paid, create_calendar_event, save_message,
// create_activity, etc.) are explicitly blocked with 410 Gone. Those flows
// now live behind `/api/assistant/confirm` or per-domain routes that resolve
// the caller from a cookie session.

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import {
  getCrmOverview,
  searchClients,
  getClient360,
  getPendingTasks,
  getInvoicesSummary,
  getCalendarSummary,
  getRecentActivity,
  getConversationsSummary,
  getDocumentsMetadata,
  getLatestClient,
  getClientOpportunities,
  getClientServiceCases,
  getPipelineSummary,
  searchProperties,
  crmReadQuery,
  isReaderError,
} from '@/lib/agent-tool-readers'

export const runtime = 'nodejs'

type AllowedTool =
  | 'get_workspace_summary'
  | 'get_client_summary'
  | 'log_external_automation_event'
  | 'get_open_operations'
  | 'get_open_service_cases'
  // Brain reader tools — added for the n8n CRM Agent Brain. All read-only.
  | 'get_crm_overview'
  | 'search_clients'
  | 'get_client_360'
  | 'get_pending_tasks'
  | 'get_invoices_summary'
  | 'get_calendar_summary'
  | 'get_recent_activity'
  | 'get_conversations_summary'
  | 'get_documents_metadata'
  | 'get_latest_client'
  | 'get_client_opportunities'
  | 'get_client_service_cases'
  | 'pipeline_summary'
  | 'search_properties'
  | 'crm_read_query'

const ALLOWED_TOOLS: ReadonlySet<AllowedTool> = new Set<AllowedTool>([
  'get_workspace_summary',
  'get_client_summary',
  'log_external_automation_event',
  'get_open_operations',
  'get_open_service_cases',
  'get_crm_overview',
  'search_clients',
  'get_client_360',
  'get_pending_tasks',
  'get_invoices_summary',
  'get_calendar_summary',
  'get_recent_activity',
  'get_conversations_summary',
  'get_documents_metadata',
  'get_latest_client',
  'get_client_opportunities',
  'get_client_service_cases',
  'pipeline_summary',
  'search_properties',
  'crm_read_query',
])

// Brain reader dispatch. Each handler is read-only, workspace-scoped, and
// returns either a shape-stable result object or `{ error, message }`.
// Keeping this table separate from the original three tools preserves the
// existing response contract (no `meta` field on legacy responses).
type BrainTool =
  | 'get_crm_overview'
  | 'search_clients'
  | 'get_client_360'
  | 'get_pending_tasks'
  | 'get_invoices_summary'
  | 'get_calendar_summary'
  | 'get_recent_activity'
  | 'get_conversations_summary'
  | 'get_documents_metadata'
  | 'get_latest_client'
  | 'get_client_opportunities'
  | 'get_client_service_cases'
  | 'pipeline_summary'
  | 'search_properties'
  | 'crm_read_query'

const BRAIN_TOOLS: Record<BrainTool, (s: SupabaseClient, w: string, i: Record<string, unknown>) => Promise<unknown>> = {
  get_crm_overview: (s, w) => getCrmOverview(s, w),
  search_clients: (s, w, i) => searchClients(s, w, i),
  get_client_360: (s, w, i) => getClient360(s, w, i),
  get_pending_tasks: (s, w, i) => getPendingTasks(s, w, i),
  get_invoices_summary: (s, w, i) => getInvoicesSummary(s, w, i),
  get_calendar_summary: (s, w, i) => getCalendarSummary(s, w, i),
  get_recent_activity: (s, w, i) => getRecentActivity(s, w, i),
  get_conversations_summary: (s, w, i) => getConversationsSummary(s, w, i),
  get_documents_metadata: (s, w, i) => getDocumentsMetadata(s, w, i),
  get_latest_client: (s, w) => getLatestClient(s, w),
  get_client_opportunities: (s, w, i) => getClientOpportunities(s, w, i),
  get_client_service_cases: (s, w, i) => getClientServiceCases(s, w, i),
  pipeline_summary: (s, w) => getPipelineSummary(s, w),
  search_properties: (s, w, i) => searchProperties(s, w, i),
  crm_read_query: (s, w, i) => crmReadQuery(s, w, i),
}

function isBrainTool(t: string): t is BrainTool {
  return Object.prototype.hasOwnProperty.call(BRAIN_TOOLS, t)
}

// Counts the "natural" result quantity per brain tool so the access log can
// surface it without scanning the full payload. Returns null when not
// applicable.
function brainResultCount(tool: BrainTool, result: unknown): number | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  switch (tool) {
    case 'get_crm_overview': {
      const c = r.clients as { total?: number } | undefined
      return c?.total ?? null
    }
    case 'search_clients': return Array.isArray(r.results) ? r.results.length : null
    case 'get_client_360': return r.client ? 1 : 0
    case 'get_pending_tasks': return Array.isArray(r.tasks) ? r.tasks.length : null
    case 'get_invoices_summary': {
      const totals = r.totals as { pendingCount?: number; overdueCount?: number } | undefined
      if (!totals) return null
      return (totals.pendingCount ?? 0) + (totals.overdueCount ?? 0)
    }
    case 'get_calendar_summary': return Array.isArray(r.events) ? r.events.length : null
    case 'get_recent_activity': return Array.isArray(r.activity) ? r.activity.length : null
    case 'get_conversations_summary': return Array.isArray(r.conversations) ? r.conversations.length : null
    case 'get_documents_metadata': return Array.isArray(r.documents) ? r.documents.length : null
    case 'get_latest_client': return r.client ? 1 : 0
    case 'get_client_opportunities': return Array.isArray(r.opportunities) ? r.opportunities.length : null
    case 'get_client_service_cases': return Array.isArray(r.service_cases) ? r.service_cases.length : null
    case 'pipeline_summary': return typeof r.total_open === 'number' ? r.total_open : null
    case 'search_properties': return Array.isArray(r.properties) ? r.properties.length : null
    case 'crm_read_query': return typeof r.count === 'number' ? r.count : null
  }
}

// Tools we used to expose. Returning 410 (instead of 404) tells legacy n8n
// workflows that these endpoints are gone on purpose so the workflow author
// migrates the action to /api/assistant/confirm or to a per-domain route.
const RETIRED_TOOLS: ReadonlySet<string> = new Set<string>([
  'search_clients',
  'get_client_detail',
  'create_client',
  'update_client',
  'create_invoice',
  'mark_invoice_paid',
  'list_invoices',
  'create_calendar_event',
  'list_calendar_events',
  'list_conversations',
  'save_message',
  'create_activity',
  'get_next_best_actions',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// timingSafeEqual throws on length mismatch. Pad to the longer length so we
// don't leak the secret length through the exception path, then check both
// the constant-time bytes and the lengths.
function constantTimeMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  const len = Math.max(a.length, b.length)
  const ap = Buffer.alloc(len)
  const bp = Buffer.alloc(len)
  a.copy(ap)
  b.copy(bp)
  const eq = timingSafeEqual(ap, bp)
  return eq && a.length === b.length
}

function buildServiceClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-nowcrm-source': 'agent-tool' } },
  })
}

function fail(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status })
}

function ok(tool: AllowedTool, result: unknown, message: string) {
  return NextResponse.json({ ok: true, tool, result, message })
}

// Sanitised access log. Never includes the secret, the input payload or PII —
// just enough to correlate a workflow run in server logs with an event.
//
// `meta` is optional and only populated for brain tools (the read tools used
// by the n8n CRM Agent Brain). Existing callers stay backwards-compatible
// because the 4th argument is optional.
function logCall(
  tool: string,
  workspaceId: string,
  status: number,
  meta?: { durationMs?: number; count?: number | null; errorCode?: string },
) {
  const parts = [
    `tool=${tool}`,
    `workspace=${workspaceId.slice(0, 8)}…`,
    `status=${status}`,
  ]
  if (meta?.durationMs !== undefined) parts.push(`durationMs=${meta.durationMs}`)
  if (meta?.count !== undefined && meta.count !== null) parts.push(`count=${meta.count}`)
  if (meta?.errorCode) parts.push(`errorCode=${meta.errorCode}`)
  console.log(`[agent/tool] ${parts.join(' ')}`)
}

export async function POST(request: Request) {
  const start = Date.now()
  // 1. Endpoint must be fully configured to serve any request.
  const expectedSecret = process.env.AGENT_TOOL_SECRET?.trim()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!expectedSecret || !supabaseUrl || !serviceKey) {
    return fail('endpoint_disabled', 503)
  }

  // 2. Secret check — constant time, header is the only auth vector. Browsers
  // never send this header, so this is also what keeps the SPA from calling
  // the endpoint directly.
  const provided = request.headers.get('x-nowcrm-secret')?.trim() ?? ''
  if (!provided || !constantTimeMatch(provided, expectedSecret)) {
    return fail('unauthorized', 401)
  }

  // 3. Body parse.
  let body: { tool?: unknown; workspace_id?: unknown; input?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    return fail('invalid_json', 400)
  }

  // 4. Tool allowlist. Retired tools → 410 with a migration hint.
  const rawTool = asString(body.tool)
  if (!rawTool) return fail('tool_required', 400, { allowed_tools: [...ALLOWED_TOOLS] })
  if (RETIRED_TOOLS.has(rawTool)) {
    return fail('tool_retired', 410, {
      hint: 'Esta herramienta se retiró del endpoint server-to-server. Las acciones que mutan datos viven ahora detrás de /api/assistant/confirm o de la ruta REST por dominio con sesión.',
      allowed_tools: [...ALLOWED_TOOLS],
    })
  }
  if (!ALLOWED_TOOLS.has(rawTool as AllowedTool)) {
    return fail('tool_not_allowed', 400, { allowed_tools: [...ALLOWED_TOOLS] })
  }
  const tool = rawTool as AllowedTool

  // 5. Workspace — required UUID.
  if (!isUuid(body.workspace_id)) {
    return fail('workspace_id_required', 400)
  }
  const workspaceId = body.workspace_id

  const input = (body.input && typeof body.input === 'object' && !Array.isArray(body.input))
    ? body.input as Record<string, unknown>
    : {}

  const supabase = buildServiceClient(supabaseUrl, serviceKey)

  // Tenant existence check — service role bypasses RLS, so we explicitly
  // verify the workspace exists before any read.
  try {
    const { data: ws, error } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (error) {
      logCall(tool, workspaceId, 503)
      return fail('workspace_lookup_failed', 503)
    }
    if (!ws) {
      logCall(tool, workspaceId, 404)
      return fail('workspace_not_found', 404)
    }
  } catch {
    logCall(tool, workspaceId, 503)
    return fail('workspace_lookup_failed', 503)
  }

  // Brain reader tools — used by the n8n CRM Agent Brain. Dispatch through a
  // dedicated table and return early so the legacy three-tool branch below
  // stays untouched (preserves its response contract). Brain responses
  // include a `meta` block with workspaceId, count and durationMs; legacy
  // ones do not.
  if (isBrainTool(tool)) {
    try {
      const result = await BRAIN_TOOLS[tool](supabase, workspaceId, input)
      const durationMs = Date.now() - start
      if (isReaderError(result)) {
        const code = result.error
        const status = code === 'not_found' ? 404 : code === 'invalid_input' ? 422 : 500
        logCall(tool, workspaceId, status, { durationMs, errorCode: code })
        return NextResponse.json({
          ok: false,
          tool,
          error: code,
          message: result.message,
          meta: { workspaceId, durationMs },
        }, { status })
      }
      const count = brainResultCount(tool, result)
      logCall(tool, workspaceId, 200, { durationMs, count })
      return NextResponse.json({
        ok: true,
        tool,
        result,
        message: `${tool}_ok`,
        meta: { workspaceId, count, durationMs },
      })
    } catch {
      const durationMs = Date.now() - start
      logCall(tool, workspaceId, 500, { durationMs, errorCode: 'tool_execution_failed' })
      return NextResponse.json({
        ok: false,
        tool,
        error: 'tool_execution_failed',
        message: 'Error inesperado al ejecutar la herramienta.',
        meta: { workspaceId, durationMs },
      }, { status: 500 })
    }
  }

  try {
    if (tool === 'get_workspace_summary') {
      const today = new Date().toISOString().slice(0, 10)
      const [clients, invoices, events, conversations] = await Promise.all([
        supabase.from('clients').select('id, status, lead_score').eq('workspace_id', workspaceId),
        supabase.from('invoices').select('id, status').eq('workspace_id', workspaceId),
        supabase.from('calendar_events').select('id').eq('workspace_id', workspaceId).neq('status', 'cancelled').gte('date', today),
        supabase.from('conversations').select('id, status').eq('workspace_id', workspaceId),
      ])
      const clientRows = (clients.data ?? []) as Array<{ status?: string; lead_score?: number }>
      const invoiceRows = (invoices.data ?? []) as Array<{ status?: string }>
      const eventRows = (events.data ?? []) as Array<unknown>
      const conversationRows = (conversations.data ?? []) as Array<{ status?: string }>
      const result = {
        workspace_id: workspaceId,
        total_clients: clientRows.length,
        leads: clientRows.filter((c) => c.status === 'lead').length,
        active_clients: clientRows.filter((c) => c.status === 'active').length,
        hot_leads: clientRows.filter((c) => c.status === 'lead' && (c.lead_score ?? 0) >= 75).length,
        pending_invoices: invoiceRows.filter((i) => i.status === 'pending').length,
        overdue_invoices: invoiceRows.filter((i) => i.status === 'overdue').length,
        upcoming_events: eventRows.length,
        open_conversations: conversationRows.filter((c) => c.status !== 'resolved').length,
        generated_at: new Date().toISOString(),
      }
      logCall(tool, workspaceId, 200)
      return ok(tool, result, 'workspace_summary_ok')
    }

    if (tool === 'get_open_operations') {
      const { data, error } = await supabase
        .from('opportunities')
        .select('id, title, stage, value')
        .eq('workspace_id', workspaceId)
        .not('stage', 'in', '("won","lost")')
        .order('updated_at', { ascending: false })
        .limit(25)
      if (error) {
        logCall(tool, workspaceId, 503)
        return fail('operations_lookup_failed', 503)
      }
      const rows = ((data ?? []) as Array<Record<string, unknown>>).map((o) => ({ title: o.title, status: o.stage, value: o.value }))
      logCall(tool, workspaceId, 200)
      return ok(tool, rows, 'open_operations_ok')
    }

    if (tool === 'get_open_service_cases') {
      const { data, error } = await supabase
        .from('service_cases')
        .select('id, title, status, case_type')
        .eq('workspace_id', workspaceId)
        .not('status', 'in', '("resolved","closed")')
        .order('updated_at', { ascending: false })
        .limit(25)
      if (error) {
        logCall(tool, workspaceId, 503)
        return fail('service_cases_lookup_failed', 503)
      }
      const rows = ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({ title: c.title, status: c.status, case_type: c.case_type }))
      logCall(tool, workspaceId, 200)
      return ok(tool, rows, 'open_service_cases_ok')
    }

    if (tool === 'get_client_summary') {
      const clientId = asString(input.client_id)
      if (!isUuid(clientId)) {
        logCall(tool, workspaceId, 400)
        return fail('client_id_required', 400)
      }
      const { data: client, error } = await supabase
        .from('clients')
        .select('id, name, company, email, channel, status, lead_score, created_at, notes')
        .eq('workspace_id', workspaceId)
        .eq('id', clientId)
        .maybeSingle()
      if (error) {
        logCall(tool, workspaceId, 503)
        return fail('client_lookup_failed', 503)
      }
      if (!client) {
        logCall(tool, workspaceId, 404)
        return fail('client_not_in_workspace', 404)
      }
      const [invoices, events] = await Promise.all([
        supabase
          .from('invoices')
          .select('id, status, amount, currency, due_date, concept')
          .eq('workspace_id', workspaceId)
          .eq('client_id', clientId)
          .order('due_date', { ascending: false })
          .limit(5),
        supabase
          .from('calendar_events')
          .select('id, title, date, start_at, status')
          .eq('workspace_id', workspaceId)
          .eq('client_id', clientId)
          .neq('status', 'cancelled')
          .order('start_at', { ascending: false })
          .limit(5),
      ])
      logCall(tool, workspaceId, 200)
      return ok(tool, {
        client,
        recent_invoices: invoices.data ?? [],
        recent_events: events.data ?? [],
      }, 'client_summary_ok')
    }

    if (tool === 'log_external_automation_event') {
      const eventType = asString(input.event_type)
      const description = asString(input.description)
      if (!eventType) {
        logCall(tool, workspaceId, 400)
        return fail('event_type_required', 400)
      }
      if (eventType.length > 60) {
        logCall(tool, workspaceId, 422)
        return fail('event_type_too_long', 422)
      }
      if (!description) {
        logCall(tool, workspaceId, 400)
        return fail('description_required', 400)
      }
      if (description.length > 500) {
        logCall(tool, workspaceId, 422)
        return fail('description_too_long', 422)
      }
      const rawClientName = asString(input.client_name)
      const clientName = rawClientName ? rawClientName.slice(0, 120) : null

      // If client_id is provided, validate it belongs to this workspace.
      // We do NOT trust the client_name from the payload — if a UUID is given,
      // we override the name with the canonical row, same contract as
      // /api/assistant/confirm.
      let resolvedClientName = clientName
      const rawClientId = asString(input.client_id)
      if (rawClientId) {
        if (!isUuid(rawClientId)) {
          logCall(tool, workspaceId, 400)
          return fail('invalid_client_id', 400)
        }
        const { data: clientRow, error: clientErr } = await supabase
          .from('clients')
          .select('name')
          .eq('workspace_id', workspaceId)
          .eq('id', rawClientId)
          .maybeSingle()
        if (clientErr) {
          logCall(tool, workspaceId, 503)
          return fail('client_lookup_failed', 503)
        }
        if (!clientRow) {
          logCall(tool, workspaceId, 404)
          return fail('client_not_in_workspace', 404)
        }
        const canonicalName = typeof clientRow.name === 'string' ? clientRow.name.trim() : ''
        if (canonicalName) resolvedClientName = canonicalName.slice(0, 120)
      }

      const { data, error } = await supabase
        .from('activities')
        .insert({
          workspace_id: workspaceId,
          type: 'note',
          description: `[n8n:${eventType.slice(0, 50)}] ${description}`,
          client_name: resolvedClientName,
        })
        .select('id')
        .single()
      if (error || !data) {
        logCall(tool, workspaceId, 500)
        return fail('activity_insert_failed', 500)
      }
      logCall(tool, workspaceId, 200)
      return ok(tool, { id: String(data.id), event_type: eventType }, 'activity_logged')
    }

    logCall(tool, workspaceId, 500)
    return fail('tool_not_implemented', 500)
  } catch {
    logCall(tool, workspaceId, 500)
    return fail('tool_execution_failed', 500)
  }
}
