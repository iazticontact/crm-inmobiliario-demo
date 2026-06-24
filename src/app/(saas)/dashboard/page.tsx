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
  PieChart,
  CheckCircle2,
  RefreshCw,
  Building2,
  Coins,
  Home,
} from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { containsBlockedText } from '@/lib/text-safety'
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
import { commStateOf, commStateLabel, type CommState } from '@/lib/demo/vertical-templates'
import { buildDashboardSnapshot, type SnapshotInput, type DashboardSnapshot } from '@/lib/dashboard-snapshot'

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

// Embudo por ESTADO COMERCIAL abierto (coherente con Cartera: 5 estados). Solo abiertos:
// Nueva · En gestión · Reserva (Vendida/Alquilada y Perdida quedan fuera del embudo).
const OPEN_FUNNEL_STATES: { key: CommState; label: string; color: string }[] = [
  { key: 'new', label: 'Nueva', color: '#6366f1' },
  { key: 'managing', label: 'En gestión', color: '#8b5cf6' },
  { key: 'reserved', label: 'Reserva', color: '#f59e0b' },
]
const STAGE_COLORS: Record<string, string> = Object.fromEntries(OPEN_FUNNEL_STATES.map((s) => [s.key, s.color]))

function buildPipeline(openOpps: { stage: string; value: number | null }[]): PipelineStage[] {
  return OPEN_FUNNEL_STATES.map((s) => {
    const rows = openOpps.filter((o) => commStateOf(o.stage) === s.key)
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
    <div className="group relative h-full overflow-hidden rounded-2xl border border-gray-200/70 bg-white px-4 py-3.5 shadow-sm shadow-gray-950/[0.03] transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.05]">
      <span className={cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-80', TONE_BAR[tone])} aria-hidden />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
          <p className="mt-1 text-[1.7rem] font-bold leading-none tracking-tight text-gray-900">{value}</p>
        </div>
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1', TONE_STYLES[tone])}>{icon}</div>
      </div>
      {detail && (
        <p className="mt-1.5 truncate text-xs text-gray-500">{detail}</p>
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

// Importe compacto para el funnel (€150k en vez de €150.000) — más legible en
// poco espacio.
function compactEuro(value: number) {
  if (value >= 1000) return `€${Math.round(value / 1000)}k`
  return `€${Math.round(value)}`
}

// "Week rail": 7 tiles compactos (mini calendario) con recuento de citas y
// tareas por día. Tiles clicables → calendario; resalta hoy y el siguiente día
// con actividad. No usa barras altas → no queda vacío/feo cuando hay poco.
function WeekRail({ days }: { days: WeekDay[] }) {
  const nextActiveIdx = days.findIndex((d, i) => i > 0 && d.events + d.tasks > 0)
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map((d, i) => {
        const total = d.events + d.tasks
        const isToday = i === 0
        const isNextActive = i === nextActiveIdx
        return (
          <Link
            key={`${d.label}-${i}`}
            href="/calendar"
            title={d.tooltip}
            className={cn(
              'group relative flex flex-col items-center gap-0.5 overflow-hidden rounded-xl border px-0.5 py-1.5 transition-all hover:-translate-y-0.5 hover:shadow-sm',
              isToday ? 'border-indigo-200 bg-indigo-50/70'
                : total > 0 ? 'border-gray-200 bg-white'
                : 'border-gray-100 bg-gray-50/40',
            )}
          >
            {total > 0 && !isToday && (
              <span className={cn('absolute inset-x-0 top-0 h-0.5', isNextActive ? 'bg-indigo-400' : 'bg-gray-200')} aria-hidden />
            )}
            <span className={cn('text-[10px] font-semibold', isToday ? 'text-indigo-600' : 'text-gray-400')}>{d.label}</span>
            <span className={cn('text-sm font-bold leading-none tabular-nums', isToday ? 'text-indigo-700' : 'text-gray-900')}>{d.dayNum}</span>
            <div className="flex min-h-[22px] flex-col items-center justify-center gap-0.5">
              {d.events > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-sky-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />{d.events}
                </span>
              )}
              {d.tasks > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{d.tasks}
                </span>
              )}
              {total === 0 && <span className="text-[11px] leading-none text-gray-300">·</span>}
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// "Resumen comercial": estado de las OPERACIONES ABIERTAS por etapa. Cabecera con
// total de operaciones + valor potencial en cartera (nunca facturación), y una
// fila por etapa (clicable → /opportunities) con barra proporcional al valor (o al
// número si no hay valor), recuento y valor. Pensado para que en 2s se entienda qué
// muestra y dónde está el valor potencial de la cartera.
function OpportunityFunnel({ stages, totalCount, totalValue }: { stages: PipelineStage[]; totalCount: number; totalValue: number }) {
  const active = stages.filter((s) => s.count > 0)
  const byValue = active.some((s) => s.value > 0)
  const max = Math.max(1, ...active.map((s) => (byValue ? s.value : s.count)))
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[1.6rem] font-bold leading-none tabular-nums text-gray-900">{totalCount}</p>
          <p className="mt-1 text-[11px] font-medium text-gray-500">Operaciones abiertas</p>
        </div>
        {totalValue > 0 && (
          <div className="text-right">
            <p className="text-lg font-bold leading-none tabular-nums text-gray-900">{formatEuro(totalValue)}</p>
            <p className="mt-1 text-[11px] font-medium text-gray-500">Valor potencial en cartera</p>
          </div>
        )}
      </div>
      <ul className="space-y-0.5 border-t border-gray-100 pt-2.5">
        {active.map((s) => {
          const metric = byValue ? s.value : s.count
          const pct = Math.max(6, Math.round((metric / max) * 100))
          const share = totalValue > 0 && s.value > 0
            ? Math.round((s.value / totalValue) * 100)
            : totalCount > 0 ? Math.round((s.count / totalCount) * 100) : 0
          const color = STAGE_COLORS[s.stage] ?? '#94a3b8'
          return (
            <li key={s.stage}>
              <Link
                href="/opportunities"
                title={`${s.label} · ${s.count} operación(es)${s.value > 0 ? ` · ${formatEuro(s.value)}` : ''} · ${share}% de la cartera`}
                className="flex items-center gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-gray-50"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="w-16 shrink-0 truncate text-[11px] font-medium text-gray-600">{s.label}</span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
                <span className="w-4 shrink-0 text-right text-xs font-bold tabular-nums text-gray-800">{s.count}</span>
                <span className="w-14 shrink-0 text-right text-[10px] font-medium tabular-nums text-gray-400">{s.value > 0 ? compactEuro(s.value) : '—'}</span>
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="text-[10px] leading-snug text-gray-400">Valor potencial estimado si se cierran · no es facturación.</p>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { currentUser, isLoading: userLoading } = useCurrentUser()
  const [activity, setActivity] = useState<CRMActivity[]>([])
  const [stats, setStats] = useState<RealStats | null>(null)
  const [upcoming, setUpcoming] = useState<{ id: string; title: string; startAt?: string; clientName?: string; type?: string }[]>([])
  const [pipeline, setPipeline] = useState<PipelineStage[]>([])
  const [weekActivity, setWeekActivity] = useState<WeekDay[]>([])
  const [urgentTask, setUrgentTask] = useState<UrgentTask | null>(null)
  const [reviewOp, setReviewOp] = useState<ReviewOp | null>(null)
  // Datos crudos ya cargados → snapshot derivado (cartera/comisiones/vencimientos) sin re-fetch.
  const [raw, setRaw] = useState<Omit<SnapshotInput, 'todayStr'> | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  // Freshness: el dashboard carga datos frescos en cada montaje/navegación (las
  // queries corren en useEffect). `reloadKey` permite un refresco manual SILENCIOSO
  // (botón "Actualizar") sin volver a mostrar el esqueleto: mantenemos los datos
  // actuales en pantalla y solo los reemplazamos al llegar los nuevos. No usamos
  // refetch al foco de ventana a propósito (evita el lag de S6/S7).
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      // Solo mostramos el esqueleto completo en la carga inicial; los refrescos
      // manuales son silenciosos (refreshing) y conservan los datos visibles.
      if (reloadKey === 0) setLoading(true)
      else setRefreshing(true)
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
          .filter((e) => `${e.date}T00:00:00.000Z` >= nowIso && !containsBlockedText(e.title, e.clientName))
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
        setActivity(demoActivity.filter((a) => !containsBlockedText(a.description, a.clientName)))
        setUpcoming(up)
        setPipeline(buildPipeline(openOpps))
        setWeekActivity(buildNext7Days(demoCalendarEvents, openTasks))
        setUrgentTask(pickUrgentTask(openTasks))
        setReviewOp(pickReviewOp(openOpps))
        setRaw({
          properties: demoProperties as SnapshotInput['properties'],
          opportunities: demoOpportunities as SnapshotInput['opportunities'],
          cases: demoServiceCases as SnapshotInput['cases'],
          tasks: demoTasks as SnapshotInput['tasks'],
          events: demoCalendarEvents as SnapshotInput['events'],
          clients: demoClients.map((c) => ({ id: c.id, name: c.name })),
        })
        setLoading(false)
        setRefreshing(false)
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
          setPipeline([])
          setWeekActivity([])
          setUrgentTask(null)
          setReviewOp(null)
          setRaw(null)
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
          .filter((event) => (event.startAt ?? `${event.date}T00:00:00.000Z`) >= nowIso && event.status !== 'cancelled' && !containsBlockedText(event.title, event.clientName))
          .slice(0, 5)
          .map((event) => ({ id: event.id, title: event.title, startAt: event.startAt, clientName: event.clientName, type: event.type }))

        const openOpps = opps.filter((o) => o.stage !== 'won' && o.stage !== 'lost' && o.stage !== 'closed')
        const activeCases = cases.filter((c) => c.status !== 'resolved' && c.status !== 'closed')
        const activeProperties = properties.filter((p) => p.status !== 'archived' && p.status !== 'sold')
        const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'completed' && t.status !== 'closed')
        const nowMs = Date.now()

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
        // de borrados (p. ej. "Cliente eliminado: …") y, defensivamente, cualquier
        // texto inapropiado que alguien haya tecleado (red de seguridad además del
        // saneado del dato; ver text-safety + migración 20260621_p34).
        setActivity(activities.filter((a) =>
          !/\b(elimin|borrad)/i.test(String(a.description ?? '')) && !containsBlockedText(a.description, a.clientName),
        ))
        setUpcoming(upcomingEvents)
        setPipeline(buildPipeline(openOpps))
        setWeekActivity(buildNext7Days(events, openTasks))
        setUrgentTask(pickUrgentTask(openTasks))
        setReviewOp(pickReviewOp(openOpps))
        setRaw({
          properties: properties as SnapshotInput['properties'],
          opportunities: opps as SnapshotInput['opportunities'],
          cases: cases as SnapshotInput['cases'],
          tasks: tasks as SnapshotInput['tasks'],
          events: events as SnapshotInput['events'],
          clients: clients.map((c) => ({ id: c.id, name: c.name })),
        })
      } catch {
        if (cancelled) return
        setStats(null)
        setActivity([])
        setUpcoming([])
        setPipeline([])
        setWeekActivity([])
        setUrgentTask(null)
        setReviewOp(null)
        setRaw(null)
        setLoadError('No se pudo cargar el resumen del workspace. Vuelve a intentarlo en unos segundos.')
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [reloadKey])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 6) return 'Buenas noches'
    if (h < 13) return 'Buenos días'
    if (h < 21) return 'Buenas tardes'
    return 'Buenas noches'
  }, [])

  const todayStr = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  // Snapshot derivado (cartera/operaciones por estado/comisiones/vencimientos/citas de hoy).
  const snap: DashboardSnapshot | null = useMemo(() => (raw ? buildDashboardSnapshot({ ...raw, todayStr }) : null), [raw, todayStr])

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
  const weekTotals = weekActivity.reduce((acc, d) => ({ events: acc.events + d.events, tasks: acc.tasks + d.tasks }), { events: 0, tasks: 0 })
  const todayLabel = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-3 pb-2"
    >
      {/* Hero compacto — cabecera tipo "centro de mando" del CRM */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-white px-4 py-3 shadow-sm sm:px-5 sm:py-3.5">
        <div
          className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-indigo-100/50 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-gray-950 sm:text-2xl">
                {greeting}, {userLoading ? '…' : currentUser.name || currentUser.workspaceName}
              </h2>
              <Badge variant={userLoading ? 'default' : currentUser.isDemo ? 'indigo' : 'success'} dot>
                {userLoading ? 'Cargando' : currentUser.isDemo ? 'Entorno de ejemplo' : 'Cuenta activa'}
              </Badge>
            </div>
            <p className="mt-0.5 text-[13px] text-gray-500">
              Tu resumen comercial de hoy · <span className="font-medium text-gray-400">{todayLabel}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={refreshing || loading}
              title="Actualizar datos"
              aria-label="Actualizar datos"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            </Button>
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
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <MetricTile
          label="Clientes activos"
          value={stats ? String(stats.activeClients) : loading ? '…' : '0'}
          detail={stats ? (stats.totalClients === 0 ? 'Sin clientes todavía' : `${stats.totalClients} en total`) : undefined}
          icon={<Users className="h-5 w-5" />}
          href="/clients"
          tone="indigo"
        />
        <MetricTile
          label="Inmuebles activos"
          value={snap ? String(snap.cartera.active) : loading ? '…' : '0'}
          detail={snap ? (snap.cartera.history > 0 ? `${snap.cartera.history} en histórico` : snap.cartera.active ? 'En cartera' : 'Sin inmuebles') : undefined}
          icon={<Building2 className="h-5 w-5" />}
          href="/opportunities"
          tone="sky"
        />
        <MetricTile
          label="Operaciones abiertas"
          value={stats ? String(stats.opportunitiesOpen) : loading ? '…' : '0'}
          detail={stats ? (stats.opportunitiesOpen === 0 ? 'Sin operaciones' : stats.pipelineValue > 0 ? `${formatEuro(stats.pipelineValue)} potencial` : 'En seguimiento') : undefined}
          icon={<FileText className="h-5 w-5" />}
          href="/opportunities"
          tone="violet"
        />
        <MetricTile
          label="Citas de hoy"
          value={snap ? String(snap.todayEvents.length) : loading ? '…' : '0'}
          detail={snap ? (snap.todayEvents.length === 0 ? (nextEvent ? `Próxima: ${formatDateShort(nextEvent.startAt)}` : 'Agenda libre') : 'Programadas para hoy') : undefined}
          icon={<CalendarIcon className="h-5 w-5" />}
          href="/calendar"
          tone="emerald"
        />
        <MetricTile
          label="Trámites urgentes"
          value={snap ? String(snap.deadlines.filter((d) => d.kind === 'case').length) : loading ? '…' : '0'}
          detail={snap ? ((() => { const o = snap.deadlines.filter((d) => d.kind === 'case' && d.days < 0).length; return o > 0 ? `${o} vencido${o === 1 ? '' : 's'}` : 'Sin vencimientos próximos' })()) : undefined}
          icon={<Clock className="h-5 w-5" />}
          href="/opportunities"
          tone="amber"
        />
        <MetricTile
          label="Comisiones pendientes"
          value={snap ? (snap.commissions.pendiente > 0 ? formatEuro(snap.commissions.pendiente) : '—') : loading ? '…' : '—'}
          detail={snap ? (snap.commissions.prevista > 0 ? `de ${formatEuro(snap.commissions.prevista)} prevista` : 'Control interno') : undefined}
          icon={<Coins className="h-5 w-5" />}
          href="/opportunities"
          tone="amber"
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
          {/* Banda ejecutiva — Resumen comercial (embudo) · Semana operativa */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Resumen comercial"
              description="Operaciones comerciales en seguimiento · valor potencial"
              action={<Link href="/opportunities" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver operaciones</Link>}
              bodyClassName="p-4"
            >
              {pipelineTotal > 0 ? (
                <OpportunityFunnel stages={pipeline} totalCount={pipelineTotal} totalValue={stats.pipelineValue} />
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
                  <PieChart className="mb-2 h-6 w-6 text-gray-300" />
                  <p className="text-sm font-medium text-gray-700">Sin operaciones abiertas</p>
                  <p className="mt-1 text-xs text-gray-500">Las operaciones que abras (ventas y alquileres en seguimiento) aparecerán aquí por estado, con su valor potencial.</p>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Semana operativa"
              description="Citas y tareas · próximos 7 días"
              action={<Link href="/calendar" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver agenda</Link>}
              bodyClassName="p-4"
            >
              {weekHasData ? (
                <div className="space-y-3">
                  <WeekRail days={weekActivity} />
                  <div className="flex items-center justify-center gap-5 border-t border-gray-100 pt-3 text-[11px] font-medium text-gray-600">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" />{weekTotals.events} cita{weekTotals.events === 1 ? '' : 's'}</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />{weekTotals.tasks} tarea{weekTotals.tasks === 1 ? '' : 's'}</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center">
                  <CalendarIcon className="mb-2 h-6 w-6 text-gray-300" />
                  <p className="text-sm font-medium text-gray-700">Semana despejada</p>
                  <p className="mt-1 text-xs text-gray-500">No hay citas ni tareas en los próximos 7 días.</p>
                </div>
              )}
            </SectionCard>
          </div>

          {/* Banda de cartera y comisiones */}
          {snap && (
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard
                title="Cartera inmobiliaria"
                description="Inmuebles activos por estado · histórico aparte"
                action={<Link href="/opportunities" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver inmuebles</Link>}
                bodyClassName="p-4"
              >
                {snap.cartera.active + snap.cartera.history > 0 ? (
                  <div className="space-y-2.5">
                    {[
                      { label: 'Publicado', count: snap.cartera.published, color: 'bg-emerald-500' },
                      { label: 'Reservado', count: snap.cartera.reserved, color: 'bg-amber-500' },
                      { label: 'En preparación', count: snap.cartera.prep, color: 'bg-indigo-500' },
                    ].map((s) => {
                      const pct = snap.cartera.active > 0 ? Math.round((s.count / snap.cartera.active) * 100) : 0
                      return (
                        <div key={s.label} className="flex items-center gap-2.5">
                          <span className="w-24 shrink-0 text-[11px] font-medium text-gray-600">{s.label}</span>
                          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500', s.color)} style={{ width: `${s.count > 0 ? Math.max(6, pct) : 0}%` }} />
                          </div>
                          <span className="w-5 text-right text-xs font-bold tabular-nums text-gray-800">{s.count}</span>
                        </div>
                      )
                    })}
                    <div className="flex items-center justify-between border-t border-gray-100 pt-2.5 text-[11px]">
                      <span className="text-gray-500"><span className="font-semibold text-gray-800">{snap.cartera.active}</span> activos · {snap.cartera.history} en histórico</span>
                      <span className="font-semibold text-gray-700">{formatEuro(snap.cartera.activeValue)} en cartera activa</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-7 text-center">
                    <Home className="mb-2 h-6 w-6 text-gray-300" />
                    <p className="text-sm font-medium text-gray-700">Sin inmuebles en cartera</p>
                    <p className="mt-1 text-xs text-gray-500">Registra tu primer inmueble para empezar a gestionar tu cartera.</p>
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Comisiones"
                description="Control interno · operaciones cerradas"
                action={<Link href="/opportunities" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver comisiones</Link>}
                bodyClassName="p-4"
              >
                {snap.commissions.closedWithCommission > 0 ? (
                  <div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Prevista', value: snap.commissions.prevista, tone: 'border-teal-100 bg-teal-50/50 text-teal-700' },
                        { label: 'Pendiente', value: snap.commissions.pendiente, tone: 'border-amber-100 bg-amber-50/50 text-amber-700' },
                        { label: 'Cobrada', value: snap.commissions.cobrada, tone: 'border-emerald-100 bg-emerald-50/50 text-emerald-700' },
                      ].map((c) => (
                        <div key={c.label} className={cn('rounded-xl border px-2.5 py-2', c.tone)}>
                          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{c.label}</p>
                          <p className="mt-0.5 text-sm font-bold text-gray-900">{c.value > 0 ? formatEuro(c.value) : '—'}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2.5 text-[10px] leading-snug text-gray-400">
                      {snap.commissions.closedWithCommission} operación{snap.commissions.closedWithCommission === 1 ? '' : 'es'} cerrada{snap.commissions.closedWithCommission === 1 ? '' : 's'} con comisión. La facturación fiscal, gastos e impuestos se gestionarán en el módulo económico.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-7 text-center">
                    <Coins className="mb-2 h-6 w-6 text-gray-300" />
                    <p className="text-sm font-medium text-gray-700">Sin comisiones cerradas</p>
                    <p className="mt-1 text-xs text-gray-500">Cuando cierres una venta o alquiler con comisión pactada, aparecerá aquí.</p>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {/* Banda operativa — Hoy · Vencimientos críticos · Actividad reciente */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SectionCard title="Hoy" description="Lo más inmediato" bodyClassName="p-4">
              {hasTodayItems ? (
                <div className="space-y-2">
                  {nextEvent && (
                    <Link
                      href="/calendar"
                      className="group flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-2.5 transition-colors hover:border-sky-100 hover:bg-sky-50/40"
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
                    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-2.5">
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
                      className="group flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-2.5 transition-colors hover:border-violet-100 hover:bg-violet-50/40"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600">Operación a revisar</p>
                        <p className="truncate text-sm font-semibold text-gray-900">{reviewOp.title}</p>
                        <p className="truncate text-[11px] text-gray-500">
                          {[commStateLabel(reviewOp.stage), reviewOp.value ? formatEuro(reviewOp.value) : null].filter(Boolean).join(' · ')}
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

            <SectionCard
              title="Vencimientos críticos"
              description="Trámites y tareas por vencer o vencidos"
              action={snap && snap.deadlinesOverdue > 0 ? <Badge variant="warning" dot>{snap.deadlinesOverdue} vencido{snap.deadlinesOverdue === 1 ? '' : 's'}</Badge> : undefined}
              bodyClassName="p-4"
            >
              {snap && snap.deadlines.length > 0 ? (
                <ul className="space-y-1.5">
                  {snap.deadlines.slice(0, 5).map((d) => {
                    const overdue = d.days < 0
                    const dueLabel = overdue ? (d.days === -1 ? 'venció ayer' : `venció hace ${-d.days} días`) : d.days === 0 ? 'vence hoy' : d.days === 1 ? 'vence mañana' : `vence en ${d.days} días`
                    const inner = (
                      <div className="group flex items-start gap-2.5 rounded-xl border border-gray-100 bg-white p-2.5 transition-colors hover:border-gray-200 hover:bg-gray-50/60">
                        <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg', d.kind === 'case' ? 'bg-violet-50 text-violet-600' : 'bg-indigo-50 text-indigo-600')}>
                          {d.kind === 'case' ? <FileText className="h-3.5 w-3.5" /> : <ListChecks className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-gray-900">{d.title}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px]">
                            <span className={cn('font-medium', overdue ? 'text-rose-600' : d.days <= 1 ? 'text-amber-600' : 'text-gray-500')}>{dueLabel}</span>
                            {d.subtitle && <><span className="text-gray-300">·</span><span className="max-w-[150px] truncate text-gray-500">{d.subtitle}</span></>}
                          </div>
                        </div>
                        {d.href && <ArrowRight className="mt-1 h-3 w-3 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5" />}
                      </div>
                    )
                    return d.href
                      ? <li key={d.id}><Link href={d.href} className="group block">{inner}</Link></li>
                      : <li key={d.id} className="group">{inner}</li>
                  })}
                  {snap.deadlines.length > 5 && <li className="px-1 pt-0.5 text-center text-[10px] font-medium text-gray-400">y {snap.deadlines.length - 5} más</li>}
                </ul>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
                  <CheckCircle2 className="mb-2 h-6 w-6 text-emerald-500" />
                  <p className="text-sm font-medium text-gray-700">Sin vencimientos próximos</p>
                  <p className="mt-1 text-xs text-gray-500">No hay trámites ni tareas por vencer en los próximos días.</p>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Actividad reciente"
              action={stats && stats.tasksOpen > 0 ? <Badge variant="indigo">{stats.tasksOpen} tareas</Badge> : <Badge variant="default">Al día</Badge>}
              bodyClassName="p-4"
            >
              {activity.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-500">Sin actividad reciente todavía.</div>
              ) : (
                <ul className="space-y-0.5">
                  {activity.slice(0, 4).map((item) => (
                    <li key={item.id} className="flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-indigo-50/40">
                      <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${activityBg[item.type]}`}>
                        {activityIcons[item.type]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-gray-700">{item.description}</p>
                        {item.clientName && <p className="truncate text-[10px] text-gray-400">{item.clientName}</p>}
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-[10px] text-gray-400">{item.timestamp}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
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
                <span className="mt-0.5 block text-[11px] text-gray-500">Abre una operación y avanza por sus etapas.</span>
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
