// POST /api/assistant/confirm
//
// Server-side execution of an action that NowLabs AI has prepared in chat.
//
// Trust model:
//   - The caller is an authenticated CRM user. Auth comes from the Supabase
//     cookie session — NEVER from request body.
//   - workspace_id and user_id are resolved from `profiles` keyed on the
//     session user. Any `workspace_id` or `user_id` field in the body is
//     silently ignored.
//   - `preparedAction` in the body is treated as UNTRUSTED HINTS. The chat
//     UI is the producer but a hostile client could craft any object, so
//     every field is re-validated here:
//       * type must be in the allowlist
//       * missingFields must be empty
//       * clientId, if present, must be a UUID belonging to THIS workspace
//       * required per-type fields must be present and well-formed
//   - Writes go through the same cookie-bound Supabase client used for auth,
//     so RLS enforces workspace isolation as the last line of defence.
//   - After a successful write we fire-and-forget the optional n8n hook.
//     The hook NEVER blocks the response and CANNOT undo the write — if n8n
//     is down or unconfigured, the CRM action still stands.
//
// Response shape: `{ ok, type, entityId, message }` on success,
//                 `{ ok:false, error, missingFields? }` on failure.
//                 Never echoes Supabase error text raw — only friendly
//                 reasons the UI can render.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildCalendarEventTimes } from '@/lib/calendar-time'
import {
  fireAssistantN8nHook,
  type AssistantN8nEvent,
  type AssistantN8nPayload,
} from '@/lib/assistant-n8n-hook'

export const runtime = 'nodejs'

type PreparedActionType = 'booking' | 'task' | 'invoice' | 'report'

type ConfirmableAction = {
  type?: unknown
  clientId?: unknown
  clientName?: unknown
  // booking
  service?: unknown
  date?: unknown
  time?: unknown
  duration?: unknown
  // task
  taskTitle?: unknown
  description?: unknown
  // invoice
  amount?: unknown
  concept?: unknown
  // report (lightweight: a description-only summary persisted as an activity)
  // common
  dueDate?: unknown
  notes?: unknown
  missingFields?: unknown
  // provenance — optional, used only as metadata so the chat thread can later
  // link back to the row. Validated as a UUID; anything else is ignored.
  conversationId?: unknown
}

const ALLOWED_TYPES: ReadonlySet<PreparedActionType> = new Set(['booking', 'task', 'invoice', 'report'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

// Strict ISO-8601 calendar-date parser. Regex-only validation lets garbage like
// "2026-02-31" or "2026-13-01" through and JS's `new Date(...)` silently rolls
// them over (Feb 31 → Mar 3). That eventually lands in calendar_events.date as
// a date that doesn't match the user's intent. Here we:
//   - require exact `YYYY-MM-DD` shape (no `2026-1-1`)
//   - build a UTC date from the parts and verify the components round-trip,
//     which catches month/day out-of-range without depending on locale.
// Returns the original string if valid, null otherwise.
function parseStrictIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null
  }
  return value
}

// HH:MM strict — hour 00..23, minute 00..59. 24:00 is explicitly rejected
// because buildCalendarEventTimes treats hour=24 as the next-day midnight,
// which is a footgun for a "create a meeting" flow.
function parseStrictHhmm(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null
}

// Hard upper bound for invoice amounts. Our `invoices.amount` column is
// numeric(12,2); anything past ~10^10 explodes the column with a 22003 from
// Postgres and surfaces to the user as a generic 500. Cap below that with
// some headroom, and require at most 2 decimals.
const INVOICE_AMOUNT_MAX = 9_999_999.99
function parseInvoiceAmount(value: unknown): number | null {
  const n = asNumber(value)
  if (n === null || !Number.isFinite(n)) return null
  if (n <= 0 || n > INVOICE_AMOUNT_MAX) return null
  // Reject silent float artefacts like 12.345 — round to 2dp and require equality.
  const rounded = Math.round(n * 100) / 100
  if (Math.abs(rounded - n) > 1e-9) return null
  return rounded
}

async function buildSupabase(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch { /* route handlers can't always update cookies during static rendering */ }
      },
    },
  })
}

type ResolvedSession = { supabase: SupabaseClient; userId: string; workspaceId: string }

async function resolveSession(): Promise<ResolvedSession | NextResponse> {
  const supabase = await buildSupabase()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })
  }
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })
  }
  return { supabase, userId: user.id, workspaceId }
}

type CanonicalClient = {
  id: string
  name: string
  company: string | null
  email: string | null
}

type ResolveClientOk = { ok: true; client: CanonicalClient | null }
type ResolveClientErr = {
  ok: false
  status: number
  error: string
  // Only populated for ambiguous_client — at most 5 candidates so the UI can
  // disambiguate without us leaking the whole address book.
  candidates?: Array<{ id: string; name: string; company: string | null }>
}

// Resolves the *canonical* client for an action.
//
// Why we don't trust `action.clientName`:
//   - The chat layer may pass a name the LLM hallucinated.
//   - A hostile client can craft any combination of clientId + clientName, so
//     the row we write must come from `clients`, never from the body.
//
// Resolution order:
//   1. If clientId is present: must be a UUID in this workspace. Body's
//      clientName is ignored — we use clients.name.
//   2. If only clientName is present: ilike search by name/company/email in
//      this workspace. 1 hit ⇒ canonical, 0 ⇒ client_not_found, ≥2 ⇒
//      ambiguous_client with up to 5 candidates.
//   3. If neither: caller decides whether the action needs a client.
async function resolveActionClient(
  supabase: SupabaseClient,
  workspaceId: string,
  rawClientId: unknown,
  rawClientName: unknown,
): Promise<ResolveClientOk | ResolveClientErr> {
  // Path 1 — UUID provided.
  if (rawClientId !== undefined && rawClientId !== null && rawClientId !== '') {
    if (!isUuid(rawClientId)) {
      return { ok: false, status: 422, error: 'invalid_client_id' }
    }
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, company, email')
      .eq('workspace_id', workspaceId)
      .eq('id', rawClientId)
      .maybeSingle()
    if (error || !data) return { ok: false, status: 403, error: 'client_not_in_workspace' }
    return {
      ok: true,
      client: {
        id: String(data.id),
        name: typeof data.name === 'string' ? data.name : '',
        company: typeof data.company === 'string' ? data.company : null,
        email: typeof data.email === 'string' ? data.email : null,
      },
    }
  }

  // Path 2 — name-only resolution.
  const name = asString(rawClientName)
  if (name) {
    // Escape PostgREST ilike wildcards. We want a *literal* substring match
    // so the user can't smuggle `%` or `_` to widen the search.
    const escaped = name.replace(/[\\%_]/g, (c) => `\\${c}`)
    const needle = `%${escaped}%`
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, company, email')
      .eq('workspace_id', workspaceId)
      .or(`name.ilike.${needle},company.ilike.${needle},email.ilike.${needle}`)
      .limit(6)
    if (error) return { ok: false, status: 503, error: 'client_lookup_failed' }
    const rows = (data ?? []) as Array<{ id: unknown; name: unknown; company: unknown; email: unknown }>
    if (rows.length === 0) return { ok: false, status: 404, error: 'client_not_found' }
    if (rows.length > 1) {
      return {
        ok: false,
        status: 409,
        error: 'ambiguous_client',
        candidates: rows.slice(0, 5).map((r) => ({
          id: String(r.id),
          name: typeof r.name === 'string' ? r.name : '',
          company: typeof r.company === 'string' ? r.company : null,
        })),
      }
    }
    const only = rows[0]
    return {
      ok: true,
      client: {
        id: String(only.id),
        name: typeof only.name === 'string' ? only.name : '',
        company: typeof only.company === 'string' ? only.company : null,
        email: typeof only.email === 'string' ? only.email : null,
      },
    }
  }

  // Path 3 — caller didn't bind a client. Each action type decides whether
  // that's a hard error (booking/invoice) or fine (task/report).
  return { ok: true, client: null }
}

function fireHook(
  supabase: SupabaseClient,
  eventType: AssistantN8nEvent,
  payload: AssistantN8nPayload,
) {
  // Fire-and-forget. If the hook fails for any reason other than "n8n not
  // configured" we drop a single activity row so the operator can see the
  // gap in their feed — the CRM write itself remains untouched.
  void fireAssistantN8nHook(eventType, payload).then(async (result) => {
    if (result.ok) return
    if (result.reason === 'n8n_base_url_missing') return // expected when n8n is off
    try {
      await supabase.from('activities').insert({
        workspace_id: payload.workspaceId,
        type: 'note',
        description: `Webhook n8n no entregado (${eventType}): ${result.reason}`,
        client_name: payload.clientName ?? null,
      })
    } catch {
      // Activity log is best-effort. We already console.warn from the hook.
    }
  }).catch(() => undefined)
}

export async function POST(req: NextRequest) {
  const session = await resolveSession()
  if (session instanceof NextResponse) return session
  const { supabase, workspaceId } = session

  let action: ConfirmableAction
  try {
    const body = await req.json() as { preparedAction?: ConfirmableAction }
    if (!body?.preparedAction || typeof body.preparedAction !== 'object') {
      return NextResponse.json({ ok: false, error: 'preparedAction requerido' }, { status: 400 })
    }
    action = body.preparedAction
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 })
  }

  const type = typeof action.type === 'string' ? action.type as PreparedActionType : undefined
  if (!type || !ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ ok: false, error: 'tipo_no_permitido' }, { status: 422 })
  }

  // The chat layer is supposed to clear missingFields before showing the
  // confirm button, but we re-check here so a hostile client can't bypass it.
  if (Array.isArray(action.missingFields) && action.missingFields.length > 0) {
    return NextResponse.json({
      ok: false,
      error: 'missing_fields',
      missingFields: action.missingFields.filter((v) => typeof v === 'string'),
    }, { status: 422 })
  }

  // Resolve the *canonical* client row up-front. Everything that lands in
  // calendar_events/invoices/tasks/activities uses this row — never the body.
  const resolved = await resolveActionClient(supabase, workspaceId, action.clientId, action.clientName)
  if (!resolved.ok) {
    const payload: Record<string, unknown> = { ok: false, error: resolved.error }
    if (resolved.error === 'ambiguous_client' && resolved.candidates) {
      payload.candidates = resolved.candidates
    }
    return NextResponse.json(payload, { status: resolved.status })
  }
  const canonicalClient = resolved.client
  const clientId = canonicalClient?.id ?? null
  const clientName = canonicalClient?.name?.trim() || null

  const conversationId = isUuid(action.conversationId) ? action.conversationId : null
  const baseMetadata = conversationId
    ? { source: 'nowlabs_ai_confirm', conversation_id: conversationId }
    : { source: 'nowlabs_ai_confirm' }

  // -------------------- BOOKING --------------------
  if (type === 'booking') {
    if (!clientName) {
      return NextResponse.json({ ok: false, error: 'client_required' }, { status: 422 })
    }
    const date = parseStrictIsoDate(action.date)
    if (!date) return NextResponse.json({ ok: false, error: 'booking_invalid_date' }, { status: 422 })
    const time = parseStrictHhmm(action.time)
    if (!time) return NextResponse.json({ ok: false, error: 'booking_invalid_time' }, { status: 422 })

    const service = asString(action.service) || 'Reunión comercial'
    const requestedDuration = asNumber(action.duration)
    const duration = requestedDuration !== null && requestedDuration > 0 && requestedDuration <= 8 * 60
      ? Math.floor(requestedDuration)
      : 60
    const notes = asString(action.notes) || null
    const times = buildCalendarEventTimes({ date, time, duration })

    const { data, error } = await supabase.from('calendar_events').insert({
      workspace_id: workspaceId,
      title: `${service} con ${clientName}`,
      date: times.date,
      start_at: times.startAtIso,
      end_at: times.endAtIso,
      start_hour: times.startHour,
      start_minute: times.startMinute,
      duration: times.duration,
      type: 'meeting',
      client_id: clientId,
      client_name: clientName,
      notes,
      description: notes ?? 'Cita creada desde el Asistente IA',
      status: 'scheduled',
      metadata: baseMetadata,
    }).select('id').single()

    if (error || !data) {
      if (process.env.NODE_ENV === 'development') console.error('[assistant/confirm:booking]', error?.message)
      return NextResponse.json({ ok: false, error: 'booking_create_failed' }, { status: 500 })
    }

    void supabase.from('activities').insert({
      workspace_id: workspaceId,
      type: 'call',
      description: `Cita creada desde el Asistente IA: ${service} con ${clientName}`,
      client_name: clientName,
    }).then(() => undefined, () => undefined)

    fireHook(supabase, 'assistant.booking_created', {
      workspaceId,
      entityId: String(data.id),
      clientId,
      clientName,
      summary: `${service} el ${date} a las ${time}`,
    })

    return NextResponse.json({
      ok: true,
      type: 'booking',
      entityId: String(data.id),
      message: `Cita creada para ${clientName} el ${date} a las ${time}.`,
    })
  }

  // -------------------- TASK --------------------
  if (type === 'task') {
    const taskTitle = asString(action.taskTitle)
    if (!taskTitle) return NextResponse.json({ ok: false, error: 'task_missing_title' }, { status: 422 })
    const description = asString(action.description) || null
    let dueDate: string | null = null
    if (action.dueDate !== undefined && action.dueDate !== null && action.dueDate !== '') {
      dueDate = parseStrictIsoDate(action.dueDate)
      if (!dueDate) return NextResponse.json({ ok: false, error: 'task_invalid_due_date' }, { status: 422 })
    }

    const { data, error } = await supabase.from('tasks').insert({
      workspace_id: workspaceId,
      title: taskTitle,
      description,
      client_id: clientId,
      client_name: clientName,
      due_date: dueDate,
      status: 'pending',
      priority: 'normal',
      metadata: baseMetadata,
    }).select('id').single()

    if (error || !data) {
      if (process.env.NODE_ENV === 'development') console.error('[assistant/confirm:task]', error?.message)
      return NextResponse.json({ ok: false, error: 'task_create_failed' }, { status: 500 })
    }

    void supabase.from('activities').insert({
      workspace_id: workspaceId,
      type: 'note',
      description: `Tarea creada desde el Asistente IA: ${taskTitle}`,
      client_name: clientName,
    }).then(() => undefined, () => undefined)

    fireHook(supabase, 'assistant.task_created', {
      workspaceId,
      entityId: String(data.id),
      clientId,
      clientName,
      summary: taskTitle,
    })

    return NextResponse.json({
      ok: true,
      type: 'task',
      entityId: String(data.id),
      message: `Tarea creada: "${taskTitle}"${clientName ? ` para ${clientName}` : ''}${dueDate ? `, vence ${dueDate}` : ''}.`,
    })
  }

  // -------------------- INVOICE --------------------
  if (type === 'invoice') {
    if (!clientName) return NextResponse.json({ ok: false, error: 'client_required' }, { status: 422 })
    const amount = parseInvoiceAmount(action.amount)
    if (amount === null) return NextResponse.json({ ok: false, error: 'invoice_invalid_amount' }, { status: 422 })
    let dueDate: string | null = null
    if (action.dueDate !== undefined && action.dueDate !== null && action.dueDate !== '') {
      dueDate = parseStrictIsoDate(action.dueDate)
      if (!dueDate) return NextResponse.json({ ok: false, error: 'invoice_invalid_due_date' }, { status: 422 })
    }
    const concept = asString(action.concept) || 'Servicio CRM'
    const today = new Date().toISOString().slice(0, 10)
    const finalDueDate = dueDate ?? (() => {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() + 14)
      return d.toISOString().slice(0, 10)
    })()

    const { data, error } = await supabase.from('invoices').insert({
      workspace_id: workspaceId,
      client_id: clientId,
      client_name: clientName,
      concept,
      plan: concept,
      amount,
      currency: 'EUR',
      status: 'pending',
      issue_date: today,
      due_date: finalDueDate,
      notes: asString(action.notes) || null,
      metadata: baseMetadata,
    }).select('id').single()

    if (error || !data) {
      if (process.env.NODE_ENV === 'development') console.error('[assistant/confirm:invoice]', error?.message)
      return NextResponse.json({ ok: false, error: 'invoice_create_failed' }, { status: 500 })
    }

    void supabase.from('activities').insert({
      workspace_id: workspaceId,
      type: 'deal',
      description: `Factura creada desde el Asistente IA: ${concept} para ${clientName}`,
      client_name: clientName,
    }).then(() => undefined, () => undefined)

    fireHook(supabase, 'assistant.invoice_prepared', {
      workspaceId,
      entityId: String(data.id),
      clientId,
      clientName,
      summary: `${concept}, ${amount}€, vence ${finalDueDate}`,
    })

    return NextResponse.json({
      ok: true,
      type: 'invoice',
      entityId: String(data.id),
      message: `Factura creada para ${clientName}: ${concept}, ${amount}€, vence ${finalDueDate}.`,
    })
  }

  // -------------------- REPORT --------------------
  // Reports don't have a dedicated table yet. We persist them as an activity
  // (auditable trail in the workspace feed) and surface the n8n hook so a
  // downstream workflow can produce a PDF / Notion page / Slack post.
  if (type === 'report') {
    const summary = asString(action.description) || asString(action.taskTitle) || 'Informe del Asistente IA'
    const { data, error } = await supabase.from('activities').insert({
      workspace_id: workspaceId,
      type: 'note',
      description: `Informe preparado desde el Asistente IA: ${summary}`,
      client_name: clientName,
    }).select('id').single()

    if (error) {
      if (process.env.NODE_ENV === 'development') console.error('[assistant/confirm:report]', error?.message)
      return NextResponse.json({ ok: false, error: 'report_log_failed' }, { status: 500 })
    }

    const entityId = data?.id ? String(data.id) : undefined

    fireHook(supabase, 'assistant.report_prepared', {
      workspaceId,
      entityId,
      clientId,
      clientName,
      summary,
    })

    return NextResponse.json({
      ok: true,
      type: 'report',
      entityId: entityId ?? null,
      message: `Informe preparado: ${summary}.`,
    })
  }

  // Defensive — exhaustive switch should have caught everything.
  return NextResponse.json({ ok: false, error: 'tipo_no_implementado' }, { status: 422 })
}
