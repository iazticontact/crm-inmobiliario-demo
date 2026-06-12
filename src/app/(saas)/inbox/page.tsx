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
  Target,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { NewOpportunityDrawer } from '@/components/VerticalForms'
import { ClientPicker } from '@/components/ClientPicker'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/current-user'
import {
  classifyConversation,
  classifyMessageOrigin,
  getConversationDisplay,
  SOURCE_PILL,
  INBOX_TABS,
  tabMatches,
  type SourceType,
  type InboxTab,
} from '@/lib/inbox-classify'

// Mirrors Settings: when NEXT_PUBLIC_NOWLABS_INTERNAL=true we can surface env
// var names and operator-facing detail. Off by default so a real client clone
// never sees META_* / OPENAI_API_KEY etc.
const SHOW_INTERNAL_TECH = process.env.NEXT_PUBLIC_NOWLABS_INTERNAL === 'true'

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

type MessageMetadata = {
  mode?: string
  send_status?: 'sent' | 'failed' | 'draft' | 'pending_config' | string
  provider?: string
  provider_message_id?: string
  reason?: string
  sent_at?: string
  failed_at?: string
  requested_at?: string
  direction?: string
} | null

type MessageRow = {
  id: string
  conversation_id: string
  sender: string
  body: string
  is_ai: boolean
  created_at: string
  metadata?: MessageMetadata
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

type ConfigSnapshot = {
  meta: { status: string; missingVariables: string[]; hasAccessToken: boolean }
  openai: { status: 'ready' | 'pending_openai_key' | 'disabled'; missingVariables: string[]; hasApiKey: boolean }
  n8n: { status: string; missingVariables: string[] }
  publicAppUrl: string | null
}

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
  const [activeTab, setActiveTab] = useState<InboxTab>('all')
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
  const [openCreateOppFromInbox, setOpenCreateOppFromInbox] = useState(false)
  const [linkingClient, setLinkingClient] = useState(false)
  const [linkingBusy, setLinkingBusy] = useState(false)

  const [config, setConfig] = useState<ConfigSnapshot | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load conversations
  const loadConversations = useCallback(async () => {
    setLoadingList(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
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
  }, [statusFilter])

  useEffect(() => {
    queueMicrotask(() => { void loadConversations() })
  }, [loadConversations])

  // Load platform config snapshot once — drives banners and disabled buttons.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/config/status')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        if (data?.snapshot) setConfig(data.snapshot as ConfigSnapshot)
      } catch {
        // silent — UI just won't show banners
      }
    }
    queueMicrotask(() => { void load() })
    return () => { cancelled = true }
  }, [])

  // Decorate every conversation with its channel + source lanes so we can
  // filter the list and render the right badge without re-deriving it.
  const decoratedConversations = useMemo(() => {
    return conversations.map((c) => {
      const classification = classifyConversation(c.channel, c.metadata)
      const meta = (c.metadata ?? {}) as Record<string, unknown>
      const display = getConversationDisplay({
        clientName: c.client_name,
        clientId: c.client_id,
        phoneFromMetadata: typeof meta.phone === 'string' ? meta.phone : null,
        channelType: classification.channelType,
      })
      return { conv: c, classification, display }
    })
  }, [conversations])

  const tabCounts = useMemo(() => {
    const out: Record<InboxTab, number> = { all: 0, whatsapp: 0 }
    for (const { classification } of decoratedConversations) {
      for (const tab of INBOX_TABS) {
        if (tabMatches(tab.key, classification)) out[tab.key] += 1
      }
    }
    return out
  }, [decoratedConversations])

  const filteredConversations = useMemo(() => {
    return decoratedConversations
      .filter(({ classification }) => tabMatches(activeTab, classification))
      .map(({ conv, classification, display }) => ({
        ...conv,
        _channel: classification.channelType,
        _source: classification.sourceType,
        _display: display,
      }))
  }, [decoratedConversations, activeTab])

  // Auto-select first conversation in the current tab. If the user changes the
  // tab away from where the selected conversation lives, fall back to the first
  // one in the new tab (or clear the selection).
  useEffect(() => {
    if (filteredConversations.length === 0) {
      if (selectedId) queueMicrotask(() => setSelectedId(null))
      return
    }
    const stillVisible = selectedId && filteredConversations.find((c) => c.id === selectedId)
    if (!stillVisible) {
      const first = filteredConversations[0]?.id ?? null
      queueMicrotask(() => setSelectedId(first))
    }
  }, [filteredConversations, selectedId])

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
      setMessages((prev) => [...prev, data.message as MessageRow])
      setComposer('')
      setAgentDecision(null)

      const sendStatus = data.send_status as 'sent' | 'failed' | 'draft' | 'pending_config' | undefined
      if (sendStatus === 'sent') {
        toast.success('Mensaje enviado a WhatsApp')
      } else if (sendStatus === 'failed') {
        toast.error('Meta rechazó el envío', { description: data.send?.message || 'Revisa el número o el estado del token.' })
      } else if (sendStatus === 'pending_config') {
        setDraftSimulated(true)
        toast.warning('Guardado como borrador', { description: data.send?.message || 'WhatsApp Meta no está configurado en el servidor.' })
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
        toast.error('El asistente no pudo procesar', { description: data.error })
        return
      }
      const decision = data.decision as AgentDecision
      setAgentDecision(decision)
      if (!decision.ok) {
        if (decision.reason === 'no_api_key') {
          toast.error(
            SHOW_INTERNAL_TECH
              ? 'Falta OPENAI_API_KEY en el servidor'
              : 'IA pendiente de configuracion del servidor',
            { description: SHOW_INTERNAL_TECH ? undefined : 'Contacta con el equipo técnico para activar esta integración.' },
          )
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
        toast.success('El asistente ha procesado la conversación')
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

  // Vincular cliente — patches conversations.client_id after picking from the
  // ClientPicker. The API also writes client_name so the inbox list refreshes
  // cleanly without an extra round-trip.
  const linkClient = async (clientId: string | null, clientName?: string | null) => {
    if (!selectedId) return
    setLinkingBusy(true)
    try {
      const res = await fetch(`/api/inbox/conversations/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      const data = await res.json()
      if (!data.ok) {
        toast.error('No se pudo vincular el cliente', { description: data.error })
        return
      }
      setConversation((prev) => prev ? { ...prev, client_id: clientId, client_name: clientName ?? prev.client_name } : prev)
      setLinkingClient(false)
      await loadConversations()
      toast.success(clientId ? 'Cliente vinculado a la conversación' : 'Vínculo de cliente eliminado')
    } catch (err) {
      console.error('[inbox/link-client] error', err)
      toast.error('Error de red vinculando cliente')
    } finally {
      setLinkingBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex h-full flex-col gap-4"
    >
      <PageHeader
        title="WhatsApp"
        description="Conversaciones y borradores de WhatsApp."
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
          Las conversaciones reales aparecerán aquí cuando WhatsApp esté conectado.
        </div>
      )}

      {!isDemo && config && config.meta.status !== 'ready' && (
        <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">WhatsApp Business pendiente de configuracion.</p>
            <p className="mt-0.5 text-indigo-700">
              {SHOW_INTERNAL_TECH ? (
                <>
                  Faltan variables en el servidor: <code className="rounded bg-white px-1 text-[10px]">{config.meta.missingVariables.join(', ') || '—'}</code>.
                  Ademas, Meta requiere una URL publica HTTPS para el webhook (Vercel, ngrok o cloudflared).
                  Hasta entonces los envios manuales se guardaran como borrador.
                </>
              ) : (
                <>Conexion Meta pendiente. La conexion tecnica esta gestionada por el equipo técnico. Hasta que se complete, los envios manuales se guardaran como borrador.</>
              )}
            </p>
          </div>
        </div>
      )}

      {!isDemo && config && config.openai.status !== 'ready' && (
        <div className="flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">El Asistente IA no está activo todavía.</p>
            <p className="mt-0.5 text-violet-700">
              {SHOW_INTERNAL_TECH ? (
                <>
                  Falta <code className="rounded bg-white px-1 text-[10px]">OPENAI_API_KEY</code> en el servidor. Los botones IA estaran desactivados hasta que se configure.
                </>
              ) : (
                <>IA pendiente de configuracion del servidor. Contacta con el equipo técnico para activar esta integración. Los botones IA estaran desactivados hasta entonces.</>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[320px,1fr,300px]">
        {/* LEFT — channel tabs + conversations list */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="shrink-0 border-b border-gray-100 px-2 pt-2">
            <div className="flex items-center gap-0.5" role="tablist" aria-label="Canal">
              {INBOX_TABS.map((tab) => {
                const active = activeTab === tab.key
                const count = tabCounts[tab.key]
                return (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(tab.key)}
                    title={tab.description}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1 rounded-t-md border-b-2 px-1.5 py-1.5 text-[11px] font-semibold transition-colors',
                      active
                        ? 'border-indigo-600 text-indigo-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700',
                    )}
                  >
                    {tab.label}
                    <span className={cn('rounded-full px-1.5 text-[10px]', active ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500')}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-2">
            <Filter className="h-3.5 w-3.5 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs"
            >
              <option value="all">Todos los estados</option>
              <option value="open">Abiertas</option>
              <option value="pending">Pendientes</option>
              <option value="resolved">Resueltas</option>
              <option value="archived">Archivadas</option>
            </select>
            <span className="ml-auto text-[10px] text-gray-400">{filteredConversations.length} conv.</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="flex h-full items-center justify-center text-xs text-gray-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
              </div>
            ) : filteredConversations.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-6 w-6 text-gray-300" />}
                title="Sin conversaciones de WhatsApp todavía"
                description={
                  SHOW_INTERNAL_TECH
                    ? 'Configura Meta Cloud API en el servidor (claves) y registra el webhook público (Vercel o cloudflared). Cuando llegue el primer mensaje real aparecerá aquí.'
                    : 'Conexión de WhatsApp pendiente. Gestionada por el equipo técnico. Cuando llegue el primer mensaje real aparecerá aquí.'
                }
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredConversations.map((c) => {
                  const active = c.id === selectedId
                  // WhatsApp-only view: ya filtramos por canal en tabMatches y la API
                  // fuerza `whatsapp`. No pintamos el badge de canal en cada fila
                  // porque sería redundante. Sólo mostramos el sourcePill cuando es
                  // simulación o caso especial (no real/internal).
                  const sourcePill = SOURCE_PILL[c._source as SourceType]
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelectedId(c.id)}
                        className={cn(
                          'flex w-full flex-col items-start gap-1 border-l-2 px-3 py-2.5 text-left transition-colors',
                          active ? 'border-indigo-500 bg-indigo-50/60' : 'border-transparent hover:bg-gray-50',
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-gray-900">
                            {c._display.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-gray-400">{formatTime(c.updated_at)}</span>
                        </div>
                        {c._display.subtitle && (
                          <p className="-mt-0.5 line-clamp-1 text-[10px] text-gray-400">{c._display.subtitle}</p>
                        )}
                        <div className="flex w-full flex-wrap items-center gap-1 text-[10px]">
                          {c._source !== 'real' && c._source !== 'internal' && (
                            <span className={cn('rounded-full border px-1.5 py-0.5 font-medium', sourcePill.tone)}>
                              {sourcePill.label}
                            </span>
                          )}
                          {c._display.unlinked && (
                            <span className="rounded-full border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-medium text-gray-500">
                              Sin vincular
                            </span>
                          )}
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
                  {(() => {
                    const classification = classifyConversation(conversation.channel, conversation.metadata)
                    const meta = (conversation.metadata ?? {}) as Record<string, unknown>
                    const display = getConversationDisplay({
                      clientName: conversation.client_name,
                      clientId: conversation.client_id,
                      phoneFromMetadata: typeof meta.phone === 'string' ? meta.phone : null,
                      channelType: classification.channelType,
                    })
                    const sourcePill = SOURCE_PILL[classification.sourceType]
                    return (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-sm font-semibold text-gray-900">{display.title}</h2>
                          {classification.sourceType !== 'real' && classification.sourceType !== 'internal' && (
                            <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', sourcePill.tone)}>
                              {sourcePill.label}
                            </span>
                          )}
                          {display.unlinked && (
                            <span className="rounded-full border border-gray-100 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                              Sin vincular
                            </span>
                          )}
                          {conversation.sentiment && conversation.sentiment !== 'neutral' && (
                            <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', SENTIMENT_TONE[conversation.sentiment])}>
                              {SENTIMENT_LABEL[conversation.sentiment]}
                            </span>
                          )}
                        </div>
                        {display.subtitle && <p className="mt-0.5 text-[11px] text-gray-400">{display.subtitle}</p>}
                        {conversation.ai_summary && <p className="mt-0.5 line-clamp-1 text-[11px] text-gray-500">{conversation.ai_summary}</p>}
                      </>
                    )
                  })()}
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
                      const origin = classifyMessageOrigin(m.metadata ?? null, m.sender)
                      const fromAi = m.is_ai || m.sender === 'ai'
                      const fromClient = m.sender === 'client'
                      const metadata = m.metadata ?? undefined
                      const sendStatus = !fromClient ? metadata?.send_status : undefined
                      const sendStatusLabel: Record<string, string> = {
                        sent: 'Enviado',
                        failed: 'Fallido',
                        draft: 'Borrador',
                        pending_config: 'Pendiente config',
                      }
                      const sendStatusTone: Record<string, string> = {
                        sent: 'bg-emerald-500/20 text-white',
                        failed: 'bg-rose-400/40 text-white',
                        draft: 'bg-white/25 text-white',
                        pending_config: 'bg-amber-400/40 text-white',
                      }

                      // System note (CRM/Copilot/Assistant). Rendered centered with
                      // a subtle pill — never as a chat bubble. This keeps the
                      // Inbox honest: a Copilot note never looks like a customer
                      // WhatsApp message.
                      if (origin === 'system_note') {
                        return (
                          <div key={m.id} className="flex justify-center">
                            <div className="max-w-[72%] rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-center text-[11px] leading-snug text-slate-600">
                              <span className="font-semibold text-slate-500">Asistente · </span>
                              <span className="whitespace-pre-wrap">{m.body}</span>
                              <span className="ml-2 text-[10px] text-slate-400">{formatDateTime(m.created_at)}</span>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div key={m.id} className={cn('flex', fromClient ? 'justify-start' : 'justify-end')}>
                          <div
                            className={cn(
                              'max-w-[66%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                              fromClient
                                ? 'rounded-bl-md border border-gray-100 bg-white text-gray-900'
                                : fromAi
                                  ? 'rounded-br-md border border-violet-100 bg-violet-50 text-violet-900'
                                  : 'rounded-br-md bg-indigo-600 text-white',
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words leading-snug">{m.body}</p>
                            <div className={cn(
                              'mt-1 flex items-center justify-end gap-1 text-[10px]',
                              fromClient ? 'text-gray-400' : fromAi ? 'text-violet-700/70' : 'text-indigo-100/80',
                            )}>
                              {fromAi && <Sparkles className="h-2.5 w-2.5" />}
                              {sendStatus && sendStatusLabel[sendStatus] && (
                                <span className={cn(
                                  'rounded-full px-1.5 py-0.5 text-[9px] font-medium',
                                  fromAi || fromClient
                                    ? 'bg-gray-100 text-gray-600'
                                    : sendStatusTone[sendStatus] ?? 'bg-white/20 text-white/90',
                                )}>
                                  {sendStatusLabel[sendStatus]}
                                </span>
                              )}
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
                  {(() => {
                    const aiDisabled = config ? config.openai.status !== 'ready' : false
                    const aiTitle = aiDisabled
                      ? (SHOW_INTERNAL_TECH
                          ? 'Configura OPENAI_API_KEY en el servidor para activar el agente IA.'
                          : 'IA pendiente de configuracion del servidor. Contacta con el equipo técnico.')
                      : undefined
                    return (
                      <>
                        <Button variant="secondary" size="sm" loading={agentBusy === 'suggest_reply'} disabled={aiDisabled} title={aiTitle} onClick={() => void runAgent('suggest_reply')}>
                          <Wand2 className="h-3.5 w-3.5" /> Sugerir respuesta
                        </Button>
                        <Button variant="secondary" size="sm" loading={agentBusy === 'summarize'} disabled={aiDisabled} title={aiTitle} onClick={() => void runAgent('summarize', true)}>
                          <Sparkles className="h-3.5 w-3.5" /> Resumir
                        </Button>
                        <Button variant="secondary" size="sm" loading={agentBusy === 'classify_intent'} disabled={aiDisabled} title={aiTitle} onClick={() => void runAgent('classify_intent', true)}>
                          Clasificar intención
                        </Button>
                        <Button variant="secondary" size="sm" loading={agentBusy === 'detect_sentiment'} disabled={aiDisabled} title={aiTitle} onClick={() => void runAgent('detect_sentiment', true)}>
                          Detectar sentimiento
                        </Button>
                        <Button variant="secondary" size="sm" loading={agentBusy === 'full_review'} disabled={aiDisabled} title={aiTitle} onClick={() => void runAgent('full_review', true)}>
                          Análisis completo
                        </Button>
                      </>
                    )
                  })()}
                </div>
                {(() => {
                  const convClassification = classifyConversation(conversation.channel, conversation.metadata)
                  const channelReady = convClassification.channelType === 'whatsapp' && config?.meta.status === 'ready'
                  const sendDisabled = !composer.trim() || sending
                  const sendTitle = !channelReady
                    ? 'WhatsApp Meta no está conectado todavía. El mensaje se guardará como borrador.'
                    : undefined
                  return (
                    <>
                      <div className="flex items-end gap-2">
                        <textarea
                          rows={2}
                          value={composer}
                          onChange={(e) => setComposer(e.target.value)}
                          placeholder={channelReady ? 'Escribe una respuesta para el cliente…' : 'Aquí solo se guardan borradores hasta que conectes el canal real…'}
                          className="min-h-[60px] flex-1 resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <div className="flex shrink-0 flex-col gap-1.5">
                          {channelReady ? (
                            <Button size="sm" loading={sending} onClick={() => void sendMessage('send')} disabled={sendDisabled} title={sendTitle}>
                              <Send className="h-3.5 w-3.5" /> Enviar
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => void sendMessage('draft')} disabled={sendDisabled} title={sendTitle}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Guardar borrador
                            </Button>
                          )}
                          {channelReady && (
                            <Button variant="secondary" size="sm" onClick={() => void sendMessage('draft')} disabled={sendDisabled}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Borrador
                            </Button>
                          )}
                        </div>
                      </div>
                      {!channelReady && (
                        <p className="mt-1 text-[10px] text-gray-400">
                          El envío real estará disponible cuando conectes el canal. Hasta entonces, lo que escribas se guarda como borrador.
                        </p>
                      )}
                      {draftSimulated && channelReady && (
                        <p className="mt-1 text-[10px] text-amber-700">
                          Último envío quedó como borrador. Revisa phone_number_id y token de Meta.
                        </p>
                      )}
                    </>
                  )
                })()}
              </div>
            </>
          )}
        </div>

        {/* RIGHT — compact contact panel. Only renders when a conversation is
            selected; otherwise the chat column already shows an empty state. */}
        {conversation && (() => {
          const classification = classifyConversation(conversation.channel, conversation.metadata)
          const meta = (conversation.metadata ?? {}) as Record<string, unknown>
          const phoneFromMeta = typeof meta.phone === 'string' ? meta.phone : null
          const display = getConversationDisplay({
            clientName: conversation.client_name,
            clientId: conversation.client_id,
            phoneFromMetadata: phoneFromMeta,
            channelType: classification.channelType,
          })
          return (
            <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:flex">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-900">Contacto</h3>
                </div>
                <span className="rounded-full border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  WhatsApp
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-900">{display.title}</p>
                  {client?.company ? (
                    <p className="text-gray-500">{client.company}</p>
                  ) : display.subtitle ? (
                    <p className="text-gray-400">{display.subtitle}</p>
                  ) : null}
                </div>

                {(client?.email || client?.phone || phoneFromMeta) && (
                  <div className="mt-3 space-y-1">
                    {client?.email && (
                      <p className="flex items-center gap-1.5 text-gray-700"><Mail className="h-3 w-3 text-gray-400" />{client.email}</p>
                    )}
                    {(client?.phone || phoneFromMeta) && (
                      <p className="flex items-center gap-1.5 text-gray-700"><Phone className="h-3 w-3 text-gray-400" />{client?.phone || phoneFromMeta}</p>
                    )}
                  </div>
                )}

                {client?.status && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">{client.status}</span>
                  </div>
                )}

                {display.unlinked && !linkingClient && (
                  <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] leading-snug text-gray-500">
                    Esta conversación no está vinculada a un cliente del CRM.
                    <button
                      type="button"
                      onClick={() => setLinkingClient(true)}
                      className="mt-1 block text-[10px] font-semibold text-indigo-600 hover:underline"
                    >
                      Vincular cliente →
                    </button>
                  </div>
                )}

                {linkingClient && (
                  <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/40 px-2.5 py-2">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Vincular cliente</p>
                      <button
                        type="button"
                        onClick={() => setLinkingClient(false)}
                        disabled={linkingBusy}
                        className="text-[10px] text-gray-500 hover:text-gray-700"
                      >
                        Cancelar
                      </button>
                    </div>
                    <ClientPicker
                      workspaceId={currentUser?.workspaceId ?? null}
                      value={null}
                      disabled={linkingBusy}
                      onChange={(id, picked) => { if (id) void linkClient(id, picked?.name ?? null) }}
                    />
                    <p className="mt-1.5 text-[10px] leading-snug text-gray-500">
                      Busca un cliente existente. La actividad de la conversación quedará vinculada a su Cliente 360.
                    </p>
                  </div>
                )}

                {!display.unlinked && conversation.client_id && (
                  <div className="mt-3 text-right">
                    <button
                      type="button"
                      onClick={() => void linkClient(null)}
                      disabled={linkingBusy}
                      className="text-[10px] font-medium text-gray-500 hover:text-rose-600"
                    >
                      Quitar vínculo de cliente
                    </button>
                  </div>
                )}

                {conversation.ai_summary && (
                  <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50 px-2.5 py-2 text-[11px] leading-snug text-violet-900">
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-500">Resumen IA</p>
                    {conversation.ai_summary}
                  </div>
                )}

                {/* Manual operator actions — keep separate from auto-reply / agent. */}
                <div className="mt-4 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Acciones manuales</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => setOpenCreateOppFromInbox(true)}
                  >
                    <Target className="h-3.5 w-3.5" />
                    Crear oportunidad desde esta conversación
                  </Button>
                </div>
              </div>
              <div className="shrink-0 border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400">
                Actualizada {formatDateTime(conversation.updated_at)}
              </div>
            </aside>
          )
        })()}
      </div>

      {/* Manual: crear oportunidad desde la conversación seleccionada. */}
      <NewOpportunityDrawer
        open={openCreateOppFromInbox}
        onClose={() => setOpenCreateOppFromInbox(false)}
        workspaceId={currentUser?.workspaceId ?? null}
        defaultClientId={conversation?.client_id ?? null}
        defaultClientName={conversation?.client_name ?? null}
        defaultSource={conversation?.channel ?? 'inbox'}
        onCreated={() => { /* nothing — toast handled by drawer */ }}
      />
    </motion.div>
  )
}
