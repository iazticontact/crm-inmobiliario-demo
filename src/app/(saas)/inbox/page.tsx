'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Inbox,
  MessageSquare,
  Send,
  Sparkles,
  Wand2,
  CheckCircle2,
  Loader2,
  Archive,
  Filter,
  RefreshCcw,
  AlertTriangle,
  User,
  Phone,
  Mail,
  Lock,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/current-user'

type ConversationRow = {
  id: string
  workspace_id: string
  client_id: string | null
  client_name: string | null
  client_avatar: string | null
  channel: string
  status: string
  sentiment: string | null
  intent: string | null
  ai_summary: string | null
  unread: boolean
  updated_at: string
  created_at: string
  metadata: Record<string, unknown> | null
}

type MessageRow = {
  id: string
  conversation_id: string
  sender: string
  body: string
  is_ai: boolean
  created_at: string
}

type ClientRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  status: string | null
  lead_score: number | null
}

type AgentDecision = {
  ok: boolean
  reason?: string
  summary?: string
  next_action?: string
  intent?: string
  intent_confidence?: number
  sentiment?: string
  suggested_reply?: string
  needs_human?: boolean
  notes?: string
}

type StatusFilter = 'all' | 'open' | 'pending' | 'resolved' | 'archived'

const STATUS_LABEL: Record<string, string> = {
  open: 'Abierta',
  pending: 'Pendiente',
  resolved: 'Resuelta',
  archived: 'Archivada',
}

const SENTIMENT_LABEL: Record<string, string> = {
  positive: 'Positivo',
  neutral: 'Neutral',
  negative: 'Negativo',
  urgent: 'Urgente',
}

const SENTIMENT_TONE: Record<string, string> = {
  positive: 'text-emerald-700 bg-emerald-50 border-emerald-100',
  neutral: 'text-gray-600 bg-gray-50 border-gray-100',
  negative: 'text-rose-700 bg-rose-50 border-rose-100',
  urgent: 'text-amber-700 bg-amber-50 border-amber-100',
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  web: 'Web',
  instagram: 'Instagram',
  crm: 'CRM',
}

function formatTime(value: string) {
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    const today = new Date()
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
  } catch {
    return ''
  }
}

function formatDateTime(value: string) {
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function InboxPage() {
  const { currentUser } = useCurrentUser()
  const isDemo = currentUser?.isDemo ?? true

  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [conversation, setConversation] = useState<ConversationRow | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [client, setClient] = useState<ClientRow | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [draftSimulated, setDraftSimulated] = useState(false)

  const [agentBusy, setAgentBusy] = useState<null | 'summarize' | 'classify_intent' | 'detect_sentiment' | 'suggest_reply' | 'full_review'>(null)
  const [agentDecision, setAgentDecision] = useState<AgentDecision | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load conversations
  const loadConversations = useCallback(async () => {
    setLoadingList(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (channelFilter !== 'all') params.set('channel', channelFilter)
      params.set('limit', '60')

      const res = await fetch(`/api/inbox/conversations?${params.toString()}`)
      const data = await res.json()
      if (!data.ok) {
        if (res.status !== 401) toast.error('No se pudieron cargar las conversaciones', { description: data.error })
        setConversations([])
        return
      }
      setConversations(data.conversations || [])
    } catch (err) {
      console.error('[inbox/list] error', err)
      setConversations([])
    } finally {
      setLoadingList(false)
    }
  }, [statusFilter, channelFilter])

  useEffect(() => {
    queueMicrotask(() => { void loadConversations() })
  }, [loadConversations])

  // Auto-select first conversation when list loads
  useEffect(() => {
    const needsAutoSelect = (!selectedId && conversations.length > 0)
      || (selectedId && conversations.length > 0 && !conversations.find((c) => c.id === selectedId))
    if (needsAutoSelect) {
      const first = conversations[0]?.id ?? null
      queueMicrotask(() => setSelectedId(first))
    }
  }, [conversations, selectedId])

  // Load conversation detail
  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true)
    setAgentDecision(null)
    try {
      const res = await fetch(`/api/inbox/conversations/${id}`)
      const data = await res.json()
      if (!data.ok) {
        toast.error('No se pudo cargar la conversación', { description: data.error })
        setConversation(null)
        setMessages([])
        setClient(null)
        return
      }
      setConversation(data.conversation)
      setMessages(data.messages || [])
      setClient(data.client || null)
    } catch (err) {
      console.error('[inbox/detail] error', err)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId) {
      queueMicrotask(() => { void loadDetail(selectedId) })
    } else {
      queueMicrotask(() => {
        setConversation(null)
        setMessages([])
        setClient(null)
      })
    }
  }, [selectedId, loadDetail])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const sendMessage = async (mode: 'draft' | 'send', isAi = false) => {
    if (!selectedId || !composer.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/inbox/conversations/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: composer.trim(), mode, isAi }),
      })
      const data = await res.json()
      if (!data.ok) {
        if (data.reason === 'invalid_recipient') {
          toast.error('Falta teléfono del cliente', { description: data.message })
        } else {
          toast.error('No se pudo enviar el mensaje', { description: data.error || data.message })
        }
        return
      }
      setMessages((prev) => [...prev, data.message])
      setComposer('')
      setAgentDecision(null)

      if (mode === 'send' && data.send?.ok) {
        toast.success('Mensaje enviado a WhatsApp')
      } else if (mode === 'send' && data.send && !data.send.ok) {
        setDraftSimulated(true)
        toast.warning('Guardado como borrador', { description: data.send.message || 'Outbound no está disponible ahora mismo.' })
      } else {
        toast.success('Mensaje guardado como borrador')
      }
    } catch (err) {
      console.error('[inbox/send] error', err)
      toast.error('Error de red enviando el mensaje')
    } finally {
      setSending(false)
    }
  }

  const runAgent = async (task: 'summarize' | 'classify_intent' | 'detect_sentiment' | 'suggest_reply' | 'full_review', persist = false) => {
    if (!selectedId) return
    setAgentBusy(task)
    try {
      const res = await fetch('/api/inbox/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: selectedId, task, persist }),
      })
      const data = await res.json()
      if (!data.ok) {
        toast.error('NowLabs no pudo procesar', { description: data.error })
        return
      }
      const decision = data.decision as AgentDecision
      setAgentDecision(decision)
      if (!decision.ok) {
        if (decision.reason === 'no_api_key') {
          toast.error('Falta OPENAI_API_KEY en el servidor')
        } else if (decision.reason === 'empty_conversation') {
          toast.info('No hay mensajes para analizar')
        } else if (decision.reason === 'openai_error') {
          toast.error('OpenAI no respondió')
        } else if (decision.reason === 'parse_error') {
          toast.warning('Respuesta IA no estructurada', { description: 'Reintenta o reduce contexto.' })
        }
        return
      }
      if (decision.suggested_reply) {
        setComposer(decision.suggested_reply)
      }
      if (persist && data.applied) {
        await loadDetail(selectedId)
        await loadConversations()
        toast.success('Análisis guardado en la conversación')
      } else {
        toast.success('NowLabs ha procesado la conversación')
      }
    } catch (err) {
      console.error('[inbox/agent] error', err)
      toast.error('Error de red llamando al agente')
    } finally {
      setAgentBusy(null)
    }
  }

  const changeStatus = async (newStatus: 'open' | 'pending' | 'resolved' | 'archived') => {
    if (!selectedId) return
    setSavingStatus(true)
    try {
      const res = await fetch(`/api/inbox/conversations/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (!data.ok) {
        toast.error('No se pudo actualizar', { description: data.error })
        return
      }
      setConversation((prev) => prev ? { ...prev, status: newStatus } : prev)
      await loadConversations()
      toast.success(`Conversación marcada como ${STATUS_LABEL[newStatus] || newStatus}`)
    } catch (err) {
      console.error('[inbox/status] error', err)
    } finally {
      setSavingStatus(false)
    }
  }

  const channels = useMemo(() => {
    const set = new Set<string>(['whatsapp', 'email', 'web', 'instagram', 'crm'])
    conversations.forEach((c) => c.channel && set.add(c.channel.toLowerCase()))
    return Array.from(set)
  }, [conversations])

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex h-full flex-col gap-4"
    >
      <PageHeader
        title="Inbox"
        description="Mensajes reales de tus clientes. NowLabs AI te ayuda a resumir, clasificar y responder."
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void loadConversations()} disabled={loadingList}>
              <RefreshCcw className={cn('h-3.5 w-3.5', loadingList && 'animate-spin')} />
              Refrescar
            </Button>
          </div>
        }
      />

      {isDemo && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Estás en modo demo. Las conversaciones reales requieren sesión auténtica y el webhook de Meta configurado.
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px,1fr,320px]">
        {/* LEFT — conversations list */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-2">
            <Filter className="h-3.5 w-3.5 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs"
            >
              <option value="all">Todas</option>
              <option value="open">Abiertas</option>
              <option value="pending">Pendientes</option>
              <option value="resolved">Resueltas</option>
              <option value="archived">Archivadas</option>
            </select>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs"
            >
              <option value="all">Canales</option>
              {channels.map((c) => (
                <option key={c} value={c}>{CHANNEL_LABEL[c] || c}</option>
              ))}
            </select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="flex h-full items-center justify-center text-xs text-gray-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
              </div>
            ) : conversations.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-6 w-6 text-gray-300" />}
                title="Sin conversaciones"
                description="Cuando entre un mensaje desde WhatsApp, lo verás aquí."
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {conversations.map((c) => {
                  const active = c.id === selectedId
                  const channelLabel = CHANNEL_LABEL[c.channel?.toLowerCase()] || c.channel
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelectedId(c.id)}
                        className={cn(
                          'flex w-full flex-col items-start gap-1 border-l-2 px-3 py-2.5 text-left transition-colors',
                          active ? 'border-indigo-500 bg-indigo-50/50' : 'border-transparent hover:bg-gray-50',
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-gray-900">
                            {c.client_name || 'Sin cliente'}
                          </span>
                          <span className="shrink-0 text-[10px] text-gray-400">{formatTime(c.updated_at)}</span>
                        </div>
                        <div className="flex w-full items-center gap-1.5 text-[10px] text-gray-500">
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">{channelLabel}</span>
                          {c.sentiment && c.sentiment !== 'neutral' && (
                            <span className={cn('rounded-full border px-1.5 py-0.5 font-medium', SENTIMENT_TONE[c.sentiment] || 'border-gray-100 bg-gray-50 text-gray-500')}>
                              {SENTIMENT_LABEL[c.sentiment] || c.sentiment}
                            </span>
                          )}
                          {c.status !== 'open' && (
                            <span className="rounded-full bg-gray-50 px-1.5 py-0.5 text-gray-500">
                              {STATUS_LABEL[c.status] || c.status}
                            </span>
                          )}
                          {c.unread && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-500" />}
                        </div>
                        {c.ai_summary && (
                          <p className="line-clamp-1 text-[11px] text-gray-500">{c.ai_summary}</p>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* CENTER — chat */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {!selectedId ? (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                icon={<MessageSquare className="h-6 w-6 text-gray-300" />}
                title="Selecciona una conversación"
                description="Elige una conversación de la lista para verla."
              />
            </div>
          ) : loadingDetail ? (
            <div className="flex h-full items-center justify-center text-xs text-gray-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando mensajes…
            </div>
          ) : !conversation ? (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState title="Conversación no disponible" description="Refresca la lista." />
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-gray-900">{conversation.client_name || 'Sin cliente'}</h2>
                    <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                      {CHANNEL_LABEL[conversation.channel?.toLowerCase()] || conversation.channel}
                    </span>
                    {conversation.sentiment && conversation.sentiment !== 'neutral' && (
                      <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', SENTIMENT_TONE[conversation.sentiment])}>
                        {SENTIMENT_LABEL[conversation.sentiment]}
                      </span>
                    )}
                  </div>
                  {conversation.ai_summary && <p className="line-clamp-1 text-[11px] text-gray-500">{conversation.ai_summary}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <select
                    value={conversation.status}
                    onChange={(e) => void changeStatus(e.target.value as 'open' | 'pending' | 'resolved' | 'archived')}
                    disabled={savingStatus}
                    className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs"
                  >
                    <option value="open">Abierta</option>
                    <option value="pending">Pendiente</option>
                    <option value="resolved">Resuelta</option>
                    <option value="archived">Archivada</option>
                  </select>
                  <Button variant="ghost" size="sm" onClick={() => void changeStatus('archived')} disabled={savingStatus} title="Archivar">
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50/40 px-4 py-4">
                {messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState
                      icon={<MessageSquare className="h-6 w-6 text-gray-300" />}
                      title="Sin mensajes todavía"
                      description="El primer mensaje aparecerá aquí en cuanto entre por el webhook."
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {messages.map((m) => {
                      const fromClient = m.sender === 'client'
                      const fromAi = m.is_ai || m.sender === 'ai'
                      return (
                        <div key={m.id} className={cn('flex', fromClient ? 'justify-start' : 'justify-end')}>
                          <div
                            className={cn(
                              'max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                              fromClient
                                ? 'bg-white text-gray-900 border border-gray-100 rounded-bl-md'
                                : fromAi
                                ? 'bg-violet-50 text-violet-900 border border-violet-100 rounded-br-md'
                                : 'bg-indigo-600 text-white rounded-br-md',
                            )}
                          >
                            <p className="whitespace-pre-wrap leading-snug">{m.body}</p>
                            <div className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', fromClient ? 'text-gray-400' : fromAi ? 'text-violet-700/70' : 'text-indigo-100/80')}>
                              {fromAi && <Sparkles className="h-2.5 w-2.5" />}
                              {formatDateTime(m.created_at)}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {agentDecision?.ok && (
                <div className="shrink-0 space-y-1 border-t border-violet-100 bg-violet-50/60 px-4 py-2 text-xs text-violet-900">
                  {agentDecision.summary && (
                    <p><strong>Resumen IA:</strong> {agentDecision.summary}</p>
                  )}
                  {agentDecision.intent && (
                    <p><strong>Intención:</strong> {agentDecision.intent}{agentDecision.intent_confidence ? ` · ${Math.round(agentDecision.intent_confidence * 100)}%` : ''}</p>
                  )}
                  {agentDecision.next_action && (
                    <p><strong>Siguiente acción:</strong> {agentDecision.next_action}</p>
                  )}
                  {agentDecision.needs_human && (
                    <p className="font-semibold text-rose-700"><Lock className="mr-1 inline h-3 w-3" />Necesita revisión humana antes de enviar.</p>
                  )}
                  {agentDecision.notes && <p className="text-violet-700/80">{agentDecision.notes}</p>}
                </div>
              )}

              <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <Button variant="secondary" size="sm" loading={agentBusy === 'suggest_reply'} onClick={() => void runAgent('suggest_reply')}>
                    <Wand2 className="h-3.5 w-3.5" /> Sugerir respuesta
                  </Button>
                  <Button variant="secondary" size="sm" loading={agentBusy === 'summarize'} onClick={() => void runAgent('summarize', true)}>
                    <Sparkles className="h-3.5 w-3.5" /> Resumir
                  </Button>
                  <Button variant="secondary" size="sm" loading={agentBusy === 'classify_intent'} onClick={() => void runAgent('classify_intent', true)}>
                    Clasificar intención
                  </Button>
                  <Button variant="secondary" size="sm" loading={agentBusy === 'detect_sentiment'} onClick={() => void runAgent('detect_sentiment', true)}>
                    Detectar sentimiento
                  </Button>
                  <Button variant="secondary" size="sm" loading={agentBusy === 'full_review'} onClick={() => void runAgent('full_review', true)}>
                    Análisis completo
                  </Button>
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    rows={2}
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    placeholder="Escribe una respuesta para el cliente…"
                    className="min-h-[60px] flex-1 resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button size="sm" loading={sending} onClick={() => void sendMessage('send')} disabled={!composer.trim()}>
                      <Send className="h-3.5 w-3.5" /> Enviar
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => void sendMessage('draft')} disabled={!composer.trim() || sending}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Borrador
                    </Button>
                  </div>
                </div>
                {draftSimulated && (
                  <p className="mt-1 text-[10px] text-amber-700">
                    Último envío quedó como borrador (outbound no configurado). Configura phone_number_id y token de Meta para envíos reales.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* RIGHT — client panel */}
        <div className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:flex">
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-3">
            <User className="h-3.5 w-3.5 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Cliente</h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs">
            {!conversation ? (
              <p className="text-gray-400">Selecciona una conversación.</p>
            ) : !client ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-900">{conversation.client_name || 'Sin cliente vinculado'}</p>
                <p className="text-gray-500">Esta conversación no está vinculada a un cliente del CRM.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{client.name}</p>
                  {client.company && <p className="text-gray-500">{client.company}</p>}
                </div>
                <div className="space-y-1">
                  {client.email && (
                    <p className="flex items-center gap-1.5 text-gray-700"><Mail className="h-3 w-3 text-gray-400" />{client.email}</p>
                  )}
                  {client.phone && (
                    <p className="flex items-center gap-1.5 text-gray-700"><Phone className="h-3 w-3 text-gray-400" />{client.phone}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {client.status && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">{client.status}</span>}
                  {typeof client.lead_score === 'number' && (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">Score {client.lead_score}</span>
                  )}
                </div>
              </div>
            )}
          </div>
          {conversation && (
            <div className="shrink-0 border-t border-gray-100 px-4 py-3 text-[10px] text-gray-400">
              Creada {formatDateTime(conversation.created_at)} · actualizada {formatDateTime(conversation.updated_at)}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
