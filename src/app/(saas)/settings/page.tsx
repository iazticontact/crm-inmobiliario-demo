'use client'

import { useState } from 'react'
import { CheckCircle, AlertCircle, Globe, Mail, MessageSquare, Wifi, Shield, Bell, User, Building2, ChevronRight, Database, Zap, Copy, ExternalLink, RefreshCw, Play } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { simulateWhatsAppIncomingLead, supabaseStatus } from '@/lib/integrations'
import { cn } from '@/lib/utils'

type Integration = {
  id: string
  name: string
  description: string
  status: 'connected' | 'disconnected' | 'pending'
  icon: React.ReactNode
  info?: string
}

const integrations: Integration[] = [
  { id: 'whatsapp', name: 'WhatsApp Business', description: 'Recibe y envía mensajes desde tu número de negocio.', status: 'connected', icon: <MessageSquare className="h-5 w-5" />, info: '+34 612 345 678' },
  { id: 'instagram', name: 'Instagram Direct', description: 'Gestiona mensajes directos de Instagram desde NowCRM.', status: 'connected', icon: <Globe className="h-5 w-5" />, info: '@nowcrm.demo' },
  { id: 'email', name: 'Email (SMTP)', description: 'Envío de emails transaccionales y secuencias automáticas.', status: 'connected', icon: <Mail className="h-5 w-5" />, info: 'iazti.contact@gmail.com' },
  { id: 'web', name: 'Widget Web', description: 'Chat en vivo integrado en tu sitio web.', status: 'connected', icon: <Globe className="h-5 w-5" />, info: 'nowcrm-demo.vercel.app' },
  { id: 'stripe', name: 'Stripe Payments', description: 'Cobros automáticos y gestión de suscripciones.', status: 'pending', icon: <Shield className="h-5 w-5" /> },
  { id: 'slack', name: 'Slack', description: 'Notificaciones en tiempo real a tu equipo de trabajo.', status: 'disconnected', icon: <Bell className="h-5 w-5" /> },
]

const statusBadge = (status: Integration['status']) => {
  if (status === 'connected') return <Badge variant="success" dot>Conectado</Badge>
  if (status === 'pending') return <Badge variant="warning" dot>Pendiente</Badge>
  return <Badge variant="default" dot>Desconectado</Badge>
}

const notifDefaults = [
  { key: 'leads', label: 'Nuevos leads', description: 'Cuando un nuevo lead se registra desde cualquier canal', enabled: true },
  { key: 'invoices', label: 'Facturas vencidas', description: 'Alertas de facturas con pago pendiente', enabled: true },
  { key: 'dailyReport', label: 'Resumen diario IA', description: 'Reporte matutino con métricas del día anterior', enabled: true },
  { key: 'urgent', label: 'Conversaciones urgentes', description: 'Cuando la IA detecta sentimiento negativo crítico', enabled: false },
]

export default function SettingsPage() {
  const [notifications, setNotifications] = useState<Record<string, boolean>>(
    Object.fromEntries(notifDefaults.map((n) => [n.key, n.enabled]))
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
    await new Promise((r) => setTimeout(r, 1000))
    setTestingN8n(false)
    toast.success('Webhook de prueba enviado', { description: `POST → ${n8nUrl}/webhook/test ✓` })
  }

  const copyToClipboard = (value: string, key: string) => {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
    toast.success('Copiado al portapapeles')
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader title="Configuración" description="Ajustes del workspace y las integraciones" />

      {/* Workspace */}
      <SectionCard title="Workspace" description="Información general de tu cuenta NowCRM">
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-gray-50">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-xl font-bold text-white shadow-sm">
                N
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">NowCRM Demo</p>
                <p className="text-xs text-gray-500">iazti.contact@gmail.com</p>
              </div>
            </div>
            <Badge variant="indigo">Plan Pro</Badge>
          </div>

          {[
            { label: 'Nombre del workspace', value: 'NowCRM Demo', icon: <Building2 className="h-4 w-4" /> },
            { label: 'Email de administrador', value: 'iazti.contact@gmail.com', icon: <Mail className="h-4 w-4" /> },
            { label: 'Zona horaria', value: 'Europe/Madrid (UTC+2)', icon: <Globe className="h-4 w-4" /> },
            { label: 'Idioma', value: 'Español', icon: <User className="h-4 w-4" /> },
          ].map(({ label, value, icon }) => (
            <div key={label} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="text-gray-400">{icon}</span>
                <div>
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-sm font-medium text-gray-900">{value}</p>
                </div>
              </div>
              <button
                onClick={() => toast.info(`Editando: ${label}`, { description: 'Editor de ajustes próximamente.' })}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
              >
                Editar
              </button>
            </div>
          ))}

          <div className="pt-2">
            <Button variant="secondary" size="sm" onClick={() => toast.success('Cambios guardados', { description: 'La configuración se ha actualizado correctamente.' })}>
              Guardar cambios
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Supabase */}
      <SectionCard
        title="Supabase"
        description="Base de datos y autenticación"
        action={
          <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
            Supabase Console
            <ExternalLink className="h-3 w-3" />
          </a>
        }
      >
        <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <Database className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-900">Pendiente de conectar</p>
            <p className="text-[11px] text-amber-700 mt-0.5">Añade las variables de entorno en <span className="font-mono">.env.local</span> para activar la persistencia de datos.</p>
          </div>
        </div>

        <div className="space-y-3">
          {[
            { key: 'NEXT_PUBLIC_SUPABASE_URL', value: supabaseStatus.projectUrl, label: 'Project URL' },
            { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', label: 'Anon Key' },
          ].map(({ key, value, label }) => (
            <div key={key} className="rounded-lg bg-gray-50 border border-gray-100 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
                <button
                  onClick={() => copyToClipboard(key, key)}
                  className="flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
                >
                  <Copy className="h-3 w-3" />
                  {copiedKey === key ? 'Copiado' : 'Copiar variable'}
                </button>
              </div>
              <p className="text-[11px] font-mono text-gray-700 truncate">{key}</p>
              <p className="text-[10px] font-mono text-gray-400 truncate mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => toast.info('Guía de configuración', { description: 'Consulta la documentación de Supabase para más detalles.' })}>
            Ver documentación
          </Button>
          <Button size="sm" onClick={() => toast.success('Comprobando conexión...', { description: 'Verifica tus variables de entorno en .env.local' })}>
            Verificar conexión
          </Button>
        </div>
      </SectionCard>

      {/* n8n */}
      <SectionCard
        title="n8n Webhooks"
        description="Automatizaciones externas y flujos de trabajo"
        action={
          <a href="https://n8n.io" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
            Abrir n8n
            <ExternalLink className="h-3 w-3" />
          </a>
        }
      >
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-700 mb-1.5">URL base de tu instancia n8n</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={n8nUrl}
              onChange={(e) => setN8nUrl(e.target.value)}
              className="h-9 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
            />
            <Button size="sm" variant="secondary" loading={testingN8n} onClick={handleTestN8n}>
              <RefreshCw className="h-3.5 w-3.5" />
              Probar
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {[
            { label: 'Nuevo lead recibido', path: '/webhook/new-lead', active: true },
            { label: 'Pago registrado', path: '/webhook/payment', active: true },
            { label: 'Cita agendada', path: '/webhook/appointment', active: false },
            { label: 'Factura vencida', path: '/webhook/invoice-overdue', active: true },
          ].map((wh) => (
            <div key={wh.path} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5">
              <div className={cn('h-2 w-2 rounded-full shrink-0', wh.active ? 'bg-emerald-400' : 'bg-gray-300')} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800">{wh.label}</p>
                <p className="text-[10px] font-mono text-gray-400 truncate">{n8nUrl}{wh.path}</p>
              </div>
              <Badge variant={wh.active ? 'success' : 'default'}>{wh.active ? 'Activo' : 'Inactivo'}</Badge>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* WhatsApp simulation */}
      <SectionCard title="WhatsApp Business" description="Configuración y simulación del canal">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
            <MessageSquare className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">+34 612 345 678</p>
              <Badge variant="success" dot>Conectado</Badge>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">WhatsApp Business API · Modo demo simulado</p>
          </div>
        </div>

        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 mb-4">
          <p className="text-xs font-semibold text-indigo-900 mb-1">Simular lead entrante</p>
          <p className="text-[11px] text-indigo-700">Genera un lead de prueba via WhatsApp para ver cómo funciona el flujo completo de captación.</p>
        </div>

        <Button size="sm" loading={simulatingWA} onClick={handleSimulateWA}>
          <Play className="h-3.5 w-3.5" />
          {simulatingWA ? 'Simulando...' : 'Simular lead de WhatsApp'}
        </Button>
      </SectionCard>

      {/* Integrations */}
      <SectionCard title="Integraciones" description="Canales y servicios conectados a tu workspace">
        <div className="space-y-2">
          {integrations.map((intg) => (
            <div
              key={intg.id}
              className={cn(
                'flex items-center justify-between rounded-xl border p-4 transition-colors',
                intg.status === 'connected' ? 'border-gray-100 bg-gray-50' : 'border-gray-100 bg-white'
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg',
                  intg.status === 'connected' ? 'bg-white border border-gray-200 text-gray-600 shadow-sm' : 'bg-gray-100 text-gray-400'
                )}>
                  {intg.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{intg.name}</p>
                    {statusBadge(intg.status)}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{intg.description}</p>
                  {intg.info && intg.status === 'connected' && (
                    <p className="text-[10px] font-mono text-indigo-600 mt-0.5">{intg.info}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {intg.status === 'connected' ? (
                  <button
                    onClick={() => toast.info(`${intg.name} configurado`, { description: 'Todas las funciones están activas.' })}
                    className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Configurar
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                ) : intg.status === 'pending' ? (
                  <button
                    onClick={() => toast.success(`Configurando ${intg.name}...`, { description: 'Serás redirigido al proceso de autorización.' })}
                    className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    Completar
                  </button>
                ) : (
                  <button
                    onClick={() => toast.success(`Conectando ${intg.name}...`, { description: 'Serás redirigido al proceso de autorización.' })}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                  >
                    Conectar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Notifications */}
      <SectionCard title="Notificaciones" description="Configura qué alertas quieres recibir">
        <div className="space-y-3">
          {notifDefaults.map(({ key, label, description }) => (
            <div key={key} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
              <div>
                <p className="text-sm font-medium text-gray-900">{label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
              </div>
              <button
                onClick={() => toggleNotif(key)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                  notifications[key] ? 'bg-indigo-600' : 'bg-gray-200'
                )}
              >
                <span className={cn('pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform', notifications[key] ? 'translate-x-4' : 'translate-x-0')} />
              </button>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Demo mode */}
      <SectionCard title="Modo demo" description="Ajustes del entorno de demostración">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
              <Wifi className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-900">Prototipo funcional activo</p>
              <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                Estás usando NowCRM en modo demo con datos de ejemplo. Todas las funciones están disponibles para exploración. Los cambios no se persisten entre sesiones.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-xs text-blue-800">IA activa</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-xs text-blue-800">Sin límites</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs text-blue-800">Sin persistencia</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => toast.info('Datos de demo restablecidos', { description: 'Todos los datos han vuelto al estado inicial.' })}>
            Restablecer datos
          </Button>
          <Button size="sm" onClick={() => toast.success('¡Gracias por usar NowCRM!', { description: 'Contacta con nosotros para activar la versión completa.' })}>
            Solicitar versión completa
          </Button>
        </div>
      </SectionCard>
    </div>
  )
}
