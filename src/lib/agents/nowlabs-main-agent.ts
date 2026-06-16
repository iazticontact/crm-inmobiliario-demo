// Asistente IA v2 — único cerebro del CRM.
// OpenAI Responses API + 28 tools sobre Supabase real. Sin n8n, sin service_role, sin SQL libre.
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
  toolRecentActivity,
  toolRecentMessages,
  toolRecentConversations,
  toolRecommendedActions,
  toolAutomationRecommendations,
  toolSelectByOrdinal,
  toolLatestClients,
  toolOldestClient,
  toolPrepareAction,
  toolPrepareTask,
  toolWorkspaceOverview,
  toolListPendingItems,
  toolSummarizeInboxStatus,
} from '@/lib/assistant-tools'
import {
  listOpportunitiesServer,
  listServiceCasesServer,
  listPropertiesServer,
  createOpportunityServer,
  updateOpportunityStageServer,
  createServiceCaseServer,
  updateServiceCaseStatusServer,
  createPropertyServer,
  updatePropertyStatusServer,
  formatOpportunityLine,
  formatServiceCaseLine,
  formatPropertyLine,
} from '@/lib/vertical-server'

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

export type CancelEventItem = {
  eventId: string
  clientName?: string
  date?: string
  time?: string
  title?: string
}


export type PreparedActionDraft = {
  type: 'booking' | 'invoice' | 'task' | 'cancel_booking' | 'reschedule_booking' | 'cancel_multiple_bookings' | 'cleanup_duplicate_bookings' | 'create_operation' | 'create_service_case' | 'move_operation_stage' | 'update_task' | 'update_service_case'
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
  // RT5.1b / RT5.1b-2 — create + update CRM actions
  stage?: string
  value?: number
  probability?: number
  caseType?: string
  status?: string
  priority?: string
  // RT5.1b-2 — ids reales resueltos por el resolver DB (move/update)
  opportunityId?: string
  taskId?: string
  caseId?: string
  currentStageLabel?: string
  missingFields: string[]
  // cancel_booking / reschedule_booking
  eventId?: string
  title?: string
  reason?: string
  // reschedule_booking: previous values
  oldDate?: string
  oldTime?: string
  // cancel_multiple_bookings / cleanup_duplicate_bookings
  events?: CancelEventItem[]
  // cleanup_duplicate_bookings
  keepEventId?: string
  cancelEventIds?: string[]
}

export type AgentContext = {
  lastReferencedClientId?: string
  lastReferencedClientName?: string
  lastResults?: Row[]
  lastCalendarResults?: Row[]
  lastPreparedAction?: {
    type: string
    eventId?: string
    clientId?: string
    clientName?: string
    date?: string
    time?: string
    title?: string
    service?: string
  }
  lastConfirmedEventId?: string
  lastConfirmedClientName?: string
  lastConfirmedDate?: string
  // Operator identity from `profiles` (full_name, role). Only set when
  // resolved server-side; never trusted from the request body. The system
  // prompt uses these to adapt tone — never to make decisions about
  // permissions (RLS is the source of truth for that).
  operator?: {
    displayName?: string
    role?: string
  }
}

export type AgentV2Result = {
  answer: string
  // `openai_agent_v2` for the primary OpenAI Responses path.
  // `deterministic_fallback` for the regex-based safety net in
  // /api/assistant/v2 that engages when the agent didn't produce a
  // preparedAction (no key, OpenAI 4xx/5xx, timeout, or conversational reply
  // to an action-shaped prompt).
  debugSource: 'openai_agent_v2' | 'deterministic_fallback'
  toolCalls: string[]
  referencedClientId?: string
  referencedClientName?: string
  referencedList?: Row[]
  referencedCalendarList?: Row[]
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

// Pre-router — solo intercepta comandos 100% inequívocos (listados puros con keyword
// explícita). Todo lo que requiera razonamiento (resúmenes, "qué tengo pendiente",
// "qué clientes calientes", búsqueda por nombre, plan del día, datos de un cliente,
// automatizaciones) pasa al LLM con tools, que puede elegir entre workspace_overview,
// crm_overview, list_pending_items, recommended_actions, hot_leads, get_client_context,
// search_clients, summarize_inbox_status, etc. según el contexto real del mensaje.
//
// Filosofía: pre-router = atajo de latencia para comandos triviales. NO debe sustituir
// al LLM en interpretación. Si tienes duda, devolver null y dejar que el LLM decida.
function preRoute(message: string): PreRoute {
  const t = normalize(message)

  // 0. Frases de acción/cancelación/escritura → SIEMPRE al loop completo del agente.
  //    Estas reglas son safety-critical y no deben relajarse.
  if (/\b(cancel[ae](?:r|[sm]|me|la|las)?|elimina[r]?|borra[r]?|quita[r]?|suprime[r]?|borra?la|quitala|cancelala|cancelamela)\b/.test(t)) return null
  if (/\b(me\s+he\s+equivocado|ya\s+no\s+hace\s+falta|no\s+puedo\s+ir|cancela(?:me)?la|borra?la|quitala)\b/.test(t)) return null
  if (/\b(todas\s+ellas|cancela\s+todas|borra\s+todas|deja\s+solo\s+una|las\s+repetidas|las\s+duplicadas)\b/.test(t)) return null
  if (/\b(prepara|crea|agenda|pon|ponme|crear|preparar|haz|hazme|abre|abrir|registra|registrar|añade|añadir|sube|subir)\b.*\b(cita|reunion|tarea|factura|oportunidad|expediente|propiedad|lead)\b/.test(t)) return null
  if (/\b(cita|reunion)\b.*\b(con|para)\b/.test(t) && /\b(manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo|pasado)\b/.test(t)) return null
  if (/\b(mueve|muevela|cambia|cambiala|reprograma|pasa|pasala)\b/.test(t)) return null

  // 1. Listados puros con filtro explícito → atajo seguro.
  //    "todos los clientes", "clientes activos", "leads" — sin ambigüedad.
  if (
    /\btodos\b.*\bclientes\b/.test(t) ||
    /\bclientes\b.*\btodos\b/.test(t) ||
    /\b(listame|lista de|dame la lista)\b.*\bclientes\b/.test(t) ||
    /^(clientes|mis clientes|lista de clientes)$/.test(t)
  ) return { tool: 'list_clients', args: {} }

  if (/^clientes?\s+activos?\.?$/.test(t) || /\bclientes?\s+activos?\b/.test(t)) return { tool: 'list_clients', args: { status: 'active' } }
  if (/^clientes?\s+inactivos?\.?$/.test(t) || /\bclientes?\s+inactivos?\b/.test(t)) return { tool: 'list_clients', args: { status: 'inactive' } }
  // "leads" solo → lista; "lead caliente"/"mejor lead" → al LLM (lo decide hot_leads).
  if (/^leads?\.?$/.test(t) || (/\bleads?\b/.test(t) && !/potencial|caliente|score|prometedor|mejor|mayor|top|alto|fuerte|interesante/.test(t))) {
    return { tool: 'list_clients', args: { status: 'lead' } }
  }

  // 2. Facturas — categorías inequívocas.
  if (/\bfacturas?\s+vencidas?\b/.test(t) || /\bfacturas?\s+atrasadas?\b/.test(t) || /\bcobros?\s+vencidos?\b/.test(t) || /\bimpagos?\b/.test(t)) {
    return { tool: 'overdue_invoices' }
  }
  if (/\b(facturas?\s+pendientes?|cobros?\s+pendientes?|facturas?\s+(sin\s+pagar|impagadas?))\b/.test(t)) {
    return { tool: 'pending_invoices' }
  }

  // 3. Citas próximas — solo expresiones explícitas de "próximas citas".
  //    Quitamos "agenda"/"calendario"/"que tengo hoy" (ambiguos con tareas/pendientes).
  if (/\b(proximas?\s+citas?|citas?\s+proximas?|citas?\s+del\s+dia|citas?\s+de\s+(hoy|manana))\b/.test(t)) {
    return { tool: 'upcoming_events' }
  }

  // 4. Tareas pendientes — expresión explícita.
  if (/\b(tareas?\s+pendientes?|pendientes?\s+de\s+hacer|tareas?\s+abiertas?|mis\s+tareas?)\b/.test(t)) {
    return { tool: 'pending_tasks' }
  }

  // 5. Mensajes recientes con keyword explícita (canal Inbox).
  if (
    /\b(mensajes?\s+(recientes?|de\s+hoy|nuevos?)|mensajes?\s+de\s+whatsapp|ultimos?\s+mensajes?|conversaciones?\s+recientes?|ultimas?\s+conversaciones?)\b/.test(t)
  ) {
    const channel = /whatsapp/.test(t) ? 'whatsapp' : /instagram/.test(t) ? 'instagram' : /email/.test(t) ? 'email' : undefined
    return { tool: 'recent_messages', args: { channel } }
  }

  // TODO LO DEMÁS → null → LLM decide.
  // Esto incluye intencionalmente: "como va todo", "resumen del crm", "plan del dia",
  // "que tengo pendiente", "clientes calientes", "automatizaciones", "datos de X",
  // "busca a X", "estado del inbox", "que puedes hacer", "que oportunidades hay",
  // "agenda", "calendario", "que tengo hoy"... el LLM elige la mejor tool de las 30+.
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
    name: 'workspace_overview',
    description: 'Resumen ejecutivo cross-vertical del workspace: clientes + oportunidades + expedientes + propiedades + facturas + citas + tareas + inbox abierto, todo en una sola lectura paralela. Preferir esto a crm_overview cuando el usuario pregunte "cómo va todo", "resumen general", "estado del negocio", "qué tengo en marcha", "panorama del workspace".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'list_pending_items',
    description: 'Consolida TODO lo pendiente que requiere atención: facturas vencidas + facturas pendientes + tareas + próximas citas + expedientes abiertos (con fuera de plazo) + conversaciones de Inbox abiertas. Para: "qué tengo pendiente", "qué tengo abierto", "qué hay urgente", "qué necesita atención", "muéstrame lo urgente".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'summarize_inbox_status',
    description: 'Resumen de Inbox: total de conversaciones, abiertas, negativas y desglose por canal (whatsapp, instagram, email, web). Para: "estado del inbox", "qué hay en el inbox", "cómo van las conversaciones", "qué canal tiene más mensajes".',
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
    name: 'recent_activity',
    description: 'Actividad reciente REAL del CRM (tabla activities: creaciones, cambios, notas). Para: "qué ha pasado recientemente", "qué actividad hay", "resumen del día" (eventos del CRM). Distinto de mensajes/conversaciones de Inbox.',
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
    description: 'Prepara un draft de cita (NUNCA la crea). FLUJO OBLIGATORIO: llama check_calendar_conflicts(date, time, client_name) ANTES de llamar esta tool cuando tengas fecha y hora — solo omite el check si el usuario ya lo pidió explícitamente ("créala igualmente"). Para: "prepara una cita", "agenda una reunión", "pon una cita con X".',
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
  {
    type: 'function',
    name: 'search_calendar_events',
    description: 'Busca citas/eventos en el calendario por cliente, fecha y/o texto. USA ESTO PRIMERO cuando el usuario quiera cancelar, modificar o consultar una cita específica. Para: "la cita de Miguel mañana", "la de mañana a las 10", "la reunión sobre coches", "cancélamela", "cancela la de Miguel Torres mañana".',
    parameters: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'Nombre del cliente (parcial, flexible). Omite si no se conoce.' },
        date: { type: 'string', description: 'Fecha YYYY-MM-DD, o "today"/"tomorrow"/"this_week" para fechas relativas.' },
        text: { type: 'string', description: 'Texto a buscar en título o descripción del evento.' },
        limit: { type: 'number', description: 'Máximo de resultados (por defecto 5).' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'check_calendar_conflicts',
    description: 'Comprueba si hay conflictos de horario antes de crear una cita. LLAMA ESTO SIEMPRE antes de prepare_booking cuando tengas fecha y hora. Si hay conflicto, avisa al usuario y ofrece opciones. Si no hay conflicto, llama prepare_booking normalmente.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Fecha YYYY-MM-DD de la nueva cita.' },
        time: { type: 'string', description: 'Hora HH:MM de la nueva cita.' },
        duration: { type: 'number', description: 'Duración en minutos (por defecto 60).' },
        client_name: { type: 'string', description: 'Nombre del cliente de la nueva cita (para detectar duplicados exactos).' },
      },
      required: ['date'],
    },
  },
  {
    type: 'function',
    name: 'prepare_reschedule_booking',
    description: 'Prepara un draft para MOVER una cita a otra fecha/hora (NUNCA la mueve directamente). Usa search_calendar_events primero para obtener el event_id. Para: "muévela a las 12", "cambia la cita al lunes", "pásala a mañana a las 16", "reprograma la de Miguel".',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'UUID real del evento obtenido de search_calendar_events. OBLIGATORIO.' },
        client_name: { type: 'string', description: 'Nombre visible del cliente' },
        old_date: { type: 'string', description: 'Fecha actual del evento YYYY-MM-DD' },
        old_time: { type: 'string', description: 'Hora actual del evento HH:MM' },
        new_date: { type: 'string', description: 'Nueva fecha YYYY-MM-DD' },
        new_time: { type: 'string', description: 'Nueva hora HH:MM' },
        duration: { type: 'number', description: 'Duración en minutos (mantener la existente si no se especifica)' },
        title: { type: 'string', description: 'Título del evento' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'prepare_cancel_booking',
    description: 'Prepara un draft de CANCELACIÓN de cita (NUNCA cancela directamente — solo prepara la card de confirmación). USA search_calendar_events primero para obtener el event_id real. Para: "cancela la cita", "elimina la reunión", "bórrala", "cancélamela".',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'UUID real del evento obtenido de search_calendar_events. OBLIGATORIO para poder confirmar la cancelación.' },
        client_name: { type: 'string', description: 'Nombre visible del cliente' },
        date: { type: 'string', description: 'Fecha del evento YYYY-MM-DD' },
        time: { type: 'string', description: 'Hora del evento HH:MM' },
        title: { type: 'string', description: 'Título del evento' },
        reason: { type: 'string', description: 'Motivo de cancelación si el usuario lo menciona' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'prepare_cancel_multiple_bookings',
    description: 'Prepara cancelación de MÚLTIPLES citas a la vez sin confirmar ninguna todavía. USAR EXACTAMENTE cuando el usuario dice "todas", "todas ellas", "las N citas", "cancela todas", "borra todas", "quiero que canceles todas" después de ver una lista de citas. NO preguntar cuál — preparar TODAS las del contexto. Obtén los event_ids de CITAS EN CONTEXTO o de search_calendar_events.',
    parameters: {
      type: 'object',
      properties: {
        event_ids: { type: 'array', items: { type: 'string' }, description: 'Array de UUIDs de todos los eventos a cancelar, obtenidos de CITAS EN CONTEXTO o de search_calendar_events.' },
        reason: { type: 'string', description: 'Motivo de cancelación si el usuario lo menciona.' },
      },
      required: ['event_ids'],
    },
  },
  {
    type: 'function',
    name: 'prepare_cleanup_duplicates',
    description: 'Prepara limpieza de duplicados: conserva una cita y cancela las demás. USAR cuando el usuario dice "deja solo una", "cancela las duplicadas", "las repetidas", "quédate con una", "borra las copias". Conserva el primero/más antiguo salvo que el usuario pida uno específico.',
    parameters: {
      type: 'object',
      properties: {
        event_ids: { type: 'array', items: { type: 'string' }, description: 'Todos los IDs duplicados incluyendo el que se conserva. Obtenidos de CITAS EN CONTEXTO.' },
        keep_event_id: { type: 'string', description: 'ID del evento a conservar. Opcional: si no se especifica, conservar el primero de la lista (más antiguo).' },
      },
      required: ['event_ids'],
    },
  },

  // -------------------------------------------------------------------------
  // Vertical Pack v1 — opportunities / service_cases / properties.
  //
  // Writes (create_*, update_*_stage/status) execute the action directly. The
  // system prompt instructs the agent to ALWAYS confirm in natural language
  // before calling them ("¿Quieres que la cree?" → user says sí → tool fires).
  // No UI cards needed; the agent acts as the confirmation layer. Each write
  // also appends a workspace-scoped activity log row for auditing.
  // -------------------------------------------------------------------------

  {
    type: 'function',
    name: 'list_opportunities',
    description: 'Lista oportunidades del pipeline comercial. Filtros opcionales: vertical (real_estate / immigration / professional_services / general) y stage (new / contacted / qualified / visit_scheduled / offer / negotiation / won / lost / documentation / in_review / submitted / in_follow_up / resolved / closed). Para: "qué oportunidades tengo", "leads abiertos", "pipeline de inmobiliaria", "leads fríos en negociación".',
    parameters: {
      type: 'object',
      properties: {
        vertical: { type: 'string', description: 'Vertical a filtrar (opcional). Ej: real_estate, immigration.' },
        stage: { type: 'string', description: 'Etapa a filtrar (opcional). Ej: new, qualified, offer, negotiation.' },
        limit: { type: 'number', description: 'Máximo de resultados (default 25).' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'list_service_cases',
    description: 'Lista expedientes / casos de servicio (extranjería, asesoría). Filtros opcionales: vertical y status (open / documentation_pending / in_review / submitted / resolved / closed). Para: "qué expedientes están pendientes de documentación", "casos de NIE abiertos".',
    parameters: {
      type: 'object',
      properties: {
        vertical: { type: 'string', description: 'Vertical (opcional). Suele ser immigration.' },
        status: { type: 'string', description: 'Estado (opcional). Ej: open, documentation_pending, submitted.' },
        limit: { type: 'number', description: 'Máximo (default 25).' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'list_properties',
    description: 'Lista propiedades del vertical inmobiliario. Filtros opcionales: status (prospecting / listed / under_contract / sold / archived) y city. Para: "propiedades en captación", "qué tenemos en Marbella", "inmuebles en venta".',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Estado de la propiedad (opcional).' },
        city: { type: 'string', description: 'Ciudad/zona (parcial, opcional).' },
        limit: { type: 'number', description: 'Máximo (default 25).' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'create_opportunity',
    description: 'CREA UNA OPORTUNIDAD REAL en el pipeline. ANTES de llamar esta tool DEBES haber descrito la oportunidad al usuario y haber recibido confirmación natural ("sí, créala" / "ok" / "adelante"). NUNCA llames esta tool en la primera mención — primero pregunta. Para: "crea un lead inmobiliario para Ana", "abre una oportunidad de venta de chalet", "registra este lead".',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título corto y descriptivo de la oportunidad. Ej: "Venta piso 3 hab en Málaga centro - Ana Pérez".' },
        vertical: { type: 'string', description: 'Vertical: real_estate, immigration, professional_services o general.' },
        stage: { type: 'string', description: 'Etapa inicial (opcional, default new). Ej: new, contacted, qualified.' },
        client_id: { type: 'string', description: 'UUID del cliente si ya está vinculado (obtenido de search_clients).' },
        client_name: { type: 'string', description: 'Nombre visible del cliente (string libre).' },
        value: { type: 'number', description: 'Valor estimado en euros (opcional).' },
        source: { type: 'string', description: 'Origen del lead: whatsapp, instagram, web, referencia, etc. (opcional).' },
        expected_close_date: { type: 'string', description: 'Fecha estimada de cierre YYYY-MM-DD (opcional).' },
        notes: { type: 'string', description: 'Notas adicionales (opcional).' },
      },
      required: ['title', 'vertical'],
    },
  },
  {
    type: 'function',
    name: 'update_opportunity_stage',
    description: 'Actualiza la ETAPA de una oportunidad existente. Confirma con el usuario antes de llamar. Necesita el UUID exacto — si no lo tienes, llama list_opportunities primero para identificarla.',
    parameters: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string', description: 'UUID exacto de la oportunidad.' },
        stage: { type: 'string', description: 'Nueva etapa: new, contacted, qualified, visit_scheduled, offer, negotiation, won, lost, documentation, in_review, submitted, in_follow_up, resolved, closed.' },
      },
      required: ['opportunity_id', 'stage'],
    },
  },
  {
    type: 'function',
    name: 'create_service_case',
    description: 'CREA UN EXPEDIENTE de servicio (extranjería / asesoría). Confirma con el usuario antes. Para: "abre expediente de renovación NIE para Ana", "registra arraigo social", "prepara expediente de reagrupación familiar".',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título del expediente. Ej: "Renovación NIE - Ana Pérez".' },
        case_type: { type: 'string', description: 'Tipo: nie_renewal, arraigo_social, family_reunification, student_residence, asesoria_fiscal, etc.' },
        vertical: { type: 'string', description: 'Vertical (default immigration).' },
        status: { type: 'string', description: 'Estado inicial: open (default), documentation_pending, in_review.' },
        priority: { type: 'string', description: 'Prioridad: low, normal (default), high, urgent.' },
        client_id: { type: 'string', description: 'UUID del cliente si está vinculado.' },
        client_name: { type: 'string', description: 'Nombre visible del cliente.' },
        opportunity_id: { type: 'string', description: 'UUID de la oportunidad relacionada (opcional).' },
        due_date: { type: 'string', description: 'Fecha límite YYYY-MM-DD (opcional).' },
        notes: { type: 'string', description: 'Notas (opcional).' },
      },
      required: ['title', 'case_type'],
    },
  },
  {
    type: 'function',
    name: 'create_property',
    description: 'CREA UNA PROPIEDAD en cartera inmobiliaria. Confirma con el usuario antes. Para: "registra captación de piso en Marbella", "añade propiedad de Juan en alquiler", "abre captación nueva".',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título visible. Ej: "Piso 3 hab - Marbella Centro".' },
        property_type: { type: 'string', description: 'Tipo: apartment (default), house, villa, commercial, land, office.' },
        operation_type: { type: 'string', description: 'Operación: sale (default) o rent.' },
        status: { type: 'string', description: 'Estado: prospecting (default), listed, under_contract, sold, archived.' },
        city: { type: 'string', description: 'Ciudad (opcional).' },
        area: { type: 'string', description: 'Zona/barrio (opcional).' },
        price: { type: 'number', description: 'Precio en euros (opcional).' },
        client_id: { type: 'string', description: 'UUID del cliente vinculado (opcional).' },
        client_name: { type: 'string', description: 'Nombre visible del cliente.' },
        owner_name: { type: 'string', description: 'Propietario si es diferente del cliente (opcional).' },
        owner_phone: { type: 'string', description: 'Teléfono del propietario (opcional).' },
        notes: { type: 'string', description: 'Notas (opcional).' },
      },
      required: ['title'],
    },
  },
  {
    type: 'function',
    name: 'update_service_case_status',
    description: 'Actualiza el ESTADO de un expediente existente. Confirma con el usuario antes de llamar. Necesita el UUID exacto — si no lo tienes, llama list_service_cases primero. Para: "pasa el expediente de Ana a documentación pendiente", "márcalo como submitted", "cierra este expediente".',
    parameters: {
      type: 'object',
      properties: {
        case_id: { type: 'string', description: 'UUID exacto del expediente.' },
        status: { type: 'string', description: 'Nuevo estado: open, documentation_pending, in_review, submitted, resolved, closed.' },
      },
      required: ['case_id', 'status'],
    },
  },
  {
    type: 'function',
    name: 'update_property_status',
    description: 'Actualiza el ESTADO de una propiedad existente. Confirma con el usuario antes de llamar. Necesita el UUID exacto — si no lo tienes, llama list_properties primero. Para: "pasa la propiedad de Marbella a listed", "márcala como sold", "archívala".',
    parameters: {
      type: 'object',
      properties: {
        property_id: { type: 'string', description: 'UUID exacto de la propiedad.' },
        status: { type: 'string', description: 'Nuevo estado: prospecting, listed, under_contract, sold, archived.' },
      },
      required: ['property_id', 'status'],
    },
  },
]

// --- System prompt base ---

const SYSTEM_PROMPT_BASE = `IDENTIDAD:
Eres el Asistente IA, el asistente interno del CRM. Trabajas dentro del CRM, junto al equipo de la asesoría/inmobiliaria que lo usa. Tu trabajo es ayudar al equipo a operar el negocio: clientes, calendario, tareas, facturación, conversaciones, oportunidades, expedientes y propiedades. No eres un chatbot de soporte ni un asistente genérico — eres parte del equipo y conoces los datos reales del workspace cuando los pides con tools.

PERSONALIDAD Y TONO:
- Español natural de España. Profesional pero majo y cercano, directo, seguro y resolutivo. Tono de compañero del equipo que ya conoce el CRM y se alegra de echar una mano.
- Cálido sin ser pesado: cabe una frase de trato humano (un saludo breve, un "buena idea", un "voy con ello"), pero sin relleno ni paja.
- Sin "¿en qué puedo ayudarte?" suelto: si puedes dar contexto útil o proponer una acción, hazlo en la primera frase.
- Sin frases tipo "estoy aquí para ti", "no dudes en preguntar", "espero haberte ayudado".
- No sonar a IA de soporte. Puedes usar algún emoji ligero y elegante cuando aporte (ver la guía de emojis), sin abusar. Puedes celebrar lo que ya funciona, pero con foco operativo.
- Cuando interpretas datos, dices qué priorizarías: un lead con score 90 es para actuar hoy, una factura vencida es urgente, un expediente fuera de plazo se señala. Si no hay datos, lo dices claro y propones cómo conseguirlos. Nunca inventas.

ALCANCE (CRM del negocio):
- Tu ámbito es el CRM: clientes, operaciones, expedientes, propiedades, tareas, calendario, actividad y próximas acciones. Para eso, tira de tools y responde con datos reales.
- Charla casual (saludos, "¿qué tal?", risas, "gracias"): respóndele HUMANO y natural 1-2 turnos, SIN repetir "estoy operativo" ni reconducir en cada frase. Si te pregunta cómo estás, contesta con naturalidad ("Yo bien, gracias 😊"). Tras un par de turnos, reconduce suave: "¿Miramos algún cliente, operación o tarea?".
- Off-topic real (recetas, cultura general, programar…): NO llames tools; una frase amable y reconduce al CRM. No te enrolles en charla larga ajena al negocio.

PUEDES MIRAR FICHAS (cuando lo pidan):
- Si preguntan si puedes ver clientes/fichas: SÍ. Explica que puedes buscar un cliente y mostrar su ficha (contacto, operaciones, expedientes, tareas, citas y actividad). NUNCA digas "no tengo acceso directo".
- Si falta el nombre, ofrece: "Dime el nombre o tomo uno de ejemplo de tu CRM".
- Si piden "coge un cliente al azar/cualquiera", "te estoy testeando", "enséñame una ficha": ELIGE un cliente REAL (usa list_clients y toma uno activo, p. ej. el más reciente) y di que es un ejemplo real ("He cogido a X, que está en tu CRM"). NUNCA digas primero "no he encontrado…" si lo acabas de elegir tú.

FICHA COMPLETA DE CLIENTE (para "dame sus datos / ficha completa / qué sabes de X"):
- Combina get_client_context con list_opportunities y list_service_cases de ese cliente y preséntalo por secciones, claro y ordenado:
  1) Identificación: nombre, empresa/perfil, estado, email, teléfono, NIF/CIF, dirección.
  2) Interés comercial: tipo/interés, presupuesto, zona, notas.
  3) Operaciones. 4) Expedientes. 5) Tareas (pendientes/vencidas). 6) Próximas citas. 7) Actividad reciente. 8) Datos por completar.
- Si un dato NO existe, escribe "No registrado" / "Sin completar" (nunca un escueto "no tengo").

NUNCA muestres puntuación / "Lead Score" / "score" numérico al usuario: es un dato INTERNO. Si hablas de prioridad, hazlo en cualitativo (alta/media/baja) como "prioridad comercial", sin el número.

RITMO DE CONVERSACIÓN (empleado IA, no bot):
- NO termines cada respuesta con una pregunta tipo "¿quieres revisar algo?". Responde, aporta y para; pregunta solo cuando de verdad necesites un dato para avanzar.
- "¿Cómo funcionas? / ¿qué hay detrás de ti?": explícalo claro y honesto, SIN tecnicismos ni secretos: "Soy un copiloto conectado a tu CRM: cuando preguntas, busco la información en los datos reales del workspace (clientes, operaciones, expedientes, tareas, calendario y actividad) y te respondo con lo que encuentro. Si hay que crear o cambiar algo, preparo la acción y te pido confirmación antes de guardar, para evitar cambios accidentales 😊". NUNCA digas "no tengo detalles técnicos que compartir".
- "¿Qué puedes hacer?": responde con capacidades concretas + 1-2 ejemplos (resumir un cliente, revisar operaciones abiertas, ver tareas pendientes, consultar citas, preparar expedientes/citas con confirmación; p. ej. "dame el resumen de Lucía Herrera" o "qué necesita atención hoy"). No te limites a un "no tengo acceso".

QUÉ PUEDES HACER (capacidades reales hoy):
- Resumir el negocio cruzando todas las áreas (clientes, oportunidades, expedientes, propiedades, facturas, citas, tareas, Inbox).
- Listar y buscar clientes, oportunidades, expedientes, propiedades, facturas, citas y mensajes.
- Consolidar lo pendiente en un solo bloque y proponer prioridades del día.
- Resumir un cliente con su contexto 360 (facturas, citas, conversaciones, actividades).
- Preparar (no ejecutar sin confirmación) citas, tareas, facturas, cancelaciones y reprogramaciones.
- Crear oportunidades, expedientes y propiedades del Vertical Pack — siempre con confirmación natural antes de escribir.
- Detectar duplicados de citas y proponer limpieza.
- Recomendar automatizaciones basadas en el estado real del CRM.
- Disparar automatizaciones n8n (downstream) cuando una acción se ha confirmado y guardado en el CRM.

NO DISPONIBLE TODAVÍA (no prometas que lo haces; di que está previsto):
- Generación o envío automático de PDFs (informes, contratos, presupuestos).
- Envío automático de WhatsApp, Email, SMS o mensajes proactivos al cliente.
- Llamadas automáticas, transcripción o análisis de llamadas.
- Bienvenida automática a clientes nuevos o nurturing automático.
- Análisis automático de presupuestos o reconocimiento de documentos.
Si te piden cualquiera de esto: "Eso está previsto como siguiente módulo, pero todavía no lo ejecuto de forma automática. De momento te lo puedo dejar preparado en una tarea o un borrador para que lo lance una persona."

LÍMITE OPERATIVO CRÍTICO:
- n8n es una capa downstream de automatizaciones — no es el cerebro. Tú decides; n8n solo ejecuta automatizaciones externas DESPUÉS de que una acción se haya confirmado y guardado en el CRM.
- Cualquier acción que cambia datos del CRM pasa por preparedAction + confirmación del operador. Nunca escribes sin esa confirmación (salvo create_opportunity/service_case/property/update_*, que se confirman en lenguaje natural antes de la llamada según la sección Vertical Pack).
- Si OpenAI o una tool fallan, lo dices con claridad y sin filtrar texto técnico ni secretos.

RESPUESTAS CANÓNICAS A PREGUNTAS DE IDENTIDAD:
- "¿funcionas?" / "¿funcionas ya?" / "¿estás operativo?": "Sí, ya estoy operativo. Puedo ayudarte a consultar el CRM, preparar tareas, revisar calendario, facturación y actividad. Cuando una acción cambie datos, te pediré confirmación antes." Adáptalo si tienes contexto real que añadir (p.ej. "Veo 2 facturas vencidas — empezamos por ahí si quieres").
- "¿funcionas bien?": "Sí. Ahora mismo estoy conectado al CRM y puedo trabajar con acciones confirmables. Si quieres, probamos algo concreto: crear una tarea, revisar pendientes o resumir el estado del CRM."
- "¿qué puedes hacer?" / "¿qué haces?" / "¿para qué sirves?": cita 4-6 capacidades reales de la lista de arriba (sin enumerar todas) y propone una acción concreta. Nunca digas "te puedo ayudar con muchas cosas". Concreto siempre.
- "¿quién eres?": "Soy el asistente interno del CRM. Trabajo con los datos del workspace y preparo acciones para que las confirmes."
NUNCA respondas a estas preguntas con frases genéricas tipo "aquí estoy" o "claro que sí". Da contexto útil ya en la primera frase.

CÓMO RAZONAS:
Cada mensaje, decides qué tool ejecutar. No respondes preguntas generales sin datos: si el usuario pregunta algo del CRM, llama la tool que mejor cubra ese ámbito. Si tienes duda entre dos tools, elige la que devuelve MÁS información en una sola pasada (workspace_overview > crm_overview cuando hay verticales en juego; list_pending_items > recommended_actions cuando piden "pendiente"). Si la pregunta es general ("qué clientes calientes tengo") y existe una tool específica (hot_leads), úsala. Si necesitas el ID de algo (cliente, evento) y no lo tienes, llama la tool de búsqueda/listado primero.

MAPA RÁPIDO DE TOOLS:
- "cómo va todo" / "resumen general" / "estado del negocio" / "panorama" → workspace_overview (cross-vertical, lo más completo)
- "resumen del CRM" / "cómo está el negocio" → crm_overview (clientes + facturas + citas + tareas) o workspace_overview si quieres más detalle
- "qué tengo pendiente" / "qué hay urgente" / "qué necesita atención" → list_pending_items (consolidado real)
- "qué debería hacer hoy" / "plan del día" / "prioridades" → recommended_actions
- "estado del inbox" / "cómo van las conversaciones" / "qué canal recibe más" → summarize_inbox_status
- "qué oportunidades tengo" → list_opportunities
- "qué expedientes pendientes" → list_service_cases
- "qué propiedades activas" → list_properties
- "cliente con más potencial" / "mejor lead" / "más caliente" / "mayor score" → hot_leads
- "datos de X" / "quién es X" / "resume a X" / "ficha de X" → get_client_context(client_name=X)
- "busca a X" / "encuentra X" / "localiza X" → search_clients
- "el primero" / "el quinto" / "el último" → select_client_by_ordinal con la LISTA ACTIVA (índice 0-based: primero=0, quinto=4)
- "sus datos" / "ese cliente" / "el anterior" → get_client_context con el ID del CLIENTE ACTIVO
- "facturas pendientes" → pending_invoices
- "facturas vencidas" / "impagos" → overdue_invoices
- "tareas pendientes" → pending_tasks
- "próximas citas" / "qué citas tengo" / "agenda" → upcoming_events
- "mensajes" / "WhatsApp" / "conversaciones recientes" → recent_messages(channel=...)
- "automatizaciones" / "cómo automatizar" → automation_recommendations
- "prepara cita con X" → check_calendar_conflicts → prepare_booking
- "prepara tarea para X" → prepare_task
- "prepara factura para X de N€" → prepare_invoice
- "cancela la cita de X" → search_calendar_events → prepare_cancel_booking
- "mueve la cita a las 12" → search_calendar_events → prepare_reschedule_booking

REGLA: Si una herramienta puede responder directamente, la uso. No pido aclaración para consultas generales.
Para prepare_booking/task/invoice: extraigo TODOS los datos posibles del mensaje. "mañana" = fecha de mañana. "a las 12" = 12:00. Si falta dato, lo indico en la respuesta — no me bloqueo.
Para select_client_by_ordinal: índice 0-based (primero=0, quinto=4, último=N-1).

FLUJO OBLIGATORIO PARA CREAR CITA:
Paso 1: check_calendar_conflicts(date, time, duration, client_name) — SIEMPRE antes de prepare_booking cuando tengas fecha y hora.
Paso 2a: si hasConflict=false → prepare_booking normalmente.
Paso 2b: si hay conflicto exacto (mismo cliente, misma hora) → NO llamar prepare_booking. Decir "Ya existe esa cita. ¿Qué quieres hacer? 1. Mantenerla 2. Moverla 3. Cancelarla 4. Crear otra igualmente."
Paso 2c: si hay conflicto de solapamiento (diferente cliente u hora cercana) → avisar con ⚠️ y ofrecer las mismas opciones.
Paso 2d: si el usuario dice "créala igualmente" / "sí, otra cita" / "quiero duplicarla" → llamar prepare_booking directamente, sin otro check.
Paso 3: Si el usuario quiere MOVER → search_calendar_events + prepare_reschedule_booking.

VERTICAL PACK (oportunidades, expedientes, propiedades):
- list_opportunities / list_service_cases / list_properties: léelos sin confirmar — son lecturas.
- create_opportunity / create_service_case / create_property / update_opportunity_stage / update_service_case_status / update_property_status: SON ESCRITURAS REALES en la DB. ANTES de llamar la tool DEBO:
  1. Describir la acción al usuario con los datos extraídos ("Voy a crear una oportunidad inmobiliaria para Ana, venta de piso en Málaga, sin precio aún. ¿La creo?").
  2. Esperar confirmación natural ("sí" / "ok" / "adelante" / "créala" / "confirma" / "hazlo").
  3. Solo entonces llamar la tool con los args.
- Si el usuario dice "no" / "espera" / "cambia X" → no llamar; reformular.
- Si en el mismo mensaje el usuario ya da una orden inequívoca tipo "crea ya la oportunidad de Ana, 250k, vertical inmobiliario" → puedes crearla sin doble confirmación, pero deja claro en la respuesta que se creó.
- Para verticales conocidos: real_estate, immigration, professional_services, general.

DETECCIÓN DE ACCIONES — identifico siempre la intención real:
- BOOKING: "prepara una cita", "crea una cita", "agenda una reunión", "pon una cita", "cita con X el/mañana/el lunes"
- TASK: "crea una tarea", "recuérdame", "seguimiento de X", "llama a X", "contacta a X"
- INVOICE: "prepara una factura", "factura a X de N€", "cobrar a X", "haz una factura"
- CANCEL: "cancela la cita", "elimina la reunión", "bórrala", "cancélamela", "me he equivocado", "ya no hace falta", "no puedo ir", "quita la cita"
- CANCEL_ALL: "cancela todas", "todas", "todas ellas", "las N citas", "borra todas", "quiero que canceles todas" (cuando hay una lista activa de citas en contexto)

REGLAS DE CANCELACIÓN — CRÍTICAS:
18. Si el usuario dice "cancélamela", "bórrala", "elimínala", "me he equivocado", "ya no hace falta" → intención = CANCEL
    → Paso 1: search_calendar_events() con los datos del contexto (lastConfirmedEventId, lastConfirmedClientName, lastConfirmedDate si existen)
    → Paso 2: prepare_cancel_booking() con el event_id real encontrado
    → NUNCA llamar prepare_booking en respuesta a una intención de cancelar
19. Si hay LAST_CONFIRMED_EVENT en el contexto y el usuario dice "cancélamela" → ese es el evento a cancelar, úsalo directamente en prepare_cancel_booking
20. Si hay varias citas que coinciden Y el usuario NO dijo "todas" ni "todas ellas" ni "las N" → listarlas y preguntar cuál cancelar
21. Si no hay ninguna coincidencia → "No encuentro esa cita. Dime cliente y fecha aproximada."
22. NUNCA confundir cancelar con crear. "Cancélamela" ≠ "Prepara una cita"

REGLAS DE REPROGRAMACIÓN:
23. Si el usuario dice "muévela a las 12" / "cambia la cita al lunes" / "pásala a mañana" → intención = RESCHEDULE
    → Paso 1: si no hay LAST_CONFIRMED_EVENT ni CITAS EN CONTEXTO → search_calendar_events()
    → Paso 2: prepare_reschedule_booking(event_id, old_date, old_time, new_date, new_time)
    → NUNCA mover directamente sin confirmación
24. Si hay varias citas que podrían moverse → pedir cuál, igual que en cancelación

DETECCIÓN DE DUPLICADOS AL LISTAR:
25. Si upcoming_events devuelve citas con el mismo cliente, fecha y hora repetidas → avisar:
    "Veo N citas repetidas con [cliente] el [fecha] a las [hora]. Puedo ayudarte a cancelar las duplicadas y dejar solo una."
26. Ofrecer limpieza solo si el usuario lo pide. Nunca cancelar automáticamente.

CANCELACIÓN MÚLTIPLE — CRÍTICO:
27. Si el usuario dice "todas" / "todas ellas" / "las N" / "cancela todas" / "borra todas" / "quiero que canceles todas" Y hay CITAS EN CONTEXTO (listadas en CITAS EN CONTEXTO) →
    NO preguntar cuál. Llamar prepare_cancel_multiple_bookings(event_ids=[TODOS los IDs de CITAS EN CONTEXTO]) inmediatamente.
    Los IDs están en el formato [ID:uuid] dentro de CITAS EN CONTEXTO.
28. Si el usuario dice "deja solo una" / "cancela las duplicadas" / "las repetidas" / "quédate con una" / "borra las copias" Y hay CITAS EN CONTEXTO →
    Llamar prepare_cleanup_duplicates(event_ids=[todos los IDs del contexto]) — el sistema conserva el primero automáticamente.
29. Si dice "cancela todas menos una" pero no está claro cuál conservar → preguntar: "¿Cuál quieres mantener? La primera, la más reciente, la de las X..."
30. Si el usuario dice "la primera" / "la de las 10" / "la 1" Y hay CITAS EN CONTEXTO → preparar cancel_booking solo para esa cita concreta (no múltiple).

BÚSQUEDA FLEXIBLE DE CLIENTES:
Si el usuario dice "juan garcia" y hay un "Juan Antonio García López", usa ese resultado. Si hay varios candidatos, muestra la lista y pregunta cuál.

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
- Emojis solo cuando aporten valor real: 📊 resumen, 🔥 urgente/caliente, 📅 citas, 💸 facturas/cobros, ✅ tarea lista, ⚠️ aviso urgente, 📌 ficha cliente, 🧹 limpieza/duplicados, ✍️ propuesta/draft pendiente
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

  // OPERADOR EN SESIÓN — resolved server-side from `profiles` (full_name +
  // role). Used to adjust tone, never to grant or deny permissions. RLS is
  // the source of truth for access; the operator block is purely cosmetic.
  //
  // Display name discipline: NEVER repeat the operator's name in every reply
  // — only when it adds something (a greeting, an explicit confirmation).
  // Treat `nowlabs_admin` and `client_admin` as senior operators (more
  // direct, less hand-holding). Treat `member` as default team member.
  //
  // TODO(assistant-profile): when a per-workspace assistant profile lands
  // (custom display name, custom tone overrides, company alias) read it here
  // and append a single "PERSONALIDAD WORKSPACE" line so we never hardcode
  // tenant-specific copy in source.
  if (context?.operator?.displayName || context?.operator?.role) {
    const parts: string[] = []
    if (context.operator.displayName) parts.push(`nombre: ${context.operator.displayName}`)
    if (context.operator.role) parts.push(`rol: ${context.operator.role}`)
    const isAdmin = context.operator.role === 'nowlabs_admin' || context.operator.role === 'client_admin'
    const toneNote = isAdmin
      ? 'Trátalo como operador senior del CRM: directo, sin explicar lo obvio, atajos permitidos.'
      : 'Trátalo como parte del equipo: tono cercano, explica brevemente cuando proponga algo nuevo.'
    lines.push(
      `OPERADOR EN SESIÓN — ${parts.join(' · ')}.\n` +
      `${toneNote}\n` +
      `NUNCA repitas su nombre en cada respuesta; úsalo solo cuando aporte (saludo inicial o confirmación de acción).`
    )
  }

  if (context?.lastReferencedClientName) {
    lines.push(
      `CLIENTE ACTIVO EN CONVERSACIÓN: ${context.lastReferencedClientName}${context.lastReferencedClientId ? ` (ID: ${context.lastReferencedClientId})` : ''} — úsalo con get_client_context cuando el usuario diga "ese cliente", "sus datos", "con ese", "el anterior", "el mismo".`
    )
  }

  if (context?.lastCalendarResults?.length) {
    const trimmed = context.lastCalendarResults.slice(0, 10).map((e, i) => {
      const h = e.start_hour !== undefined ? `${String(e.start_hour).padStart(2, '0')}:${String(e.start_minute ?? 0).padStart(2, '0')}` : '??:??'
      const client = e.client_name ? ` · ${String(e.client_name)}` : ''
      const dur = e.duration ? ` · ${String(e.duration)} min` : ''
      return `${i + 1}. [ID:${String(e.id)}] "${String(e.title ?? 'Sin título')}" · ${String(e.date ?? '?')} ${h}${client}${dur}`
    }).join('\n')
    const allIds = context.lastCalendarResults.slice(0, 10).map((e) => String(e.id)).join(', ')
    lines.push(
      `CITAS EN CONTEXTO (${context.lastCalendarResults.length}) — usa prepare_cancel_booking o prepare_reschedule_booking con el event_id correcto cuando el usuario diga "la primera", "la de las 10", "la 2", "esa".\n` +
      `Si el usuario dice "todas" o "todas ellas" → usa prepare_cancel_multiple_bookings con event_ids=[${allIds}].\n` +
      `Si el usuario dice "deja solo una" o "las repetidas" → usa prepare_cleanup_duplicates con event_ids=[${allIds}].\n` +
      trimmed
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

  if (context?.lastConfirmedEventId) {
    const confirmClient = context.lastConfirmedClientName ? ` con ${context.lastConfirmedClientName}` : ''
    const confirmDate = context.lastConfirmedDate ? ` el ${context.lastConfirmedDate}` : ''
    lines.push(
      `LAST_CONFIRMED_EVENT: Última cita CREADA y confirmada en esta conversación → ID: ${context.lastConfirmedEventId}${confirmClient}${confirmDate}.\n` +
      `Si el usuario dice "cancélamela", "me he equivocado", "bórrala", "la que acabo de crear" → se refiere a ESTA cita.\n` +
      `Llama search_calendar_events con ese ID o client_name/date, luego prepare_cancel_booking con event_id="${context.lastConfirmedEventId}".`
    )
  }

  if (context?.lastPreparedAction) {
    const lpa = context.lastPreparedAction
    if (lpa.type === 'booking' && !context.lastConfirmedEventId) {
      lines.push(
        `LAST_PREPARED_ACTION: Había un draft de cita (tipo ${lpa.type}) pendiente de confirmar — ` +
        `cliente: ${lpa.clientName ?? '?'}, fecha: ${lpa.date ?? '?'}, hora: ${lpa.time ?? '?'}. ` +
        `Si el usuario dice "cancélamela" en este contexto, busca esa cita y prepara cancel_booking.`
      )
    } else if (lpa.type === 'cancel_booking') {
      lines.push(
        `LAST_PREPARED_ACTION: Ya hay una cancelación pendiente de confirmar para ${lpa.clientName ?? '?'} el ${lpa.date ?? '?'}. ` +
        `Si el usuario insiste en cancelar → usa prepare_cancel_booking con event_id="${lpa.eventId ?? ''}". ` +
        `Si el usuario dice "sí" / "confirma" → usa el event_id del contexto.`
      )
    }
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

    case 'workspace_overview': {
      const res = await toolWorkspaceOverview(supabase, workspaceId)
      return { text: res.text, data: res.data }
    }

    case 'list_pending_items': {
      const res = await toolListPendingItems(supabase, workspaceId)
      return { text: res.text, data: res.data }
    }

    case 'summarize_inbox_status': {
      const res = await toolSummarizeInboxStatus(supabase, workspaceId)
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

    case 'recent_activity': {
      const res = await toolRecentActivity(supabase, workspaceId)
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

    case 'search_calendar_events': {
      const clientNameArg = args.client_name as string | undefined
      const dateArg = args.date as string | undefined
      const limitArg = typeof args.limit === 'number' ? Math.min(args.limit, 10) : 5

      const now = new Date()
      const toMadrid = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
      const todayISO = toMadrid(now)
      const tomorrowISO = toMadrid(new Date(now.getTime() + 86_400_000))
      const weekLaterISO = toMadrid(new Date(now.getTime() + 7 * 86_400_000))

      let dateFrom = todayISO
      let dateTo = weekLaterISO

      if (dateArg) {
        if (dateArg === 'today') { dateFrom = todayISO; dateTo = todayISO }
        else if (dateArg === 'tomorrow') { dateFrom = tomorrowISO; dateTo = tomorrowISO }
        else if (dateArg === 'this_week') { dateFrom = todayISO; dateTo = weekLaterISO }
        else { dateFrom = dateArg; dateTo = dateArg }
      }

      const cols = 'id, title, date, start_hour, start_minute, duration, client_id, client_name, status, description, notes, is_read_only'

      const buildQuery = (withDateFilter: boolean, withClientFilter: boolean) => {
        let q = supabase
          .from('calendar_events').select(cols)
          .eq('workspace_id', workspaceId)
          .neq('status', 'cancelled')
          .order('date', { ascending: true })
          .order('start_hour', { ascending: true })
          .limit(limitArg)
        if (withDateFilter) q = q.gte('date', dateFrom).lte('date', dateTo)
        if (withClientFilter && clientNameArg) q = q.ilike('client_name', `%${clientNameArg}%`)
        return q
      }

      let { data: rows } = await buildQuery(true, Boolean(clientNameArg))
      let usedFallback = false

      if ((!rows || !rows.length) && clientNameArg && dateArg) {
        const fb = await buildQuery(false, true)
        rows = fb.data
        usedFallback = true
      }

      const results = (rows ?? []) as Row[]
      if (!results.length) {
        return { text: `No encontré citas${clientNameArg ? ` de ${clientNameArg}` : ''}${dateArg && !usedFallback ? ` para esa fecha` : ''}. Prueba con otro nombre o fecha.`, data: [] }
      }

      const list = results.map((e, i) => {
        const h = e.start_hour !== undefined ? String(e.start_hour).padStart(2, '0') : '??'
        const m = String(e.start_minute ?? 0).padStart(2, '0')
        const dur = e.duration ? ` · ${String(e.duration)} min` : ''
        const rawDate = String(e.date ?? '')
        const dateHuman = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
          ? `${rawDate.slice(8, 10)}/${rawDate.slice(5, 7)}/${rawDate.slice(0, 4)}`
          : rawDate
        const client = e.client_name ? `${String(e.client_name)} — ` : ''
        const service = (e.description || e.notes) ? ` — ${String(e.description ?? e.notes ?? '').slice(0, 40)}` : ''
        const readOnly = e.is_read_only === true ? ' · [solo lectura]' : ''
        return `${i + 1}. [ID:${String(e.id)}] ${client}${dateHuman} — ${h}:${m}${dur}${service}${readOnly}`
      }).join('\n')

      const note = usedFallback ? ' (sin filtro de fecha)' : ''
      return { text: `${results.length} cita(s) encontrada(s)${note}:\n${list}`, data: results, referencedList: results }
    }

    case 'check_calendar_conflicts': {
      const date = args.date as string | undefined
      const time = args.time as string | undefined
      const duration = typeof args.duration === 'number' ? args.duration : 60
      const clientName = args.client_name as string | undefined

      if (!date) return { text: 'Necesito al menos la fecha para verificar conflictos.', data: { hasConflict: false, conflicts: [] } }

      const [newH, newM] = time ? time.split(':').map(Number) : [0, 0]
      const newStartMin = (newH ?? 0) * 60 + (newM ?? 0)
      const newEndMin = newStartMin + duration

      const cols = 'id, title, date, start_hour, start_minute, duration, client_id, client_name, status'
      const { data: rows } = await supabase
        .from('calendar_events').select(cols)
        .eq('workspace_id', workspaceId).eq('date', date).neq('status', 'cancelled')

      const allRows = (rows ?? []) as Row[]
      const conflicts = allRows.filter((e) => {
        const existStart = (Number(e.start_hour) || 0) * 60 + (Number(e.start_minute) || 0)
        const existEnd = existStart + (Number(e.duration) || 60)
        return newStartMin < existEnd && newEndMin > existStart
      })

      if (!conflicts.length) {
        return { text: `Sin conflictos para el ${date}${time ? ` a las ${time}` : ''}. Puedes crear la cita.`, data: { hasConflict: false, conflicts: [] } }
      }

      // Check exact duplicate (same client + same time)
      const exactDup = clientName ? conflicts.find((e) => {
        const sameName = String(e.client_name ?? '').toLowerCase().includes(clientName.toLowerCase())
        const sameHour = Number(e.start_hour) === (newH ?? 0) && Number(e.start_minute) === (newM ?? 0)
        return sameName && sameHour
      }) : null

      const list = conflicts.map((e, i) => {
        const h = String(e.start_hour ?? 0).padStart(2, '0')
        const m = String(e.start_minute ?? 0).padStart(2, '0')
        const client = e.client_name ? ` · ${String(e.client_name)}` : ''
        const dur = e.duration ? ` · ${String(e.duration)} min` : ''
        return `${i + 1}. [ID:${String(e.id)}] "${String(e.title ?? 'Sin título')}" · ${h}:${m}${client}${dur}`
      }).join('\n')

      if (exactDup) {
        return {
          text: `⚠️ Duplicado exacto: ya existe "${String(exactDup.title)}" con ${String(exactDup.client_name)} el ${date} a las ${time}.\nNo crearé otro igual. ¿Qué quieres hacer?\n1. Mantener la cita actual\n2. Moverla a otra hora\n3. Cancelarla\n4. Crear otra igualmente`,
          data: { hasConflict: true, exactDuplicate: true, conflicts },
          referencedList: conflicts,
        }
      }

      return {
        text: `⚠️ ${conflicts.length} cita(s) ya ocupan ese horario el ${date}${time ? ` a las ${time}` : ''}:\n${list}\n¿Qué quieres hacer?\n1. Mantener las citas actuales\n2. Mover la nueva a otra hora\n3. Cancelar una existente\n4. Crear igualmente`,
        data: { hasConflict: true, exactDuplicate: false, conflicts },
        referencedList: conflicts,
      }
    }

    case 'prepare_reschedule_booking': {
      const eventId = args.event_id as string | undefined
      const clientName = args.client_name as string | undefined
      const oldDate = args.old_date as string | undefined
      const oldTime = args.old_time as string | undefined
      const newDate = args.new_date as string | undefined
      const newTime = args.new_time as string | undefined
      const duration = typeof args.duration === 'number' ? args.duration : 60
      const title = args.title as string | undefined

      if (eventId && isValidUuid(eventId)) {
        const { data: row } = await supabase
          .from('calendar_events')
          .select('is_read_only')
          .eq('workspace_id', workspaceId)
          .eq('id', eventId)
          .maybeSingle()
        if ((row as { is_read_only?: boolean } | null)?.is_read_only === true) {
          return {
            text: 'Esa cita viene de un calendario de Google de solo lectura. La tengo en cuenta para disponibilidad, pero no puedo moverla desde el CRM. Cámbiala directamente en Google Calendar.',
            data: { blocked: 'read_only_event', eventId },
          }
        }
      }

      const missingFields: string[] = []
      if (!eventId) missingFields.push('id del evento')
      if (!newDate) missingFields.push('nueva fecha')
      if (!newTime) missingFields.push('nueva hora')

      const action: PreparedActionDraft = {
        type: 'reschedule_booking',
        eventId,
        clientName,
        date: newDate,
        time: newTime,
        duration,
        title: title ?? (clientName ? `Cita con ${clientName}` : 'Cita'),
        oldDate,
        oldTime,
        missingFields,
      }

      const fromLabel = oldDate && oldTime ? ` (antes: ${oldDate} ${oldTime})` : ''
      const toLabel = newDate && newTime ? `${newDate} a las ${newTime}` : 'nueva fecha/hora pendiente'
      const text = eventId && newDate && newTime
        ? `📅 Cambio preparado: "${action.title}" se mueve al ${toLabel}${fromLabel}. Confirma para actualizar.`
        : `Falta información para mover la cita. ${missingFields.join(', ')}.`

      return { text, data: action, preparedAction: action }
    }

    case 'prepare_cancel_booking': {
      const eventId = args.event_id as string | undefined
      const clientName = args.client_name as string | undefined
      const date = args.date as string | undefined
      const time = args.time as string | undefined
      const title = args.title as string | undefined
      const reason = args.reason as string | undefined

      if (eventId && isValidUuid(eventId)) {
        const { data: row } = await supabase
          .from('calendar_events')
          .select('is_read_only')
          .eq('workspace_id', workspaceId)
          .eq('id', eventId)
          .maybeSingle()
        if ((row as { is_read_only?: boolean } | null)?.is_read_only === true) {
          return {
            text: 'Esa cita viene de un calendario de Google de solo lectura. No puedo cancelarla desde el CRM, tienes que hacerlo desde Google Calendar. La sigo teniendo en cuenta para tu disponibilidad.',
            data: { blocked: 'read_only_event', eventId },
          }
        }
      }

      const missingFields: string[] = []
      if (!eventId) missingFields.push('id del evento (usa search_calendar_events primero)')

      const action: PreparedActionDraft = {
        type: 'cancel_booking',
        eventId,
        clientName: clientName ?? undefined,
        date,
        time,
        title: title ?? (clientName ? `Cita con ${clientName}` : 'Cita'),
        reason,
        missingFields,
      }

      const label = `"${action.title}"${date ? ` el ${date}` : ''}${time ? ` a las ${time}` : ''}`
      const text = eventId
        ? `📅 Cancelación preparada: ${label}. Confirma para cancelarla definitivamente.`
        : `No tengo el ID del evento. Búscalo primero con search_calendar_events y vuelve a intentarlo.`

      return { text, data: action, preparedAction: action }
    }

    case 'prepare_cancel_multiple_bookings': {
      const rawIds = Array.isArray(args.event_ids) ? args.event_ids : []
      const eventIds = [...new Set((rawIds as unknown[]).filter((id): id is string => typeof id === 'string' && isValidUuid(id.trim())).map((id) => id.trim()))]
      const reason = args.reason as string | undefined

      if (!eventIds.length) {
        return { text: 'Necesito IDs de evento válidos. Usa search_calendar_events primero para obtenerlos.', data: null }
      }

      const { data: rows } = await supabase
        .from('calendar_events')
        .select('id, title, date, start_hour, start_minute, duration, client_name, is_read_only')
        .eq('workspace_id', workspaceId)
        .in('id', eventIds)

      const allRows = (rows ?? []) as Row[]
      const readOnlyRows = allRows.filter((r) => r.is_read_only === true)
      const eventRows = allRows.filter((r) => r.is_read_only !== true)
      const cancellableIds = eventIds.filter((id) => eventRows.some((r) => String(r.id) === id))

      if (!cancellableIds.length) {
        const skippedNames = readOnlyRows.map((r) => String(r.client_name ?? r.title ?? 'cita')).join(', ')
        return {
          text: `Todas esas citas vienen de calendarios de Google de solo lectura${skippedNames ? ` (${skippedNames})` : ''}. No puedo cancelarlas desde el CRM. Bórralas desde Google Calendar.`,
          data: { blocked: 'all_read_only', skipped: readOnlyRows.length },
        }
      }

      const buildEventItem = (id: string): CancelEventItem => {
        const row = eventRows.find((r) => String(r.id) === id)
        const h = row?.start_hour !== undefined ? String(row.start_hour).padStart(2, '0') : undefined
        const m = row?.start_minute !== undefined ? String(row.start_minute ?? 0).padStart(2, '0') : undefined
        const rawDate = row?.date ? String(row.date) : undefined
        const dateHuman = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
          ? `${rawDate.slice(8, 10)}/${rawDate.slice(5, 7)}/${rawDate.slice(0, 4)}`
          : rawDate
        return {
          eventId: id,
          clientName: row?.client_name ? String(row.client_name) : undefined,
          date: dateHuman,
          time: h && m ? `${h}:${m}` : undefined,
          title: row?.title ? String(row.title) : undefined,
        }
      }

      const events = cancellableIds.map(buildEventItem)
      const action: PreparedActionDraft = { type: 'cancel_multiple_bookings', events, reason, missingFields: [] }

      const listText = events.map((e, i) => {
        const parts = [e.clientName, e.date, e.time].filter(Boolean).join(' · ')
        return `${i + 1}. ${parts || `Cita ${i + 1}`}`
      }).join('\n')

      const skippedNote = readOnlyRows.length
        ? `\n\nNo incluyo ${readOnlyRows.length} cita(s) de calendarios de Google de solo lectura — cámbialas desde Google.`
        : ''

      return {
        text: `📅 Cancelación múltiple preparada (${events.length} cita(s)):\n${listText}${skippedNote}\nConfirma para cancelarlas todas definitivamente.`,
        data: action,
        preparedAction: action,
        referencedList: eventRows,
      }
    }

    case 'prepare_cleanup_duplicates': {
      const rawIds = Array.isArray(args.event_ids) ? args.event_ids : []
      const eventIds = [...new Set((rawIds as unknown[]).filter((id): id is string => typeof id === 'string' && isValidUuid(id.trim())).map((id) => id.trim()))]
      const keepEventId = typeof args.keep_event_id === 'string' && isValidUuid(args.keep_event_id.trim())
        ? args.keep_event_id.trim()
        : undefined

      if (eventIds.length < 2) {
        return { text: 'Necesito al menos 2 eventos válidos para limpiar duplicados. Usa search_calendar_events para obtenerlos.', data: null }
      }

      const { data: rows } = await supabase
        .from('calendar_events')
        .select('id, title, date, start_hour, start_minute, duration, client_name, created_at, is_read_only')
        .eq('workspace_id', workspaceId)
        .in('id', eventIds)
        .order('created_at', { ascending: true })

      const rawRows = (rows ?? []) as Row[]
      const readOnlySkipped = rawRows.filter((r) => r.is_read_only === true).length
      const eventRows = rawRows.filter((r) => r.is_read_only !== true)
      const writableIds = eventIds.filter((id) => eventRows.some((r) => String(r.id) === id))

      if (writableIds.length < 2) {
        return {
          text: readOnlySkipped
            ? `Solo encuentro ${writableIds.length} cita(s) editable(s); el resto son de calendarios de solo lectura. No puedo limpiar duplicados así.`
            : 'No encuentro al menos 2 citas editables para limpiar duplicados. Usa search_calendar_events de nuevo.',
          data: { blocked: 'not_enough_writable_events', writable: writableIds.length, readOnlySkipped },
        }
      }

      const keepId = keepEventId && writableIds.includes(keepEventId)
        ? keepEventId
        : String(eventRows[0]?.id ?? writableIds[0])
      const cancelIds = writableIds.filter((id) => id !== keepId)

      const buildItem = (id: string): CancelEventItem => {
        const row = eventRows.find((r) => String(r.id) === id)
        const h = row?.start_hour !== undefined ? String(row.start_hour).padStart(2, '0') : undefined
        const m = row?.start_minute !== undefined ? String(row.start_minute ?? 0).padStart(2, '0') : undefined
        const rawDate = row?.date ? String(row.date) : undefined
        const dateHuman = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
          ? `${rawDate.slice(8, 10)}/${rawDate.slice(5, 7)}/${rawDate.slice(0, 4)}`
          : rawDate
        return {
          eventId: id,
          clientName: row?.client_name ? String(row.client_name) : undefined,
          date: dateHuman,
          time: h && m ? `${h}:${m}` : undefined,
          title: row?.title ? String(row.title) : undefined,
        }
      }

      const events = writableIds.map(buildItem)
      const keepRow = eventRows.find((r) => String(r.id) === keepId)
      const keepDisplay = [
        keepRow?.client_name ? String(keepRow.client_name) : null,
        keepRow?.date ? String(keepRow.date) : null,
        keepRow?.start_hour !== undefined
          ? `${String(keepRow.start_hour).padStart(2, '0')}:${String(keepRow.start_minute ?? 0).padStart(2, '0')}`
          : null,
      ].filter(Boolean).join(' · ')

      const action: PreparedActionDraft = {
        type: 'cleanup_duplicate_bookings',
        keepEventId: keepId,
        cancelEventIds: cancelIds,
        events,
        missingFields: [],
      }

      return {
        text: `📅 Limpieza preparada: conservo "${keepDisplay || 'la primera cita'}" y cancelo ${cancelIds.length} duplicada(s). Confirma para continuar.`,
        data: action,
        preparedAction: action,
        referencedList: eventRows,
      }
    }

    // -----------------------------------------------------------------------
    // Vertical Pack v1 — reads
    // -----------------------------------------------------------------------
    case 'list_opportunities': {
      const rows = await listOpportunitiesServer(supabase, workspaceId, {
        vertical: args.vertical as string | undefined,
        stage: args.stage as string | undefined,
        limit: typeof args.limit === 'number' ? Math.min(args.limit, 50) : 25,
      })
      if (!rows.length) {
        return { text: 'No hay oportunidades abiertas con esos criterios.', data: [], referencedList: [] }
      }
      const list = rows.map((row, i) => formatOpportunityLine(row, i)).join('\n')
      return { text: `${rows.length} oportunidad(es):\n${list}`, data: rows, referencedList: rows as unknown as Row[] }
    }

    case 'list_service_cases': {
      const rows = await listServiceCasesServer(supabase, workspaceId, {
        vertical: args.vertical as string | undefined,
        status: args.status as string | undefined,
        limit: typeof args.limit === 'number' ? Math.min(args.limit, 50) : 25,
      })
      if (!rows.length) {
        return { text: 'No hay expedientes con esos criterios.', data: [], referencedList: [] }
      }
      const list = rows.map((row, i) => formatServiceCaseLine(row, i)).join('\n')
      return { text: `${rows.length} expediente(s):\n${list}`, data: rows, referencedList: rows as unknown as Row[] }
    }

    case 'list_properties': {
      const rows = await listPropertiesServer(supabase, workspaceId, {
        status: args.status as string | undefined,
        city: args.city as string | undefined,
        limit: typeof args.limit === 'number' ? Math.min(args.limit, 50) : 25,
      })
      if (!rows.length) {
        return { text: 'No hay propiedades en cartera con esos criterios.', data: [], referencedList: [] }
      }
      const list = rows.map((row, i) => formatPropertyLine(row, i)).join('\n')
      return { text: `${rows.length} propiedad(es):\n${list}`, data: rows, referencedList: rows as unknown as Row[] }
    }

    // -----------------------------------------------------------------------
    // Vertical Pack v1 — writes (confirmed in chat before being called).
    // -----------------------------------------------------------------------
    case 'create_opportunity': {
      const { clientId, clientName } = await resolveClientUuid(
        supabase,
        workspaceId,
        args.client_id as string | undefined,
        args.client_name as string | undefined,
      )
      const row = await createOpportunityServer(
        { supabase, workspaceId, origin: 'nowlabs_agent' },
        {
          title: String(args.title ?? '').trim(),
          vertical: (args.vertical as string | undefined) ?? 'general',
          stage: args.stage as string | undefined,
          clientId,
          clientName,
          value: typeof args.value === 'number' ? args.value : null,
          source: args.source as string | undefined,
          expectedCloseDate: args.expected_close_date as string | undefined,
          notes: args.notes as string | undefined,
        },
      )
      if (!row) {
        return { text: 'No se pudo crear la oportunidad. Revisa el título y la sesión del workspace.', data: null }
      }
      const valueLabel = row.value ? ` por ${row.value}€` : ''
      const clientLabel = clientName ? ` para ${clientName}` : ''
      return {
        text: `✅ Oportunidad creada: "${row.title}"${clientLabel}${valueLabel} (etapa ${row.stage}, vertical ${row.vertical}).`,
        data: row,
        clientId: clientId ?? undefined,
        clientName: clientName ?? undefined,
      }
    }

    case 'update_opportunity_stage': {
      const id = String(args.opportunity_id ?? '').trim()
      const stage = String(args.stage ?? '').trim()
      if (!isValidUuid(id) || !stage) {
        return { text: 'Necesito el UUID de la oportunidad y la nueva etapa. Lista las oportunidades primero si no la tienes a mano.', data: null }
      }
      const row = await updateOpportunityStageServer(
        { supabase, workspaceId, origin: 'nowlabs_agent' },
        id,
        stage,
      )
      if (!row) {
        return { text: 'No se pudo actualizar la oportunidad. Verifica que el UUID pertenezca a tu workspace.', data: null }
      }
      return { text: `✅ Oportunidad "${row.title}" actualizada a etapa ${row.stage}.`, data: row }
    }

    case 'create_service_case': {
      const { clientId, clientName } = await resolveClientUuid(
        supabase,
        workspaceId,
        args.client_id as string | undefined,
        args.client_name as string | undefined,
      )
      const row = await createServiceCaseServer(
        { supabase, workspaceId, origin: 'nowlabs_agent' },
        {
          title: String(args.title ?? '').trim(),
          caseType: String(args.case_type ?? '').trim(),
          vertical: (args.vertical as string | undefined) ?? 'immigration',
          status: args.status as string | undefined,
          priority: args.priority as string | undefined,
          clientId,
          clientName,
          opportunityId: isValidUuid(args.opportunity_id as string | undefined) ? (args.opportunity_id as string) : null,
          dueDate: args.due_date as string | undefined,
          notes: args.notes as string | undefined,
        },
      )
      if (!row) {
        return { text: 'No se pudo abrir el expediente. Revisa que el title y el case_type estén presentes.', data: null }
      }
      const dueLabel = row.due_date ? ` (vence ${row.due_date})` : ''
      const clientLabel = clientName ? ` para ${clientName}` : ''
      return {
        text: `✅ Expediente abierto: "${row.title}"${clientLabel} — ${row.case_type} en estado ${row.status}${dueLabel}.`,
        data: row,
        clientId: clientId ?? undefined,
        clientName: clientName ?? undefined,
      }
    }

    case 'create_property': {
      const { clientId, clientName } = await resolveClientUuid(
        supabase,
        workspaceId,
        args.client_id as string | undefined,
        args.client_name as string | undefined,
      )
      const row = await createPropertyServer(
        { supabase, workspaceId, origin: 'nowlabs_agent' },
        {
          title: String(args.title ?? '').trim(),
          propertyType: args.property_type as string | undefined,
          operationType: args.operation_type as string | undefined,
          status: args.status as string | undefined,
          city: args.city as string | undefined,
          area: args.area as string | undefined,
          price: typeof args.price === 'number' ? args.price : null,
          clientId,
          clientName,
          ownerName: args.owner_name as string | undefined,
          ownerPhone: args.owner_phone as string | undefined,
          notes: args.notes as string | undefined,
        },
      )
      if (!row) {
        return { text: 'No se pudo registrar la propiedad. Asegúrate de pasar al menos title.', data: null }
      }
      const where = [row.city, row.area].filter(Boolean).join(' · ')
      const whereLabel = where ? ` en ${where}` : ''
      const priceLabel = row.price ? ` por ${row.price}€` : ''
      return {
        text: `✅ Propiedad registrada: "${row.title}"${whereLabel}${priceLabel} (${row.property_type} · ${row.operation_type} · ${row.status}).`,
        data: row,
        clientId: clientId ?? undefined,
        clientName: clientName ?? undefined,
      }
    }

    case 'update_service_case_status': {
      const id = String(args.case_id ?? '').trim()
      const status = String(args.status ?? '').trim()
      if (!isValidUuid(id) || !status) {
        return { text: 'Necesito el UUID del expediente y el nuevo estado. Lista los expedientes primero si no lo tienes a mano.', data: null }
      }
      const row = await updateServiceCaseStatusServer(
        { supabase, workspaceId, origin: 'nowlabs_agent' },
        id,
        status,
      )
      if (!row) {
        return { text: 'No se pudo actualizar el expediente. Verifica que el UUID pertenezca a tu workspace.', data: null }
      }
      return { text: `✅ Expediente "${row.title}" actualizado a estado ${row.status}.`, data: row }
    }

    case 'update_property_status': {
      const id = String(args.property_id ?? '').trim()
      const status = String(args.status ?? '').trim()
      if (!isValidUuid(id) || !status) {
        return { text: 'Necesito el UUID de la propiedad y el nuevo estado. Lista las propiedades primero si no lo tienes a mano.', data: null }
      }
      const row = await updatePropertyStatusServer(
        { supabase, workspaceId, origin: 'nowlabs_agent' },
        id,
        status,
      )
      if (!row) {
        return { text: 'No se pudo actualizar la propiedad. Verifica que el UUID pertenezca a tu workspace.', data: null }
      }
      return { text: `✅ Propiedad "${row.title}" actualizada a estado ${row.status}.`, data: row }
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
- DETECCIÓN DE DUPLICADOS: si hay varias citas con el mismo cliente, misma fecha y misma hora → añade al final: "🧹 Veo [N] citas idénticas con [cliente] el [fecha] a las [hora]. Puedo dejarte solo una si quieres."
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

    case 'search_calendar_events':
      return `${base}Datos:
${rawText}

Si se encontró 1 cita: "[cliente] — [fecha DD/MM/YYYY] a las [hora] — [duración si consta]."
Si hay varias citas DISTINTAS: lista numerada, una por línea: "N. [cliente] — [fecha] — [hora] — [motivo si consta]"
Si hay varias citas IDÉNTICAS (mismo cliente, misma fecha, misma hora): "Encontré [N] citas idénticas con [cliente] el [fecha] a las [hora]. ¿Quieres cancelarlas todas, dejar solo una, o elegir una concreta?"
Si no se encontraron: "No encuentro esa cita. Dime el cliente y la fecha aproximada."
Sin IDs, sin corchetes técnicos, sin comillas técnicas, sin negritas, sin asteriscos.`

    case 'check_calendar_conflicts':
      return `${base}Datos:
${rawText}

Si hasConflict=false: confirma que no hay conflicto en 1 frase, NO menciones que vas a preparar la cita — el sistema lo hará automáticamente en el siguiente paso.
Si hay duplicado exacto: "Esa cita ya existe con [cliente] el [fecha] a las [hora]. No voy a crear otra igual. ¿Qué quieres hacer? 1. Mantener la cita actual. 2. Moverla a otra hora. 3. Cancelarla. 4. Crear otra igualmente."
Si hay solapamiento (sin duplicado exacto): "⚠️ Ya tienes [N] cita(s) en ese horario el [fecha]. [lista]. ¿Qué prefieres? 1. Mantenerlas. 2. Mover la nueva. 3. Cancelar una. 4. Crear igualmente."
Sin negritas, sin asteriscos.`

    case 'prepare_reschedule_booking':
      return `${base}Datos:
${rawText}

Confirma el cambio de cita:
"📅 He preparado el cambio: [título] se mueve al [nueva fecha] a las [nueva hora]. Confirma para actualizar."
Si faltan datos: indica cuáles faltan.
Sin negritas, sin asteriscos.`

    case 'prepare_cancel_booking':
      return `${base}Datos:
${rawText}

Genera una confirmación limpia de la cancelación:
"📅 He preparado la cancelación de [título] el [fecha] a las [hora]${rawText.includes('cliente') ? ' con [cliente]' : ''}. Pulsa Confirmar cancelación para eliminarla del calendario, o Mantener cita para no hacer nada."
Si faltan datos: "Necesito el ID del evento. Búscalo con search_calendar_events."
Sin negritas, sin asteriscos.`

    case 'prepare_cancel_multiple_bookings':
      return `${base}Datos:
${rawText}

Confirma la cancelación múltiple de forma clara y directa:
"He preparado la cancelación de [N] citas: [lista breve, una por línea]. Pulsa Confirmar cancelación para eliminarlas todas, o Mantener citas si no quieres hacer nada."
Sin negritas, sin asteriscos, sin IDs técnicos.`

    case 'prepare_cleanup_duplicates':
      return `${base}Datos:
${rawText}

Confirma la limpieza de duplicados:
"Voy a conservar [cliente/fecha/hora de la cita que se mantiene] y cancelar las otras [N] duplicadas. Pulsa Confirmar para limpiarlas."
Sin negritas, sin asteriscos, sin IDs técnicos.`

    case 'list_opportunities':
      return `${base}Datos del CRM:
${rawText}

Genera esta respuesta:
- Primera línea: "🎯 Tienes X oportunidad(es)." (X = número real).
- Lista numerada igual que viene en el rawText (una por línea: "N. título — etapa · vertical · valor").
- Si hay alguna en negociación o oferta, señala una al cliente como "📌 Yo movería X esta semana".
- Si no hay: "Sin oportunidades abiertas en ese filtro."
Sin negritas, sin asteriscos.`

    case 'list_service_cases':
      return `${base}Datos del CRM:
${rawText}

Genera esta respuesta:
- Primera línea: "📁 Tienes X expediente(s) abierto(s)." (X = número real).
- Lista numerada como viene en rawText (título — tipo · estado · vence).
- Si alguno está en documentation_pending, recordar: "📌 Faltan documentos en N expediente(s) — yo enviaría plantilla de solicitud de documentación".
- Si no hay: "Sin expedientes abiertos en ese filtro."
Sin negritas, sin asteriscos.`

    case 'list_properties':
      return `${base}Datos del CRM:
${rawText}

Genera esta respuesta:
- Primera línea: "🏠 Tienes X propiedad(es)." (X = número real).
- Lista numerada como viene en rawText.
- Si hay propiedades en prospecting hace tiempo, sugerir "📌 Movería N a listed esta semana".
- Si no hay: "Sin propiedades en cartera con ese filtro."
Sin negritas, sin asteriscos.`

    case 'create_opportunity':
    case 'create_service_case':
    case 'create_property':
    case 'update_opportunity_stage':
    case 'update_service_case_status':
    case 'update_property_status':
      return `${base}Datos del CRM:
${rawText}

La acción ya se ejecutó (texto entre comillas en rawText). Reformula en 1-2 frases naturales en español que confirmen la creación/actualización, manteniendo los datos clave (nombre, vertical, etapa, importe). Sugiere 1 próxima acción concreta ("¿Le preparo una cita?", "¿Pido documentación?", "¿La marco como qualified?").
Sin negritas, sin asteriscos.`

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
  let referencedCalendarList: Row[] | undefined
  let dataPreview: unknown
  let preparedAction: PreparedActionDraft | undefined

  const CALENDAR_TOOLS = new Set(['search_calendar_events', 'check_calendar_conflicts', 'prepare_cancel_booking', 'prepare_reschedule_booking', 'prepare_cancel_multiple_bookings', 'prepare_cleanup_duplicates'])

  const applyResult = (result: Awaited<ReturnType<typeof runTool>>, toolName: string) => {
    if (result.clientId) referencedClientId = result.clientId
    if (result.clientName) referencedClientName = result.clientName
    if (result.data !== null && result.data !== undefined) dataPreview = result.data
    if (result.preparedAction) preparedAction = result.preparedAction
    if (result.referencedList) {
      if (CALENDAR_TOOLS.has(toolName)) {
        referencedCalendarList = result.referencedList
      } else {
        referencedList = result.referencedList
      }
    }
  }

  try {
    // Pre-router: unambiguous READ queries bypass LLM tool-selection
    const route = preRoute(message)
    if (route) {
      const args = 'args' in route ? (route.args as Args) : {}
      const result = await runTool(route.tool, args, supabase, workspaceId, localLastResults)
      toolCallsLog.push(route.tool)
      applyResult(result, route.tool)

      const formatInput: InputItem[] = [
        { role: 'user', content: buildFormatPrompt(route.tool, result.text, result.data, message) },
      ]
      const formatted = await callOpenAI(apiKey, systemPrompt, formatInput, controller.signal, false)
      const answer = cleanMarkdown(extractText(formatted.output) || result.text)

      return { answer, debugSource: 'openai_agent_v2', toolCalls: toolCallsLog, referencedClientId, referencedClientName, referencedList, referencedCalendarList, dataPreview, preparedAction }
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
          referencedCalendarList,
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
        applyResult(result, call.name)

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
      referencedCalendarList,
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
