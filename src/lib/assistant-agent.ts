// NowLabs AI — OpenAI Responses API agent loop with function calling.
// Falls back to the deterministic regex router when OPENAI_API_KEY is absent or errors out.
// Cost-conscious: cheap model by default, max 4 tool-call rounds, trimmed context.

import type { SupabaseClient } from '@supabase/supabase-js'
import * as T from '@/lib/assistant-tools'

const MODEL = process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4o-mini'
const MAX_TOOL_ROUNDS = 4
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const REQUEST_TIMEOUT_MS = 28_000

// Phrases that require a live ranking query — must NEVER use lastReferencedClientId.
// Normalized (no accents, lowercase) for matching.
const RANKING_RE = /\b(mas caliente|mayor score|mejor lead|mas prometedor|mayor potencial|lead caliente|top leads?|mas fuerte|mayor puntuacion|mas interesante|oportunidad mas alta|mayor lead score|cliente con mas score|cliente con mayor|mas alto score)\b/

export function isAgentEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.OPENAI_AGENT_ENABLED !== 'false'
}

// --- Public types ---

export type AgentResult = {
  answer: string
  referencedClientId?: string
  referencedClientName?: string
  referencedList?: Record<string, unknown>[]
  preparedAction?: T.PreparedActionData
  suggestedActions?: string[]
  debugSource: 'openai_agent' | 'fallback_tools'
  error?: string
}

// --- Internal types ---

type ToolArgs = Record<string, unknown>

type UserInputItem = { role: 'user'; content: string }
type FunctionCallOutputInputItem = { type: 'function_call_output'; call_id: string; output: string }
type InputItem = UserInputItem | OAIOutputItem | FunctionCallOutputInputItem

type OAIFunctionCallOutput = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

type OAIMessageOutput = {
  type: 'message'
  role: string
  content: Array<{ type: string; text?: string }>
}

type OAIOutputItem = OAIFunctionCallOutput | OAIMessageOutput | { type: string }

type OAIResponseBody = {
  id?: string
  output: OAIOutputItem[]
  error?: { message: string; code?: string }
}

// --- 17 tool definitions for OpenAI function calling ---

const TOOL_DEFS: Record<string, unknown>[] = [
  {
    type: 'function',
    name: 'crm_overview',
    description: 'Devuelve un resumen estadístico del workspace: clientes por estado, facturas pendientes/vencidas, próximas citas y tareas pendientes.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'list_clients',
    description: 'Lista clientes del CRM con filtros opcionales por estado, canal o puntuación mínima de lead score.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Estado del cliente: active, lead, inactive, churned' },
        channel: { type: 'string', description: 'Canal de origen: whatsapp, instagram, email, web' },
        min_score: { type: 'number', description: 'Lead score mínimo' },
        limit: { type: 'number', description: 'Máximo de resultados (máx 50)' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'search_clients',
    description: 'Busca clientes por nombre, empresa o email.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar en nombre, empresa o email' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'get_client_context',
    description: 'Devuelve todos los datos de un cliente: contacto, facturas y citas. Usa client_id si está disponible, si no usa client_name.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID del cliente' },
        client_name: { type: 'string', description: 'Nombre del cliente (si no tienes el ID)' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'hot_leads',
    description: 'Devuelve leads calientes con puntuación ≥ 70, ordenados por score descendente.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'select_client_by_ordinal',
    description: 'Selecciona un cliente de la lista activa de resultados por posición. index es 0-based: 0 = primero, 1 = segundo, etc.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Posición 0-based en la lista activa de resultados' },
      },
      required: ['index'],
    },
  },
  {
    type: 'function',
    name: 'oldest_client',
    description: 'Devuelve el primer cliente registrado en el CRM (por fecha de creación ascendente).',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'latest_clients',
    description: 'Devuelve los clientes más recientes registrados en el CRM.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Número de clientes a devolver (por defecto 5)' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'pending_invoices',
    description: 'Devuelve las facturas pendientes de cobro (estado pending u overdue).',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'overdue_invoices',
    description: 'Devuelve únicamente las facturas vencidas (estado overdue).',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'upcoming_events',
    description: 'Devuelve los próximos eventos del calendario del workspace.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'pending_tasks',
    description: 'Devuelve las tareas pendientes del workspace.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'recent_conversations',
    description: 'Devuelve las conversaciones abiertas más recientes del workspace.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'recent_messages',
    description: 'Devuelve los mensajes más recientes, opcionalmente filtrados por canal de conversación.',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Canal: whatsapp, instagram, email, web' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'recommended_actions',
    description: 'Devuelve las acciones comerciales prioritarias: facturas vencidas urgentes, leads calientes, próximas citas.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'automation_recommendations',
    description: 'Devuelve recomendaciones de automatizaciones basadas en el estado real del CRM: seguimientos urgentes, leads calientes, facturas vencidas.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'prepare_action',
    description: 'Prepara una tarjeta de acción (cita o factura) para revisión del usuario. SOLO prepara — nunca crea ni envía nada sin confirmación explícita del usuario.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['booking', 'invoice', 'task'], description: 'Tipo: booking (cita), invoice (factura) o task (tarea de seguimiento)' },
        client_id: { type: 'string', description: 'ID del cliente si está disponible' },
        client_name: { type: 'string', description: 'Nombre del cliente' },
        service: { type: 'string', description: 'Servicio o motivo (para citas)' },
        date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD (para citas)' },
        time: { type: 'string', description: 'Hora en formato HH:MM (para citas)' },
        amount: { type: 'number', description: 'Importe en euros (para facturas)' },
        concept: { type: 'string', description: 'Concepto de la factura' },
        due_date: { type: 'string', description: 'Fecha de vencimiento YYYY-MM-DD (para facturas y tareas)' },
        task_title: { type: 'string', description: 'Título de la tarea (para tasks)' },
        description: { type: 'string', description: 'Descripción o notas adicionales de la tarea' },
      },
      required: ['type'],
    },
  },
]

// --- Type guards ---

function isFunctionCall(item: OAIOutputItem): item is OAIFunctionCallOutput {
  return item.type === 'function_call' && 'call_id' in item && 'name' in item
}

function isMessageOutput(item: OAIOutputItem): item is OAIMessageOutput {
  return item.type === 'message' && 'content' in item
}

// --- Tool executor ---

async function executeTool(
  name: string,
  args: ToolArgs,
  supabase: SupabaseClient,
  workspaceId: string,
  lastResults: Record<string, unknown>[]
): Promise<{ toolResult: T.ToolResult; preparedAction?: T.PreparedActionData }> {
  switch (name) {
    case 'crm_overview':
      return { toolResult: await T.toolCrmOverview(supabase, workspaceId) }

    case 'list_clients':
      return {
        toolResult: await T.toolListClients(supabase, workspaceId, {
          status: args.status as string | undefined,
          channel: args.channel as string | undefined,
          minScore: args.min_score as number | undefined,
          limit: args.limit as number | undefined,
        }),
      }

    case 'search_clients':
      return { toolResult: await T.toolSearchClients(supabase, workspaceId, String(args.query ?? '')) }

    case 'get_client_context':
      return {
        toolResult: await T.toolGetClientContext(
          supabase,
          workspaceId,
          args.client_id as string | undefined,
          args.client_name as string | undefined
        ),
      }

    case 'hot_leads':
      return { toolResult: await T.toolHotLeads(supabase, workspaceId) }

    case 'select_client_by_ordinal': {
      const idx = typeof args.index === 'number' ? args.index : parseInt(String(args.index ?? 0), 10)
      return { toolResult: T.toolSelectByOrdinal(lastResults, idx) }
    }

    case 'oldest_client':
      return { toolResult: await T.toolOldestClient(supabase, workspaceId) }

    case 'latest_clients':
      return {
        toolResult: await T.toolLatestClients(
          supabase,
          workspaceId,
          typeof args.limit === 'number' ? args.limit : undefined
        ),
      }

    case 'pending_invoices':
      return { toolResult: await T.toolPendingInvoices(supabase, workspaceId) }

    case 'overdue_invoices':
      return { toolResult: await T.toolOverdueInvoices(supabase, workspaceId) }

    case 'upcoming_events':
      return { toolResult: await T.toolUpcomingEvents(supabase, workspaceId) }

    case 'pending_tasks':
      return { toolResult: await T.toolPendingTasks(supabase, workspaceId) }

    case 'recent_conversations':
      return { toolResult: await T.toolRecentConversations(supabase, workspaceId) }

    case 'recent_messages':
      return {
        toolResult: await T.toolRecentMessages(supabase, workspaceId, args.channel as string | undefined),
      }

    case 'recommended_actions':
      return { toolResult: await T.toolRecommendedActions(supabase, workspaceId) }

    case 'automation_recommendations':
      return { toolResult: await T.toolAutomationRecommendations(supabase, workspaceId) }

    case 'prepare_action': {
      if (args.type === 'task') {
        const res = T.toolPrepareTask({
          clientId: args.client_id as string | undefined,
          clientName: args.client_name as string | undefined,
          taskTitle: args.task_title as string | undefined,
          description: args.description as string | undefined,
          dueDate: args.due_date as string | undefined,
        })
        return { toolResult: res, preparedAction: res.preparedAction }
      }
      const res = T.toolPrepareAction(args.type as 'booking' | 'invoice', {
        clientId: args.client_id as string | undefined,
        clientName: args.client_name as string | undefined,
        service: args.service as string | undefined,
        date: args.date as string | undefined,
        time: args.time as string | undefined,
        amount: args.amount as number | undefined,
        concept: args.concept as string | undefined,
        dueDate: args.due_date as string | undefined,
      })
      return { toolResult: res, preparedAction: res.preparedAction }
    }

    default:
      return { toolResult: { text: `No pude ejecutar esa operación ahora mismo. Prueba de nuevo o reformula la consulta.`, data: null } }
  }
}

// --- OpenAI Responses API fetch ---

async function callResponses(
  apiKey: string,
  model: string,
  instructions: string,
  input: InputItem[],
  signal: AbortSignal,
  withTools = true
): Promise<OAIResponseBody> {
  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      ...(withTools ? { tools: TOOL_DEFS } : {}),
      max_output_tokens: 1024,
      temperature: 0.2,
    }),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`)
  }

  return res.json() as Promise<OAIResponseBody>
}

// --- System prompt builder ---

function buildSystemPrompt(
  lastReferencedClientName?: string,
  lastReferencedClientId?: string,
  lastResults?: Record<string, unknown>[]
): string {
  const ctx: string[] = []

  if (lastReferencedClientName) {
    ctx.push(
      `Cliente referenciado: ${lastReferencedClientName}${lastReferencedClientId ? ` (ID: ${lastReferencedClientId})` : ''}`
    )
  }

  if (lastResults?.length) {
    // Trim to 20 items and only essential fields — cost control
    const trimmed = lastResults.slice(0, 20).map((r) => ({
      id: r.id,
      name: r.name,
      company: r.company,
      status: r.status,
      channel: r.channel,
      lead_score: r.lead_score,
      created_at: r.created_at,
    }))
    ctx.push(`Lista activa de resultados (${trimmed.length} elemento(s)):\n${JSON.stringify(trimmed)}`)
  }

  const contextSection = ctx.length ? `\nCONTEXTO ACTUAL:\n${ctx.join('\n')}\n` : ''

  return `Eres NowLabs AI, el asistente interno de NowCRM. Eres directo, profesional y útil — como un colega senior que conoce el negocio al detalle: clientes, facturas, citas, tareas y conversaciones. Vas al grano. No rellenas, no inventas, no repites lo obvio.

REGLAS OPERATIVAS:
- Consulta siempre las herramientas antes de responder. Nunca inventes nombres, importes, fechas ni datos del CRM.
- Si no hay datos, dilo con naturalidad y brevedad.
- prepare_action solo prepara la tarjeta de revisión — nunca crea ni envía nada sin confirmación explícita del usuario.
- Para "el primero", "el segundo", "el 3"... usa select_client_by_ordinal con índice 0-based.
- Responde siempre en español. Sé conciso: una respuesta bien construida de 2-4 frases vale más que un párrafo largo.
- Nunca incluyas JSON crudo — transforma los datos en lenguaje natural útil.
- Usa emojis con criterio: 🔥 para urgente, 📅 para citas, 💸 para facturas, ✅ para tareas. No abuses.

REGLA DE RANKINGS (CRÍTICA):
Cuando el usuario use "cliente más caliente", "mayor score", "mejor lead", "más prometedor", "mayor potencial", "lead más fuerte", "mayor puntuación" u otra frase de ranking:
1. Llama SIEMPRE a hot_leads — el ranking real viene de la base de datos, no del contexto.
2. Usa prepare_action con el clientName que devuelva hot_leads, nunca con un nombre del contexto anterior.
3. "Cliente referenciado" en el contexto solo aplica a referencias pronominales ("ese cliente", "sus datos", "el anterior"). NUNCA a rankings.${contextSection}`
}

// --- Main agent loop ---

export async function runAgent(
  supabase: SupabaseClient,
  workspaceId: string,
  message: string,
  context: {
    lastReferencedClientId?: string
    lastReferencedClientName?: string
    lastResults?: Record<string, unknown>[]
  }
): Promise<AgentResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { answer: '', debugSource: 'fallback_tools', error: 'no_api_key' }
  if (process.env.OPENAI_AGENT_ENABLED === 'false') {
    return { answer: '', debugSource: 'fallback_tools', error: 'agent_disabled' }
  }

  // For explicit ranking queries, never pass lastReferencedClient to the model —
  // it must call hot_leads to get fresh data, not assume the last referenced client.
  const normalizedMsg = message.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const isRankingQuery = RANKING_RE.test(normalizedMsg)

  const systemPrompt = buildSystemPrompt(
    isRankingQuery ? undefined : context.lastReferencedClientName,
    isRankingQuery ? undefined : context.lastReferencedClientId,
    context.lastResults
  )

  // Local copy — updated as tools return lists, used by select_client_by_ordinal
  let localLastResults: Record<string, unknown>[] = (context.lastResults ?? []).slice(0, 20)
  const inputItems: InputItem[] = [{ role: 'user', content: message }]

  let referencedClientId: string | undefined
  let referencedClientName: string | undefined
  let referencedList: Record<string, unknown>[] | undefined
  let preparedAction: T.PreparedActionData | undefined
  let finalAnswer = ''
  let toolCallsExecuted = 0

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await callResponses(
        apiKey,
        MODEL,
        systemPrompt,
        inputItems,
        controller.signal,
        true
      )

      if (response.error) throw new Error(response.error.message)

      const toolCalls = response.output.filter(isFunctionCall)
      const msgOutput = response.output.find(isMessageOutput)

      // Track the latest text response
      const responseText = (msgOutput?.content ?? [])
        .filter((c) => c.type === 'output_text' && c.text)
        .map((c) => c.text ?? '')
        .join('')

      if (responseText) finalAnswer = responseText

      // Stop if no tool calls or we've exhausted allowed tool rounds
      if (!toolCalls.length || round === MAX_TOOL_ROUNDS) break

      // Preserve all model output items before submitting function outputs back to Responses.
      // This matches the official tool-calling flow and keeps reasoning/output context intact.
      inputItems.push(...response.output)

      // Execute all tool calls from this round
      for (const tc of toolCalls) {
        let args: ToolArgs = {}
        try { args = JSON.parse(tc.arguments) as ToolArgs } catch { /* keep empty args */ }

        const { toolResult, preparedAction: pa } = await executeTool(
          tc.name, args, supabase, workspaceId, localLastResults
        )

        // Update structured metadata from tool results
        if (toolResult.referencedClientId) referencedClientId = toolResult.referencedClientId
        if (toolResult.referencedClientName) referencedClientName = toolResult.referencedClientName
        if (toolResult.referencedList?.length) {
          referencedList = toolResult.referencedList
          localLastResults = toolResult.referencedList.slice(0, 20)
        }
        if (pa) preparedAction = pa

        // Append result to conversation history for next round
        inputItems.push({ type: 'function_call_output', call_id: tc.call_id, output: toolResult.text })
        toolCallsExecuted++
      }
    }

    console.log(`[assistant/agent] source=openai_agent model=${MODEL} toolCalls=${toolCallsExecuted} rankingQuery=${isRankingQuery}`)
    return {
      answer: finalAnswer,
      referencedClientId,
      referencedClientName,
      referencedList,
      preparedAction,
      debugSource: 'openai_agent',
    }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    const errMsg = isAbort ? 'timeout' : (err instanceof Error ? err.message : 'agent_error')
    console.warn(`[assistant/agent] fallback reason=${errMsg}`)
    return {
      answer: '',
      debugSource: 'fallback_tools',
      error: errMsg,
    }
  } finally {
    clearTimeout(timer)
  }
}
