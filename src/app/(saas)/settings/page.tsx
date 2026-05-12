'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  Bell,
  Building2,
  Calendar,
  CheckCircle,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MessageSquare,
  Play,
  RefreshCw,
  Shield,
  User,
  Wifi,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { ASSISTANT_AGENT_WEBHOOK_URL, getAssistantAgentFlow, n8nWebhookConfigs, simulateWhatsAppIncomingLead, supabaseStatus, triggerN8nWebhook, type WebhookConfig } from '@/lib/integrations'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/current-user'
import {
  createActivity,
  disconnectGoogleCalendar,
  disconnectWhatsapp,
  getGoogleCalendarConnection,
  getInboxAgentSettings,
  getIntegrationSettings,
  getN8nFlows,
  getResolvedWorkspaceContext,
  getWhatsappConnection,
  seedN8nFlows,
  updateIntegrationSetting,
  updateN8nFlow,
  upsertGoogleCalendarConnection,
  upsertInboxAgentSettings,
  upsertIntegrationSetting,
  upsertN8nFlow,
  upsertWhatsappConnection,
} from '@/lib/supabase-queries'
import type { IntegrationSetting, IntegrationStatus, N8nFlow, N8nFlowStatus } from '@/lib/types'

type IntegrationCard = {
  id: string
  name: string
  description: string
  status: IntegrationStatus
  icon: React.ReactNode
  info?: string
  category: string
}

const integrations: IntegrationCard[] = [
  { id: 'supabase', name: 'Supabase', description: 'Auth, datos reales y persistencia por workspace.', status: 'connected', icon: <Database className="h-5 w-5" />, category: 'Core' },
  { id: 'agent-tools', name: 'AI Agent Tools', description: 'API interna para que n8n/OpenAI consulte y ejecute acciones CRM controladas.', status: 'demo_ready', icon: <Zap className="h-5 w-5" />, category: 'IA' },
  { id: 'n8n', name: 'n8n', description: 'Capa de automatizacion por webhooks y workflows externos.', status: 'demo_ready', icon: <Zap className="h-5 w-5" />, category: 'Automatizacion' },
  { id: 'whatsapp', name: 'WhatsApp / Whapi', description: 'Siguiente fase: QR, webhook Whapi y n8n para mensajes entrantes.', status: 'pending_config', icon: <MessageSquare className="h-5 w-5" />, info: 'Pendiente QR + webhook', category: 'Mensajeria' },
  { id: 'instagram', name: 'Instagram Direct', description: 'Bandeja social preparada para mensajes y leads de Instagram.', status: 'pending', icon: <Globe className="h-5 w-5" />, info: '@nowcrm.demo', category: 'Social' },
  { id: 'email', name: 'Email / Resend', description: 'Emails transaccionales y secuencias cuando exista dominio.', status: 'pending', icon: <Mail className="h-5 w-5" />, category: 'Email' },
  { id: 'resend', name: 'Resend', description: 'SMTP transaccional para confirmaciones y reset con dominio.', status: 'pending_config', icon: <Mail className="h-5 w-5" />, category: 'Email' },
  { id: 'openai', name: 'OpenAI / IA', description: 'Activo dentro del workflow n8n Assistant Agent. La key no vive en NowCRM.', status: 'demo_connected', icon: <MessageSquare className="h-5 w-5" />, category: 'IA' },
  { id: 'storage', name: 'Documents / PDFs', description: 'Supabase Storage preparado para propuestas, facturas PDF y adjuntos futuros.', status: 'pending_config', icon: <Database className="h-5 w-5" />, category: 'Storage' },
  { id: 'stripe', name: 'Stripe Payments', description: 'Cobros, suscripciones y eventos de pago para fase real.', status: 'pending', icon: <Shield className="h-5 w-5" />, category: 'Pagos' },
  { id: 'slack', name: 'Slack', description: 'Alertas internas de leads, cobros y conversaciones urgentes.', status: 'disconnected', icon: <Bell className="h-5 w-5" />, category: 'Equipo' },
]

const architectureCards = [
  { title: 'Supabase', label: 'Auth y datos reales', detail: 'Conectado', icon: <Database className="h-5 w-5" />, tone: 'border-emerald-100 bg-gradient-to-br from-emerald-50 to-white text-emerald-700' },
  { title: 'n8n', label: 'Webhooks y flujos', detail: 'Preparado', icon: <Zap className="h-5 w-5" />, tone: 'border-indigo-100 bg-gradient-to-br from-indigo-50 to-white text-indigo-700' },
  { title: 'Agent Tools', label: 'Tools CRM seguras', detail: 'Preparado', icon: <Zap className="h-5 w-5" />, tone: 'border-violet-100 bg-gradient-to-br from-violet-50 to-white text-violet-700' },
  { title: 'Canales', label: 'Whapi, Email, Stripe', detail: 'Pendiente', icon: <Globe className="h-5 w-5" />, tone: 'border-amber-100 bg-gradient-to-br from-amber-50 to-white text-amber-700' },
]

const notifDefaults = [
  { key: 'leads', label: 'Nuevos leads', description: 'Cuando un lead entra por cualquier canal', enabled: true },
  { key: 'invoices', label: 'Facturas vencidas', description: 'Alertas de pagos pendientes y recordatorios IA', enabled: true },
  { key: 'dailyReport', label: 'Resumen diario IA', description: 'Briefing matutino con ventas, alertas y siguientes acciones', enabled: true },
  { key: 'urgent', label: 'Conversaciones urgentes', description: 'Cuando la IA detecta sentimiento negativo o alta intencion', enabled: false },
]

const supabaseReadiness = [
  { label: 'Auth', value: 'Real', status: 'Login, registro, callback, reset y logout' },
  { label: 'Clientes', value: 'Real', status: 'CRUD completo con notas y filtros por workspace' },
  { label: 'Facturacion', value: 'Real', status: 'Facturas persistentes y metricas por workspace' },
  { label: 'Calendario', value: 'Real', status: 'Eventos persistentes con citas desde IA' },
  { label: 'Assistant', value: 'Real + n8n', status: 'Mensajes reales y NowLabs AI conectado' },
  { label: 'Agent Tools', value: 'Preparado', status: 'Endpoint seguro con allowlist de acciones' },
  { label: 'OpenAI', value: 'Via n8n', status: 'Clave solo en credenciales n8n, no en frontend' },
  { label: 'n8n Agent', value: 'Activo', status: 'Webhook assistant_message conectado' },
  { label: 'Documentos', value: 'Preparado', status: 'PDFs de informes y facturas generados' },
  { label: 'Dashboard', value: 'Real', status: 'KPIs de clientes, facturas y calendario reales' },
  { label: 'n8n Flows', value: 'Configurable', status: 'Endpoints y estados por flujo configurables' },
  { label: 'Produccion', value: 'Pendiente', status: 'Dominio, Resend y deploy en siguiente fase' },
]

const productStatusCards = [
  { label: 'Core CRM', value: 'Operativo', detail: 'Auth, workspace, clientes, facturacion y calendario', tone: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
  { label: 'NowLabs AI', value: 'Activo', detail: 'Conversaciones reales con NowLabs AI', tone: 'border-indigo-100 bg-indigo-50 text-indigo-700' },
  { label: 'Agent Tools', value: 'Preparado', detail: 'Acciones CRM seguras via API interna', tone: 'border-sky-100 bg-sky-50 text-sky-700' },
  { label: 'Documentos', value: 'Activo', detail: 'PDFs de informes y facturas generados', tone: 'border-blue-100 bg-blue-50 text-blue-700' },
  { label: 'n8n Flows', value: 'Configurable', detail: 'Endpoints y estados de automatizacion', tone: 'border-violet-100 bg-violet-50 text-violet-700' },
  { label: 'Canales', value: 'Proxima fase', detail: 'WhatsApp, Email y pagos por conectar', tone: 'border-amber-100 bg-amber-50 text-amber-700' },
]

const flowStatusConfig: Record<N8nFlowStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'indigo' | 'default' }> = {
  active: { label: 'Activo', variant: 'success' },
  demo: { label: 'Demo', variant: 'indigo' },
  pending_config: { label: 'Pendiente config', variant: 'warning' },
  inactive: { label: 'Inactivo', variant: 'default' },
  error: { label: 'Error', variant: 'danger' },
}

const envChecks = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', label: 'Project URL', ready: supabaseStatus.hasUrl },
  { key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', label: 'Publishable key', ready: supabaseStatus.hasPublishableKey },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', label: 'Anon key publica', ready: supabaseStatus.hasAnonKey },
]

function statusBadge(status: IntegrationStatus) {
  if (status === 'connected') return <Badge variant="success" dot>Conectado</Badge>
  if (status === 'demo_connected') return <Badge variant="indigo" dot>Demo conectado</Badge>
  if (status === 'demo_ready') return <Badge variant="indigo" dot>Demo ready</Badge>
  if (status === 'error') return <Badge variant="danger" dot>Error</Badge>
  if (status === 'pending_config') return <Badge variant="warning" dot>Pendiente config</Badge>
  if (status === 'pending') return <Badge variant="warning" dot>Pendiente</Badge>
  return <Badge variant="default" dot>Desconectado</Badge>
}

function defaultPath(config: WebhookConfig) {
  return config.url.replace('https://n8n.tudominio.com', '')
}

function splitWebhookUrl(value: string) {
  if (!value) return { base: 'https://n8n.tudominio.com', path: '' }
  try {
    const url = new URL(value)
    return { base: `${url.protocol}//${url.host}`, path: `${url.pathname}${url.search}` }
  } catch {
    return { base: 'https://n8n.tudominio.com', path: value.startsWith('/') ? value : `/${value}` }
  }
}

export default function SettingsPage() {
  const { currentUser } = useCurrentUser()
  const [notifications, setNotifications] = useState<Record<string, boolean>>(
    Object.fromEntries(notifDefaults.map((n) => [n.key, n.enabled]))
  )
  const [integrationStatuses, setIntegrationStatuses] = useState<Record<string, IntegrationStatus>>(
    Object.fromEntries(integrations.map((intg) => [intg.id, intg.status]))
  )
  const [integrationIds, setIntegrationIds] = useState<Record<string, string>>({})
  const [simulatingWA, setSimulatingWA] = useState(false)
  const [n8nUrl, setN8nUrl] = useState('https://n8n.tudominio.com')
  const [testingKey, setTestingKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsPersisted, setSettingsPersisted] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [flowIds, setFlowIds] = useState<Record<string, string>>({})
  const [flowStatuses, setFlowStatuses] = useState<Record<string, N8nFlowStatus>>(
    Object.fromEntries(n8nWebhookConfigs.map((wh) => [wh.event, wh.status]))
  )
  const [flowPaths, setFlowPaths] = useState<Record<string, string>>(
    Object.fromEntries(n8nWebhookConfigs.map((wh) => [wh.event, defaultPath(wh)]))
  )
  const [gcalConnection, setGcalConnection] = useState<Record<string, unknown> | null>(null)
  const [gcalCalendarId, setGcalCalendarId] = useState('')
  const [gcalSyncEnabled, setGcalSyncEnabled] = useState(false)
  const [gcalLoading, setGcalLoading] = useState(false)
  const [waConnection, setWaConnection] = useState<Record<string, unknown> | null>(null)
  const [waPhoneNumber, setWaPhoneNumber] = useState('')
  const [waWebhookUrl, setWaWebhookUrl] = useState('')
  const [waLoading, setWaLoading] = useState(false)
  const [inboxSettings, setInboxSettings] = useState<Record<string, unknown> | null>(null)
  const [inboxAutoReply, setInboxAutoReply] = useState(false)

  const flowConfigByEvent = useMemo(() => new Map<string, WebhookConfig>(n8nWebhookConfigs.map((flow) => [flow.event, flow])), [])

  const visibleWorkspaceItems = currentUser.isDemo ? [
    { label: 'Nombre del workspace', value: 'NowCRM Demo', icon: <Building2 className="h-4 w-4" /> },
    { label: 'Email de administrador', value: 'demo@nowcrm.local', icon: <Mail className="h-4 w-4" /> },
    { label: 'Estado', value: 'Modo demo', icon: <Shield className="h-4 w-4" /> },
    { label: 'Idioma', value: 'Espanol', icon: <User className="h-4 w-4" /> },
  ] : [
    { label: 'Nombre del workspace', value: currentUser.workspaceName, icon: <Building2 className="h-4 w-4" /> },
    { label: 'Email de administrador', value: currentUser.email, icon: <Mail className="h-4 w-4" /> },
    { label: 'Estado', value: currentUser.trialLabel, icon: <Shield className="h-4 w-4" /> },
    { label: 'Idioma', value: 'Espanol', icon: <User className="h-4 w-4" /> },
  ]

  const composeFlowUrl = useCallback((event: string) => {
    const rawPath = flowPaths[event] ?? ''
    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return rawPath
    return `${n8nUrl.replace(/\/$/, '')}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`
  }, [flowPaths, n8nUrl])

  const assistantAgentFlow = getAssistantAgentFlow([{
    event: 'assistant_message',
    status: flowStatuses.assistant_message,
    webhookUrl: composeFlowUrl('assistant_message'),
  }], currentUser.isDemo)
  const assistantAgentUrl = assistantAgentFlow.webhookUrl
  const assistantAgentActive = assistantAgentFlow.isActive

  const applyRemoteFlows = useCallback((flows: N8nFlow[]) => {
    if (!flows.length) return
    const ids: Record<string, string> = {}
    const statuses: Record<string, N8nFlowStatus> = {}
    const paths: Record<string, string> = {}
    let nextBase = n8nUrl

    for (const flow of flows) {
      ids[flow.event] = flow.id
      statuses[flow.event] = flow.status
      const split = splitWebhookUrl(flow.webhookUrl)
      paths[flow.event] = split.path || defaultPath(flowConfigByEvent.get(flow.event) ?? n8nWebhookConfigs[0])
      if (flow.webhookUrl && !flow.webhookUrl.includes('tudominio.com')) nextBase = split.base
    }

    setFlowIds((prev) => ({ ...prev, ...ids }))
    setFlowStatuses((prev) => ({ ...prev, ...statuses }))
    setFlowPaths((prev) => ({ ...prev, ...paths }))
    setN8nUrl(nextBase)
  }, [flowConfigByEvent, n8nUrl])

  const applyRemoteIntegrations = useCallback((remoteIntegrations: IntegrationSetting[]) => {
    if (!remoteIntegrations.length) return
    setIntegrationIds((prev) => ({ ...prev, ...Object.fromEntries(remoteIntegrations.map((integration) => [integration.key, integration.id])) }))
    setIntegrationStatuses((prev) => ({ ...prev, ...Object.fromEntries(remoteIntegrations.map((integration) => [integration.key, integration.status])) }))
  }, [])

  const loadControlCenter = useCallback(async () => {
    if (currentUser.isDemo) {
      setSettingsPersisted(false)
      setSettingsError('')
      return
    }

    setSettingsLoading(true)
    setSettingsError('')
    try {
      const context = await getResolvedWorkspaceContext()
      const resolvedWorkspaceId = currentUser.workspaceId || context?.workspace?.id || context?.profile?.workspace_id
      if (!resolvedWorkspaceId) {
        setSettingsPersisted(false)
        setSettingsError('Conecta tu cuenta para acceder a la configuracion completa de integraciones.')
        return
      }

      setWorkspaceId(resolvedWorkspaceId)
      const [flows, remoteIntegrations, gcal, wa, inbox] = await Promise.all([
        getN8nFlows(resolvedWorkspaceId).catch(() => []),
        getIntegrationSettings(resolvedWorkspaceId).catch(() => []),
        getGoogleCalendarConnection(resolvedWorkspaceId).catch(() => null),
        getWhatsappConnection(resolvedWorkspaceId).catch(() => null),
        getInboxAgentSettings(resolvedWorkspaceId).catch(() => null),
      ])
      applyRemoteFlows(flows)
      applyRemoteIntegrations(remoteIntegrations)
      if (gcal) {
        setGcalConnection(gcal)
        setGcalCalendarId(String(gcal.calendar_id ?? ''))
        setGcalSyncEnabled(Boolean(gcal.sync_enabled))
      }
      if (wa) {
        setWaConnection(wa)
        setWaPhoneNumber(String(wa.phone_number ?? ''))
        setWaWebhookUrl(String(wa.webhook_url ?? ''))
      }
      if (inbox) {
        setInboxSettings(inbox)
        setInboxAutoReply(Boolean(inbox.auto_reply_enabled))
      }
      setSettingsPersisted(Boolean(flows.length || remoteIntegrations.length))
    } catch {
      setSettingsPersisted(false)
      setSettingsError('No se pudo sincronizar la configuracion. Comprueba la conexion e intentalo de nuevo.')
    } finally {
      setSettingsLoading(false)
    }
  }, [applyRemoteFlows, applyRemoteIntegrations, currentUser.isDemo, currentUser.workspaceId])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadControlCenter()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadControlCenter])

  const toggleNotif = (key: string) => {
    const next = !notifications[key]
    setNotifications((prev) => ({ ...prev, [key]: next }))
    const label = notifDefaults.find((n) => n.key === key)?.label ?? key
    toast.success(`Notificacion ${next ? 'activada' : 'desactivada'}`, { description: label })
  }

  const handleSimulateWA = async () => {
    setSimulatingWA(true)
    const result = await simulateWhatsAppIncomingLead()
    setSimulatingWA(false)
    if (result.success) {
      toast.success(`Lead simulado: ${result.lead.name}`, {
        description: `${result.lead.phone} · "${result.lead.message.slice(0, 60)}..."`,
      })
    }
  }

  const persistFlow = async (event: string, options?: { status?: N8nFlowStatus; notify?: boolean; webhookUrl?: string }) => {
    const config = flowConfigByEvent.get(event)
    if (!config) return null
    const nextStatus = options?.status ?? flowStatuses[event] ?? config.status
    const webhookUrl = options?.webhookUrl ?? composeFlowUrl(event)
    setFlowStatuses((prev) => ({ ...prev, [event]: nextStatus }))
    if (options?.webhookUrl) setFlowPaths((prev) => ({ ...prev, [event]: options.webhookUrl ?? '' }))

    if (currentUser.isDemo || !workspaceId) {
      if (options?.notify) toast.success('Flujo actualizado en demo', { description: config.label })
      return null
    }

    try {
      const saved = flowIds[event]
        ? await updateN8nFlow(flowIds[event], { event, status: nextStatus, webhookUrl, label: config.label, description: config.description, trigger: config.trigger, requires: config.requires })
        : await upsertN8nFlow(workspaceId, { event, status: nextStatus, webhookUrl, label: config.label, description: config.description, trigger: config.trigger, requires: config.requires })
      setFlowIds((prev) => ({ ...prev, [event]: saved.id }))
      setFlowStatuses((prev) => ({ ...prev, [event]: saved.status }))
      setSettingsPersisted(true)
      if (options?.notify) toast.success('Flujo guardado en Supabase', { description: config.label })
      return saved
    } catch {
      setFlowStatuses((prev) => ({ ...prev, [event]: 'error' }))
      toast.error('No se pudo guardar el flujo', { description: 'Revisa RLS o columnas de n8n_flows.' })
      return null
    }
  }

  const handleInitializeFlows = async () => {
    if (currentUser.isDemo || !workspaceId) {
      setFlowStatuses(Object.fromEntries(n8nWebhookConfigs.map((wh) => [wh.event, wh.status])))
      setFlowPaths(Object.fromEntries(n8nWebhookConfigs.map((wh) => [wh.event, defaultPath(wh)])))
      toast.success('Flujos demo inicializados')
      return
    }

    setSettingsLoading(true)
    try {
      const seeded = await seedN8nFlows(workspaceId, n8nWebhookConfigs.map((wh) => ({
        event: wh.event,
        label: wh.label,
        description: wh.description,
        trigger: wh.trigger,
        status: wh.status,
        webhookUrl: composeFlowUrl(wh.event),
        requires: wh.requires,
      })))
      applyRemoteFlows(seeded)
      await createActivity(workspaceId, { type: 'note', description: 'Flujos n8n inicializados desde Settings' })
      setSettingsPersisted(true)
      toast.success('Flujos n8n inicializados en Supabase', { description: `${seeded.length} flujos preparados.` })
    } catch {
      toast.error('No se pudieron inicializar los flujos', { description: 'Revisa la tabla n8n_flows y RLS.' })
    } finally {
      setSettingsLoading(false)
    }
  }

  const handleTestN8n = async () => {
    setTestingKey('global')
    const result = await triggerN8nWebhook('new_lead', {
      mode: workspaceId && !currentUser.isDemo ? 'real' : 'demo',
      workspace_id: workspaceId || undefined,
      webhook_url: `${n8nUrl.replace(/\/$/, '')}/webhook/test`,
      metadata: { source: 'settings', test: true },
    })
    if (workspaceId) await createActivity(workspaceId, { type: 'note', description: `Webhook n8n probado: ${result.status ?? 'simulated'}` })
    setTestingKey(null)
    toast.success(result.status === 'ok' ? 'Webhook enviado a n8n' : 'Webhook simulado', { description: result.message })
  }

  const handleActivateAssistantAgent = async () => {
    setFlowStatuses((prev) => ({ ...prev, assistant_message: 'active' }))
    setFlowPaths((prev) => ({ ...prev, assistant_message: ASSISTANT_AGENT_WEBHOOK_URL }))
    const saved = await persistFlow('assistant_message', {
      status: 'active',
      webhookUrl: ASSISTANT_AGENT_WEBHOOK_URL,
      notify: true,
    })
    if (workspaceId && saved) {
      await createActivity(workspaceId, { type: 'note', description: 'Assistant Agent activado con webhook real n8n/OpenAI.' })
    }
  }

  const handleTestAssistantAgent = async () => {
    setTestingKey('assistant-agent')
    const result = await triggerN8nWebhook('assistant_message', {
      mode: workspaceId && !currentUser.isDemo ? 'real' : 'demo',
      workspace_id: workspaceId || undefined,
      webhook_url: assistantAgentUrl || ASSISTANT_AGENT_WEBHOOK_URL,
      flow_status: flowStatuses.assistant_message,
      conversation: {
        id: 'test',
        client_name: 'Ana Rodriguez',
        channel: 'WhatsApp',
        sentiment: 'positive',
        intent: 'pricing',
      },
      message: {
        content: 'Hola, me interesa saber el precio del Plan Pro y que incluye exactamente.',
      },
      client: {
        name: 'Ana Rodriguez',
        status: 'lead',
      },
      metadata: {
        source: 'settings_test',
      },
    })
    if (workspaceId && result.status === 'ok') {
      await createActivity(workspaceId, {
        type: 'message',
        description: 'Respuesta IA generada con n8n. El Assistant recibio una respuesta desde el workflow NowCRM - Assistant Agent.',
        clientName: 'Ana Rodriguez',
      })
    }
    setTestingKey(null)
    if (result.status === 'ok') {
      toast.success('n8n respondió correctamente', { description: result.suggested_response ? 'suggested_response recibido desde Assistant Agent.' : result.message })
    } else {
      toast.error('No se pudo probar Assistant Agent', { description: result.message })
    }
  }

  const handleTestFlow = async (flow: WebhookConfig) => {
    if (flow.event === 'assistant_message') {
      await handleTestAssistantAgent()
      return
    }
    setTestingKey(flow.event)
    const result = await triggerN8nWebhook(flow.event, {
      mode: workspaceId && !currentUser.isDemo ? 'real' : 'demo',
      workspace_id: workspaceId || undefined,
      webhook_url: composeFlowUrl(flow.event),
      metadata: { source: 'settings_flow', label: flow.label, requirements: flow.requires },
    })
    if (workspaceId) await createActivity(workspaceId, { type: 'note', description: `Flujo n8n probado: ${flow.label}` })
    setTestingKey(null)
    toast.success(result.status === 'ok' ? 'Flujo enviado a n8n' : 'Flujo simulado', { description: result.message })
  }

  const toggleFlow = async (event: string) => {
    const current = flowStatuses[event]
    const next: N8nFlowStatus = current === 'active' || current === 'demo' ? 'inactive' : workspaceId && !currentUser.isDemo ? 'active' : 'demo'
    await persistFlow(event, { status: next, notify: true })
  }

  const updateFlowPath = (event: string, path: string) => {
    setFlowPaths((prev) => ({ ...prev, [event]: path }))
  }

  const copyToClipboard = (value: string, key: string) => {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
    toast.success('Copiado al portapapeles')
  }

  const buildExamplePayload = (flow: WebhookConfig) => JSON.stringify({
    event_type: flow.event,
    workspace_id: workspaceId || 'workspace-id',
    flow_id: flowIds[flow.event] || 'flow-id',
    source: 'nowcrm',
    mode: currentUser.isDemo ? 'demo' : 'real',
    timestamp: new Date().toISOString(),
    client: { id: 'client-id', name: 'Cliente Demo' },
    conversation: {},
    message: {},
    invoice: {},
    calendar_event: {},
    activity: {},
    metadata: { test: true, source: 'settings_payload_copy' },
  }, null, 2)

  const handleVerifySupabase = () => {
    toast.info(supabaseStatus.configured ? 'Supabase preparado' : 'Supabase pendiente', {
      description: supabaseStatus.configured
        ? 'Variables publicas detectadas. Auth, clients, billing, calendar y assistant ya tienen capa real.'
        : 'La UI esta preparada, pero faltan variables publicas en este entorno.',
    })
  }

  const handleIntegrationAction = async (integration: IntegrationCard) => {
    const currentStatus = integrationStatuses[integration.id]
    const nextStatus: IntegrationStatus = currentStatus === 'connected' ? 'pending' : 'connected'
    setIntegrationStatuses((prev) => ({ ...prev, [integration.id]: nextStatus }))

    if (!currentUser.isDemo && workspaceId) {
      try {
        const saved = integrationIds[integration.id]
          ? await updateIntegrationSetting(integrationIds[integration.id], { status: nextStatus, name: integration.name, description: integration.description, category: integration.category, info: integration.info })
          : await upsertIntegrationSetting(workspaceId, { key: integration.id, name: integration.name, description: integration.description, status: nextStatus, category: integration.category, info: integration.info })
        setIntegrationIds((prev) => ({ ...prev, [integration.id]: saved.id }))
        setSettingsPersisted(true)
      } catch {
        setIntegrationStatuses((prev) => ({ ...prev, [integration.id]: 'error' }))
        toast.error('No se pudo guardar la integracion', { description: 'Revisa integrations y RLS.' })
        return
      }
    }

    toast.success(nextStatus === 'connected' ? `${integration.name} conectado` : `${integration.name} pendiente`, {
      description: currentUser.isDemo ? 'Cambio aplicado en modo demo.' : 'Estado guardado para este workspace.',
    })
  }

  const handleGCalPrepare = async () => {
    setGcalLoading(true)
    try {
      if (!currentUser.isDemo && workspaceId) {
        const result = await upsertGoogleCalendarConnection(workspaceId, {
          calendarId: gcalCalendarId || 'primary',
          syncEnabled: gcalSyncEnabled,
          status: 'prepared',
        })
        if (result) {
          setGcalConnection(result)
          setGcalCalendarId(String(result.calendar_id ?? ''))
          setGcalSyncEnabled(Boolean(result.sync_enabled))
        }
      }
      toast.info('Google Calendar preparado', { description: 'La autorizacion OAuth completara la conexion en la siguiente fase.' })
    } catch {
      toast.error('No se pudo preparar Google Calendar', { description: 'Revisa la tabla google_calendar_connections y RLS.' })
    } finally {
      setGcalLoading(false)
    }
  }

  const handleGCalDisconnect = async () => {
    try {
      if (!currentUser.isDemo && workspaceId) {
        await disconnectGoogleCalendar(workspaceId)
      }
      setGcalConnection(null)
      setGcalCalendarId('')
      setGcalSyncEnabled(false)
      toast.success('Google Calendar desconectado')
    } catch {
      toast.error('No se pudo desconectar Google Calendar')
    }
  }

  const handleWAPrepare = async () => {
    setWaLoading(true)
    try {
      if (!currentUser.isDemo && workspaceId) {
        const result = await upsertWhatsappConnection(workspaceId, {
          phoneNumber: waPhoneNumber || undefined,
          webhookUrl: waWebhookUrl || null,
          status: 'verification_required',
          syncEnabled: false,
        })
        if (result) {
          setWaConnection(result)
          setWaPhoneNumber(String(result.phone_number ?? ''))
          setWaWebhookUrl(String(result.webhook_url ?? ''))
        }
      }
      toast.info('WhatsApp preparado', { description: 'El numero queda registrado. La verificacion y el QR se activaran en la siguiente fase.' })
    } catch {
      toast.error('No se pudo preparar WhatsApp', { description: 'Revisa la tabla whatsapp_connections y RLS.' })
    } finally {
      setWaLoading(false)
    }
  }

  const handleWADisconnect = async () => {
    try {
      if (!currentUser.isDemo && workspaceId) {
        await disconnectWhatsapp(workspaceId)
      }
      setWaConnection(null)
      setWaPhoneNumber('')
      setWaWebhookUrl('')
      toast.success('WhatsApp desconectado')
    } catch {
      toast.error('No se pudo desconectar WhatsApp')
    }
  }

  const handleInboxSettingsSave = async () => {
    try {
      if (!currentUser.isDemo && workspaceId) {
        const result = await upsertInboxAgentSettings(workspaceId, {
          autoReplyEnabled: inboxAutoReply,
          mode: inboxAutoReply ? 'auto' : 'manual',
        })
        if (result) setInboxSettings(result)
      }
      toast.success('Configuracion Inbox guardada', { description: inboxAutoReply ? 'Modo automatico activo (requiere WhatsApp conectado).' : 'Modo manual activo.' })
    } catch {
      toast.error('No se pudo guardar configuracion Inbox')
    }
  }

  const settingsMode = currentUser.isDemo ? 'Modo demo' : settingsPersisted ? 'Persistente' : 'Fallback demo'

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Configuracion"
        description="Control center para Supabase, n8n, canales y siguiente fase real"
        action={<Badge variant={currentUser.isDemo ? 'indigo' : settingsPersisted ? 'success' : 'warning'} dot>{settingsMode}</Badge>}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {architectureCards.map((card) => (
          <div key={card.title} className={cn('rounded-xl border p-4 shadow-sm shadow-gray-950/[0.035] transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-950/[0.04]', card.tone)}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/85 shadow-sm ring-1 ring-black/[0.04]">{card.icon}</div>
              <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-semibold text-gray-600">{card.detail}</span>
            </div>
            <p className="text-sm font-bold">{card.title}</p>
            <p className="mt-0.5 text-xs opacity-80">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {productStatusCards.map((card) => (
          <div key={card.label} className={cn('rounded-xl border px-4 py-3 shadow-sm shadow-gray-950/[0.025]', card.tone)}>
            <p className="text-xs font-medium opacity-80">{card.label}</p>
            <p className="mt-1 text-lg font-bold">{card.value}</p>
            <p className="mt-0.5 text-[11px] leading-5 opacity-80">{card.detail}</p>
          </div>
        ))}
      </div>

      {settingsError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {settingsError}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <SectionCard title="Workspace" description="Identidad y estado del entorno NowCRM">
            <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-xl font-bold text-white shadow-sm shadow-indigo-600/20">
                  {currentUser.initials}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{currentUser.workspaceName}</p>
                  <p className="text-xs text-gray-500">{currentUser.email}</p>
                </div>
              </div>
              <Badge variant={currentUser.isDemo ? 'indigo' : 'success'}>{currentUser.trialLabel}</Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {visibleWorkspaceItems.map(({ label, value, icon }) => (
                <div key={label} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-gray-400">{icon}</span>
                    <div>
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className="text-sm font-medium text-gray-900">{value}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Supabase"
            description="Base de datos, autenticacion y persistencia por workspace"
            action={
              <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
                Supabase Console
                <ExternalLink className="h-3 w-3" />
              </a>
            }
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
              <div className={cn('rounded-xl border px-4 py-3', supabaseStatus.configured ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50')}>
                <div className="flex items-start gap-3">
                  <Database className={cn('mt-0.5 h-4 w-4 shrink-0', supabaseStatus.configured ? 'text-emerald-600' : 'text-amber-500')} />
                  <div>
                    <p className={cn('text-xs font-semibold', supabaseStatus.configured ? 'text-emerald-900' : 'text-amber-900')}>
                      {supabaseStatus.configured ? 'Variables detectadas' : 'Variables pendientes en este entorno'}
                    </p>
                    <p className={cn('mt-0.5 text-[11px] leading-5', supabaseStatus.configured ? 'text-emerald-700' : 'text-amber-700')}>
                      {supabaseStatus.note} No se muestran URLs ni claves en pantalla.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-xs font-semibold text-gray-700">Estado tecnico</p>
                <p className="mt-1 text-lg font-bold text-gray-950">{supabaseStatus.configured ? 'Conectado' : 'Preparado visualmente'}</p>
                <p className="text-[11px] text-gray-500">Auth, clients, billing, calendar y assistant ya tienen capa real.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {envChecks.map(({ key, label, ready }) => (
                <div key={key} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-semibold text-gray-500">{label}</span>
                    <Badge variant={ready ? 'success' : 'warning'} dot className="text-[10px]">{ready ? 'Detectada' : 'Pendiente'}</Badge>
                  </div>
                  <p className="truncate font-mono text-[11px] text-gray-700">{key}</p>
                  <p className="mt-0.5 text-[10px] text-gray-400">Valor oculto por seguridad</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {supabaseReadiness.map((item) => (
                <div key={item.label} className="rounded-xl border border-gray-100 bg-white p-3">
                  <p className="text-[11px] font-semibold text-gray-900">{item.label}</p>
                  <p className="mt-1 font-mono text-[10px] text-indigo-600">{item.value}</p>
                  <p className="mt-1 text-[10px] text-gray-500">{item.status}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => toast.info('Checklist Supabase', { description: 'Verifica schema, RLS, tipos generados y URLs de Auth antes del deploy.' })}>
                Ver checklist
              </Button>
              <Button size="sm" onClick={handleVerifySupabase}>
                Verificar conexion
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            title="n8n / Flujos operativos"
            description="Endpoints, estados y requisitos para automatizaciones reales"
            action={
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" loading={settingsLoading} onClick={handleInitializeFlows}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Inicializar flujos
                </Button>
                <a href="https://n8n.io" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
                  Abrir n8n
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            }
          >
            <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_220px]">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">URL base de tu instancia n8n</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={n8nUrl}
                    onChange={(e) => setN8nUrl(e.target.value)}
                    className="h-9 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <Button size="sm" variant="secondary" loading={testingKey === 'global'} onClick={handleTestN8n}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Probar
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                <p className="text-xs font-semibold text-indigo-900">Modo n8n</p>
                <p className="mt-1 text-lg font-bold text-indigo-700">{settingsPersisted ? 'Persistente' : 'Simulado'}</p>
                <p className="text-[11px] text-indigo-700">Si la URL sigue en tudominio.com, el trigger se simula.</p>
              </div>
            </div>

            {settingsLoading && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                Sincronizando control center...
              </div>
            )}

            <div className="mb-3 rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-indigo-50 p-4 shadow-sm shadow-emerald-950/[0.035]">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-gray-950">NowCRM - Assistant Agent</p>
                    <Badge variant={assistantAgentActive ? 'success' : 'warning'} dot>{assistantAgentActive ? 'n8n/OpenAI activo' : 'Pendiente de activar'}</Badge>
                  </div>
                  <p className="text-xs leading-5 text-gray-600">
                    Primer workflow real conectado. Recibe `assistant_message`, llama OpenAI dentro de n8n y devuelve `suggested_response` para guardar la respuesta en el chat.
                  </p>
                  <p className="mt-2 truncate rounded-lg bg-white/80 px-2.5 py-1.5 font-mono text-[10px] text-emerald-700 ring-1 ring-emerald-100">
                    {assistantAgentUrl || ASSISTANT_AGENT_WEBHOOK_URL}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void handleActivateAssistantAgent()}>
                    <CheckCircle className="h-3.5 w-3.5" />
                    Activar Agent
                  </Button>
                  <Button size="sm" loading={testingKey === 'assistant-agent'} onClick={() => void handleTestAssistantAgent()}>
                    <Play className="h-3.5 w-3.5" />
                    Probar Assistant Agent
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              {n8nWebhookConfigs.map((wh) => {
                const currentStatus = flowStatuses[wh.event] ?? wh.status
                const cfg = flowStatusConfig[currentStatus]
                const fullUrl = composeFlowUrl(wh.event)
                return (
                  <div key={wh.event} className="rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white p-3 shadow-sm shadow-gray-950/[0.02]">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                      <div className="min-w-0">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900">{wh.label}</p>
                          <Badge variant={cfg.variant} dot className="text-[10px]">{cfg.label}</Badge>
                        </div>
                        <p className="text-[11px] leading-5 text-gray-500">{wh.description}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">Trigger: {wh.trigger}</span>
                          {wh.requires.map((req) => (
                            <span key={req} className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-700 ring-1 ring-indigo-100">{req}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          onClick={() => void toggleFlow(wh.event)}
                          className={cn(
                            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                            currentStatus === 'active' || currentStatus === 'demo' ? 'bg-indigo-600' : 'bg-gray-200'
                          )}
                        >
                          <span className={cn('pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform', currentStatus === 'active' || currentStatus === 'demo' ? 'translate-x-4' : 'translate-x-0')} />
                        </button>
                        <Button variant="ghost" size="sm" loading={testingKey === wh.event} onClick={() => void handleTestFlow(wh)}>
                          <Play className="h-3.5 w-3.5" />
                          Probar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => copyToClipboard(buildExamplePayload(wh), `${wh.event}-payload`)}>
                          {copiedKey === `${wh.event}-payload` ? <CheckCircle className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          Payload
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => void persistFlow(wh.event, { notify: true })}>
                          Guardar
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 lg:grid-cols-[220px_minmax(0,1fr)_70px]">
                      <input
                        value={flowPaths[wh.event] ?? ''}
                        onChange={(e) => updateFlowPath(wh.event, e.target.value)}
                        onBlur={() => void persistFlow(wh.event)}
                        className="h-8 rounded-lg border border-gray-200 bg-white px-2.5 font-mono text-[11px] text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <div className="flex min-w-0 items-center rounded-lg bg-white px-2.5 ring-1 ring-gray-100">
                        <p className="truncate font-mono text-[10px] text-gray-400">{fullUrl}</p>
                      </div>
                      <button
                        onClick={() => copyToClipboard(fullUrl, wh.event)}
                        className="flex h-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                      >
                        {copiedKey === wh.event ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </SectionCard>

          <SectionCard
            title="Google Calendar"
            description="Autorizar cuenta Google para sincronizar eventos con NowCRM"
            action={
              gcalConnection && String(gcalConnection.status ?? '') !== 'disconnected'
                ? <button onClick={() => void handleGCalDisconnect()} className="text-xs font-medium text-red-500 hover:text-red-600">Desconectar</button>
                : null
            }
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
              <div>
                <div className="mb-4 flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 ring-1 ring-blue-100">
                    <Calendar className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">Google Calendar OAuth</p>
                      {(() => {
                        const s = gcalConnection ? String(gcalConnection.status ?? '') : null
                        if (s === 'connected') return <Badge variant="success" dot>Conectado</Badge>
                        if (s === 'prepared') return <Badge variant="indigo" dot>Preparado · pendiente OAuth</Badge>
                        return <Badge variant="default" dot>No configurado</Badge>
                      })()}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {gcalConnection
                        ? `Calendario: ${String(gcalConnection.calendar_id ?? 'primary')} · ultima sync: ${String(gcalConnection.last_sync_at ?? '') || 'nunca'}`
                        : 'Autoriza tu cuenta Google para sincronizar el calendario principal.'}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-gray-600">
                      En la siguiente fase, el usuario autorizara su cuenta Google y NowCRM sincronizara eventos con su calendario principal mediante OAuth seguro.
                    </p>
                  </div>
                </div>
                <div className="mb-4 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">
                      Calendar ID <span className="text-gray-400 font-normal">(avanzado — por defecto usa el principal)</span>
                    </label>
                    <input
                      type="text"
                      value={gcalCalendarId}
                      onChange={(e) => setGcalCalendarId(e.target.value)}
                      placeholder="primary"
                      className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Sincronizacion activa</p>
                      <p className="text-xs text-gray-500">Se activara cuando OAuth este completado</p>
                    </div>
                    <button
                      onClick={() => setGcalSyncEnabled((v) => !v)}
                      className={cn(
                        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                        gcalSyncEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                      )}
                    >
                      <span className={cn('pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform', gcalSyncEnabled ? 'translate-x-4' : 'translate-x-0')} />
                    </button>
                  </div>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button size="sm" loading={gcalLoading} onClick={() => void handleGCalPrepare()}>
                    Preparar OAuth
                  </Button>
                  <Button size="sm" variant="secondary" disabled>
                    Conectar con Google
                  </Button>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                  <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                  <p className="text-[11px] leading-5 text-blue-700">
                    La autorizacion OAuth se realizara mediante conexion segura. No se guardan tokens en el navegador. Google Calendar requiere autorizacion OAuth.
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-semibold text-blue-900">Flujo de conexion</p>
                <div className="mt-3 space-y-2">
                  {[
                    'Autorizar cuenta Google',
                    'Elegir calendario',
                    'Activar sincronizacion',
                    'Confirmar evento de prueba',
                  ].map((step, i) => (
                    <div key={step} className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-blue-700">{i + 1}</span>
                      <span className="text-xs text-blue-800">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Inbox Assistant"
            description="Modo de respuesta del agente en conversaciones cliente"
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
              <div>
                <div className="mb-4 flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 ring-1 ring-violet-100">
                    <MessageSquare className="h-5 w-5 text-violet-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">Inbox Agent</p>
                      <Badge variant={inboxSettings && inboxAutoReply ? 'indigo' : 'default'} dot>
                        {inboxSettings ? (inboxAutoReply ? 'Modo auto' : 'Modo manual') : 'Sin configurar'}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {inboxSettings ? `Configurado — modo ${inboxAutoReply ? 'automatico' : 'manual'}` : 'Usando valores por defecto (manual)'}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-gray-600">
                      En modo automatico el agente responde directamente (requiere WhatsApp conectado). En modo manual el agente sugiere y el operador confirma.
                    </p>
                  </div>
                </div>
                <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Respuesta automatica</p>
                    <p className="text-xs text-gray-500">Requiere WhatsApp/Whapi conectado</p>
                  </div>
                  <button
                    onClick={() => setInboxAutoReply((v) => !v)}
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                      inboxAutoReply ? 'bg-indigo-600' : 'bg-gray-200'
                    )}
                  >
                    <span className={cn('pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform', inboxAutoReply ? 'translate-x-4' : 'translate-x-0')} />
                  </button>
                </div>
                {inboxAutoReply && String(waConnection?.status ?? '') !== 'connected' && (
                  <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <p className="text-xs leading-5 text-amber-800">
                      {!waConnection || String(waConnection.status ?? '') === 'disconnected'
                        ? 'El modo automatico requiere WhatsApp conectado. Registra el numero en la seccion de abajo.'
                        : 'La respuesta automatica se activara cuando WhatsApp este verificado y conectado.'}
                    </p>
                  </div>
                )}
                <Button size="sm" onClick={() => void handleInboxSettingsSave()}>
                  Guardar configuracion
                </Button>
              </div>
              <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
                <p className="text-xs font-semibold text-violet-900">Modos disponibles</p>
                <div className="mt-3 space-y-3">
                  {[
                    { label: 'Manual', desc: 'El agente sugiere, operador confirma', active: !inboxAutoReply },
                    { label: 'Automatico', desc: 'El agente responde directamente', active: inboxAutoReply },
                  ].map((m) => (
                    <div key={m.label} className={cn('rounded-lg p-2', m.active ? 'bg-white ring-1 ring-violet-200' : '')}>
                      <p className={cn('text-xs font-semibold', m.active ? 'text-violet-900' : 'text-violet-700')}>{m.label}</p>
                      <p className="text-[10px] text-violet-600">{m.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="WhatsApp / Whapi"
            description="Conectar numero verificado para recibir leads entrantes y activar Inbox Assistant"
            action={
              waConnection && String(waConnection.status ?? '') !== 'disconnected'
                ? <button onClick={() => void handleWADisconnect()} className="text-xs font-medium text-red-500 hover:text-red-600">Desconectar</button>
                : null
            }
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div>
                <div className="mb-4 flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
                    <MessageSquare className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">WhatsApp via Whapi</p>
                      {(() => {
                        const s = waConnection ? String(waConnection.status ?? '') : null
                        if (s === 'connected') return <Badge variant="success" dot>Conectado y verificado</Badge>
                        if (s === 'verification_required') return <Badge variant="warning" dot>Pendiente de verificacion</Badge>
                        if (s === 'prepared') return <Badge variant="indigo" dot>Preparado · pendiente QR</Badge>
                        return <Badge variant="default" dot>No configurado</Badge>
                      })()}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {waConnection
                        ? `${String(waConnection.provider ?? 'whapi')}${waConnection.phone_number ? ` · ${String(waConnection.phone_number)}` : ''}`
                        : 'Registra el numero para iniciar el proceso de verificacion con Whapi.'}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-gray-600">
                      Registra el numero de telefono para preparar la conexion. La verificacion real y el escaneo del QR se realizaran en la siguiente fase mediante Whapi o Meta Business.
                    </p>
                  </div>
                </div>
                <div className="mb-4 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Numero de telefono</label>
                    <input
                      type="text"
                      value={waPhoneNumber}
                      onChange={(e) => setWaPhoneNumber(e.target.value)}
                      placeholder="+34 600 000 000"
                      className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">
                      URL de entrada n8n/Whapi <span className="text-gray-400 font-normal">(avanzado — se configura desde n8n)</span>
                    </label>
                    <input
                      type="text"
                      value={waWebhookUrl}
                      onChange={(e) => setWaWebhookUrl(e.target.value)}
                      placeholder="Se configurara desde n8n en la siguiente fase"
                      className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button size="sm" loading={waLoading} onClick={() => void handleWAPrepare()}>
                    Preparar WhatsApp
                  </Button>
                  <Button size="sm" variant="secondary" disabled title="Disponible cuando Whapi este configurado">
                    Conectar por QR
                  </Button>
                  <Button size="sm" variant="secondary" loading={simulatingWA} onClick={handleSimulateWA}>
                    <Play className="h-3.5 w-3.5" />
                    {simulatingWA ? 'Simulando...' : 'Simular lead'}
                  </Button>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                  <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <p className="text-[11px] leading-5 text-emerald-700">
                    El numero de WhatsApp requiere verificacion antes de activar respuestas automaticas. No pegues claves API en este panel. Los tokens se configuran en n8n.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <p className="text-xs font-semibold text-emerald-900">Flujo de conexion</p>
                <div className="mt-3 space-y-2">
                  {[
                    'Conectar proveedor Whapi/Meta',
                    'Verificar numero',
                    'Activar webhook desde n8n',
                    'Probar mensaje entrante',
                    'Activar Inbox Assistant',
                  ].map((step, index) => (
                    <div key={step} className="flex items-start gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-emerald-700">{index + 1}</span>
                      <span className="text-xs leading-5 text-emerald-800">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Integraciones externas" description="Canales y servicios conectados, demo o pendientes">
            <div className="grid gap-3 md:grid-cols-2">
              {integrations.map((intg) => {
                const currentStatus = integrationStatuses[intg.id]
                return (
                  <div
                    key={intg.id}
                    className={cn(
                      'rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-950/[0.04]',
                      currentStatus === 'connected' ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'
                    )}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-xl',
                          currentStatus === 'connected' ? 'bg-white text-gray-700 shadow-sm ring-1 ring-gray-200' : 'bg-gray-100 text-gray-400'
                        )}>
                          {intg.icon}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{intg.name}</p>
                          <p className="text-[10px] text-gray-400">{intg.category}</p>
                        </div>
                      </div>
                      {statusBadge(currentStatus)}
                    </div>
                    <p className="min-h-10 text-xs leading-5 text-gray-500">{intg.description}</p>
                    {intg.info && currentStatus !== 'disconnected' && (
                      <p className="mt-2 truncate rounded-lg bg-white px-2 py-1.5 font-mono text-[10px] text-indigo-600">{intg.info}</p>
                    )}
                    <button
                      onClick={() => void handleIntegrationAction(intg)}
                      className={cn(
                        'mt-3 flex w-full items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                        currentStatus === 'connected'
                          ? 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                          : currentStatus === 'pending'
                            ? 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      )}
                    >
                      {currentStatus === 'connected' ? 'Pasar a pendiente' : currentStatus === 'pending' ? 'Marcar conectado' : 'Conectar'}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </SectionCard>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-0 xl:self-start">
          <SectionCard title="Estado del sistema" description="Resumen de servicios conectados y proximas integraciones">
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                  <Wifi className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-900">Sistema operativo</p>
                  <p className="mt-1 text-xs leading-5 text-blue-700">
                    Auth, CRM y Assistant activos. Conecta Google Calendar y WhatsApp para activar automatizaciones.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {[
                { icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />, label: 'Auth y core CRM activos' },
                { icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />, label: 'Assistant n8n/OpenAI activo' },
                { icon: <AlertCircle className="h-3.5 w-3.5 text-amber-500" />, label: 'Google Calendar pendiente' },
                { icon: <AlertCircle className="h-3.5 w-3.5 text-amber-500" />, label: 'WhatsApp/Stripe/Resend pendientes' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  {item.icon}
                  <span className="text-xs font-medium text-gray-700">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Button size="sm" onClick={() => toast.success('Proximas integraciones', { description: 'Conectar Google Calendar, WhatsApp, Resend y n8n real.' })}>
                Ver proximas integraciones
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Notificaciones" description="Alertas del workspace">
            <div className="space-y-3">
              {notifDefaults.map(({ key, label, description }) => (
                <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    <p className="mt-0.5 text-xs leading-5 text-gray-500">{description}</p>
                  </div>
                  <button
                    onClick={() => toggleNotif(key)}
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                      notifications[key] ? 'bg-indigo-600' : 'bg-gray-200'
                    )}
                  >
                    <span className={cn('pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform', notifications[key] ? 'translate-x-4' : 'translate-x-0')} />
                  </button>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Checklist produccion" description="Lo que falta antes de venderlo en real">
            <div className="space-y-2">
              {[
                { title: '1. Dominio + Resend', desc: 'Activar email confirmation y remitente propio.' },
                { title: '2. IA real', desc: 'Conectar API server con contexto Supabase.' },
                { title: '3. n8n real', desc: 'Guardar endpoints y disparar workflows.' },
                { title: '4. Deploy', desc: 'Vercel o Hostinger con variables seguras.' },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-900">{item.title}</p>
                  <p className="mt-1 text-[11px] leading-5 text-gray-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </aside>
      </div>
    </motion.div>
  )
}
