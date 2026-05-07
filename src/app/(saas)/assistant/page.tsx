'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Bot, CheckCircle, Loader2, Mail, MessageSquare, Phone, Plus, Search, Send, Target } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { conversations as mockConversations, messages as mockMessages } from '@/lib/mock-data'
import { getAssistantAgentFlow, triggerN8nWebhook } from '@/lib/integrations'
import { DEMO_MODE_KEY, useCurrentUser } from '@/lib/current-user'
import { respondWithAssistant } from '@/lib/ai'
import {
  createActivity,
  createConversation,
  createMessage,
  getConversationMessages,
  getConversations,
  getN8nFlows,
  getWorkspaceContext,
  markConversationResolved,
  updateConversation,
} from '@/lib/supabase-queries'
import type { Channel, Conversation, ConversationSentiment, Message } from '@/lib/types'

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

function nowTime() {
  return new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

function getInitials(name: string) {
  return name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || 'NC'
}

export default function AssistantPage() {
  const { currentUser } = useCurrentUser()
  const [conversationList, setConversationList] = useState<Conversation[]>(mockConversations)
  const [selectedId, setSelectedId] = useState<string>(mockConversations[0]?.id ?? '')
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [localMessages, setLocalMessages] = useState<Record<string, Message[]>>(mockMessages)
  const [convSearch, setConvSearch] = useState('')
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isRealMode, setIsRealMode] = useState(false)
  const [assistantWebhookUrl, setAssistantWebhookUrl] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true)
    try {
      const context = await getWorkspaceContext()
      const resolvedWorkspaceId = context?.workspace?.id || context?.profile?.workspace_id
      if (!resolvedWorkspaceId) {
        const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
        setConversationList(mockConversations)
        setSelectedId(mockConversations[0]?.id ?? '')
        setWorkspaceId(null)
        setIsRealMode(false)
        setAssistantWebhookUrl('')
        if (!isDemoMode) toast.warning('Assistant en modo demo', { description: 'No se ha encontrado un workspace real.' })
        return
      }

      window.localStorage.removeItem(DEMO_MODE_KEY)
      const [realConversations, flows] = await Promise.all([
        getConversations(resolvedWorkspaceId),
        getN8nFlows(resolvedWorkspaceId).catch(() => []),
      ])
      const assistantFlow = getAssistantAgentFlow(flows, false)
      setConversationList(realConversations)
      setSelectedId(realConversations[0]?.id ?? '')
      setWorkspaceId(resolvedWorkspaceId)
      setIsRealMode(true)
      setAssistantWebhookUrl(assistantFlow.isActive ? assistantFlow.webhookUrl : '')
    } catch {
      const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
      setConversationList(mockConversations)
      setSelectedId(mockConversations[0]?.id ?? '')
      setWorkspaceId(null)
      setIsRealMode(false)
      setAssistantWebhookUrl('')
      if (!isDemoMode) toast.warning('Assistant en modo demo', { description: 'No se pudieron cargar conversaciones reales.' })
    } finally {
      setLoadingConversations(false)
    }
  }, [])

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
        const realMessages = await getConversationMessages(selected.id)
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
  }, [isRealMode, selected])

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

  const sendMessage = async () => {
    if (!input.trim() || !selected) return
    const content = input.trim()
    const conversationId = selected.id
    const userMsg: Message = { id: `agent-${Date.now()}`, conversationId, content, sender: 'agent', timestamp: nowTime() }

    appendLocalMessage(conversationId, userMsg)
    setInput('')
    setIsTyping(true)

    try {
      if (isRealMode && workspaceId) {
        await createMessage(conversationId, { content, sender: 'agent' })
        await updateConversation(conversationId, { lastMessage: content, unread: false })
        await createActivity(workspaceId, { type: 'message', description: `Mensaje enviado a ${selected.clientName}`, clientName: selected.clientName })
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

      const aiMsg: Message = { id: `ai-${Date.now()}`, conversationId, content: assistantResult.response, sender: 'ai', timestamp: nowTime() }
      appendLocalMessage(conversationId, aiMsg)

      if (isRealMode) {
        await createMessage(conversationId, { content: assistantResult.response, sender: 'ai' })
        await updateConversation(conversationId, { lastMessage: assistantResult.response, unread: true })
        if (workspaceId) {
          await createActivity(workspaceId, {
            type: 'message',
            description: assistantResult.source === 'n8n'
              ? 'Respuesta IA generada con n8n. El Assistant recibio una respuesta desde el workflow NowCRM - Assistant Agent.'
              : `Respuesta assistant generada (mock): ${selected.clientName}`,
            clientName: selected.clientName,
          })
        }
      }

      if (assistantResult.source === 'n8n') {
        toast.success('n8n/OpenAI respondió', { description: 'Respuesta guardada en la conversación.' })
      } else if (assistantN8nActive && assistantResult.trigger.status === 'error') {
        toast.warning('n8n no disponible, usando IA demo', { description: 'El mensaje se ha guardado igualmente.' })
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

  const createDemoConversation = async () => {
    const payload = {
      clientName: 'Nuevo lead demo',
      clientAvatar: 'NL',
      channel: 'WhatsApp' as Channel,
      sentiment: 'neutral' as ConversationSentiment,
      intent: 'Consulta comercial',
      lastMessage: 'Hola, me gustaría saber cómo funciona NowCRM.',
      unread: true,
    }

    try {
      if (isRealMode && workspaceId) {
        const created = await createConversation(workspaceId, payload)
        await createMessage(created.id, { content: payload.lastMessage, sender: 'client' })
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
    if (['Resumen cliente', 'Próxima acción', 'Crear factura', 'Probar agente'].includes(action)) {
      const toolByAction: Record<string, string> = {
        'Resumen cliente': 'get_client_summary',
        'Próxima acción': 'get_next_best_actions',
        'Crear factura': 'create_invoice',
        'Probar agente': 'get_workspace_summary',
      }
      const inputByAction: Record<string, Record<string, unknown>> = {
        'Resumen cliente': { name: selected.clientName },
        'Próxima acción': { conversation_id: selected.id },
        'Crear factura': { client_name: selected.clientName, concept: 'Plan Pro', amount: 299, status: 'pending', due_date: new Date().toISOString().slice(0, 10), notes: 'Factura preparada desde Assistant' },
        'Probar agente': {},
      }

      try {
        const response = await fetch('/api/agent/tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tool: toolByAction[action],
            workspace_id: workspaceId || 'demo-workspace',
            input: inputByAction[action],
            metadata: { source: 'assistant', conversation_id: selected.id, user_intent: action },
          }),
        })
        const data = await response.json() as { ok?: boolean; message?: string; mode?: string }
        const content = data.ok
          ? `Agent tool: ${toolByAction[action]}\n${data.message}${data.mode === 'fallback' ? '\nModo fallback seguro: listo para n8n con secreto.' : ''}`
          : `Agent tool no ejecutada: ${data.message ?? 'Revisa configuración.'}`
        const toolMsg: Message = { id: `tool-${Date.now()}`, conversationId: selected.id, content, sender: 'ai', timestamp: nowTime() }
        appendLocalMessage(selected.id, toolMsg)
        if (isRealMode) await createMessage(selected.id, { content, sender: 'ai' })
        toast.success(`Agente: ${action}`, { description: data.message ?? 'Tool preparada.' })
      } catch {
        toast.error('No se pudo llamar a Agent Tools', { description: 'Se mantiene la conversación sin cambios.' })
      }
      return
    }

    const responses: Record<string, string> = {
      'Generar propuesta': 'Propuesta comercial generada y lista para revisar. Incluye alcance, plan recomendado y siguiente paso.',
      'Agendar llamada': 'Llamada preparada. Puedes crear el evento desde Calendario y enviar confirmación al cliente.',
      'Enviar pricing': 'Pricing preparado para enviar por el canal preferido del cliente.',
      'Probar n8n': assistantN8nActive
        ? 'Voy a enviar un payload assistant_message al workflow real NowCRM - Assistant Agent.'
        : 'Trigger assistant_message preparado. Activa el webhook real en Settings para recibir suggested_response.',
    }
    const aiMsg: Message = { id: `ai-${Date.now()}`, conversationId: selected.id, content: responses[action] ?? 'Acción ejecutada.', sender: 'ai', timestamp: nowTime() }
    appendLocalMessage(selected.id, aiMsg)
    if (isRealMode) await createMessage(selected.id, { content: aiMsg.content, sender: 'ai' })
    if (action === 'Agendar llamada') await triggerN8nWebhook('appointment_booked', { metadata: { action }, client: { name: selected.clientName }, workspace_id: workspaceId || undefined, mode: isRealMode ? 'real' : 'demo' })
    if (action === 'Probar n8n') {
      const result = await triggerN8nWebhook('assistant_message', {
        workspace_id: workspaceId || undefined,
        webhook_url: assistantN8nActive ? assistantWebhookUrl : undefined,
        conversation: { id: selected.id, client_name: selected.clientName, channel: selected.channel, sentiment: selected.sentiment, intent: selected.intent },
        message: { content: 'Hola, me interesa saber el precio del Plan Pro y que incluye exactamente.' },
        client: { name: selected.clientName, status: 'lead' },
        metadata: { source: 'assistant_quick_action' },
        mode: assistantN8nActive ? 'real' : 'demo',
      })
      if (result.status === 'ok') {
        if (result.suggested_response) {
          const n8nMsg: Message = { id: `n8n-${Date.now()}`, conversationId: selected.id, content: result.suggested_response, sender: 'ai', timestamp: nowTime() }
          appendLocalMessage(selected.id, n8nMsg)
          if (isRealMode) await createMessage(selected.id, { content: result.suggested_response, sender: 'ai' })
        }
        toast.success('n8n respondió correctamente', { description: result.suggested_response ? 'suggested_response recibido.' : result.message })
      } else {
        toast.warning('n8n en fallback', { description: result.message })
      }
    }
    toast.success(`IA: ${action}`, { description: 'Acción preparada correctamente.' })
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

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Asistente IA"
        description={assistantN8nActive ? 'Conversaciones persistentes con n8n/OpenAI real y fallback IA demo' : isRealMode ? 'Conversaciones persistentes con IA demo y n8n preparado como backend IA' : 'Conversaciones demo con IA simulada'}
        action={
          <div className="flex items-center gap-2">
            <Badge variant={isRealMode ? 'success' : 'indigo'} dot>{isRealMode ? 'Mensajes reales' : 'Modo demo'}</Badge>
            <Badge variant={assistantN8nActive ? 'success' : 'warning'} dot>{assistantN8nActive ? 'n8n/OpenAI activo' : 'IA demo'}</Badge>
            <Button size="sm" onClick={createDemoConversation}>
              <Plus className="h-3.5 w-3.5" />
              Crear conversación demo
            </Button>
          </div>
        }
      />

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
                <p className="mt-1 text-xs text-gray-400">Crea una conversación demo para probar la IA.</p>
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
                  <Button variant="ghost" size="sm" onClick={() => handleQuickAction('Agendar llamada')}><Phone className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => handleQuickAction('Enviar pricing')}><Mail className="h-3.5 w-3.5" /></Button>
                  <Button variant="secondary" size="sm" onClick={resolveConversation}>
                    <CheckCircle className="h-3.5 w-3.5" />
                    Resolver
                  </Button>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                {loadingMessages && <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin text-indigo-500" />Cargando mensajes...</div>}
                {!loadingMessages && msgs.map((msg) => {
                  const isClient = msg.sender === 'client'
                  const isAI = msg.sender === 'ai'
                  return (
                    <div key={msg.id} className={cn('flex', isClient ? 'justify-start' : 'justify-end')}>
                      <div className="max-w-xs lg:max-w-md">
                        {isAI && <div className="mb-1 flex items-center gap-1"><Bot className="h-3 w-3 text-indigo-500" /><span className="text-[10px] font-medium text-indigo-500">IA responde</span></div>}
                        <div className={cn('rounded-2xl px-4 py-2.5 text-sm shadow-sm', isClient ? 'rounded-tl-sm bg-gray-100 text-gray-800 shadow-gray-950/[0.02]' : isAI ? 'rounded-tr-sm bg-gradient-to-br from-indigo-500 to-violet-700 text-white shadow-indigo-600/20' : 'rounded-tr-sm bg-slate-800 text-white shadow-slate-950/15')}>
                          {msg.content}
                        </div>
                        <p className={cn('mt-1 text-[10px] text-gray-400', isClient ? 'text-left' : 'text-right')}>{msg.timestamp}</p>
                      </div>
                    </div>
                  )
                })}
                {isTyping && (
                  <div className="flex justify-end">
                    <div className="flex items-center gap-1.5 rounded-2xl rounded-tr-sm bg-indigo-100 px-4 py-2.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
                      <span className="text-xs text-indigo-600">IA generando respuesta...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="border-t border-gray-100 bg-gray-50/50 p-4">
                <div className="flex items-end gap-2">
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe un mensaje o pide a la IA el siguiente paso..." rows={1} className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder:text-gray-400 transition-all focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() } }} />
                  <Button size="sm" className="h-10 w-10 shrink-0 p-0" onClick={sendMessage} disabled={isTyping || !input.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">Acciones rápidas:</span>
                  {['Generar propuesta', 'Agendar llamada', 'Enviar pricing', 'Resumen cliente', 'Próxima acción', 'Crear factura', 'Probar agente', 'Probar n8n'].map((action) => (
                    <button key={action} onClick={() => handleQuickAction(action)} className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 transition-colors hover:bg-indigo-100 hover:text-indigo-700">
                      {action}
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
                <p className="text-sm font-semibold text-gray-900">Assistant listo</p>
                <p className="mt-1 text-xs text-gray-400">Crea una conversación para probar la respuesta IA mock persistente.</p>
                <Button className="mt-4" size="sm" onClick={createDemoConversation}><Plus className="h-3.5 w-3.5" />Crear conversación demo</Button>
              </div>
            </div>
          )}
        </div>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-indigo-100 bg-[linear-gradient(180deg,#eef2ff_0%,#ffffff_44%,#f5f3ff_100%)]">
          <div className="border-b border-indigo-100 bg-gradient-to-r from-indigo-600 to-violet-700 px-4 py-3.5 text-white shadow-sm shadow-indigo-950/10">
            <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-indigo-100" /><h3 className="text-sm font-semibold">Análisis IA</h3></div>
          </div>
          {selected && (
            <div className="space-y-4 p-4">
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

              <div className="rounded-2xl border border-indigo-100 bg-white/85 p-3 shadow-sm shadow-indigo-950/[0.035] ring-1 ring-indigo-100/50">
                <p className="mb-2 text-[10px] font-semibold uppercase text-gray-400">Recomendación IA</p>
                <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-3">
                  <p className="text-xs leading-relaxed text-indigo-800">
                    {selected.sentiment === 'positive' ? 'Cliente con buena intención. Propón siguiente paso y agenda demo breve.' : selected.sentiment === 'negative' ? 'Prioriza tono empático y escala la conversación antes de automatizar.' : 'Envía contexto comercial y programa seguimiento en 48 horas.'}
                  </p>
                  <button className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700" onClick={() => toast.success('Recomendación aplicada', { description: 'La acción queda preparada en modo demo.' })}>
                    Aplicar <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                <p className="mb-1 text-[10px] font-semibold text-emerald-700">Estado técnico</p>
                <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /><span className="text-[10px] text-emerald-700">{assistantN8nActive ? 'Mensajes persistentes · n8n/OpenAI activo' : isRealMode ? 'Mensajes persistentes · IA demo' : 'Mock data · IA simulada'}</span></div>
                <p className="mt-1 text-[10px] text-emerald-600">{assistantN8nActive ? 'Fallback IA demo disponible si el webhook falla.' : 'Siguiente paso: activar Assistant Agent en Settings.'}</p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </motion.div>
  )
}
