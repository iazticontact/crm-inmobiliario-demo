import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { runNowLabsAgent, type AgentContext, type AgentV2Result } from '@/lib/agents/nowlabs-main-agent'
import { detectDeterministicAction } from '@/lib/agents/deterministic-fallback'

export type AssistantErrorCode =
  | 'missing_api_key'
  | 'openai_unauthorized'
  | 'openai_rate_limit'
  | 'openai_timeout'
  | 'model_unavailable'
  | 'workspace_unresolved'
  | 'supabase_unavailable'
  | 'agent_error'
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
  try {
    const body = await req.json() as {
      message?: unknown
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

  // ------------------------------------------------------------------ Agent
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
