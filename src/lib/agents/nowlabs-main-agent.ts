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

export type CancelEventItem = {
  eventId: string
  clientName?: string
  date?: string
  time?: string
  title?: string
}


export type PreparedActionDraft = {
  type: 'booking' | 'invoice' | 'task' | 'cancel_booking' | 'reschedule_booking' | 'cancel_multiple_bookings' | 'cleanup_duplicate_bookings'
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
}

export type AgentV2Result = {
  answer: string
  debugSource: 'openai_agent_v2'
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

function preRoute(message: string): PreRoute {
  const t = normalize(message)

  // Cancellation / multi-cancel phrases MUST go to full agent loop — never pre-route them
  if (/\b(cancel[ae](?:r|[sm]|me|la|las)?|elimina[r]?|borra[r]?|quita[r]?|suprime[r]?|borra?la|quitala|cancelala|cancelamela)\b/.test(t)) return null
  if (/\b(me\s+he\s+equivocado|ya\s+no\s+hace\s+falta|no\s+puedo\s+ir|cancela(?:me)?la|borra?la|quitala)\b/.test(t)) return null
  if (/\b(todas\s+ellas|cancela\s+todas|borra\s+todas|deja\s+solo\s+una|las\s+repetidas|las\s+duplicadas)\b/.test(t)) return null

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
]

// --- System prompt base ---

const SYSTEM_PROMPT_BASE = `Eres NowLabs AI, el asistente comercial interno de NowCRM. No soy un chatbot — soy más como un empleado senior de operaciones que vive dentro del CRM y conoce el negocio al detalle. Hablo en español natural de España, directo y sin relleno. Cuando veo datos, saco conclusiones útiles: si un lead tiene score 90, lo digo y recomiendo actuar; si hay una factura vencida, la trato como urgente.

ANTES DE RESPONDER, EVALÚO:
1. ¿Qué quiere realmente el usuario? (no solo lo que dice literalmente)
2. ¿Tengo los datos para responder directamente, o necesito una herramienta?
3. ¿Hay alguna acción implícita que debo preparar (cita, tarea, cancelación)?
4. ¿El contexto activo (cliente, citas, lista) es relevante aquí?

CÓMO USO LAS HERRAMIENTAS:

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
12. "prepara una cita con X" → check_calendar_conflicts primero, luego prepare_booking(client_name, date, time, service)
13. "prepara una tarea para X" → prepare_task(client_name, task_title, due_date)
14. "prepara una factura para X de N€" → prepare_invoice(client_name, amount, concept, due_date)
15. "busca a X" / "buscar" → search_clients(query=X)
16. "automatizaciones" / "cómo automatizar" → automation_recommendations()
17. "resumen del CRM" / "cómo está el negocio" → crm_overview()

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
            text: 'Esa cita viene de un calendario de Google de solo lectura. La tengo en cuenta para disponibilidad, pero no puedo moverla desde NowCRM. Cámbiala directamente en Google Calendar.',
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
            text: 'Esa cita viene de un calendario de Google de solo lectura. No puedo cancelarla desde NowCRM, tienes que hacerlo desde Google Calendar. La sigo teniendo en cuenta para tu disponibilidad.',
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
          text: `Todas esas citas vienen de calendarios de Google de solo lectura${skippedNames ? ` (${skippedNames})` : ''}. No puedo cancelarlas desde NowCRM. Bórralas desde Google Calendar.`,
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
