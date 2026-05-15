'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Play, Pause, Zap, Mail, Clock, CheckCircle, XCircle, ArrowRight, BarChart2, ExternalLink, Copy, RefreshCw, AlertTriangle, MessageSquare, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { automations, automationEmails } from '@/lib/mock-data'
import { n8nWebhookConfigs, triggerN8nWebhook, type N8nEventType } from '@/lib/integrations'
import { cn } from '@/lib/utils'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { createActivity, getAutomationWorkflows, getN8nFlows, getWorkspaceContext, toggleAutomationWorkflow, updateN8nFlow, upsertAutomationWorkflow } from '@/lib/supabase-queries'
import type { AutomationStatus, AutomationEmailStatus, N8nFlowStatus } from '@/lib/types'

const statusConfig: Record<AutomationStatus, { label: string; variant: 'success' | 'warning' | 'default' }> = {
  active: { label: 'Activa', variant: 'success' },
  paused: { label: 'Pausada', variant: 'warning' },
  draft: { label: 'Borrador', variant: 'default' },
}

const flowStatusConfig: Record<N8nFlowStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'indigo' | 'default' }> = {
  active: { label: 'Control NowCRM activo', variant: 'success' },
  demo: { label: 'Preparado demo', variant: 'indigo' },
  pending_config: { label: 'n8n pendiente', variant: 'warning' },
  inactive: { label: 'Inactivo', variant: 'default' },
  error: { label: 'Error', variant: 'danger' },
}

const emailStatusConfig: Record<AutomationEmailStatus, { label: string; variant: 'success' | 'info' | 'indigo' | 'danger'; icon: React.ReactNode }> = {
  delivered: { label: 'Entregado', variant: 'info', icon: <Mail className="h-3 w-3" /> },
  opened: { label: 'Abierto', variant: 'success', icon: <CheckCircle className="h-3 w-3" /> },
  clicked: { label: 'Clic', variant: 'indigo', icon: <ArrowRight className="h-3 w-3" /> },
  bounced: { label: 'Rebotado', variant: 'danger', icon: <XCircle className="h-3 w-3" /> },
}

type IntegrationTag = 'whatsapp_business' | 'google_calendar' | 'email' | 'n8n' | 'openai'

const integrationLabel: Record<IntegrationTag, { label: string; icon: React.ReactNode; pending?: boolean }> = {
  whatsapp_business: { label: 'WhatsApp Business', icon: <MessageSquare className="h-2.5 w-2.5" />, pending: true },
  google_calendar: { label: 'Google Calendar', icon: <Calendar className="h-2.5 w-2.5" />, pending: true },
  email: { label: 'Email', icon: <Mail className="h-2.5 w-2.5" /> },
  n8n: { label: 'n8n', icon: <Zap className="h-2.5 w-2.5" /> },
  openai: { label: 'OpenAI', icon: <Zap className="h-2.5 w-2.5" /> },
}

const n8nPendingReason = 'Requiere endpoint n8n real y credenciales server-side'
const metaPendingReason = 'Requiere WhatsApp Business Platform oficial (Meta Cloud API)'
const calendarPendingReason = 'Requiere OAuth real de Google Calendar'
const openAiPendingReason = 'Requiere OpenAI server-side configurado'

const automationCatalog: Record<string, { requiredIntegrations: IntegrationTag[]; canActivateNow: boolean; reasonIfUnavailable?: string; n8nWorkflowSlug?: string }> = {
  '1': { requiredIntegrations: ['email', 'n8n'], canActivateNow: false, reasonIfUnavailable: n8nPendingReason, n8nWorkflowSlug: 'new-lead' },
  '2': { requiredIntegrations: ['email', 'n8n'], canActivateNow: false, reasonIfUnavailable: n8nPendingReason, n8nWorkflowSlug: 'invoice-overdue' },
  '3': { requiredIntegrations: ['email', 'n8n'], canActivateNow: false, reasonIfUnavailable: n8nPendingReason, n8nWorkflowSlug: 'reengagement-needed' },
  '4': { requiredIntegrations: ['whatsapp_business', 'google_calendar', 'n8n'], canActivateNow: false, reasonIfUnavailable: `${metaPendingReason} + ${calendarPendingReason}`, n8nWorkflowSlug: 'appointment-booked' },
  '5': { requiredIntegrations: ['whatsapp_business', 'n8n'], canActivateNow: false, reasonIfUnavailable: metaPendingReason, n8nWorkflowSlug: 'new-lead' },
  '6': { requiredIntegrations: ['n8n'], canActivateNow: false, reasonIfUnavailable: n8nPendingReason, n8nWorkflowSlug: 'daily-summary' },
  '7': { requiredIntegrations: ['n8n', 'openai'], canActivateNow: false, reasonIfUnavailable: `${n8nPendingReason} + ${openAiPendingReason}`, n8nWorkflowSlug: 'urgent-conversation' },
  '8': { requiredIntegrations: ['whatsapp_business', 'n8n'], canActivateNow: false, reasonIfUnavailable: metaPendingReason, n8nWorkflowSlug: 'invoice-paid' },
  '9': { requiredIntegrations: ['email', 'whatsapp_business', 'n8n'], canActivateNow: false, reasonIfUnavailable: metaPendingReason, n8nWorkflowSlug: 'client-updated' },
  '10': { requiredIntegrations: ['n8n', 'openai'], canActivateNow: false, reasonIfUnavailable: `${n8nPendingReason} + ${openAiPendingReason}`, n8nWorkflowSlug: 'daily-summary' },
}

const automationFlowMap: Record<string, N8nEventType> = {
  '1': 'new_lead',
  '2': 'invoice_overdue',
  '3': 'reengagement_needed',
  '4': 'appointment_booked',
  '5': 'new_lead',
  '6': 'daily_summary',
  '7': 'urgent_conversation',
  '8': 'invoice_paid',
  '9': 'client_updated',
  '10': 'daily_summary',
}

const emailFlowSteps = [
  { type: 'trigger', label: 'Trigger', description: 'Nuevo lead', icon: <Zap className="h-4 w-4" />, color: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20' },
  { type: 'email', label: 'Email 1', description: 'Bienvenida', icon: <Mail className="h-4 w-4" />, color: 'bg-blue-50 border border-blue-200 text-blue-700' },
  { type: 'wait', label: 'Espera', description: '2 dias', icon: <Clock className="h-4 w-4" />, color: 'bg-gray-100 border border-gray-200 text-gray-600' },
  { type: 'email', label: 'Email 2', description: 'Recursos', icon: <Mail className="h-4 w-4" />, color: 'bg-blue-50 border border-blue-200 text-blue-700' },
  { type: 'wait', label: 'Espera', description: '3 dias', icon: <Clock className="h-4 w-4" />, color: 'bg-gray-100 border border-gray-200 text-gray-600' },
  { type: 'email', label: 'Email 3', description: 'Oferta', icon: <Mail className="h-4 w-4" />, color: 'bg-blue-50 border border-blue-200 text-blue-700' },
  { type: 'end', label: 'Fin', description: 'Convertido', icon: <CheckCircle className="h-4 w-4" />, color: 'bg-emerald-500 text-white shadow-sm shadow-emerald-600/20' },
]

function defaultFlowUrl(event: N8nEventType) {
  return n8nWebhookConfigs.find((flow) => flow.event === event)?.url ?? `https://n8n.tudominio.com/webhook/${event}`
}

export default function AutomationsPage() {
  const [activeStatuses, setActiveStatuses] = useState<Record<string, AutomationStatus>>(
    Object.fromEntries(automations.map((a) => [a.id, automationCatalog[a.id]?.canActivateNow ? a.status : 'draft']))
  )
  const [flowStatuses, setFlowStatuses] = useState<Record<string, N8nFlowStatus>>(
    Object.fromEntries(n8nWebhookConfigs.map((flow) => [flow.event, flow.status]))
  )
  const [flowIds, setFlowIds] = useState<Record<string, string>>({})
  const [flowUrls, setFlowUrls] = useState<Record<string, string>>(
    Object.fromEntries(n8nWebhookConfigs.map((flow) => [flow.event, flow.url]))
  )
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isRealMode, setIsRealMode] = useState(false)
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const [workflowIds, setWorkflowIds] = useState<Record<string, string>>({})
  const [workflowSeeded, setWorkflowSeeded] = useState(false)

  const linkedFlows = useMemo(() => n8nWebhookConfigs.filter((flow) => ['new_lead', 'invoice_overdue', 'reengagement_needed', 'assistant_message', 'test_flow'].includes(flow.event)), [])

  const loadFlows = useCallback(async () => {
    if (window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      setIsRealMode(false)
      return
    }

    try {
      const context = await getWorkspaceContext()
      const resolvedWorkspaceId = context?.workspace?.id || context?.profile?.workspace_id
      if (!resolvedWorkspaceId) return
      setWorkspaceId(resolvedWorkspaceId)
      setIsRealMode(true)
      const [flows, workflows] = await Promise.all([
        getN8nFlows(resolvedWorkspaceId).catch(() => []),
        getAutomationWorkflows(resolvedWorkspaceId).catch(() => []),
      ])
      if (flows.length) {
        setFlowIds((prev) => ({ ...prev, ...Object.fromEntries(flows.map((flow) => [flow.event, flow.id])) }))
        setFlowStatuses((prev) => ({ ...prev, ...Object.fromEntries(flows.map((flow) => [flow.event, flow.status])) }))
        setFlowUrls((prev) => ({ ...prev, ...Object.fromEntries(flows.map((flow) => [flow.event, flow.webhookUrl || defaultFlowUrl(flow.event as N8nEventType)])) }))
      }
      if (workflows.length) {
        const ids: Record<string, string> = {}
        const statuses: Record<string, AutomationStatus> = {}
        for (const wf of workflows) {
          const automation = automations.find((a) => a.name === String(wf.name ?? ''))
          if (automation) {
            const catalog = automationCatalog[automation.id]
            ids[automation.id] = String(wf.id ?? '')
            statuses[automation.id] = catalog?.canActivateNow && Boolean(wf.enabled_in_app) ? 'active' : 'draft'
          }
        }
        setWorkflowIds((prev) => ({ ...prev, ...ids }))
        setActiveStatuses((prev) => ({ ...prev, ...statuses }))
        setWorkflowSeeded(true)
      } else if (resolvedWorkspaceId) {
        for (const automation of automations) {
          const event = automationFlowMap[automation.id]
          const catalog = automationCatalog[automation.id]
          const result = await upsertAutomationWorkflow(resolvedWorkspaceId, {
            name: automation.name,
            description: automation.description,
            trigger: automation.trigger,
            enabledInApp: Boolean(catalog?.canActivateNow && automation.status === 'active'),
            n8nEvent: event ?? undefined,
            status: catalog?.canActivateNow && automation.status === 'active' ? 'active' : 'inactive',
          }).catch(() => null)
          if (result && typeof result === 'object' && 'id' in result) {
            setWorkflowIds((prev) => ({ ...prev, [automation.id]: String(result.id ?? '') }))
          }
        }
        setWorkflowSeeded(true)
      }
    } catch {
      setIsRealMode(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadFlows()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadFlows])

  const toggle = async (id: string) => {
    const catalog = automationCatalog[id]
    if (!catalog?.canActivateNow) {
      toast.info('Automatizacion pendiente', {
        description: catalog?.reasonIfUnavailable ?? 'Configura las integraciones necesarias antes de activarla.',
      })
      return
    }
    const event = automationFlowMap[id]
    const isCurrentlyActive = activeStatuses[id] === 'active'
    const nextAppStatus: AutomationStatus = isCurrentlyActive ? 'paused' : 'active'
    setActiveStatuses((prev) => ({ ...prev, [id]: nextAppStatus }))
    toast.success(
      nextAppStatus === 'active' ? 'Control NowCRM activo. n8n pendiente de conexion segura.' : 'Desactivada en NowCRM.',
      { description: automations.find((a) => a.id === id)?.name }
    )

    const workflowId = workflowIds[id]
    if (isRealMode && workspaceId && workflowId) {
      await toggleAutomationWorkflow(workspaceId, workflowId, nextAppStatus === 'active').catch(() => null)
    }

    if (event) {
      const nextFlowStatus: N8nFlowStatus = isCurrentlyActive ? 'inactive' : 'pending_config'
      setFlowStatuses((prev) => ({ ...prev, [event]: nextFlowStatus }))
      if (isRealMode && flowIds[event]) {
        await updateN8nFlow(flowIds[event], { event, status: nextFlowStatus }).catch(() => null)
      }
      if (workspaceId) await createActivity(workspaceId, { type: 'note', description: `Automation ${event} ${nextFlowStatus}` })
    }
  }

  const handleRunNow = async (automation: typeof automations[0]) => {
    const event = automationFlowMap[automation.id] ?? 'test_flow'
    setRunningAction(automation.id)
    const result = await triggerN8nWebhook(event, {
      workspace_id: workspaceId || undefined,
      webhook_url: flowUrls[event],
      flow_status: flowStatuses[event],
      mode: isRealMode ? 'real' : 'demo',
      metadata: { source: 'automations', automation_id: automation.id, automation_name: automation.name },
    })
    if (workspaceId) await createActivity(workspaceId, { type: 'note', description: `Automation n8n test ${result.status}: ${automation.name}` })
    setRunningAction(null)
    toast.success(result.status === 'ok' ? `Flujo enviado: ${automation.name}` : `Flujo simulado: ${automation.name}`, { description: result.message })
  }

  const handleRunFlow = async (event: N8nEventType) => {
    setRunningAction(event)
    const result = await triggerN8nWebhook(event, {
      workspace_id: workspaceId || undefined,
      webhook_url: flowUrls[event],
      flow_status: flowStatuses[event],
      mode: isRealMode ? 'real' : 'demo',
      metadata: { source: 'automations_flow_card' },
    })
    if (workspaceId) await createActivity(workspaceId, { type: 'note', description: `Flow ${event} tested: ${result.status}` })
    setRunningAction(null)
    toast.success(result.status === 'ok' ? 'Flujo enviado a n8n' : 'Flujo simulado', { description: result.message })
  }

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url).catch(() => {})
    setCopiedUrl(url)
    setTimeout(() => setCopiedUrl(null), 1500)
    toast.success('URL copiada al portapapeles')
  }

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Automatizaciones"
        description="Flujos comerciales alineados con n8n y preparados para webhooks reales"
        action={
          <div className="flex items-center gap-2">
            <Badge variant={isRealMode ? 'success' : 'indigo'} dot>{isRealMode ? (workflowSeeded ? 'Catalogo preparado' : 'Automatizaciones preparadas') : 'Modo demo'}</Badge>
            <Button size="sm" onClick={() => toast.success('Editor de automatizaciones', { description: 'Siguiente fase: crear workflows visuales conectados a n8n_flows.' })}>
              <Plus className="h-3.5 w-3.5" />
              Nueva automatizacion
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: 'Emails enviados este mes', value: '2.614', demo: true, icon: <Mail className="h-4 w-4" />, color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Tasa apertura media', value: '63,5%', demo: true, icon: <BarChart2 className="h-4 w-4" />, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Flows n8n preparados', value: String(linkedFlows.length), demo: false, icon: <Zap className="h-4 w-4" />, color: 'text-violet-600 bg-violet-50' },
        ].map(({ label, value, demo, icon, color }) => (
          <div key={label} className="flex items-center gap-4 rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm shadow-gray-950/[0.035] transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.04]">
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', color)}>{icon}</div>
            <div>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="mt-0.5 text-xl font-bold text-gray-900">{value}</p>
              {demo && <p className="text-[10px] text-gray-400">dato de ejemplo</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
        <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p className="text-xs leading-5 text-amber-800">
          Los toggles se habilitaran cuando exista endpoint n8n real, credenciales server-side e integraciones requeridas.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {automations.map((automation) => {
          const currentStatus = activeStatuses[automation.id] ?? automation.status
          const cfg = statusConfig[currentStatus]
          const event = automationFlowMap[automation.id]
          const flowStatus = event ? flowStatuses[event] ?? 'pending_config' : 'pending_config'
          const flowCfg = flowStatusConfig[flowStatus]
          const isActive = currentStatus === 'active'
          const isRunning = runningAction === automation.id
          const catalog = automationCatalog[automation.id]
          const canActivate = catalog?.canActivateNow ?? true
          const blockReason = catalog?.reasonIfUnavailable
          return (
            <SectionCard
              key={automation.id}
              className={cn('transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-950/[0.045]', isActive && 'ring-1 ring-indigo-200', !canActivate && 'opacity-90')}
              title={automation.name}
              action={<Badge variant={cfg.variant} dot>{cfg.label}</Badge>}
            >
              <p className="mb-3 text-xs leading-relaxed text-gray-500">{automation.description}</p>

              {!canActivate && blockReason && (
                <div className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-2">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                  <span className="text-[10px] leading-4 text-amber-800">{blockReason} - configura en Ajustes</span>
                </div>
              )}

              <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-[11px] font-medium text-gray-600">Trigger:</span>
                  <span className="text-[11px] text-gray-700">{automation.trigger}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant={flowCfg.variant} dot className="text-[10px]">{flowCfg.label}</Badge>
                  {event && <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-100">{event}</span>}
                </div>
                {catalog && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {catalog.requiredIntegrations.map((key) => {
                      const intg = integrationLabel[key]
                      const isPending = intg.pending
                      return (
                        <span
                          key={key}
                          className={cn(
                            'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            isPending ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-100' : 'bg-gray-100 text-gray-600'
                          )}
                        >
                          {intg.icon}{intg.label}{isPending && ' pendiente'}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="mb-3 grid grid-cols-2 gap-3">
                {[
                  { label: 'Emails enviados', value: automation.emailsSent.toLocaleString() },
                  { label: 'Conversiones', value: automation.conversions },
                  { label: 'Apertura', value: `${automation.openRate}%` },
                  { label: 'Clic', value: `${automation.clickRate}%` },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-gray-50 p-2.5">
                    <p className="text-[10px] text-gray-400">{label}</p>
                    <p className="mt-0.5 text-sm font-bold text-gray-900">{value}</p>
                    <p className="text-[9px] text-gray-300">ejemplo</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <div className="flex flex-1 items-center gap-1">
                  <Clock className="h-3 w-3 text-gray-400" />
                  <span className="text-[10px] text-gray-400">Ultimo: {automation.lastRun}</span>
                </div>
                <button
                  disabled={isRunning}
                  onClick={() => void handleRunNow(automation)}
                  className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-50"
                >
                  <RefreshCw className={cn('h-3 w-3', isRunning && 'animate-spin')} />
                  {isRunning ? 'Probando...' : 'Probar'}
                </button>
                {canActivate ? (
                  <button
                    onClick={() => void toggle(automation.id)}
                    className={cn(
                      'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                      isActive ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    )}
                  >
                    {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    {isActive ? 'Pausar' : 'Activar'}
                  </button>
                ) : (
                  <button
                    disabled
                    title={blockReason}
                    className="flex cursor-not-allowed items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11px] font-semibold text-gray-400"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Pendiente
                  </button>
                )}
              </div>
            </SectionCard>
          )
        })}
      </div>

      <SectionCard title="Flujo de emails - Bienvenida a nuevos leads" description="Secuencia automatica preparada para conectarse a n8n">
        <div className="flex items-center gap-0 overflow-x-auto pb-2">
          {emailFlowSteps.map((step, i) => (
            <div key={step.type + i} className="flex shrink-0 items-center">
              <div className={cn('flex min-w-[98px] flex-col items-center justify-center rounded-xl px-4 py-3 text-center', step.color)}>
                <span className="opacity-80">{step.icon}</span>
                <span className="mt-1 text-xs font-bold">{step.label}</span>
                <span className="mt-0.5 text-[10px] opacity-80">{step.description}</span>
              </div>
              {i < emailFlowSteps.length - 1 && <ArrowRight className="mx-1 h-4 w-4 shrink-0 text-gray-300" />}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="n8n readiness"
        description="Flujos clave que comparten contrato con Settings y /api/n8n/trigger"
        action={
          <a href="https://n8n.io" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
            Abrir n8n
            <ExternalLink className="h-3 w-3" />
          </a>
        }
      >
        <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_220px]">
          <div className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-xs font-semibold text-amber-900">Pre-n8n real</p>
              <p className="mt-0.5 text-[11px] text-amber-700">Pega endpoints reales en Settings. Esta pagina prueba los mismos eventos en modo simulado si no hay URL real.</p>
            </div>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
            <p className="text-xs font-semibold text-indigo-900">Modo actual</p>
            <p className="mt-1 text-lg font-bold text-indigo-700">{isRealMode ? 'Workspace real' : 'Simulado'}</p>
            <p className="text-[11px] text-indigo-700">Los triggers pasan por /api/n8n/trigger.</p>
          </div>
        </div>

        <div className="space-y-2">
          {linkedFlows.map((flow) => {
            const status = flowStatuses[flow.event] ?? flow.status
            const cfg = flowStatusConfig[status]
            const url = flowUrls[flow.event] ?? flow.url
            return (
              <div key={flow.event} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white px-4 py-3 shadow-sm shadow-gray-950/[0.02]">
                <div className={cn('h-2 w-2 shrink-0 rounded-full', status === 'active' || status === 'demo' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : 'bg-gray-300')} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-800">{flow.label}</p>
                  <p className="truncate font-mono text-[10px] text-gray-400">{url}</p>
                </div>
                <Badge variant={cfg.variant}>{cfg.label}</Badge>
                <button
                  onClick={() => void handleRunFlow(flow.event)}
                  disabled={runningAction === flow.event}
                  className="flex h-7 items-center gap-1 rounded-lg bg-indigo-50 px-2 text-[10px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-50"
                >
                  <RefreshCw className={cn('h-3 w-3', runningAction === flow.event && 'animate-spin')} />
                  Test
                </button>
                <button
                  onClick={() => copyUrl(url)}
                  title={copiedUrl === url ? 'Copiado' : 'Copiar URL'}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white hover:text-gray-600"
                >
                  {copiedUrl === url ? <CheckCircle className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            )
          })}
        </div>
      </SectionCard>

      <SectionCard title="Emails recientes" description="Ultimos envios de todas las automatizaciones" noPadding>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                {['Destinatario', 'Asunto', 'Automatizacion', 'Enviado', 'Estado'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {automationEmails.map((email, i) => {
                const automation = automations.find((a) => a.id === email.automationId)
                const cfg = emailStatusConfig[email.status]
                return (
                  <tr key={email.id} className={cn('border-b border-gray-50 transition-colors hover:bg-indigo-50/35', i === automationEmails.length - 1 && 'border-b-0')}>
                    <td className="px-5 py-3"><span className="text-sm font-medium text-gray-800">{email.recipient}</span></td>
                    <td className="px-5 py-3"><span className="block max-w-xs truncate text-sm text-gray-600">{email.subject}</span></td>
                    <td className="px-5 py-3"><span className="text-xs text-gray-500">{automation?.name ?? '-'}</span></td>
                    <td className="px-5 py-3"><span className="text-xs text-gray-400">{email.sentAt}</span></td>
                    <td className="px-5 py-3"><Badge variant={cfg.variant}>{cfg.icon}{cfg.label}</Badge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </motion.div>
  )
}
