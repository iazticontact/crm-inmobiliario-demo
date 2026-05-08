'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Bot, CalendarDays, CheckCircle, FileText, Loader2, Mail, MessageSquare, Phone, Plus, Search, Send, Target, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { conversations as mockConversations, messages as mockMessages } from '@/lib/mock-data'
import { ASSISTANT_AGENT_WEBHOOK_URL, callAgentTool, getAssistantAgentFlow, triggerN8nWebhook, type AgentToolName } from '@/lib/integrations'
import { DEMO_MODE_KEY, useCurrentUser } from '@/lib/current-user'
import { detectAssistantIntent, respondWithAssistant, type AssistantIntent } from '@/lib/ai'
import {
  createActivity,
  createCalendarEvent,
  createConversation,
  createInvoice,
  createMessage,
  getConversationMessages,
  getConversations,
  getN8nFlows,
  getResolvedWorkspaceContext,
  markConversationResolved,
  updateConversationScoped,
} from '@/lib/supabase-queries'
import type { Channel, Conversation, ConversationSentiment, Message, N8nFlowStatus } from '@/lib/types'

const SHOW_ASSISTANT_DEBUG = false

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

const quickPrompts = [
  { label: 'Qué puedes hacer', prompt: 'Qué puedes hacer como Assistant Agent interno de NowCRM?', intent: 'capabilities' },
  { label: 'Crear cita', prompt: 'Quiero crear una cita. Pídeme cliente, servicio, día, hora y duración si falta algo.', intent: 'booking' },
  { label: 'Crear factura', prompt: 'Quiero crear una factura. Pídeme cliente, importe, concepto y vencimiento si falta algo.', intent: 'invoice' },
  { label: 'Buscar cliente', prompt: 'Ayúdame a localizar un cliente por nombre, email o empresa.', intent: 'client_search' },
  { label: 'Resumen cliente', prompt: 'Resume este cliente y dime la siguiente acción comercial.', intent: 'resumen' },
  { label: 'Próxima acción', prompt: 'Dime la siguiente acción comercial recomendada para este cliente.', intent: 'next_action' },
  { label: 'Revisar cobros', prompt: 'Revisa facturas pendientes o vencidas y dime qué seguimiento harías.', intent: 'billing' },
  { label: 'Preparar propuesta', prompt: 'Prepara una propuesta comercial breve con siguiente paso claro.', intent: 'proposal' },
  { label: 'Probar n8n', prompt: 'Prueba el workflow NowCRM - Assistant Agent con una consulta interna breve.', intent: 'n8n_test' },
]

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

type AssistantMode = 'inbox' | 'copilot'

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
    title: 'Copilot CRM',
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
      clientName?: string
      concept?: string
      amount?: number
      dueDate?: string
      missingFields: string[]
      notes?: string
    }

function nowTime() {
  return new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
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

function internalAssistantIntro() {
  return 'Soy tu Assistant Agent interno de NowCRM. Puedo ayudarte a buscar clientes, preparar citas en calendario, crear facturas con confirmación, revisar cobros y proponerte la siguiente acción comercial. Por ejemplo, dime: “Reserva a Ana mañana a las 10 para corte” o “Crea una factura a Ana de 299€ por Plan Pro”.'
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

function buildPreparedAction(intent: AssistantIntent): PreparedAction | null {
  const { extracted } = intent
  if ((intent.intent === 'booking' || intent.intent === 'booking_concrete') && (extracted.clientName || extracted.service || extracted.date || extracted.time)) {
    return {
      id: `booking-${Date.now()}`,
      type: 'booking',
      title: 'Crear cita',
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

function buildLocalOperationalResponse(intent: AssistantIntent) {
  if (intent.intent === 'capabilities') {
    return internalAssistantIntro()
  }

  if (intent.intent === 'pricing') {
    return pricingGuidance()
  }

  if (intent.intent === 'consultative') {
    return 'Para ese tipo de negocio, NowCRM puede centralizar clientes, preparar citas o tareas, automatizar seguimientos y ayudarte a responder mejor sin perder contexto. Si quieres llevarlo a llamadas o WhatsApp reales, la siguiente fase sería conectarlo con Whapi/n8n para que los mensajes entren solos al CRM.'
  }

  if (intent.intent === 'booking_strategy') {
    return 'Sí, tiene mucho sentido para un negocio con citas. El Assistant puede recoger nombre, servicio, día y hora, preparar la cita y guardarla en calendario con confirmación. Para montarlo bien, dime si quieres que esas reservas entren por WhatsApp/Whapi, web o llamadas.'
  }

  if (intent.intent === 'booking' || intent.intent === 'booking_concrete') {
    if (intent.missingFields.length) {
      return buildPreparedAction(intent)
        ? `Tengo la cita casi lista. Falta: ${missingText(intent.missingFields)}. Completa esos datos y la dejo lista para confirmar.`
        : `Sí, se puede. Para crear la reserva necesito: ${missingText(intent.missingFields)}. Dime esos datos y preparo la cita en el calendario.`
    }
    return 'Tengo la cita preparada. Revísala abajo y pulsa Confirmar para crearla en Calendario.'
  }

  if (intent.intent === 'invoice' || intent.intent === 'invoice_concrete') {
    if (intent.missingFields.length) {
      return buildPreparedAction(intent)
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
  const client = getRecord(record?.client)
  if (client) {
    const name = String(client.name ?? 'Cliente')
    const status = String(client.status ?? 'sin estado')
    const notes = String(client.notes ?? '').trim()
    return `Resumen de ${name}: estado ${status}.${notes ? `\nNotas: ${notes}` : ''}\nSiguiente paso: confirma necesidad y agenda seguimiento.`
  }

  return 'Tool ejecutada. Resultado preparado para el Assistant Agent.'
}

export default function AssistantPage() {
  const { currentUser } = useCurrentUser()
  const userWorkspaceId = currentUser.workspaceId
  const [assistantReady, setAssistantReady] = useState(false)
  const [conversationList, setConversationList] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
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
  const [lastResponseSource, setLastResponseSource] = useState<'n8n' | 'fallback' | null>(null)
  const [lastActionStatus, setLastActionStatus] = useState('')
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('copilot')
  const [detectedIntent, setDetectedIntent] = useState('')
  const [preparedAction, setPreparedAction] = useState<PreparedAction | null>(null)
  const [confirmingAction, setConfirmingAction] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true)
    setAssistantReady(false)
    try {
      const context = await getResolvedWorkspaceContext()
      const hasRealSession = Boolean(context?.user)
      const resolvedWorkspaceId = userWorkspaceId || context?.workspace?.id || context?.profile?.workspace_id
      if (!hasRealSession) {
        const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
        setConversationList(mockConversations)
        setSelectedId(mockConversations[0]?.id ?? '')
        setWorkspaceId(null)
        setIsRealMode(false)
        setAssistantWebhookUrl('')
        setAssistantFlowFound(false)
        setAssistantFlowStatus('demo')
        setLocalMessages(mockMessages)
        if (!isDemoMode) toast.warning('Assistant en modo demo', { description: 'No se ha encontrado un workspace real.' })
        return
      }

      window.localStorage.removeItem(DEMO_MODE_KEY)
      const flows = resolvedWorkspaceId ? await getN8nFlows(resolvedWorkspaceId).catch(() => []) : []
      const assistantFlow = getAssistantAgentFlow(flows, false)
      const realConversations = resolvedWorkspaceId ? await getConversations(resolvedWorkspaceId).catch((): Conversation[] => []) : []
      setConversationList(realConversations)
      setSelectedId(realConversations[0]?.id ?? '')
      setLocalMessages({})
      setWorkspaceId(resolvedWorkspaceId ?? null)
      setIsRealMode(true)
      setAssistantWebhookUrl(assistantFlow.webhookUrl || ASSISTANT_AGENT_WEBHOOK_URL)
      setAssistantFlowFound(assistantFlow.isActive)
      setAssistantFlowStatus(assistantFlow.status)
    } catch {
      const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
      setConversationList(mockConversations)
      setSelectedId(mockConversations[0]?.id ?? '')
      setWorkspaceId(null)
      setIsRealMode(false)
      setAssistantWebhookUrl('')
      setAssistantFlowFound(false)
      setAssistantFlowStatus('demo')
      setLocalMessages(isDemoMode ? mockMessages : {})
      if (!isDemoMode) toast.warning('Assistant en modo demo', { description: 'No se pudieron cargar conversaciones reales.' })
    } finally {
      setLoadingConversations(false)
      setAssistantReady(true)
    }
  }, [userWorkspaceId])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadConversations()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadConversations])

  const selected = conversationList.find((conversation) => conversation.id === selectedId) ?? conversationList[0] ?? null

  useEffect(() => {
    if (!selected) return
    if (!isRealMode) return

    const loadMessages = async () => {
      setLoadingMessages(true)
      try {
        const realMessages = await getConversationMessages(selected.id, workspaceId ?? undefined)
        setLocalMessages((prev) => ({ ...prev, [selected.id]: realMessages }))
      } catch {
        setLocalMessages((prev) => ({ ...prev, [selected.id]: [] }))
      } finally {
        setLoadingMessages(false)
      }
    }

    const timeout = window.setTimeout(() => {
      void loadMessages()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [isRealMode, selected, workspaceId])

  const msgs = useMemo(() => selected ? localMessages[selected.id] ?? [] : [], [localMessages, selected])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, isTyping])

  const filteredConvs = conversationList.filter((conversation) => !convSearch || conversation.clientName.toLowerCase().includes(convSearch.toLowerCase()))
  const averageLeadScore = Math.round((conversationList.reduce((sum, conversation) => sum + (leadScores[conversation.id] ?? 70), 0) / Math.max(conversationList.length, 1)))
  const score = selected ? leadScores[selected.id] ?? (selected.sentiment === 'positive' ? 84 : selected.sentiment === 'negative' ? 42 : 68) : 70
  const assistantN8nActive = isRealMode && Boolean(assistantWebhookUrl)

  const assistantStats = [
    { label: 'Conversaciones activas', value: String(conversationList.length), detail: isRealMode ? 'persistentes' : 'demo', icon: <MessageSquare className="h-4 w-4" />, tone: 'text-indigo-600 bg-indigo-50' },
    { label: 'IA en modo', value: assistantN8nActive ? 'n8n/OpenAI' : 'Demo', detail: assistantN8nActive ? 'workflow activo' : 'fallback mock', icon: <Bot className="h-4 w-4" />, tone: assistantN8nActive ? 'text-emerald-600 bg-emerald-50' : 'text-violet-600 bg-violet-50' },
    { label: 'Lead score medio', value: String(averageLeadScore), detail: 'estimado', icon: <Target className="h-4 w-4" />, tone: 'text-emerald-600 bg-emerald-50' },
  ]

  const appendLocalMessage = (conversationId: string, message: Message) => {
    setLocalMessages((prev) => ({ ...prev, [conversationId]: [...(prev[conversationId] ?? []), message] }))
  }

  const appendAssistantMessage = async (conversationId: string, content: string, clientName?: string) => {
    const aiMsg: Message = { id: `ai-${Date.now()}`, conversationId, content, sender: 'ai', timestamp: nowTime() }
    appendLocalMessage(conversationId, aiMsg)
    if (isRealMode && workspaceId) {
      await createMessage(conversationId, { content, sender: 'ai', metadata: { source: 'assistant_agent' } }, workspaceId)
      await updateConversationScoped(conversationId, workspaceId, { lastMessage: content, unread: true }).catch(() => null)
      if (workspaceId) {
        await createActivity(workspaceId, { type: 'message', description: `Assistant Agent: ${content.slice(0, 90)}`, clientName })
      }
    }
  }

  const sendMessage = async (overrideContent?: string) => {
    const content = (overrideContent ?? input).trim()
    if (!content || !selected || isTyping) return
    const conversationId = selected.id
    const userMsg: Message = { id: `agent-${Date.now()}`, conversationId, content, sender: 'agent', timestamp: nowTime() }
    const defaultClientName = isGenericConversationName(selected.clientName) ? undefined : selected.clientName
    const operationalIntent = detectAssistantIntent(content, { defaultClientName })
    const localIntentLabel = intentLabel(operationalIntent)

    appendLocalMessage(conversationId, userMsg)
    setInput('')
    setDetectedIntent(localIntentLabel)
    setIsTyping(true)

    try {
      if (isRealMode && workspaceId) {
        await createMessage(conversationId, { content, sender: 'agent', metadata: { source: 'assistant_ui' } }, workspaceId)
        await updateConversationScoped(conversationId, workspaceId, { lastMessage: content, unread: false }).catch(() => null)
        await createActivity(workspaceId, { type: 'message', description: `Mensaje enviado a ${selected.clientName}`, clientName: selected.clientName })
      }

      if (!assistantN8nActive && isCapabilityQuestion(content)) {
        await appendAssistantMessage(conversationId, internalAssistantIntro(), selected.clientName)
        setLastResponseSource(null)
        return
      }

      if (!assistantN8nActive && isPricingQuestion(content)) {
        await appendAssistantMessage(conversationId, pricingGuidance(), selected.clientName)
        setLastResponseSource(null)
        return
      }

      if (!assistantN8nActive && /no entiendo|no sé|no se|ayuda/i.test(content)) {
        await appendAssistantMessage(conversationId, 'Claro. Dime si quieres crear una cita, buscar un cliente, preparar una factura o ver la próxima acción comercial.', selected.clientName)
        setLastResponseSource(null)
        return
      }

      if (preparedAction?.missingFields.length) {
        const mergedAction = mergePreparedAction(preparedAction, operationalIntent)
        if (mergedAction.missingFields.length < preparedAction.missingFields.length) {
          setPreparedAction(mergedAction)
          setLastActionStatus(`Acción actualizada: ${mergedAction.type === 'booking' ? 'cita' : 'factura'}`)
          await appendAssistantMessage(
            conversationId,
            mergedAction.missingFields.length
              ? `Perfecto, he actualizado la acción. Todavía falta: ${missingText(mergedAction.missingFields)}.`
              : 'Perfecto, ya tengo todos los datos. Revisa la card y pulsa Confirmar para ejecutarla.',
            selected.clientName
          )
          setLastResponseSource(null)
          return
        }
      }

      const concreteActionIntents: AssistantIntent['intent'][] = ['booking', 'booking_concrete', 'invoice', 'invoice_concrete']
      const shouldUseLocalResponse = concreteActionIntents.includes(operationalIntent.intent) || !assistantN8nActive
      const localResponse = buildLocalOperationalResponse(operationalIntent)
      if (localResponse && shouldUseLocalResponse) {
        const action = buildPreparedAction(operationalIntent)
        await new Promise((resolve) => setTimeout(resolve, 350))
        await appendAssistantMessage(conversationId, localResponse, selected.clientName)
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
      if (safeTool && workspaceId) {
        const toolInput =
          safeTool === 'search_clients' ? { query: operationalIntent.extracted.clientName || content } :
          safeTool === 'get_client_summary' ? { name: operationalIntent.extracted.clientName || selected.clientName } :
          safeTool === 'list_invoices' ? { status: 'pending' } :
          {}
        const toolResult = await callAgentTool(safeTool, workspaceId, toolInput, {
          source: 'assistant_local_intent',
          conversation_id: selected.id,
          user_intent: operationalIntent.intent,
        }).catch(() => null)
        if (toolResult?.ok) {
          await appendAssistantMessage(conversationId, formatToolResult(safeTool, toolResult.result), selected.clientName)
          setLastResponseSource(null)
          return
        }
      }

      const assistantResult = await respondWithAssistant({
        input: content,
        workspaceId,
        workspaceName: currentUser.workspaceName,
        conversation: selected,
        messages: [...msgs, userMsg],
        isDemo: !isRealMode,
        webhookUrl: assistantN8nActive ? assistantWebhookUrl : undefined,
      })

      await new Promise((resolve) => setTimeout(resolve, 900))

      await appendAssistantMessage(conversationId, assistantResult.response, selected.clientName)

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
      if (lower.includes('pago') || lower.includes('factura') || lower.includes('cobro')) {
        await triggerN8nWebhook('invoice_paid', { message: { content }, client: { name: selected.clientName }, workspace_id: workspaceId || undefined, mode: isRealMode ? 'real' : 'demo' })
      }
      if (lower.includes('llamada') || lower.includes('reun') || lower.includes('agenda')) {
        await triggerN8nWebhook('appointment_booked', { message: { content }, client: { name: selected.clientName }, workspace_id: workspaceId || undefined, mode: isRealMode ? 'real' : 'demo' })
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
        const toolResult = workspaceId
          ? await callAgentTool('create_calendar_event', workspaceId, toolInput, {
              source: 'assistant_confirmation',
              conversation_id: selected.id,
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
          await triggerN8nWebhook('calendar_event_created', {
            workspace_id: workspaceId,
            mode: 'real',
            calendar_event: toolInput,
            client: { name: preparedAction.clientName },
            metadata: { source: 'assistant_confirmation' },
          })
        }

        await appendAssistantMessage(selected.id, `Cita creada en Calendario: ${preparedAction.clientName}, ${preparedAction.service}, ${preparedAction.date} a las ${preparedAction.time}.`, preparedAction.clientName)
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
        const toolResult = workspaceId
          ? await callAgentTool('create_invoice', workspaceId, toolInput, {
              source: 'assistant_confirmation',
              conversation_id: selected.id,
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
          await triggerN8nWebhook('invoice_created', {
            workspace_id: workspaceId,
            mode: 'real',
            invoice: toolInput,
            client: { name: preparedAction.clientName },
            metadata: { source: 'assistant_confirmation' },
          })
        }

        await appendAssistantMessage(selected.id, `Factura creada: ${preparedAction.clientName}, ${preparedAction.concept}, ${preparedAction.amount} EUR.`, preparedAction.clientName)
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
    const payload = {
      clientName: isRealMode ? 'Consulta CRM' : 'Consulta CRM demo',
      clientAvatar: isRealMode ? 'CRM' : 'CD',
      channel: 'Web' as Channel,
      sentiment: 'neutral' as ConversationSentiment,
      intent: isRealMode ? 'Operación comercial' : 'Consulta demo',
      lastMessage: isRealMode ? 'Abre una consulta interna para gestionar clientes, citas o facturas.' : 'Hola, me gustaría probar el Assistant interno de NowCRM.',
      unread: true,
    }

    try {
      if (isRealMode && workspaceId) {
        const created = await createConversation(workspaceId, payload)
        await createMessage(created.id, { content: payload.lastMessage, sender: 'client', metadata: { source: 'assistant_new_conversation' } }, workspaceId)
        await createActivity(workspaceId, { type: 'message', description: `Nueva conversación: ${created.clientName}`, clientName: created.clientName })
        await loadConversations()
        setSelectedId(created.id)
        toast.success('Conversación real creada')
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
      }
      setConversationList((prev) => [localConversation, ...prev])
      setLocalMessages((prev) => ({
        ...prev,
        [localConversation.id]: [{ id: `msg-${Date.now()}`, conversationId: localConversation.id, content: payload.lastMessage, sender: 'client', timestamp: nowTime() }],
      }))
      setSelectedId(localConversation.id)
      toast.success('Conversación demo creada')
    } catch (error) {
      toast.error('No se pudo crear la conversación', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    }
  }

  const handleQuickAction = async (action: string) => {
    if (!selected) return

    if (action === 'Probar n8n') {
      const webhookForTest = assistantWebhookUrl || ASSISTANT_AGENT_WEBHOOK_URL
      const testingMsg: Message = { id: `ai-${Date.now()}`, conversationId: selected.id, content: 'Enviando mensaje de prueba al workflow NowCRM - Assistant Agent vía n8n/OpenAI...', sender: 'ai', timestamp: nowTime() }
      appendLocalMessage(selected.id, testingMsg)
      if (isRealMode && workspaceId) await createMessage(selected.id, { content: testingMsg.content, sender: 'ai', metadata: { source: 'assistant_n8n_test' } }, workspaceId)
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
        metadata: { source: 'assistant_ui_test' },
      })
      if (result.status === 'ok') {
        setLastResponseSource('n8n')
        if (result.suggested_response) {
          const n8nMsg: Message = { id: `n8n-${Date.now()}`, conversationId: selected.id, content: result.suggested_response, sender: 'ai', timestamp: nowTime() }
          appendLocalMessage(selected.id, n8nMsg)
          if (isRealMode && workspaceId) await createMessage(selected.id, { content: result.suggested_response, sender: 'ai', metadata: { source: 'assistant_n8n_test' } }, workspaceId)
        }
        toast.success('n8n respondió correctamente', { description: result.suggested_response ? 'suggested_response recibido.' : result.message })
      } else {
        setLastResponseSource('fallback')
        toast.warning('n8n no disponible, usando fallback seguro.', { description: result.message })
      }
      return
    }

    const selectedPrompt = quickPrompts.find((item) => item.label === action)
    if (!selectedPrompt) return

    const safeToolsByIntent: Partial<Record<string, AgentToolName>> = {
      resumen: 'get_client_summary',
      next_action: 'get_next_best_actions',
      slot_search: 'list_calendar_events',
      billing: 'list_invoices',
      client_search: 'search_clients',
    }
    const tool = safeToolsByIntent[selectedPrompt.intent]
    if (tool && workspaceId) {
      const toolInput =
        tool === 'get_client_summary' ? { name: selected.clientName } :
        tool === 'search_clients' ? { query: selected.clientName } :
        {}
      const result = await callAgentTool(tool, workspaceId, toolInput, {
        source: 'assistant_quick_action',
        conversation_id: selected.id,
        user_intent: selectedPrompt.intent,
      }).catch(() => null)
      if (result?.ok) {
        await appendAssistantMessage(selected.id, formatToolResult(tool, result.result), selected.clientName)
        toast.success('Tool consultada', { description: result.message })
        return
      }
    }
    await sendMessage(selectedPrompt.prompt)
  }

  const resolveConversation = async () => {
    if (!selected) return
    try {
      if (isRealMode) {
        await markConversationResolved(selected.id)
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
              {isRealMode ? 'Crear conversación' : 'Crear conversación demo'}
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
              onClick={() => setAssistantMode(mode.id)}
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
              const isActive = conv.id === selectedId
              return (
                <li key={conv.id}>
                  <button onClick={() => setSelectedId(conv.id)} className={cn('flex w-full items-start gap-3 border-b border-gray-50 p-3.5 text-left transition-colors', isActive ? 'bg-indigo-50/80' : 'hover:bg-gray-50')}>
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
                <p className="text-sm font-semibold text-gray-800">Sin conversaciones</p>
                <p className="mt-1 text-xs text-gray-400">{isRealMode ? 'Crea una conversación real para probar n8n/OpenAI.' : 'Crea una conversación demo para probar la IA.'}</p>
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
                  <Button variant="ghost" size="sm" onClick={() => handleQuickAction('Crear cita')} aria-label="Crear cita"><Phone className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => handleQuickAction('Preparar propuesta')} aria-label="Preparar propuesta"><Mail className="h-3.5 w-3.5" /></Button>
                  <Button variant="secondary" size="sm" onClick={resolveConversation}>
                    <CheckCircle className="h-3.5 w-3.5" />
                    Resolver
                  </Button>
                </div>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto p-5 pb-8">
                {loadingMessages && <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin text-indigo-500" />Cargando mensajes...</div>}
                {!loadingMessages && msgs.map((msg) => {
                  const isClient = msg.sender === 'client'
                  const isAI = msg.sender === 'ai'
                  const isAgent = msg.sender === 'agent'
                  const label = isAI ? 'Assistant Agent' : isAgent ? 'Tú' : 'Cliente'
                  return (
                    <div key={msg.id} className={cn('flex', isAgent ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[72%]', isAgent ? 'items-end' : 'items-start')}>
                        <div className={cn('mb-1 flex items-center gap-1.5', isAgent ? 'justify-end text-slate-500' : isAI ? 'text-indigo-600' : 'text-gray-500')}>
                          {isAI && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-50"><Bot className="h-2.5 w-2.5" /></span>}
                          <span className="text-[10px] font-semibold">{label}</span>
                        </div>
                        <div className={cn(
                          'whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm',
                          isClient && 'rounded-tl-sm border border-gray-200 bg-white text-gray-800 shadow-gray-950/[0.025]',
                          isAI && 'rounded-tl-sm border border-indigo-100 bg-gradient-to-br from-white via-indigo-50 to-violet-50 text-gray-900 shadow-indigo-950/[0.045]',
                          isAgent && 'rounded-tr-sm bg-slate-900 text-white shadow-slate-950/15'
                        )}>
                          {msg.content}
                        </div>
                        <p className={cn('mt-1 text-[10px] text-gray-400', isAgent ? 'text-right' : 'text-left')}>{msg.timestamp}</p>
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
                            <p className="text-[11px] text-gray-500">{preparedAction.title}</p>
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
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pide al Assistant que prepare citas, facture, busque clientes o proponga la siguiente acción..." rows={1} className="max-h-28 flex-1 resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder:text-gray-400 shadow-sm shadow-gray-950/[0.025] transition-all focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() } }} />
                  <Button size="sm" className="h-10 w-10 shrink-0 p-0" onClick={() => void sendMessage()} disabled={isTyping || !input.trim()} loading={isTyping} aria-label="Enviar mensaje">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-gray-400">Acciones rápidas:</span>
                  {quickPrompts.map(({ label }) => (
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
                <p className="text-sm font-semibold text-gray-900">{isRealMode ? 'No hay conversaciones todavía' : 'Assistant listo'}</p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-gray-400">{isRealMode ? 'Crea una conversación interna para pedirle al Assistant que prepare citas, facturas, cobros o próximas acciones.' : 'Crea una conversación para probar el Assistant interno en modo demo.'}</p>
                <div className="mx-auto mt-3 grid max-w-sm gap-1.5 text-left">
                  {capabilityExamples.slice(0, 4).map((example) => (
                    <span key={example} className="rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">{example}</span>
                  ))}
                </div>
                <Button className="mt-4" size="sm" onClick={createDemoConversation}><Plus className="h-3.5 w-3.5" />{isRealMode ? 'Crear conversación' : 'Crear conversación demo'}</Button>
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
                  <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-gray-600">Lead Score</span><Target className="h-3.5 w-3.5 text-gray-400" /></div>
                  <div className="flex items-end gap-1"><span className={cn('text-2xl font-bold', leadScoreColor(score))}>{score}</span><span className="mb-0.5 text-xs text-gray-400">/100</span></div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200"><div className={cn('h-full rounded-full', score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${score}%` }} /></div>
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
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-white/85 p-3 shadow-sm shadow-indigo-950/[0.035] ring-1 ring-indigo-100/50">
              <p className="mb-2 text-[10px] font-semibold uppercase text-gray-400">{assistantMode === 'copilot' ? 'Copilot CRM' : 'Inbox Assistant'}</p>
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
                  {selected ? selected.sentiment === 'positive' ? 'Cliente con buena intención. Propón siguiente paso y agenda demo breve.' : selected.sentiment === 'negative' ? 'Prioriza tono empático y escala la conversación antes de automatizar.' : 'Envía contexto comercial y programa seguimiento en 48 horas.' : 'Crea una conversación para que el Assistant pueda operar con contexto real del CRM.'}
                </p>
                <button className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700" onClick={() => selected ? void handleQuickAction('Próxima acción') : toast.info('Crea una conversación primero')}>
                  Aplicar <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {SHOW_ASSISTANT_DEBUG && process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-4 left-4 z-50 max-w-xs rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] shadow-lg shadow-amber-950/10">
          <p className="mb-1.5 font-bold text-amber-900">Debug (dev only)</p>
          <p className="text-amber-700">email: {currentUser.email}</p>
          <p className="text-amber-700">workspaceId: {workspaceId ?? 'null'}</p>
          <p className="text-amber-700">isDemo: {String(currentUser.isDemo)}</p>
          <p className="text-amber-700">isRealMode: {String(isRealMode)}</p>
          <p className="text-amber-700">assistantFlow found: {assistantFlowFound ? 'true' : 'false'}</p>
          <p className="text-amber-700">assistantFlow status: {assistantFlowStatus}</p>
          <p className="text-amber-700">webhookUrl exists: {assistantWebhookUrl ? 'true' : 'false'}</p>
        </div>
      )}
    </motion.div>
  )
}
