'use client'

import { useState } from 'react'
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
import type { AIInsightType, ActivityType } from '@/lib/types'
import { cn } from '@/lib/utils'

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
  { name: 'WhatsApp', status: 'connected', color: 'text-emerald-600 bg-emerald-50', leads: 62, icon: <MessageSquare className="h-4 w-4" /> },
  { name: 'Instagram', status: 'connected', color: 'text-violet-600 bg-violet-50', leads: 35, icon: <Globe className="h-4 w-4" /> },
  { name: 'Web Chat', status: 'connected', color: 'text-blue-600 bg-blue-50', leads: 41, icon: <Wifi className="h-4 w-4" /> },
  { name: 'Email', status: 'connected', color: 'text-indigo-600 bg-indigo-50', leads: 22, icon: <Mail className="h-4 w-4" /> },
  { name: 'n8n', status: 'pending', color: 'text-amber-600 bg-amber-50', leads: 0, icon: <Zap className="h-4 w-4" /> },
]

const aiActions = [
  { title: 'Agendar seguimiento con 3 leads calientes', cta: 'Agendar', event: 'appointment_scheduled' as const, icon: <Phone className="h-3.5 w-3.5" /> },
  { title: 'Enviar propuesta a Carlos Méndez', cta: 'Enviar', event: 'new_lead' as const, icon: <Mail className="h-3.5 w-3.5" /> },
  { title: 'Cobrar factura vencida: Textil SL (€299)', cta: 'Cobrar', event: 'payment_registered' as const, icon: <DollarSign className="h-3.5 w-3.5" /> },
  { title: 'Revisar conversación negativa: Miguel Torres', cta: 'Ver', event: 'invoice_overdue' as const, icon: <AlertTriangle className="h-3.5 w-3.5" /> },
]

export default function DashboardPage() {
  const router = useRouter()
  const [activity, setActivity] = useState(recentActivity)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

  const handleInsightAction = async (action: string, insightId: string) => {
    if (insightId === '1') {
      setLoadingAction(insightId)
      await triggerN8nWebhook('new_lead', { trigger: 'reengagement', count: 34 })
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
    await triggerN8nWebhook(action.event, { source: 'dashboard', action: action.title })
    setLoadingAction(null)
    setActivity((prev) => [{ id: `act-${Date.now()}`, type: 'note', description: `IA ejecutó: ${action.title}`, timestamp: 'Ahora mismo' }, ...prev.slice(0, 5)])
    toast.success(`Acción completada: ${action.cta}`, { description: action.title })
  }

  const handleNewClient = () => {
    router.push('/clients')
    toast.info('Añade el cliente desde la sección de Clientes')
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Buenos días, NowCRM</h2>
          <p className="text-sm text-gray-500">Martes, 5 de mayo de 2026 · Todo marcha bien</p>
        </div>
        <Button size="sm" onClick={handleNewClient}>
          <Plus className="h-3.5 w-3.5" />
          Nuevo cliente
        </Button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {dashboardMetrics.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} change={m.change} changeLabel={m.changeLabel} icon={metricIcons[m.icon as keyof typeof metricIcons]} />
        ))}
      </div>

      {/* Insights + Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Insights de IA" description="Recomendaciones generadas automáticamente" action={<Badge variant="indigo" dot>{aiInsights.length} alertas</Badge>}>
          <ul className="space-y-3">
            {aiInsights.map((insight) => {
              const cfg = insightConfig[insight.type]
              return (
                <li key={insight.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
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

        <SectionCard title="Actividad reciente" description="Últimas acciones del sistema" action={<button className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver todo</button>}>
          <ul className="space-y-1">
            {activity.map((item) => (
              <li key={item.id} className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50 transition-colors">
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard className="lg:col-span-2" title="Leads por canal" description="Esta semana" action={<Button variant="ghost" size="sm" onClick={() => toast.info('Exportando datos...')}><Activity className="h-3.5 w-3.5" />Exportar</Button>}>
          <ResponsiveContainer width="100%" height={220}>
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
          <SectionCard title="Canales conectados" description="Estado en tiempo real">
            <ul className="space-y-2">
              {channels.map((ch) => (
                <li key={ch.name} className="flex items-center gap-2.5">
                  <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', ch.color)}>{ch.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900">{ch.name}</p>
                    {ch.leads > 0 && <p className="text-[10px] text-gray-400">{ch.leads} leads hoy</p>}
                  </div>
                  {ch.status === 'connected'
                    ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
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
                <li key={action.event} className="flex items-start gap-2.5 rounded-lg border border-gray-100 p-3">
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
    </div>
  )
}
