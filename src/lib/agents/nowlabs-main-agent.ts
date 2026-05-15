// NowLabs AI v2 — único cerebro del CRM.
// OpenAI Responses API + 19 tools sobre Supabase real. Sin n8n, sin service_role, sin SQL libre.
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  toolListClients,
  toolHotLeads,
  toolGetClientContext,
  toolCrmOverview,
  toolPendingInvoices,
  toolOverdueInvoices,
  toolUpcomingEvents,
  toolPendingTasks,
  toolRecentMessages,
  toolRecentConversations,
  toolRecommendedActions,
  toolAutomationRecommendations,
  toolSelectByOrdinal,
  toolLatestClients,
  toolOldestClient,
  toolPrepareAction,
  toolPrepareTask,
} from '@/lib/assistant-tools'

const MODEL = process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4o-mini'
const MAX_ROUNDS = 4
const RESPONSES_URL = 'https://api.openai.com/v1/responses'
const TIMEOUT_MS = 28_000
const CLIENT_COLS = 'id, workspace_id, name, company, email, phone, channel, status, lead_score, notes, created_at'

// --- Types ---

type Args = Record<string, unknown>
type Row = Record<string, unknown>

type OAIFunctionCall = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

type OAIMessage = {
  type: 'message'
  role: string
  content: Array<{ type: string; text?: string }>
}

type OAIItem = OAIFunctionCall | OAIMessage | { type: string }

type OAIResponse = {
  output: OAIItem[]
  error?: { message: string }
}

type InputItem =
  | { role: 'user'; content: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | OAIItem

export type PreparedActionDraft = {
  type: 'booking' | 'invoice' | 'task'
  clientId?: string
  clientName?: string
  service?: string
  date?: string
  time?: string
  duration?: number
  amount?: number
  concept?: string
  dueDate?: string
  taskTitle?: string
  description?: string
  missingFields: string[]
}

export type AgentContext = {
  lastReferencedClientId?: string
  lastReferencedClientName?: string
  lastResults?: Row[]
}

export type AgentV2Result = {
  answer: string
  debugSource: 'openai_agent_v2'
  toolCalls: string[]
  referencedClientId?: string
  referencedClientName?: string
  referencedList?: Row[]
  dataPreview?: unknown
  preparedAction?: PreparedActionDraft
  error?: string
}

// --- Utilities ---

function normalize(t: string) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function isValidUuid(value?: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

// Resolves a real UUID for client: strips non-UUID strings from client_id and looks up the DB by name.
async function resolveClientUuid(
  supabase: SupabaseClient,
  workspaceId: string,
  rawClientId: string | undefined,
  rawClientName: string | undefined,
): Promise<{ clientId: string | undefined; clientName: string | undefined }> {
  let clientId = isValidUuid(rawClientId) ? rawClientId : undefined
  // If client_id looks like a name string (LLM confusion), treat it as the name
  let clientName = rawClientName ?? (!clientId && rawClientId ? rawClientId : undefined)

  if (clientName && !clientId) {
    const { data } = await supabase
      .from('clients').select('id, name').eq('workspace_id', workspaceId)
      .ilike('name', `%${clientName}%`).limit(1).maybeSingle()
    if (data) {
      clientId = String(data.id)
      clientName = String(data.name)
    }
  }

  return { clientId, clientName }
}


// --- Pre-router: unambiguous READ queries bypass LLM tool selection ---

type PreRoute =
  | { tool: 'list_clients'; args: { status?: string; channel?: string } }
  | { tool: 'hot_leads' }
  | { tool: 'get_client_context'; args: { client_name: string } }
  | { tool: 'search_clients'; args: { query: string } }
  | { tool: 'pending_invoices' }
  | { tool: 'overdue_invoices' }
  | { tool: 'upcoming_events' }
  | { tool: 'pending_tasks' }
  | { tool: 'recent_messages'; args: { channel?: string } }
  | { tool: 'recommended_actions' }
  | { tool: 'automation_recommendations' }
  | { tool: 'crm_overview' }
  | null

function preRoute(message: string): PreRoute {
  const t = normalize(message)

  // Action phrases need the full agent loop (entity extraction required)
  if (/\b(prepara|crea|agenda|pon|ponme|crear|preparar|haz|hazme)\b.*\b(cita|reunion|tarea|factura)\b/.test(t)) return null
  if (/\b(cita|reunion)\b.*\b(con|para)\b/.test(t) && /\b(manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo|pasado)\b/.test(t)) return null

  // Todos los clientes
  if (
    /\btodos\b.*\bclientes\b/.test(t) ||
    /\bclientes\b.*\btodos\b/.test(t) ||
    /\b(dime|muestrame|dame|quiero ver|listame|lista de)\b.*\bclientes\b/.test(t) ||
    /\bclientes\b.*(tengo|hay|tenemos|existen)/.test(t) ||
    /^(clientes|mis clientes|lista de clientes)$/.test(t)
  ) return { tool: 'list_clients', args: {} }

  if (/\bclientes?\s+activos?\b/.test(t)) return { tool: 'list_clients', args: { status: 'active' } }
  if (/\bclientes?\s+inactivos?\b/.test(t)) return { tool: 'list_clients', args: { status: 'inactive' } }
  if (/\bleads?\b/.test(t) && !/potencial|caliente|score|prometedor/.test(t)) return { tool: 'list_clients', args: { status: 'lead' } }

  // Rankings / hot leads
  if (
    /\b(mas caliente|mayor score|mejor lead|mas prometedor|mayor potencial|con mas potencial|lead caliente|top leads?|mas fuerte|mayor puntuacion|mas interesante|oportunidad mas alta|mayor lead score|cliente con mas score|cliente con mayor|mas alto score|mas oportunidades|mas potencial)\b/.test(t)
  ) return { tool: 'hot_leads' }

  // Facturas vencidas
  if (
    /\bfacturas?\s+vencidas?\b/.test(t) ||
    /\bfacturas?\s+atrasadas?\b/.test(t) ||
    /\bcobros?\s+vencidos?\b/.test(t) ||
    /\bimpagos?\b/.test(t)
  ) return { tool: 'overdue_invoices' }

  // Facturas pendientes
  if (
    /\b(facturas?\s+pendientes?|cobros?\s+pendientes?|quien\s+debe|que\s+debo\s+cobrar|pendiente\s+de\s+cobro|facturas?\s+(sin\s+pagar|impagadas?))\b/.test(t)
  ) return { tool: 'pending_invoices' }

  // Citas próximas / agenda
  if (
    /\b(citas?\s+proximas?|agenda|que\s+tengo\s+(hoy|manana|esta\s+semana)|proximas?\s+citas?|calendario|citas?\s+del\s+dia)\b/.test(t)
  ) return { tool: 'upcoming_events' }

  // Tareas pendientes
  if (
    /\b(tareas?\s+pendientes?|que\s+tareas?|pendientes?\s+de\s+hacer|tareas?\s+abiertas?|mis\s+tareas?)\b/.test(t)
  ) return { tool: 'pending_tasks' }

  // Mensajes / WhatsApp / conversaciones
  if (
    /\b(mensajes?\s+(recientes?|de\s+hoy|nuevos?)|que\s+mensajes?|whatsapp|mensajes?\s+de\s+whatsapp|mensajes?\s+han\s+entrado|que\s+ha[n]?\s+llegado|conversaciones?\s+recientes?|ultimas?\s+conversaciones?)\b/.test(t)
  ) {
    const channel = /whatsapp/.test(t) ? 'whatsapp' : /instagram/.test(t) ? 'instagram' : /email/.test(t) ? 'email' : undefined
    return { tool: 'recent_messages', args: { channel } }
  }

  // Plan del día / acciones recomendadas
  if (
    /\b(que\s+deberia\s+hacer\s+hoy|plan\s+del\s+dia|prioriza(me)?\s+el\s+dia|siguiente\s+(mejor\s+)?accion|acciones?\s+recomendadas?|que\s+hago\s+hoy|prioritarias?|que\s+debo\s+hacer\s+hoy|como\s+organizo\s+el\s+dia)\b/.test(t)
  ) return { tool: 'recommended_actions' }

  // Automatizaciones
  if (
    /\b(automatiz|automatizaciones?|flujos?\s+de\s+trabajo|workflows?|que\s+automatiz|como\s+automatiz)\b/.test(t)
  ) return { tool: 'automation_recommendations' }

  // Resumen / estado CRM
  if (
    /\b(resumen|estado|panorama|vision\s+general)\b.*\b(crm|comercial|negocio)\b/.test(t) ||
    /\b(crm|negocio)\b.*\b(resumen|estado)\b/.test(t) ||
    /\b(como\s+va\s+el\s+(crm|negocio)|situacion\s+del\s+crm|balance\s+comercial|como\s+esta\s+el\s+negocio)\b/.test(t)
  ) return { tool: 'crm_overview' }

  // Datos de un cliente concreto
  const clientCtxMatch =
    t.match(/(?:datos\s+de|info(?:rmacion)?\s+de|dime\s+sobre|quien\s+es|resume\s+a|informe\s+de|contexto\s+de|ficha\s+de|dame\s+todo\s+(?:lo\s+que\s+tengas?\s+de|de))\s+(.{3,40})$/) ??
    t.match(/^(?:busca|mira|abre|muestra)\s+(.{3,40})$/)
  if (clientCtxMatch?.[1]) return { tool: 'get_client_context', args: { client_name: clientCtxMatch[1].trim() } }

  // Búsqueda explícita
  const searchMatch = t.match(/^(?:busca(?:r)?|encuentra|localiza)\s+(.{3,40})$/)
  if (searchMatch?.[1]) return { tool: 'search_clients', args: { query: searchMatch[1].trim() } }

  return null
}

// --- Tool definitions for OpenAI function calling ---

const TOOLS = [
  {
    type: 'function',
    name: 'list_clients',
    description: 'Lista clientes del CRM. Sin argumentos devuelve TODOS. NUNCA pidas aclaración para "todos los clientes" — llama con {}.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Estado: active, lead, inactive, churned. Omite para todos.' },
        channel: { type: 'string', description: 'Canal: whatsapp, instagram, email, web.' },
        min_score: { type: 'number', description: 'Lead score mínimo.' },
        limit: { type: 'number', description: 'Máximo resultados (máx 50).' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'search_clients',
    description: 'Busca clientes por nombre, empresa, email, teléfono o notas. Búsqueda flexible — intenta primera palabra si no hay resultados completos.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Texto a buscar' } },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'select_client_by_ordinal',
    description: 'Selecciona un cliente de la lista activa por posición. Usa cuando el usuario diga "el primero", "el quinto", "el número 3", "el último". index es 0-based (primero=0, quinto=4).',
    parameters: {
      type: 'object',
      properties: { index: { type: 'number', description: 'Posición 0-based: 0=primero, 1=segundo, 4=quinto...' } },
      required: ['index'],
    },
  },
  {
    type: 'function',
    name: 'hot_leads',
    description: 'Leads con lead_score ≥ 70, orden descendente. Para: "cliente con más potencial", "mejor lead", "más prometedor", "mayor score", "top lead".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'get_client_context',
    description: 'Ficha completa de un cliente: contacto, facturas y citas. Usa client_id si lo tienes; si no, client_name. También para "sus datos", "ese cliente" si hay contexto.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'UUID del cliente (preferido)' },
        client_name: { type: 'string', description: 'Nombre del cliente' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'crm_overview',
    description: 'Resumen estadístico del CRM: totales de clientes, facturas, citas y tareas. Para: "resumen del CRM", "cómo está el negocio", "balance comercial".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'pending_invoices',
    description: 'Facturas pendientes (pending + overdue). Para: "facturas pendientes", "cobros pendientes", "quién me debe".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'overdue_invoices',
    description: 'Solo facturas vencidas (overdue). Para: "facturas vencidas", "cobros vencidos", "impagos".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'upcoming_events',
    description: 'Próximas citas del calendario. Para: "qué citas tengo", "agenda", "qué tengo hoy o mañana".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'pending_tasks',
    description: 'Tareas pendientes. Para: "qué tareas tengo", "pendientes de hacer".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'recent_messages',
    description: 'Mensajes recientes de conversaciones. Canal opcional: whatsapp, instagram, email, web.',
    parameters: {
      type: 'object',
      properties: { channel: { type: 'string', description: 'Canal: whatsapp, instagram, email, web.' } },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'recent_conversations',
    description: 'Conversaciones abiertas recientes del workspace.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'recommended_actions',
    description: 'Acciones comerciales prioritarias del día: facturas vencidas, leads calientes, próximas citas. Para: "qué debería hacer hoy", "plan del día".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'automation_recommendations',
    description: 'Recomendaciones de automatizaciones basadas en el CRM real. Para: "qué automatizaciones me recomiendas".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'latest_clients',
    description: 'Últimos N clientes registrados. Para: "últimos clientes", "clientes nuevos", "recientes".',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Número a devolver (por defecto 5)' } },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'oldest_client',
    description: 'El primer cliente registrado en el CRM.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'prepare_booking',
    description: 'Prepara un draft de cita (NUNCA la crea). Extrae cliente, fecha, hora y servicio del mensaje. Para: "prepara una cita", "agenda una reunión", "pon una cita con X".',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'UUID real del cliente obtenido de search_clients o get_client_context. NUNCA pongas aquí un nombre — deja vacío si no tienes el UUID.' },
        client_name: { type: 'string', description: 'Nombre visible del cliente (string libre, no UUID)' },
        service: { type: 'string', description: 'Motivo o servicio' },
        date: { type: 'string', description: 'Fecha YYYY-MM-DD' },
        time: { type: 'string', description: 'Hora HH:MM' },
        duration: { type: 'number', description: 'Duración en minutos (por defecto 60)' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'prepare_task',
    description: 'Prepara un draft de tarea (NUNCA la crea). Para: "crea una tarea", "recuérdame", "seguimiento de X", "llama a X".',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'UUID real del cliente obtenido de search_clients o get_client_context. NUNCA pongas aquí un nombre — deja vacío si no tienes el UUID.' },
        client_name: { type: 'string', description: 'Nombre visible del cliente (string libre, no UUID)' },
        task_title: { type: 'string', description: 'Título de la tarea' },
        description: { type: 'string', description: 'Descripción adicional' },
        due_date: { type: 'string', description: 'Fecha de vencimiento YYYY-MM-DD' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'prepare_invoice',
    description: 'Prepara un draft de factura (NUNCA la crea). Para: "prepara una factura", "factura a X de N€", "cobrar a X".',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'UUID real del cliente obtenido de search_clients o get_client_context. NUNCA pongas aquí un nombre — deja vacío si no tienes el UUID.' },
        client_name: { type: 'string', description: 'Nombre visible del cliente (string libre, no UUID)' },
        amount: { type: 'number', description: 'Importe en euros' },
        concept: { type: 'string', description: 'Concepto de la factura' },
        due_date: { type: 'string', description: 'Fecha de vencimiento YYYY-MM-DD' },
      },
      required: [],
    },
  },
]

// --- System prompt base ---

const SYSTEM_PROMPT_BASE = `Eres NowLabs AI, el asistente comercial interno de NowCRM. Eres como un colega senior de ventas que conoce el negocio al detalle: directo, claro, en español natural de España. Sin rodeos, sin relleno.

CRITERIO COMERCIAL:
Piensa como un comercial experimentado. Cuando veas datos, saca conclusiones útiles. Si un lead tiene score 90, dilo y recomienda actuar. Si hay una factura vencida, es urgente. Aporta criterio real, no solo listas de datos.

REGLAS DE TOOL — SIGUE ESTAS EXACTAS:

1. "todos los clientes" / "dime los clientes" → list_clients({}) sin filtros, sin preguntar
2. "cliente con más potencial" / "mejor lead" / "más caliente" / "mayor score" → hot_leads()
3. "datos de X" / "dame info de X" / "quién es X" / "resume a X" → get_client_context(client_name=X)
4. "el primero" / "el quinto" / "el número 3" / "el último" → select_client_by_ordinal(index=N-1) con la lista activa
5. "sus datos" / "ese cliente" / "el anterior" → get_client_context(client_id=ID_DEL_CONTEXTO)
6. "facturas pendientes" → pending_invoices()
7. "facturas vencidas" / "impagos" → overdue_invoices()
8. "qué citas tengo" / "agenda" / "calendario" → upcoming_events()
9. "tareas pendientes" → pending_tasks()
10. "mensajes" / "WhatsApp" / "conversaciones" → recent_messages(channel=...)
11. "qué debería hacer hoy" / "plan del día" / "prioridades" → recommended_actions()
12. "prepara una cita con X" → prepare_booking(client_name, date, time, service)
13. "prepara una tarea para X" → prepare_task(client_name, task_title, due_date)
14. "prepara una factura para X de N€" → prepare_invoice(client_name, amount, concept, due_date)
15. "busca a X" / "buscar" → search_clients(query=X)
16. "automatizaciones" / "cómo automatizar" → automation_recommendations()
17. "resumen del CRM" / "cómo está el negocio" → crm_overview()

REGLA CRÍTICA: Si una tool puede responder directamente, LLÁMALA. No pidas aclaración para consultas generales.
Para prepare_booking/task/invoice: extrae TODOS los datos posibles del mensaje. Fecha "mañana" = fecha de mañana. "a las 12" = 12:00. Si falta dato, indícalo en la respuesta — no bloquearte.
Para select_client_by_ordinal: índice 0-based (primero=0, quinto=4, último=N-1).

DETECCIÓN DE ACCIONES — identifica siempre:
- BOOKING: "prepara una cita", "crea una cita", "agenda una reunión", "pon una cita", "cita con X el/mañana/el lunes"
- TASK: "crea una tarea", "recuérdame", "seguimiento de X", "llama a X", "contacta a X"
- INVOICE: "prepara una factura", "factura a X de N€", "cobrar a X", "haz una factura"

BÚSQUEDA FLEXIBLE DE CLIENTES:
Si el usuario dice "asier lopez" y hay un "Asier Comba Lopez", usa ese resultado. Si hay varios candidatos, muestra la lista y pregunta cuál.

FORMATO DE RESPUESTA — REGLAS ESTRICTAS:

PROHIBIDO:
- **negritas** con asteriscos — jamás
- ### títulos markdown
- tablas con | pipes |
- "Si necesitas más información, házmelo saber"
- "No dudes en preguntarme"
- "Espero haberte ayudado"
- Mencionar OpenAI, Supabase, tools, backend, endpoint

OBLIGATORIO:
- Texto limpio, plano, pensado para un chat
- Emojis solo cuando aporten valor real: 📊 resumen, 🔥 urgente/caliente, 📅 citas, 💸 facturas/cobros, ✅ tarea lista, ⚠️ aviso urgente, 📌 ficha cliente
- Si falta un dato: "No consta"
- Si no hay datos: 1 frase corta y directa
- Máximo 4-6 frases por respuesta. Conciso.`

// --- Context-aware system prompt builder ---

function buildSystemPrompt(context?: AgentContext): string {
  const now = new Date()
  const todayISO = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
  const todayHuman = now.toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const dateHeader = `FECHA ACTUAL: ${todayISO} (${todayHuman}) · Zona horaria: Europe/Madrid\nUsa esta fecha para calcular "hoy", "mañana", "pasado mañana" y días de la semana.\n\n`

  const lines: string[] = []

  if (context?.lastReferencedClientName) {
    lines.push(
      `CLIENTE ACTIVO EN CONVERSACIÓN: ${context.lastReferencedClientName}${context.lastReferencedClientId ? ` (ID: ${context.lastReferencedClientId})` : ''} — úsalo con get_client_context cuando el usuario diga "ese cliente", "sus datos", "con ese", "el anterior", "el mismo".`
    )
  }

  if (context?.lastResults?.length) {
    const trimmed = context.lastResults.slice(0, 20).map((r, i) => {
      const name = String(r.name ?? r.title ?? `Elemento ${i + 1}`)
      const co = r.company ? ` (${r.company})` : ''
      const st = r.status ? ` · ${r.status}` : ''
      const sc = r.lead_score !== undefined ? ` · score ${r.lead_score}` : ''
      return `${i + 1}. ${name}${co}${st}${sc}`
    }).join('\n')
    lines.push(
      `LISTA ACTIVA (${context.lastResults.length} elemento(s)) — usa select_client_by_ordinal cuando el usuario diga "el primero", "el quinto", "el número 3", "el último":\n${trimmed}`
    )
  }

  if (!context?.lastReferencedClientName && !context?.lastResults?.length) {
    lines.push(
      'SIN CONTEXTO ACTIVO: No hay lista activa ni cliente referenciado en la conversación. Si el usuario usa "el quinto", "ese", "sus datos", "el anterior" u otro ordinal o referencia sin nombre, NO llames ninguna tool — responde: "¿A qué cliente te refieres? Dime el nombre o pide primero la lista de clientes."'
    )
  }

  const base = dateHeader + SYSTEM_PROMPT_BASE
  return `${base}\n\nCONTEXTO DE LA CONVERSACIÓN:\n${lines.join('\n\n')}`
}

// --- Type guards ---

function isFunctionCall(item: OAIItem): item is OAIFunctionCall {
  return item.type === 'function_call' && 'call_id' in item && 'name' in item
}

function isMessage(item: OAIItem): item is OAIMessage {
  return item.type === 'message' && 'content' in item
}

// --- Tool executor ---

async function runTool(
  name: string,
  args: Args,
  supabase: SupabaseClient,
  workspaceId: string,
  localLastResults: Row[],
): Promise<{
  text: string
  data: unknown
  clientId?: string
  clientName?: string
  referencedList?: Row[]
  preparedAction?: PreparedActionDraft
}> {
  switch (name) {
    case 'list_clients': {
      const res = await toolListClients(supabase, workspaceId, {
        status: args.status as string | undefined,
        channel: args.channel as string | undefined,
        minScore: args.min_score as number | undefined,
        limit: args.limit as number | undefined,
      })
      return { text: res.text, data: res.referencedList ?? res.data, clientId: res.referencedClientId, clientName: res.referencedClientName, referencedList: res.referencedList as Row[] | undefined }
    }

    case 'search_clients': {
      const query = String(args.query ?? '').trim()
      if (!query) return { text: 'Dime el nombre o empresa a buscar.', data: [] }

      // 1. Full query: name, company, email, phone, notes
      let { data: rows } = await supabase
        .from('clients').select(CLIENT_COLS)
        .eq('workspace_id', workspaceId)
        .or(`name.ilike.%${query}%,company.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%,notes.ilike.%${query}%`)
        .order('lead_score', { ascending: false }).limit(20) as { data: Row[] | null }

      // 2. First-word fallback if no match
      if ((!rows || !rows.length) && query.includes(' ')) {
        const first = query.split(/\s+/)[0]
        const { data: d2 } = await supabase
          .from('clients').select(CLIENT_COLS)
          .eq('workspace_id', workspaceId)
          .or(`name.ilike.%${first}%,company.ilike.%${first}%`)
          .order('lead_score', { ascending: false }).limit(10) as { data: Row[] | null }
        rows = d2
      }

      const results = (rows ?? []) as Row[]
      if (!results.length) {
        return { text: `No encontré ningún cliente con "${query}". Prueba con el nombre completo o parte del email.`, data: [], referencedList: [] }
      }

      if (results.length === 1) {
        const c = results[0]
        const co = c.company && String(c.company) !== 'No consta' ? ` (${c.company})` : ''
        const st = c.status ? ` · ${c.status}` : ''
        const sc = c.lead_score !== undefined ? ` · score ${c.lead_score}` : ''
        return { text: `Encontré a ${String(c.name)}${co}${st}${sc}.`, data: c, clientId: String(c.id), clientName: String(c.name), referencedList: results }
      }

      const list = results.slice(0, 5).map((c, i) => {
        const co = c.company && String(c.company) !== 'No consta' ? ` (${c.company})` : ''
        return `${i + 1}. ${String(c.name)}${co} · ${c.status}`
      }).join('\n')
      return { text: `Encontré ${results.length} clientes para "${query}":\n${list}\n¿A cuál te refieres?`, data: results, referencedList: results }
    }

    case 'select_client_by_ordinal': {
      const idx = typeof args.index === 'number' ? args.index : parseInt(String(args.index ?? 0), 10)
      const res = toolSelectByOrdinal(localLastResults, idx)
      return { text: res.text, data: res.data, clientId: res.referencedClientId, clientName: res.referencedClientName, referencedList: res.referencedList as Row[] | undefined }
    }

    case 'hot_leads': {
      const res = await toolHotLeads(supabase, workspaceId)
      return { text: res.text, data: res.referencedList ?? res.data, clientId: res.referencedClientId, clientName: res.referencedClientName, referencedList: res.referencedList as Row[] | undefined }
    }

    case 'get_client_context': {
      const res = await toolGetClientContext(supabase, workspaceId, args.client_id as string | undefined, args.client_name as string | undefined)
      return { text: res.text, data: res.data, clientId: res.referencedClientId, clientName: res.referencedClientName }
    }

    case 'crm_overview': {
      const res = await toolCrmOverview(supabase, workspaceId)
      return { text: res.text, data: res.data }
    }

    case 'pending_invoices': {
      const res = await toolPendingInvoices(supabase, workspaceId)
      return { text: res.text, data: res.data }
    }

    case 'overdue_invoices': {
      const res = await toolOverdueInvoices(supabase, workspaceId)
      return { text: res.text, data: res.data }
    }

    case 'upcoming_events': {
      const res = await toolUpcomingEvents(supabase, workspaceId)
      return { text: res.text, data: res.data }
    }

    case 'pending_tasks': {
      const res = await toolPendingTasks(supabase, workspaceId)
      return { text: res.text, data: res.data }
    }

    case 'recent_messages': {
      const res = await toolRecentMessages(supabase, workspaceId, args.channel as string | undefined)
      return { text: res.text, data: res.data }
    }

    case 'recent_conversations': {
      const res = await toolRecentConversations(supabase, workspaceId)
      return { text: res.text, data: res.data }
    }

    case 'recommended_actions': {
      const res = await toolRecommendedActions(supabase, workspaceId)
      return { text: res.text, data: res.data }
    }

    case 'automation_recommendations': {
      const res = await toolAutomationRecommendations(supabase, workspaceId)
      return { text: res.text, data: res.data }
    }

    case 'latest_clients': {
      const limit = typeof args.limit === 'number' ? args.limit : 5
      const res = await toolLatestClients(supabase, workspaceId, limit)
      return { text: res.text, data: res.data, referencedList: res.referencedList as Row[] | undefined }
    }

    case 'oldest_client': {
      const res = await toolOldestClient(supabase, workspaceId)
      return { text: res.text, data: res.data, clientId: res.referencedClientId, clientName: res.referencedClientName }
    }

    case 'prepare_booking': {
      const { clientId, clientName } = await resolveClientUuid(supabase, workspaceId, args.client_id as string | undefined, args.client_name as string | undefined)
      const res = toolPrepareAction('booking', {
        clientId,
        clientName,
        service: args.service as string | undefined,
        date: args.date as string | undefined,
        time: args.time as string | undefined,
        duration: args.duration as number | undefined,
      })
      return { text: res.text, data: res.data, clientId: res.preparedAction?.clientId, clientName: res.preparedAction?.clientName, preparedAction: res.preparedAction as PreparedActionDraft | undefined }
    }

    case 'prepare_task': {
      const { clientId, clientName } = await resolveClientUuid(supabase, workspaceId, args.client_id as string | undefined, args.client_name as string | undefined)
      const res = toolPrepareTask({
        clientId,
        clientName,
        taskTitle: args.task_title as string | undefined,
        description: args.description as string | undefined,
        dueDate: args.due_date as string | undefined,
      })
      return { text: res.text, data: res.data, clientId: res.preparedAction?.clientId, clientName: res.preparedAction?.clientName, preparedAction: res.preparedAction as PreparedActionDraft | undefined }
    }

    case 'prepare_invoice': {
      const { clientId, clientName } = await resolveClientUuid(supabase, workspaceId, args.client_id as string | undefined, args.client_name as string | undefined)
      const res = toolPrepareAction('invoice', {
        clientId,
        clientName,
        amount: args.amount as number | undefined,
        concept: args.concept as string | undefined,
        dueDate: args.due_date as string | undefined,
      })
      return { text: res.text, data: res.data, clientId: res.preparedAction?.clientId, clientName: res.preparedAction?.clientName, preparedAction: res.preparedAction as PreparedActionDraft | undefined }
    }

    // Legacy name — agent may use this if it ignores the new split tools
    case 'prepare_action': {
      const actionType = args.type as 'booking' | 'invoice' | 'task'
      const { clientId, clientName } = await resolveClientUuid(supabase, workspaceId, args.client_id as string | undefined, args.client_name as string | undefined)
      if (actionType === 'task') {
        const res = toolPrepareTask({
          clientId,
          clientName,
          taskTitle: args.task_title as string | undefined,
          description: args.description as string | undefined,
          dueDate: args.due_date as string | undefined,
        })
        return { text: res.text, data: res.data, clientId: res.preparedAction?.clientId, clientName: res.preparedAction?.clientName, preparedAction: res.preparedAction as PreparedActionDraft | undefined }
      }
      const res = toolPrepareAction(actionType ?? 'booking', {
        clientId,
        clientName,
        service: args.service as string | undefined,
        date: args.date as string | undefined,
        time: args.time as string | undefined,
        duration: args.duration as number | undefined,
        amount: args.amount as number | undefined,
        concept: args.concept as string | undefined,
        dueDate: args.due_date as string | undefined,
      })
      return { text: res.text, data: res.data, clientId: res.preparedAction?.clientId, clientName: res.preparedAction?.clientName, preparedAction: res.preparedAction as PreparedActionDraft | undefined }
    }

    default:
      return { text: 'No pude ejecutar esa operación. Prueba reformulando la consulta.', data: null }
  }
}

// --- OpenAI Responses API call ---

async function callOpenAI(
  apiKey: string,
  instructions: string,
  input: InputItem[],
  signal: AbortSignal,
  withTools: boolean,
): Promise<OAIResponse> {
  const res = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      instructions,
      input,
      ...(withTools ? { tools: TOOLS } : {}),
      max_output_tokens: 1024,
      temperature: 0.2,
    }),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`)
  }

  return res.json() as Promise<OAIResponse>
}

// --- Extract text from OpenAI output ---

function extractText(output: OAIItem[]): string {
  return output
    .filter(isMessage)
    .flatMap((m) => m.content.filter((c) => c.type === 'output_text').map((c) => c.text ?? ''))
    .join('')
    .trim()
}

// --- Strip markdown artifacts ---

function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<=\s|^)\*([^*\n]+)\*(?=\s|$)/gm, '$1')
    .replace(/(?<=\s|^)_([^_\n]+)_(?=\s|$)/gm, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\|.*\|$/gm, '')
    .replace(/^\|[-| :]+\|$/gm, '')
    .replace(/^(\s*[-*_]){3,}\s*$/gm, '')
    .replace(/[\.\!]?\s*Si (necesitas|tienes|quieres|requieres)[^.!\n]*[.!]?/gi, '')
    .replace(/[\.\!]?\s*No dudes en[^.!\n]*[.!]?/gi, '')
    .replace(/[\.\!]?\s*Espero (haber)?te [^.!\n]*[.!]?/gi, '')
    .replace(/[\.\!]?\s*Cualquier (otra )?(cosa|duda|pregunta)[^.!\n]*[.!]?/gi, '')
    .replace(/[\.\!]?\s*Estoy (aquí|disponible) para[^.!\n]*[.!]?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// --- Per-tool format prompt ---

function buildFormatPrompt(tool: string, rawText: string, rawData: unknown, userMessage: string): string {
  const dataJson = rawData != null
    ? JSON.stringify(rawData).slice(0, 4000)
    : rawText.slice(0, 2000)

  const base = `El usuario preguntó: "${userMessage}"

FORMATO OBLIGATORIO — PROHIBIDO USAR:
- **negritas**, __subrayado__, *cursivas*
- ### títulos ni # encabezados
- tablas con | pipes |
- separadores ---
- frases tipo "si necesitas más información" o "no dudes en contactarme"
- mencionar Supabase, OpenAI, tools, endpoint ni backend

`

  switch (tool) {
    case 'list_clients':
      return `${base}Datos del CRM (JSON con todos los campos):
${dataJson}

Genera esta respuesta exacta:
- Primera línea: "📊 Tienes X clientes en el CRM." (X = número exacto del JSON)
- Línea en blanco
- Lista numerada de TODOS los clientes con este formato por línea:
  "N. Nombre — Empresa — estado — score X — canal"
  Si no hay empresa: omitirla. Si falta algún campo: "No consta".
- Línea en blanco
- Última parte: recomendación de los 2-3 con mayor lead_score.
  Ejemplo: "🔥 Yo priorizaría a Miguel Torres, Ana Rodríguez y Laura García — son los que tienen mayor puntuación comercial ahora mismo."
- Sin más texto adicional.`

    case 'hot_leads':
      return `${base}Datos del CRM (JSON):
${dataJson}

Genera esta respuesta:
- Primera línea: "🔥 El cliente con más potencial ahora mismo es [nombre_top], de [empresa_top]." (usa el primero del JSON)
- Segunda parte (2-3 líneas):
  "Score: X"
  "Estado: X"
  "Canal: X"
  "Motivo: es el cliente con mayor puntuación comercial y está en estado activo."
- Si hay más clientes en la lista, añadir:
  "También vigilaría:"
  "1. Nombre — score X"
  "2. Nombre — score X"
- Cierre: "Siguiente acción: prepararía una cita o tarea de seguimiento para no dejar enfriar la oportunidad."
- Sin más texto adicional.`

    case 'get_client_context':
      return `${base}Datos del CRM (JSON con cliente, facturas y citas):
${dataJson}

Genera esta ficha completa:
"📌 [nombre] — [empresa] (si consta)"
""
"Estado: [valor]"
"Score: [valor]"
"Canal: [valor]"
"Email: [valor o No consta]"
"Teléfono: [valor o No consta]"
"Notas: [valor o No constan]"
""
"💸 Facturación:"
Si hay facturas: lista cada una como "- [importe]€ — [estado] — vence/venció el [fecha en español]"
Si no hay: "No constan facturas registradas."
""
"📅 Citas:"
Si hay eventos: lista cada uno como "- [título] el [fecha]"
Si no hay: "No constan citas próximas."
""
"✅ Siguiente acción recomendada:"
"[1 frase concreta basada en el estado y score del cliente]"
- Sin negritas, sin asteriscos, sin markdown extra.`

    case 'search_clients':
      return `${base}Datos:
${dataJson}

Si hay un solo cliente: muestra ficha básica (nombre, empresa, estado, score, canal).
Si hay varios: lista numerada breve y pregunta "¿A cuál te refieres?".
Si no hay: "No encontré ningún cliente con ese nombre. Prueba con el nombre completo o el email."
Sin negritas, sin asteriscos.`

    case 'crm_overview':
      return `${base}Datos del CRM:
${rawText}

Responde como resumen ejecutivo conciso. Empieza con el dato más urgente si hay facturas vencidas o leads calientes.
Sin negritas, sin asteriscos.`

    case 'pending_invoices':
    case 'overdue_invoices':
      return `${base}Datos del CRM:
${rawText}

Genera esta respuesta:
- Primera línea: "💸 Hay X facturas pendientes por un total de X€." o "⚠️ Hay X facturas vencidas por X€."
- Línea en blanco
- Lista numerada, una por línea:
  "1. [cliente o 'cliente no asociado'] — [importe]€ — [venció/vence] el [fecha legible]"
- Si hay vencidas: añadir "⚠️ Prioridad: resolver las facturas vencidas primero."
- Sin negritas, sin asteriscos.`

    case 'upcoming_events':
      return `${base}Datos del CRM:
${rawText}

Genera esta respuesta:
- Primera línea: "📅 Tienes X cita(s) próxima(s)." (X = número real)
- Lista numerada:
  "1. [título] — [fecha] a las [hora si consta] — [cliente si consta]"
- Si no hay citas: "📅 No tienes citas próximas en el calendario."
- Sin negritas, sin asteriscos.`

    case 'pending_tasks':
      return `${base}Datos del CRM:
${rawText}

Genera esta respuesta:
- Primera línea: "✅ Tienes X tarea(s) pendiente(s)." (X = número real)
- Lista numerada:
  "1. [título] — [cliente si consta] — vence [fecha si consta]"
- Si no hay tareas: "✅ Sin tareas pendientes. La agenda está limpia."
- Sin negritas, sin asteriscos.`

    case 'recommended_actions':
      return `${base}Datos del CRM:
${rawText}

Genera un plan del día profesional con este formato:
"📊 Para hoy priorizaría [N] cosas:"
""
"1. [Título acción]"
"[1 frase de contexto con datos reales: importe, nombre cliente, fecha]"
""
"2. [Título acción]"
"[1 frase de contexto]"
(continuar por cada acción)
""
Cierre: "Si quieres, te preparo ahora la primera tarea o cita."
- Sin negritas, sin asteriscos, sin markdown.`

    case 'prepare_booking':
    case 'prepare_task':
    case 'prepare_invoice':
    case 'prepare_action':
      return `${base}Datos:
${rawText}

Genera una confirmación limpia del draft:
- Si es cita: "📅 Te preparo una cita con [cliente] para [fecha] a las [hora]. [Si faltan datos: 'Me falta fecha y hora para dejarla cerrada.'] Revísala y confirma."
- Si es factura: "💸 Te preparo una factura para [cliente] de [importe]€ por [concepto]. [Si faltan datos: 'Me falta importe o concepto.'] Revísala y confirma."
- Si es tarea: "✅ Te preparo una tarea de seguimiento para [cliente]: [título]. La dejaría como prioridad comercial. Confirma cuando quieras."
- Sin negritas, sin asteriscos.`

    default:
      return `${base}Datos del CRM:
${rawText}

Responde en español natural, directo, con criterio comercial. Sin markdown. Máximo 6 frases.`
  }
}

// --- Main agent ---

export async function runNowLabsAgent(
  supabase: SupabaseClient,
  workspaceId: string,
  message: string,
  context?: AgentContext,
): Promise<AgentV2Result> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { answer: 'OPENAI_API_KEY no configurada.', debugSource: 'openai_agent_v2', toolCalls: [], error: 'missing_api_key' }
  }

  const systemPrompt = buildSystemPrompt(context)
  const localLastResults: Row[] = context?.lastResults?.slice(0, 20) ?? []

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  const toolCallsLog: string[] = []
  let referencedClientId: string | undefined
  let referencedClientName: string | undefined
  let referencedList: Row[] | undefined
  let dataPreview: unknown
  let preparedAction: PreparedActionDraft | undefined

  try {
    // Pre-router: unambiguous READ queries bypass LLM tool-selection
    const route = preRoute(message)
    if (route) {
      const args = 'args' in route ? (route.args as Args) : {}
      const result = await runTool(route.tool, args, supabase, workspaceId, localLastResults)
      toolCallsLog.push(route.tool)
      if (result.clientId) referencedClientId = result.clientId
      if (result.clientName) referencedClientName = result.clientName
      if (result.referencedList) referencedList = result.referencedList
      if (result.data !== null && result.data !== undefined) dataPreview = result.data
      if (result.preparedAction) preparedAction = result.preparedAction

      const formatInput: InputItem[] = [
        { role: 'user', content: buildFormatPrompt(route.tool, result.text, result.data, message) },
      ]
      const formatted = await callOpenAI(apiKey, systemPrompt, formatInput, controller.signal, false)
      const answer = cleanMarkdown(extractText(formatted.output) || result.text)

      return { answer, debugSource: 'openai_agent_v2', toolCalls: toolCallsLog, referencedClientId, referencedClientName, referencedList, dataPreview, preparedAction }
    }

    // Full agent loop: actions, contextual queries, complex combinations
    const input: InputItem[] = [{ role: 'user', content: message }]

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const body = await callOpenAI(apiKey, systemPrompt, input, controller.signal, true)

      if (body.error) throw new Error(body.error.message)

      const calls = body.output.filter(isFunctionCall)

      if (!calls.length) {
        return {
          answer: cleanMarkdown(extractText(body.output) || 'Sin respuesta del agente.'),
          debugSource: 'openai_agent_v2',
          toolCalls: toolCallsLog,
          referencedClientId,
          referencedClientName,
          referencedList,
          dataPreview,
          preparedAction,
        }
      }

      for (const item of body.output) input.push(item as InputItem)

      for (const call of calls) {
        toolCallsLog.push(call.name)
        let args: Args = {}
        try { args = JSON.parse(call.arguments) } catch { /* empty args */ }

        const result = await runTool(call.name, args, supabase, workspaceId, localLastResults)
        if (result.clientId) referencedClientId = result.clientId
        if (result.clientName) referencedClientName = result.clientName
        if (result.referencedList) referencedList = result.referencedList
        if (result.data !== null && result.data !== undefined) dataPreview = result.data
        if (result.preparedAction) preparedAction = result.preparedAction

        input.push({ type: 'function_call_output', call_id: call.call_id, output: result.text })
      }
    }

    // MAX_ROUNDS reached
    const final = await callOpenAI(apiKey, systemPrompt, input, controller.signal, false)
    return {
      answer: cleanMarkdown(extractText(final.output) || 'Límite de rondas alcanzado.'),
      debugSource: 'openai_agent_v2',
      toolCalls: toolCallsLog,
      referencedClientId,
      referencedClientName,
      referencedList,
      dataPreview,
      preparedAction,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { answer: `Error del agente: ${msg}`, debugSource: 'openai_agent_v2', toolCalls: toolCallsLog, error: msg }
  } finally {
    clearTimeout(timer)
  }
}
