'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Bot, CalendarDays, CheckCircle, FileText, Loader2, Mail, MessageSquare, Phone, Plus, Search, Send, Target, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { conversations as mockConversations, messages as mockMessages } from '@/lib/mock-data'
import { ASSISTANT_AGENT_WEBHOOK_URL, callAgentTool, getAssistantAgentFlow, triggerN8nWebhook, type AgentToolName } from '@/lib/integrations'
import { DEMO_MODE_KEY, useCurrentUser } from '@/lib/current-user'
import { detectAssistantIntent, respondWithAssistant, type AssistantIntent } from '@/lib/ai'
import {
  createActivity,
  createCalendarEvent,
  createAssistantConversation,
  createInvoice,
  createMessage,
  deleteConversationPermanently,
  getAssistantConversationById,
  getAssistantConversations,
  getConversationMessages,
  getClientStats,
  getN8nFlows,
  getPendingInvoices,
  getResolvedWorkspaceContext,
  getUpcomingCalendarEvents,
  getWorkspaceSummary,
  getNextBestActions,
  mapSupabaseClient,
  searchClients,
  updateConversationScoped,
  getClientInvoices,
  getClientCalendarEvents,
  getClientConversations,
  getClientActivities,
} from '@/lib/supabase-queries'
import type { AssistantMode, Channel, Conversation, ConversationSentiment, Message, MessageSender, N8nFlowStatus } from '@/lib/types'

const SHOW_ASSISTANT_DEBUG = process.env.NODE_ENV === 'development'
const OFFLINE_FORCE_DEV = process.env.NEXT_PUBLIC_FORCE_OFFLINE_DEV === 'true'
const OFFLINE_WORKSPACE_ID = '7d1ad8e8-e9f7-47fb-92d5-299516b6dc1b'
const OFFLINE_USER_ID = '91b65a40-222d-4f97-870c-8e4119278c2c'
const OFFLINE_USER_EMAIL = 'oier.dunabeitia@opendeusto.es'
const OFFLINE_STORAGE_KEY_CONVERSATIONS = 'nowcrm-offline-conversations'
const OFFLINE_STORAGE_KEY_MESSAGES = 'nowcrm-offline-messages'

function createUuid() {
  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return Array.from(bytes)
    .map((byte, index) => {
      const hex = byte.toString(16).padStart(2, '0')
      return [4, 6, 8, 10].includes(index) ? `-${hex}` : hex
    })
    .join('')
}

function loadOfflineConversations(): Conversation[] {
  try {
    const stored = window.localStorage.getItem(OFFLINE_STORAGE_KEY_CONVERSATIONS)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return parsed as Conversation[]
    }
  } catch {
    // ignore
  }

  return mockConversations.map((conversation, index) => ({
    ...conversation,
    id: createUuid(),
    workspaceId: OFFLINE_WORKSPACE_ID,
    assistantMode: conversation.assistantMode ?? (index === 0 ? 'copilot' : 'inbox'),
    metadata: { ...(conversation.metadata ?? {}), source: 'offline' },
  }))
}

function loadOfflineMessages(): Record<string, Message[]> {
  try {
    const stored = window.localStorage.getItem(OFFLINE_STORAGE_KEY_MESSAGES)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed && typeof parsed === 'object') return parsed as Record<string, Message[]>
    }
  } catch {
    // ignore
  }
  return {}
}

function persistOfflineConversations(conversations: Conversation[]) {
  if (!OFFLINE_FORCE_DEV) return
  try {
    window.localStorage.setItem(OFFLINE_STORAGE_KEY_CONVERSATIONS, JSON.stringify(conversations))
  } catch {
    // ignore
  }
}

function persistOfflineMessages(messages: Record<string, Message[]>) {
  if (!OFFLINE_FORCE_DEV) return
  try {
    window.localStorage.setItem(OFFLINE_STORAGE_KEY_MESSAGES, JSON.stringify(messages))
  } catch {
    // ignore
  }
}

function createOfflineConversation(mode: AssistantMode): Conversation {
  const id = createUuid()
  return {
    id,
    workspaceId: OFFLINE_WORKSPACE_ID,
    clientId: `offline-${id}`,
    clientName: mode === 'copilot' ? 'Consulta NowLabs AI' : 'Nuevo cliente',
    clientAvatar: '',
    lastMessage: mode === 'copilot' ? 'Nueva consulta interna' : 'Nuevo mensaje de cliente',
    timestamp: new Date().toISOString(),
    unread: true,
    sentiment: 'neutral',
    channel: mode === 'inbox' ? 'WhatsApp' : 'Web',
    assistantMode: mode,
    metadata: { source: 'offline' },
  }
}

const sentimentConfig: Record<ConversationSentiment, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  positive: { label: 'Positivo', variant: 'success' },
  neutral: { label: 'Neutral', variant: 'warning' },
  negative: { label: 'Negativo', variant: 'danger' },
}

const channelVariant: Record<Channel, 'indigo' | 'purple' | 'info' | 'success'> = {
  WhatsApp: 'success',
  Instagram: 'purple',
  Web: 'info',
  Email: 'indigo',
}

const leadScores: Record<string, number> = { '1': 92, '2': 74, '3': 88, '4': 96, '5': 61 }

const leadScoreColor = (score: number) =>
  score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-500'

const quickPromptsByMode: Record<AssistantMode, Array<{ label: string; prompt: string; intent: string; sender?: MessageSender }>> = {
  inbox: [
    { label: 'Responder cliente', prompt: 'Prepara una respuesta breve para el último mensaje del cliente y deja claro el siguiente paso.', intent: 'reply_customer', sender: 'agent' },
    { label: 'Detectar intención', prompt: 'Detecta la intención del cliente y resume qué acción conviene preparar.', intent: 'detect_intent', sender: 'agent' },
    { label: 'Resumir conversación', prompt: 'Resume esta conversación en 3 puntos y dime qué falta para avanzar.', intent: 'conversation_summary', sender: 'agent' },
    { label: 'Preparar cita', prompt: 'Prepara una cita desde esta conversación. Pide cliente, servicio, día, hora y duración si falta algo.', intent: 'booking', sender: 'agent' },
    { label: 'Preparar factura', prompt: 'Prepara una factura desde esta conversación. Pide cliente, importe, concepto y vencimiento si falta algo.', intent: 'invoice', sender: 'agent' },
    { label: 'Siguiente respuesta', prompt: 'Dime la siguiente respuesta recomendada para el cliente.', intent: 'next_reply', sender: 'agent' },
    { label: 'Probar n8n', prompt: 'Prueba el workflow NowCRM - Assistant Agent con una conversación de cliente.', intent: 'n8n_test', sender: 'agent' },
  ],
  copilot: [
    { label: 'Buscar cliente', prompt: 'Ayúdame a localizar un cliente por nombre, email o empresa.', intent: 'client_search', sender: 'agent' },
    { label: 'Resumen cliente', prompt: 'Resume este cliente y dime la siguiente acción comercial recomendada.', intent: 'resumen', sender: 'agent' },
    { label: 'Próxima acción', prompt: 'Dime la siguiente acción comercial recomendada para este cliente.', intent: 'next_action', sender: 'agent' },
    { label: 'Crear cita', prompt: 'Quiero crear una cita. Pídeme cliente, servicio, día, hora y duración si falta algo.', intent: 'booking', sender: 'agent' },
    { label: 'Crear factura', prompt: 'Quiero crear una factura. Pídeme cliente, importe, concepto y vencimiento si falta algo.', intent: 'invoice', sender: 'agent' },
    { label: 'Revisar cobros', prompt: 'Revisa facturas pendientes o vencidas y dime qué seguimiento harías.', intent: 'billing', sender: 'agent' },
    { label: 'Preparar propuesta', prompt: 'Prepara una propuesta comercial breve con siguiente paso claro.', intent: 'proposal', sender: 'agent' },
    { label: 'Consultar calendario', prompt: 'Revisa los próximos eventos de calendario y dime qué preparación comercial falta.', intent: 'calendar', sender: 'agent' },
    { label: 'Probar n8n', prompt: 'Prueba el workflow NowCRM - Assistant Agent con una consulta interna breve.', intent: 'n8n_test', sender: 'agent' },
  ],
}

const capabilities = ['Clientes', 'Citas', 'Facturas', 'Cobros', 'Próximas acciones', 'Respuestas comerciales', 'n8n preparado']
const inboxCapabilities = ['Mensajes cliente/lead', 'Intención', 'Sentimiento', 'Reservas desde conversación', 'WhatsApp/Whapi futuro']
const capabilityExamples = [
  'Resume este cliente',
  'Prepara una cita',
  'Crea una factura',
  'Revisa cobros pendientes',
  'Dime la próxima acción',
  'Busca un cliente',
  'Prepara una respuesta comercial',
]

const assistantModes: Array<{
  id: AssistantMode
  title: string
  eyebrow: string
  description: string
  badge: string
}> = [
  {
    id: 'inbox',
    title: 'Conversaciones',
    eyebrow: 'Inbox Assistant',
    description: 'Gestiona mensajes con clientes/leads, detecta intención y prepara acciones desde conversaciones.',
    badge: 'Whapi siguiente fase',
  },
  {
    id: 'copilot',
    title: 'NowLabs AI',
    eyebrow: 'Asistente interno',
    description: 'Opera el CRM para buscar clientes, preparar citas, facturas, cobros, propuestas y documentos.',
    badge: 'Tools + Supabase',
  },
]

type PreparedAction =
  | {
      id: string
      type: 'booking'
      title: string
      assistantMode: AssistantMode
      clientName?: string
      service?: string
      date?: string
      time?: string
      duration?: number
      missingFields: string[]
      notes?: string
    }
  | {
      id: string
      type: 'invoice'
      title: string
      assistantMode: AssistantMode
      clientName?: string
      concept?: string
      amount?: number
      dueDate?: string
      missingFields: string[]
      notes?: string
    }

type PersistenceDiagnostics = {
  sessionUserId: string
  sessionEmail: string
  profileId: string
  profileWorkspaceId: string
  workspaceDebugId: string
  resolvedWorkspaceId: string
  lastCreateConversationStatus: string
  lastCreateMessageStatus: string
  lastReadConversationsStatus: string
  lastReadMessagesStatus: string
  lastSupabaseError: string
  totalConversationsForWorkspace: number
  filteredConversationsForMode: number
  queryMode: string
  lastCreatedConversationId: string
  lastCreatedMessageId: string
}

const initialDiagnostics: PersistenceDiagnostics = {
  sessionUserId: '',
  sessionEmail: '',
  profileId: '',
  profileWorkspaceId: '',
  workspaceDebugId: '',
  resolvedWorkspaceId: '',
  lastCreateConversationStatus: 'Sin probar',
  lastCreateMessageStatus: 'Sin probar',
  lastReadConversationsStatus: 'Sin probar',
  lastReadMessagesStatus: 'Sin probar',
  lastSupabaseError: '',
  totalConversationsForWorkspace: 0,
  filteredConversationsForMode: 0,
  queryMode: 'none',
  lastCreatedConversationId: '',
  lastCreatedMessageId: '',
}

function nowTime() {
  return new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

function isUuid(value?: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

function getInitials(name: string) {
  return name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || 'NC'
}

function parseHourMinute(value: string) {
  const [hour = '10', minute = '0'] = value.split(':')
  return {
    startHour: Math.max(0, Math.min(23, Number(hour) || 10)),
    startMinute: Math.max(0, Math.min(59, Number(minute) || 0)),
  }
}

function endTime(start: string, duration: number) {
  const { startHour, startMinute } = parseHourMinute(start)
  const total = startHour * 60 + startMinute + duration
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function isGenericConversationName(value?: string) {
  return !value || /nuevo lead|lead demo|cliente demo|sin cliente|asistente interno|consulta crm|operacion comercial|operación comercial/i.test(value)
}

function normalizeInput(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function isCapabilityQuestion(value: string) {
  const text = normalizeInput(value)
  return ['que haces', 'que puedes hacer', 'echame un cable', 'ayudame', 'que eres', 'para que sirves'].some((pattern) => text.includes(pattern))
}

function isPricingQuestion(value: string) {
  const text = normalizeInput(value)
  return ['precios', 'precio', 'planes', 'tarifas', 'cuanto cuesta', 'coste'].some((pattern) => text.includes(pattern)) || (text.includes('plan') && /precio|incluye|cuesta/.test(text))
}

function internalAssistantIntro(mode: AssistantMode = 'copilot') {
  if (mode === 'inbox') {
    return 'Soy Inbox Assistant, la capa de conversaciones de NowCRM. Puedo ayudarte a responder clientes, detectar intención, resumir mensajes y preparar citas o facturas con confirmación. WhatsApp/Whapi será la siguiente fase para que esos mensajes entren automáticamente.'
  }

  return 'Soy tu NowLabs AI interno de NowCRM. Puedo ayudarte a buscar clientes, preparar citas en calendario, crear facturas con confirmación, revisar cobros y proponerte la siguiente acción comercial. Por ejemplo, dime: “Reserva a Ana mañana a las 10 para corte” o “Crea una factura a Ana de 299€ por Plan Pro”.'
}

function pricingGuidance() {
  return 'Puedo ayudarte a preparar una propuesta, pero no voy a inventar precios. Necesito saber el tipo de negocio, número de usuarios y qué módulos quiere activar: clientes, calendario, facturación, IA o WhatsApp. Con eso preparo una propuesta clara para revisar.'
}

function intentLabel(intent: AssistantIntent) {
  if (intent.intent === 'booking' || intent.intent === 'booking_concrete') return 'Acción detectada: cita'
  if (intent.intent === 'booking_strategy') return ''
  if (intent.intent === 'invoice' || intent.intent === 'invoice_concrete') return 'Acción detectada: factura'
  if (intent.intent === 'client_search') return 'Acción detectada: cliente'
  if (intent.intent === 'client_summary') return 'Acción detectada: resumen'
  if (intent.intent === 'next_action') return 'Acción detectada: próxima acción'
  if (intent.intent === 'proposal') return 'Acción detectada: propuesta'
  if (intent.intent === 'collection') return 'Acción detectada: cobros'
  return ''
}

function missingText(fields: string[]) {
  return fields.join(', ').replace(/, ([^,]*)$/, ' y $1')
}

function buildPreparedAction(intent: AssistantIntent, mode: AssistantMode): PreparedAction | null {
  const { extracted } = intent
  if ((intent.intent === 'booking' || intent.intent === 'booking_concrete') && (extracted.clientName || extracted.service || extracted.date || extracted.time)) {
    return {
      id: `booking-${Date.now()}`,
      type: 'booking',
      title: 'Crear cita',
      assistantMode: mode,
      clientName: extracted.clientName,
      service: extracted.service,
      date: extracted.date,
      time: extracted.time,
      duration: extracted.duration,
      missingFields: intent.missingFields,
      notes: extracted.service ? `Reserva preparada desde Assistant Agent para ${extracted.service}.` : 'Reserva preparada desde Assistant Agent.',
    }
  }

  if ((intent.intent === 'invoice' || intent.intent === 'invoice_concrete') && (extracted.clientName || extracted.amount || extracted.concept)) {
    return {
      id: `invoice-${Date.now()}`,
      type: 'invoice',
      title: 'Crear factura',
      assistantMode: mode,
      clientName: extracted.clientName,
      concept: extracted.concept,
      amount: extracted.amount,
      dueDate: extracted.dueDate,
      missingFields: intent.missingFields,
      notes: 'Factura preparada desde Assistant Agent. Requiere confirmación.',
    }
  }

  return null
}

function buildLocalOperationalResponse(intent: AssistantIntent, mode: AssistantMode = 'copilot') {
  if (intent.intent === 'capabilities') {
    return internalAssistantIntro(mode)
  }

  if (intent.intent === 'pricing') {
    return pricingGuidance()
  }

  if (intent.intent === 'consultative') {
    return mode === 'inbox'
      ? 'Como Inbox Assistant, puedo ayudarte a convertir esa conversación en una respuesta clara, detectar intención y preparar una cita o seguimiento con confirmación. Si quieres que los mensajes entren desde WhatsApp real, la siguiente fase es Whapi/n8n.'
      : 'Como NowLabs AI, puedo ayudarte a convertir esa necesidad en tareas internas: clientes, citas, cobros, propuestas y seguimiento. Si quieres llevarlo a llamadas o WhatsApp reales, la siguiente fase sería conectarlo con Whapi/n8n para que los mensajes entren solos al CRM.'
  }

  if (intent.intent === 'booking_strategy') {
    return 'Sí, tiene mucho sentido para un negocio con citas. El Assistant puede recoger nombre, servicio, día, hora y duración, preparar la cita y guardarla en calendario con confirmación. Para montarlo bien, dime si quieres que esas reservas entren por WhatsApp/Whapi, web o llamadas.'
  }

  if (intent.intent === 'invoice_general') {
    return 'Puedo ayudarte a preparar facturas, revisar pendientes y generar seguimientos de cobro. Para crear una factura real necesito cliente, importe, concepto y vencimiento, y siempre pediré confirmación antes de guardarla.'
  }

  if (intent.intent === 'document_request') {
    return 'La parte de documentos/PDFs está preparada como siguiente fase con Supabase Storage. Ahora puedo ayudarte a preparar el contenido de una propuesta o factura; la generación y adjuntos reales quedarán conectados cuando actives Storage.'
  }

  if (intent.intent === 'booking' || intent.intent === 'booking_concrete') {
    if (intent.missingFields.length) {
      return buildPreparedAction(intent, mode)
        ? `Tengo la cita casi lista. Falta: ${missingText(intent.missingFields)}. Completa esos datos y la dejo lista para confirmar.`
        : `Sí, se puede. Para crear la reserva necesito: ${missingText(intent.missingFields)}. Dime esos datos y preparo la cita en el calendario.`
    }
    return 'Tengo la cita preparada. Revísala abajo y pulsa Confirmar para crearla en Calendario.'
  }

  if (intent.intent === 'invoice' || intent.intent === 'invoice_concrete') {
    if (intent.missingFields.length) {
      return buildPreparedAction(intent, mode)
        ? `Tengo la factura casi lista. Falta: ${missingText(intent.missingFields)}. No la crearé hasta que confirmes.`
        : `Puedo prepararla. Para crear la factura necesito: ${missingText(intent.missingFields)}. No la crearé hasta que confirmes.`
    }
    return 'Tengo la factura preparada. Revísala abajo y pulsa Confirmar para crearla.'
  }

  if (intent.intent === 'general' && intent.confidence < 0.4) {
    return ''
  }

  return ''
}

function mergePreparedAction(action: PreparedAction, intent: AssistantIntent): PreparedAction {
  const extracted = intent.extracted
  if (action.type === 'booking') {
    const next = {
      ...action,
      clientName: extracted.clientName || action.clientName,
      service: extracted.service || action.service,
      date: extracted.date || action.date,
      time: extracted.time || action.time,
      duration: extracted.duration || action.duration,
    }
    return {
      ...next,
      missingFields: [
        !next.clientName && 'cliente',
        !next.service && 'servicio',
        !next.date && 'fecha',
        !next.time && 'hora',
        !next.duration && 'duración',
      ].filter(Boolean) as string[],
    }
  }

  const next = {
    ...action,
    clientName: extracted.clientName || action.clientName,
    concept: extracted.concept || action.concept,
    amount: action.amount ?? extracted.amount,
    dueDate: extracted.dueDate || extracted.date || action.dueDate,
  }
  return {
    ...next,
    missingFields: [
      !next.clientName && 'cliente',
      !next.amount && 'importe',
      !next.concept && 'concepto',
      !next.dueDate && 'vencimiento',
    ].filter(Boolean) as string[],
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function formatToolResult(tool: AgentToolName, result: unknown) {
  if (tool === 'get_next_best_actions' && Array.isArray(result)) {
    return result.length
      ? `Próximas acciones recomendadas:\n${result.slice(0, 4).map((item, index) => `${index + 1}. ${String(item)}`).join('\n')}`
      : 'No hay acciones urgentes detectadas ahora mismo.'
  }

  if (Array.isArray(result)) {
    if (!result.length) return 'No he encontrado resultados con los datos actuales.'
    const rows = result.slice(0, 4).map((item, index) => {
      const row = getRecord(item)
      const name = String(row?.name ?? row?.client_name ?? row?.title ?? row?.plan ?? `Resultado ${index + 1}`)
      const detail = String(row?.email ?? row?.status ?? row?.date ?? row?.amount ?? '').trim()
      return `${index + 1}. ${name}${detail ? ` · ${detail}` : ''}`
    })
    return `He encontrado ${result.length} resultado(s):\n${rows.join('\n')}`
  }

  const record = getRecord(result)

  if (record && 'total_clients' in record) {
    return `Resumen CRM: ${record.total_clients} clientes, ${record.leads} lead(s), ${record.pending_invoices} factura(s) pendientes, ${record.overdue_invoices} factura(s) vencida(s), ${record.upcoming_events} cita(s) próximas y ${record.open_conversations} conversación(es) abiertas.`
  }

  const client = getRecord(record?.client)
  if (client) {
    const name = String(client.name ?? 'Cliente')
    const status = String(client.status ?? 'sin estado')
    const notes = String(client.notes ?? '').trim()
    return `Resumen de ${name}: estado ${status}.${notes ? `\nNotas: ${notes}` : ''}\nSiguiente paso: confirma necesidad y agenda seguimiento.`
  }

  return 'Tool ejecutada. Resultado preparado para el Assistant Agent.'
}

function normalizeQuery(value: string) {
  return normalizeInput(value).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function detectCopilotCRMQuery(value: string, lastReferencedClientName?: string) {
  const text = normalizeInput(value)
  
  // Detectar referencias a "sus datos", "ese cliente", etc.
  if (/\b(sus datos|su correo|su email|su telefono|su empresa|ese cliente|este cliente|resumen de ese|todos los datos|todos sus datos|informe de ese|dame todos sus datos)\b/.test(text) && lastReferencedClientName) {
    return 'client_report_referenced'
  }
  
  if (/\b(ultimo|ultima) cliente\b/.test(text) && /\b(hora|tiempo|fecha|registrado|registr)\b/.test(text)) return 'latest_client'
  if (/\b(cuantos clientes|numero de clientes|clientes tengo|total de clientes)\b/.test(text)) return 'client_count'
  if (/\b(buscar clientes|busca clientes|encuentra clientes|nombres de cliente|clientes con)\b/.test(text)) return 'search_clients'
  if (/\b(resume|hazme un informe|informe de|detalles de|resumen de)\b/.test(text) && /\b(cliente|cliente)\b/.test(text)) return 'client_report'
  if (/\b(facturas pendientes|pendientes de pago|cobros pendientes|facturas sin pagar|facturas abiertas)\b/.test(text)) return 'pending_invoices'
  if (/\b(citas proximas|proximas citas|agenda|calendario|reuniones proximas)\b/.test(text)) return 'upcoming_events'
  if (/\b(resume mi crm|resumen crm|estado crm|como va mi crm|situacion crm)\b/.test(text)) return 'workspace_summary'
  if (/\b(proxima accion|siguiente accion|que hago|prioridad|siguiente paso|accion comercial)\b/.test(text)) return 'next_action'
  return null
}

async function generateClientReport(clientData: Record<string, unknown>, workspaceId: string) {
  // Mapear el row de Supabase al tipo Client
  const client = mapSupabaseClient(clientData)
  const createdAt = String(clientData.created_at || new Date().toISOString())
  
  const [invoices, events, conversations, activities] = await Promise.all([
    getClientInvoices(workspaceId, client.name),
    getClientCalendarEvents(workspaceId, client.name),
    getClientConversations(workspaceId, client.id),
    getClientActivities(workspaceId, client.name),
  ])

  const sections = [
    `**INFORME DE CLIENTE: ${client.name?.toUpperCase() || 'CLIENTE'}**\n`,
    `**1. DATOS BÁSICOS**`,
    `- Nombre: ${client.name || 'No consta'}`,
    `- Empresa: ${client.company || 'No consta'}`,
    `- Email: ${client.email || 'No consta'}`,
    `- Teléfono: ${client.phone || 'No consta'}`,
    `- Canal: ${client.channel || 'No consta'}`,
    `- Fecha de registro: ${createdAt ? new Date(createdAt).toLocaleDateString('es-ES') : 'No consta'}`,
    `\n**2. ESTADO COMERCIAL**`,
    `- Estado: ${client.status || 'No consta'}`,
    `- Lead Score: ${client.leadScore || 'No consta'}`,
    `- Notas: ${client.notes || 'No consta'}`,
    `\n**3. FACTURAS**`,
    invoices.length
      ? invoices.map((i) => `- ${i.plan || 'Concepto'}: ${i.amount}€ (${i.status}) vence ${i.dueDate}`).join('\n')
      : '- No hay facturas registradas',
    `\n**4. CITAS Y CALENDARIO**`,
    events.length
      ? events.map((e) => `- ${e.title} el ${e.date} a las ${String(e.startHour).padStart(2, '0')}:${String(e.startMinute).padStart(2, '0')} (${e.duration} min)`).join('\n')
      : '- No hay citas registradas',
    `\n**5. CONVERSACIONES**`,
    conversations.length
      ? conversations.map((c) => `- ${c.lastMessage} (${c.sentiment})`).join('\n')
      : '- No hay conversaciones registradas',
    `\n**6. ACTIVIDAD RECIENTE**`,
    activities.length
      ? activities.slice(0, 5).map((a) => `- [${a.type}] ${a.description}`).join('\n')
      : '- No hay actividades registradas',
    `\n**7. PRÓXIMA ACCIÓN RECOMENDADA**`,
    client.status === 'lead' ? '→ Contactar para convertir en cliente activo' : client.status === 'active' ? '→ Revisar facturas pendientes' : '→ Sin acción inmediata recomendada',
  ]

  return sections.filter(Boolean).join('\n')
}

async function executeCopilotCRMQuery(text: string, workspaceId: string, lastReferencedClientName?: string) {
  const queryType = detectCopilotCRMQuery(text, lastReferencedClientName)
  if (!queryType) return null

  try {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) return null

    if (queryType === 'latest_client') {
      const { data, error } = await supabase.from('clients').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(1)
      if (error || !data?.length) return 'No hay clientes registrados todavía en este workspace.'
      const client = mapSupabaseClient(data[0])
      const createdAt = data[0].created_at as string
      if (text.includes('hora') || text.includes('tiempo') || text.includes('fecha') || text.includes('cuándo') || text.includes('cuando')) {
        if (createdAt) {
          const date = new Date(createdAt)
          const formatted = date.toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          return `El último cliente registrado es ${client.name}. Se registró el ${formatted}.`
        } else {
          return `El último cliente registrado es ${client.name}. No consta la fecha de registro.`
        }
      } else {
        return `El último cliente registrado es ${client.name}.`
      }
    }

    if (queryType === 'client_count') {
      const stats = await getClientStats(workspaceId)
      return stats.total_clients
        ? `Tienes ${stats.total_clients} cliente(s) en este workspace, incluyendo ${stats.leads} lead(s), ${stats.active} activo(s), ${stats.inactive} inactivo(s) y ${stats.churned} churned.`
        : 'No hay clientes registrados todavía en este workspace.'
    }

    if (queryType === 'search_clients') {
      const query = normalizeQuery(text)
      const results = await searchClients(workspaceId, query)
      return results.length
        ? `He encontrado ${results.length} cliente(s): ${results.slice(0, 4).map((client) => `${client.name}${client.company ? ` (${client.company})` : ''}${client.email ? ` – ${client.email}` : ''}`).join('; ')}.`
        : 'No se han encontrado clientes que coincidan con ese criterio.'
    }

    if (queryType === 'client_report_referenced' && lastReferencedClientName) {
      const clients = await searchClients(workspaceId, lastReferencedClientName)
      if (!clients.length) return `No encuentro a ${lastReferencedClientName} en este workspace. ¿Quieres que busque por otro nombre?`
      const client = clients[0]
      const fullData = await supabase.from('clients').select('*').eq('id', client.id).maybeSingle()
      if (fullData.error) throw fullData.error
      const report = await generateClientReport(fullData.data, workspaceId)
      return report
    }

    if (queryType === 'client_report') {
      const query = normalizeQuery(text).replace(/\b(resume|hazme un informe|informe de|detalles de|resumen de)\b/g, '').replace(/\b(cliente|cliente)\b/g, '').trim()
      const clients = await searchClients(workspaceId, query)
      if (!clients.length) return 'No encuentro ese cliente en este workspace. ¿Quieres que busque por nombre parecido?'
      if (clients.length > 1) {
        return `Encontré varios clientes: ${clients.slice(0, 3).map((client) => `${client.name} (${client.email})`).join(', ')}. ¿Cuál quieres que resuma?`
      }
      const fullData = await supabase.from('clients').select('*').eq('id', clients[0].id).maybeSingle()
      if (fullData.error) throw fullData.error
      const report = await generateClientReport(fullData.data, workspaceId)
      return report
    }

    if (queryType === 'pending_invoices') {
      const invoices = await getPendingInvoices(workspaceId)
      return invoices.length
        ? `Tienes ${invoices.length} factura(s) pendiente(s): ${invoices.slice(0, 4).map((invoice) => `${invoice.clientName} · ${invoice.amount}€ · vence ${invoice.dueDate}`).join('; ')}.`
        : 'No hay facturas pendientes en este workspace.'
    }

    if (queryType === 'upcoming_events') {
      const events = await getUpcomingCalendarEvents(workspaceId)
      return events.length
        ? `Próximas citas: ${events.slice(0, 4).map((event) => `${event.title} con ${event.clientName ?? 'cliente'} el ${event.date}${event.startHour !== undefined ? ` a las ${String(event.startHour).padStart(2, '0')}:${String(event.startMinute).padStart(2, '0')}` : ''}`).join('; ')}.`
        : 'No hay citas próximas en el calendario del workspace.'
    }

    if (queryType === 'workspace_summary') {
      const summary = await getWorkspaceSummary(workspaceId)
      return `Resumen CRM: ${summary.total_clients} clientes, ${summary.leads} lead(s), ${summary.pending_invoices} factura(s) pendientes, ${summary.overdue_invoices} factura(s) vencida(s), ${summary.upcoming_events} cita(s) próximas y ${summary.open_conversations} conversación(es) abiertas.`
    }

    if (queryType === 'next_action') {
      const actions = await getNextBestActions(workspaceId)
      return actions.length
        ? `Próxima(s) acción(es): ${actions.join(' ')}`
        : 'No hay acciones comerciales urgentes detectadas en este momento.'
    }
  } catch {
    return null
  }

  return null
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message)
  return String(error || 'Error desconocido')
}

export default function AssistantPage() {
  const { currentUser } = useCurrentUser()
  const userWorkspaceId = currentUser.workspaceId
  const [assistantReady, setAssistantReady] = useState(false)
  const [conversationList, setConversationList] = useState<Conversation[]>([])
  const [selectedIds, setSelectedIds] = useState<Record<AssistantMode, string>>({ inbox: '', copilot: '' })
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [localMessages, setLocalMessages] = useState<Record<string, Message[]>>({})
  const [convSearch, setConvSearch] = useState('')
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isRealMode, setIsRealMode] = useState(false)
  const [assistantWebhookUrl, setAssistantWebhookUrl] = useState('')
  const [assistantFlowFound, setAssistantFlowFound] = useState(false)
  const [assistantFlowStatus, setAssistantFlowStatus] = useState<N8nFlowStatus>('demo')
  const [lastResponseSource, setLastResponseSource] = useState<'n8n' | 'fallback' | 'supabase' | null>(null)
  const [lastActionStatus, setLastActionStatus] = useState('')
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('copilot')
  const [lastReferencedClientName, setLastReferencedClientName] = useState<string | undefined>()
  const [detectedIntent, setDetectedIntent] = useState('')
  const [preparedAction, setPreparedAction] = useState<PreparedAction | null>(null)
  const [confirmingAction, setConfirmingAction] = useState(false)
  const [diagnostics, setDiagnostics] = useState<PersistenceDiagnostics>(initialDiagnostics)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const activeQuickPrompts = quickPromptsByMode[assistantMode]

  const updateDiagnostics = useCallback((patch: Partial<PersistenceDiagnostics>) => {
    setDiagnostics((prev) => ({ ...prev, ...patch }))
  }, [])

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true)
    setAssistantReady(false)
    try {
      if (OFFLINE_FORCE_DEV) {
        const offlineConversations = loadOfflineConversations()
        const offlineMessages = loadOfflineMessages()
        const offlineSelectedIds = {
          inbox: offlineConversations.find((conversation) => conversation.assistantMode === 'inbox')?.id ?? '',
          copilot: offlineConversations.find((conversation) => conversation.assistantMode === 'copilot')?.id ?? '',
        }
        setConversationList(offlineConversations)
        setSelectedIds(offlineSelectedIds)
        setWorkspaceId(OFFLINE_WORKSPACE_ID)
        setIsRealMode(true)
        setAssistantWebhookUrl('')
        setAssistantFlowFound(false)
        setAssistantFlowStatus('active')
        setLocalMessages(offlineMessages)
        updateDiagnostics({
          lastReadConversationsStatus: `Offline local cargado: ${offlineConversations.length} conversación(es)`,
          lastReadMessagesStatus: 'Offline local cargado',
          lastSupabaseError: 'Modo offline local: Supabase bloqueado por red',
          sessionUserId: OFFLINE_USER_ID,
          sessionEmail: OFFLINE_USER_EMAIL,
          profileId: OFFLINE_USER_ID,
          profileWorkspaceId: OFFLINE_WORKSPACE_ID,
          workspaceDebugId: OFFLINE_WORKSPACE_ID,
          resolvedWorkspaceId: OFFLINE_WORKSPACE_ID,
          totalConversationsForWorkspace: offlineConversations.length,
          filteredConversationsForMode: offlineConversations.length,
          queryMode: 'offline-local',
        })
        return
      }

      const context = await getResolvedWorkspaceContext()
      const hasRealSession = Boolean(context?.user)
      const resolvedWorkspaceId = context?.profile?.workspace_id || context?.workspace?.id || userWorkspaceId
      if (!hasRealSession) {
        const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
        const demoConversations = mockConversations.map((conversation, index) => ({
          ...conversation,
          assistantMode: index === 0 ? 'copilot' as AssistantMode : 'inbox' as AssistantMode,
          metadata: { assistant_mode: index === 0 ? 'copilot' : 'inbox', source: 'demo' },
        }))
        setConversationList(demoConversations)
        setSelectedIds({
          inbox: demoConversations.find((conversation) => conversation.assistantMode === 'inbox')?.id ?? '',
          copilot: demoConversations.find((conversation) => conversation.assistantMode === 'copilot')?.id ?? '',
        })
        setWorkspaceId(null)
        setIsRealMode(false)
        setAssistantWebhookUrl('')
        setAssistantFlowFound(false)
        setAssistantFlowStatus('demo')
        setLocalMessages(mockMessages)
        updateDiagnostics({
          lastReadConversationsStatus: 'Sin sesión real',
          lastReadMessagesStatus: 'Sin sesión real',
          lastSupabaseError: isDemoMode ? '' : 'No se ha encontrado sesión real.',
          sessionUserId: '',
          sessionEmail: '',
          profileId: '',
          profileWorkspaceId: '',
          workspaceDebugId: '',
          resolvedWorkspaceId: '',
          totalConversationsForWorkspace: 0,
          filteredConversationsForMode: 0,
          queryMode: isDemoMode ? 'demo' : 'no-session',
        })
        if (!isDemoMode) toast.warning('Assistant en modo demo', { description: 'No se ha encontrado un workspace real.' })
        return
      }

      window.localStorage.removeItem(DEMO_MODE_KEY)
      const flows = resolvedWorkspaceId ? await getN8nFlows(resolvedWorkspaceId).catch(() => []) : []
      const assistantFlow = getAssistantAgentFlow(flows, false)
      let realConversations: Conversation[] = []
      if (resolvedWorkspaceId) {
        try {
          realConversations = await getAssistantConversations(resolvedWorkspaceId)
          updateDiagnostics({
            lastReadConversationsStatus: `OK workspace: ${realConversations.length} conversación(es)`,
            lastSupabaseError: '',
            sessionUserId: context?.user?.id ?? '',
            sessionEmail: context?.user?.email ?? '',
            profileId: context?.profile?.id ?? '',
            profileWorkspaceId: context?.profile?.workspace_id ?? '',
            workspaceDebugId: context?.workspace?.id ?? '',
            resolvedWorkspaceId,
            totalConversationsForWorkspace: realConversations.length,
            queryMode: `workspace_id=${resolvedWorkspaceId}`,
          })
        } catch (error) {
          updateDiagnostics({
            lastReadConversationsStatus: 'ERROR leyendo conversations',
            lastSupabaseError: safeErrorMessage(error),
            sessionUserId: context?.user?.id ?? '',
            sessionEmail: context?.user?.email ?? '',
            profileId: context?.profile?.id ?? '',
            profileWorkspaceId: context?.profile?.workspace_id ?? '',
            workspaceDebugId: context?.workspace?.id ?? '',
            resolvedWorkspaceId,
            totalConversationsForWorkspace: 0,
            queryMode: `workspace_id=${resolvedWorkspaceId}`,
          })
          realConversations = []
        }
      } else {
        updateDiagnostics({
          lastReadConversationsStatus: 'ERROR: workspaceId null',
          lastSupabaseError: 'Usuario real sin workspaceId resuelto.',
          sessionUserId: context?.user?.id ?? '',
          sessionEmail: context?.user?.email ?? '',
          profileId: context?.profile?.id ?? '',
          profileWorkspaceId: context?.profile?.workspace_id ?? '',
          workspaceDebugId: context?.workspace?.id ?? '',
          resolvedWorkspaceId: '',
          totalConversationsForWorkspace: 0,
          filteredConversationsForMode: 0,
          queryMode: 'workspaceId=null',
        })
      }
      setConversationList(realConversations)
      setSelectedIds({
        inbox: realConversations.find((conversation) => conversation.assistantMode === 'inbox')?.id ?? '',
        copilot: realConversations.find((conversation) => conversation.assistantMode === 'copilot')?.id ?? '',
      })
      setLocalMessages({})
      setWorkspaceId(resolvedWorkspaceId ?? null)
      setIsRealMode(Boolean(resolvedWorkspaceId))
      setAssistantWebhookUrl(resolvedWorkspaceId ? assistantFlow.webhookUrl || ASSISTANT_AGENT_WEBHOOK_URL : '')
      setAssistantFlowFound(assistantFlow.isActive)
      setAssistantFlowStatus(assistantFlow.status)
    } catch (error) {
      const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
      setWorkspaceId(null)
      setIsRealMode(false)
      setAssistantWebhookUrl('')
      setAssistantFlowFound(false)
      setAssistantFlowStatus('demo')
      if (isDemoMode) {
        const demoConversations = mockConversations.map((conversation, index) => ({
          ...conversation,
          assistantMode: index === 0 ? 'copilot' as AssistantMode : 'inbox' as AssistantMode,
          metadata: { assistant_mode: index === 0 ? 'copilot' : 'inbox', source: 'demo' },
        }))
        setConversationList(demoConversations)
        setSelectedIds({
          inbox: demoConversations.find((conversation) => conversation.assistantMode === 'inbox')?.id ?? '',
          copilot: demoConversations.find((conversation) => conversation.assistantMode === 'copilot')?.id ?? '',
        })
        setLocalMessages(mockMessages)
      } else {
        setConversationList([])
        setSelectedIds({ inbox: '', copilot: '' })
        setLocalMessages({})
      }
      updateDiagnostics({
        lastReadConversationsStatus: isDemoMode ? 'Modo demo' : 'ERROR contexto workspace',
        lastReadMessagesStatus: isDemoMode ? 'Modo demo' : 'No intentado',
        lastSupabaseError: isDemoMode ? '' : safeErrorMessage(error),
        sessionUserId: '',
        sessionEmail: '',
        profileId: '',
        profileWorkspaceId: '',
        workspaceDebugId: '',
        resolvedWorkspaceId: '',
        totalConversationsForWorkspace: 0,
        filteredConversationsForMode: 0,
        queryMode: isDemoMode ? 'demo' : 'context-error',
      })
      if (!isDemoMode) toast.warning('Assistant en modo demo', { description: 'No se pudieron cargar conversaciones reales.' })
    } finally {
      setLoadingConversations(false)
      setAssistantReady(true)
    }
  }, [updateDiagnostics, userWorkspaceId])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadConversations()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadConversations])

  const modeConversations = useMemo(
    () => conversationList.filter((conversation) => (conversation.assistantMode ?? 'inbox') === assistantMode),
    [assistantMode, conversationList]
  )
  const selectedId = selectedIds[assistantMode]
  const selected = modeConversations.find((conversation) => conversation.id === selectedId) ?? modeConversations[0] ?? null
  const activeSelectedId = selected?.id ?? ''
  const selectedConversationIsUuid = isUuid(activeSelectedId)

  useEffect(() => {
    if (!selected) return
    if (!isRealMode) return
    if (!workspaceId || !isUuid(selected.id)) {
      const timeout = window.setTimeout(() => {
        updateDiagnostics({
          lastReadMessagesStatus: `Bloqueado: selectedConversationId no válido (${selected.id})`,
          lastSupabaseError: !workspaceId
            ? 'No se ha podido resolver el workspace real. Revisa profile.workspace_id.'
            : 'Conversación temporal detectada en modo real. No se consulta Supabase con IDs conv-*.',
        })
      }, 0)
      return () => window.clearTimeout(timeout)
    }

    const loadMessages = async () => {
      setLoadingMessages(true)
      try {
        const realMessages = await getConversationMessages(selected.id, workspaceId ?? undefined)
        setLocalMessages((prev) => ({ ...prev, [selected.id]: realMessages }))
        updateDiagnostics({
          lastReadMessagesStatus: `OK: ${realMessages.length} mensaje(s) en ${selected.id}`,
          lastSupabaseError: '',
        })
      } catch (error) {
        setLocalMessages((prev) => ({ ...prev, [selected.id]: [] }))
        updateDiagnostics({
          lastReadMessagesStatus: `ERROR leyendo messages en ${selected.id}`,
          lastSupabaseError: safeErrorMessage(error),
        })
      } finally {
        setLoadingMessages(false)
      }
    }

    const timeout = window.setTimeout(() => {
      void loadMessages()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [isRealMode, selected, updateDiagnostics, workspaceId])

  const msgs = useMemo(() => selected ? localMessages[selected.id] ?? [] : [], [localMessages, selected])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, isTyping])

  const filteredConvs = modeConversations.filter((conversation) => !convSearch || conversation.clientName.toLowerCase().includes(convSearch.toLowerCase()))
  const averageLeadScore = Math.round((modeConversations.reduce((sum, conversation) => sum + (leadScores[conversation.id] ?? 70), 0) / Math.max(modeConversations.length, 1)))
  const score = selected ? leadScores[selected.id] ?? (selected.sentiment === 'positive' ? 84 : selected.sentiment === 'negative' ? 42 : 68) : 70
  const isOfflineMode = OFFLINE_FORCE_DEV
  const assistantN8nActive = !isOfflineMode && isRealMode && Boolean(assistantWebhookUrl)
  const assistantSourceLabel = isOfflineMode ? 'Offline local' : assistantN8nActive ? 'n8n/OpenAI' : 'Demo'
  const assistantSourceDetail = isOfflineMode ? 'Supabase bloqueado por red' : assistantN8nActive ? 'workflow activo' : 'fallback mock'

  const assistantStats = [
    { label: assistantMode === 'inbox' ? 'Conversaciones Inbox' : 'Consultas Copilot', value: String(modeConversations.length), detail: isRealMode ? 'persistentes' : 'demo', icon: <MessageSquare className="h-4 w-4" />, tone: 'text-indigo-600 bg-indigo-50' },
    { label: 'IA en modo', value: assistantSourceLabel, detail: assistantSourceDetail, icon: <Bot className="h-4 w-4" />, tone: assistantN8nActive ? 'text-emerald-600 bg-emerald-50' : 'text-violet-600 bg-violet-50' },
    { label: assistantMode === 'inbox' ? 'Lead score medio' : 'Acciones preparadas', value: assistantMode === 'inbox' ? String(averageLeadScore) : (preparedAction ? '1' : '0'), detail: assistantMode === 'inbox' ? 'estimado' : 'requieren confirmación', icon: <Target className="h-4 w-4" />, tone: 'text-emerald-600 bg-emerald-50' },
  ]

  const appendLocalMessage = (conversationId: string, message: Message) => {
    setLocalMessages((prev) => {
      const next = { ...prev, [conversationId]: [...(prev[conversationId] ?? []), message] }
      if (OFFLINE_FORCE_DEV) persistOfflineMessages(next)
      return next
    })
  }

  const ensureRealConversation = async () => {
    if (!isRealMode) return selected
    if (OFFLINE_FORCE_DEV) {
      const created = createOfflineConversation(assistantMode)
      setConversationList((prev) => {
        const next = [created, ...prev.filter((conversation) => conversation.id !== selected?.id)]
        persistOfflineConversations(next)
        return next
      })
      setSelectedIds((prev) => ({ ...prev, [assistantMode]: created.id }))
      setLocalMessages((prev) => {
        const next = { ...prev, [created.id]: [] }
        persistOfflineMessages(next)
        return next
      })
      updateDiagnostics({
        lastCreateConversationStatus: `OK offline conversation: ${created.id}`,
        lastCreatedConversationId: created.id,
        lastSupabaseError: 'Offline local: conversación creada sin Supabase',
      })
      return created
    }

    if (!workspaceId) {
      const message = 'No se ha podido resolver el workspace real. Revisa profile.workspace_id.'
      updateDiagnostics({ lastSupabaseError: message })
      toast.error('Workspace no resuelto', { description: message })
      return null
    }

    if (selected && isUuid(selected.id)) return selected

    const created = await createAssistantConversation(workspaceId, assistantMode, {
      clientName: assistantMode === 'copilot' ? 'Consulta NowLabs AI' : 'Nueva conversación',
      lastMessage: assistantMode === 'copilot' ? 'Consulta NowLabs AI' : 'Conversación Inbox Assistant',
      metadata: { source: 'assistant_auto_create', assistant_mode: assistantMode },
    })
    setConversationList((prev) => [created, ...prev.filter((conversation) => conversation.id !== selected?.id)])
    setSelectedIds((prev) => ({ ...prev, [assistantMode]: created.id }))
    setLocalMessages((prev) => ({ ...prev, [created.id]: [] }))
    updateDiagnostics({
      lastCreateConversationStatus: `OK auto conversation: ${created.id}`,
      lastCreatedConversationId: created.id,
      lastSupabaseError: '',
    })
    return created
  }

  const appendAssistantMessage = async (conversationId: string, content: string, clientName?: string) => {
    if (!OFFLINE_FORCE_DEV && isRealMode && (!workspaceId || !isUuid(conversationId))) {
      const message = !workspaceId
        ? 'No se ha podido resolver el workspace real. Revisa profile.workspace_id.'
        : `Bloqueado intento de guardar Assistant message con conversation_id temporal: ${conversationId}`
      updateDiagnostics({ lastCreateMessageStatus: 'Bloqueado', lastSupabaseError: message })
      throw new Error(message)
    }
    const aiMsg: Message = { id: `ai-${Date.now()}`, conversationId, content, sender: 'ai', timestamp: nowTime() }
    appendLocalMessage(conversationId, aiMsg)
    if (!OFFLINE_FORCE_DEV && isRealMode && workspaceId) {
      let saved: Message
      try {
        saved = await createMessage(conversationId, { content, sender: 'ai', metadata: { source: 'assistant_agent', assistant_mode: assistantMode } }, workspaceId)
        updateDiagnostics({ lastCreateMessageStatus: `OK assistant message: ${saved.id}`, lastSupabaseError: '' })
      } catch (error) {
        updateDiagnostics({
          lastCreateMessageStatus: 'ERROR guardando assistant message',
          lastSupabaseError: safeErrorMessage(error),
        })
        throw error
      }
      await updateConversationScoped(conversationId, workspaceId, {
        lastMessage: content,
        unread: true,
        assistantMode,
        metadata: { assistant_mode: assistantMode, last_source: 'assistant_agent' },
      }).catch(() => null)
      if (workspaceId) {
        await createActivity(workspaceId, { type: 'message', description: `Assistant Agent: ${content.slice(0, 90)}`, clientName })
      }
    }
  }

  const sendMessage = async (overrideContent?: string, options: { sender?: MessageSender } = {}) => {
    const content = (overrideContent ?? input).trim()
    if (!content || isTyping) return
    const activeConversation = isRealMode ? await ensureRealConversation() : selected
    if (!activeConversation) return
    const conversationId = activeConversation.id
    if (!OFFLINE_FORCE_DEV && isRealMode && (!workspaceId || !isUuid(conversationId))) {
      const message = !workspaceId
        ? 'No se ha podido resolver el workspace real. Revisa profile.workspace_id.'
        : `Bloqueado intento de enviar mensaje con conversation_id temporal: ${conversationId}`
      updateDiagnostics({ lastCreateMessageStatus: 'Bloqueado', lastSupabaseError: message })
      toast.error('No se pudo enviar', { description: message })
      return
    }
    const userSender: MessageSender = options.sender || (assistantMode === 'inbox' ? 'client' : 'agent')
    const userMsg: Message = { id: `${userSender}-${Date.now()}`, conversationId, content, sender: userSender, timestamp: nowTime(), metadata: { assistant_mode: assistantMode } }
    const defaultClientName = isGenericConversationName(activeConversation.clientName) ? undefined : activeConversation.clientName
    const operationalIntent = detectAssistantIntent(content, { defaultClientName })
    const localIntentLabel = intentLabel(operationalIntent)
    const localResponse = buildLocalOperationalResponse(operationalIntent, assistantMode)

    appendLocalMessage(conversationId, userMsg)
    setInput('')
    setDetectedIntent(localIntentLabel)
    setIsTyping(true)

    try {
      if (!OFFLINE_FORCE_DEV && isRealMode && workspaceId) {
        let saved: Message
        try {
          saved = await createMessage(conversationId, { content, sender: userSender, metadata: { source: 'assistant_ui', assistant_mode: assistantMode, detected_intent: operationalIntent.intent } }, workspaceId)
          updateDiagnostics({ lastCreateMessageStatus: `OK user message: ${saved.id}`, lastSupabaseError: '' })
        } catch (error) {
          updateDiagnostics({
            lastCreateMessageStatus: 'ERROR guardando user message',
            lastSupabaseError: safeErrorMessage(error),
          })
          throw error
        }
        await updateConversationScoped(conversationId, workspaceId, {
          lastMessage: content,
          unread: userSender === 'client',
          assistantMode,
          intent: operationalIntent.intent,
          metadata: { assistant_mode: assistantMode, last_source: 'assistant_ui', detected_intent: operationalIntent.intent },
        }).catch(() => null)
        await createActivity(workspaceId, { type: 'message', description: `Mensaje enviado a ${activeConversation.clientName}`, clientName: activeConversation.clientName })
      }

      if (OFFLINE_FORCE_DEV) {
        const offlineResponse = localResponse || `Gracias, he registrado tu mensaje en modo offline local. Si quieres, dime el siguiente paso o pide una acción comercial.`
        await appendAssistantMessage(conversationId, offlineResponse, activeConversation.clientName)
        setLastResponseSource('fallback')
        return
      }

      if (!assistantN8nActive && isCapabilityQuestion(content)) {
        await appendAssistantMessage(conversationId, internalAssistantIntro(assistantMode), activeConversation.clientName)
        setLastResponseSource(null)
        return
      }

      if (!assistantN8nActive && isPricingQuestion(content)) {
        await appendAssistantMessage(conversationId, pricingGuidance(), activeConversation.clientName)
        setLastResponseSource(null)
        return
      }

      if (!assistantN8nActive && /no entiendo|no sé|no se|ayuda/i.test(content)) {
        await appendAssistantMessage(conversationId, 'Claro. Dime si quieres crear una cita, buscar un cliente, preparar una factura o ver la próxima acción comercial.', activeConversation.clientName)
        setLastResponseSource(null)
        return
      }

      if (preparedAction?.assistantMode === assistantMode && preparedAction.missingFields.length) {
        const mergedAction = mergePreparedAction(preparedAction, operationalIntent)
        if (mergedAction.missingFields.length < preparedAction.missingFields.length) {
          setPreparedAction(mergedAction)
          setLastActionStatus(`Acción actualizada: ${mergedAction.type === 'booking' ? 'cita' : 'factura'}`)
          await appendAssistantMessage(
            conversationId,
            mergedAction.missingFields.length
              ? `Perfecto, he actualizado la acción. Todavía falta: ${missingText(mergedAction.missingFields)}.`
              : 'Perfecto, ya tengo todos los datos. Revisa la card y pulsa Confirmar para ejecutarla.',
            activeConversation.clientName
          )
          setLastResponseSource(null)
          return
        }
      }

      if (assistantMode === 'copilot' && isRealMode && workspaceId) {
        const crmResponse = await executeCopilotCRMQuery(content, workspaceId, lastReferencedClientName)
        if (crmResponse) {
          // Actualizar el cliente referenciado si es una consulta CRM
          const queryType = detectCopilotCRMQuery(content, lastReferencedClientName)
          if (queryType === 'latest_client' || queryType === 'client_report' || queryType === 'client_report_referenced') {
            const clients = await searchClients(workspaceId, normalizeQuery(content))
            if (clients.length > 0) {
              setLastReferencedClientName(clients[0].name)
            }
          }
          await appendAssistantMessage(conversationId, crmResponse, activeConversation.clientName)
          setLastResponseSource('supabase')
          return
        }
      }

      const concreteActionIntents: AssistantIntent['intent'][] = ['booking', 'booking_concrete', 'invoice', 'invoice_concrete']
      const shouldUseLocalResponse = concreteActionIntents.includes(operationalIntent.intent) || !assistantN8nActive
      if (localResponse && shouldUseLocalResponse) {
        const action = buildPreparedAction(operationalIntent, assistantMode)
        await new Promise((resolve) => setTimeout(resolve, 350))
        await appendAssistantMessage(conversationId, localResponse, activeConversation.clientName)
        setPreparedAction(action)
        if (action) setLastActionStatus(`Última acción preparada: ${action.type === 'booking' ? 'cita' : 'factura'}`)
        setLastResponseSource(null)
        return
      }

      const safeToolByIntent: Partial<Record<AssistantIntent['intent'], AgentToolName>> = {
        client_search: 'search_clients',
        client_summary: 'get_client_summary',
        next_action: 'get_next_best_actions',
        collection: 'list_invoices',
      }
      const safeTool = safeToolByIntent[operationalIntent.intent]
      if (!OFFLINE_FORCE_DEV && assistantMode === 'copilot' && safeTool && workspaceId) {
        const toolInput =
          safeTool === 'search_clients' ? { query: operationalIntent.extracted.clientName || content } :
          safeTool === 'get_client_summary' ? { name: operationalIntent.extracted.clientName || activeConversation.clientName } :
          safeTool === 'list_invoices' ? { status: 'pending' } :
          {}
        const toolResult = await callAgentTool(safeTool, workspaceId, toolInput, {
          source: 'assistant_local_intent',
          conversation_id: activeConversation.id,
          user_intent: operationalIntent.intent,
        }).catch(() => null)
        if (toolResult?.ok) {
          await appendAssistantMessage(conversationId, formatToolResult(safeTool, toolResult.result), activeConversation.clientName)
          setLastResponseSource(null)
          return
        }
      }

      const assistantResult = await respondWithAssistant({
        input: content,
        workspaceId,
        workspaceName: currentUser.workspaceName,
        conversation: activeConversation,
        messages: [...(localMessages[conversationId] ?? []), userMsg],
        isDemo: !isRealMode,
        webhookUrl: assistantN8nActive ? assistantWebhookUrl : undefined,
        assistantMode,
      })

      await new Promise((resolve) => setTimeout(resolve, 900))

      await appendAssistantMessage(conversationId, assistantResult.response, activeConversation.clientName)

      if (assistantResult.source === 'n8n') {
        setLastResponseSource('n8n')
        toast.success('n8n/OpenAI respondió', { description: 'Respuesta guardada en la conversación.' })
      } else if (assistantN8nActive && assistantResult.trigger.status === 'error') {
        setLastResponseSource('fallback')
        toast.warning('n8n no disponible, usando fallback seguro.', { description: 'El mensaje se ha guardado igualmente.' })
      } else {
        setLastResponseSource('fallback')
      }

      const lower = content.toLowerCase()
      if (!OFFLINE_FORCE_DEV && (lower.includes('pago') || lower.includes('factura') || lower.includes('cobro'))) {
        await triggerN8nWebhook('invoice_paid', { message: { content }, client: { name: activeConversation.clientName }, workspace_id: workspaceId || undefined, mode: isRealMode ? 'real' : 'demo' })
      }
      if (!OFFLINE_FORCE_DEV && (lower.includes('llamada') || lower.includes('reun') || lower.includes('agenda'))) {
        await triggerN8nWebhook('appointment_booked', { message: { content }, client: { name: activeConversation.clientName }, workspace_id: workspaceId || undefined, mode: isRealMode ? 'real' : 'demo' })
      }
    } catch (error) {
      toast.error('No se pudo guardar el mensaje', { description: error instanceof Error ? error.message : 'Se mantiene en pantalla como fallback local.' })
    } finally {
      setIsTyping(false)
    }
  }

  const confirmPreparedAction = async () => {
    if (!preparedAction || confirmingAction) return
    if (!selected) return

    setConfirmingAction(true)
    try {
      const activeConversation = isRealMode ? await ensureRealConversation() : selected
      if (!activeConversation) return
      if (isRealMode && (!workspaceId || !isUuid(activeConversation.id))) {
        throw new Error(!workspaceId ? 'Workspace real no resuelto.' : 'No se puede confirmar una acción usando una conversación temporal.')
      }

      if (preparedAction.type === 'booking') {
        if (preparedAction.missingFields.length || !preparedAction.clientName || !preparedAction.service || !preparedAction.date || !preparedAction.time || !preparedAction.duration) {
          toast.warning('Faltan datos para crear la cita', { description: missingText(preparedAction.missingFields) || 'Completa la card antes de confirmar.' })
          return
        }
        const { startHour, startMinute } = parseHourMinute(preparedAction.time)
        const toolInput = {
          title: `${preparedAction.service} - ${preparedAction.clientName}`,
          client_name: preparedAction.clientName,
          date: preparedAction.date,
          start_time: preparedAction.time,
          end_time: endTime(preparedAction.time, preparedAction.duration),
          type: 'meeting',
          notes: preparedAction.notes,
        }
        const toolResult = !OFFLINE_FORCE_DEV && workspaceId
          ? await callAgentTool('create_calendar_event', workspaceId, toolInput, {
              source: 'assistant_confirmation',
              conversation_id: activeConversation.id,
              user_intent: 'booking',
            }).catch(() => null)
          : null

        if (!toolResult?.ok || toolResult.mode === 'fallback') {
          if (!workspaceId) throw new Error('No hay workspace real para crear el evento.')
          await createCalendarEvent(workspaceId, {
            title: `${preparedAction.service} - ${preparedAction.clientName}`,
            date: preparedAction.date,
            startHour,
            startMinute,
            duration: preparedAction.duration,
            type: 'meeting',
            clientName: preparedAction.clientName,
            description: preparedAction.notes,
          })
        }

        if (workspaceId) {
          await createActivity(workspaceId, { type: 'call', description: `Cita creada desde Assistant: ${preparedAction.service}`, clientName: preparedAction.clientName })
          if (!OFFLINE_FORCE_DEV) {
            await triggerN8nWebhook('calendar_event_created', {
              workspace_id: workspaceId,
              mode: 'real',
              calendar_event: toolInput,
              client: { name: preparedAction.clientName },
              metadata: { source: 'assistant_confirmation' },
            })
          }
        }

        await appendAssistantMessage(activeConversation.id, `Cita creada en Calendario: ${preparedAction.clientName}, ${preparedAction.service}, ${preparedAction.date} a las ${preparedAction.time}.`, preparedAction.clientName)
        toast.success('Cita creada en Calendario')
        setLastActionStatus('Última acción confirmada: cita creada')
      }

      if (preparedAction.type === 'invoice') {
        if (preparedAction.missingFields.length || !preparedAction.clientName || !preparedAction.concept || !preparedAction.amount || !preparedAction.dueDate) {
          toast.warning('Faltan datos para crear la factura', { description: missingText(preparedAction.missingFields) || 'Completa la card antes de confirmar.' })
          return
        }
        const toolInput = {
          client_name: preparedAction.clientName,
          concept: preparedAction.concept,
          amount: preparedAction.amount,
          status: 'pending',
          due_date: preparedAction.dueDate,
          notes: preparedAction.notes,
        }
        const toolResult = !OFFLINE_FORCE_DEV && workspaceId
          ? await callAgentTool('create_invoice', workspaceId, toolInput, {
              source: 'assistant_confirmation',
              conversation_id: activeConversation.id,
              user_intent: 'invoice',
            }).catch(() => null)
          : null

        if (!toolResult?.ok || toolResult.mode === 'fallback') {
          if (!workspaceId) throw new Error('No hay workspace real para crear la factura.')
          await createInvoice(workspaceId, {
            clientName: preparedAction.clientName,
            amount: preparedAction.amount,
            status: 'pending',
            dueDate: preparedAction.dueDate,
            plan: preparedAction.concept,
            notes: preparedAction.notes,
          })
        }

        if (workspaceId) {
          await createActivity(workspaceId, { type: 'deal', description: `Factura creada desde Assistant: ${preparedAction.concept}`, clientName: preparedAction.clientName })
          if (!OFFLINE_FORCE_DEV) {
            await triggerN8nWebhook('invoice_created', {
              workspace_id: workspaceId,
              mode: 'real',
              invoice: toolInput,
              client: { name: preparedAction.clientName },
              metadata: { source: 'assistant_confirmation' },
            })
          }
        }

        await appendAssistantMessage(activeConversation.id, `Factura creada: ${preparedAction.clientName}, ${preparedAction.concept}, ${preparedAction.amount} EUR.`, preparedAction.clientName)
        toast.success('Factura creada')
        setLastActionStatus('Última acción confirmada: factura creada')
      }

      setPreparedAction(null)
    } catch (error) {
      toast.error('No se pudo confirmar la acción', { description: error instanceof Error ? error.message : 'Revisa Supabase y vuelve a intentarlo.' })
    } finally {
      setConfirmingAction(false)
    }
  }

  const cancelPreparedAction = () => {
    setPreparedAction(null)
    setLastActionStatus('Última acción cancelada')
    toast.info('Acción descartada', { description: 'No se ha creado nada en Supabase.' })
  }

  const createDemoConversation = async () => {
    const isCopilot = assistantMode === 'copilot'
    const payload = {
      clientName: isCopilot ? (isRealMode ? 'Consulta NowLabs AI' : 'Consulta NowLabs AI demo') : (isRealMode ? 'Nueva conversación' : 'Lead demo'),
      clientAvatar: isCopilot ? 'CRM' : 'IN',
      channel: 'Web' as Channel,
      sentiment: 'neutral' as ConversationSentiment,
      intent: isCopilot ? 'Copilot CRM' : 'Inbox Assistant',
      lastMessage: isCopilot
        ? 'Abre una consulta interna para gestionar clientes, citas o facturas.'
        : 'Conversación lista para simular un mensaje de cliente.',
      unread: true,
      assistantMode,
    }

    try {
      if (isRealMode && !OFFLINE_FORCE_DEV) {
        if (!workspaceId) {
          const message = 'No se ha podido resolver el workspace real. Revisa profile.workspace_id.'
          updateDiagnostics({ lastCreateConversationStatus: 'Bloqueado', lastSupabaseError: message })
          toast.error('Workspace no resuelto', { description: message })
          return
        }
        let created: Conversation
        try {
          created = await createAssistantConversation(workspaceId, assistantMode, {
            ...payload,
            metadata: { source: 'assistant_new_conversation', assistant_mode: assistantMode },
          })
          updateDiagnostics({
            lastCreateConversationStatus: `OK conversation: ${created.id}`,
            lastCreatedConversationId: created.id,
            lastSupabaseError: '',
          })
        } catch (error) {
          updateDiagnostics({
            lastCreateConversationStatus: 'ERROR creando conversation',
            lastSupabaseError: safeErrorMessage(error),
          })
          throw error
        }

        try {
          const createdMessage = await createMessage(created.id, {
            content: payload.lastMessage,
            sender: isCopilot ? 'ai' : 'client',
            metadata: { source: 'assistant_new_conversation', assistant_mode: assistantMode },
          }, workspaceId)
          updateDiagnostics({
            lastCreateMessageStatus: `OK initial message: ${createdMessage.id}`,
            lastCreatedMessageId: createdMessage.id,
            lastSupabaseError: '',
          })
        } catch (error) {
          updateDiagnostics({
            lastCreateMessageStatus: 'ERROR creando mensaje inicial',
            lastSupabaseError: safeErrorMessage(error),
          })
          throw error
        }
        await createActivity(workspaceId, { type: 'message', description: `Nueva conversación: ${created.clientName}`, clientName: created.clientName })
        await loadConversations()
        setSelectedIds((prev) => ({ ...prev, [assistantMode]: created.id }))
        toast.success('Conversación real creada')
        return
      }

      if (isRealMode && OFFLINE_FORCE_DEV) {
        const localConversation: Conversation = {
          id: createUuid(),
          clientId: `offline-${Date.now()}`,
          clientName: payload.clientName,
          clientAvatar: payload.clientAvatar,
          lastMessage: payload.lastMessage,
          timestamp: new Date().toISOString(),
          unread: true,
          sentiment: payload.sentiment,
          channel: payload.channel,
          intent: payload.intent,
          assistantMode,
          metadata: { ...payload, source: 'offline' },
        }
        setConversationList((prev) => {
          const next = [localConversation, ...prev]
          persistOfflineConversations(next)
          return next
        })
        setLocalMessages((prev) => ({
          ...prev,
          [localConversation.id]: [{ id: `msg-${Date.now()}`, conversationId: localConversation.id, content: payload.lastMessage, sender: isCopilot ? 'ai' : 'client', timestamp: nowTime(), metadata: { assistant_mode: assistantMode } }],
        }))
        setSelectedIds((prev) => ({ ...prev, [assistantMode]: localConversation.id }))
        toast.success('Conversación offline creada')
        return
      }

      if (!currentUser.isDemo && window.localStorage.getItem(DEMO_MODE_KEY) !== 'true') {
        const message = 'No se crea conversación local porque hay sesión real sin workspace resuelto.'
        updateDiagnostics({ lastCreateConversationStatus: 'Bloqueado', lastSupabaseError: message })
        toast.error('Workspace no resuelto', { description: message })
        return
      }

      const localConversation: Conversation = {
        id: `conv-${Date.now()}`,
        clientId: '',
        clientName: payload.clientName,
        clientAvatar: payload.clientAvatar,
        lastMessage: payload.lastMessage,
        timestamp: 'Ahora',
        unread: true,
        sentiment: payload.sentiment,
        channel: payload.channel,
        intent: payload.intent,
        assistantMode,
        metadata: { assistant_mode: assistantMode, source: 'demo' },
      }
      setConversationList((prev) => [localConversation, ...prev])
      setLocalMessages((prev) => ({
        ...prev,
        [localConversation.id]: [{ id: `msg-${Date.now()}`, conversationId: localConversation.id, content: payload.lastMessage, sender: isCopilot ? 'ai' : 'client', timestamp: nowTime(), metadata: { assistant_mode: assistantMode } }],
      }))
      setSelectedIds((prev) => ({ ...prev, [assistantMode]: localConversation.id }))
      toast.success('Conversación demo creada')
    } catch (error) {
      toast.error('No se pudo crear la conversación', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    }
  }

  const runPersistenceTest = async () => {
    if (!isRealMode || !workspaceId) {
      const message = 'No hay workspace real para probar persistencia.'
      updateDiagnostics({
        lastCreateConversationStatus: 'No ejecutado',
        lastCreateMessageStatus: 'No ejecutado',
        lastReadConversationsStatus: 'No ejecutado',
        lastReadMessagesStatus: 'No ejecutado',
        lastSupabaseError: message,
      })
      toast.warning('Prueba no disponible', { description: message })
      return
    }

    const testMessage = `Mensaje test persistencia ${new Date().toISOString()}`
    try {
      const created = await createAssistantConversation(workspaceId, assistantMode, {
        clientName: assistantMode === 'copilot' ? 'Test persistencia Copilot' : 'Test persistencia Inbox',
        clientAvatar: assistantMode === 'copilot' ? 'TC' : 'TI',
        lastMessage: testMessage,
        unread: false,
        metadata: { source: 'assistant_persistence_test', assistant_mode: assistantMode },
      })
      updateDiagnostics({
        lastCreateConversationStatus: `OK conversation: ${created.id}`,
        lastCreatedConversationId: created.id,
        lastSupabaseError: '',
      })

      const createdMessage = await createMessage(created.id, {
        content: testMessage,
        sender: assistantMode === 'copilot' ? 'agent' : 'client',
        metadata: { source: 'assistant_persistence_test', assistant_mode: assistantMode },
      }, workspaceId)
      updateDiagnostics({
        lastCreateMessageStatus: `OK message: ${createdMessage.id}`,
        lastCreatedMessageId: createdMessage.id,
        lastSupabaseError: '',
      })

      const conversationById = await getAssistantConversationById(created.id, workspaceId)
      const conversations = await getAssistantConversations(workspaceId, assistantMode)
      const foundConversation = conversations.some((conversation) => conversation.id === created.id)
      const messages = await getConversationMessages(created.id, workspaceId)
      const foundMessage = messages.some((message) => message.id === createdMessage.id || message.content === testMessage)
      const readByIdOk = conversationById?.id === created.id

      updateDiagnostics({
        lastReadConversationsStatus: readByIdOk && foundConversation ? `OK by id + mode: ${conversations.length}` : `ERROR by id=${String(readByIdOk)} mode=${String(foundConversation)}`,
        lastReadMessagesStatus: foundMessage ? `OK leído: ${messages.length}` : `ERROR: creado ${createdMessage.id}, no leído`,
        totalConversationsForWorkspace: conversations.length,
        filteredConversationsForMode: conversations.length,
        queryMode: `workspace_id=${workspaceId} mode=${assistantMode}`,
        lastSupabaseError: readByIdOk && foundConversation && foundMessage ? '' : 'La escritura funciona parcialmente, pero la lectura por id, modo o mensajes no devuelve lo creado. Revisa RLS/filtros por workspace.',
      })

      setConversationList(conversations)
      setSelectedIds((prev) => ({ ...prev, [assistantMode]: created.id }))
      setLocalMessages((prev) => ({ ...prev, [created.id]: messages }))
      toast.success(foundConversation && foundMessage ? 'Persistencia Supabase OK' : 'Prueba incompleta', {
        description: foundConversation && foundMessage ? 'Conversación y mensaje creados y leídos.' : 'Revisa el panel de diagnóstico.',
      })
    } catch (error) {
      updateDiagnostics({
        lastSupabaseError: safeErrorMessage(error),
      })
      toast.error('Falló la persistencia Supabase', { description: safeErrorMessage(error) })
    }
  }

  const handleQuickAction = async (action: string) => {
    const activeConversation = isRealMode ? await ensureRealConversation() : selected
    if (!activeConversation) {
      toast.info('Crea una conversación primero')
      return
    }
    if (isRealMode && (!workspaceId || !isUuid(activeConversation.id))) {
      const message = !workspaceId
        ? 'No se ha podido resolver el workspace real. Revisa profile.workspace_id.'
        : `Bloqueado quick action con conversation_id temporal: ${activeConversation.id}`
      updateDiagnostics({ lastCreateMessageStatus: 'Bloqueado', lastSupabaseError: message })
      toast.error('No se pudo ejecutar la acción', { description: message })
      return
    }

    if (action === 'Probar n8n') {
      const webhookForTest = assistantWebhookUrl || ASSISTANT_AGENT_WEBHOOK_URL
      const testingMsg: Message = { id: `ai-${Date.now()}`, conversationId: activeConversation.id, content: 'Enviando mensaje de prueba al workflow NowCRM - Assistant Agent vía n8n/OpenAI...', sender: 'ai', timestamp: nowTime() }
      appendLocalMessage(activeConversation.id, testingMsg)
      if (isRealMode && workspaceId && !OFFLINE_FORCE_DEV) await createMessage(activeConversation.id, { content: testingMsg.content, sender: 'ai', metadata: { source: 'assistant_n8n_test', assistant_mode: assistantMode } }, workspaceId)
      if (OFFLINE_FORCE_DEV) {
        setLastResponseSource('fallback')
        toast.warning('Modo offline: n8n no disponible', { description: 'Prueba de webhook ignorada en modo off-line local.' })
        return
      }
      const result = await triggerN8nWebhook('assistant_message', {
        workspace_id: workspaceId ?? undefined,
        webhook_url: webhookForTest,
        source: 'nowcrm',
        mode: workspaceId ? 'real' : 'demo',
        conversation: {
          id: 'test',
          client_name: 'Ana Rodriguez',
          channel: 'WhatsApp',
          sentiment: 'positive',
          intent: 'pricing',
        },
        message: { content: 'Hola, me interesa saber el precio del Plan Pro y que incluye exactamente.' },
        client: { name: 'Ana Rodriguez', status: 'lead' },
        metadata: { source: 'assistant_ui_test', assistant_mode: assistantMode },
        assistant_mode: assistantMode,
      })
      if (result.status === 'ok') {
        setLastResponseSource('n8n')
        if (result.suggested_response) {
          const n8nMsg: Message = { id: `n8n-${Date.now()}`, conversationId: activeConversation.id, content: result.suggested_response, sender: 'ai', timestamp: nowTime() }
          appendLocalMessage(activeConversation.id, n8nMsg)
          if (isRealMode && workspaceId) await createMessage(activeConversation.id, { content: result.suggested_response, sender: 'ai', metadata: { source: 'assistant_n8n_test', assistant_mode: assistantMode } }, workspaceId)
        }
        toast.success('n8n respondió correctamente', { description: result.suggested_response ? 'suggested_response recibido.' : result.message })
      } else {
        setLastResponseSource('fallback')
        toast.warning('n8n no disponible, usando fallback seguro.', { description: result.message })
      }
      return
    }

    const selectedPrompt = activeQuickPrompts.find((item) => item.label === action)
    if (!selectedPrompt) return

    const safeToolsByIntent: Partial<Record<string, AgentToolName>> = {
      resumen: 'get_client_summary',
      next_action: 'get_next_best_actions',
      slot_search: 'list_calendar_events',
      billing: 'list_invoices',
      client_search: 'search_clients',
      calendar: 'list_calendar_events',
    }
    const tool = safeToolsByIntent[selectedPrompt.intent]
    if (!OFFLINE_FORCE_DEV && assistantMode === 'copilot' && tool && workspaceId) {
      const toolInput =
        tool === 'get_client_summary' ? { name: activeConversation.clientName } :
        tool === 'search_clients' ? { query: activeConversation.clientName } :
        {}
      const result = await callAgentTool(tool, workspaceId, toolInput, {
        source: 'assistant_quick_action',
        conversation_id: activeConversation.id,
        user_intent: selectedPrompt.intent,
      }).catch(() => null)
      if (result?.ok) {
        await appendAssistantMessage(activeConversation.id, formatToolResult(tool, result.result), activeConversation.clientName)
        toast.success('Tool consultada', { description: result.message })
        return
      }
    }
    await sendMessage(selectedPrompt.prompt, { sender: selectedPrompt.sender || 'agent' })
  }

  const resolveConversation = async () => {
    if (!selected) return
    try {
      if (isRealMode) {
        if (!workspaceId || !isUuid(selected.id)) {
          throw new Error(!workspaceId ? 'Workspace real no resuelto.' : 'No se puede resolver una conversación temporal en modo real.')
        }
        await updateConversationScoped(selected.id, workspaceId, { status: 'resolved' })
        if (workspaceId) await createActivity(workspaceId, { type: 'message', description: `Conversación resuelta: ${selected.clientName}`, clientName: selected.clientName })
        await loadConversations()
      } else {
        setConversationList((prev) => prev.map((conversation) => conversation.id === selected.id ? { ...conversation, unread: false } : conversation))
      }
      toast.success('Conversación resuelta')
    } catch (error) {
      toast.error('No se pudo resolver', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    }
  }

  const archiveConversation = async () => {
    if (!selected) return
    const confirmed = window.confirm('¿Eliminar permanentemente esta conversación y todos sus mensajes? Esta acción no se puede deshacer.')
    if (!confirmed) return

    try {
      if (isRealMode) {
        if (!workspaceId || !isUuid(selected.id)) {
          throw new Error(!workspaceId ? 'Workspace real no resuelto.' : 'No se puede eliminar una conversación temporal en modo real.')
        }
        await deleteConversationPermanently(selected.id, workspaceId)
        setConversationList((prev) => {
          const next = prev.filter((conversation) => conversation.id !== selected.id)
          const nextSelected = next.find((conversation) => conversation.assistantMode === assistantMode)
          setSelectedIds((current) => ({ ...current, [assistantMode]: nextSelected?.id ?? '' }))
          return next
        })
        setLocalMessages((prev) => {
          const next = { ...prev }
          delete next[selected.id]
          return next
        })
        toast.success('Conversación eliminada definitivamente')
        return
      }

      setConversationList((prev) => prev.filter((conversation) => conversation.id !== selected.id))
      setSelectedIds((prev) => ({ ...prev, [assistantMode]: '' }))
      toast.success('Conversación eliminada de la demo')
    } catch (error) {
      toast.error('No se pudo eliminar', { description: safeErrorMessage(error) })
      updateDiagnostics({ lastSupabaseError: safeErrorMessage(error) })
    }
  }

  if (!assistantReady) {
    return (
      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-5 pb-2"
      >
        <PageHeader
          title="Asistente IA"
          description="Preparando Assistant Agent..."
          action={<Badge variant="indigo" dot>Conectando</Badge>}
        />
        <div className="grid gap-3 lg:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-20 animate-pulse rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white" />
          ))}
        </div>
        <div className="flex min-h-[560px] items-center justify-center rounded-2xl border border-gray-200/70 bg-white shadow-lg shadow-gray-950/[0.045]">
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
            <p className="text-sm font-semibold text-gray-950">Preparando Assistant Agent...</p>
            <p className="mt-1 text-xs leading-5 text-gray-500">Cargando workspace, conversaciones y n8n/OpenAI.</p>
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Asistente IA"
        description="Assistant Agent opera tu CRM: clientes, citas, facturas, cobros y próximas acciones."
        action={
          <div className="flex items-center gap-2">
            <Badge variant={assistantN8nActive ? 'success' : 'warning'} dot>{assistantN8nActive ? 'n8n/OpenAI activo' : 'IA demo'}</Badge>
            <Badge variant={isRealMode ? 'success' : 'indigo'} dot>{isRealMode ? 'Workspace real' : 'Modo demo'}</Badge>
            <Badge variant="indigo" dot>Acciones con confirmación</Badge>
            <Badge variant="warning" dot>WhatsApp siguiente fase</Badge>
            <Button size="sm" onClick={createDemoConversation}>
              <Plus className="h-3.5 w-3.5" />
              {assistantMode === 'inbox' ? (isRealMode ? 'Crear conversación' : 'Crear conversación de ejemplo') : (isRealMode ? 'Crear consulta' : 'Crear consulta de ejemplo')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        {assistantModes.map((mode) => {
          const isActive = assistantMode === mode.id
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                setAssistantMode(mode.id)
                setPreparedAction(null)
                setDetectedIntent('')
              }}
              className={cn(
                'rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
                isActive
                  ? 'border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50 shadow-indigo-950/[0.04]'
                  : 'border-gray-200 bg-white shadow-gray-950/[0.025] hover:border-indigo-100'
              )}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', isActive ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500')}>
                    {mode.id === 'inbox' ? <MessageSquare className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{mode.eyebrow}</p>
                    <p className="text-sm font-bold text-gray-950">{mode.title}</p>
                  </div>
                </div>
                <Badge variant={isActive ? 'indigo' : 'default'}>{mode.badge}</Badge>
              </div>
              <p className="text-xs leading-5 text-gray-600">{mode.description}</p>
            </button>
          )
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {assistantStats.map(({ label, value, detail, icon, tone }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white px-4 py-3 shadow-sm shadow-gray-950/[0.035] transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.04]">
            <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl', tone)}>{icon}</div>
            <div>
              <p className="text-xs text-gray-500">{label}</p>
              <div className="flex items-baseline gap-2">
                <p className="text-lg font-bold text-gray-950">{value}</p>
                <span className="text-[11px] text-gray-400">{detail}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-0 overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-lg shadow-gray-950/[0.045]" style={{ minHeight: 560, height: 'clamp(560px, calc(100vh - 12.75rem), 720px)' }}>
        <aside className="flex w-80 shrink-0 flex-col border-r border-gray-100">
          <div className="border-b border-gray-100 bg-gradient-to-b from-white to-gray-50/70 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input type="text" value={convSearch} onChange={(e) => setConvSearch(e.target.value)} placeholder="Buscar conversación..." className="h-8 w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {loadingConversations && [1, 2, 3].map((item) => <li key={item} className="m-3 h-20 animate-pulse rounded-xl bg-gray-100" />)}
            {!loadingConversations && filteredConvs.map((conv) => {
              const isActive = conv.id === activeSelectedId
              return (
                <li key={conv.id}>
                  <button onClick={() => setSelectedIds((prev) => ({ ...prev, [assistantMode]: conv.id }))} className={cn('flex w-full items-start gap-3 border-b border-gray-50 p-3.5 text-left transition-colors', isActive ? 'bg-indigo-50/80' : 'hover:bg-gray-50')}>
                    <div className="relative shrink-0">
                      <div className={cn('flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold', isActive ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600')}>
                        {conv.clientAvatar || getInitials(conv.clientName)}
                      </div>
                      {conv.unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className={cn('truncate text-xs font-semibold', isActive ? 'text-indigo-700' : 'text-gray-900')}>{conv.clientName}</span>
                        <span className="shrink-0 text-[10px] text-gray-400">{conv.timestamp}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-gray-500">{conv.lastMessage}</p>
                      <div className="mt-1 flex items-center gap-1">
                        <Badge variant={channelVariant[conv.channel]} className="px-1.5 py-0 text-[10px]">{conv.channel}</Badge>
                        <Badge variant={sentimentConfig[conv.sentiment].variant} className="px-1.5 py-0 text-[10px]">{sentimentConfig[conv.sentiment].label}</Badge>
                        <Badge variant={conv.assistantMode === 'copilot' ? 'indigo' : 'warning'} className="px-1.5 py-0 text-[10px]">{conv.assistantMode === 'copilot' ? 'Copilot' : 'Inbox'}</Badge>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
            {!loadingConversations && filteredConvs.length === 0 && (
              <li className="p-5 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-gray-800">{assistantMode === 'inbox' ? 'Sin conversaciones' : 'Sin consultas'}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {assistantMode === 'inbox'
                    ? 'Crea una conversación para empezar.'
                    : 'Abre una consulta para operar tu CRM.'}
                </p>
              </li>
            )}
          </ul>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-b from-white to-gray-50/70 px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">{selected.clientAvatar || getInitials(selected.clientName)}</div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{selected.clientName}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant={channelVariant[selected.channel]} className="text-[10px]">{selected.channel}</Badge>
                      {selected.intent && <span className="text-[10px] text-gray-400">· {selected.intent}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => handleQuickAction(assistantMode === 'inbox' ? 'Preparar cita' : 'Crear cita')} aria-label="Preparar cita"><Phone className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => handleQuickAction(assistantMode === 'inbox' ? 'Siguiente respuesta' : 'Preparar propuesta')} aria-label={assistantMode === 'inbox' ? 'Siguiente respuesta' : 'Preparar propuesta'}><Mail className="h-3.5 w-3.5" /></Button>
                  <Button variant="secondary" size="sm" onClick={resolveConversation}>
                    <CheckCircle className="h-3.5 w-3.5" />
                    Resolver
                  </Button>
                  <Button variant="ghost" size="sm" onClick={archiveConversation} aria-label="Eliminar conversación">
                    <X className="h-3.5 w-3.5" />
                    Eliminar
                  </Button>
                </div>
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto p-5 pb-8">
                {loadingMessages && <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin text-indigo-500" />Cargando mensajes...</div>}
                {!loadingMessages && msgs.map((msg) => {
                  const isUser = msg.sender !== 'ai'
                  const isAI = msg.sender === 'ai'
                  const label = isAI ? 'Assistant Agent' : 'Tú'
                  return (
                    <div key={msg.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[80%]', isUser ? 'items-end' : 'items-start')}>
                        <div className={cn('mb-1 flex items-center gap-1.5', isUser ? 'justify-end text-slate-500' : isAI ? 'text-indigo-600' : 'text-gray-500')}>
                          {isAI && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-50"><Bot className="h-2.5 w-2.5" /></span>}
                          <span className="text-[10px] font-semibold">{label}</span>
                        </div>
                        <div className={cn(
                          'whitespace-pre-wrap rounded-2xl px-4 py-3.5 text-sm leading-6 shadow-sm',
                          isUser && 'rounded-tr-sm bg-slate-900 text-white shadow-slate-950/15',
                          isAI && 'rounded-tl-sm border border-indigo-100 bg-gradient-to-br from-white via-indigo-50 to-violet-50 text-gray-900 shadow-indigo-950/[0.045]'
                        )}>
                          {msg.content}
                        </div>
                        <p className={cn('mt-1 text-[9px] text-gray-400', isUser ? 'text-right' : 'text-left')}>{msg.timestamp}</p>
                      </div>
                    </div>
                  )
                })}
                {preparedAction && (
                  <div className="flex justify-start">
                    <div className="max-w-[72%] rounded-2xl rounded-tl-sm border border-violet-100 bg-gradient-to-br from-white via-violet-50 to-indigo-50 p-4 shadow-md shadow-indigo-950/[0.05]">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm shadow-violet-600/20">
                            {preparedAction.type === 'booking' ? <CalendarDays className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                          </div>
                        <div>
                          <p className="text-sm font-bold text-gray-950">Acción preparada: {preparedAction.type === 'booking' ? 'crear cita' : 'crear factura'}</p>
                          <p className="text-[11px] text-gray-500">{preparedAction.title} · {preparedAction.assistantMode === 'inbox' ? 'Inbox Assistant' : 'Copilot CRM'}</p>
                        </div>
                        </div>
                        <Badge variant="warning" dot>Requiere confirmación</Badge>
                      </div>

                      <div className="grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
                        <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                          <span className="block text-[10px] font-semibold uppercase text-gray-400">Cliente</span>
                          {preparedAction.clientName ?? 'Pendiente'}
                        </div>
                        {preparedAction.type === 'booking' ? (
                          <>
                            <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                              <span className="block text-[10px] font-semibold uppercase text-gray-400">Servicio</span>
                              {preparedAction.service ?? 'Pendiente'}
                            </div>
                            <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                              <span className="block text-[10px] font-semibold uppercase text-gray-400">Fecha y hora</span>
                              {preparedAction.date ?? 'Fecha pendiente'} · {preparedAction.time ?? 'hora pendiente'}
                            </div>
                            <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                              <span className="block text-[10px] font-semibold uppercase text-gray-400">Duración</span>
                              {preparedAction.duration ? `${preparedAction.duration} min` : 'Pendiente'}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                              <span className="block text-[10px] font-semibold uppercase text-gray-400">Concepto</span>
                              {preparedAction.concept ?? 'Pendiente'}
                            </div>
                            <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                              <span className="block text-[10px] font-semibold uppercase text-gray-400">Importe</span>
                              {preparedAction.amount ? `${preparedAction.amount.toLocaleString('es-ES')} EUR` : 'Pendiente'}
                            </div>
                            <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                              <span className="block text-[10px] font-semibold uppercase text-gray-400">Vencimiento</span>
                              {preparedAction.dueDate ?? 'Pendiente'}
                            </div>
                          </>
                        )}
                      </div>

                      {preparedAction.missingFields.length > 0 && (
                        <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs font-medium text-amber-700">
                          Faltan datos: {missingText(preparedAction.missingFields)}. Escríbelos en el chat para completar la acción.
                        </p>
                      )}
                      {preparedAction.notes && <p className="mt-2 rounded-lg bg-white/70 p-2 text-xs leading-5 text-gray-500">{preparedAction.notes}</p>}

                      <div className="mt-3 flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={cancelPreparedAction} disabled={confirmingAction}>
                          <X className="h-3.5 w-3.5" />
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={() => void confirmPreparedAction()} loading={confirmingAction} disabled={preparedAction.missingFields.length > 0}>
                          <CheckCircle className="h-3.5 w-3.5" />
                          {preparedAction.missingFields.length ? 'Faltan datos' : preparedAction.type === 'booking' ? 'Confirmar cita' : 'Confirmar factura'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-indigo-100 bg-indigo-50 px-4 py-2.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
                      <span className="text-xs text-indigo-600">{assistantN8nActive ? 'n8n/OpenAI pensando...' : 'IA generando respuesta...'}</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="border-t border-gray-100 bg-gray-50/50 p-4">
                {detectedIntent && (
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                    <Zap className="h-3 w-3" />
                    {detectedIntent}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={assistantMode === 'inbox' ? 'Escribe tu mensaje...' : 'Pide a Copilot que opere tu CRM...'} rows={1} className="max-h-28 flex-1 resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder:text-gray-400 shadow-sm shadow-gray-950/[0.025] transition-all focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() } }} />
                  <Button size="sm" className="h-10 w-10 shrink-0 p-0" onClick={() => void sendMessage()} disabled={isTyping || !input.trim()} loading={isTyping} aria-label="Enviar mensaje">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-gray-400">Acciones rápidas:</span>
                  {activeQuickPrompts.map(({ label }) => (
                    <button key={label} onClick={() => void handleQuickAction(label)} disabled={isTyping} className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 transition-colors hover:bg-indigo-100 hover:text-indigo-700 disabled:opacity-50">
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                  <Bot className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-gray-900">
                  {assistantMode === 'inbox' ? 'No hay conversaciones todavía' : 'No hay consultas internas todavía'}
                </p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-gray-400">
                  {assistantMode === 'inbox'
                    ? 'Crea una conversación para probar el Assistant. Cuando conectes WhatsApp/Whapi, los mensajes reales aparecerán aquí.'
                    : 'Abre una consulta interna para que Copilot opere tu CRM: clientes, calendario, facturas, cobros y próximas acciones.'}
                </p>
                <div className="mx-auto mt-3 grid max-w-sm gap-1.5 text-left">
                  {capabilityExamples.slice(0, 4).map((example) => (
                    <span key={example} className="rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">{example}</span>
                  ))}
                </div>
                <Button className="mt-4" size="sm" onClick={createDemoConversation}><Plus className="h-3.5 w-3.5" />{assistantMode === 'inbox' ? (isRealMode ? 'Crear conversación' : 'Crear conversación de ejemplo') : (isRealMode ? 'Crear consulta' : 'Crear consulta de ejemplo')}</Button>
              </div>
            </div>
          )}
        </div>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-indigo-100 bg-[linear-gradient(180deg,#eef2ff_0%,#ffffff_44%,#f5f3ff_100%)]">
          <div className="border-b border-indigo-100 bg-gradient-to-r from-indigo-600 to-violet-700 px-4 py-3.5 text-white shadow-sm shadow-indigo-950/10">
            <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-indigo-100" /><h3 className="text-sm font-semibold">Assistant Agent</h3></div>
          </div>
          <div className="space-y-4 p-4">
            {selected && (
              <>
                <div className="rounded-2xl border border-white bg-white/85 p-3 shadow-sm shadow-indigo-950/[0.04] ring-1 ring-indigo-100/60">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-700 text-sm font-bold text-white shadow-sm shadow-indigo-600/20">{selected.clientAvatar || getInitials(selected.clientName)}</div>
                    <div><p className="text-sm font-semibold text-gray-950">{selected.clientName}</p><p className="text-[10px] text-gray-500">{selected.channel} · {selected.intent ?? 'Conversación activa'}</p></div>
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/70 to-indigo-50 p-3.5 shadow-sm shadow-emerald-950/[0.035]">
                  <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-gray-600">{assistantMode === 'inbox' ? 'Lead Score' : 'Estado operativo'}</span><Target className="h-3.5 w-3.5 text-gray-400" /></div>
                  <div className="flex items-end gap-1"><span className={cn('text-2xl font-bold', assistantMode === 'inbox' ? leadScoreColor(score) : 'text-emerald-600')}>{assistantMode === 'inbox' ? score : preparedAction ? 'Listo' : 'OK'}</span>{assistantMode === 'inbox' && <span className="mb-0.5 text-xs text-gray-400">/100</span>}</div>
                  {assistantMode === 'inbox' ? (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200"><div className={cn('h-full rounded-full', score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${score}%` }} /></div>
                  ) : (
                    <p className="mt-2 text-[10px] leading-4 text-emerald-700">Tools y confirmaciones preparadas para operar Supabase sin ejecutar escrituras peligrosas.</p>
                  )}
                </div>

                <div className="rounded-2xl border border-gray-100 bg-white/85 p-3 shadow-sm shadow-gray-950/[0.025]">
                  <p className="mb-2 text-[10px] font-semibold uppercase text-gray-400">Sentimiento</p>
                  <Badge variant={sentimentConfig[selected.sentiment].variant} dot className="text-xs">{sentimentConfig[selected.sentiment].label}</Badge>
                </div>
              </>
            )}

            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
              <p className="mb-1 text-[10px] font-semibold text-emerald-700">Estado técnico</p>
              <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /><span className="text-[10px] text-emerald-700">{assistantN8nActive ? 'Assistant Agent conectado' : isRealMode ? 'Workspace real · webhook pendiente' : 'Mock data · IA simulada'}</span></div>
              <p className="mt-1 text-[10px] text-emerald-600">{assistantN8nActive ? 'Workflow: NowCRM - Assistant Agent.' : isRealMode ? 'No hay webhook activo detectado para este workspace.' : 'Siguiente paso: activar Assistant Agent en Settings.'}</p>
              <p className="mt-1 text-[10px] text-emerald-600">Calendar tools preparadas.</p>
              <p className="mt-1 text-[10px] text-emerald-600">Confirmación requerida para escrituras.</p>
              <p className="mt-1 text-[10px] text-emerald-600">Fallback seguro disponible.</p>
              {lastResponseSource === 'n8n' && <p className="mt-1 rounded-lg bg-white/75 px-2 py-1 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-100">Última respuesta por n8n/OpenAI</p>}
              {lastActionStatus && <p className="mt-1 rounded-lg bg-white/75 px-2 py-1 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-100">{lastActionStatus}</p>}
              {lastResponseSource === 'fallback' && <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100">Última respuesta por fallback</p>}
              {lastResponseSource === 'supabase' && <p className="mt-1 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 ring-1 ring-blue-100">Última respuesta por Supabase</p>}
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-white/85 p-3 shadow-sm shadow-indigo-950/[0.035] ring-1 ring-indigo-100/50">
              <p className="mb-2 text-[10px] font-semibold uppercase text-gray-400">{assistantMode === 'copilot' ? 'NowLabs AI' : 'Inbox Assistant'}</p>
              <div className="flex flex-wrap gap-1.5">
                {(assistantMode === 'copilot' ? capabilities : inboxCapabilities).map((capability) => (
                  <span key={capability} className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-100">{capability}</span>
                ))}
              </div>
              {assistantMode === 'copilot' ? (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase text-gray-400">Puedes pedirme</p>
                  {capabilityExamples.map((example) => (
                    <p key={example} className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-[11px] font-medium text-gray-700">{example}</p>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-[11px] leading-5 text-violet-800">
                  Inbox Assistant es la capa para conversaciones de clientes. Ahora trabaja sobre mensajes persistentes; cuando conectes WhatsApp/Whapi, los mensajes entrantes caerán aquí.
                </p>
              )}
              <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-medium leading-5 text-amber-800">
                Las acciones importantes requieren confirmación antes de guardarse.
              </p>
              <p className="mt-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-[11px] leading-5 text-violet-800">
                WhatsApp/Whapi será la siguiente fase: permitirá recibir mensajes reales y convertirlos en clientes, citas o seguimientos dentro de NowCRM.
              </p>
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-white/85 p-3 shadow-sm shadow-indigo-950/[0.035] ring-1 ring-indigo-100/50">
              <p className="mb-2 text-[10px] font-semibold uppercase text-gray-400">Recomendación IA</p>
              <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-3">
                <p className="text-xs leading-relaxed text-indigo-800">
                  {assistantMode === 'inbox'
                    ? selected ? selected.sentiment === 'positive' ? 'Cliente con buena intención. Propón siguiente paso y prepara cita o seguimiento.' : selected.sentiment === 'negative' ? 'Prioriza tono empático y escala la conversación antes de automatizar.' : 'Responde con contexto y pide el dato mínimo para avanzar.' : 'Crea una conversación para simular mensajes entrantes de clientes.'
                    : selected ? 'Usa Copilot para consultar datos reales, preparar acciones y confirmar antes de escribir en Supabase.' : 'Crea una consulta para operar clientes, facturas, calendario y cobros desde el CRM.'}
                </p>
                <button className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700" onClick={() => selected ? void handleQuickAction(assistantMode === 'inbox' ? 'Siguiente respuesta' : 'Próxima acción') : toast.info('Crea una conversación primero')}>
                  Aplicar <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {SHOW_ASSISTANT_DEBUG && process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-4 left-4 z-50 max-w-sm rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] shadow-lg shadow-amber-950/10">
          <p className="mb-1.5 font-bold text-amber-900">Debug (dev only)</p>
          <p className="text-amber-700">email: {currentUser.email}</p>
          <p className="text-amber-700">session.user.id: {diagnostics.sessionUserId || 'null'}</p>
          <p className="text-amber-700">session.user.email: {diagnostics.sessionEmail || 'null'}</p>
          <p className="text-amber-700">profile.id: {diagnostics.profileId || 'null'}</p>
          <p className="text-amber-700">profile.workspace_id: {diagnostics.profileWorkspaceId || 'null'}</p>
          <p className="text-amber-700">workspace.id: {diagnostics.workspaceDebugId || 'null'}</p>
          <p className="text-amber-700">resolvedWorkspaceId: {diagnostics.resolvedWorkspaceId || 'null'}</p>
          <p className="text-amber-700">workspaceId: {workspaceId ?? 'null'}</p>
          <p className="text-amber-700">isDemo: {String(currentUser.isDemo)}</p>
          <p className="text-amber-700">isRealMode: {String(isRealMode)}</p>
          <p className="text-amber-700">activeAssistantMode: {assistantMode}</p>
          <p className="text-amber-700">selectedConversationId: {activeSelectedId || 'null'}</p>
          <p className="text-amber-700">selectedConversationIsUuid: {String(selectedConversationIsUuid)}</p>
          <p className="text-amber-700">totalConversationsForWorkspace: {diagnostics.totalConversationsForWorkspace || conversationList.length}</p>
          <p className="text-amber-700">filteredConversationsForMode: {modeConversations.length}</p>
          <p className="text-amber-700">messages count: {msgs.length}</p>
          <p className="text-amber-700">queryMode: {isRealMode ? `workspace_id=${(workspaceId ?? diagnostics.resolvedWorkspaceId) || 'null'} mode=${assistantMode}` : (diagnostics.queryMode || (currentUser.isDemo ? 'demo' : 'not-real'))}</p>
          <p className="text-amber-700">lastCreatedConversationId: {diagnostics.lastCreatedConversationId || 'none'}</p>
          <p className="text-amber-700">lastCreatedMessageId: {diagnostics.lastCreatedMessageId || 'none'}</p>
          <p className="text-amber-700">assistantFlow found: {assistantFlowFound ? 'true' : 'false'}</p>
          <p className="text-amber-700">assistantFlow status: {assistantFlowStatus}</p>
          <p className="text-amber-700">webhookUrl exists: {assistantWebhookUrl ? 'true' : 'false'}</p>
          <p className="mt-1 text-amber-700">createConversation: {diagnostics.lastCreateConversationStatus}</p>
          <p className="text-amber-700">createMessage: {diagnostics.lastCreateMessageStatus}</p>
          <p className="text-amber-700">readConversations: {diagnostics.lastReadConversationsStatus}</p>
          <p className="text-amber-700">readMessages: {diagnostics.lastReadMessagesStatus}</p>
          {diagnostics.lastSupabaseError && <p className="mt-1 break-words rounded-lg bg-white/70 p-2 text-amber-900">Supabase: {diagnostics.lastSupabaseError}</p>}
          <button
            type="button"
            onClick={() => void runPersistenceTest()}
            className="mt-2 rounded-lg bg-amber-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-amber-700"
          >
            Probar persistencia Supabase
          </button>
        </div>
      )}
    </motion.div>
  )
}
