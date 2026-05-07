import type { N8nFlowStatus, N8nRequirement } from '@/lib/types'

export const ASSISTANT_AGENT_WEBHOOK_URL = 'https://workspacetemporalnowlabs-n8n.hvdnby.easypanel.host/webhook/nowcrm-assistant-agent'

export const N8N_EVENT_TYPES = [
  'new_lead',
  'client_updated',
  'client_deleted',
  'whatsapp_message',
  'assistant_message',
  'conversation_resolved',
  'appointment_booked',
  'calendar_event_created',
  'invoice_created',
  'invoice_paid',
  'invoice_overdue',
  'reengagement_needed',
  'daily_summary',
  'urgent_conversation',
  'test_flow',
] as const

export type N8nEventType = typeof N8N_EVENT_TYPES[number]
export type WebhookEvent = N8nEventType
export type N8nTriggerStatus = 'ok' | 'simulated' | 'skipped' | 'error'
export type N8nTriggerMode = 'demo' | 'real'

export type N8nTriggerPayload = {
  event_type?: N8nEventType
  workspace_id?: string
  flow_id?: string
  source?: 'nowcrm'
  mode?: N8nTriggerMode
  timestamp?: string
  webhook_url?: string
  flow_status?: N8nFlowStatus
  client?: Record<string, unknown>
  conversation?: Record<string, unknown>
  message?: Record<string, unknown>
  invoice?: Record<string, unknown>
  calendar_event?: Record<string, unknown>
  activity?: Record<string, unknown>
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type N8nTriggerResult = {
  ok: boolean
  success: boolean
  status: N8nTriggerStatus
  event_type: N8nEventType
  message: string
  n8n_response?: unknown
  suggested_response?: string
  activity_created?: boolean
}

export type AgentToolName =
  | 'get_workspace_summary'
  | 'search_clients'
  | 'get_client_summary'
  | 'get_client_detail'
  | 'create_client'
  | 'update_client'
  | 'create_invoice'
  | 'mark_invoice_paid'
  | 'list_invoices'
  | 'create_calendar_event'
  | 'list_calendar_events'
  | 'list_conversations'
  | 'save_message'
  | 'create_activity'
  | 'get_next_best_actions'

export type AgentToolResult = {
  ok: boolean
  tool: AgentToolName
  result: unknown
  message: string
  mode?: string
}

export type WebhookPayload = N8nTriggerPayload

export type WebhookConfig = {
  event: N8nEventType
  label: string
  description: string
  trigger: string
  url: string
  status: N8nFlowStatus
  requires: N8nRequirement[]
}

export type AssistantAgentFlowState = {
  event: 'assistant_message'
  label: string
  status: N8nFlowStatus
  webhookUrl: string
  isActive: boolean
  source: 'supabase' | 'default'
}

type AssistantAgentFlowCandidate = {
  event?: string
  event_type?: string
  label?: string
  name?: string
  status?: N8nFlowStatus
  webhookUrl?: string
  webhook_url?: string
  url?: string
}

const eventAliases: Record<string, N8nEventType> = {
  whatsapp_incoming: 'whatsapp_message',
  appointment_scheduled: 'appointment_booked',
  payment_registered: 'invoice_paid',
  reengagement_sequence: 'reengagement_needed',
  daily_ai_summary: 'daily_summary',
}

export function normalizeN8nEventType(value: unknown): N8nEventType | null {
  if (typeof value !== 'string') return null
  if ((N8N_EVENT_TYPES as readonly string[]).includes(value)) return value as N8nEventType
  return eventAliases[value] ?? null
}

export const n8nWebhookConfigs: WebhookConfig[] = [
  { event: 'new_lead', label: 'Nuevo lead registrado', description: 'Crea lead, calcula score inicial y avisa al equipo.', trigger: 'Lead desde cualquier canal', url: 'https://n8n.tudominio.com/webhook/new-lead', status: 'demo', requires: ['Supabase', 'n8n'] },
  { event: 'client_updated', label: 'Cliente actualizado', description: 'Sincroniza cambios del perfil comercial y registra seguimiento.', trigger: 'Edicion de cliente', url: 'https://n8n.tudominio.com/webhook/client-updated', status: 'pending_config', requires: ['Supabase', 'n8n'] },
  { event: 'client_deleted', label: 'Cliente eliminado', description: 'Limpia tareas pendientes o avisa al equipo antes de borrar contexto.', trigger: 'Borrado de cliente', url: 'https://n8n.tudominio.com/webhook/client-deleted', status: 'inactive', requires: ['Supabase', 'n8n'] },
  { event: 'whatsapp_message', label: 'Mensaje WhatsApp', description: 'Registra conversacion, clasifica intencion y propone respuesta IA.', trigger: 'Mensaje WhatsApp Business', url: 'https://n8n.tudominio.com/webhook/whatsapp-message', status: 'pending_config', requires: ['Supabase', 'n8n', 'WhatsApp/API'] },
  { event: 'assistant_message', label: 'Assistant Agent', description: 'Workflow real NowCRM - Assistant Agent: n8n recibe el mensaje, llama OpenAI y devuelve suggested_response.', trigger: 'Mensaje enviado al assistant', url: ASSISTANT_AGENT_WEBHOOK_URL, status: 'active', requires: ['Supabase', 'n8n', 'IA/API'] },
  { event: 'conversation_resolved', label: 'Conversacion resuelta', description: 'Registra cierre, resumen y siguiente accion si procede.', trigger: 'Conversacion marcada como resuelta', url: 'https://n8n.tudominio.com/webhook/conversation-resolved', status: 'demo', requires: ['Supabase', 'n8n'] },
  { event: 'appointment_booked', label: 'Reunion agendada', description: 'Guarda evento, envia confirmacion y prepara resumen previo.', trigger: 'Nueva cita en calendario', url: 'https://n8n.tudominio.com/webhook/appointment-booked', status: 'demo', requires: ['Supabase', 'n8n', 'Email/API'] },
  { event: 'calendar_event_created', label: 'Evento de calendario', description: 'Dispara recordatorios o preparacion comercial para reuniones.', trigger: 'Nuevo evento en calendario', url: 'https://n8n.tudominio.com/webhook/calendar-event-created', status: 'demo', requires: ['Supabase', 'n8n', 'Email/API'] },
  { event: 'invoice_created', label: 'Factura creada', description: 'Prepara email, recordatorio o sincronizacion de cobro.', trigger: 'Nueva factura', url: 'https://n8n.tudominio.com/webhook/invoice-created', status: 'demo', requires: ['Supabase', 'n8n', 'Billing/API'] },
  { event: 'invoice_paid', label: 'Factura pagada', description: 'Actualiza ciclo de vida del cliente y notifica cobro recibido.', trigger: 'Factura marcada pagada', url: 'https://n8n.tudominio.com/webhook/invoice-paid', status: 'demo', requires: ['Supabase', 'n8n', 'Billing/API'] },
  { event: 'invoice_overdue', label: 'Factura vencida', description: 'Detecta impago, programa recordatorio y registra actividad.', trigger: 'Factura supera vencimiento', url: 'https://n8n.tudominio.com/webhook/invoice-overdue', status: 'demo', requires: ['Supabase', 'n8n', 'Billing/API'] },
  { event: 'reengagement_needed', label: 'Re-engagement', description: 'Reactiva leads frios con mensajes y tareas comerciales.', trigger: 'Lead sin contacto 7+ dias', url: 'https://n8n.tudominio.com/webhook/reengagement-needed', status: 'inactive', requires: ['Supabase', 'n8n', 'Email/API'] },
  { event: 'daily_summary', label: 'Resumen diario IA', description: 'Genera briefing con ventas, alertas y siguientes acciones.', trigger: 'Cada dia a las 08:00', url: 'https://n8n.tudominio.com/webhook/daily-summary', status: 'pending_config', requires: ['Supabase', 'n8n'] },
  { event: 'urgent_conversation', label: 'Conversacion urgente', description: 'Escala conversaciones negativas o de alta intencion.', trigger: 'Sentimiento negativo o score alto', url: 'https://n8n.tudominio.com/webhook/urgent-conversation', status: 'pending_config', requires: ['Supabase', 'n8n', 'WhatsApp/API'] },
  { event: 'test_flow', label: 'Test flow', description: 'Payload de prueba para validar conectividad sin tocar datos reales.', trigger: 'Test manual desde Settings', url: 'https://n8n.tudominio.com/webhook/test-flow', status: 'demo', requires: ['n8n'] },
]

function isHttpsWebhook(value: unknown) {
  return typeof value === 'string' && value.trim().startsWith('https://')
}

function readFlowUrl(flow?: AssistantAgentFlowCandidate) {
  return flow?.webhookUrl || flow?.webhook_url || flow?.url || ''
}

export function getAssistantAgentFlow(flows: AssistantAgentFlowCandidate[] = [], isDemoMode = false): AssistantAgentFlowState {
  const storedFlow = flows.find((flow) => (flow.event ?? flow.event_type) === 'assistant_message')
  const storedUrl = readFlowUrl(storedFlow)

  if (storedFlow?.status === 'active' && isHttpsWebhook(storedUrl)) {
    return {
      event: 'assistant_message',
      label: storedFlow.label || storedFlow.name || 'NowCRM - Assistant Agent',
      status: 'active',
      webhookUrl: storedUrl,
      isActive: !isDemoMode,
      source: 'supabase',
    }
  }

  return {
    event: 'assistant_message',
    label: 'NowCRM - Assistant Agent',
    status: 'active',
    webhookUrl: ASSISTANT_AGENT_WEBHOOK_URL,
    isActive: !isDemoMode,
    source: 'default',
  }
}

export function buildN8nTriggerPayload(eventName: N8nEventType, payload: N8nTriggerPayload = {}): N8nTriggerPayload {
  return {
    ...payload,
    event_type: eventName,
    source: 'nowcrm',
    mode: payload.mode === 'real' ? 'real' : 'demo',
    timestamp: payload.timestamp || new Date().toISOString(),
    metadata: payload.metadata ?? {},
  }
}

export async function triggerN8nWebhook(eventName: N8nEventType, payload: N8nTriggerPayload = {}): Promise<N8nTriggerResult> {
  const endpoint =
    typeof payload.webhook_url === 'string' ? payload.webhook_url :
    typeof payload.endpoint === 'string' ? payload.endpoint :
    typeof payload.url === 'string' ? payload.url :
    undefined
  const normalized = buildN8nTriggerPayload(eventName, payload)

  try {
    const response = await fetch('/api/n8n/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...normalized,
        webhook_url: endpoint,
        payload: normalized,
      }),
    })
    const data = await response.json() as Partial<N8nTriggerResult>
    return {
      ok: Boolean(data.ok ?? data.success),
      success: Boolean(data.success ?? data.ok),
      status: data.status ?? (response.ok ? 'simulated' : 'error'),
      event_type: data.event_type ?? eventName,
      message: data.message || `Webhook "${eventName}" procesado.`,
      n8n_response: data.n8n_response,
      suggested_response: data.suggested_response,
      activity_created: Boolean(data.activity_created),
    }
  } catch {
    await new Promise((r) => setTimeout(r, 600))
    return {
      ok: true,
      success: true,
      status: 'simulated',
      event_type: eventName,
      message: `Webhook "${eventName}" ejecutado en simulacion local.`,
      activity_created: false,
    }
  }
}

export async function callAgentTool(tool: AgentToolName, workspaceId: string, input: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}): Promise<AgentToolResult> {
  const response = await fetch('/api/agent/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool,
      workspace_id: workspaceId || 'demo-workspace',
      input,
      metadata,
    }),
  })
  const data = await response.json() as Partial<AgentToolResult>
  return {
    ok: Boolean(data.ok),
    tool,
    result: data.result ?? null,
    message: data.message || 'Tool procesada.',
    mode: data.mode,
  }
}

export async function simulateWhatsAppIncomingLead(): Promise<{ success: boolean; lead: { name: string; phone: string; message: string } }> {
  await new Promise((r) => setTimeout(r, 600))
  return { success: true, lead: { name: 'Lead WhatsApp Demo', phone: '+34 699 000 001', message: 'Hola! Vi vuestro anuncio y me interesa NowCRM.' } }
}

export async function simulatePaymentRegistered(): Promise<{ success: boolean; amount: number; client: string }> {
  await new Promise((r) => setTimeout(r, 600))
  return { success: true, amount: 299, client: 'Cliente Demo SL' }
}

const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
const hasSupabasePublishableKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
const hasSupabaseAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

export const supabaseStatus = {
  configured: hasSupabaseUrl && (hasSupabaseAnonKey || hasSupabasePublishableKey),
  hasUrl: hasSupabaseUrl,
  hasPublishableKey: hasSupabasePublishableKey,
  hasAnonKey: hasSupabaseAnonKey,
  connected: false,
  note: hasSupabaseUrl && (hasSupabaseAnonKey || hasSupabasePublishableKey)
    ? 'Variables publicas detectadas. Auth, clientes, facturas, calendario y assistant estan preparados para datos reales.'
    : 'Pendiente: anade NEXT_PUBLIC_SUPABASE_URL y una clave publica de Supabase en .env.local.',
}
