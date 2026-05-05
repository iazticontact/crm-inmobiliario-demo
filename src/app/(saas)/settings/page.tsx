'use client'

import { useState } from 'react'
import {
  AlertCircle,
  Bell,
  Building2,
  CheckCircle,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  Globe,
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
import { n8nWebhookConfigs, simulateWhatsAppIncomingLead, supabaseStatus, triggerN8nWebhook } from '@/lib/integrations'
import { cn } from '@/lib/utils'

type IntegrationStatus = 'connected' | 'disconnected' | 'pending'

type Integration = {
  id: string
  name: string
  description: string
  status: IntegrationStatus
  icon: React.ReactNode
  info?: string
  category: string
}

const integrations: Integration[] = [
  { id: 'whatsapp', name: 'WhatsApp Business', description: 'Canal principal simulado para captación y atención.', status: 'connected', icon: <MessageSquare className="h-5 w-5" />, info: '+34 612 345 678', category: 'Mensajería' },
  { id: 'instagram', name: 'Instagram Direct', description: 'Bandeja de mensajes directos y leads sociales.', status: 'connected', icon: <Globe className="h-5 w-5" />, info: '@nowcrm.demo', category: 'Social' },
  { id: 'email', name: 'Email SMTP', description: 'Secuencias comerciales y emails transaccionales.', status: 'connected', icon: <Mail className="h-5 w-5" />, info: 'iazti.contact@gmail.com', category: 'Email' },
  { id: 'web', name: 'Widget Web', description: 'Chat web integrado para captar leads desde la página.', status: 'connected', icon: <Globe className="h-5 w-5" />, info: 'nowcrm-demo.vercel.app', category: 'Web' },
  { id: 'stripe', name: 'Stripe Payments', description: 'Cobros automáticos y suscripciones para la fase real.', status: 'pending', icon: <Shield className="h-5 w-5" />, category: 'Pagos' },
  { id: 'slack', name: 'Slack', description: 'Alertas internas de leads, cobros y conversaciones urgentes.', status: 'disconnected', icon: <Bell className="h-5 w-5" />, category: 'Equipo' },
]

const architectureCards = [
  { title: 'Supabase', label: 'Datos y Auth', detail: 'Pendiente real', icon: <Database className="h-5 w-5" />, tone: 'border-amber-100 bg-amber-50 text-amber-700' },
  { title: 'n8n', label: 'Webhooks y flujos', detail: 'Simulado', icon: <Zap className="h-5 w-5" />, tone: 'border-indigo-100 bg-indigo-50 text-indigo-700' },
  { title: 'WhatsApp Business', label: 'Canal conversacional', detail: 'Demo activa', icon: <MessageSquare className="h-5 w-5" />, tone: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
  { title: 'Integraciones', label: 'Servicios externos', detail: 'Mock controlado', icon: <Globe className="h-5 w-5" />, tone: 'border-sky-100 bg-sky-50 text-sky-700' },
]

const notifDefaults = [
  { key: 'leads', label: 'Nuevos leads', description: 'Cuando un lead entra por cualquier canal', enabled: true },
  { key: 'invoices', label: 'Facturas vencidas', description: 'Alertas de pagos pendientes y recordatorios IA', enabled: true },
  { key: 'dailyReport', label: 'Resumen diario IA', description: 'Reporte matutino con métricas e insights', enabled: true },
  { key: 'urgent', label: 'Conversaciones urgentes', description: 'Cuando la IA detecta sentimiento negativo', enabled: false },
]

const workspaceItems = [
  { label: 'Nombre del workspace', value: 'NowCRM Demo', icon: <Building2 className="h-4 w-4" /> },
  { label: 'Email de administrador', value: 'iazti.contact@gmail.com', icon: <Mail className="h-4 w-4" /> },
  { label: 'Zona horaria', value: 'Europe/Madrid (UTC+2)', icon: <Globe className="h-4 w-4" /> },
  { label: 'Idioma', value: 'Español', icon: <User className="h-4 w-4" /> },
]

const supabaseReadiness = [
  { label: 'Auth demo', value: 'mock', status: 'Pendiente Supabase Auth' },
  { label: 'Clientes', value: 'mock-data.ts', status: 'Lista para tabla clients' },
  { label: 'Facturas', value: 'mock-data.ts', status: 'Lista para tabla invoices' },
  { label: 'Eventos', value: 'mock-data.ts', status: 'Lista para tabla calendar_events' },
]

const statusBadge = (status: IntegrationStatus) => {
  if (status === 'connected') return <Badge variant="success" dot>Conectado</Badge>
  if (status === 'pending') return <Badge variant="warning" dot>Pendiente</Badge>
  return <Badge variant="default" dot>Desconectado</Badge>
}

export default function SettingsPage() {
  const [notifications, setNotifications] = useState<Record<string, boolean>>(
    Object.fromEntries(notifDefaults.map((n) => [n.key, n.enabled]))
  )
  const [integrationStatuses, setIntegrationStatuses] = useState<Record<string, IntegrationStatus>>(
    Object.fromEntries(integrations.map((intg) => [intg.id, intg.status]))
  )
  const [simulatingWA, setSimulatingWA] = useState(false)
  const [n8nUrl, setN8nUrl] = useState('https://n8n.tudominio.com')
  const [testingN8n, setTestingN8n] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const toggleNotif = (key: string) => {
    const next = !notifications[key]
    setNotifications((prev) => ({ ...prev, [key]: next }))
    const label = notifDefaults.find((n) => n.key === key)?.label ?? key
    toast.success(`Notificación ${next ? 'activada' : 'desactivada'}`, { description: label })
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

  const handleTestN8n = async () => {
    setTestingN8n(true)
    await triggerN8nWebhook('new_lead', { source: 'settings', mode: 'demo', url: `${n8nUrl}/webhook/test` })
    setTestingN8n(false)
    toast.success('Webhook de prueba enviado', { description: `POST → ${n8nUrl}/webhook/test · modo simulado` })
  }

  const copyToClipboard = (value: string, key: string) => {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
    toast.success('Copiado al portapapeles')
  }

  const handleVerifySupabase = () => {
    toast.info('Supabase sigue en modo demo', {
      description: 'La UI está preparada, pero todavía no se usan variables ni persistencia real.',
    })
  }

  const handleIntegrationAction = (integration: Integration) => {
    const currentStatus = integrationStatuses[integration.id]
    if (currentStatus === 'connected') {
      toast.info(`${integration.name} configurado`, { description: 'Conexión simulada activa en la demo.' })
      return
    }

    const nextStatus: IntegrationStatus = currentStatus === 'pending' ? 'connected' : 'pending'
    setIntegrationStatuses((prev) => ({ ...prev, [integration.id]: nextStatus }))
    toast.success(
      nextStatus === 'connected' ? `${integration.name} conectado en demo` : `${integration.name} pendiente de autorización`,
      { description: 'No se ha llamado a ningún proveedor externo real.' }
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Configuración"
        description="Arquitectura demo, workspace e integraciones listas para la siguiente fase"
        action={<Badge variant="indigo" dot>Modo demo</Badge>}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {architectureCards.map((card) => (
          <div key={card.title} className={cn('rounded-xl border p-4 shadow-sm shadow-gray-950/[0.03]', card.tone)}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/75 shadow-sm">{card.icon}</div>
              <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-semibold text-gray-600">{card.detail}</span>
            </div>
            <p className="text-sm font-bold">{card.title}</p>
            <p className="mt-0.5 text-xs opacity-80">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <SectionCard title="Workspace" description="Identidad y preferencias del entorno NowCRM">
            <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-xl font-bold text-white shadow-sm shadow-indigo-600/20">
                  N
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">NowCRM Demo</p>
                  <p className="text-xs text-gray-500">iazti.contact@gmail.com</p>
                </div>
              </div>
              <Badge variant="indigo">Plan Pro</Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {workspaceItems.map(({ label, value, icon }) => (
                <div key={label} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-gray-400">{icon}</span>
                    <div>
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className="text-sm font-medium text-gray-900">{value}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toast.info(`Editando: ${label}`, { description: 'Editor de ajustes próximamente.' })}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    Editar
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={() => toast.success('Cambios guardados', { description: 'La configuración demo se ha actualizado visualmente.' })}>
                Guardar cambios
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            title="Supabase"
            description="Base de datos, autenticación y persistencia de la fase real"
            action={
              <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
                Supabase Console
                <ExternalLink className="h-3 w-3" />
              </a>
            }
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <Database className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div>
                    <p className="text-xs font-semibold text-amber-900">Pendiente de conectar</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-amber-700">
                      La demo usa mock data. La siguiente fase puede activar Supabase Auth, tablas reales y persistencia sin cambiar la experiencia visual.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-xs font-semibold text-gray-700">Estado técnico</p>
                <p className="mt-1 text-lg font-bold text-gray-950">UI preparada</p>
                <p className="text-[11px] text-gray-500">Sin llamadas reales al backend.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[
                { key: 'NEXT_PUBLIC_SUPABASE_URL', value: supabaseStatus.projectUrl, label: 'Project URL' },
                { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', label: 'Anon Key' },
              ].map(({ key, value, label }) => (
                <div key={key} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-semibold text-gray-500">{label}</span>
                    <button
                      onClick={() => copyToClipboard(`${key}=${value}`, key)}
                      className="flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedKey === key ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <p className="truncate font-mono text-[11px] text-gray-700">{key}</p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-gray-400">{value}</p>
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
              <Button variant="secondary" size="sm" onClick={() => toast.info('Checklist Supabase', { description: 'Auth, clients, invoices, events y audit log serán la primera migración.' })}>
                Ver checklist
              </Button>
              <Button size="sm" onClick={handleVerifySupabase}>
                Verificar conexión
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            title="n8n Webhooks"
            description="Automatizaciones externas. En esta demo todo se ejecuta en modo simulado."
            action={
              <a href="https://n8n.io" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
                Abrir n8n
                <ExternalLink className="h-3 w-3" />
              </a>
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
                  <Button size="sm" variant="secondary" loading={testingN8n} onClick={handleTestN8n}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Probar webhook
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                <p className="text-xs font-semibold text-indigo-900">Modo n8n</p>
                <p className="mt-1 text-lg font-bold text-indigo-700">Simulado</p>
                <p className="text-[11px] text-indigo-700">Feedback visual sin HTTP real.</p>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {n8nWebhookConfigs.map((wh, index) => {
                const path = wh.url.replace('https://n8n.tudominio.com', '')
                const isActive = index !== 2
                const fullUrl = `${n8nUrl}${path}`
                return (
                  <div key={wh.event} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 rounded-full', isActive ? 'bg-emerald-400' : 'bg-gray-300')} />
                        <p className="text-xs font-semibold text-gray-900">{wh.label}</p>
                      </div>
                      <Badge variant={isActive ? 'success' : 'default'}>{isActive ? 'Activo' : 'Inactivo'}</Badge>
                    </div>
                    <p className="text-[11px] leading-5 text-gray-500">{wh.description}</p>
                    <div className="mt-2 flex items-center gap-2 rounded-lg bg-white px-2 py-1.5">
                      <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-500">{fullUrl}</p>
                      <button
                        onClick={() => copyToClipboard(fullUrl, wh.event)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        {copiedKey === wh.event ? <CheckCircle className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </SectionCard>

          <SectionCard title="WhatsApp Business" description="Canal simulado para leads entrantes y conversaciones">
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div>
                <div className="mb-4 flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
                    <MessageSquare className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">+34 612 345 678</p>
                      <Badge variant="success" dot>Conectado demo</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">WhatsApp Business API · sin proveedor Meta real todavía</p>
                    <p className="mt-2 text-xs leading-5 text-gray-600">
                      El botón genera un lead mock y muestra el flujo que después podrá crear registros reales en Supabase y disparar n8n.
                    </p>
                  </div>
                </div>

                <Button size="sm" loading={simulatingWA} onClick={handleSimulateWA}>
                  <Play className="h-3.5 w-3.5" />
                  {simulatingWA ? 'Simulando...' : 'Simular lead de WhatsApp'}
                </Button>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <p className="text-xs font-semibold text-emerald-900">Flujo demo</p>
                <div className="mt-3 space-y-2">
                  {['Mensaje entrante', 'Lead mock creado', 'Insight IA', 'Webhook n8n simulado'].map((step, index) => (
                    <div key={step} className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-emerald-700">{index + 1}</span>
                      <span className="text-xs text-emerald-800">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Integraciones externas" description="Canales y servicios conectados o preparados para autorización">
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
                    {intg.info && currentStatus === 'connected' && (
                      <p className="mt-2 truncate rounded-lg bg-white px-2 py-1.5 font-mono text-[10px] text-indigo-600">{intg.info}</p>
                    )}
                    <button
                      onClick={() => handleIntegrationAction(intg)}
                      className={cn(
                        'mt-3 flex w-full items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                        currentStatus === 'connected'
                          ? 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                          : currentStatus === 'pending'
                            ? 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      )}
                    >
                      {currentStatus === 'connected' ? 'Configurar' : currentStatus === 'pending' ? 'Completar demo' : 'Conectar'}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </SectionCard>
        </div>

        <aside className="space-y-5">
          <SectionCard title="Modo demo" description="Entorno funcional con datos mock">
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                  <Wifi className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-900">Prototipo funcional activo</p>
                  <p className="mt-1 text-xs leading-5 text-blue-700">
                    Todas las acciones son visuales o simuladas. No se persisten cambios entre sesiones y no hay llamadas reales a Supabase, n8n o Meta.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {[
                { icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />, label: 'IA demo activa' },
                { icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />, label: 'Mock data completo' },
                { icon: <AlertCircle className="h-3.5 w-3.5 text-amber-500" />, label: 'Sin persistencia real' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  {item.icon}
                  <span className="text-xs font-medium text-gray-700">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Button variant="secondary" size="sm" onClick={() => toast.info('Datos de demo restablecidos', { description: 'Todos los datos han vuelto al estado inicial visual.' })}>
                Restablecer datos
              </Button>
              <Button size="sm" onClick={() => toast.success('Solicitud registrada', { description: 'Siguiente fase recomendada: conectar Supabase Auth y tablas reales.' })}>
                Solicitar versión completa
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

          <SectionCard title="Siguiente fase técnica" description="Orden recomendado de conexión">
            <div className="space-y-2">
              {[
                { title: '1. Supabase Auth', desc: 'Login real y sesión persistente.' },
                { title: '2. Tablas CRM', desc: 'clients, invoices, events, conversations.' },
                { title: '3. Webhooks n8n', desc: 'Reemplazar simulaciones por POST reales.' },
                { title: '4. Meta WhatsApp', desc: 'Canal real con permisos y número verificado.' },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-gray-100 bg-white p-3">
                  <p className="text-xs font-semibold text-gray-900">{item.title}</p>
                  <p className="mt-0.5 text-[11px] leading-5 text-gray-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </aside>
      </div>
    </div>
  )
}
