import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { runNowLabsAgent, type AgentContext, type AgentV2Result } from '@/lib/agents/nowlabs-main-agent'
import { detectDeterministicAction } from '@/lib/agents/deterministic-fallback'
import { resolveDbAction } from '@/lib/agents/deterministic-db-actions'
import { runN8nAssistant } from '@/lib/agents/n8n-assistant-client'
import { loadThreadMemory, saveActiveEntity, validateActiveEntityUpdate } from '@/lib/agents/assistant-agent-memory'
import { loadConversationState, saveConversationState, applyStateUpdate, reduceStateForN8n } from '@/lib/agents/conversation-state'
import { tryLocalAnswer, executeUiAction } from '@/lib/agents/local-answers'
import { plannerMode, plannerShadowObserve, plannerAnswer } from '@/lib/agents/planner/shadow-hook'
import { validateAssistantUi } from '@/lib/assistant/ui-contract'
import { decideTurn } from '@/lib/agents/assistant-turn'
import type { CrmModuleId } from '@/lib/agents/crm-module-catalog'
import { allowedToolsForTurn } from '@/lib/agents/assistant-tool-permissions'
import { signTurnPolicy } from '@/lib/agents/turn-policy'
import { resolveAssistantProvider } from '@/lib/agents/assistant-provider'
import { checkAssistantInput, checkRateLimit, truncateHistory, ASSISTANT_BLOCK_MESSAGES, detectCrisis, CRISIS_RESPONSE } from '@/lib/assistant-guard'

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
  // P70 Wave A — petición de botón de acción (solo uiAction+actionId; nada más del cliente es verdad).
  let uiActionReqBody: { uiAction: 'confirm' | 'cancel'; actionId: string } | null = null
  try {
    const body = await req.json() as {
      message?: unknown
      threadId?: unknown
      uiAction?: unknown
      actionId?: unknown
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
    if ((body.uiAction === 'confirm' || body.uiAction === 'cancel') && typeof body.actionId === 'string' && body.actionId) {
      uiActionReqBody = { uiAction: body.uiAction, actionId: body.actionId }
      if (!message) message = `[ui:${body.uiAction}]` // pasa las guardas de mensaje vacío; nunca se interpreta
    }
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

  // --------------------------------------------------- Seguridad humana (máxima prioridad, P18)
  // Si el mensaje expresa intención explícita de autolesión/suicidio, respondemos con un protocolo de
  // seguridad SIN llamar al agente. No guardamos el contenido sensible (solo registramos el evento).
  if (detectCrisis(message)) {
    console.warn('[assistant/v2] crisis_safe_response', { user: user.id, ws: workspaceId })
    return NextResponse.json({ ok: true, answer: CRISIS_RESPONSE, errorCode: null, debugSource: 'crisis_guard', preparedAction: null })
  }

  // ----------------------------------------------- Control de coste / anti-abuso
  // Barrera DURA antes de tocar n8n/OpenAI: rate limit + longitud + megaprompt. Si bloquea, respondemos
  // con un mensaje humano y NO gastamos tokens. (ok:true → la UI lo muestra como respuesta normal.)
  if (!checkRateLimit(`${user.id}:${workspaceId ?? 'nows'}`)) {
    console.warn('[assistant/v2] rate_limited', { user: user.id, ws: workspaceId, len: message.length })
    return NextResponse.json({ ok: true, answer: ASSISTANT_BLOCK_MESSAGES.rate_limited, errorCode: null, debugSource: 'guard_rate_limited', preparedAction: null })
  }
  const guard = checkAssistantInput(message, { hard: true })
  if (!guard.ok) {
    console.warn('[assistant/v2] blocked', { reason: guard.reason, user: user.id, ws: workspaceId, len: message.length })
    return NextResponse.json({ ok: true, answer: guard.message, errorCode: null, debugSource: `guard_${guard.reason}`, preparedAction: null })
  }

  // ------------------------------------------------------------------ Provider
  // n8n Agent V2 is the DEFAULT brain of the CRM assistant. The legacy V1
  // (runNowLabsAgent + deterministic fallbacks) is reachable ONLY when an
  // operator explicitly sets ASSISTANT_PROVIDER=openai|v1|local — an explicit
  // rollback switch, NEVER a silent fallback when n8n fails.
  // P51 — Legacy blindado: el provider antiguo (openai/v1/local) SOLO se activa con ALLOW_LEGACY_ASSISTANT
  // =true. Sin ese flag, ASSISTANT_PROVIDER no puede reactivar una ruta insegura: default = n8n (bajo router
  // + contrato de tools). Evita que el legacy se salte el router / lea invoices en staging por descuido.
  const useLegacyV1 = resolveAssistantProvider({
    provider: process.env.ASSISTANT_PROVIDER,
    allowLegacy: process.env.ALLOW_LEGACY_ASSISTANT,
  }) === 'legacy'

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
        const ordered = rows
          .map((r) => ({
            role: String((r as { role?: unknown }).role ?? 'user'),
            content: String((r as { content?: unknown }).content ?? ''),
          }))
          .filter((m) => m.content && m.content !== message)
          .reverse()
        // Control de payload/tokens: pocos mensajes, recortados, omitiendo basura gigante/bloqueada.
        recentMessages = truncateHistory(ordered)
      }
    }

    // P47 — LOCAL-FIRST para consultas básicas de lectura (clientes / inmuebles / cartera). Responde
    // directamente con la sesión RLS del usuario, SIN depender de n8n ni de OpenAI. Así "¿qué clientes
    // tengo?" o "¿qué pisos hay en cartera?" nunca fallan aunque el cerebro n8n esté caído/mal configurado.
    // P70 Wave A — UI ACTION por botón: el navegador envía SOLO {uiAction, actionId}; el server resuelve
    // workspace/actor/fila desde la sesión y assistant_actions. Nunca se acepta payload como verdad.
    if (uiActionReqBody) {
      const res = await executeUiAction(supabase, workspaceId, uiActionReqBody.uiAction, uiActionReqBody.actionId)
        .catch(() => ({ handled: false as const }))
      if (res.handled) {
        return NextResponse.json({ ok: true, answer: res.answer, debugSource: 'ui_action', mode: 'local', errorCode: null, toolCalls: [res.usedTool], referencedClientId: null, referencedClientName: null, referencedList: null, referencedCalendarList: null, dataPreview: null, preparedAction: null, ui: validateAssistantUi(res.ui ?? null) })
      }
      // Una petición de botón NUNCA sigue hacia el cerebro general: el mensaje sintético [ui:*] no es
      // lenguaje del usuario. Respuesta segura y fin (no se ha modificado nada).
      return NextResponse.json({ ok: true, answer: 'No he podido procesar la acción ahora mismo. No se ha modificado nada; vuelve a intentarlo.', debugSource: 'ui_action', mode: 'local', errorCode: null, toolCalls: null, referencedClientId: null, referencedClientName: null, referencedList: null, referencedCalendarList: null, dataPreview: null, preparedAction: null, ui: null })
    }

    // P71 — ESTADO CONVERSACIONAL UNIFICADO: se carga aquí y lo comparten local-first y n8n. Fail-soft.
    const turnId = globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now()}`
    const convState = threadId ? await loadConversationState(supabase, threadId, user.id) : (await import('@/lib/agents/conversation-state')).emptyState()

    // ── GENERAL SEMANTIC PLANNER · feature flag (default OFF = P71 intacto, sin cambio de comportamiento) ──
    const gspMode = plannerMode()
    // ON: para LENGUAJE ABIERTO el planner es el cerebro. Los fast-paths de protocolo (uiAction) ya se
    // resolvieron arriba. Fail-soft: si el planner no puede, se cae a P71 (nunca respuesta inventada).
    if (gspMode === 'on') {
      try {
        const pa = await plannerAnswer({ supabase, workspaceId, message, convState })
        if (pa && pa.answer) {
          logInvoke({ event: 'assistant.v2.invoke', workspaceResolved: true, openAiConfigured, model: `planner:${String(pa.observability.plannerModel ?? '?')}`, errorCode: null, agentErrorCode: null, hasPreparedAction: false, preparedActionType: null, source: 'general_planner', toolCalls: (pa.observability.capabilities as string[]) ?? null, durationMs: Date.now() - start })
          return NextResponse.json({ ok: true, answer: pa.answer, debugSource: 'general_planner', mode: 'planner', errorCode: null, toolCalls: (pa.observability.capabilities as string[]) ?? null, referencedClientId: null, referencedClientName: null, referencedList: pa.referencedList ?? null, referencedCalendarList: null, dataPreview: pa.referencedList ?? null, preparedAction: null, ui: null, assistantArchitecture: 'GENERAL_PLANNER', featureFlagState: gspMode })
        }
      } catch { /* fail-soft → continúa al camino P71 */ }
    }

    // Solo intercepta lecturas básicas inequívocas; el resto sigue al cerebro general.
    const recentContext = recentMessages.map((m) => m.content).join(' \n ')
    const local = await tryLocalAnswer(supabase, workspaceId, message, { recentContext, lastResults: context.lastResults, state: convState, turnId })
      .catch(() => ({ handled: false as const }))
    // SHADOW: P71 responde al usuario; el planner observa el MISMO turno (solo lecturas, acciones dry-run) y
    // se registra la atribución/comparación. NO altera la respuesta ni el estado autoritativo de P71.
    if (gspMode === 'shadow') {
      const obs = await plannerShadowObserve({ supabase, workspaceId, message, convState }).catch(() => null)
      if (obs) logInvoke({ event: 'assistant.v2.invoke', workspaceResolved: true, openAiConfigured, model: `shadow:${obs.plannerModel}`, errorCode: null, agentErrorCode: null, hasPreparedAction: false, preparedActionType: null, source: `shadow_planner:arch=GENERAL_PLANNER:${obs.speechAct}:${obs.capabilities.join('+')}${obs.error ? `:err=${obs.error}` : ''}`, toolCalls: obs.capabilities, durationMs: obs.latencyMs })
    }
    if (local.handled) {
      // P71 — persistir el estado que resolvió el camino LOCAL (no solo n8n). Fail-soft; nunca rompe.
      if (threadId && 'stateUpdate' in local && local.stateUpdate) {
        await saveConversationState(supabase, { workspaceId, userId: user.id, threadId, state: applyStateUpdate(convState, local.stateUpdate) })
      }
      logInvoke({
        event: 'assistant.v2.invoke',
        workspaceResolved: true,
        openAiConfigured,
        model: 'local:reader',
        errorCode: null,
        agentErrorCode: null,
        hasPreparedAction: false,
        preparedActionType: null,
        source: `local_reader:${local.entity}`,
        toolCalls: [local.usedTool],
        durationMs: Date.now() - start,
      })
      return NextResponse.json({
        ok: true,
        answer: local.answer,
        debugSource: 'local_reader',
        mode: 'local',
        errorCode: null,
        toolCalls: [local.usedTool],
        referencedClientId: null,
        referencedClientName: null,
        // Lista estructurada para el contexto conversacional (ordinales / seguimientos). Sin IDs sensibles.
        referencedList: local.referencedList ?? null,
        referencedCalendarList: null,
        dataPreview: local.referencedList ?? null,
        preparedAction: null,
        // P70 Wave A — bloque estructurado (validado en runtime; si es inválido → null y la UI usa el texto).
        ui: validateAssistantUi(local.ui ?? null),
      })
    }

    const requestId = globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}`

    // P51 — Turn Policy Token: la app DECIDE el turno y firma un token que n8n debe reenviar a
    // /api/agent/tool. El backend impone la política (no confía en n8n). Si el turno no lee datos, el token
    // lleva allowedTools=[] y el endpoint rechaza cualquier lectura. Sin AGENT_TOOL_SECRET, token vacío
    // (modo compat). No contiene secretos ni PII.
    // P71 — el router recibe el módulo activo y si hubo consulta previa (contexto real, no aislado).
    const turnDecision = decideTurn(message, {
      priorEntity: activeEntity?.type === 'client' ? 'clients' : undefined,
      priorModule: (convState.activeModule ?? undefined) as CrmModuleId | undefined,
      hasLastResult: !!convState.lastDataQuery,
    })
    const allowedTools = allowedToolsForTurn(turnDecision)
    const toolSecret = process.env.AGENT_TOOL_SECRET?.trim()
    const turnPolicyToken = toolSecret
      ? signTurnPolicy({
          cid: threadId || workspaceId,
          tid: requestId,
          domain: turnDecision.domain,
          read: turnDecision.shouldReadData,
          write: turnDecision.shouldWriteData,
          tools: allowedTools,
        }, toolSecret)
      : undefined

    // P71 — UNA SOLA VERDAD en la frontera del contrato: si la memoria legacy no tiene entidad activa pero
    // el ConversationState sí (p. ej. la resolvió LOCAL-first en un turno anterior), n8n la recibe igual.
    // Sin esto, una entidad resuelta localmente «desaparecía» para n8n (split-brain residual, cazado por
    // p71-n8n-handoff-e2e caso A).
    const stateEntity = convState.activeEntities[0]
    const activeEntityForN8n = activeEntity
      ?? (stateEntity ? { type: stateEntity.entityType as string, id: stateEntity.entityId, label: stateEntity.displayLabel } : null)

    const n8n = await runN8nAssistant({
      message,
      workspaceId,
      userId: user.id,
      // Stable session key for n8n Window Memory. Falls back to the workspace
      // when the UI hasn't provided a thread id yet.
      threadId: threadId || workspaceId,
      activeEntity: activeEntityForN8n,
      recentMessages,
      requestId,
      turn: { turnType: turnDecision.turnType, domain: turnDecision.domain, shouldReadData: turnDecision.shouldReadData, allowedTools },
      turnPolicyToken,
      // P71·F3.5 — un solo cerebro: n8n recibe el MISMO estado (reducido) que usa local-first.
      conversationState: reduceStateForN8n(convState),
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
      // P71 — el estado unificado también recoge lo que resolvió n8n (módulo + entidad activa), para que
      // un turno posterior manejado por LOCAL-first herede la continuidad. Fail-soft.
      if (threadId) {
        const convTypeOf = (t: string): 'client' | 'property' | 'opportunity' | 'task' | 'calendar_event' | 'service_case' | 'document' | null =>
          (['client', 'property', 'opportunity', 'task', 'calendar_event', 'service_case', 'document'] as const).includes(t as never) ? t as never : null
        const et = resolved ? convTypeOf(resolved.type) : null
        await saveConversationState(supabase, { workspaceId, userId: user.id, threadId, state: applyStateUpdate(convState, {
          resolvedModule: turnDecision.module ?? undefined,
          ...(et && resolved ? { resolvedEntities: [{ entityType: et, entityId: resolved.id, displayLabel: resolved.label ?? '', confidence: 0.7, sourceTurnId: requestId }] } : {}),
          lastAssistantResultUpdate: { type: turnDecision.shouldReadData ? 'read' : 'explanation', module: turnDecision.module ?? null, capability: 'n8n', entityIds: et && resolved ? [resolved.id] : [], turnId: requestId },
        }) })
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
