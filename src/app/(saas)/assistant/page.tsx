'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Bot, CalendarDays, CheckCircle, FileText, Loader2, Mail, MessageSquare, Pencil, Phone, Plus, Search, Send, Target, X, Zap } from 'lucide-react'
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
import { generateReportPdfBytes, generateInvoicePdfBytes } from '@/lib/pdf/simple-pdf'
import { buildCalendarEventTimes } from '@/lib/calendar-time'
import {
  createActivity,
  createCalendarEvent,
  createAssistantConversation,
  createInvoice,
  createMessage,
  createAgentActionLog,
  createTask,
  deleteConversationPermanently,
  getAssistantConversationById,
  getAssistantConversations,
  getConversationMessages,
  getClientStats,
  getInboxAgentSettings,
  getN8nFlows,
  getPendingInvoices,
  getResolvedWorkspaceContext,
  getSignedDocumentUrl,
  getUpcomingCalendarEvents,
  getWhatsappConnection,
  getWorkspaceSummary,
  getNextBestActions,
  mapSupabaseClient,
  saveGeneratedDocument,
  searchClients,
  updateConversationScoped,
  updateConversationTitle,
  getClientInvoices,
  getClientCalendarEvents,
  getClientConversations,
  getClientActivities,
} from '@/lib/supabase-queries'
import type { AssistantMode, Channel, Conversation, ConversationSentiment, Message, MessageSender, N8nFlowStatus } from '@/lib/types'

const SHOW_ASSISTANT_DEBUG = process.env.NEXT_PUBLIC_SHOW_DEBUG_PANEL === 'true'
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
const inboxManualPrompts: Array<{ label: string; prompt: string; intent: string; sender?: MessageSender }> = [
  { label: 'Estado conexion', prompt: 'Estado de conexion Inbox Assistant', intent: 'manual_status', sender: 'agent' },
  { label: 'Modo manual', prompt: 'Modo manual Inbox Assistant', intent: 'manual_mode', sender: 'agent' },
  { label: 'Pendiente Whapi/n8n', prompt: 'Pendiente de conectar Whapi/n8n', intent: 'pending_connection', sender: 'agent' },
]
const INBOX_MANUAL_RESPONSE = 'Inbox Assistant esta preparado para conectar Whapi/n8n. De momento la respuesta automatica esta desactivada para evitar respuestas falsas; puedes seguir usando esta bandeja en modo manual.'

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
  | {
      id: string
      type: 'task'
      title: string
      assistantMode: AssistantMode
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

function isGenericConversationName(value?: string) {
  return !value || /nuevo lead|lead demo|cliente demo|sin cliente|asistente interno|consulta crm|operacion comercial|operación comercial/i.test(value)
}

function normalizeInput(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function extractTaskTitle(message: string): string | undefined {
  const t = message.trim()
  const patterns: [RegExp, number | null][] = [
    [/recuérdame(?:\s+que\s+tengo\s+que|\s+de)?\s+(.+)/i, 1],
    [/recuerdame(?:\s+que\s+tengo\s+que|\s+de)?\s+(.+)/i, 1],
    [/crea\s+(?:una?\s+)?tarea\s+(?:de\s+|para\s+|sobre\s+|:\s*)(.+)/i, 1],
    [/pon\s+(?:una?\s+)?tarea\s+(?:de\s+|para\s+|sobre\s+|:\s*)(.+)/i, 1],
    [/agrega\s+(?:una?\s+)?tarea\s+(?:de\s+|para\s+|sobre\s+|:\s*)(.+)/i, 1],
    [/añade\s+(?:una?\s+)?tarea\s+(?:de\s+|para\s+|sobre\s+|:\s*)(.+)/i, 1],
    [/tarea\s+de\s+seguimiento\b/i, null],
  ]
  for (const [pattern, group] of patterns) {
    const match = t.match(pattern)
    if (match) return group !== null ? match[group]?.trim().replace(/\.?\s*$/, '') : 'Seguimiento'
  }
  return undefined
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
      notes: 'Cita preparada desde NowLabs AI. Requiere confirmacion.',
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
      notes: 'Factura preparada desde NowLabs AI. Requiere confirmación.',
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

function todayIsoLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split('-').map(Number)
  const date = new Date(year, (month || 1) - 1, day || 1)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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

  return 'Herramienta ejecutada. Resultado disponible en NowLabs AI.'
}

function normalizeQuery(value: string) {
  return normalizeInput(value).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function detectCopilotCRMQuery(value: string, lastReferencedClientName?: string, lastReferencedClientId?: string) {
  const text = normalizeInput(value)
  const hasRef = Boolean(lastReferencedClientName || lastReferencedClientId)

  // Ficha rápida de datos básicos del cliente referenciado
  if (/\b(sus datos|su correo|su email|su telefono|su empresa|todos sus datos|dame todos sus datos|pasame sus datos|dame su email|dame su telefono|dame su empresa|dame su telefono|pasa sus datos)\b/.test(text)) {
    return hasRef ? 'client_data_card' : 'no_client_referenced'
  }

  // Informe del último cliente (con o sin "último" explícito)
  if (/\b(informe del ultimo cliente|informe del ultima|hazme un informe del ultimo)\b/.test(text)) return 'latest_client_report'

  // Informe / resumen del cliente referenciado
  if (/\b(informe de ese|informe de el|informe de este|resumen de ese|resumen de este|todos los datos|dame todo lo que tengas|hazme un informe)\b/.test(text)) {
    return hasRef ? 'client_report_referenced' : 'no_client_referenced'
  }

  // Informe de ese/este cliente
  if (/\b(ese cliente|este cliente)\b/.test(text)) {
    return hasRef ? 'client_report_referenced' : 'no_client_referenced'
  }

  // Último cliente registrado (sin requerir palabra de tiempo)
  if (/\b(ultimo|ultima) cliente\b/.test(text)) return 'latest_client'

  if (/\b(cuantos clientes|numero de clientes|clientes tengo|total de clientes)\b/.test(text)) return 'client_count'
  if (/\b(buscar clientes|busca clientes|encuentra clientes|nombres de cliente|clientes con)\b/.test(text)) return 'search_clients'
  if (/\b(resume|hazme un informe|informe de|detalles de|resumen de)\b/.test(text) && /\bcliente\b/.test(text)) return 'client_report'
  if (/\b(facturas pendientes|pendientes de pago|cobros pendientes|facturas sin pagar|facturas abiertas)\b/.test(text)) return 'pending_invoices'
  // Invoice creation — checked after pending_invoices
  if (
    /\b(crea(?:r)?|haz|hacer|prepara(?:r)?|factura(?:r)?)\b/.test(text) &&
    /\bfactura\b/.test(text)
  ) return 'create_invoice'
  if (/\bfactura\s+\d/.test(text)) return 'create_invoice'
  // Booking creation — checked before upcoming_events to avoid "agenda" ambiguity
  if (
    /\b(crear?|agendar?|reservar?|pon|preparar?|programar?)\b/.test(text) &&
    /\b(cita|reunion)\b/.test(text)
  ) return 'create_booking'
  if (/\b(citas proximas|proximas citas|agenda|calendario|reuniones proximas|que tengo manana|que tengo maÃ±ana|tengo algo|esta semana|cita con|reunion con)\b/.test(text)) return 'upcoming_events'
  if (/\b(resume mi crm|resumen crm|estado crm|como va mi crm|situacion crm)\b/.test(text)) return 'workspace_summary'
  if (/\b(proxima accion|siguiente accion|que hago|prioridad|siguiente paso|accion comercial)\b/.test(text)) return 'next_action'

  // Invoice PDF — check before general PDF
  if (/\b(pdf de (la |esta |una )?factura|factura (en |a |como )?pdf|genera(r)? (el |un )?pdf (de|para) (la|esta|una) factura|crea(r)? pdf (de|para) (la|esta|una) factura|pasa(me)? (la )?factura (a|en) pdf|descarga(r)? (la )?factura)\b/.test(text)) {
    return 'generate_invoice_pdf'
  }

  // Client report PDF export
  if (/\b(pdf|genera pdf|generar pdf|pasalo a pdf|pasa(me)? a pdf|informe pdf|descarga|exportar informe)\b/.test(text)) {
    return hasRef ? 'prepare_pdf' : 'no_client_referenced'
  }

  // Task creation
  if (/\b(crea|pon|agrega|añade|recuerdame|recuérdame)\b/.test(text) && /\b(tarea|recordatorio|seguimiento)\b/.test(text)) return 'create_task'
  if (/\b(recuerdame|recuérdame)\s+/.test(text)) return 'create_task'

  return null
}

function generateClientDataCard(clientData: Record<string, unknown>): string {
  const client = mapSupabaseClient(clientData)
  const rawDate = String(clientData.created_at || '')
  const fechaRegistro = rawDate ? (() => { try { return new Date(rawDate).toLocaleDateString('es-ES') } catch { return 'No consta' } })() : 'No consta'
  return [
    `DATOS DEL CLIENTE: ${client.name.toUpperCase()}\n`,
    `- Nombre: ${client.name || 'No consta'}`,
    `- Empresa: ${client.company || 'No consta'}`,
    `- Email: ${client.email || 'No consta'}`,
    `- Teléfono: ${client.phone || 'No consta'}`,
    `- Canal: ${client.channel || 'No consta'}`,
    `- Estado: ${client.status || 'No consta'}`,
    `- Lead score: ${client.leadScore ?? 'No consta'}`,
    `- Notas: ${client.notes || 'No consta'}`,
    `- Fecha de registro: ${fechaRegistro}`,
  ].join('\n')
}

type ClientReportContext = {
  client: ReturnType<typeof mapSupabaseClient>
  createdAt: string
  invoices: Awaited<ReturnType<typeof getClientInvoices>>
  events: Awaited<ReturnType<typeof getClientCalendarEvents>>
  conversations: Awaited<ReturnType<typeof getClientConversations>>
  activities: Awaited<ReturnType<typeof getClientActivities>>
}

function buildClientReportText(ctx: ClientReportContext): string {
  const { client, createdAt, invoices, events, conversations, activities } = ctx
  const fechaRegistro = createdAt
    ? (() => { try { return new Date(createdAt).toLocaleDateString('es-ES') } catch { return 'No consta' } })()
    : 'No consta'
  const generatedAt = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })
  const totalFacturado = invoices.reduce((sum, i) => sum + i.amount, 0)
  const facturasPendientes = invoices.filter((i) => i.status === 'pending' || i.status === 'overdue').length
  const facturasPagadas = invoices.filter((i) => i.status === 'paid').length
  const ultimaActividad = activities.length > 0 ? (activities[0].description || 'Sin registros') : 'Sin registros'
  const sections = [
    `INFORME DE CLIENTE — ${(client.name || 'CLIENTE').toUpperCase()}\n`,
    `Generado: ${generatedAt}`,
    `\n1. RESUMEN EJECUTIVO`,
    `- Cliente: ${client.name || 'No consta'} (${client.status || 'No consta'})`,
    `- Total facturado: ${totalFacturado.toLocaleString('es-ES', { minimumFractionDigits: 2 })} EUR`,
    `- Facturas pendientes: ${facturasPendientes}`,
    `- Facturas pagadas: ${facturasPagadas}`,
    `- Citas registradas: ${events.length}`,
    `- Ultima actividad: ${ultimaActividad}`,
    `\n2. DATOS BASICOS`,
    `- Nombre: ${client.name || 'No consta'}`,
    `- Empresa: ${client.company || 'No consta'}`,
    `- Fecha de registro: ${fechaRegistro}`,
    `\n3. CONTACTO`,
    `- Email: ${client.email || 'No consta'}`,
    `- Telefono: ${client.phone || 'No consta'}`,
    `- Canal principal: ${client.channel || 'No consta'}`,
    `\n4. ESTADO COMERCIAL`,
    `- Estado: ${client.status || 'No consta'}`,
    `- Lead Score: ${client.leadScore || 'No consta'}`,
    `- Notas: ${client.notes || 'No consta'}`,
    `\n5. FACTURACION`,
    invoices.length
      ? invoices.map((i) => `- ${i.plan || 'Concepto'}: ${i.amount.toLocaleString('es-ES', { minimumFractionDigits: 2 })} EUR (${i.status}) vence ${i.dueDate}`).join('\n')
      : '- No hay datos registrados.',
    `\n6. CALENDARIO`,
    events.length
      ? events.map((e) => `- ${e.title} el ${e.date} a las ${String(e.startHour).padStart(2, '0')}:${String(e.startMinute).padStart(2, '0')} (${e.duration} min)`).join('\n')
      : '- No hay datos registrados.',
    `\n7. CONVERSACIONES`,
    conversations.length
      ? conversations.map((c) => `- ${c.lastMessage} (${c.sentiment})`).join('\n')
      : '- No hay datos registrados.',
    `\n8. ACTIVIDAD RECIENTE`,
    activities.length
      ? activities.slice(0, 5).map((a) => `- [${a.type}] ${a.description}`).join('\n')
      : '- No hay datos registrados.',
    `\n9. PROXIMA ACCION RECOMENDADA`,
    client.status === 'lead'
      ? '→ Contactar para convertir en cliente activo. Revisar canal preferido y preparar propuesta.'
      : client.status === 'active'
        ? facturasPendientes > 0
          ? `→ Gestionar ${facturasPendientes} factura(s) pendiente(s) de cobro. Preparar seguimiento.`
          : '→ Mantener seguimiento activo. Proponer nuevo servicio o renovacion.'
        : client.status === 'inactive'
          ? '→ Campana de reactivacion. Revisar motivo de inactividad y proponer oferta.'
          : '→ Sin accion inmediata recomendada.',
  ]
  return sections.filter(Boolean).join('\n')
}

async function generateClientReport(clientData: Record<string, unknown>, workspaceId: string) {
  const client = mapSupabaseClient(clientData)
  const createdAt = String(clientData.created_at || new Date().toISOString())
  const [invoices, events, conversations, activities] = await Promise.all([
    getClientInvoices(workspaceId, client.name).catch(() => []),
    getClientCalendarEvents(workspaceId, client.name).catch(() => []),
    getClientConversations(workspaceId, client.id).catch(() => []),
    getClientActivities(workspaceId, client.name).catch(() => []),
  ])
  return buildClientReportText({ client, createdAt, invoices, events, conversations, activities })
}

async function executeCopilotCRMQuery(
  text: string,
  workspaceId: string,
  lastReferencedClientName?: string,
  lastReferencedClientId?: string,
  onClientReferenced?: (client: { id: string; name: string }) => void,
  onPreparedAction?: (action: PreparedAction) => void,
  lastCreatedInvoiceId?: string
) {
  const queryType = detectCopilotCRMQuery(text, lastReferencedClientName, lastReferencedClientId)
  if (!queryType) return null

  if (queryType === 'no_client_referenced') {
    return 'No tengo un cliente referenciado todavía. Dime el nombre del cliente que quieres consultar.'
  }

  try {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) return null

    if (queryType === 'client_data_card') {
      let rawRow: Record<string, unknown> | null = null
      if (lastReferencedClientId) {
        const { data, error } = await supabase.from('clients').select('*').eq('id', lastReferencedClientId).eq('workspace_id', workspaceId).maybeSingle()
        if (!error && data) rawRow = data as Record<string, unknown>
      }
      if (!rawRow && lastReferencedClientName) {
        const clients = await searchClients(workspaceId, lastReferencedClientName)
        if (clients.length) {
          const { data, error } = await supabase.from('clients').select('*').eq('id', clients[0].id).maybeSingle()
          if (!error && data) rawRow = data as Record<string, unknown>
        }
      }
      if (!rawRow) return 'No encuentro el cliente referenciado. Dime el nombre y te busco.'
      const card = mapSupabaseClient(rawRow)
      onClientReferenced?.({ id: card.id, name: card.name })
      return generateClientDataCard(rawRow)
    }

    if (queryType === 'latest_client_report') {
      const { data, error } = await supabase.from('clients').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(1)
      if (error || !data?.length) return 'No hay clientes registrados todavía en este workspace.'
      const latest = mapSupabaseClient(data[0])
      onClientReferenced?.({ id: latest.id, name: latest.name })
      return await generateClientReport(data[0] as Record<string, unknown>, workspaceId)
    }

    if (queryType === 'latest_client') {
      const { data, error } = await supabase.from('clients').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(1)
      if (error || !data?.length) return 'No hay clientes registrados todavía en este workspace.'
      const client = mapSupabaseClient(data[0])
      const createdAt = data[0].created_at as string
      onClientReferenced?.({ id: client.id, name: client.name })
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
      if (results.length === 1) onClientReferenced?.({ id: results[0].id, name: results[0].name })
      return results.length
        ? `He encontrado ${results.length} cliente(s): ${results.slice(0, 4).map((client) => `${client.name}${client.company ? ` (${client.company})` : ''}${client.email ? ` – ${client.email}` : ''}`).join('; ')}.`
        : 'No se han encontrado clientes que coincidan con ese criterio.'
    }

    if (queryType === 'client_report_referenced') {
      if (lastReferencedClientId) {
        const fullData = await supabase.from('clients').select('*').eq('id', lastReferencedClientId).eq('workspace_id', workspaceId).maybeSingle()
        if (fullData.error || !fullData.data) return 'No encuentro el cliente referenciado. Dime el nombre y te busco.'
        const refClient = mapSupabaseClient(fullData.data as Record<string, unknown>)
        onClientReferenced?.({ id: refClient.id, name: refClient.name })
        return await generateClientReport(fullData.data as Record<string, unknown>, workspaceId)
      }
      if (lastReferencedClientName) {
        const clients = await searchClients(workspaceId, lastReferencedClientName)
        if (!clients.length) return `No encuentro a ${lastReferencedClientName} en este workspace. ¿Quieres que busque por otro nombre?`
        const client = clients[0]
        const fullData = await supabase.from('clients').select('*').eq('id', client.id).maybeSingle()
        if (fullData.error) throw fullData.error
        if (!fullData.data) return `No encuentro datos de ${client.name}. ¿Quieres que busque por otro nombre?`
        onClientReferenced?.({ id: client.id, name: client.name })
        return await generateClientReport(fullData.data as Record<string, unknown>, workspaceId)
      }
      return 'No tengo un cliente referenciado. Dime el nombre del cliente que quieres consultar.'
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
      if (!fullData.data) return 'No encuentro datos de ese cliente.'
      onClientReferenced?.({ id: clients[0].id, name: clients[0].name })
      return await generateClientReport(fullData.data as Record<string, unknown>, workspaceId)
    }

    if (queryType === 'pending_invoices') {
      const invoices = await getPendingInvoices(workspaceId)
      return invoices.length
        ? `Tienes ${invoices.length} factura(s) pendiente(s): ${invoices.slice(0, 4).map((invoice) => `${invoice.clientName} · ${invoice.amount}€ · vence ${invoice.dueDate}`).join('; ')}.`
        : 'No hay facturas pendientes en este workspace.'
    }

    if (queryType === 'upcoming_events') {
      const events = await getUpcomingCalendarEvents(workspaceId)
      const normalizedText = normalizeInput(text)
      const today = todayIsoLocal()
      const tomorrow = normalizedText.includes('manana') ? parseRelativeDate('manana') : null
      const weekLimit = addDaysIso(today, 7)
      const clientMatch = normalizedText.match(/\b(?:cita|reunion)?\s*con\s+([a-z0-9 ]{3,40})/)
      const clientQuery = clientMatch?.[1]?.replace(/\b(manana|esta semana|cuando|tengo|algo)\b/g, '').trim()
      const filteredEvents = events.filter((event) => {
        const matchesTomorrow = !tomorrow || event.date === tomorrow
        const matchesWeek = !normalizedText.includes('esta semana') || (event.date >= today && event.date <= weekLimit)
        const matchesClient = !clientQuery || [event.clientName, event.title].some((value) => normalizeInput(value ?? '').includes(clientQuery))
        return matchesTomorrow && matchesWeek && matchesClient
      })
      return filteredEvents.length
        ? `Próximas citas: ${filteredEvents.slice(0, 4).map((event) => `${event.title} con ${event.clientName ?? 'cliente'} el ${event.date}${event.startHour !== undefined ? ` a las ${String(event.startHour).padStart(2, '0')}:${String(event.startMinute).padStart(2, '0')}` : ''}`).join('; ')}.`
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

    if (queryType === 'create_invoice') {
      const invoiceIntent = detectAssistantIntent(text)
      const { extracted } = invoiceIntent
      const rawClientName = extracted.clientName || lastReferencedClientName
      if (!rawClientName) {
        return 'Para crear la factura necesito saber el nombre del cliente. ¿A quién va dirigida?'
      }
      if (!extracted.amount) {
        return 'Para crear la factura necesito el importe. ¿Cuánto es?'
      }
      const invoiceClients = await searchClients(workspaceId, rawClientName)
      if (!invoiceClients.length) {
        return `No encuentro a "${rawClientName}" en este workspace. Dime el nombre exacto o crea el cliente primero.`
      }
      if (invoiceClients.length > 1) {
        const nameList = invoiceClients.slice(0, 3).map((c) => `${c.name}${c.company ? ` (${c.company})` : ''}`).join(', ')
        return `Encontré varios clientes con ese nombre: ${nameList}. ¿Cuál es el correcto?`
      }
      const invoiceClient = invoiceClients[0]
      onClientReferenced?.({ id: invoiceClient.id, name: invoiceClient.name })
      const concept = extracted.concept || 'Servicio CRM'
      const todayDate = new Date()
      const due = new Date(todayDate)
      due.setDate(todayDate.getDate() + 14)
      const dueDate = due.toISOString().slice(0, 10)
      onPreparedAction?.({
        id: `invoice-${Date.now()}`,
        type: 'invoice',
        title: `Factura para ${invoiceClient.name}`,
        assistantMode: 'copilot',
        clientName: invoiceClient.name,
        concept,
        amount: extracted.amount,
        dueDate,
        missingFields: [],
        notes: 'Factura creada desde NowLabs AI',
      })
      return `Factura preparada: ${invoiceClient.name}, ${extracted.amount} EUR, concepto: ${concept}, vence ${dueDate}. Revísala en el panel y confirma.`
    }

    if (queryType === 'create_booking') {
      const bookingIntent = detectAssistantIntent(text)
      const { extracted } = bookingIntent
      const rawClientName = extracted.clientName || lastReferencedClientName
      if (!rawClientName) {
        return 'Para crear la cita necesito saber el nombre del cliente. ¿Con quién es?'
      }
      const clients = await searchClients(workspaceId, rawClientName)
      if (!clients.length) {
        return `No encuentro a "${rawClientName}" en este workspace. Dime el nombre exacto o crea el cliente primero.`
      }
      if (clients.length > 1) {
        const nameList = clients.slice(0, 3).map((c) => `${c.name}${c.company ? ` (${c.company})` : ''}`).join(', ')
        return `Encontré varios clientes con ese nombre: ${nameList}. ¿Cuál quieres para la cita?`
      }
      const client = clients[0]
      onClientReferenced?.({ id: client.id, name: client.name })
      const service = extracted.service || 'Reunión comercial'
      const duration = extracted.duration ?? 60
      const missingFields: string[] = [
        !extracted.date && 'fecha',
        !extracted.time && 'hora',
      ].filter(Boolean) as string[]
      onPreparedAction?.({
        id: `booking-${Date.now()}`,
        type: 'booking',
        title: `Cita con ${client.name}`,
        assistantMode: 'copilot',
        clientName: client.name,
        service,
        date: extracted.date,
        time: extracted.time,
        duration,
        missingFields,
        notes: 'Cita creada desde NowLabs AI',
      })
      if (missingFields.length) {
        return `Cita preparada con ${client.name}. Falta: ${missingFields.join(' y ')}. Dímelos para dejarla lista.`
      }
      return `Cita preparada: ${client.name}, ${service}, ${extracted.date} a las ${extracted.time}. Revísala en el panel y confirma.`
    }

    if (queryType === 'create_task') {
      const taskTitle = extractTaskTitle(text)
      const taskIntent = detectAssistantIntent(text)
      const taskExtracted = taskIntent.extracted
      // Try to resolve client from message (optional — tasks can be clientless)
      let taskClientName = lastReferencedClientName
      if (taskExtracted.clientName && taskExtracted.clientName !== lastReferencedClientName) {
        const taskClients = await searchClients(workspaceId, taskExtracted.clientName).catch(() => [] as Awaited<ReturnType<typeof searchClients>>)
        if (taskClients.length === 1) {
          onClientReferenced?.({ id: taskClients[0].id, name: taskClients[0].name })
          taskClientName = taskClients[0].name
        } else if (taskClients.length === 0 && !lastReferencedClientName) {
          taskClientName = taskExtracted.clientName
        }
      }
      const taskDueDate = taskExtracted.date
      const taskDescription = taskClientName
        ? `Tarea para ${taskClientName}${taskDueDate ? ` — vence ${taskDueDate}` : ''}`
        : undefined
      onPreparedAction?.({
        id: `task-${Date.now()}`,
        type: 'task',
        title: 'Crear tarea',
        assistantMode: 'copilot',
        clientName: taskClientName,
        taskTitle,
        description: taskDescription,
        dueDate: taskDueDate,
        missingFields: taskTitle ? [] : ['título de la tarea'],
      })
      if (!taskTitle) return 'Necesito saber el título de la tarea. ¿Cómo quieres llamarla?'
      const duePart = taskDueDate ? `, vence ${taskDueDate}` : ''
      const clientPart = taskClientName ? ` para ${taskClientName}` : ''
      return `Tarea preparada: "${taskTitle}"${clientPart}${duePart}. Revísala en el panel y confirma.`
    }

    if (queryType === 'generate_invoice_pdf') {
      if (!lastCreatedInvoiceId) {
        return 'Para generar el PDF de una factura, primero crea una. Por ejemplo: "crea una factura para X de 300€" y confírmala. Después podrás pedir el PDF.'
      }
      const { data: invData, error: invError } = await supabase
        .from('invoices')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', lastCreatedInvoiceId)
        .maybeSingle()
      if (invError || !invData) {
        return 'No encuentro la factura referenciada. Crea una nueva y confirma antes de pedir el PDF.'
      }
      const inv = invData as Record<string, unknown>
      const invId = String(inv.id || '')
      const invNumber = String(inv.invoice_number ?? inv.number ?? `FAC-${invId.slice(0, 8).toUpperCase()}`)
      const invClientName = String(inv.client_name ?? 'Cliente')
      const invAmount = typeof inv.amount === 'number' ? inv.amount : Number(inv.amount ?? 0)
      const invCurrency = String(inv.currency ?? 'EUR')
      const invConcept = String(inv.concept ?? inv.plan ?? 'Servicio')
      const invIssueDate = String(inv.issue_date ?? inv.date ?? new Date().toISOString().slice(0, 10))
      const invDueDate = String(inv.due_date ?? invIssueDate)
      const invStatus = String(inv.status ?? 'pending')
      const invStatusLabel = invStatus === 'paid' ? 'Pagada' : invStatus === 'overdue' ? 'Vencida' : 'Pendiente'
      const invNotes = String(inv.notes ?? '')
      const invoiceText = [
        `FACTURA — ${invNumber}\n`,
        `Generada: ${new Date().toLocaleDateString('es-ES')}`,
        `\n1. DATOS DE FACTURA`,
        `- Número: ${invNumber}`,
        `- Fecha de emisión: ${invIssueDate}`,
        `- Vencimiento: ${invDueDate}`,
        `- Estado: ${invStatusLabel}`,
        `\n2. CLIENTE`,
        `- Nombre: ${invClientName}`,
        `\n3. CONCEPTO E IMPORTE`,
        `- Concepto: ${invConcept}`,
        `- Importe: ${invAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${invCurrency}`,
        invNotes ? `\n4. NOTAS\n- ${invNotes}` : '',
        `\n---\nDocumento generado por NowCRM.`,
      ].filter(Boolean).join('\n')
      onPreparedAction?.({
        id: `invoice-pdf-${Date.now()}`,
        type: 'generate_invoice_pdf',
        title: `PDF — Factura ${invNumber}`,
        assistantMode: 'copilot',
        invoiceId: lastCreatedInvoiceId,
        invoiceNumber: invNumber,
        clientName: invClientName,
        amount: invAmount,
        currency: invCurrency,
        invoiceText,
        missingFields: [],
      })
      return `Factura ${invNumber} para ${invClientName} preparada como PDF. Revísala en el panel y confirma para guardarla.`
    }

    if (queryType === 'prepare_pdf') {
      let rawRow: Record<string, unknown> | null = null
      if (lastReferencedClientId) {
        const { data, error } = await supabase.from('clients').select('*').eq('id', lastReferencedClientId).eq('workspace_id', workspaceId).maybeSingle()
        if (!error && data) rawRow = data as Record<string, unknown>
      }
      if (!rawRow && lastReferencedClientName) {
        const clients = await searchClients(workspaceId, lastReferencedClientName)
        if (clients.length) {
          const { data, error } = await supabase.from('clients').select('*').eq('id', clients[0].id).maybeSingle()
          if (!error && data) rawRow = data as Record<string, unknown>
        }
      }
      if (!rawRow) return 'No encuentro al cliente referenciado para generar el PDF. Dime su nombre.'
      const pdfClient = mapSupabaseClient(rawRow)
      const pdfCreatedAt = String(rawRow.created_at || new Date().toISOString())
      const [pdfInvoices, pdfEvents, pdfConversations, pdfActivities] = await Promise.all([
        getClientInvoices(workspaceId, pdfClient.name).catch(() => []),
        getClientCalendarEvents(workspaceId, pdfClient.name).catch(() => []),
        getClientConversations(workspaceId, pdfClient.id).catch(() => []),
        getClientActivities(workspaceId, pdfClient.name).catch(() => []),
      ])
      const reportText = buildClientReportText({ client: pdfClient, createdAt: pdfCreatedAt, invoices: pdfInvoices, events: pdfEvents, conversations: pdfConversations, activities: pdfActivities })
      onClientReferenced?.({ id: pdfClient.id, name: pdfClient.name })
      onPreparedAction?.({
        id: `pdf-${Date.now()}`,
        type: 'prepare_pdf',
        title: `PDF — ${pdfClient.name}`,
        assistantMode: 'copilot',
        clientName: pdfClient.name,
        clientId: pdfClient.id,
        reportText,
        missingFields: [],
      })
      return `Informe de ${pdfClient.name} preparado como PDF pendiente. Revísalo en el panel y confirma para registrarlo.`
    }
  } catch {
    return null
  }

  return null
}

const GENERIC_COPILOT_TITLES = new Set([
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
  const [lastCreatedInvoiceId, setLastCreatedInvoiceId] = useState<string | null>(null)
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
  const assistantSourceLabel = assistantMode === 'inbox' ? 'Manual' : isOfflineMode ? 'Offline local' : assistantN8nActive ? 'n8n/OpenAI' : 'Demo'
  const assistantSourceDetail = assistantMode === 'inbox' ? 'Whapi/n8n pendiente' : isOfflineMode ? 'Supabase bloqueado por red' : assistantN8nActive ? 'workflow activo' : 'fallback mock'

  const assistantStats = [
    { label: assistantMode === 'inbox' ? 'Conversaciones Inbox' : 'Consultas NowLabs AI', value: String(modeConversations.length), detail: isRealMode ? 'persistentes' : 'demo', icon: <MessageSquare className="h-4 w-4" />, tone: 'text-indigo-600 bg-indigo-50' },
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
        await createActivity(workspaceId, { type: 'message', description: `${assistantMode === 'copilot' ? 'NowLabs AI' : 'Inbox Assistant'}: ${content.slice(0, 90)}`, clientName })
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
        setLastActionStatus('Inbox Assistant pendiente de conectar a Whapi/n8n')
        return
      }

      if (preparedAction?.assistantMode === assistantMode) {
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
        let newReferencedClient: { id: string; name: string } | undefined
        let newPreparedAction: PreparedAction | undefined
        const crmResponse = await executeCopilotCRMQuery(
          content, workspaceId, lastReferencedClientName, lastReferencedClientId,
          (client) => { newReferencedClient = client },
          (action) => { newPreparedAction = action },
          lastCreatedInvoiceId ?? undefined
        )
        if (crmResponse) {
          if (newReferencedClient) setConversationClient(conversationId, newReferencedClient)
          if (newPreparedAction) setPreparedAction(newPreparedAction)
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
        void triggerN8nWebhook('invoice_paid', { message: { content }, client: { name: activeConversation.clientName }, workspace_id: workspaceId || undefined, mode: isRealMode ? 'real' : 'demo' }).catch(() => null)
      }
      if (!OFFLINE_FORCE_DEV && (lower.includes('llamada') || lower.includes('reun') || lower.includes('agenda'))) {
        void triggerN8nWebhook('appointment_booked', { message: { content }, client: { name: activeConversation.clientName }, workspace_id: workspaceId || undefined, mode: isRealMode ? 'real' : 'demo' }).catch(() => null)
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
    let debugPayload: Record<string, unknown> | null = null
    try {
      const activeConversation = isRealMode ? await ensureRealConversation() : selected
      if (!activeConversation) return
      if (isRealMode && (!workspaceId || !isUuid(activeConversation.id))) {
        throw new Error(!workspaceId ? 'Workspace real no resuelto.' : 'No se puede confirmar una acción usando una conversación temporal.')
      }

      if (preparedAction.type === 'booking') {
        if (preparedAction.missingFields.length || !preparedAction.clientName || !preparedAction.date || !preparedAction.time) {
          toast.warning('Faltan datos para crear la cita', { description: missingText(preparedAction.missingFields) || 'Completa la card antes de confirmar.' })
          return
        }
        const service = preparedAction.service || 'Reunión comercial'
        const duration = preparedAction.duration ?? 60
        const times = buildCalendarEventTimes({ date: preparedAction.date, time: preparedAction.time, duration })
        const calendarPayload = {
          title: `${service} con ${preparedAction.clientName}`,
          date: preparedAction.date,
          time: preparedAction.time,
          startAt: times.startAtIso,
          endAt: times.endAtIso,
          startHour: times.startHour,
          startMinute: times.startMinute,
          duration: times.duration,
          type: 'meeting' as const,
          clientName: preparedAction.clientName,
          notes: preparedAction.notes,
          description: preparedAction.notes || 'Cita creada desde NowLabs AI',
          status: 'scheduled',
          metadata: { source: 'nowlabs_ai', conversation_id: activeConversation.id },
        }
        debugPayload = calendarPayload
        if (!workspaceId) throw new Error('No hay workspace real para crear el evento.')
        const createdEvent = await createCalendarEvent(workspaceId, calendarPayload)

        if (workspaceId) {
          void createActivity(workspaceId, { type: 'call', description: `Cita creada desde NowLabs AI: ${service} con ${preparedAction.clientName}`, clientName: preparedAction.clientName }).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[assistant/createActivity:booking]', error)
          })
          if (!OFFLINE_FORCE_DEV) {
            void triggerN8nWebhook('calendar_event_created', {
              workspace_id: workspaceId,
              mode: 'real',
              calendar_event: { ...calendarPayload, id: createdEvent.id },
              client: { name: preparedAction.clientName },
              metadata: { source: 'assistant_confirmation' },
            }).catch((error) => {
              if (process.env.NODE_ENV === 'development') console.warn('[assistant/n8n:booking]', error)
            })
          }
        }

        await appendAssistantMessage(activeConversation.id, `Cita creada correctamente para ${preparedAction.clientName} el ${preparedAction.date} a las ${preparedAction.time}.`, preparedAction.clientName).catch((error) => {
          if (process.env.NODE_ENV === 'development') console.warn('[assistant/message:booking]', error)
        })
        toast.success('Cita creada en Calendario')
        setLastActionStatus('Última acción confirmada: cita creada')
      }

      if (preparedAction.type === 'invoice') {
        if (preparedAction.missingFields.length || !preparedAction.clientName || !preparedAction.amount) {
          toast.warning('Faltan datos para crear la factura', { description: missingText(preparedAction.missingFields) || 'Se necesita al menos cliente e importe.' })
          return
        }
        const concept = preparedAction.concept || 'Servicio CRM'
        const todayInvoice = new Date()
        const dueInvoice = new Date(todayInvoice)
        dueInvoice.setDate(todayInvoice.getDate() + 14)
        const dueDate = preparedAction.dueDate || dueInvoice.toISOString().slice(0, 10)
        const invoicePayload = {
          clientName: preparedAction.clientName,
          concept,
          amount: preparedAction.amount,
          status: 'pending' as const,
          dueDate,
          plan: concept,
          currency: 'EUR',
          notes: preparedAction.notes,
          metadata: { source: 'nowlabs_ai', conversation_id: activeConversation.id },
        }
        debugPayload = invoicePayload
        if (!workspaceId) throw new Error('No hay workspace real para crear la factura.')
        const createdInvoice = await createInvoice(workspaceId, invoicePayload)

        if (workspaceId) {
          void createActivity(workspaceId, { type: 'deal', description: `Factura creada desde NowLabs AI: ${concept} para ${preparedAction.clientName}`, clientName: preparedAction.clientName }).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[assistant/createActivity:invoice]', error)
          })
          if (!OFFLINE_FORCE_DEV) {
            void triggerN8nWebhook('invoice_created', {
              workspace_id: workspaceId,
              mode: 'real',
              invoice: { ...invoicePayload, id: createdInvoice.id },
              client: { name: preparedAction.clientName },
              metadata: { source: 'assistant_confirmation' },
            }).catch((error) => {
              if (process.env.NODE_ENV === 'development') console.warn('[assistant/n8n:invoice]', error)
            })
          }
        }

        setLastCreatedInvoiceId(createdInvoice.id)
        await appendAssistantMessage(activeConversation.id, `Factura creada correctamente para ${preparedAction.clientName}: ${concept}, ${preparedAction.amount} EUR, vence ${dueDate}.\n\nSi quieres el PDF, escribe: "genera PDF de la factura".`, preparedAction.clientName).catch((error) => {
          if (process.env.NODE_ENV === 'development') console.warn('[assistant/message:invoice]', error)
        })
        toast.success('Factura creada')
        setLastActionStatus('Última acción confirmada: factura creada')
      }

      if (preparedAction.type === 'task') {
        if (!preparedAction.taskTitle) {
          toast.warning('Falta el título de la tarea', { description: 'Escribe el título y vuelve a confirmar.' })
          return
        }
        if (!workspaceId) throw new Error('No hay workspace real para crear la tarea.')
        const taskPayload = {
          title: preparedAction.taskTitle,
          clientName: preparedAction.clientName,
          description: preparedAction.description,
          dueDate: preparedAction.dueDate,
          status: 'pending',
          priority: 'normal',
          metadata: { source: 'nowlabs_ai', conversation_id: activeConversation.id },
        }
        debugPayload = taskPayload
        await createTask(workspaceId, taskPayload)
        void createActivity(workspaceId, { type: 'note', description: `Tarea creada desde NowLabs AI: ${preparedAction.taskTitle}`, clientName: preparedAction.clientName }).catch((error) => {
          if (process.env.NODE_ENV === 'development') console.warn('[assistant/createActivity:task]', error)
        })
        const taskMsg = `Tarea creada: "${preparedAction.taskTitle}"${preparedAction.clientName ? ` para ${preparedAction.clientName}` : ''}${preparedAction.dueDate ? `, vence ${preparedAction.dueDate}` : ''}.`
        await appendAssistantMessage(activeConversation.id, taskMsg, preparedAction.clientName).catch((error) => {
          if (process.env.NODE_ENV === 'development') console.warn('[assistant/message:task]', error)
        })
        toast.success('Tarea creada')
        setLastActionStatus('Última acción confirmada: tarea creada')
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
    const trimmed = titleDraft.trim() || 'Consulta NowLabs AI'
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
    toast.info('Acción descartada', { description: 'No se ha creado nada en Supabase.' })
  }

  const startEditingAction = () => {
    if (!preparedAction) return
    const d: Record<string, string> = { clientName: preparedAction.clientName ?? '' }
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
      clientName: isCopilot ? (isRealMode ? 'Consulta NowLabs AI' : 'Consulta NowLabs AI demo') : (isRealMode ? 'Nueva conversación' : 'Lead demo'),
      clientAvatar: isCopilot ? 'CRM' : 'IN',
      channel: 'Web' as Channel,
      sentiment: 'neutral' as ConversationSentiment,
      intent: isCopilot ? 'NowLabs AI CRM' : 'Inbox Assistant',
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
        clientName: assistantMode === 'copilot' ? 'Test persistencia NowLabs AI' : 'Test persistencia Inbox',
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
          description="Preparando NowLabs AI..."
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
            <p className="text-sm font-semibold text-gray-950">Preparando NowLabs AI...</p>
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
        description="NowLabs AI opera tu CRM: clientes, citas, facturas, cobros y próximas acciones."
        action={
          <div className="flex items-center gap-2">
            <Badge variant={assistantMode === 'inbox' ? 'warning' : assistantN8nActive ? 'success' : 'warning'} dot>{assistantMode === 'inbox' ? 'Inbox manual' : assistantN8nActive ? 'n8n/OpenAI activo' : 'IA demo'}</Badge>
            <Badge variant={isRealMode ? 'success' : 'indigo'} dot>{isRealMode ? 'Workspace real' : 'Modo demo'}</Badge>
            <Badge variant="indigo" dot>{assistantMode === 'inbox' ? 'Sin automatizacion falsa' : 'Acciones con confirmación'}</Badge>
            <Badge variant={assistantMode === 'inbox' && !waConnected ? 'warning' : 'indigo'} dot>
              {assistantMode === 'inbox'
                ? (waConnected
                    ? 'WhatsApp conectado'
                    : waStatus === 'verification_required' || waStatus === 'prepared'
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
                          ? 'Modo automatico activo. El agente responde directamente via Whapi/n8n.'
                          : 'Modo manual activo. WhatsApp conectado. El agente sugiere y el operador confirma.')
                      : waStatus === 'verification_required' || waStatus === 'prepared'
                        ? 'Inbox Assistant en modo manual. WhatsApp preparado pero pendiente de verificacion. Conecta y verifica el numero en Settings para recibir mensajes reales.'
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
                        <Badge variant={conv.assistantMode === 'copilot' ? 'indigo' : 'warning'} className="px-1.5 py-0 text-[10px]">{conv.assistantMode === 'copilot' ? 'NowLabs AI' : 'Inbox'}</Badge>
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
                <p className="text-sm font-semibold text-gray-800">{assistantMode === 'inbox' ? 'Sin conversaciones' : 'No hay consultas NowLabs AI todavía'}</p>
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
                  const label = isAI ? (assistantMode === 'copilot' ? 'NowLabs AI' : 'Inbox Assistant') : 'Tú'
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
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm shadow-violet-600/20">
                            {preparedAction.type === 'booking' ? <CalendarDays className="h-4 w-4" /> : preparedAction.type === 'task' ? <CheckCircle className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-950">
                              {preparedAction.type === 'booking' ? 'Crear cita' : preparedAction.type === 'invoice' ? 'Crear factura' : preparedAction.type === 'task' ? 'Crear tarea' : preparedAction.type === 'generate_invoice_pdf' ? 'PDF de factura' : 'PDF de informe'}
                            </p>
                            <p className="text-[11px] text-gray-500">{preparedAction.title} · NowLabs AI</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {preparedAction.type !== 'prepare_pdf' && preparedAction.type !== 'generate_invoice_pdf' && !editingAction && (
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
                          {preparedAction.clientName && (
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
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={() => void confirmPreparedAction()} loading={confirmingAction} disabled={preparedAction.missingFields.length > 0 || editingAction}>
                          <CheckCircle className="h-3.5 w-3.5" />
                          {preparedAction.missingFields.length ? 'Faltan datos' :
                            preparedAction.type === 'booking' ? 'Confirmar cita' :
                            preparedAction.type === 'invoice' ? 'Confirmar factura' :
                            preparedAction.type === 'task' ? 'Crear tarea' :
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
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={assistantMode === 'inbox' ? 'Escribe tu mensaje...' : 'Pide a NowLabs AI que opere tu CRM...'} rows={1} className="max-h-28 flex-1 resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder:text-gray-400 shadow-sm shadow-gray-950/[0.025] transition-all focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() } }} />
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
                    : 'Abre una consulta interna para que NowLabs AI opere tu CRM: clientes, calendario, facturas, cobros y próximas acciones.'}
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
            <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-indigo-100" /><h3 className="text-sm font-semibold">{assistantMode === 'copilot' ? 'NowLabs AI' : 'Inbox Assistant'}</h3></div>
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
              <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /><span className="text-[10px] text-emerald-700">{assistantN8nActive ? 'NowLabs AI conectado' : isRealMode ? 'Workspace real · webhook pendiente' : 'Mock data · IA simulada'}</span></div>
              <p className="mt-1 text-[10px] text-emerald-600">{assistantN8nActive ? 'Workflow: NowCRM - NowLabs AI.' : isRealMode ? 'No hay webhook activo detectado para este workspace.' : 'Siguiente paso: activar NowLabs AI en Settings.'}</p>
              {assistantMode === 'inbox' ? (
                <>
                  <p className="mt-1 text-[10px] text-emerald-600">Respuesta automatica desactivada.</p>
                  <p className="mt-1 text-[10px] text-emerald-600">Whapi/n8n pendiente de conexion.</p>
                  <p className="mt-1 text-[10px] text-emerald-600">Modo manual para evitar respuestas falsas.</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-[10px] text-emerald-600">Calendar tools preparadas.</p>
                  <p className="mt-1 text-[10px] text-emerald-600">Confirmación requerida para escrituras.</p>
                  <p className="mt-1 text-[10px] text-emerald-600">Fallback seguro disponible.</p>
                </>
              )}
              {lastResponseSource === 'n8n' && <p className="mt-1 rounded-lg bg-white/75 px-2 py-1 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-100">Última respuesta por n8n/OpenAI</p>}
              {lastActionStatus && <p className="mt-1 rounded-lg bg-white/75 px-2 py-1 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-100">{lastActionStatus}</p>}
              {lastResponseSource === 'fallback' && <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100">Última respuesta por fallback</p>}
              {lastResponseSource === 'supabase' && <p className="mt-1 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 ring-1 ring-blue-100">Última respuesta por Supabase</p>}
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
              <p className="mb-2 text-[10px] font-semibold uppercase text-gray-400">{assistantMode === 'copilot' ? 'NowLabs AI' : 'Inbox Assistant'}</p>
              <div className="flex flex-wrap gap-1.5">
                {(assistantMode === 'copilot' ? capabilities : inboxCapabilities.map((_, index) => ['Conversaciones', 'Whapi/n8n pendiente', 'Modo manual'][index]).filter(Boolean)).map((capability) => (
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
                    : selected ? 'Usa NowLabs AI para consultar datos reales, preparar acciones y confirmar antes de escribir en Supabase.' : 'Crea una consulta para operar clientes, facturas, calendario y cobros desde el CRM.'}
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
