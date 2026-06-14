'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Bot, CalendarDays, CheckCircle, FileText, Loader2, Mail, MessageSquare, Pencil, Phone, Plus, Search, Send, Target, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { conversations as mockConversations, messages as mockMessages } from '@/lib/mock-data'
import { callAgentTool, getAssistantAgentFlow, triggerN8nWebhook, type AgentToolName } from '@/lib/integrations'
import { DEMO_MODE_KEY, useCurrentUser } from '@/lib/current-user'
import { detectAssistantIntent, respondWithAssistant, type AssistantIntent } from '@/lib/ai'
import { generateReportPdfBytes, generateInvoicePdfBytes } from '@/lib/pdf/simple-pdf'
import {
  createActivity,
  updateCalendarEvent,
  createAssistantConversation,
  createMessage,
  createAgentActionLog,
  deleteConversationPermanently,
  getAssistantConversationById,
  getAssistantConversations,
  getConversationMessages,
  getInboxAgentSettings,
  getN8nFlows,
  getResolvedWorkspaceContext,
  getSignedDocumentUrl,
  getWhatsappConnection,
  saveGeneratedDocument,
  updateConversationScoped,
  updateConversationTitle,
} from '@/lib/supabase-queries'
import type { AssistantMode, Channel, Conversation, ConversationSentiment, Message, MessageSender, N8nFlowStatus } from '@/lib/types'

const SHOW_ASSISTANT_DEBUG = process.env.NEXT_PUBLIC_SHOW_DEBUG_PANEL === 'true'
const OFFLINE_FORCE_DEV = process.env.NEXT_PUBLIC_FORCE_OFFLINE_DEV === 'true'

const OFFLINE_WORKSPACE_ID = 'offline-workspace'
const OFFLINE_USER_ID = 'offline-user'
const OFFLINE_USER_EMAIL = 'local@crm-demo.local'
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
    clientName: mode === 'copilot' ? 'Consulta Asistente IA' : 'Nuevo cliente',
    clientAvatar: '',
    lastMessage: mode === 'copilot' ? 'Nueva consulta interna' : 'Nuevo mensaje de cliente',
    timestamp: new Date().toISOString(),
    unread: true,
    sentiment: 'neutral',
    channel: mode === 'inbox' ? 'whatsapp' : 'web',
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
  whatsapp: 'success',
  instagram: 'purple',
  web: 'info',
  email: 'indigo',
  crm: 'indigo',
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
    { label: 'Resumen CRM', prompt: 'Dame el resumen del CRM: clientes activos, facturas pendientes y próximas citas.', intent: 'crm_summary', sender: 'agent' },
  ],
  copilot: [
    { label: 'Cómo va todo', prompt: '¿Cómo va todo? Dame un resumen general del workspace.', intent: 'workspace_overview', sender: 'agent' },
    { label: 'Qué tengo pendiente', prompt: '¿Qué tengo pendiente ahora mismo? Consolida todo lo urgente.', intent: 'pending_items', sender: 'agent' },
    { label: 'Estado del inbox', prompt: '¿Cómo va el inbox? Resume conversaciones abiertas por canal.', intent: 'inbox_status', sender: 'agent' },
    { label: 'Buscar cliente', prompt: 'Ayúdame a localizar un cliente por nombre, email o empresa.', intent: 'client_search', sender: 'agent' },
    { label: 'Resumen cliente', prompt: 'Resume este cliente y dime la siguiente acción comercial recomendada.', intent: 'resumen', sender: 'agent' },
    { label: 'Crear cita', prompt: 'Quiero crear una cita. Pídeme cliente, servicio, día, hora y duración si falta algo.', intent: 'booking', sender: 'agent' },
    { label: 'Crear factura', prompt: 'Quiero crear una factura. Pídeme cliente, importe, concepto y vencimiento si falta algo.', intent: 'invoice', sender: 'agent' },
    { label: 'Revisar cobros', prompt: 'Revisa facturas pendientes o vencidas y dime qué seguimiento harías.', intent: 'billing', sender: 'agent' },
    { label: 'Plan del día', prompt: 'Dime qué debería hacer hoy: prioridades de clientes, cobros y citas.', intent: 'daily_plan', sender: 'agent' },
  ],
}

const capabilities = ['Clientes', 'Citas', 'Facturas', 'Cobros', 'Próximas acciones', 'Respuestas comerciales', 'Plan del día']
const inboxCapabilities = ['Mensajes cliente/lead', 'Intención', 'Sentimiento', 'Reservas desde conversación', 'WhatsApp Business próximo']
const inboxManualPrompts: Array<{ label: string; prompt: string; intent: string; sender?: MessageSender }> = [
  { label: 'Estado conexion', prompt: 'Estado de conexion Inbox Assistant', intent: 'manual_status', sender: 'agent' },
  { label: 'Modo manual', prompt: 'Modo manual Inbox Assistant', intent: 'manual_mode', sender: 'agent' },
  { label: 'Pendiente Meta API', prompt: 'Pendiente de conectar Meta API', intent: 'pending_connection', sender: 'agent' },
]
const INBOX_MANUAL_RESPONSE = 'Inbox Assistant está preparado para conectar WhatsApp Business (Meta Cloud API). De momento la respuesta automática está desactivada; puedes seguir usando esta bandeja en modo manual.'

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
    badge: 'Meta API próximo',
  },
  {
    id: 'copilot',
    title: 'Copiloto del CRM',
    eyebrow: 'Asistente interno',
    description: 'Opera el CRM para buscar clientes, preparar citas, facturas, propuestas y documentos.',
    badge: 'Listo',
  },
]

type PreparedAction =
  | {
      id: string
      type: 'booking'
      title: string
      assistantMode: AssistantMode
      clientId?: string
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
      clientId?: string
      clientName?: string
      concept?: string
      amount?: number
      dueDate?: string
      missingFields: string[]
      notes?: string
    }
  | {
      id: string
      type: 'task'
      title: string
      assistantMode: AssistantMode
      clientId?: string
      clientName?: string
      taskTitle?: string
      description?: string
      dueDate?: string
      missingFields: string[]
    }
  | {
      id: string
      type: 'prepare_pdf'
      title: string
      assistantMode: AssistantMode
      clientName?: string
      clientId?: string
      reportText?: string
      missingFields: string[]
    }
  | {
      id: string
      type: 'generate_invoice_pdf'
      title: string
      assistantMode: AssistantMode
      invoiceId?: string
      invoiceNumber?: string
      clientName?: string
      amount?: number
      currency?: string
      invoiceText?: string
      missingFields: string[]
    }
  | {
      id: string
      type: 'cancel_booking'
      title: string
      assistantMode: AssistantMode
      eventId?: string
      clientId?: string
      clientName?: string
      date?: string
      time?: string
      reason?: string
      missingFields: string[]
    }
  | {
      id: string
      type: 'reschedule_booking'
      title: string
      assistantMode: AssistantMode
      eventId?: string
      clientId?: string
      clientName?: string
      date?: string
      time?: string
      duration?: number
      oldDate?: string
      oldTime?: string
      missingFields: string[]
    }
  | {
      id: string
      type: 'cancel_multiple_bookings'
      title: string
      assistantMode: AssistantMode
      events: Array<{ eventId: string; clientName?: string; date?: string; time?: string; title?: string }>
      reason?: string
      missingFields: string[]
    }
  | {
      id: string
      type: 'cleanup_duplicate_bookings'
      title: string
      assistantMode: AssistantMode
      events: Array<{ eventId: string; clientName?: string; date?: string; time?: string; title?: string }>
      keepEventId?: string
      cancelEventIds: string[]
      missingFields: string[]
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

type CancelRouteResult = {
  ok: boolean
  localCancelled: boolean
  googleCancelled: boolean
  googleAlreadyGone: boolean
  reason: string
  message: string
}

// Unified cancellation: the cancel-event route handles Google DELETE + local soft-cancel
// atomically. NEVER call cancelCalendarEvent before this — the old order deleted the row
// locally first, leaving Google with the orphaned event.
async function cancelEventAtomically(localEventId: string): Promise<CancelRouteResult> {
  try {
    const res = await fetch('/api/integrations/google/calendar/cancel-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localEventId }),
    })
    const data = await res.json().catch(() => ({})) as Partial<CancelRouteResult>
    return {
      ok: Boolean(data.ok),
      localCancelled: Boolean(data.localCancelled),
      googleCancelled: Boolean(data.googleCancelled),
      googleAlreadyGone: Boolean(data.googleAlreadyGone),
      reason: typeof data.reason === 'string' ? data.reason : 'unknown',
      message: typeof data.message === 'string' ? data.message : '',
    }
  } catch {
    return { ok: false, localCancelled: false, googleCancelled: false, googleAlreadyGone: false, reason: 'network_error', message: '' }
  }
}

function getInitials(name: string) {
  return name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || 'NC'
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
    return 'Soy el Asistente IA del Inbox. Puedo ayudarte a responder a clientes, detectar intención, resumir mensajes y preparar citas o facturas con confirmación. La conexión con WhatsApp Business llegará en la siguiente fase.'
  }

  return 'Soy el Asistente IA del CRM. Puedo ayudarte a buscar clientes, preparar citas en el calendario, crear facturas con confirmación, revisar cobros y proponerte la siguiente acción comercial. Por ejemplo: "Reserva a Ana mañana a las 10 para una visita" o "Crea una factura a Ana de 299 € por gestión de NIE".'
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

type ConfirmErrorCopy = {
  // Toast title — short, recognisable.
  title: string
  // Toast description — actionable next step the user can actually do.
  description: string
  // Toast level. Validation/UX problems → warning, hard server failures → error.
  level: 'warning' | 'error'
}

// Maps the small set of error codes /api/assistant/confirm can return to
// user-facing copy. We never surface raw JSON or Supabase strings to the user.
// `ambiguous_client` is handled separately by the call site because it also
// needs to render a candidates list.
function friendlyConfirmError(code: string | undefined): ConfirmErrorCopy {
  switch (code) {
    case 'client_required':
      return {
        title: 'Falta el cliente',
        description: 'Dime para qué cliente es esta acción antes de confirmar.',
        level: 'warning',
      }
    case 'client_not_found':
      return {
        title: 'No encuentro a ese cliente',
        description: 'Revisa el nombre o búscalo en Clientes y vuelve a confirmar.',
        level: 'warning',
      }
    case 'client_not_in_workspace':
      return {
        title: 'Cliente no pertenece a tu workspace',
        description: 'Busca al cliente correcto antes de confirmar.',
        level: 'error',
      }
    case 'invalid_client_id':
      return {
        title: 'Identificador de cliente inválido',
        description: 'Selecciona el cliente desde la lista y vuelve a confirmar.',
        level: 'error',
      }
    case 'client_lookup_failed':
      return {
        title: 'No pude buscar al cliente',
        description: 'Hubo un problema temporal. Inténtalo de nuevo en unos segundos.',
        level: 'error',
      }
    case 'booking_invalid_date':
      return {
        title: 'Esa fecha no existe',
        description: 'Usa formato AAAA-MM-DD, por ejemplo 2026-06-10.',
        level: 'warning',
      }
    case 'booking_invalid_time':
      return {
        title: 'Hora inválida',
        description: 'Usa formato HH:MM en 24 horas, por ejemplo 10:30.',
        level: 'warning',
      }
    case 'task_invalid_due_date':
      return {
        title: 'Fecha de vencimiento inválida',
        description: 'La tarea necesita una fecha real (AAAA-MM-DD). Ejemplo: 2026-06-10.',
        level: 'warning',
      }
    case 'invoice_invalid_due_date':
      return {
        title: 'Vencimiento de factura inválido',
        description: 'Usa una fecha real en formato AAAA-MM-DD, por ejemplo 2026-06-24.',
        level: 'warning',
      }
    case 'invoice_invalid_amount':
      return {
        title: 'Importe no válido',
        description: 'El importe debe ser mayor que 0 y con un máximo de 2 decimales.',
        level: 'warning',
      }
    case 'task_create_failed':
      return {
        title: 'No se pudo guardar la tarea',
        description: 'Inténtalo de nuevo. Si vuelve a fallar, avísanos.',
        level: 'error',
      }
    case 'booking_create_failed':
      return {
        title: 'No se pudo crear la cita',
        description: 'Inténtalo de nuevo. Si vuelve a fallar, avísanos.',
        level: 'error',
      }
    case 'invoice_create_failed':
      return {
        title: 'No se pudo crear la factura',
        description: 'Inténtalo de nuevo. Si vuelve a fallar, avísanos.',
        level: 'error',
      }
    case 'report_log_failed':
      return {
        title: 'No se pudo registrar el informe',
        description: 'Inténtalo de nuevo en unos segundos.',
        level: 'error',
      }
    default:
      return {
        title: 'No se pudo confirmar la acción',
        description: 'Inténtalo de nuevo en unos segundos.',
        level: 'error',
      }
  }
}

type ConfirmCandidate = { id: string; name: string; company: string | null }

// Renders the candidates list /api/assistant/confirm returns on
// `ambiguous_client`. The chat layer uses this so the user can pick one by
// name in their next message.
function formatAmbiguousCandidates(candidates: ConfirmCandidate[]): string {
  const lines = candidates.slice(0, 5).map((c, idx) => {
    const company = c.company?.trim() ? ` — ${c.company.trim()}` : ''
    return `${idx + 1}. ${c.name || 'Sin nombre'}${company}`
  })
  return `He encontrado varios clientes con ese nombre. Dime cuál es:\n${lines.join('\n')}\n\nResponde con el número o el nombre completo.`
}

function buildPreparedAction(intent: AssistantIntent, mode: AssistantMode): PreparedAction | null {
  const { extracted } = intent

  if ((intent.intent === 'booking' || intent.intent === 'booking_concrete') && (extracted.clientName || extracted.date || extracted.time || extracted.service)) {
    return {
      id: `booking-${Date.now()}`,
      type: 'booking',
      title: 'Crear cita',
      assistantMode: mode,
      clientName: extracted.clientName,
      service: extracted.service || 'Reunion comercial',
      date: extracted.date,
      time: extracted.time,
      duration: extracted.duration ?? 60,
      missingFields: [
        !extracted.clientName && 'cliente',
        !extracted.date && 'fecha',
        !extracted.time && 'hora',
      ].filter(Boolean) as string[],
      notes: 'Cita preparada desde el Asistente IA. Requiere confirmación.',
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
      notes: 'Factura preparada desde el Asistente IA. Requiere confirmación.',
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
      ? 'Como Inbox Assistant, puedo ayudarte a convertir esa conversación en una respuesta clara, detectar intención y preparar una cita o seguimiento con confirmación. Si quieres que los mensajes entren desde WhatsApp real, la siguiente fase es WhatsApp Business (Meta Cloud API).'
      : 'Como Asistente IA del CRM, puedo ayudarte a convertir esa necesidad en tareas internas: clientes, citas, cobros, propuestas y seguimiento. Si quieres que los mensajes entren solos al CRM desde WhatsApp o llamadas, eso llegará en la siguiente fase con integración oficial.'
  }

  if (intent.intent === 'booking_strategy') {
    return 'Sí, tiene mucho sentido para un negocio con citas. El Assistant puede recoger nombre, servicio, día, hora y duración, preparar la cita y guardarla en calendario con confirmación. Para montarlo bien, dime si quieres que esas reservas entren por WhatsApp Business, web o llamadas.'
  }

  if (intent.intent === 'invoice_general') {
    return 'Puedo ayudarte a preparar facturas, revisar pendientes y generar seguimientos de cobro. Para crear una factura real necesito cliente, importe, concepto y vencimiento, y siempre pediré confirmación antes de guardarla.'
  }

  if (intent.intent === 'document_request') {
    return 'La parte de documentos/PDFs está preparada como siguiente fase. Ahora puedo ayudarte a preparar el contenido de una propuesta o factura; la generación y adjuntos reales quedarán conectados cuando actives documentos.'
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
        !next.date && 'fecha',
        !next.time && 'hora',
      ].filter(Boolean) as string[],
    }
  }

  if (action.type === 'invoice') {
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
  return action
}

function parseIsoDate(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const parts = raw.split('/')
  if (parts.length === 2) {
    const year = new Date().getFullYear()
    return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  }
  if (parts.length === 3) {
    const [d, m, y] = parts
    const year = y.length === 2 ? `20${y}` : y
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

function parseRelativeDate(keyword: string): string | null {
  const k = keyword.trim().toLowerCase()
  const today = new Date()
  const pad = (v: number) => String(v).padStart(2, '0')
  const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (k === 'manana') { const d = new Date(today); d.setDate(today.getDate() + 1); return toIso(d) }
  if (k === 'pasado manana') { const d = new Date(today); d.setDate(today.getDate() + 2); return toIso(d) }
  const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  const idx = days.indexOf(k)
  if (idx >= 0) {
    const d = new Date(today)
    let delta = idx - today.getDay()
    if (delta <= 0) delta += 7
    d.setDate(today.getDate() + delta)
    return toIso(d)
  }
  return null
}

function applyActionEdit(action: PreparedAction, text: string): PreparedAction | null {
  const n = normalizeInput(text)
  let changed = false

  if (action.type === 'booking') {
    let next = { ...action }

    const timeMatch = n.match(/(?:mejor\s+)?a\s+las?\s+(\d{1,2})(?:[:\s](\d{2}))?/)
    if (timeMatch) {
      next = { ...next, time: `${timeMatch[1].padStart(2, '0')}:${(timeMatch[2] ?? '00').padStart(2, '0')}` }
      changed = true
    }

    const dateMatch = n.match(/(?:mejor\s+)?(?:(?:para\s+)?el\s+dia\s+|para\s+el\s+|el\s+)(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{4}-\d{2}-\d{2})/)
    if (dateMatch) {
      const iso = parseIsoDate(dateMatch[1])
      if (iso) { next = { ...next, date: iso }; changed = true }
    }
    if (!dateMatch) {
      const relMatch = n.match(/\b(pasado manana|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/)
      if (relMatch) {
        const iso = parseRelativeDate(relMatch[1])
        if (iso) { next = { ...next, date: iso }; changed = true }
      }
    }

    const durMatch = n.match(/(\d+)\s*(?:minutos?|min\b)/) || n.match(/(\d+)\s*hora/)
    if (durMatch) {
      const val = parseInt(durMatch[1])
      const dur = /hora/.test(n) ? val * 60 : val
      if (dur > 0) { next = { ...next, duration: dur }; changed = true }
    }

    const serviceMatch = n.match(/(?:servicio|para)\s+(?:es\s+|de\s+)?(.{3,30})/)
    if (serviceMatch && !/mejor|las?\s+\d|minutos|hora/.test(serviceMatch[1])) {
      next = { ...next, service: serviceMatch[1].trim() }
      changed = true
    }

    if (!changed) return null
    return {
      ...next,
      missingFields: [
        !next.clientName && 'cliente',
        !next.date && 'fecha',
        !next.time && 'hora',
      ].filter(Boolean) as string[],
    }
  }

  if (action.type === 'invoice') {
    let next = { ...action }

    const amountMatch = n.match(/(?:cambia(?:r|lo|la)?\s+(?:el\s+)?importe\s+a\s*|importe\s+(?:de\s+)?a?\s*|son\s+)(\d+(?:[.,]\d+)?)/)
      || n.match(/(\d+(?:[.,]\d+)?)\s*(?:eur(?:os?)?|€)/)
    if (amountMatch) {
      const val = parseFloat(amountMatch[1].replace(',', '.'))
      if (val > 0) { next = { ...next, amount: val }; changed = true }
    }

    const dueDateMatch = n.match(/(?:vence(?:\s+el)?|vencimiento\s+(?:el\s+)?)(\d{4}-\d{2}-\d{2}|\d{1,2}[\/]\d{1,2})/)
    if (dueDateMatch) {
      const iso = parseIsoDate(dueDateMatch[1])
      if (iso) { next = { ...next, dueDate: iso }; changed = true }
    }
    if (!dueDateMatch) {
      const relMatch = n.match(/(?:vence(?:\s+el)?\s+|vencimiento\s+)?(pasado manana|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/)
      if (relMatch) {
        const iso = parseRelativeDate(relMatch[1])
        if (iso) { next = { ...next, dueDate: iso }; changed = true }
      }
    }

    const conceptMatch = n.match(/concepto[:\s]+(?:es\s+)?(.{3,60})/)
    if (conceptMatch) { next = { ...next, concept: conceptMatch[1].trim() }; changed = true }

    if (!changed) return null
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

  if (action.type === 'task') {
    let next = { ...action }

    const dueDateMatch = n.match(/(?:para\s+el|vence(?:\s+el)?)[\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}[\/]\d{1,2})/)
    if (dueDateMatch) {
      const iso = parseIsoDate(dueDateMatch[1])
      if (iso) { next = { ...next, dueDate: iso }; changed = true }
    }
    if (!dueDateMatch) {
      const relMatch = n.match(/\b(pasado manana|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/)
      if (relMatch) {
        const iso = parseRelativeDate(relMatch[1])
        if (iso) { next = { ...next, dueDate: iso }; changed = true }
      }
    }

    if (!changed) return null
    return { ...next }
  }

  return null
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

  return '✅ Acción preparada. Ya tienes el resultado disponible en el Asistente IA.'
}



const GENERIC_COPILOT_TITLES = new Set([
  // Títulos por defecto actuales del Asistente IA.
  'consulta asistente ia',
  'nueva consulta asistente ia',
  'consulta asistente ia demo',
  // Legacy (datos antiguos/demo) — se mantienen para no romper la detección.
  'consulta nowlabs ai',
  'nueva consulta nowlabs ai',
  'consulta nowlabs ai demo',
  'abre una consulta interna para gestionar clientes, citas o facturas.',
])

function isGenericCopilotTitle(title: string) {
  return GENERIC_COPILOT_TITLES.has(title.toLowerCase().trim())
}

function generateAutoTitle(message: string, referencedClientName?: string): string {
  const t = normalizeInput(message)

  if (/\b(ultimo|ultima) cliente\b/.test(t)) return 'Último cliente registrado'
  if (/\b(informe|resumen)\b/.test(t) && referencedClientName) return `Informe de ${referencedClientName}`
  if (/\b(informe|resumen)\b/.test(t)) return 'Informe de cliente'
  if (/\b(facturas? pendientes?|cobros? pendientes?)\b/.test(t)) return 'Facturas pendientes'
  if (/\b(citas? proximas?|agenda|calendario)\b/.test(t)) return 'Próximas citas'
  if (/\b(resumen.*crm|crm.*resumen|como.*crm)\b/.test(t)) return 'Resumen CRM'
  if (/\b(todos sus datos|sus datos|dame.*datos)\b/.test(t) && referencedClientName) return `Datos de ${referencedClientName}`
  if (/\b(todos sus datos|sus datos|dame.*datos)\b/.test(t)) return 'Consulta de cliente'
  if (/\b(proxima accion|siguiente accion|que hago|siguiente paso)\b/.test(t)) return 'Próxima acción'
  if (/\b(cuantos clientes|numero de clientes)\b/.test(t)) return 'Total de clientes'
  if (/\b(buscar|busca|encuentra)\b/.test(t) && /\bcliente\b/.test(t)) return 'Búsqueda de cliente'

  const trimmed = message.trim()
  if (trimmed.length <= 40) return trimmed
  const firstWords = trimmed.split(/\s+/).slice(0, 6).join(' ')
  return firstWords.length < trimmed.length ? `${firstWords}…` : firstWords
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message)
  return String(error || 'Error desconocido')
}

export default function AssistantPage() {
  const { currentUser, isLoading: userLoading } = useCurrentUser()
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
  // Tracks where the most recent /api/assistant/v2 answer came from. Surfaces
  // as a discreet badge so the operator knows whether the Asistente IA is running on
  // the n8n orchestrator, the local agent or fell back to local mid-flight.
  const [lastAgentMode, setLastAgentMode] = useState<'local' | 'n8n' | 'hybrid_fallback' | null>(null)
  const [lastActionStatus, setLastActionStatus] = useState('')
  const [lastGeneratedDocument, setLastGeneratedDocument] = useState<{
    title: string
    type: 'client_file' | 'invoice_pdf'
    bucket: string
    path: string
    signedUrl: string | null
    createdAt: string
  } | null>(null)
  const [inboxSettings, setInboxSettings] = useState<Record<string, unknown> | null>(null)
  const [waConnected, setWaConnected] = useState(false)
  const [waStatus, setWaStatus] = useState<string | null>(null)
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('copilot')
  const [referencedClients, setReferencedClients] = useState<Record<string, { id?: string; name?: string }>>({})
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [detectedIntent, setDetectedIntent] = useState('')
  const [preparedAction, setPreparedAction] = useState<PreparedAction | null>(null)
  const [lastConfirmedEventId, setLastConfirmedEventId] = useState<string | null>(null)
  const [lastConfirmedClientName, setLastConfirmedClientName] = useState<string | null>(null)
  const [lastConfirmedDate, setLastConfirmedDate] = useState<string | null>(null)
  const [lastCalendarResultsMap, setLastCalendarResultsMap] = useState<Record<string, Record<string, unknown>[]>>({})
  const [lastResultsMap, setLastResultsMap] = useState<Record<string, Record<string, unknown>[]>>({})
  const [confirmingAction, setConfirmingAction] = useState(false)
  const [editingAction, setEditingAction] = useState(false)
  const [editDraft, setEditDraft] = useState<Record<string, string>>({})
  const [diagnostics, setDiagnostics] = useState<PersistenceDiagnostics>(initialDiagnostics)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const activeQuickPrompts = assistantMode === 'inbox' ? inboxManualPrompts : quickPromptsByMode[assistantMode]

  const updateDiagnostics = useCallback((patch: Partial<PersistenceDiagnostics>) => {
    setDiagnostics((prev) => ({ ...prev, ...patch }))
  }, [])

  const loadConversations = useCallback(async () => {
    if (userLoading) return
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
        setWorkspaceId(null)
        setIsRealMode(false)
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
        setWorkspaceId(null)
        setIsRealMode(false)
        setAssistantWebhookUrl('')
        setAssistantFlowFound(false)
        setAssistantFlowStatus('demo')
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
        if (!isDemoMode) toast.warning('Assistant sin sesión real', { description: 'No se muestran conversaciones demo en modo real.' })
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
      setAssistantWebhookUrl(resolvedWorkspaceId ? assistantFlow.webhookUrl : '')
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
      if (!isDemoMode) toast.warning('No se pudieron cargar conversaciones', { description: 'Hubo un error al leer tus datos reales. Revisa la conexión o inténtalo de nuevo.' })
    } finally {
      setLoadingConversations(false)
      setAssistantReady(true)
    }
  }, [updateDiagnostics, userLoading, userWorkspaceId])

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
  const lastReferencedClientName = activeSelectedId ? referencedClients[activeSelectedId]?.name : undefined
  const lastReferencedClientId = activeSelectedId ? referencedClients[activeSelectedId]?.id : undefined

  const setConversationClient = (conversationId: string, client: { id: string; name: string }) => {
    setReferencedClients(prev => ({ ...prev, [conversationId]: { id: client.id, name: client.name } }))
  }

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

  // Clear prepared action when switching conversations so stale actions don't bleed across
  useEffect(() => {
    const t = window.setTimeout(() => {
      setPreparedAction(null)
      setEditingAction(false)
    }, 0)
    return () => window.clearTimeout(t)
  }, [selected?.id])

  useEffect(() => {
    if (!workspaceId) return
    void Promise.all([
      getInboxAgentSettings(workspaceId).catch(() => null),
      getWhatsappConnection(workspaceId).catch(() => null),
    ]).then(([settings, wa]) => {
      setInboxSettings(settings)
      const resolvedWaStatus = wa ? String(wa.status ?? '') : null
      setWaStatus(resolvedWaStatus)
      setWaConnected(resolvedWaStatus === 'connected')
    })
  }, [workspaceId])

  const filteredConvs = modeConversations.filter((conversation) => !convSearch || conversation.clientName.toLowerCase().includes(convSearch.toLowerCase()))
  const averageLeadScore = Math.round((modeConversations.reduce((sum, conversation) => sum + (leadScores[conversation.id] ?? 70), 0) / Math.max(modeConversations.length, 1)))
  const score = selected ? leadScores[selected.id] ?? (selected.sentiment === 'positive' ? 84 : selected.sentiment === 'negative' ? 42 : 68) : 70
  const isOfflineMode = OFFLINE_FORCE_DEV
  const assistantN8nActive = assistantMode === 'copilot' && !isOfflineMode && isRealMode && Boolean(assistantWebhookUrl)
  const assistantSourceLabel = assistantMode === 'inbox' ? 'Manual' : isOfflineMode ? 'Offline local' : isRealMode ? 'Backend agent' : 'Demo'
  const assistantSourceDetail = assistantMode === 'inbox' ? 'Meta API pendiente' : isOfflineMode ? 'backend bloqueado por red' : isRealMode ? 'OpenAI/tools server-side' : 'modo muestra'

  const assistantStats = [
    { label: assistantMode === 'inbox' ? 'Conversaciones Inbox' : 'Consultas al Asistente IA', value: String(modeConversations.length), detail: isRealMode ? 'persistentes' : 'pruebas', icon: <MessageSquare className="h-4 w-4" />, tone: 'text-indigo-600 bg-indigo-50' },
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
      clientName: assistantMode === 'copilot' ? 'Consulta Asistente IA' : 'Nueva conversación',
      lastMessage: assistantMode === 'copilot' ? 'Consulta Asistente IA' : 'Conversación Inbox Assistant',
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
        await createActivity(workspaceId, { type: 'message', description: `${assistantMode === 'copilot' ? 'Asistente IA' : 'Inbox Assistant'}: ${content.slice(0, 90)}`, clientName })
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
    const isFirstUserMessage = assistantMode === 'copilot' &&
      (localMessages[conversationId] ?? []).filter((m) => m.sender !== 'ai').length === 0
    const userSender: MessageSender = options.sender || (assistantMode === 'inbox' ? 'client' : 'agent')
    const userMsg: Message = { id: `${userSender}-${createUuid()}`, conversationId, content, sender: userSender, timestamp: nowTime(), metadata: { assistant_mode: assistantMode } }
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

        if (isFirstUserMessage && isGenericCopilotTitle(activeConversation.clientName)) {
          const autoTitle = generateAutoTitle(content, lastReferencedClientName)
          setConversationList((prev) => prev.map((c) => c.id === conversationId ? { ...c, clientName: autoTitle } : c))
          void updateConversationTitle(conversationId, workspaceId, autoTitle).catch(() => null)
        }
      }

      if (assistantMode === 'inbox') {
        setPreparedAction(null)
        setDetectedIntent('Inbox Assistant - modo manual')
        await appendAssistantMessage(conversationId, INBOX_MANUAL_RESPONSE, activeConversation.clientName)
        setLastResponseSource(null)
        setLastActionStatus('Inbox Assistant pendiente de conectar a Meta API')
        return
      }

      const isRankingQuery = /\b(mas caliente|mayor score|mejor lead|mas prometedor|mayor potencial|mas potencial|lead caliente|top leads?|mas fuerte|mayor puntuacion|mas score|oportunidad mas alta|mayor lead score|mejor cliente|cliente prioritario)\b/.test(normalizeInput(content))

      if (!isRankingQuery && preparedAction?.assistantMode === assistantMode) {
        const trimmed = content.trim()
        const isConfirmMsg = /^(confirmar?|s[ií]|dale|perfecto|ok|va|venga|hazlo|hazlo ya|gu[aá]rdalo|confirma(?:do)?|adelante|procede|listo|de acuerdo|claro que s[ií]|s[ií] por favor|s[ií] confirma|cr[eé]ala|cr[eé]alo|crea la cita|crea la factura|crea la tarea|crea el evento)[\.\!\?]?$/i.test(trimmed)
        const isCancelMsg = /^(cancelar?|no|olv[ií]dalo|descarta(?:lo|r)?|cancela(?:do)?|mejor no|stop|no hace falta|d[eé]jalo|descartar)[\.\!\?]?$/i.test(trimmed)

        if (isConfirmMsg) {
          if (preparedAction.missingFields.length) {
            await appendAssistantMessage(conversationId, `Todavía faltan datos para confirmar: ${missingText(preparedAction.missingFields)}. Dímelos y lo ejecuto.`, activeConversation.clientName)
            setLastResponseSource(null)
            return
          }
          void confirmPreparedAction()
          return
        }

        if (isCancelMsg) {
          cancelPreparedAction()
          return
        }

        const editedAction = applyActionEdit(preparedAction, content)
        if (editedAction) {
          setPreparedAction(editedAction)
          setLastActionStatus('Acción actualizada')
          await appendAssistantMessage(
            conversationId,
            editedAction.missingFields.length > 0
              ? `He actualizado la acción. Todavía falta: ${missingText(editedAction.missingFields)}.`
              : 'He actualizado la acción. Revísala y pulsa Confirmar cuando estés listo.',
            activeConversation.clientName
          )
          setLastResponseSource(null)
          return
        }
      }

      if (OFFLINE_FORCE_DEV) {
        const offlineResponse = localResponse || `Gracias, he registrado tu mensaje en modo offline local. Si quieres, dime el siguiente paso o pide una acción comercial.`
        await appendAssistantMessage(conversationId, offlineResponse, activeConversation.clientName)
        setLastResponseSource('fallback')
        return
      }

      if (!isRealMode && !assistantN8nActive && isCapabilityQuestion(content)) {
        await appendAssistantMessage(conversationId, internalAssistantIntro(assistantMode), activeConversation.clientName)
        setLastResponseSource(null)
        return
      }

      if (!isRealMode && !assistantN8nActive && isPricingQuestion(content)) {
        await appendAssistantMessage(conversationId, pricingGuidance(), activeConversation.clientName)
        setLastResponseSource(null)
        return
      }

      if (!isRealMode && !assistantN8nActive && /no entiendo|no sé|no se|ayuda/i.test(content)) {
        await appendAssistantMessage(conversationId, 'Claro. Dime si quieres crear una cita, buscar un cliente, preparar una factura o ver la próxima acción comercial.', activeConversation.clientName)
        setLastResponseSource(null)
        return
      }

      if (!isRankingQuery && preparedAction?.assistantMode === assistantMode && preparedAction.missingFields.length) {
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
        setPreparedAction(null)
        setEditingAction(false)

        // --- Asistente IA v2: único cerebro real del CRM ---
        try {
          const v2Res = await fetch('/api/assistant/v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: content,
              lastReferencedClientId,
              lastReferencedClientName,
              lastResults: lastResultsMap[conversationId] ?? [],
              lastCalendarResults: lastCalendarResultsMap[conversationId] ?? [],
              lastPreparedAction: preparedAction
                ? { type: preparedAction.type, eventId: 'eventId' in preparedAction ? preparedAction.eventId : undefined, clientId: 'clientId' in preparedAction ? preparedAction.clientId : undefined, clientName: 'clientName' in preparedAction ? preparedAction.clientName : undefined, date: 'date' in preparedAction ? preparedAction.date : undefined, time: 'time' in preparedAction ? preparedAction.time : undefined, title: preparedAction.title, service: 'service' in preparedAction ? preparedAction.service : undefined }
                : undefined,
              lastConfirmedEventId: lastConfirmedEventId ?? undefined,
              lastConfirmedClientName: lastConfirmedClientName ?? undefined,
              lastConfirmedDate: lastConfirmedDate ?? undefined,
            }),
          })
          type V2Response = {
            ok: boolean
            answer?: string
            debugSource?: string
            // Discrete error code surfaced by /api/assistant/v2 (see
            // AssistantErrorCode there). Populated when ok:false to let the UI
            // style the message; the user-facing copy already lives in
            // `answer`, so the UI never builds the message text from this.
            errorCode?: string | null
            // Source of the answer: 'local' (legacy agent), 'n8n' (Asistente IA n8n
            // orchestrator), 'hybrid_fallback' (tried n8n, fell back to local).
            // Undefined in old responses — treat as 'local'.
            mode?: 'local' | 'n8n' | 'hybrid_fallback'
            trace_id?: string
            toolCalls?: string[]
            referencedClientId?: string | null
            referencedClientName?: string | null
            referencedList?: Record<string, unknown>[] | null
            referencedCalendarList?: Record<string, unknown>[] | null
            dataPreview?: unknown
            preparedAction?: {
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
              oldDate?: string
              oldTime?: string
              // cancel_multiple_bookings / cleanup_duplicate_bookings
              events?: Array<{ eventId: string; clientName?: string; date?: string; time?: string; title?: string }>
              keepEventId?: string
              cancelEventIds?: string[]
            }
            error?: string
          }
          const v2Data = await v2Res.json() as V2Response
          // Track agent mode so the operator can see whether the Asistente IA is on
          // n8n or the local agent. Undefined → legacy response → assume local.
          if (v2Data.mode === 'n8n' || v2Data.mode === 'hybrid_fallback' || v2Data.mode === 'local') {
            setLastAgentMode(v2Data.mode)
          } else {
            setLastAgentMode('local')
          }
          console.log('[assistant/ui] v2 response', {
            ok: v2Data.ok,
            debugSource: v2Data.debugSource,
            errorCode: v2Data.errorCode ?? null,
            mode: v2Data.mode,
            traceId: v2Data.trace_id,
            toolCalls: v2Data.toolCalls,
            hasReferencedClient: Boolean(v2Data.referencedClientId),
            hasPreparedAction: Boolean(v2Data.preparedAction),
          })

          if (v2Data.ok && v2Data.answer) {
            if (v2Data.referencedClientId && v2Data.referencedClientName) {
              setConversationClient(conversationId, { id: v2Data.referencedClientId, name: v2Data.referencedClientName })
            }
            // Prefer referencedList (structured client list) over dataPreview for ordinal context
            const listToStore = v2Data.referencedList?.length
              ? v2Data.referencedList
              : Array.isArray(v2Data.dataPreview) && v2Data.dataPreview.length
                ? v2Data.dataPreview as Record<string, unknown>[]
                : null
            if (listToStore) {
              setLastResultsMap((prev) => ({ ...prev, [conversationId]: listToStore }))
            }
            if (v2Data.referencedCalendarList?.length) {
              setLastCalendarResultsMap((prev) => ({ ...prev, [conversationId]: v2Data.referencedCalendarList! }))
            }
            if (v2Data.preparedAction) {
              const pa = v2Data.preparedAction
              const paId = `v2-${createUuid()}`
              let frontendAction: PreparedAction
              if (pa.type === 'booking') {
                frontendAction = { id: paId, type: 'booking', title: `Cita con ${pa.clientName ?? ''}`, assistantMode: 'copilot', clientId: pa.clientId, clientName: pa.clientName, service: pa.service, date: pa.date, time: pa.time, missingFields: pa.missingFields, notes: 'Draft preparado por el Asistente IA' }
              } else if (pa.type === 'invoice') {
                frontendAction = { id: paId, type: 'invoice', title: `Factura para ${pa.clientName ?? ''}`, assistantMode: 'copilot', clientId: pa.clientId, clientName: pa.clientName, concept: pa.concept, amount: pa.amount, dueDate: pa.dueDate, missingFields: pa.missingFields, notes: 'Draft preparado por el Asistente IA' }
              } else if (pa.type === 'cancel_booking') {
                frontendAction = { id: paId, type: 'cancel_booking', title: pa.title ?? `Cancelar cita con ${pa.clientName ?? ''}`, assistantMode: 'copilot', eventId: pa.eventId, clientId: pa.clientId, clientName: pa.clientName, date: pa.date, time: pa.time, reason: pa.reason, missingFields: pa.missingFields }
              } else if (pa.type === 'reschedule_booking') {
                frontendAction = { id: paId, type: 'reschedule_booking', title: pa.title ?? `Reprogramar cita con ${pa.clientName ?? ''}`, assistantMode: 'copilot', eventId: pa.eventId, clientId: pa.clientId, clientName: pa.clientName, date: pa.date, time: pa.time, duration: pa.duration, oldDate: pa.oldDate, oldTime: pa.oldTime, missingFields: pa.missingFields }
              } else if (pa.type === 'cancel_multiple_bookings') {
                frontendAction = { id: paId, type: 'cancel_multiple_bookings', title: `Cancelar ${pa.events?.length ?? 0} cita(s)`, assistantMode: 'copilot', events: pa.events ?? [], reason: pa.reason, missingFields: pa.missingFields }
              } else if (pa.type === 'cleanup_duplicate_bookings') {
                frontendAction = { id: paId, type: 'cleanup_duplicate_bookings', title: `Limpiar ${pa.cancelEventIds?.length ?? 0} duplicada(s)`, assistantMode: 'copilot', events: pa.events ?? [], keepEventId: pa.keepEventId, cancelEventIds: pa.cancelEventIds ?? [], missingFields: pa.missingFields }
              } else {
                frontendAction = { id: paId, type: 'task', title: `Tarea: ${pa.taskTitle ?? pa.description ?? ''}`, assistantMode: 'copilot', clientId: pa.clientId, clientName: pa.clientName, taskTitle: pa.taskTitle, description: pa.description, dueDate: pa.dueDate, missingFields: pa.missingFields }
              }
              setPreparedAction(frontendAction)
            }
            await appendAssistantMessage(conversationId, v2Data.answer, activeConversation.clientName)
            setLastResponseSource('supabase')
            return
          }

          // Controlled error path. /api/assistant/v2 already provides a safe,
          // user-facing `answer` derived from `errorCode` (missing_api_key,
          // openai_unauthorized, openai_timeout, …). We trust that copy and
          // surface it instead of the generic "no he podido consultar" line.
          if (v2Data?.answer) {
            await appendAssistantMessage(conversationId, v2Data.answer, activeConversation.clientName)
            setLastResponseSource(null)
            return
          }
        } catch (v2Err) {
          // Network-level failure (server unreachable, JSON parse error). Only
          // metadata is logged — no PII, no headers, no body.
          console.warn('[assistant/ui] v2 fetch failed', {
            error: v2Err instanceof Error ? v2Err.message : String(v2Err),
          })
        }
        // Truly nothing to show — request didn't complete or response had no
        // `answer` field at all.
        await appendAssistantMessage(
          conversationId,
          'No he podido contactar con el asistente. Inténtalo de nuevo en unos segundos.',
          activeConversation.clientName
        )
        setLastResponseSource(null)
        return
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

      // RT5 — lecturas reales directas de operaciones / expedientes abiertos.
      // Mismo camino seguro (callAgentTool → formatToolResult, RLS server-side,
      // sin inventar): si no hay datos, formatToolResult ya dice que no hay.
      const readLc = content.toLowerCase()
      const directReadTool: AgentToolName | null =
        /\boperaci(o|ó)n|pipeline|negociaci/.test(readLc) ? 'get_open_operations' :
        /\bexpediente|tr[aá]mite/.test(readLc) ? 'get_open_service_cases' : null
      if (!OFFLINE_FORCE_DEV && assistantMode === 'copilot' && directReadTool && workspaceId) {
        const directResult = await callAgentTool(directReadTool, workspaceId, {}, {
          source: 'assistant_local_read',
          conversation_id: activeConversation.id,
        }).catch(() => null)
        if (directResult?.ok) {
          await appendAssistantMessage(conversationId, formatToolResult(directReadTool, directResult.result), activeConversation.clientName)
          setLastResponseSource(null)
          return
        }
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

      // Safety net — copilot real mode must never reach this point (block above always returns)
      if (assistantMode === 'copilot' && isRealMode) {
        await appendAssistantMessage(conversationId, 'No he podido resolver esta consulta ahora mismo. Prueba de nuevo.', activeConversation.clientName)
        setLastResponseSource(null)
        return
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
        toast.success('Automatizacion externa respondio', { description: 'Respuesta guardada en la conversacion.' })
      } else if (assistantN8nActive && assistantResult.trigger.status === 'error') {
        setLastResponseSource('fallback')
        toast.warning('Automatizacion externa no disponible', { description: 'El mensaje se ha guardado igualmente con respuesta local.' })
      } else {
        setLastResponseSource('fallback')
      }

      const lower = content.toLowerCase()
      if (!OFFLINE_FORCE_DEV && (lower.includes('pago') || lower.includes('factura') || lower.includes('cobro'))) {
        void triggerN8nWebhook('invoice_paid', { message: { content }, client: { name: activeConversation.clientName }, workspace_id: workspaceId || undefined, mode: isRealMode ? 'real' : 'demo' }).catch(() => null)
      }
      if (!OFFLINE_FORCE_DEV && (lower.includes('llamada') || lower.includes('reun') || lower.includes('agenda'))) {
        void triggerN8nWebhook('appointment_booked', { message: { content }, client: { name: activeConversation.clientName }, workspace_id: workspaceId || undefined, mode: isRealMode ? 'real' : 'demo' }).catch(() => null)
      }
    } catch (error) {
      toast.error('No se pudo guardar el mensaje', { description: error instanceof Error ? error.message : 'Se mantiene en pantalla de forma local.' })
    } finally {
      setIsTyping(false)
    }
  }

  const confirmPreparedAction = async () => {
    if (!preparedAction || confirmingAction) return
    if (!selected) return

    setConfirmingAction(true)
    // Guard: clientId must be a real UUID or absent — never a name string
    const paClientId = 'clientId' in preparedAction ? preparedAction.clientId : undefined
    if (paClientId && !isUuid(paClientId)) {
      toast.warning('No tengo identificado el cliente exacto. Busca o selecciona el cliente antes de confirmar.')
      setConfirmingAction(false)
      return
    }
    let debugPayload: Record<string, unknown> | null = null
    try {
      const activeConversation = isRealMode ? await ensureRealConversation() : selected
      if (!activeConversation) return
      if (isRealMode && (!workspaceId || !isUuid(activeConversation.id))) {
        throw new Error(!workspaceId ? 'Workspace real no resuelto.' : 'No se puede confirmar una acción usando una conversación temporal.')
      }

      // -------------------------------------------------------------------
      // BOOKING / TASK / INVOICE  →  /api/assistant/confirm
      //
      // We no longer write to Supabase from the browser for these three.
      // The endpoint runs the full revalidation server-side (workspace from
      // session, clientId belongs to workspace, type allowed, no missing
      // fields, well-formed date/time/amount). It also fires the optional
      // n8n webhook (`assistant.{type}_created/_prepared`) fail-soft.
      //
      // For booking we still trigger the Google Calendar sync from the
      // browser using the returned eventId — that path is the user's
      // already-audited Calendar route, which validates session itself.
      // For invoice/task no further client-side work is needed.
      // -------------------------------------------------------------------
      if (preparedAction.type === 'booking' || preparedAction.type === 'task' || preparedAction.type === 'invoice') {
        // Frontend-side guard: surface the same friendly errors the server
        // would, before paying the round-trip. Server is still the authority.
        if (preparedAction.type === 'booking') {
          if (preparedAction.missingFields.length || !preparedAction.clientName || !preparedAction.date || !preparedAction.time) {
            toast.warning('Faltan datos para crear la cita', { description: missingText(preparedAction.missingFields) || 'Completa la card antes de confirmar.' })
            return
          }
        }
        if (preparedAction.type === 'invoice') {
          if (preparedAction.missingFields.length || !preparedAction.clientName || !preparedAction.amount) {
            toast.warning('Faltan datos para crear la factura', { description: missingText(preparedAction.missingFields) || 'Se necesita al menos cliente e importe.' })
            return
          }
        }
        if (preparedAction.type === 'task') {
          if (!preparedAction.taskTitle) {
            toast.warning('Falta el título de la tarea', { description: 'Escribe el título y vuelve a confirmar.' })
            return
          }
        }
        if (!workspaceId) throw new Error('Workspace real no resuelto.')

        const confirmPayload: Record<string, unknown> = {
          type: preparedAction.type,
          clientId: 'clientId' in preparedAction ? preparedAction.clientId : undefined,
          clientName: 'clientName' in preparedAction ? preparedAction.clientName : undefined,
          notes: 'notes' in preparedAction ? preparedAction.notes : undefined,
          missingFields: preparedAction.missingFields,
          conversationId: activeConversation.id,
        }
        if (preparedAction.type === 'booking') {
          confirmPayload.service = preparedAction.service
          confirmPayload.date = preparedAction.date
          confirmPayload.time = preparedAction.time
          confirmPayload.duration = preparedAction.duration
        } else if (preparedAction.type === 'invoice') {
          confirmPayload.amount = preparedAction.amount
          confirmPayload.concept = preparedAction.concept
          confirmPayload.dueDate = preparedAction.dueDate
        } else {
          confirmPayload.taskTitle = preparedAction.taskTitle
          confirmPayload.description = preparedAction.description
          confirmPayload.dueDate = preparedAction.dueDate
        }
        debugPayload = confirmPayload

        const confirmRes = await fetch('/api/assistant/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preparedAction: confirmPayload }),
        })
        const confirmData = await confirmRes.json().catch(() => ({})) as {
          ok?: boolean
          type?: string
          entityId?: string | null
          message?: string
          error?: string
          missingFields?: string[]
          candidates?: ConfirmCandidate[]
        }

        if (!confirmRes.ok || !confirmData.ok) {
          // missing_fields and ambiguous_client have their own UX. Everything
          // else funnels through friendlyConfirmError so the user never sees
          // raw codes, Supabase strings or 500-style messages.
          if (confirmData.error === 'missing_fields' && confirmData.missingFields?.length) {
            toast.warning('Faltan datos para confirmar', { description: missingText(confirmData.missingFields) })
          } else if (confirmData.error === 'ambiguous_client' && confirmData.candidates?.length) {
            const candidates = confirmData.candidates
            const summary = candidates.slice(0, 5).map((c) => c.name).filter(Boolean).join(', ')
            toast.warning('Hay varios clientes con ese nombre', {
              description: summary
                ? `Coincidencias: ${summary}. Dime cuál.`
                : 'Dime cuál de ellos es para poder confirmar.',
            })
            // Append a chat message so the user can answer with a number or
            // the full name — same conversational flow as the rest of the bot.
            await appendAssistantMessage(
              activeConversation.id,
              formatAmbiguousCandidates(candidates),
              preparedAction.clientName,
            ).catch((error) => {
              if (process.env.NODE_ENV === 'development') console.warn('[assistant/confirm:ambiguous_client]', error)
            })
          } else {
            const copy = friendlyConfirmError(confirmData.error)
            if (copy.level === 'warning') {
              toast.warning(copy.title, { description: copy.description })
            } else {
              toast.error(copy.title, { description: copy.description })
            }
          }
          return
        }

        const entityId = confirmData.entityId ?? undefined
        const summaryMessage = confirmData.message ?? ''

        if (preparedAction.type === 'booking' && entityId) {
          // Google Calendar sync — best-effort, never blocks. Uses the user's
          // already-audited /sync-event route (session validated server-side).
          let gcalSynced = false
          let gcalNotConnected = false
          try {
            const gcalRes = await fetch('/api/integrations/google/calendar/sync-event', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ eventId: entityId }),
              signal: AbortSignal.timeout(9000),
            })
            if (gcalRes.ok) {
              const gcalData = await gcalRes.json() as { synced?: boolean; reason?: string }
              gcalSynced = gcalData.synced === true
              gcalNotConnected = gcalData.reason === 'not_connected'
            }
          } catch {
            // Google sync is best-effort — the CRM event is already saved.
          }

          const bookingMsg = gcalSynced
            ? `${summaryMessage || `Cita creada para ${preparedAction.clientName} el ${preparedAction.date} a las ${preparedAction.time}.`} Añadida también a Google Calendar.`
            : summaryMessage || `Cita creada para ${preparedAction.clientName} el ${preparedAction.date} a las ${preparedAction.time}.`
          await appendAssistantMessage(activeConversation.id, bookingMsg, preparedAction.clientName).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[assistant/message:booking]', error)
          })
          const bookingToast = gcalSynced
            ? 'Cita creada y añadida a Google Calendar'
            : gcalNotConnected
              ? 'Cita creada en el CRM. Google Calendar aún no está conectado.'
              : 'Cita creada en Calendario'
          toast.success(bookingToast)
          setLastActionStatus('Última acción confirmada: cita creada')
          setLastConfirmedEventId(entityId)
          setLastConfirmedClientName(preparedAction.clientName ?? null)
          setLastConfirmedDate(preparedAction.date ?? null)
        } else if (preparedAction.type === 'invoice') {
          const invoiceMsg = summaryMessage
            ? `${summaryMessage}\n\nSi quieres el PDF, escribe: "genera PDF de la factura".`
            : `Factura creada para ${preparedAction.clientName}.\n\nSi quieres el PDF, escribe: "genera PDF de la factura".`
          await appendAssistantMessage(activeConversation.id, invoiceMsg, preparedAction.clientName).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[assistant/message:invoice]', error)
          })
          toast.success('Factura preparada')
          setLastActionStatus('Última acción confirmada: factura preparada')
        } else if (preparedAction.type === 'task') {
          const taskMsg = summaryMessage || `Tarea creada: "${preparedAction.taskTitle}"${preparedAction.clientName ? ` para ${preparedAction.clientName}` : ''}.`
          await appendAssistantMessage(activeConversation.id, taskMsg, preparedAction.clientName).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[assistant/message:task]', error)
          })
          toast.success('Tarea creada')
          setLastActionStatus('Última acción confirmada: tarea creada')
        }
      }

      if (preparedAction.type === 'cancel_booking') {
        if (!preparedAction.eventId) {
          toast.warning('No tengo el ID del evento', { description: 'El agente no encontró el evento exacto. Inténtalo especificando cliente y fecha.' })
          return
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(preparedAction.eventId)) {
          toast.warning('ID de evento inválido', { description: 'Vuelve a buscar la cita e inténtalo de nuevo.' })
          return
        }
        if (!workspaceId) throw new Error('No hay workspace real para cancelar el evento.')
        const cancelResult = await cancelEventAtomically(preparedAction.eventId)
        if (!cancelResult.ok) {
          if (cancelResult.reason === 'read_only_event') {
            toast.info('Cita solo lectura', { description: cancelResult.message || 'Cancélala desde Google Calendar.' })
          } else if (cancelResult.reason === 'needs_reconnect') {
            toast.error('Google requiere reconexión', { description: cancelResult.message })
          } else if (cancelResult.reason === 'google_forbidden' || cancelResult.reason === 'google_api_error' || cancelResult.reason === 'google_fetch_error' || cancelResult.reason === 'rate_limited') {
            toast.error('No se pudo cancelar en Google', { description: cancelResult.message || 'El CRM no marcó la cita como cancelada para evitar inconsistencia.' })
          } else {
            toast.error('No se pudo cancelar la cita', { description: cancelResult.message })
          }
          return
        }

        const clientLabel = preparedAction.clientName ? ` con ${preparedAction.clientName}` : ''
        const dateLabel = preparedAction.date ? ` del ${preparedAction.date}` : ''
        const timeLabel = preparedAction.time ? ` a las ${preparedAction.time}` : ''
        const syncNote = cancelResult.googleCancelled
          ? cancelResult.googleAlreadyGone ? ' (en Google ya no existía)' : ' (también en Google)'
          : ''
        const cancelMsg = `Cita${clientLabel}${dateLabel}${timeLabel} cancelada${syncNote}.`
        await appendAssistantMessage(activeConversation.id, cancelMsg, preparedAction.clientName).catch(() => null)
        if (workspaceId) {
          void createActivity(workspaceId, { type: 'note', description: `Cita cancelada desde el Asistente IA${clientLabel}${dateLabel}`, clientName: preparedAction.clientName }).catch(() => null)
        }
        // Clear confirmed event context and stale calendar cache
        setLastConfirmedEventId(null)
        setLastConfirmedClientName(null)
        setLastConfirmedDate(null)
        setLastCalendarResultsMap((prev) => { const n = { ...prev }; delete n[activeConversation.id]; return n })
        toast.success('Cita cancelada')
        setLastActionStatus('Última acción confirmada: cita cancelada')
      }

      if (preparedAction.type === 'reschedule_booking') {
        if (!preparedAction.eventId) {
          toast.warning('No tengo el ID del evento', { description: 'El agente no encontró el evento exacto. Inténtalo especificando cliente y fecha.' })
          return
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(preparedAction.eventId)) {
          toast.warning('ID de evento inválido', { description: 'Vuelve a buscar la cita e inténtalo de nuevo.' })
          return
        }
        if (!preparedAction.date || !preparedAction.time) {
          toast.warning('Faltan la nueva fecha o la nueva hora', { description: 'Especifica cuándo quieres mover la cita.' })
          return
        }
        if (!workspaceId) throw new Error('No hay workspace real para reprogramar el evento.')
        await updateCalendarEvent(preparedAction.eventId, workspaceId, {
          title: preparedAction.title ?? `Cita con ${preparedAction.clientName ?? ''}`,
          clientId: preparedAction.clientId,
          clientName: preparedAction.clientName,
          date: preparedAction.date,
          time: preparedAction.time,
          duration: preparedAction.duration ?? 60,
        })
        void fetch('/api/integrations/google/calendar/update-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ localEventId: preparedAction.eventId }) }).catch(() => null)
        const clientLabel = preparedAction.clientName ? ` con ${preparedAction.clientName}` : ''
        const newDateLabel = preparedAction.date ? ` al ${preparedAction.date}` : ''
        const newTimeLabel = preparedAction.time ? ` a las ${preparedAction.time}` : ''
        const rescheduleMsg = `Cita${clientLabel} reprogramada${newDateLabel}${newTimeLabel}.`
        await appendAssistantMessage(activeConversation.id, rescheduleMsg, preparedAction.clientName).catch(() => null)
        if (workspaceId) {
          void createActivity(workspaceId, { type: 'note', description: `Cita reprogramada desde el Asistente IA${clientLabel}${newDateLabel}`, clientName: preparedAction.clientName }).catch(() => null)
        }
        // Update confirmed event context; clear stale calendar cache
        setLastConfirmedEventId(preparedAction.eventId)
        setLastConfirmedClientName(preparedAction.clientName ?? null)
        setLastConfirmedDate(preparedAction.date ?? null)
        setLastCalendarResultsMap((prev) => { const n = { ...prev }; delete n[activeConversation.id]; return n })
        toast.success('Cita reprogramada')
        setLastActionStatus('Última acción confirmada: cita reprogramada')
      }

      if (preparedAction.type === 'cancel_multiple_bookings') {
        if (!preparedAction.events.length) {
          toast.warning('No hay citas para cancelar.')
          return
        }
        if (!workspaceId) throw new Error('No hay workspace real para cancelar los eventos.')
        const invalidEvent = preparedAction.events.find((ev) => !isUuid(ev.eventId))
        if (invalidEvent) {
          toast.warning('Hay una cita con ID inválido. Vuelve a buscar las citas antes de confirmar.')
          return
        }
        let cancelled = 0
        let googleSynced = 0
        let skippedReadOnly = 0
        let needsReconnect = 0
        for (const ev of preparedAction.events) {
          try {
            const r = await cancelEventAtomically(ev.eventId)
            if (r.ok && r.localCancelled) {
              cancelled++
              if (r.googleCancelled) googleSynced++
            } else if (r.reason === 'read_only_event') {
              skippedReadOnly++
            } else if (r.reason === 'needs_reconnect') {
              needsReconnect++
            }
          } catch {
            // continuar con el resto
          }
        }
        const total = preparedAction.events.length
        const detail = [
          googleSynced > 0 ? `${googleSynced} sincronizada(s) con Google` : null,
          skippedReadOnly > 0 ? `${skippedReadOnly} omitida(s) por solo lectura` : null,
          needsReconnect > 0 ? `${needsReconnect} requieren reconectar Google` : null,
        ].filter(Boolean).join(', ')
        const detailSuffix = detail ? ` (${detail})` : ''
        const summary = cancelled === 0
          ? `No he podido cancelar esas citas. No voy a marcarlas como canceladas hasta confirmarlo en la base de datos. Inténtalo de nuevo o revisa que los IDs sean correctos.${detailSuffix}`
          : cancelled === total
          ? `${total} cita(s) canceladas correctamente${detailSuffix}.`
          : `Se cancelaron ${cancelled} de ${total} citas. Las ${total - cancelled} restantes no se pudieron cancelar — compruébalas manualmente${detailSuffix}.`
        await appendAssistantMessage(activeConversation.id, summary, preparedAction.events[0]?.clientName).catch(() => null)
        if (workspaceId && cancelled > 0) {
          void createActivity(workspaceId, { type: 'note', description: `${cancelled} cita(s) canceladas desde el Asistente IA (acción múltiple)` }).catch(() => null)
        }
        setLastConfirmedEventId(null)
        setLastConfirmedClientName(null)
        setLastConfirmedDate(null)
        setLastCalendarResultsMap((prev) => { const n = { ...prev }; delete n[activeConversation.id]; return n })
        if (cancelled > 0) {
          toast.success(`${cancelled} de ${total} cita(s) canceladas`)
        } else {
          toast.error('No se canceló ninguna cita')
        }
        setLastActionStatus(`Última acción confirmada: ${cancelled} de ${total} cita(s) canceladas`)
      }

      if (preparedAction.type === 'cleanup_duplicate_bookings') {
        if (!preparedAction.cancelEventIds.length) {
          toast.warning('No hay duplicados para limpiar.')
          return
        }
        if (!workspaceId) throw new Error('No hay workspace real para cancelar los duplicados.')
        if (preparedAction.keepEventId && !isUuid(preparedAction.keepEventId)) {
          toast.warning('La cita que se conserva tiene un ID inválido. Vuelve a buscar las citas antes de confirmar.')
          return
        }
        const invalidEventId = preparedAction.cancelEventIds.find((eventId) => !isUuid(eventId))
        if (invalidEventId) {
          toast.warning('Hay una cita duplicada con ID inválido. Vuelve a buscar las citas antes de confirmar.')
          return
        }
        let cancelled = 0
        let googleSynced = 0
        let skippedReadOnly = 0
        for (const eventId of preparedAction.cancelEventIds) {
          try {
            const r = await cancelEventAtomically(eventId)
            if (r.ok && r.localCancelled) {
              cancelled++
              if (r.googleCancelled) googleSynced++
            } else if (r.reason === 'read_only_event') {
              skippedReadOnly++
            }
          } catch {
            // continuar con el resto
          }
        }
        const total = preparedAction.cancelEventIds.length
        const detail = [
          googleSynced > 0 ? `${googleSynced} sincronizada(s) con Google` : null,
          skippedReadOnly > 0 ? `${skippedReadOnly} omitida(s) por solo lectura` : null,
        ].filter(Boolean).join(', ')
        const detailSuffix = detail ? ` (${detail})` : ''
        const summary = cancelled === 0
          ? `No he podido cancelar las citas duplicadas. No voy a marcarlas como canceladas hasta confirmarlo en la base de datos. Inténtalo de nuevo.${detailSuffix}`
          : cancelled === total
          ? `Se cancelaron ${total} cita(s) duplicada(s). Queda una cita activa${detailSuffix}.`
          : `Se cancelaron ${cancelled} de ${total} duplicadas${detailSuffix}. Revisa el calendario.`
        await appendAssistantMessage(activeConversation.id, summary, undefined).catch(() => null)
        if (workspaceId && cancelled > 0) {
          void createActivity(workspaceId, { type: 'note', description: `Limpieza de ${cancelled} cita(s) duplicada(s) desde el Asistente IA` }).catch(() => null)
        }
        setLastConfirmedEventId(preparedAction.keepEventId ?? null)
        setLastConfirmedClientName(null)
        setLastConfirmedDate(null)
        setLastCalendarResultsMap((prev) => { const n = { ...prev }; delete n[activeConversation.id]; return n })
        if (cancelled > 0) {
          toast.success(`${cancelled} duplicada(s) eliminada(s)`)
        } else {
          toast.error('No se eliminó ningún duplicado')
        }
        setLastActionStatus(`Última acción confirmada: ${cancelled} duplicado(s) limpiado(s)`)
      }

      if (preparedAction.type === 'prepare_pdf') {
        const content = preparedAction.reportText
        if (!content) {
          await appendAssistantMessage(activeConversation.id, `No hay contenido de informe para ${preparedAction.clientName ?? 'el cliente'}. Genera primero el informe y vuelve a intentarlo.`, preparedAction.clientName)
          return
        }
        if (workspaceId) {
          void createAgentActionLog(workspaceId, {
            action: 'generate_client_report',
            details: { clientName: preparedAction.clientName, clientId: preparedAction.clientId, title: preparedAction.title },
          }).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[assistant/actionLog:pdf]', error)
          })
        }
        const clientSafe = (preparedAction.clientName || 'cliente').replace(/[^a-z0-9]/gi, '-').toLowerCase()
        const filename = `${clientSafe}-${Date.now()}.pdf`
        const storagePath = `${workspaceId}/reports/${filename}`
        const pdfBytes = generateReportPdfBytes(
          preparedAction.title || `Informe de ${preparedAction.clientName ?? 'cliente'}`,
          content,
        )
        let signedUrl: string | null = null
        let storageOk = false
        let docId: string | null = null
        if (workspaceId) {
          try {
            const { doc } = await saveGeneratedDocument(workspaceId, {
              clientId: preparedAction.clientId,
              title: preparedAction.title || `Informe de ${preparedAction.clientName ?? 'cliente'}`,
              type: 'client_file',
              storageBucket: 'informes-pdf',
              storagePath,
              mimeType: 'application/pdf',
              size: pdfBytes.length,
            }, pdfBytes)
            docId = doc.id
            storageOk = true
            try {
              signedUrl = await getSignedDocumentUrl({ storageBucket: 'informes-pdf', storagePath }, 600)
            } catch {
              // signed URL is optional — fails silently
            }
          } catch (storageError) {
            if (process.env.NODE_ENV === 'development') console.warn('[assistant/prepare_pdf:storage]', storageError)
          }
        }
        const docTitle = preparedAction.title || `Informe de ${preparedAction.clientName ?? 'cliente'}`
        setLastGeneratedDocument({
          title: docTitle,
          type: 'client_file',
          bucket: 'informes-pdf',
          path: storagePath,
          signedUrl,
          createdAt: new Date().toISOString(),
        })
        let displayText: string
        if (storageOk && signedUrl) {
          displayText = `PDF generado correctamente. Puedes abrirlo aqui:\n${signedUrl}`
        } else if (storageOk) {
          displayText = `PDF generado y guardado. No se pudo obtener enlace firmado.${docId ? ` ID: ${docId}.` : ''}`
        } else {
          displayText = `El PDF se genero, pero no se pudo guardar en Storage. Revisa conexion/RLS del bucket informes-pdf.\n\nContenido del informe:\n\n${content}`
        }
        await appendAssistantMessage(activeConversation.id, displayText, preparedAction.clientName)
        if (storageOk) {
          toast.success('Informe PDF guardado', { description: signedUrl ? 'Enlace disponible en el chat.' : 'Sin enlace firmado.' })
        } else {
          toast.info('PDF generado sin Storage', { description: 'Verifica RLS del bucket informes-pdf.' })
        }
        setLastActionStatus('Última acción: informe de cliente generado')
      }

      if (preparedAction.type === 'generate_invoice_pdf') {
        const content = preparedAction.invoiceText
        if (!content || !preparedAction.invoiceId) {
          await appendAssistantMessage(activeConversation.id, 'No hay datos de factura para generar el PDF. Crea primero una factura y confírmala.', preparedAction.clientName)
          return
        }
        if (workspaceId) {
          void createAgentActionLog(workspaceId, {
            action: 'generate_invoice_pdf',
            details: { invoiceId: preparedAction.invoiceId, invoiceNumber: preparedAction.invoiceNumber, clientName: preparedAction.clientName },
          }).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[assistant/actionLog:invoice_pdf]', error)
          })
        }
        const safeNum = (preparedAction.invoiceNumber || 'factura').replace(/[^a-z0-9]/gi, '-').toLowerCase()
        const storagePath = `${workspaceId}/invoices/${safeNum}-${Date.now()}.pdf`
        const invoiceTitle = preparedAction.title || `Factura ${preparedAction.invoiceNumber ?? ''}`
        const pdfBytes = generateInvoicePdfBytes(invoiceTitle, content)
        let signedUrl: string | null = null
        let storageOk = false
        if (workspaceId) {
          try {
            await saveGeneratedDocument(workspaceId, {
              title: invoiceTitle,
              type: 'invoice_pdf',
              storageBucket: 'facturas-pdf',
              storagePath,
              mimeType: 'application/pdf',
              size: pdfBytes.length,
            }, pdfBytes)
            storageOk = true
            try {
              signedUrl = await getSignedDocumentUrl({ storageBucket: 'facturas-pdf', storagePath }, 600)
            } catch {
              // optional
            }
          } catch (storageError) {
            if (process.env.NODE_ENV === 'development') console.warn('[assistant/invoice_pdf:storage]', storageError)
          }
        }
        setLastGeneratedDocument({
          title: invoiceTitle,
          type: 'invoice_pdf',
          bucket: 'facturas-pdf',
          path: storagePath,
          signedUrl,
          createdAt: new Date().toISOString(),
        })
        let displayText: string
        if (storageOk && signedUrl) {
          displayText = `PDF generado correctamente. Puedes abrirlo aqui:\n${signedUrl}`
        } else if (storageOk) {
          displayText = `PDF generado y guardado. No se pudo obtener enlace firmado.`
        } else {
          displayText = `El PDF se genero, pero no se pudo guardar en Storage. Revisa conexion/RLS del bucket facturas-pdf.\n\nContenido:\n\n${content}`
        }
        await appendAssistantMessage(activeConversation.id, displayText, preparedAction.clientName)
        if (storageOk) {
          toast.success('Factura PDF guardada', { description: signedUrl ? 'Enlace disponible en el chat.' : 'Sin enlace firmado.' })
        } else {
          toast.info('PDF generado sin Storage', { description: 'Verifica RLS del bucket facturas-pdf.' })
        }
        setLastActionStatus('Última acción: factura PDF generada')
      }

      setPreparedAction(null)
      setEditingAction(false)
    } catch (error) {
      const errMsg = safeErrorMessage(error)
      if (process.env.NODE_ENV === 'development') {
        console.error('[confirmPreparedAction]', {
          type: preparedAction?.type,
          workspaceId,
          payload: debugPayload,
          error,
          message: errMsg,
          code: (error as Record<string, unknown>)?.code,
          details: (error as Record<string, unknown>)?.details,
          hint: (error as Record<string, unknown>)?.hint,
        })
      }
      toast.error('No se pudo confirmar la acción', {
        description: process.env.NODE_ENV === 'development'
          ? errMsg
          : 'Revisa los datos e inténtalo de nuevo.',
      })
    } finally {
      setConfirmingAction(false)
    }
  }

  const startEditingTitle = () => {
    setTitleDraft(selected?.clientName ?? '')
    setEditingTitle(true)
  }

  const cancelEditingTitle = () => {
    setEditingTitle(false)
    setTitleDraft('')
  }

  const saveTitle = async () => {
    const trimmed = titleDraft.trim() || 'Consulta Asistente IA'
    setEditingTitle(false)
    setTitleDraft('')
    if (!selected || trimmed === selected.clientName) return
    setConversationList((prev) => prev.map((c) => c.id === selected.id ? { ...c, clientName: trimmed } : c))
    if (isRealMode && workspaceId && isUuid(selected.id)) {
      void updateConversationTitle(selected.id, workspaceId, trimmed).catch(() => null)
    }
  }

  const cancelPreparedAction = () => {
    if (selected) {
      void appendAssistantMessage(selected.id, 'Acción cancelada.', selected.clientName).catch(() => null)
    }
    setPreparedAction(null)
    setEditingAction(false)
    setLastActionStatus('Última acción cancelada')
    toast.info('Acción descartada', { description: 'No se ha creado nada en el CRM.' })
  }

  const startEditingAction = () => {
    if (!preparedAction) return
    const d: Record<string, string> = { clientName: ('clientName' in preparedAction ? preparedAction.clientName : undefined) ?? '' }
    if (preparedAction.type === 'booking') {
      d.service = preparedAction.service ?? ''
      d.date = preparedAction.date ?? ''
      d.time = preparedAction.time ?? ''
      d.duration = preparedAction.duration?.toString() ?? ''
    } else if (preparedAction.type === 'invoice') {
      d.concept = preparedAction.concept ?? ''
      d.amount = preparedAction.amount?.toString() ?? ''
      d.dueDate = preparedAction.dueDate ?? ''
    } else if (preparedAction.type === 'task') {
      d.taskTitle = preparedAction.taskTitle ?? ''
      d.description = preparedAction.description ?? ''
      d.dueDate = preparedAction.dueDate ?? ''
    }
    setEditDraft(d)
    setEditingAction(true)
  }

  const saveEditDraft = () => {
    if (!preparedAction) return
    if (preparedAction.type === 'booking') {
      const duration = parseInt(editDraft.duration ?? '') || preparedAction.duration
      const next = {
        ...preparedAction,
        clientName: editDraft.clientName?.trim() || preparedAction.clientName,
        service: editDraft.service?.trim() || preparedAction.service,
        date: editDraft.date || preparedAction.date,
        time: editDraft.time || preparedAction.time,
        duration,
      }
      setPreparedAction({
        ...next,
        missingFields: [
          !next.clientName && 'cliente',
          !next.date && 'fecha',
          !next.time && 'hora',
        ].filter(Boolean) as string[],
      })
    } else if (preparedAction.type === 'invoice') {
      const amount = parseFloat((editDraft.amount ?? '').replace(',', '.')) || preparedAction.amount
      const next = {
        ...preparedAction,
        clientName: editDraft.clientName?.trim() || preparedAction.clientName,
        concept: editDraft.concept?.trim() || preparedAction.concept,
        amount,
        dueDate: editDraft.dueDate || preparedAction.dueDate,
      }
      setPreparedAction({
        ...next,
        missingFields: [
          !next.clientName && 'cliente',
          !next.amount && 'importe',
          !next.concept && 'concepto',
          !next.dueDate && 'vencimiento',
        ].filter(Boolean) as string[],
      })
    } else if (preparedAction.type === 'task') {
      setPreparedAction({
        ...preparedAction,
        clientName: editDraft.clientName?.trim() || preparedAction.clientName,
        taskTitle: editDraft.taskTitle?.trim() || preparedAction.taskTitle,
        description: editDraft.description?.trim() || preparedAction.description,
        dueDate: editDraft.dueDate || preparedAction.dueDate,
      })
    }
    setEditingAction(false)
  }

  const createDemoConversation = async () => {
    const isCopilot = assistantMode === 'copilot'
    const payload = {
      clientName: isCopilot ? (isRealMode ? 'Consulta Asistente IA' : 'Consulta Asistente IA (pruebas)') : (isRealMode ? 'Nueva conversación' : 'Lead de prueba'),
      clientAvatar: isCopilot ? 'CRM' : 'IN',
      channel: 'Web' as Channel,
      sentiment: 'neutral' as ConversationSentiment,
      intent: isCopilot ? 'Asistente IA' : 'Inbox Assistant',
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
        clientName: assistantMode === 'copilot' ? 'Test persistencia Asistente IA' : 'Test persistencia Inbox',
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
      const webhookForTest = assistantN8nActive ? assistantWebhookUrl : ''
      if (!webhookForTest) {
        toast.info('Automatizacion externa pendiente', { description: 'Configura un endpoint n8n real antes de probar este flujo.' })
        return
      }
      const testingMsg: Message = { id: `ai-${Date.now()}`, conversationId: activeConversation.id, content: 'Enviando mensaje de prueba al workflow externo del Asistente IA...', sender: 'ai', timestamp: nowTime() }
      appendLocalMessage(activeConversation.id, testingMsg)
      if (isRealMode && workspaceId && !OFFLINE_FORCE_DEV) await createMessage(activeConversation.id, { content: testingMsg.content, sender: 'ai', metadata: { source: 'assistant_n8n_test', assistant_mode: assistantMode } }, workspaceId)
      if (OFFLINE_FORCE_DEV) {
        setLastResponseSource('fallback')
        toast.warning('Modo offline: automatizacion externa pendiente', { description: 'Prueba de webhook ignorada en modo off-line local.' })
        return
      }
      const result = await triggerN8nWebhook('assistant_message', {
        workspace_id: workspaceId ?? undefined,
        webhook_url: webhookForTest,
        source: 'nowcrm',
        mode: workspaceId ? 'real' : 'demo',
        conversation: {
          id: 'test',
          client_name: 'Cliente de prueba',
          channel: 'whatsapp',
          sentiment: 'positive',
          intent: 'pricing',
        },
        message: { content: 'Mensaje de prueba del flujo n8n: consulta de ejemplo sobre una operación.' },
        client: { name: 'Cliente de prueba', status: 'lead' },
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
        toast.warning('Automatizacion externa no disponible', { description: result.message })
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
        const deletedId = selected.id
        setConversationList((prev) => {
          const next = prev.filter((conversation) => conversation.id !== deletedId)
          const nextSelected = next.find((conversation) => conversation.assistantMode === assistantMode)
          setSelectedIds((current) => ({ ...current, [assistantMode]: nextSelected?.id ?? '' }))
          return next
        })
        setLocalMessages((prev) => {
          const next = { ...prev }
          delete next[deletedId]
          return next
        })
        setReferencedClients((prev) => {
          const next = { ...prev }
          delete next[deletedId]
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
          description="Preparando el Asistente IA..."
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
            <p className="text-sm font-semibold text-gray-950">Preparando el Asistente IA...</p>
            <p className="mt-1 text-xs leading-5 text-gray-500">Cargando workspace, conversaciones y herramientas del CRM.</p>
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
        description="Asistente operativo del CRM: consultas internas, citas, facturas, tareas y acciones preparadas. Los mensajes reales de clientes viven en /inbox."
        action={
          <div className="flex items-center gap-2">
            <Badge variant={assistantMode === 'inbox' ? 'warning' : isRealMode ? 'success' : 'warning'} dot>{assistantMode === 'inbox' ? 'Inbox manual' : isRealMode ? 'Asistente IA activo' : 'Asistente IA en pruebas'}</Badge>
            {lastAgentMode && assistantMode !== 'inbox' && (
              <Badge variant={lastAgentMode === 'n8n' ? 'success' : lastAgentMode === 'hybrid_fallback' ? 'warning' : 'default'} dot>
                {lastAgentMode === 'n8n' ? 'Agente n8n' : lastAgentMode === 'hybrid_fallback' ? 'Modo respaldo' : 'Agente local'}
              </Badge>
            )}
            <Badge variant={isRealMode ? 'success' : 'indigo'} dot>{isRealMode ? 'Workspace real' : 'Modo demo'}</Badge>
            <Badge variant="indigo" dot>{assistantMode === 'inbox' ? 'Sin automatizacion falsa' : 'Acciones con confirmación'}</Badge>
            <Badge variant={assistantMode === 'inbox' && !waConnected ? 'warning' : 'indigo'} dot>
              {assistantMode === 'inbox'
                ? (waConnected
                    ? 'WhatsApp conectado'
                    : waStatus === 'webhook_pending' || waStatus === 'pending' || waStatus === 'prepared'
                      ? 'WhatsApp preparado · pendiente verificacion'
                      : 'WhatsApp pendiente')
                : 'WhatsApp siguiente fase'}
            </Badge>
            <Button size="sm" onClick={createDemoConversation}>
              <Plus className="h-3.5 w-3.5" />
              {assistantMode === 'inbox' ? (isRealMode ? 'Nueva conversación' : 'Nueva conversación demo') : 'Nueva consulta'}
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
                <Badge variant={isActive ? 'indigo' : 'default'}>
                  {mode.id === 'inbox'
                    ? (inboxSettings && Boolean(inboxSettings.auto_reply_enabled) ? 'Modo auto' : 'Modo manual')
                    : mode.badge}
                </Badge>
              </div>
              <p className="text-xs leading-5 text-gray-600">
                {mode.id === 'inbox'
                  ? (waConnected
                      ? (inboxSettings && Boolean(inboxSettings.auto_reply_enabled)
                          ? 'Modo automático activo. El agente responde directamente.'
                          : 'Modo manual activo. WhatsApp conectado. El agente sugiere y el operador confirma.')
                      : waStatus === 'webhook_pending' || waStatus === 'pending' || waStatus === 'prepared'
                        ? 'Inbox Assistant en modo manual. WhatsApp preparado pero pendiente de webhook Meta. Conecta y verifica el numero en Settings para recibir mensajes reales.'
                        : 'Inbox Assistant en modo manual. Conecta y verifica WhatsApp en Settings para recibir mensajes reales.')
                  : mode.description}
              </p>
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
                        <Badge variant={conv.assistantMode === 'copilot' ? 'indigo' : 'warning'} className="px-1.5 py-0 text-[10px]">{conv.assistantMode === 'copilot' ? 'Asistente IA' : 'Inbox'}</Badge>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
            {!loadingConversations && filteredConvs.length === 0 && (
              <li className="p-5 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                  {assistantMode === 'copilot' ? <Bot className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
                </div>
                <p className="text-sm font-semibold text-gray-800">{assistantMode === 'inbox' ? 'Sin conversaciones' : 'Aún no has hecho consultas al Asistente IA'}</p>
                <p className="mt-1 text-xs leading-4 text-gray-400">
                  {assistantMode === 'inbox'
                    ? 'Crea una conversación para empezar.'
                    : 'Abre una consulta para operar tu CRM con datos reales.'}
                </p>
                <button
                  onClick={createDemoConversation}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                >
                  <Plus className="h-3 w-3" />
                  {assistantMode === 'inbox' ? 'Nueva conversación' : 'Nueva consulta'}
                </button>
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
                    {assistantMode === 'copilot' && editingTitle ? (
                      <form onSubmit={(e) => { e.preventDefault(); void saveTitle() }} className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') cancelEditingTitle() }}
                          className="h-7 rounded-lg border border-indigo-300 bg-white px-2 text-sm font-semibold text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          style={{ width: Math.max(160, titleDraft.length * 8) }}
                        />
                        <button type="submit" className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50">Guardar</button>
                        <button type="button" onClick={cancelEditingTitle} className="rounded px-1.5 py-0.5 text-[11px] text-gray-400 hover:bg-gray-50">Cancelar</button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-gray-900">{selected.clientName}</p>
                        {assistantMode === 'copilot' && (
                          <button onClick={startEditingTitle} className="text-gray-300 transition-colors hover:text-indigo-500" aria-label="Editar título">
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    )}
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
                  const label = isAI ? (assistantMode === 'copilot' ? 'Asistente IA' : 'Inbox Assistant') : 'Tú'
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
                    <div className="max-w-[78%] rounded-2xl rounded-tl-sm border border-violet-100 bg-gradient-to-br from-white via-violet-50 to-indigo-50 p-4 shadow-md shadow-indigo-950/[0.05]">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div className={cn('flex h-8 w-8 items-center justify-center rounded-xl text-white shadow-sm', (preparedAction.type === 'cancel_booking' || preparedAction.type === 'cancel_multiple_bookings' || preparedAction.type === 'cleanup_duplicate_bookings') ? 'bg-red-500 shadow-red-500/20' : preparedAction.type === 'reschedule_booking' ? 'bg-amber-500 shadow-amber-500/20' : 'bg-violet-600 shadow-violet-600/20')}>
                            {preparedAction.type === 'booking' ? <CalendarDays className="h-4 w-4" /> : (preparedAction.type === 'cancel_booking' || preparedAction.type === 'cancel_multiple_bookings' || preparedAction.type === 'cleanup_duplicate_bookings') ? <X className="h-4 w-4" /> : preparedAction.type === 'reschedule_booking' ? <ArrowRight className="h-4 w-4" /> : preparedAction.type === 'task' ? <CheckCircle className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-950">
                              {preparedAction.type === 'booking' ? 'Crear cita' : preparedAction.type === 'invoice' ? 'Crear factura' : preparedAction.type === 'task' ? 'Crear tarea' : preparedAction.type === 'cancel_booking' ? 'Cancelar cita' : preparedAction.type === 'reschedule_booking' ? 'Reprogramar cita' : preparedAction.type === 'cancel_multiple_bookings' ? 'Cancelar varias citas' : preparedAction.type === 'cleanup_duplicate_bookings' ? 'Limpiar duplicados' : preparedAction.type === 'generate_invoice_pdf' ? 'PDF de factura' : 'PDF de informe'}
                            </p>
                            <p className="text-[11px] text-gray-500">{preparedAction.title} · Asistente IA</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {preparedAction.type !== 'prepare_pdf' && preparedAction.type !== 'generate_invoice_pdf' && preparedAction.type !== 'cancel_booking' && preparedAction.type !== 'reschedule_booking' && preparedAction.type !== 'cancel_multiple_bookings' && preparedAction.type !== 'cleanup_duplicate_bookings' && !editingAction && (
                            <button onClick={startEditingAction} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-gray-500 transition-colors hover:bg-white/70 hover:text-indigo-600">
                              <Pencil className="h-3 w-3" />
                              Editar
                            </button>
                          )}
                          <Badge variant={editingAction ? 'indigo' : 'warning'} dot>{editingAction ? 'Editando' : 'Confirmar'}</Badge>
                        </div>
                      </div>

                      {editingAction ? (
                        <div className="grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
                          <div className="rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                            <span className="block text-[10px] font-semibold uppercase text-gray-400">Cliente</span>
                            <input value={editDraft.clientName ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, clientName: e.target.value }))} placeholder="Nombre del cliente" className="mt-0.5 w-full bg-transparent text-xs outline-none placeholder:text-gray-300 focus:text-gray-900" />
                          </div>
                          {preparedAction.type === 'booking' && (
                            <>
                              <div className="rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Servicio</span>
                                <input value={editDraft.service ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, service: e.target.value }))} placeholder="Corte, demo, reunión…" className="mt-0.5 w-full bg-transparent text-xs outline-none placeholder:text-gray-300 focus:text-gray-900" />
                              </div>
                              <div className="rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Fecha</span>
                                <input type="date" value={editDraft.date ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, date: e.target.value }))} className="mt-0.5 w-full bg-transparent text-xs outline-none focus:text-gray-900" />
                              </div>
                              <div className="rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Hora</span>
                                <input type="time" value={editDraft.time ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, time: e.target.value }))} className="mt-0.5 w-full bg-transparent text-xs outline-none focus:text-gray-900" />
                              </div>
                              <div className="rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Duración (min)</span>
                                <input type="number" min="15" max="480" value={editDraft.duration ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, duration: e.target.value }))} placeholder="60" className="mt-0.5 w-full bg-transparent text-xs outline-none placeholder:text-gray-300 focus:text-gray-900" />
                              </div>
                            </>
                          )}
                          {preparedAction.type === 'invoice' && (
                            <>
                              <div className="rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Concepto</span>
                                <input value={editDraft.concept ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, concept: e.target.value }))} placeholder="Plan Pro, Consultoría…" className="mt-0.5 w-full bg-transparent text-xs outline-none placeholder:text-gray-300 focus:text-gray-900" />
                              </div>
                              <div className="rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Importe (EUR)</span>
                                <input type="number" min="0" step="0.01" value={editDraft.amount ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, amount: e.target.value }))} placeholder="299" className="mt-0.5 w-full bg-transparent text-xs outline-none placeholder:text-gray-300 focus:text-gray-900" />
                              </div>
                              <div className="rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Vencimiento</span>
                                <input type="date" value={editDraft.dueDate ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, dueDate: e.target.value }))} className="mt-0.5 w-full bg-transparent text-xs outline-none focus:text-gray-900" />
                              </div>
                            </>
                          )}
                          {preparedAction.type === 'task' && (
                            <>
                              <div className="col-span-2 rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Título de tarea</span>
                                <input value={editDraft.taskTitle ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, taskTitle: e.target.value }))} placeholder="Llamar a cliente…" className="mt-0.5 w-full bg-transparent text-xs outline-none placeholder:text-gray-300 focus:text-gray-900" />
                              </div>
                              <div className="rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Vencimiento</span>
                                <input type="date" value={editDraft.dueDate ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, dueDate: e.target.value }))} className="mt-0.5 w-full bg-transparent text-xs outline-none focus:text-gray-900" />
                              </div>
                              <div className="rounded-lg bg-white/90 p-2 ring-1 ring-indigo-200">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Descripción</span>
                                <input value={editDraft.description ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Opcional…" className="mt-0.5 w-full bg-transparent text-xs outline-none placeholder:text-gray-300 focus:text-gray-900" />
                              </div>
                            </>
                          )}
                          <div className="col-span-2 flex justify-end gap-2 pt-1">
                            <button onClick={() => setEditingAction(false)} className="rounded-lg px-2.5 py-1 text-xs text-gray-500 transition-colors hover:bg-white/70 hover:text-gray-700">
                              Cancelar edición
                            </button>
                            <button onClick={saveEditDraft} className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-indigo-700">
                              Guardar cambios
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
                          {'clientName' in preparedAction && preparedAction.clientName && (
                            <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                              <span className="block text-[10px] font-semibold uppercase text-gray-400">Cliente</span>
                              {preparedAction.clientName}
                            </div>
                          )}
                          {preparedAction.type === 'booking' && (
                            <>
                              <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Servicio</span>
                                {preparedAction.service ?? 'Pendiente'}
                              </div>
                              <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Fecha y hora</span>
                                {preparedAction.date ?? 'Pendiente'} · {preparedAction.time ?? 'Pendiente'}
                              </div>
                              <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Duración</span>
                                {preparedAction.duration ? `${preparedAction.duration} min` : 'Pendiente'}
                              </div>
                            </>
                          )}
                          {preparedAction.type === 'invoice' && (
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
                          {preparedAction.type === 'task' && (
                            <>
                              <div className="col-span-2 rounded-lg bg-white/75 p-2 ring-1 ring-white">
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">Tarea</span>
                                {preparedAction.taskTitle ?? 'Pendiente'}
                              </div>
                              {preparedAction.dueDate && (
                                <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                                  <span className="block text-[10px] font-semibold uppercase text-gray-400">Vence</span>
                                  {preparedAction.dueDate}
                                </div>
                              )}
                              {preparedAction.description && (
                                <div className={preparedAction.dueDate ? 'rounded-lg bg-white/75 p-2 ring-1 ring-white' : 'col-span-2 rounded-lg bg-white/75 p-2 ring-1 ring-white'}>
                                  <span className="block text-[10px] font-semibold uppercase text-gray-400">Descripción</span>
                                  {preparedAction.description}
                                </div>
                              )}
                            </>
                          )}
                          {preparedAction.type === 'cancel_booking' && (
                            <>
                              {preparedAction.date && (
                                <div className="rounded-lg bg-red-50/80 p-2 ring-1 ring-red-100">
                                  <span className="block text-[10px] font-semibold uppercase text-red-400">Fecha</span>
                                  {preparedAction.date}{preparedAction.time ? ` · ${preparedAction.time}` : ''}
                                </div>
                              )}
                              {preparedAction.reason && (
                                <div className="col-span-2 rounded-lg bg-red-50/80 p-2 ring-1 ring-red-100">
                                  <span className="block text-[10px] font-semibold uppercase text-red-400">Motivo</span>
                                  {preparedAction.reason}
                                </div>
                              )}
                              <div className="col-span-2 rounded-lg border border-red-100 bg-red-50 p-2 text-[11px] text-red-600">
                                Esta acción cancelará la cita en el CRM. No se puede deshacer.
                              </div>
                            </>
                          )}
                          {preparedAction.type === 'reschedule_booking' && (
                            <>
                              {(preparedAction.oldDate || preparedAction.oldTime) && (
                                <div className="rounded-lg bg-amber-50/80 p-2 ring-1 ring-amber-100">
                                  <span className="block text-[10px] font-semibold uppercase text-amber-500">Fecha actual</span>
                                  {preparedAction.oldDate ?? '—'}{preparedAction.oldTime ? ` · ${preparedAction.oldTime}` : ''}
                                </div>
                              )}
                              {(preparedAction.date || preparedAction.time) && (
                                <div className="rounded-lg bg-amber-50/80 p-2 ring-1 ring-amber-100">
                                  <span className="block text-[10px] font-semibold uppercase text-amber-500">Nueva fecha</span>
                                  {preparedAction.date ?? '—'}{preparedAction.time ? ` · ${preparedAction.time}` : ''}
                                </div>
                              )}
                              <div className="col-span-2 rounded-lg border border-amber-100 bg-amber-50 p-2 text-[11px] text-amber-700">
                                Se actualizará la fecha y hora de la cita en el CRM.
                              </div>
                            </>
                          )}
                          {preparedAction.type === 'cancel_multiple_bookings' && (
                            <>
                              <div className="col-span-2 rounded-lg bg-red-50/80 p-2 ring-1 ring-red-100">
                                <span className="block text-[10px] font-semibold uppercase text-red-400">Citas a cancelar ({preparedAction.events.length})</span>
                                <div className="mt-1 space-y-0.5">
                                  {preparedAction.events.slice(0, 5).map((ev, i) => (
                                    <div key={`cancel-multi-${ev.eventId}-${i}`} className="text-xs text-gray-700">
                                      {i + 1}. {[ev.clientName, ev.date, ev.time].filter(Boolean).join(' · ') || `Cita ${i + 1}`}
                                    </div>
                                  ))}
                                  {preparedAction.events.length > 5 && (
                                    <div className="text-[11px] text-red-400">+{preparedAction.events.length - 5} más</div>
                                  )}
                                </div>
                              </div>
                              <div className="col-span-2 rounded-lg border border-red-100 bg-red-50 p-2 text-[11px] text-red-600">
                                Se cancelarán las {preparedAction.events.length} citas en el CRM. No se puede deshacer.
                              </div>
                            </>
                          )}
                          {preparedAction.type === 'cleanup_duplicate_bookings' && (
                            <>
                              {(() => {
                                const keepEv = preparedAction.events.find(e => e.eventId === preparedAction.keepEventId)
                                return (
                                  <div className="rounded-lg bg-green-50/80 p-2 ring-1 ring-green-100">
                                    <span className="block text-[10px] font-semibold uppercase text-green-500">Se conserva</span>
                                    <span className="text-xs text-gray-700">
                                      {keepEv ? [keepEv.clientName, keepEv.date, keepEv.time].filter(Boolean).join(' · ') : 'Primera cita'}
                                    </span>
                                  </div>
                                )
                              })()}
                              <div className="rounded-lg bg-red-50/80 p-2 ring-1 ring-red-100">
                                <span className="block text-[10px] font-semibold uppercase text-red-400">Se cancelan ({preparedAction.cancelEventIds.length})</span>
                                <div className="mt-1 space-y-0.5">
                                  {preparedAction.events
                                    .filter(e => preparedAction.cancelEventIds.includes(e.eventId))
                                    .slice(0, 3)
                                    .map((ev, i) => (
                                      <div key={`cleanup-cancel-${ev.eventId}-${i}`} className="text-xs text-gray-700">
                                        {i + 1}. {[ev.clientName, ev.date, ev.time].filter(Boolean).join(' · ') || `Cita ${i + 1}`}
                                      </div>
                                    ))}
                                  {preparedAction.cancelEventIds.length > 3 && (
                                    <div className="text-[11px] text-red-400">+{preparedAction.cancelEventIds.length - 3} más</div>
                                  )}
                                </div>
                              </div>
                              <div className="col-span-2 rounded-lg border border-red-100 bg-red-50 p-2 text-[11px] text-red-600">
                                Se cancelarán {preparedAction.cancelEventIds.length} cita(s) duplicada(s) y se conservará una.
                              </div>
                            </>
                          )}
                          {preparedAction.type === 'prepare_pdf' && preparedAction.reportText && (
                            <div className="col-span-2 max-h-32 overflow-y-auto rounded-lg bg-white/75 p-2 ring-1 ring-white">
                              <span className="block text-[10px] font-semibold uppercase text-gray-400">Vista previa del informe</span>
                              <pre className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-gray-600">{preparedAction.reportText.slice(0, 600)}{preparedAction.reportText.length > 600 ? '\n…' : ''}</pre>
                            </div>
                          )}
                          {preparedAction.type === 'generate_invoice_pdf' && (
                            <>
                              {preparedAction.invoiceNumber && (
                                <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                                  <span className="block text-[10px] font-semibold uppercase text-gray-400">Factura</span>
                                  {preparedAction.invoiceNumber}
                                </div>
                              )}
                              {preparedAction.amount !== undefined && (
                                <div className="rounded-lg bg-white/75 p-2 ring-1 ring-white">
                                  <span className="block text-[10px] font-semibold uppercase text-gray-400">Importe</span>
                                  {`${preparedAction.amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${preparedAction.currency ?? 'EUR'}`}
                                </div>
                              )}
                              {preparedAction.invoiceText && (
                                <div className="col-span-2 max-h-32 overflow-y-auto rounded-lg bg-white/75 p-2 ring-1 ring-white">
                                  <span className="block text-[10px] font-semibold uppercase text-gray-400">Vista previa de factura</span>
                                  <pre className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-gray-600">{preparedAction.invoiceText.slice(0, 400)}{preparedAction.invoiceText.length > 400 ? '\n…' : ''}</pre>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {!editingAction && preparedAction.missingFields.length > 0 && (
                        <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs font-medium text-amber-700">
                          Faltan datos: {missingText(preparedAction.missingFields)}. Escríbelos en el chat o pulsa Editar para completarlos.
                        </p>
                      )}
                      {!editingAction && 'notes' in preparedAction && preparedAction.notes && (
                        <p className="mt-2 rounded-lg bg-white/70 p-2 text-xs leading-5 text-gray-500">{preparedAction.notes}</p>
                      )}

                      <div className="mt-3 flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={cancelPreparedAction} disabled={confirmingAction || editingAction}>
                          <X className="h-3.5 w-3.5" />
                          {preparedAction.type === 'cancel_booking' ? 'Mantener cita' : preparedAction.type === 'reschedule_booking' ? 'No reprogramar' : (preparedAction.type === 'cancel_multiple_bookings' || preparedAction.type === 'cleanup_duplicate_bookings') ? 'Mantener citas' : 'Cancelar'}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void confirmPreparedAction()}
                          loading={confirmingAction}
                          disabled={preparedAction.missingFields.length > 0 || editingAction || confirmingAction}
                          className={(preparedAction.type === 'cancel_booking' || preparedAction.type === 'cancel_multiple_bookings' || preparedAction.type === 'cleanup_duplicate_bookings') ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500' : preparedAction.type === 'reschedule_booking' ? 'bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-400' : ''}
                        >
                          {(preparedAction.type === 'cancel_booking' || preparedAction.type === 'cancel_multiple_bookings' || preparedAction.type === 'cleanup_duplicate_bookings') ? <X className="h-3.5 w-3.5" /> : preparedAction.type === 'reschedule_booking' ? <ArrowRight className="h-3.5 w-3.5" /> : <CheckCircle className="h-3.5 w-3.5" />}
                          {preparedAction.missingFields.length ? 'Faltan datos' :
                            preparedAction.type === 'booking' ? 'Confirmar cita' :
                            preparedAction.type === 'invoice' ? 'Confirmar factura' :
                            preparedAction.type === 'task' ? 'Crear tarea' :
                            preparedAction.type === 'cancel_booking' ? 'Confirmar cancelación' :
                            preparedAction.type === 'reschedule_booking' ? 'Confirmar reprogramación' :
                            preparedAction.type === 'cancel_multiple_bookings' ? 'Confirmar cancelación' :
                            preparedAction.type === 'cleanup_duplicate_bookings' ? 'Confirmar limpieza' :
                            preparedAction.type === 'generate_invoice_pdf' ? 'Guardar factura PDF' :
                            'Guardar informe'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-indigo-100 bg-indigo-50 px-4 py-2.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
                      <span className="text-xs text-indigo-600">{isRealMode ? 'Asistente IA consultando el CRM...' : 'Asistente IA generando respuesta...'}</span>
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
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={assistantMode === 'inbox' ? 'Escribe tu mensaje...' : 'Pide al asistente IA que opere tu CRM...'} rows={1} className="max-h-28 flex-1 resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder:text-gray-400 shadow-sm shadow-gray-950/[0.025] transition-all focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() } }} />
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
                    ? 'Crea una conversación para probar el Assistant. Cuando conectes WhatsApp Business, los mensajes reales aparecerán aquí.'
                    : 'Abre una consulta interna para que el Asistente IA opere tu CRM: clientes, calendario, facturas, cobros y próximas acciones.'}
                </p>
                <div className="mx-auto mt-3 grid max-w-sm gap-1.5 text-left">
                  {capabilityExamples.slice(0, 4).map((example) => (
                    <span key={example} className="rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">{example}</span>
                  ))}
                </div>
                <Button className="mt-4" size="sm" onClick={createDemoConversation}><Plus className="h-3.5 w-3.5" />{assistantMode === 'inbox' ? (isRealMode ? 'Nueva conversación' : 'Nueva conversación demo') : 'Nueva consulta'}</Button>
              </div>
            </div>
          )}
        </div>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-indigo-100 bg-[linear-gradient(180deg,#eef2ff_0%,#ffffff_44%,#f5f3ff_100%)]">
          <div className="border-b border-indigo-100 bg-gradient-to-r from-indigo-600 to-violet-700 px-4 py-3.5 text-white shadow-sm shadow-indigo-950/10">
            <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-indigo-100" /><h3 className="text-sm font-semibold">{assistantMode === 'copilot' ? 'Asistente IA' : 'Inbox Assistant'}</h3></div>
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
                    <p className="mt-2 text-[10px] leading-4 text-emerald-700">Tools y confirmaciones preparadas para operar datos del CRM sin ejecutar escrituras peligrosas.</p>
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
              <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /><span className="text-[10px] text-emerald-700">{assistantN8nActive ? 'Asistente IA conectado' : isRealMode ? 'Workspace activo · automatización pendiente' : 'Asistente IA en pruebas'}</span></div>
              <p className="mt-1 text-[10px] text-emerald-600">{assistantN8nActive ? 'Asistente IA respondiendo desde el backend.' : isRealMode ? 'Aún no hay flujo externo activo para este workspace.' : 'Siguiente paso: activar el Asistente IA en Configuración.'}</p>
              {assistantMode === 'inbox' ? (
                <>
                  <p className="mt-1 text-[10px] text-emerald-600">Respuesta automatica desactivada.</p>
                  <p className="mt-1 text-[10px] text-emerald-600">Meta Business API pendiente de conexión.</p>
                  <p className="mt-1 text-[10px] text-emerald-600">Modo manual para evitar respuestas falsas.</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-[10px] text-emerald-600">Calendar tools preparadas.</p>
                  <p className="mt-1 text-[10px] text-emerald-600">Confirmación requerida para escrituras.</p>
                  <p className="mt-1 text-[10px] text-emerald-600">Backend seguro disponible.</p>
                </>
              )}
              {lastResponseSource === 'n8n' && <p className="mt-1 rounded-lg bg-white/75 px-2 py-1 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-100">Última respuesta por automatización externa</p>}
              {lastActionStatus && <p className="mt-1 rounded-lg bg-white/75 px-2 py-1 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-100">{lastActionStatus}</p>}
              {lastResponseSource === 'fallback' && <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100">Última respuesta local</p>}
              {lastResponseSource === 'supabase' && <p className="mt-1 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 ring-1 ring-blue-100">Última respuesta por agente backend</p>}
            </div>

            {assistantMode === 'copilot' && lastGeneratedDocument && (
              <div className="rounded-2xl border border-indigo-100 bg-white/85 p-3 shadow-sm shadow-indigo-950/[0.035] ring-1 ring-indigo-100/50">
                <p className="mb-2 text-[10px] font-semibold uppercase text-gray-400">Último documento generado</p>
                <p className="truncate text-xs font-semibold text-gray-800">{lastGeneratedDocument.title}</p>
                <p className="mt-0.5 text-[10px] text-gray-500">{lastGeneratedDocument.type === 'invoice_pdf' ? 'Factura PDF' : 'Informe de cliente'}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">{(() => { try { return new Date(lastGeneratedDocument.createdAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return lastGeneratedDocument.createdAt } })()}</p>
                {lastGeneratedDocument.signedUrl ? (
                  <a
                    href={lastGeneratedDocument.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-100 transition-colors hover:bg-indigo-100"
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    Abrir documento
                  </a>
                ) : (
                  <p className="mt-2 rounded-lg bg-gray-50 px-2 py-1 text-[10px] text-gray-400 ring-1 ring-gray-100">Guardado · enlace no disponible (RLS)</p>
                )}
              </div>
            )}

            <div className="rounded-2xl border border-indigo-100 bg-white/85 p-3 shadow-sm shadow-indigo-950/[0.035] ring-1 ring-indigo-100/50">
              <p className="mb-2 text-[10px] font-semibold uppercase text-gray-400">{assistantMode === 'copilot' ? 'Asistente IA' : 'Inbox Assistant'}</p>
              <div className="flex flex-wrap gap-1.5">
                {(assistantMode === 'copilot' ? capabilities : inboxCapabilities.map((_, index) => ['Conversaciones', 'Meta API próximo', 'Modo manual'][index]).filter(Boolean)).map((capability) => (
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
                  Inbox Assistant es la capa para conversaciones de clientes. Ahora trabaja sobre mensajes persistentes; cuando conectes WhatsApp Business, los mensajes entrantes caerán aquí.
                </p>
              )}
              <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-medium leading-5 text-amber-800">
                Las acciones importantes requieren confirmación antes de guardarse.
              </p>
              <p className="mt-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-[11px] leading-5 text-violet-800">
                WhatsApp Business (Meta Cloud API) es la siguiente fase: recibirás mensajes reales y los convertirás en clientes, citas o seguimientos dentro del CRM.
              </p>
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-white/85 p-3 shadow-sm shadow-indigo-950/[0.035] ring-1 ring-indigo-100/50">
              <p className="mb-2 text-[10px] font-semibold uppercase text-gray-400">Recomendación IA</p>
              <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-3">
                <p className="text-xs leading-relaxed text-indigo-800">
                  {assistantMode === 'inbox'
                    ? selected ? selected.sentiment === 'positive' ? 'Cliente con buena intención. Propón siguiente paso y prepara cita o seguimiento.' : selected.sentiment === 'negative' ? 'Prioriza tono empático y escala la conversación antes de automatizar.' : 'Responde con contexto y pide el dato mínimo para avanzar.' : 'Crea una conversación para simular mensajes entrantes de clientes.'
                    : selected ? 'Usa el Asistente IA para consultar datos reales, preparar acciones y confirmar antes de escribir en el CRM.' : 'Crea una consulta para operar clientes, facturas, calendario y cobros desde el CRM.'}
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
