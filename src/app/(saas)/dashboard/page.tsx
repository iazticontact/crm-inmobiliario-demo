'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Users,
  Euro,
  Inbox,
  Calendar as CalendarIcon,
  FileText,
  Plus,
  ArrowRight,
  MessageSquare,
  Phone,
  Mail,
  Star,
  AlertTriangle,
  Bot,
  Sparkles,
  Clock,
  ListChecks,
  BarChart3,
  Target,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { MiniColumns } from '@/components/charts/MiniColumns'
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
  tasksOverdue: number
}

// Estructuras normalizadas para los bloques "Hoy", "Prioridades" y el mini
// gráfico de pipeline. Las calculamos igual en modo demo y modo real, así que el
// JSX no depende de la forma cruda de cada fuente.
type PipelineStage = { stage: string; label: string; count: number; value: number }
type WeekDay = { label: string; dayNum: number; events: number; tasks: number; tooltip: string }
type UrgentTask = { id: string; title: string; dueDate?: string; clientName?: string; priority: string }
type ReviewOp = { id: string; title: string; stage: string; value: number | null }
type PriorityRow = { key: string; label: string; count: number; href?: string; hint?: string; icon: React.ReactNode }

// Orden y etiquetas del pipeline (mismas claves que usa el agente en
// deterministic-db-actions.ts). Solo etapas ABIERTAS (won/lost quedan fuera).
const PIPELINE_ORDER: { key: string; label: string }[] = [
  { key: 'new', label: 'Nuevo' },
  { key: 'contacted', label: 'Contactado' },
  { key: 'qualified', label: 'Cualificado' },
  { key: 'visit_scheduled', label: 'Visita' },
  { key: 'offer', label: 'Oferta' },
  { key: 'negotiation', label: 'Negociación' },
]
const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  [...PIPELINE_ORDER.map((s) => [s.key, s.label]), ['won', 'Ganada'], ['lost', 'Perdida'], ['closed', 'Cerrada']],
)

function buildPipeline(openOpps: { stage: string; value: number | null }[]): PipelineStage[] {
  return PIPELINE_ORDER.map((s) => {
    const rows = openOpps.filter((o) => o.stage === s.key)
    return {
      stage: s.key,
      label: s.label,
      count: rows.length,
      value: rows.reduce((sum, o) => sum + (o.value ?? 0), 0),
    }
  })
}

// "Próximos 7 días": citas y tareas con fecha dentro de la ventana [hoy, hoy+6].
// Solo bucketea registros que ya tienen fecha (sin inventar); los sin fecha o
// fuera de ventana no cuentan. Funciona igual en demo (events con .date) y real
// (events con .startAt). Cancelados excluidos.
const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
function buildNext7Days(
  events: { startAt?: string | null; date?: string | null; status?: string | null }[],
  openTasks: { due_date?: string | null }[],
): WeekDay[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const counts = Array.from({ length: 7 }, () => ({ events: 0, tasks: 0 }))
  const indexFor = (iso?: string | null) => {
    if (!iso) return -1
    const ms = Date.parse(iso)
    if (Number.isNaN(ms)) return -1
    const day = new Date(ms)
    day.setHours(0, 0, 0, 0)
    const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000)
    return diff >= 0 && diff < 7 ? diff : -1
  }
  for (const e of events) {
    if (e.status === 'cancelled') continue
    const i = indexFor(e.startAt ?? e.date)
    if (i >= 0) counts[i].events += 1
  }
  for (const t of openTasks) {
    const i = indexFor(t.due_date)
    if (i >= 0) counts[i].tasks += 1
  }
  return counts.map((c, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const label = i === 0 ? 'Hoy' : WEEKDAY_LABELS[d.getDay()]
    return {
      label,
      dayNum: d.getDate(),
      events: c.events,
      tasks: c.tasks,
      tooltip: `${label} ${d.getDate()} · ${c.events} cita(s) · ${c.tasks} tarea(s)`,
    }
  })
}

function pickUrgentTask(
  openTasks: { id: string; title: string; due_date?: string | null; client_name?: string | null; priority: string }[],
): UrgentTask | null {
  if (openTasks.length === 0) return null
  const sorted = [...openTasks].sort((a, b) => {
    const da = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY
    const db = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY
    return da - db
  })
  const t = sorted[0]
  return { id: t.id, title: t.title, dueDate: t.due_date ?? undefined, clientName: t.client_name ?? undefined, priority: t.priority }
}

function pickReviewOp(openOpps: { id: string; title: string; stage: string; value: number | null }[]): ReviewOp | null {
  if (openOpps.length === 0) return null
  // La operación "a revisar" = la de mayor valor en el pipeline abierto (la que
  // más mueve el negocio). Sin inventar nada: solo ordena lo que ya existe.
  const sorted = [...openOpps].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const o = sorted[0]
  return { id: o.id, title: o.title, stage: o.stage, value: o.value }
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

// Acento superior por tono: una línea fina de color que da más "presencia" a la
// KPI card sin recargar (no fondo de color sólido).
const TONE_BAR: Record<NonNullable<MetricTileProps['tone']>, string> = {
  indigo: 'from-indigo-400 to-violet-400',
  emerald: 'from-emerald-400 to-teal-400',
  amber: 'from-amber-400 to-orange-400',
  sky: 'from-sky-400 to-indigo-400',
  violet: 'from-violet-400 to-fuchsia-400',
  slate: 'from-gray-300 to-gray-400',
}

function MetricTile({ label, value, detail, icon, href, tone = 'indigo' }: MetricTileProps) {
  const inner = (
    <div className="group relative h-full overflow-hidden rounded-2xl border border-gray-200/70 bg-white p-5 shadow-sm shadow-gray-950/[0.03] transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.05]">
      <span className={cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-80', TONE_BAR[tone])} aria-hidden />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
          <p className="mt-1.5 text-[1.7rem] font-bold leading-none tracking-tight text-gray-900">{value}</p>
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1', TONE_STYLES[tone])}>{icon}</div>
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
  const [pipeline, setPipeline] = useState<PipelineStage[]>([])
  const [weekActivity, setWeekActivity] = useState<WeekDay[]>([])
  const [urgentTask, setUrgentTask] = useState<UrgentTask | null>(null)
  const [reviewOp, setReviewOp] = useState<ReviewOp | null>(null)
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
        const nowMs = Date.now()
        const openTasks = demoTasks.filter((t) => t.status !== 'done' && t.status !== 'completed' && t.status !== 'closed')
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
          tasksOpen: openTasks.length,
          tasksOverdue: openTasks.filter((t) => t.due_date && Date.parse(t.due_date) < nowMs).length,
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
        setPipeline(buildPipeline(openOpps))
        setWeekActivity(buildNext7Days(demoCalendarEvents, openTasks))
        setUrgentTask(pickUrgentTask(openTasks))
        setReviewOp(pickReviewOp(openOpps))
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
          setPipeline([])
          setWeekActivity([])
          setUrgentTask(null)
          setReviewOp(null)
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
        const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'completed' && t.status !== 'closed')
        const nowMs = Date.now()

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
          tasksOpen: openTasks.length,
          tasksOverdue: openTasks.filter((t) => t.due_date && Date.parse(t.due_date) < nowMs).length,
        })
        // El feed del dashboard es la "home" del producto: dejamos fuera el ruido
        // de borrados (p. ej. "Cliente eliminado: …"), que queda en el detalle/log
        // pero no aporta a la vista de estado del negocio.
        setActivity(activities.filter((a) => !/\b(elimin|borrad)/i.test(String(a.description ?? ''))))
        setUpcoming(upcomingEvents)
        setHotLeads(top)
        setPipeline(buildPipeline(openOpps))
        setWeekActivity(buildNext7Days(events, openTasks))
        setUrgentTask(pickUrgentTask(openTasks))
        setReviewOp(pickReviewOp(openOpps))
      } catch {
        if (cancelled) return
        setStats(null)
        setActivity([])
        setUpcoming([])
        setHotLeads([])
        setPipeline([])
        setWeekActivity([])
        setUrgentTask(null)
        setReviewOp(null)
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

  // Derivados de presentación (sin queries): qué enseñar en "Hoy", el total del
  // pipeline para decidir empty state del gráfico y las prioridades con datos.
  const nextEvent = upcoming[0]
  const hasTodayItems = Boolean(nextEvent || urgentTask || reviewOp)
  const pipelineTotal = pipeline.reduce((sum, p) => sum + p.count, 0)
  const weekHasData = weekActivity.some((d) => d.events + d.tasks > 0)
  const todayLabel = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  const priorities: PriorityRow[] = stats
    ? [
        { key: 'ops', label: 'Operaciones abiertas', count: stats.opportunitiesOpen, href: '/opportunities', icon: <FileText className="h-4 w-4" /> },
        { key: 'tasks', label: 'Tareas pendientes', count: stats.tasksOpen, hint: stats.tasksOverdue > 0 ? `${stats.tasksOverdue} vencida${stats.tasksOverdue === 1 ? '' : 's'}` : undefined, icon: <ListChecks className="h-4 w-4" /> },
        { key: 'docs', label: 'Expedientes esperando docs', count: stats.casesDocsPending, href: '/opportunities', icon: <Clock className="h-4 w-4" /> },
        { key: 'events', label: 'Citas próximas', count: stats.upcomingEvents, href: '/calendar', icon: <CalendarIcon className="h-4 w-4" /> },
      ].filter((p) => p.count > 0)
    : []

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      {/* Hero — cabecera tipo "centro operativo" del CRM */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-white p-5 shadow-sm sm:p-6">
        <div
          className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-indigo-100/50 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-gray-950 sm:text-[1.7rem]">
                {greeting}, {userLoading ? '…' : currentUser.name || currentUser.workspaceName}
              </h2>
              <Badge variant={userLoading ? 'default' : currentUser.isDemo ? 'indigo' : 'success'} dot>
                {userLoading ? 'Cargando' : currentUser.isDemo ? 'Modo demo' : 'Workspace activo'}
              </Badge>
            </div>
            <p className="mt-1.5 text-sm text-gray-600">Aquí tienes el estado de tu CRM hoy.</p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">{todayLabel}</p>
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
      </div>

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      {/* KPIs principales — datos reales, sin tendencias fabricadas */}
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Clientes activos"
          value={stats ? String(stats.activeClients) : loading ? '…' : '0'}
          detail={stats ? (stats.totalClients === 0 ? 'Sin clientes todavía' : `${stats.totalClients} en total · ${stats.leads} leads`) : undefined}
          icon={<Users className="h-5 w-5" />}
          href="/clients"
          tone="indigo"
        />
        <MetricTile
          label="Operaciones abiertas"
          value={stats ? String(stats.opportunitiesOpen) : loading ? '…' : '0'}
          detail={stats ? (stats.opportunitiesOpen === 0 ? 'Sin operaciones abiertas' : stats.pipelineValue > 0 ? `${formatEuro(stats.pipelineValue)} en pipeline` : 'En curso') : undefined}
          icon={<FileText className="h-5 w-5" />}
          href="/opportunities"
          tone="violet"
        />
        <MetricTile
          label="Tareas pendientes"
          value={stats ? String(stats.tasksOpen) : loading ? '…' : '0'}
          detail={stats ? (stats.tasksOpen === 0 ? 'Todo al día' : stats.tasksOverdue > 0 ? `${stats.tasksOverdue} vencida${stats.tasksOverdue === 1 ? '' : 's'}` : 'Pendientes de completar') : undefined}
          icon={<ListChecks className="h-5 w-5" />}
          tone="amber"
        />
        <MetricTile
          label="Próximas citas"
          value={stats ? String(stats.upcomingEvents) : loading ? '…' : '0'}
          detail={stats ? (stats.upcomingEvents === 0 ? 'Agenda libre' : nextEvent ? `Próxima: ${[formatDateShort(nextEvent.startAt), nextEvent.type].filter(Boolean).join(' · ') || nextEvent.title}` : 'Programadas') : undefined}
          icon={<CalendarIcon className="h-5 w-5" />}
          href="/calendar"
          tone="sky"
        />
      </div>

      {/* KPIs internos (facturación/WhatsApp): sin backend real → solo build de
          operador, nunca al cliente, para no prometer módulos inexistentes. */}
      {process.env.NEXT_PUBLIC_NOWLABS_INTERNAL === 'true' && (
        <div className="grid gap-4 grid-cols-2">
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
        </div>
      )}

      {/* Centro operativo — solo con datos (demo o real). Vacío → onboarding. */}
      {!loadError && stats && !isEmpty && (
        <>
          {/* Hoy + Prioridades */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Hoy" description="Lo más inmediato ahora mismo">
              {hasTodayItems ? (
                <div className="space-y-2.5">
                  {nextEvent && (
                    <Link
                      href="/calendar"
                      className="group flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 transition-colors hover:border-sky-100 hover:bg-sky-50/40"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 ring-1 ring-sky-100">
                        <CalendarIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-600">Próxima cita</p>
                        <p className="truncate text-sm font-semibold text-gray-900">{nextEvent.title}</p>
                        <p className="truncate text-[11px] text-gray-500">
                          {[formatDateShort(nextEvent.startAt), nextEvent.clientName].filter(Boolean).join(' · ') || 'Programada'}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  )}
                  {urgentTask && (
                    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-100">
                        <ListChecks className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Tarea urgente</p>
                        <p className="truncate text-sm font-semibold text-gray-900">{urgentTask.title}</p>
                        <p className="truncate text-[11px] text-gray-500">
                          {[urgentTask.dueDate ? `Vence ${formatDateShort(urgentTask.dueDate)}` : null, urgentTask.clientName].filter(Boolean).join(' · ') || 'Sin fecha límite'}
                        </p>
                      </div>
                    </div>
                  )}
                  {reviewOp && (
                    <Link
                      href="/opportunities"
                      className="group flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 transition-colors hover:border-violet-100 hover:bg-violet-50/40"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600">Operación a revisar</p>
                        <p className="truncate text-sm font-semibold text-gray-900">{reviewOp.title}</p>
                        <p className="truncate text-[11px] text-gray-500">
                          {[STAGE_LABELS[reviewOp.stage] ?? reviewOp.stage, reviewOp.value ? formatEuro(reviewOp.value) : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
                  <CheckCircle2 className="mb-2 h-6 w-6 text-emerald-500" />
                  <p className="text-sm font-medium text-gray-700">Nada urgente para hoy</p>
                  <p className="mt-1 text-xs text-gray-500">No tienes citas, tareas ni operaciones que revisar ahora mismo.</p>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Prioridades" description="Lo que necesita tu atención">
              {priorities.length > 0 ? (
                <ul className="space-y-1.5">
                  {priorities.map((p) => {
                    const row = (
                      <div className="group flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5 transition-colors hover:border-indigo-100 hover:bg-indigo-50/40">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500 ring-1 ring-gray-100">{p.icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-800">{p.label}</p>
                          {p.hint && <p className="text-[11px] font-medium text-amber-600">{p.hint}</p>}
                        </div>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-700">{p.count}</span>
                        {p.href && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5" />}
                      </div>
                    )
                    return <li key={p.key}>{p.href ? <Link href={p.href} className="block">{row}</Link> : row}</li>
                  })}
                </ul>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
                  <Target className="mb-2 h-6 w-6 text-indigo-400" />
                  <p className="text-sm font-medium text-gray-700">No hay prioridades pendientes</p>
                  <p className="mt-1 text-xs text-gray-500">Todo está al día. Aprovecha para añadir un cliente o planificar una cita.</p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <Button size="sm" variant="secondary" onClick={handleNewClient}><Plus className="h-3.5 w-3.5" />Nuevo cliente</Button>
                    <Button size="sm" variant="secondary" onClick={() => router.push('/calendar')}><CalendarIcon className="h-3.5 w-3.5" />Planificar cita</Button>
                  </div>
                </div>
              )}
            </SectionCard>
          </div>

          {/* Banda de analítica — dos mini gráficos (datos ya cargados) */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Pipeline por etapa"
              description="Operaciones abiertas por fase"
              action={<Link href="/opportunities" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver pipeline</Link>}
            >
              {pipelineTotal > 0 ? (
                <div className="space-y-3 pt-1">
                  <MiniColumns
                    data={pipeline.map((p) => ({
                      label: p.label,
                      tooltip: `${p.label}: ${p.count} oper.${p.value > 0 ? ` · ${formatEuro(p.value)}` : ''}`,
                      segments: [{ value: p.count, tone: 'indigo' as const }],
                    }))}
                  />
                  <div className="flex items-center justify-between border-t border-gray-100 pt-3 text-xs">
                    <span className="text-gray-500">{pipelineTotal} operación{pipelineTotal === 1 ? '' : 'es'} abierta{pipelineTotal === 1 ? '' : 's'}</span>
                    {stats && stats.pipelineValue > 0 && (
                      <span className="font-semibold text-gray-900">{formatEuro(stats.pipelineValue)} en pipeline</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
                  <BarChart3 className="mb-2 h-6 w-6 text-gray-300" />
                  <p className="text-sm font-medium text-gray-700">Sin operaciones abiertas</p>
                  <p className="mt-1 text-xs text-gray-500">Cuando registres operaciones, verás aquí el pipeline por etapa.</p>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Próximos 7 días"
              description="Citas y tareas por día"
              action={<Link href="/calendar" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver agenda</Link>}
            >
              {weekHasData ? (
                <div className="space-y-3 pt-1">
                  <MiniColumns
                    data={weekActivity.map((d) => ({
                      label: d.label,
                      tooltip: d.tooltip,
                      segments: [
                        { value: d.events, tone: 'sky' as const },
                        { value: d.tasks, tone: 'amber' as const },
                      ],
                    }))}
                  />
                  <div className="flex items-center justify-center gap-4 border-t border-gray-100 pt-3 text-[11px] text-gray-500">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" />Citas</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />Tareas</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
                  <CalendarIcon className="mb-2 h-6 w-6 text-gray-300" />
                  <p className="text-sm font-medium text-gray-700">Semana despejada</p>
                  <p className="mt-1 text-xs text-gray-500">No hay citas ni tareas con fecha en los próximos 7 días.</p>
                </div>
              )}
            </SectionCard>
          </div>

      {/* Próximas citas + clientes recientes */}
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
            {activity.slice(0, 5).map((item) => (
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
        </>
      )}

      {!loadError && stats && isEmpty && (
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 ring-1 ring-indigo-100">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Tu CRM está listo</p>
              <p className="mt-1 text-xs text-gray-500">
                Da los primeros pasos para empezar a trabajar con tus clientes y operaciones reales.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              onClick={handleNewClient}
              className="group flex items-start gap-3 rounded-xl border border-gray-200/70 bg-white p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                <Users className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  1. Añade tu primer cliente
                  <ArrowRight className="h-3 w-3 text-gray-300 transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="mt-0.5 block text-[11px] text-gray-500">Registra un contacto y empieza el seguimiento comercial.</span>
              </span>
            </button>

            <Link
              href="/opportunities"
              className="group flex items-start gap-3 rounded-xl border border-gray-200/70 bg-white p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                <FileText className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  2. Crea una operación
                  <ArrowRight className="h-3 w-3 text-gray-300 transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="mt-0.5 block text-[11px] text-gray-500">Abre una oportunidad y muévela por el pipeline.</span>
              </span>
            </Link>

            <Link
              href="/calendar"
              className="group flex items-start gap-3 rounded-xl border border-gray-200/70 bg-white p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 ring-1 ring-sky-100">
                <CalendarIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  3. Planifica una cita
                  <ArrowRight className="h-3 w-3 text-gray-300 transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="mt-0.5 block text-[11px] text-gray-500">Agenda una visita o reunión con un cliente.</span>
              </span>
            </Link>

            {featureFlags.assistant && (
              <Link
                href="/assistant"
                className="group flex items-start gap-3 rounded-xl border border-gray-200/70 bg-white p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                  <Bot className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                    4. Pregunta al copiloto
                    <ArrowRight className="h-3 w-3 text-gray-300 transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-0.5 block text-[11px] text-gray-500">Consulta el estado de tu CRM en lenguaje natural.</span>
                </span>
              </Link>
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}
