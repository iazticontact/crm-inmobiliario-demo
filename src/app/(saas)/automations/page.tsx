'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Play, Pause, Zap, Mail, Clock, CheckCircle, XCircle, ArrowRight, BarChart2, ExternalLink, Copy, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { automations, automationEmails } from '@/lib/mock-data'
import { triggerN8nWebhook } from '@/lib/integrations'
import { cn } from '@/lib/utils'
import type { AutomationStatus, AutomationEmailStatus } from '@/lib/types'

const statusConfig: Record<AutomationStatus, { label: string; variant: 'success' | 'warning' | 'default' }> = {
  active: { label: 'Activa', variant: 'success' },
  paused: { label: 'Pausada', variant: 'warning' },
  draft: { label: 'Borrador', variant: 'default' },
}

const emailStatusConfig: Record<AutomationEmailStatus, { label: string; variant: 'success' | 'info' | 'indigo' | 'danger'; icon: React.ReactNode }> = {
  delivered: { label: 'Entregado', variant: 'info', icon: <Mail className="h-3 w-3" /> },
  opened: { label: 'Abierto', variant: 'success', icon: <CheckCircle className="h-3 w-3" /> },
  clicked: { label: 'Clic', variant: 'indigo', icon: <ArrowRight className="h-3 w-3" /> },
  bounced: { label: 'Rebotado', variant: 'danger', icon: <XCircle className="h-3 w-3" /> },
}

const emailFlowSteps = [
  { type: 'trigger', label: 'Trigger', description: 'Nuevo lead', icon: <Zap className="h-4 w-4" />, color: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20' },
  { type: 'email', label: 'Email 1', description: 'Bienvenida', icon: <Mail className="h-4 w-4" />, color: 'bg-blue-50 border border-blue-200 text-blue-700' },
  { type: 'wait', label: 'Espera', description: '2 días', icon: <Clock className="h-4 w-4" />, color: 'bg-gray-100 border border-gray-200 text-gray-600' },
  { type: 'email', label: 'Email 2', description: 'Recursos', icon: <Mail className="h-4 w-4" />, color: 'bg-blue-50 border border-blue-200 text-blue-700' },
  { type: 'wait', label: 'Espera', description: '3 días', icon: <Clock className="h-4 w-4" />, color: 'bg-gray-100 border border-gray-200 text-gray-600' },
  { type: 'email', label: 'Email 3', description: 'Oferta', icon: <Mail className="h-4 w-4" />, color: 'bg-blue-50 border border-blue-200 text-blue-700' },
  { type: 'end', label: 'Fin', description: 'Convertido', icon: <CheckCircle className="h-4 w-4" />, color: 'bg-emerald-500 text-white shadow-sm shadow-emerald-600/20' },
]

const n8nWebhooks = [
  { event: 'new_lead', label: 'Nuevo lead', url: 'https://n8n.tudominio.com/webhook/new-lead', active: true },
  { event: 'payment_registered', label: 'Pago registrado', url: 'https://n8n.tudominio.com/webhook/payment', active: true },
  { event: 'appointment_scheduled', label: 'Cita agendada', url: 'https://n8n.tudominio.com/webhook/appointment', active: false },
  { event: 'invoice_overdue', label: 'Factura vencida', url: 'https://n8n.tudominio.com/webhook/invoice-overdue', active: true },
]

export default function AutomationsPage() {
  const [activeStatuses, setActiveStatuses] = useState<Record<string, AutomationStatus>>(
    Object.fromEntries(automations.map((a) => [a.id, a.status]))
  )
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  const toggle = (id: string) => {
    setActiveStatuses((prev) => {
      const next = prev[id] === 'active' ? 'paused' : 'active'
      toast.success(next === 'active' ? 'Automatización activada' : 'Automatización pausada', {
        description: automations.find((a) => a.id === id)?.name,
      })
      return { ...prev, [id]: next }
    })
  }

  const handleRunNow = async (automation: typeof automations[0]) => {
    setRunningAction(automation.id)
    await triggerN8nWebhook('new_lead', { source: 'manual_trigger', automationId: automation.id, automationName: automation.name })
    setRunningAction(null)
    toast.success(`Ejecutada: ${automation.name}`, { description: `${automation.emailsSent} destinatarios procesados.` })
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
        description="Flujos activos gestionados por IA"
        action={
          <Button size="sm" onClick={() => toast.success('Editor de automatizaciones', { description: 'Próximamente: crea flujos con drag & drop.' })}>
            <Plus className="h-3.5 w-3.5" />
            Nueva automatización
          </Button>
        }
      />

      {/* Summary stats */}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: 'Emails enviados este mes', value: '2.614', icon: <Mail className="h-4 w-4" />, color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Tasa apertura media', value: '63,5%', icon: <BarChart2 className="h-4 w-4" />, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Conversiones totales', value: '596', icon: <CheckCircle className="h-4 w-4" />, color: 'text-violet-600 bg-violet-50' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="flex items-center gap-4 rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm shadow-gray-950/[0.035] transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.04]">
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', color)}>{icon}</div>
            <div>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-xl font-bold text-gray-900 mt-0.5">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Automation cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {automations.map((automation) => {
          const currentStatus = activeStatuses[automation.id] ?? automation.status
          const cfg = statusConfig[currentStatus]
          const isActive = currentStatus === 'active'
          const isRunning = runningAction === automation.id
          return (
            <SectionCard
              key={automation.id}
              className={cn('transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-950/[0.045]', isActive && 'ring-1 ring-indigo-200')}
              title={automation.name}
              action={<Badge variant={cfg.variant} dot>{cfg.label}</Badge>}
            >
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">{automation.description}</p>

              <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-[11px] font-medium text-gray-600">Trigger:</span>
                  <span className="text-[11px] text-gray-700">{automation.trigger}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: 'Emails enviados', value: automation.emailsSent.toLocaleString() },
                  { label: 'Conversiones', value: automation.conversions },
                  { label: 'Tasa apertura', value: `${automation.openRate}%` },
                  { label: 'Tasa de clic', value: `${automation.clickRate}%` },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-gray-50 p-2.5">
                    <p className="text-[10px] text-gray-400">{label}</p>
                    <p className="text-sm font-bold text-gray-900 mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 flex-1">
                  <Clock className="h-3 w-3 text-gray-400" />
                  <span className="text-[10px] text-gray-400">Último: {automation.lastRun}</span>
                </div>
                <button
                  disabled={isRunning}
                  onClick={() => handleRunNow(automation)}
                  className="flex items-center gap-1 rounded-lg bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={cn('h-3 w-3', isRunning && 'animate-spin')} />
                  {isRunning ? 'Ejecutando...' : 'Ejecutar'}
                </button>
                <button
                  onClick={() => toggle(automation.id)}
                  className={cn(
                    'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                    isActive
                      ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  )}
                >
                  {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {isActive ? 'Pausar' : 'Activar'}
                </button>
              </div>
            </SectionCard>
          )
        })}
      </div>

      {/* Email flow visualization */}
      <SectionCard title="Flujo de emails — Bienvenida a nuevos leads" description="Secuencia automática de 3 emails">
        <div className="flex items-center gap-0 overflow-x-auto pb-2">
          {emailFlowSteps.map((step, i) => (
            <div key={i} className="flex shrink-0 items-center">
              <div className={cn('flex min-w-[98px] flex-col items-center justify-center rounded-xl px-4 py-3 text-center', step.color)}>
                <span className="opacity-80">{step.icon}</span>
                <span className="text-xs font-bold mt-1">{step.label}</span>
                <span className="text-[10px] mt-0.5 opacity-80">{step.description}</span>
              </div>
              {i < emailFlowSteps.length - 1 && (
                <ArrowRight className="h-4 w-4 text-gray-300 mx-1 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      {/* n8n integration section */}
      <SectionCard
        title="Integración n8n"
        description="Webhooks configurados para automatizaciones externas"
        action={
          <a
            href="https://n8n.io"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            Abrir n8n
            <ExternalLink className="h-3 w-3" />
          </a>
        }
      >
        <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_220px]">
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 flex items-start gap-3">
            <Zap className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-900">Configuración pendiente</p>
              <p className="text-[11px] text-amber-700 mt-0.5">Añade la URL base de tu instancia n8n en <span className="font-mono">NEXT_PUBLIC_N8N_BASE_URL</span> para activar los webhooks reales.</p>
            </div>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
            <p className="text-xs font-semibold text-indigo-900">Modo actual</p>
            <p className="mt-1 text-lg font-bold text-indigo-700">Simulado</p>
            <p className="text-[11px] text-indigo-700">Los disparos muestran feedback sin llamar a n8n real.</p>
          </div>
        </div>

        <div className="space-y-2">
          {n8nWebhooks.map((wh) => (
            <div key={wh.event} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white px-4 py-3 shadow-sm shadow-gray-950/[0.02]">
              <div className={cn('h-2 w-2 rounded-full shrink-0', wh.active ? 'bg-emerald-400' : 'bg-gray-300')} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800">{wh.label}</p>
                <p className="text-[10px] font-mono text-gray-400 truncate">{wh.url}</p>
              </div>
              <Badge variant={wh.active ? 'success' : 'default'}>{wh.active ? 'Activo' : 'Inactivo'}</Badge>
              <button
                onClick={() => copyUrl(wh.url)}
                title={copiedUrl === wh.url ? 'Copiado' : 'Copiar URL'}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-gray-600 transition-colors"
              >
                {copiedUrl === wh.url ? <CheckCircle className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Recent emails table */}
      <SectionCard title="Emails recientes" description="Últimos envíos de todas las automatizaciones" noPadding>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                {['Destinatario', 'Asunto', 'Automatización', 'Enviado', 'Estado'].map((h) => (
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
                    <td className="px-5 py-3">
                      <span className="text-sm font-medium text-gray-800">{email.recipient}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-sm text-gray-600 truncate max-w-xs block">{email.subject}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs text-gray-500">{automation?.name ?? '—'}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs text-gray-400">{email.sentAt}</span>
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={cfg.variant}>
                        {cfg.icon}
                        {cfg.label}
                      </Badge>
                    </td>
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
