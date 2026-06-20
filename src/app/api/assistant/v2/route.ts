import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { runNowLabsAgent, type AgentContext, type AgentV2Result } from '@/lib/agents/nowlabs-main-agent'
import { detectDeterministicAction } from '@/lib/agents/deterministic-fallback'
import { resolveDbAction } from '@/lib/agents/deterministic-db-actions'
import { runN8nAssistant } from '@/lib/agents/n8n-assistant-client'
import { loadThreadMemory, saveActiveEntity, validateActiveEntityUpdate } from '@/lib/agents/assistant-agent-memory'

export type AssistantErrorCode =
  | 'missing_api_key'
  | 'openai_unauthorized'
  | 'openai_rate_limit'
  | 'openai_timeout'
  | 'model_unavailable'
  | 'workspace_unresolved'
  | 'supabase_unavailable'
  | 'agent_error'
  // n8n provider (default brain):
  | 'agent_unreachable'
  | 'missing_provider_config'
  | 'unknown'

async function buildSupabase() {
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
        } catch {
          // route handlers can't always set cookies during static rendering
        }
      },
    },
  })
}

// Maps the raw `error` string from runNowLabsAgent (or a deeper OpenAI throw)
// to a discrete UI-safe code. The route always rewrites the user-facing
// `answer` from this code; the raw OpenAI text never reaches the browser.
function classifyAgentError(rawError: string | undefined): AssistantErrorCode | null {
  if (!rawError) return null
  const e = rawError.toLowerCase()
  if (e === 'missing_api_key' || e.includes('openai_api_key no configurada')) return 'missing_api_key'
  if (e.includes('openai 401') || e.includes('invalid api key') || e.includes('incorrect api key') || e.includes('unauthorized')) return 'openai_unauthorized'
  if (e.includes('openai 429') || e.includes('rate limit') || e.includes('rate_limit') || e.includes('quota')) return 'openai_rate_limit'
  if (e.includes('aborted') || e.includes('timed out') || e.includes('timeout') || e.includes('the operation was aborted')) return 'openai_timeout'
  if (e.includes('openai 404') || (e.includes('model') && (e.includes('not found') || e.includes('does not exist') || e.includes('unavailable')))) return 'model_unavailable'
  return 'agent_error'
}

function answerForErrorCode(code: AssistantErrorCode): string {
  switch (code) {
    case 'missing_api_key':
      return 'Falta configurar OpenAI en el servidor. Avisa al administrador del CRM para activarlo.'
    case 'openai_unauthorized':
      return 'OpenAI ha rechazado la clave del CRM. El administrador tiene que revisarla.'
    case 'openai_rate_limit':
      return 'OpenAI está limitando peticiones ahora mismo. Espera unos segundos y vuelve a probar.'
    case 'openai_timeout':
      return 'OpenAI ha tardado demasiado en responder. Reformula la pregunta o vuelve a intentar.'
    case 'model_unavailable':
      return 'El modelo de IA configurado no está disponible para esta cuenta. Avisa al administrador.'
    case 'workspace_unresolved':
      return 'No he podido resolver tu workspace. Cierra sesión y vuelve a entrar.'
    case 'supabase_unavailable':
      return 'No puedo conectar con la base de datos ahora mismo. Inténtalo en unos segundos.'
    case 'agent_error':
      return 'El agente ha tenido un problema técnico. Vuelve a probar; si persiste, avisa al administrador.'
    case 'agent_unreachable':
      return 'No he podido contactar con el agente ahora mismo. Inténtalo de nuevo en unos segundos.'
    case 'missing_provider_config':
      return 'El agente todavía no está configurado en el servidor. Avisa al administrador del CRM.'
    default:
      return 'No he podido procesar la consulta. Inténtalo de nuevo en unos segundos.'
  }
}

// Single structured log line per invocation. No PII, no secrets, no message
// body, no answer body — only the metadata an on-call engineer needs to spot
// a regression in the dashboard.
//
// `errorCode` reflects what the BROWSER sees. `agentErrorCode` reflects the
// underlying root cause from runNowLabsAgent — populated even when the
// deterministic fallback rescued the user response, so dashboards can still
// alert on a creeping OpenAI failure.
type InvokeLog = {
  event: 'assistant.v2.invoke'
  workspaceResolved: boolean
  openAiConfigured: boolean
  model: string
  errorCode: AssistantErrorCode | null
  agentErrorCode: AssistantErrorCode | null
  hasPreparedAction: boolean
  preparedActionType: string | null
  source: string
  toolCalls: string[] | null
  durationMs: number
}

function logInvoke(payload: InvokeLog): void {
  console.log('[assistant.v2.invoke]', payload)
}

export async function POST(req: NextRequest) {
  const start = Date.now()
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim())
  const model = process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4o-mini'

  // ------------------------------------------------------------------ Supabase
  const supabase = await buildSupabase()
  if (!supabase) {
    const errorCode: AssistantErrorCode = 'supabase_unavailable'
    logInvoke({
      event: 'assistant.v2.invoke',
      workspaceResolved: false,
      openAiConfigured,
      model,
      errorCode,
      agentErrorCode: null,
      hasPreparedAction: false,
      preparedActionType: null,
      source: 'pre_agent',
      toolCalls: null,
      durationMs: Date.now() - start,
    })
    return NextResponse.json({
      ok: false,
      answer: answerForErrorCode(errorCode),
      errorCode,
      debugSource: 'pre_agent',
      preparedAction: null,
    }, { status: 503 })
  }

  // ------------------------------------------------------------------ Auth
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    const errorCode: AssistantErrorCode = 'workspace_unresolved'
    logInvoke({
      event: 'assistant.v2.invoke',
      workspaceResolved: false,
      openAiConfigured,
      model,
      errorCode,
      agentErrorCode: null,
      hasPreparedAction: false,
      preparedActionType: null,
      source: 'pre_agent',
      toolCalls: null,
      durationMs: Date.now() - start,
    })
    return NextResponse.json({
      ok: false,
      answer: answerForErrorCode(errorCode),
      errorCode,
      debugSource: 'pre_agent',
      preparedAction: null,
    }, { status: 401 })
  }

  // ------------------------------------------------------------------ Workspace
  // We also pull `full_name` and `role` to feed the agent's identity layer.
  // These never gate access (RLS handles that) — they only shape tone in the
  // system prompt. Missing columns or null values fall back cleanly to
  // "speak as team assistant" with no name.
  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, full_name, role')
    .eq('id', user.id)
    .maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) {
    const errorCode: AssistantErrorCode = 'workspace_unresolved'
    logInvoke({
      event: 'assistant.v2.invoke',
      workspaceResolved: false,
      openAiConfigured,
      model,
      errorCode,
      agentErrorCode: null,
      hasPreparedAction: false,
      preparedActionType: null,
      source: 'pre_agent',
      toolCalls: null,
      durationMs: Date.now() - start,
    })
    return NextResponse.json({
      ok: false,
      answer: answerForErrorCode(errorCode),
      errorCode,
      debugSource: 'pre_agent',
      preparedAction: null,
    }, { status: 403 })
  }

  // ------------------------------------------------------------------ Body
  let message: string
  let context: AgentContext
  let threadId = ''
  try {
    const body = await req.json() as {
      message?: unknown
      threadId?: unknown
      lastReferencedClientId?: unknown
      lastReferencedClientName?: unknown
      lastResults?: unknown
      lastCalendarResults?: unknown
      lastPreparedAction?: unknown
      lastConfirmedEventId?: unknown
      lastConfirmedClientName?: unknown
      lastConfirmedDate?: unknown
    }
    message = typeof body.message === 'string' ? body.message.trim() : ''
    threadId = typeof body.threadId === 'string' ? body.threadId.trim() : ''
    const rawFullName = (profile as { full_name?: unknown } | null)?.full_name
    const rawRole = (profile as { role?: unknown } | null)?.role
    const displayName = typeof rawFullName === 'string' && rawFullName.trim() ? rawFullName.trim() : undefined
    const role = typeof rawRole === 'string' && rawRole.trim() ? rawRole.trim() : undefined
    context = {
      lastReferencedClientId: typeof body.lastReferencedClientId === 'string' ? body.lastReferencedClientId : undefined,
      lastReferencedClientName: typeof body.lastReferencedClientName === 'string' ? body.lastReferencedClientName : undefined,
      lastResults: Array.isArray(body.lastResults) ? body.lastResults as Record<string, unknown>[] : [],
      lastCalendarResults: Array.isArray(body.lastCalendarResults) ? body.lastCalendarResults as Record<string, unknown>[] : [],
      lastPreparedAction: body.lastPreparedAction && typeof body.lastPreparedAction === 'object'
        ? body.lastPreparedAction as AgentContext['lastPreparedAction']
        : undefined,
      lastConfirmedEventId: typeof body.lastConfirmedEventId === 'string' ? body.lastConfirmedEventId : undefined,
      lastConfirmedClientName: typeof body.lastConfirmedClientName === 'string' ? body.lastConfirmedClientName : undefined,
      lastConfirmedDate: typeof body.lastConfirmedDate === 'string' ? body.lastConfirmedDate : undefined,
      operator: (displayName || role) ? { displayName, role } : undefined,
    }
  } catch {
    return NextResponse.json({
      ok: false,
      answer: 'No he podido leer la petición. Refresca la página y vuelve a intentarlo.',
      errorCode: 'unknown' as AssistantErrorCode,
      debugSource: 'pre_agent',
      preparedAction: null,
    }, { status: 400 })
  }

  if (!message) {
    return NextResponse.json({
      ok: false,
      answer: 'Escribe algo y vuelvo a intentarlo.',
      errorCode: 'unknown' as AssistantErrorCode,
      debugSource: 'pre_agent',
      preparedAction: null,
    }, { status: 400 })
  }

  // ------------------------------------------------------------------ Provider
  // n8n Agent V2 is the DEFAULT brain of the CRM assistant. The legacy V1
  // (runNowLabsAgent + deterministic fallbacks) is reachable ONLY when an
  // operator explicitly sets ASSISTANT_PROVIDER=openai|v1|local — an explicit
  // rollback switch, NEVER a silent fallback when n8n fails.
  const provider = (process.env.ASSISTANT_PROVIDER || 'n8n').trim().toLowerCase()
  const useLegacyV1 = provider === 'openai' || provider === 'v1' || provider === 'local'

  if (!useLegacyV1) {
    // Working memory (N4): persist & recall the active client of this thread in
    // assistant_agent_memory (server-side, RLS, never the LLM). The UI's focused
    // client wins; otherwise we recall what we stored last turn so context
    // survives reloads / cold n8n memory. We also expose the previous entity for
    // "el anterior / vuelve al de antes". Only a reference is stored — no PII.
    // The active CLIENT we SEND to n8n (UI focus wins, else what we recalled),
    // plus the previous client (for "el anterior") and the most recent non-client
    // entity (for "ese inmueble / documento"). The entity the agent RESOLVES this
    // turn is persisted AFTER the call (see below), so a property/document never
    // clobbers the active client.
    const uiClient = context.lastReferencedClientId
      ? { type: 'client' as const, id: context.lastReferencedClientId, label: context.lastReferencedClientName }
      : null
    const mem = threadId
      ? await loadThreadMemory(supabase, threadId, user.id)
      : { client: null, previousClient: null, recent: null }
    const primaryClient = uiClient ?? mem.client
    let activeEntity:
      | {
          type: string; id: string; label?: string
          previous?: { type: string; id: string; label?: string }
          recent?: { type: string; id: string; label?: string }
        }
      | null = null
    if (primaryClient) {
      activeEntity = {
        type: primaryClient.type, id: primaryClient.id, label: primaryClient.label,
        previous: mem.previousClient ?? undefined,
        recent: mem.recent ?? undefined,
      }
    } else if (mem.recent) {
      activeEntity = { type: mem.recent.type, id: mem.recent.id, label: mem.recent.label }
    }

    // Last few turns of THIS thread (RLS via the user's session). n8n keeps its
    // own per-thread Window Memory; this is a cold-start bridge, capped small to
    // avoid token bloat. Fail-soft to []. The just-saved current turn is dropped.
    let recentMessages: Array<{ role: string; content: string }> = []
    if (threadId) {
      const { data: rows } = await supabase
        .from('assistant_messages')
        .select('role, content')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(12)
      if (Array.isArray(rows)) {
        recentMessages = rows
          .map((r) => ({
            role: String((r as { role?: unknown }).role ?? 'user'),
            content: String((r as { content?: unknown }).content ?? ''),
          }))
          .filter((m) => m.content && m.content !== message)
          .reverse()
          .slice(-8)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }))
      }
    }

    const requestId = globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}`
    const n8n = await runN8nAssistant({
      message,
      workspaceId,
      userId: user.id,
      // Stable session key for n8n Window Memory. Falls back to the workspace
      // when the UI hasn't provided a thread id yet.
      threadId: threadId || workspaceId,
      activeEntity,
      recentMessages,
      requestId,
    })

    if (n8n.ok) {
      // Persist the entity the agent ACTUALLY resolved this turn (per type, so a
      // property/document never clobbers the active client). Falls back to the
      // UI-focused client. Server-side write, fail-soft.
      const resolved = validateActiveEntityUpdate(n8n.activeEntityUpdate)
        ?? (uiClient ? { type: uiClient.type, id: uiClient.id, label: uiClient.label } : null)
      if (threadId && resolved) {
        await saveActiveEntity(supabase, { workspaceId, userId: user.id, threadId, entity: resolved })
      }
      const ref = resolved
      logInvoke({
        event: 'assistant.v2.invoke',
        workspaceResolved: true,
        openAiConfigured,
        model: 'n8n:agent-v2',
        errorCode: null,
        agentErrorCode: null,
        hasPreparedAction: false,
        preparedActionType: null,
        source: 'n8n',
        toolCalls: n8n.usedTools.length ? n8n.usedTools : null,
        durationMs: Date.now() - start,
      })
      return NextResponse.json({
        ok: true,
        answer: n8n.reply,
        debugSource: 'n8n',
        mode: 'n8n',
        errorCode: null,
        toolCalls: n8n.usedTools,
        referencedClientId: ref?.type === 'client' ? ref.id : null,
        referencedClientName: ref?.type === 'client' ? (ref.label ?? null) : null,
        referencedList: null,
        referencedCalendarList: null,
        dataPreview: null,
        // n8n Agent V2 is read-only: it never prepares write actions.
        preparedAction: null,
        limitations: n8n.limitations,
      })
    }

    // n8n failed — surface a clear, human error. NO silent fallback to V1.
    const errorCode: AssistantErrorCode =
      n8n.errorCode === 'n8n_not_configured' ? 'missing_provider_config' : 'agent_unreachable'
    logInvoke({
      event: 'assistant.v2.invoke',
      workspaceResolved: true,
      openAiConfigured,
      model: 'n8n:agent-v2',
      errorCode,
      agentErrorCode: null,
      hasPreparedAction: false,
      preparedActionType: null,
      source: `n8n_error:${n8n.errorCode}`,
      toolCalls: null,
      durationMs: Date.now() - start,
    })
    return NextResponse.json({
      ok: false,
      answer: answerForErrorCode(errorCode),
      debugSource: 'n8n',
      mode: 'n8n',
      errorCode,
      toolCalls: null,
      referencedClientId: null,
      referencedClientName: null,
      referencedList: null,
      referencedCalendarList: null,
      dataPreview: null,
      preparedAction: null,
    }, { status: errorCode === 'missing_provider_config' ? 503 : 502 })
  }

  // ------------------------------------------------------------------ Agent (legacy V1, opt-in)
  const agentResult = await runNowLabsAgent(supabase, workspaceId, message, context)

  // ------------------------------------------------------------------ Deterministic fallback
  // Fires only when the primary agent didn't produce a preparedAction. Never
  // overrides an OpenAI-built action. Never invents data: a missing client
  // remains undefined and the user fills it in via the card.
  let finalResult: AgentV2Result = agentResult
  let usedFallback = false
  if (!agentResult.preparedAction) {
    const det = detectDeterministicAction(message)
    if (det) {
      usedFallback = true
      finalResult = {
        ...agentResult,
        answer: det.answer,
        preparedAction: det.preparedAction,
        debugSource: 'deterministic_fallback',
        error: undefined,
      }
    } else {
      // RT5.1b-2 — resolución DB para mover etapa / actualizar tarea o
      // expediente (necesita el id real de la entidad, RLS, sin inventar).
      const dbAction = await resolveDbAction(supabase, workspaceId, message).catch(() => null)
      if (dbAction) {
        usedFallback = true
        finalResult = {
          ...agentResult,
          answer: dbAction.answer,
          preparedAction: dbAction.preparedAction,
          debugSource: 'deterministic_fallback',
          error: undefined,
        }
      }
    }
  }

  // ------------------------------------------------------------------ Error classification
  // Always classify against the ORIGINAL agent result so the log still
  // surfaces the underlying root cause even when fallback rescued the user
  // response.
  const baseCode = classifyAgentError(agentResult.error)
  const errorCode: AssistantErrorCode | null = finalResult.error
    ? (baseCode ?? 'agent_error')
    : null

  // If the agent errored AND fallback didn't engage, replace the raw error
  // string with safe canned copy. The browser must never see OpenAI's verbatim
  // response text.
  if (finalResult.error && !usedFallback) {
    const code = baseCode ?? 'agent_error'
    finalResult = { ...finalResult, answer: answerForErrorCode(code) }
  }

  // ------------------------------------------------------------------ Log
  logInvoke({
    event: 'assistant.v2.invoke',
    workspaceResolved: true,
    openAiConfigured,
    model,
    errorCode,
    agentErrorCode: baseCode,
    hasPreparedAction: Boolean(finalResult.preparedAction),
    preparedActionType: finalResult.preparedAction?.type ?? null,
    source: usedFallback ? 'deterministic_fallback' : (finalResult.debugSource ?? 'unknown'),
    toolCalls: finalResult.toolCalls ?? null,
    durationMs: Date.now() - start,
  })

  return NextResponse.json({
    ok: !finalResult.error,
    answer: finalResult.answer,
    debugSource: finalResult.debugSource,
    errorCode,
    toolCalls: finalResult.toolCalls,
    referencedClientId: finalResult.referencedClientId ?? null,
    referencedClientName: finalResult.referencedClientName ?? null,
    referencedList: finalResult.referencedList ?? null,
    referencedCalendarList: finalResult.referencedCalendarList ?? null,
    dataPreview: finalResult.dataPreview ?? null,
    preparedAction: finalResult.preparedAction ?? null,
  })
}
