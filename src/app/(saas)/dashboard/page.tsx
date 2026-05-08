'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Users, DollarSign, Bot, Mail, Lightbulb, AlertTriangle, Info, Plus, ArrowRight, MessageSquare, Phone, FileText, Star, Activity, CheckCircle, Wifi, Zap, Globe } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { MetricCard } from '@/components/MetricCard'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { dashboardMetrics, aiInsights, recentActivity, weeklyLeads } from '@/lib/mock-data'
import { triggerN8nWebhook } from '@/lib/integrations'
import type { Activity as CRMActivity, AIInsightType, ActivityType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DEMO_MODE_KEY, useCurrentUser } from '@/lib/current-user'
import { getActivities, getCalendarEvents, getClients, getConversations, getInvoices, getWorkspaceContext } from '@/lib/supabase-queries'

const metricIcons = {
  Users: <Users className="h-5 w-5" />,
  DollarSign: <DollarSign className="h-5 w-5" />,
  Bot: <Bot className="h-5 w-5" />,
  Mail: <Mail className="h-5 w-5" />,
}

const insightConfig: Record<AIInsightType, { icon: React.ReactNode; variant: 'warning' | 'success' | 'info' }> = {
  opportunity: { icon: <Lightbulb className="h-4 w-4 text-emerald-600" />, variant: 'success' },
  warning: { icon: <AlertTriangle className="h-4 w-4 text-amber-600" />, variant: 'warning' },
  info: { icon: <Info className="h-4 w-4 text-blue-600" />, variant: 'info' },
}

const activityIcons: Record<ActivityType, React.ReactNode> = {
  deal: <Star className="h-3.5 w-3.5 text-indigo-600" />,
  message: <MessageSquare className="h-3.5 w-3.5 text-blue-500" />,
  email: <Mail className="h-3.5 w-3.5 text-violet-500" />,
  call: <Phone className="h-3.5 w-3.5 text-emerald-500" />,
  note: <FileText className="h-3.5 w-3.5 text-gray-500" />,
}

const activityBg: Record<ActivityType, string> = {
  deal: 'bg-indigo-50', message: 'bg-blue-50', email: 'bg-violet-50', call: 'bg-emerald-50', note: 'bg-gray-100',
}

const channels = [
  { name: 'Assistant n8n/OpenAI', status: 'connected', color: 'text-emerald-600 bg-emerald-50', leads: 0, icon: <Zap className="h-4 w-4" /> },
  { name: 'Web Chat', status: 'prepared', color: 'text-blue-600 bg-blue-50', leads: 0, icon: <Wifi className="h-4 w-4" /> },
  { name: 'WhatsApp / Whapi', status: 'pending', color: 'text-amber-600 bg-amber-50', leads: 0, icon: <MessageSquare className="h-4 w-4" /> },
  { name: 'Instagram', status: 'pending', color: 'text-violet-600 bg-violet-50', leads: 0, icon: <Globe className="h-4 w-4" /> },
  { name: 'Email / Resend', status: 'pending', color: 'text-indigo-600 bg-indigo-50', leads: 0, icon: <Mail className="h-4 w-4" /> },
]

const aiActions = [
  { title: 'Agendar seguimiento con 3 leads calientes', cta: 'Agendar', event: 'appointment_booked' as const, icon: <Phone className="h-3.5 w-3.5" /> },
  { title: 'Enviar propuesta a Carlos Méndez', cta: 'Enviar', event: 'new_lead' as const, icon: <Mail className="h-3.5 w-3.5" /> },
  { title: 'Cobrar factura vencida: Textil SL (EUR 299)', cta: 'Cobrar', event: 'invoice_paid' as const, icon: <DollarSign className="h-3.5 w-3.5" /> },
  { title: 'Revisar conversación negativa: Miguel Torres', cta: 'Ver', event: 'invoice_overdue' as const, icon: <AlertTriangle className="h-3.5 w-3.5" /> },
]

const workspaceSignals = [
  { label: 'SLA respuesta IA', value: '1m 48s', detail: 'mejor que ayer', tone: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
  { label: 'Pipeline caliente', value: '27 leads', detail: 'score superior a 80', tone: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
  { label: 'Cobros en riesgo', value: '3 facturas', detail: 'recordatorio listo', tone: 'text-amber-600 bg-amber-50 border-amber-100' },
]

export default function DashboardPage() {
  const router = useRouter()
  const { currentUser } = useCurrentUser()
  const [activity, setActivity] = useState(recentActivity)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [realStats, setRealStats] = useState<{ total: number; leads: number; averageScore: number; revenue: number; pending: number; events: number; conversations: number } | null>(null)

  useEffect(() => {
    const loadRealStats = async () => {
      if (window.localStorage.getItem(DEMO_MODE_KEY) === 'true') return
      try {
        const context = await getWorkspaceContext()
        const workspaceId = context?.workspace?.id || context?.profile?.workspace_id
        if (!workspaceId) return
        const [clients, invoices, events, conversations, activities] = await Promise.all([
          getClients(workspaceId),
          getInvoices(workspaceId).catch(() => []),
          getCalendarEvents(workspaceId).catch(() => []),
          getConversations(workspaceId).catch(() => []),
          getActivities(workspaceId).catch(() => [] as CRMActivity[]),
        ])
        const averageScore = clients.length ? Math.round(clients.reduce((sum, client) => sum + client.leadScore, 0) / clients.length) : 0
        setRealStats({
          total: clients.length,
          leads: clients.filter((client) => client.status === 'lead').length,
          averageScore,
          revenue: invoices.reduce((sum, invoice) => sum + invoice.amount, 0),
          pending: invoices.filter((invoice) => invoice.status !== 'paid').reduce((sum, invoice) => sum + invoice.amount, 0),
          events: events.filter((event) => event.date >= '2026-05-05').length,
          conversations: conversations.length,
        })
        if (activities.length) setActivity(activities)
      } catch {
        setRealStats(null)
      }
    }

    void loadRealStats()
  }, [])

  const visibleMetrics = useMemo(() => {
    if (!realStats) return dashboardMetrics
    return dashboardMetrics.map((metric) => {
      if (metric.label === 'Clientes activos') return { ...metric, value: String(realStats.total), changeLabel: 'clientes reales' }
      if (metric.label === 'Ingresos del mes') return { ...metric, value: `€${Math.round(realStats.revenue).toLocaleString('es-ES')}`, changeLabel: 'facturación real' }
      if (metric.label === 'Resueltos por IA') return { ...metric, value: `${realStats.conversations}`, label: 'Conversaciones', changeLabel: 'persistentes' }
      if (metric.label === 'Emails enviados') return { ...metric, value: String(realStats.events), label: 'Eventos próximos', changeLabel: 'calendario real' }
      return metric
    })
  }, [realStats])

  const handleInsightAction = async (action: string, insightId: string) => {
    if (insightId === '1') {
      setLoadingAction(insightId)
      await triggerN8nWebhook('reengagement_needed', { metadata: { trigger: 'reengagement', count: 34 } })
      setLoadingAction(null)
      setActivity((prev) => [{ id: `act-${Date.now()}`, type: 'email', description: 'Secuencia de re-engagement activada para 34 leads', timestamp: 'Ahora mismo' }, ...prev.slice(0, 5)])
      toast.success(`${action} activada`, { description: '34 leads entrarán en la secuencia de re-engagement.' })
    } else if (insightId === '2') {
      router.push('/billing')
    } else {
      toast.info(action, { description: 'Análisis disponible en la sección de analítica.' })
    }
  }

  const handleAIAction = async (action: typeof aiActions[0]) => {
    setLoadingAction(action.event)
    await triggerN8nWebhook(action.event, { metadata: { source: 'dashboard', action: action.title } })
    setLoadingAction(null)
    setActivity((prev) => [{ id: `act-${Date.now()}`, type: 'note', description: `IA ejecutó: ${action.title}`, timestamp: 'Ahora mismo' }, ...prev.slice(0, 5)])
    toast.success(`Acción completada: ${action.cta}`, { description: action.title })
  }

  const handleNewClient = () => {
    router.push('/clients')
    toast.info('Añade el cliente desde la sección de Clientes')
  }

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="hidden">
          <h2 className="text-2xl font-bold text-gray-950">Buenos días, NowCRM</h2>
          <p className="text-sm text-gray-500">Martes, 5 de mayo de 2026 · Todo marcha bien</p>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-950">Buenos días, {currentUser.name || currentUser.workspaceName}</h2>
            <Badge variant={currentUser.isDemo ? 'indigo' : 'success'} dot>{realStats ? 'Datos reales conectados' : currentUser.trialLabel}</Badge>
          </div>
          {realStats && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['Clientes reales', 'Facturación real', 'Calendario real', 'Assistant n8n/OpenAI', 'n8n preparado'].map((label) => (
                <span key={label} className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{label}</span>
              ))}
            </div>
          )}
          <p className="text-sm text-gray-500">Tu workspace {currentUser.workspaceName} está listo para probar NowCRM.</p>
        </div>
        <Button size="sm" onClick={handleNewClient}>
          <Plus className="h-3.5 w-3.5" />
          Nuevo cliente
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {workspaceSignals.map((signal) => (
          <div key={signal.label} className={cn('rounded-xl border px-4 py-3 shadow-sm shadow-gray-950/[0.025] transition-all hover:-translate-y-0.5 hover:shadow-md', signal.tone)}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium opacity-80">{signal.label}</p>
                <p className="mt-0.5 text-lg font-bold">{signal.value}</p>
              </div>
              <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-semibold text-gray-600 shadow-sm">{signal.detail}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {visibleMetrics.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} change={m.change} changeLabel={m.changeLabel} icon={metricIcons[m.icon as keyof typeof metricIcons]} />
        ))}
      </div>

      {/* Insights + Activity */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
        <SectionCard title="Insights de IA" description="Recomendaciones generadas automáticamente" action={<Badge variant="indigo" dot>{aiInsights.length} alertas</Badge>}>
          <ul className="space-y-3">
            {aiInsights.map((insight) => {
              const cfg = insightConfig[insight.type]
              return (
                <li key={insight.id} className="rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white p-4 shadow-sm shadow-gray-950/[0.02] transition-all hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.035]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm border border-gray-100">{cfg.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{insight.title}</p>
                      <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{insight.description}</p>
                      {insight.action && (
                        <button
                          disabled={loadingAction === insight.id}
                          className="mt-2.5 flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors disabled:opacity-50"
                          onClick={() => handleInsightAction(insight.action!, insight.id)}
                        >
                          {loadingAction === insight.id ? 'Ejecutando...' : insight.action}
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </SectionCard>

        <SectionCard title="Actividad reciente" description="Últimas acciones del sistema" action={<button onClick={() => toast.info('Historial completo próximamente')} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver todo</button>}>
          <ul className="space-y-1">
            {activity.map((item) => (
                <li key={item.id} className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-indigo-50/45">
                <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${activityBg[item.type]}`}>
                  {activityIcons[item.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 leading-relaxed">{item.description}</p>
                </div>
                <span className="shrink-0 text-[10px] text-gray-400 whitespace-nowrap">{item.timestamp}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      {/* Chart + Channels + AI Actions */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard title="Leads por canal" description="Esta semana" action={<Button variant="ghost" size="sm" onClick={() => toast.info('Exportando datos...')}><Activity className="h-3.5 w-3.5" />Exportar</Button>}>
          <ResponsiveContainer width="100%" height={245}>
            <BarChart data={weeklyLeads} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 11 }} cursor={{ fill: '#f9fafb' }} />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="WhatsApp" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={24} />
              <Bar dataKey="Instagram" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={24} />
              <Bar dataKey="Web" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={24} />
              <Bar dataKey="Email" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <div className="space-y-4">
          {/* Channels connected */}
          <SectionCard title="Canales e integraciones" description="Conectado ahora y siguiente fase">
            <ul className="space-y-2">
              {channels.map((ch) => (
                <li key={ch.name} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-gray-50">
                  <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', ch.color)}>{ch.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900">{ch.name}</p>
                    {ch.leads > 0 && <p className="text-[10px] text-gray-400">{ch.leads} leads hoy</p>}
                  </div>
                  {ch.status === 'connected'
                    ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    : ch.status === 'prepared'
                      ? <Badge variant="indigo" className="text-[10px]">Preparado</Badge>
                      : <Badge variant="warning" className="text-[10px]">Pendiente</Badge>
                  }
                </li>
              ))}
            </ul>
          </SectionCard>

          {/* AI suggested actions */}
          <SectionCard title="Próximas acciones IA" description="Sugeridas para hoy">
            <ul className="space-y-2">
              {aiActions.map((action) => (
                <li key={action.event} className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-gradient-to-br from-white to-gray-50/70 p-3 transition-all hover:border-indigo-100 hover:shadow-sm">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 mt-0.5">{action.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-gray-700 leading-relaxed">{action.title}</p>
                    <button
                      disabled={loadingAction === action.event}
                      onClick={() => handleAIAction(action)}
                      className="mt-1.5 text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50 flex items-center gap-0.5"
                    >
                      {loadingAction === action.event ? 'Ejecutando...' : action.cta}
                      <ArrowRight className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>
    </motion.div>
  )
}
