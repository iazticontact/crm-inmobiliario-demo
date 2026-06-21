'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Users,
  Users as UsersIcon,
  Euro,
  Inbox,
  Calendar as CalendarIcon,
  FileText,
  Building2,
  Activity as ActivityIcon,
  Plus,
  ArrowRight,
  MessageSquare,
  Phone,
  Mail,
  Star,
  AlertTriangle,
  Bot,
} from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { featureFlags } from '@/lib/feature-flags'
import type { Activity as CRMActivity, ActivityType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DEMO_MODE_KEY, useCurrentUser } from '@/lib/current-user'
import {
  getActivities,
  getCalendarEvents,
  getClients,
  getConversations,
  getInvoices,
  getWorkspaceContext,
  listTasks,
} from '@/lib/supabase-queries'
import { listOpportunities, listServiceCases, listProperties } from '@/lib/vertical-queries'
import {
  clients as demoClients,
  invoices as demoInvoices,
  calendarEvents as demoCalendarEvents,
  conversations as demoConversations,
  recentActivity as demoActivity,
} from '@/lib/mock-data'
import { demoOpportunities, demoServiceCases, demoProperties, demoTasks } from '@/lib/demo/demo-real-estate'

type RealStats = {
  totalClients: number
  leads: number
  activeClients: number
  revenue: number
  pendingAmount: number
  pendingInvoices: number
  upcomingEvents: number
  externalConversations: number
  unreadConversations: number
  opportunitiesOpen: number
  pipelineValue: number
  casesActive: number
  casesDocsPending: number
  propertiesActive: number
  tasksOpen: number
}

const activityIcons: Record<ActivityType, React.ReactNode> = {
  deal: <Star className="h-3.5 w-3.5 text-indigo-600" />,
  message: <MessageSquare className="h-3.5 w-3.5 text-blue-500" />,
  email: <Mail className="h-3.5 w-3.5 text-violet-500" />,
  call: <Phone className="h-3.5 w-3.5 text-emerald-500" />,
  note: <FileText className="h-3.5 w-3.5 text-gray-500" />,
}

const activityBg: Record<ActivityType, string> = {
  deal: 'bg-indigo-50',
  message: 'bg-blue-50',
  email: 'bg-violet-50',
  call: 'bg-emerald-50',
  note: 'bg-gray-100',
}

function formatEuro(value: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}

function formatDateShort(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

type MetricTileProps = {
  label: string
  value: string
  detail?: string
  icon: React.ReactNode
  href?: string
  tone?: 'indigo' | 'emerald' | 'amber' | 'sky' | 'violet' | 'slate'
}

const TONE_STYLES: Record<NonNullable<MetricTileProps['tone']>, string> = {
  indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  sky: 'bg-sky-50 text-sky-600 ring-sky-100',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100',
  slate: 'bg-gray-50 text-gray-600 ring-gray-100',
}

function MetricTile({ label, value, detail, icon, href, tone = 'indigo' }: MetricTileProps) {
  const inner = (
    <div className="rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm shadow-gray-950/[0.03] transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.04]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold text-gray-900">{value}</p>
        </div>
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl ring-1', TONE_STYLES[tone])}>{icon}</div>
      </div>
      {detail && (
        <p className="mt-3 text-xs text-gray-500">{detail}</p>
      )}
    </div>
  )

  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { currentUser, isLoading: userLoading } = useCurrentUser()
  const [activity, setActivity] = useState<CRMActivity[]>([])
  const [stats, setStats] = useState<RealStats | null>(null)
  const [upcoming, setUpcoming] = useState<{ id: string; title: string; startAt?: string; clientName?: string; type?: string }[]>([])
  const [hotLeads, setHotLeads] = useState<{ id: string; name: string; status: string; leadScore: number; company?: string }[]>([])
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setLoadError('')

      // Demo mode: construir KPIs y listas desde datos mock inmobiliarios, sin Supabase.
      if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
        if (cancelled) return
        const openOpps = demoOpportunities.filter((o) => o.stage !== 'won' && o.stage !== 'lost')
        const activeCases = demoServiceCases.filter((c) => c.status !== 'resolved' && c.status !== 'closed')
        const activeProps = demoProperties.filter((p) => p.status !== 'archived' && p.status !== 'sold')
        const waConvs = demoConversations.filter((c) => String(c.channel ?? '').toLowerCase() === 'whatsapp')
        const nowIso = new Date().toISOString()
        const up = demoCalendarEvents
          .filter((e) => `${e.date}T00:00:00.000Z` >= nowIso)
          .slice(0, 5)
          .map((e) => ({ id: e.id, title: e.title, startAt: undefined as string | undefined, clientName: e.clientName, type: e.type }))
        setStats({
          totalClients: demoClients.length,
          leads: demoClients.filter((c) => c.status === 'lead').length,
          activeClients: demoClients.filter((c) => c.status === 'active').length,
          revenue: demoInvoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0),
          pendingAmount: demoInvoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.amount, 0),
          pendingInvoices: demoInvoices.filter((i) => i.status !== 'paid').length,
          upcomingEvents: up.length,
          externalConversations: waConvs.length,
          unreadConversations: waConvs.filter((c) => c.unread).length,
          opportunitiesOpen: openOpps.length,
          pipelineValue: openOpps.reduce((s, o) => s + (o.value ?? 0), 0),
          casesActive: activeCases.length,
          casesDocsPending: demoServiceCases.filter((c) => c.status === 'documentation_pending').length,
          propertiesActive: activeProps.length,
          tasksOpen: demoTasks.filter((t) => t.status !== 'done' && t.status !== 'completed' && t.status !== 'closed').length,
        })
        setActivity(demoActivity)
        setUpcoming(up)
        setHotLeads(
          [...demoClients]
            .filter((c) => c.status === 'lead' || c.status === 'active')
            .sort((a, b) => b.leadScore - a.leadScore)
            .slice(0, 5)
            .map((c) => ({ id: c.id, name: c.name, status: c.status, leadScore: c.leadScore, company: c.company })),
        )
        setLoading(false)
        return
      }

      try {
        const context = await getWorkspaceContext()
        const workspaceId = context?.workspace?.id || context?.profile?.workspace_id
        if (!workspaceId) {
          if (cancelled) return
          setStats(null)
          setActivity([])
          setUpcoming([])
          setHotLeads([])
          setLoadError('Tu cuenta aún no tiene workspace asignado. Contacta con el responsable interno.')
          return
        }

        const [clients, invoices, events, conversations, activities, opps, cases, properties, tasks] = await Promise.all([
          getClients(workspaceId),
          getInvoices(workspaceId).catch(() => []),
          getCalendarEvents(workspaceId).catch(() => []),
          getConversations(workspaceId).catch(() => []),
          getActivities(workspaceId).catch(() => [] as CRMActivity[]),
          listOpportunities(workspaceId).catch(() => []),
          listServiceCases(workspaceId).catch(() => []),
          listProperties(workspaceId).catch(() => []),
          listTasks(workspaceId).catch(() => []),
        ])

        if (cancelled) return

        // Vista cliente WhatsApp-only: solo contamos conversaciones cuyo canal
        // es explícitamente 'whatsapp'. Email/Instagram/Web/CRM no cuentan.
        const isWhatsAppConv = (c: { channel?: string | null }) => {
          return String(c.channel ?? '').trim().toLowerCase() === 'whatsapp'
        }
        const externalConvs = conversations.filter(isWhatsAppConv)
        const nowIso = new Date().toISOString()
        const upcomingEvents = events
          .filter((event) => (event.startAt ?? `${event.date}T00:00:00.000Z`) >= nowIso && event.status !== 'cancelled')
          .slice(0, 5)
          .map((event) => ({ id: event.id, title: event.title, startAt: event.startAt, clientName: event.clientName, type: event.type }))

        const openOpps = opps.filter((o) => o.stage !== 'won' && o.stage !== 'lost' && o.stage !== 'closed')
        const activeCases = cases.filter((c) => c.status !== 'resolved' && c.status !== 'closed')
        const activeProperties = properties.filter((p) => p.status !== 'archived' && p.status !== 'sold')

        const top = [...clients]
          .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
          .slice(0, 5)
          .map((c) => ({ id: c.id, name: c.name, status: c.status, leadScore: c.leadScore, company: c.company === 'No consta' ? '' : c.company }))

        setStats({
          totalClients: clients.length,
          leads: clients.filter((c) => c.status === 'lead').length,
          activeClients: clients.filter((c) => c.status === 'active').length,
          revenue: invoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + i.amount, 0),
          pendingAmount: invoices.filter((i) => i.status !== 'paid').reduce((sum, i) => sum + i.amount, 0),
          pendingInvoices: invoices.filter((i) => i.status !== 'paid').length,
          upcomingEvents: upcomingEvents.length,
          externalConversations: externalConvs.length,
          unreadConversations: externalConvs.filter((c) => c.unread).length,
          opportunitiesOpen: openOpps.length,
          pipelineValue: openOpps.reduce((sum, o) => sum + (o.value ?? 0), 0),
          casesActive: activeCases.length,
          casesDocsPending: cases.filter((c) => c.status === 'documentation_pending').length,
          propertiesActive: activeProperties.length,
          tasksOpen: tasks.filter((t) => t.status !== 'done' && t.status !== 'completed' && t.status !== 'closed').length,
        })
        // El feed del dashboard es la "home" del producto: dejamos fuera el ruido
        // de borrados (p. ej. "Cliente eliminado: …"), que queda en el detalle/log
        // pero no aporta a la vista de estado del negocio.
        setActivity(activities.filter((a) => !/\b(elimin|borrad)/i.test(String(a.description ?? ''))))
        setUpcoming(upcomingEvents)
        setHotLeads(top)
      } catch {
        if (cancelled) return
        setStats(null)
        setActivity([])
        setUpcoming([])
        setHotLeads([])
        setLoadError('No se pudo cargar el resumen del workspace. Vuelve a intentarlo en unos segundos.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 6) return 'Buenas noches'
    if (h < 13) return 'Buenos días'
    if (h < 21) return 'Buenas tardes'
    return 'Buenas noches'
  }, [])

  const isEmpty = !!stats && stats.totalClients === 0 && stats.upcomingEvents === 0 && stats.pendingInvoices === 0 && stats.opportunitiesOpen === 0 && stats.casesActive === 0 && stats.propertiesActive === 0

  const handleNewClient = () => {
    router.push('/clients')
    toast.info('Crea el nuevo cliente desde la sección de Clientes.')
  }

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-950">
              {greeting}, {userLoading ? '…' : currentUser.name || currentUser.workspaceName}
            </h2>
            <Badge variant={userLoading ? 'default' : currentUser.isDemo ? 'indigo' : 'success'} dot>
              {userLoading ? 'Cargando' : currentUser.isDemo ? 'Modo demo' : 'Workspace activo'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Resumen del día: clientes, citas y expedientes del workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {featureFlags.assistant && (
            <Button variant="secondary" size="sm" onClick={() => router.push('/assistant')}>
              <Bot className="h-3.5 w-3.5" />
              Copiloto
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => router.push('/calendar')}>
            <CalendarIcon className="h-3.5 w-3.5" />
            Calendario
          </Button>
          <Button size="sm" onClick={handleNewClient}>
            <Plus className="h-3.5 w-3.5" />
            Nuevo cliente
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      {/* Top KPIs — datos reales, sin tendencias fabricadas */}
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Clientes"
          value={stats ? String(stats.totalClients) : loading ? '…' : '0'}
          detail={stats ? (stats.totalClients === 0 ? 'Sin clientes todavía' : `${stats.leads} leads · ${stats.activeClients} activos`) : undefined}
          icon={<Users className="h-5 w-5" />}
          href="/clients"
          tone="indigo"
        />
        <MetricTile
          label="Eventos próximos"
          value={stats ? String(stats.upcomingEvents) : loading ? '…' : '0'}
          detail={stats ? (stats.upcomingEvents === 0 ? 'Agenda libre' : 'Visitas y reuniones confirmadas') : undefined}
          icon={<CalendarIcon className="h-5 w-5" />}
          href="/calendar"
          tone="sky"
        />
        {/* Cobros (facturación) y WhatsApp/Inbox no tienen backend real todavía
            (no hay invoices/conversations tables). Se ocultan al cliente y solo
            aparecen con NOWLABS_INTERNAL para no prometer módulos inexistentes. */}
        {process.env.NEXT_PUBLIC_NOWLABS_INTERNAL === 'true' && (
          <>
            <MetricTile
              label="Cobros pendientes"
              value={stats ? formatEuro(stats.pendingAmount) : loading ? '…' : formatEuro(0)}
              detail={stats ? (stats.pendingInvoices === 0 ? 'Sin facturas pendientes' : `${stats.pendingInvoices} factura(s) abiertas`) : undefined}
              icon={<Euro className="h-5 w-5" />}
              tone="amber"
            />
            <MetricTile
              label="WhatsApp"
              value={stats ? String(stats.externalConversations) : loading ? '…' : '0'}
              detail={stats ? (stats.externalConversations === 0 ? 'Sin conversaciones de WhatsApp todavía' : `${stats.unreadConversations} sin leer`) : undefined}
              icon={<Inbox className="h-5 w-5" />}
              href="/inbox"
              tone="emerald"
            />
          </>
        )}
      </div>

      {/* Snapshot operativo */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          href="/opportunities"
          className="group rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/70 to-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-violet-600 shadow-sm ring-1 ring-violet-100">
              <FileText className="h-4 w-4" />
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-violet-400 transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-2 text-sm font-semibold text-gray-900">Expedientes abiertos</p>
          <p className="text-[11px] text-gray-500">
            {stats
              ? stats.casesActive === 0
                ? 'Sin expedientes abiertos'
                : `${stats.casesActive} abiertos${stats.casesDocsPending ? ` · ${stats.casesDocsPending} esperando docs` : ''}`
              : 'Cargando…'}
          </p>
        </Link>

        <Link
          href="/opportunities"
          className="group rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50/70 to-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sky-600 shadow-sm ring-1 ring-sky-100">
              <Building2 className="h-4 w-4" />
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-sky-400 transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-2 text-sm font-semibold text-gray-900">Propiedades en cartera</p>
          <p className="text-[11px] text-gray-500">
            {stats
              ? stats.propertiesActive === 0
                ? 'Sin propiedades activas todavía'
                : `${stats.propertiesActive} activas en gestión`
              : 'Cargando…'}
          </p>
        </Link>

        <Link
          href="/clients"
          className="group rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm ring-1 ring-indigo-100">
              <UsersIcon className="h-4 w-4" />
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-indigo-400 transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-2 text-sm font-semibold text-gray-900">Clientes activos</p>
          <p className="text-[11px] text-gray-500">
            {stats
              ? stats.activeClients === 0
                ? 'Sin clientes activos todavía'
                : `${stats.activeClients} activos · ${stats.leads} leads`
              : 'Cargando…'}
          </p>
        </Link>
      </div>

      {/* Próximos eventos + leads calientes */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <SectionCard
          title="Próximas citas"
          description="Visitas, llamadas y reuniones programadas"
          action={<Link href="/calendar" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver calendario</Link>}
        >
          {upcoming.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-500">
              No hay citas programadas en el calendario. Crea una visita o reunión desde Calendario o desde la ficha del cliente.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {upcoming.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{event.title}</p>
                    <p className="truncate text-[11px] text-gray-500">
                      {[formatDateShort(event.startAt), event.clientName, event.type].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Badge variant="indigo">{event.type ?? 'cita'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Clientes recientes"
          description="Últimas altas del workspace"
        >
          {hotLeads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-500">
              Aún no hay clientes recientes. Crea un cliente para empezar a organizar los datos.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {hotLeads.map((lead) => {
                const statusLabel =
                  lead.status === 'active' ? 'Activo' :
                  lead.status === 'lead' ? 'Lead' :
                  lead.status === 'inactive' ? 'Inactivo' :
                  lead.status === 'churned' ? 'Perdido' : lead.status
                return (
                  <li key={lead.id} className="flex items-center justify-between gap-3 py-2.5">
                    <button onClick={() => router.push(`/clients/${lead.id}`)} className="flex min-w-0 items-start gap-3 text-left">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-50 to-sky-50 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-100">
                        {lead.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 hover:text-indigo-600">{lead.name}</p>
                        <p className="truncate text-[11px] text-gray-500">{lead.company || 'Sin empresa'}</p>
                      </div>
                    </button>
                    <Badge variant={lead.status === 'active' ? 'success' : 'indigo'}>{statusLabel}</Badge>
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Actividad reciente */}
      <SectionCard
        title="Actividad reciente"
        description="Últimas acciones registradas en el workspace"
        action={
          stats && stats.tasksOpen > 0 ? (
            <Badge variant="indigo">{stats.tasksOpen} tareas pendientes</Badge>
          ) : (
            <Badge variant="default">Sin tareas</Badge>
          )
        }
      >
        {activity.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-500">
            {isEmpty
              ? 'El workspace está vacío. A medida que añadas clientes, citas o expedientes, irá apareciendo aquí.'
              : 'Sin actividad reciente todavía.'}
          </div>
        ) : (
          <ul className="space-y-1">
            {activity.map((item) => (
              <li key={item.id} className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-indigo-50/40">
                <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${activityBg[item.type]}`}>
                  {activityIcons[item.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-relaxed text-gray-700">{item.description}</p>
                  {item.clientName && <p className="text-[10px] text-gray-400">{item.clientName}</p>}
                </div>
                <span className="shrink-0 whitespace-nowrap text-[10px] text-gray-400">{item.timestamp}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {isEmpty && !loadError && (
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 ring-1 ring-indigo-100">
              <ActivityIcon className="h-4 w-4" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">Tu workspace está listo. Empieza por crear el primer cliente.</p>
              <p className="mt-1 text-xs text-gray-500">
                A medida que crees clientes, citas y expedientes, este panel se irá rellenando con los datos reales de tu inmobiliaria.
              </p>
              <Button size="sm" className="mt-3" onClick={handleNewClient}>
                <Plus className="h-3.5 w-3.5" />
                Crear primer cliente
              </Button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
