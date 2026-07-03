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
  CheckCircle2,
  Check,
  Loader2,
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
  updateTask,
} from '@/lib/supabase-queries'
import { listOpportunities, listServiceCases, listProperties } from '@/lib/vertical-queries'
import { loadInvoiceLinksForOpportunities } from '@/lib/invoicing/invoice-repo'
import { computeHonorarios } from '@/lib/invoicing/honorarios'
import { computeEconomicCycle, type EconomicCycle } from '@/lib/invoicing/economic-cycle'
import {
  clients as demoClients,
  invoices as demoInvoices,
  calendarEvents as demoCalendarEvents,
  conversations as demoConversations,
  recentActivity as demoActivity,
} from '@/lib/mock-data'
import { demoOpportunities, demoServiceCases, demoProperties, demoTasks } from '@/lib/demo/demo-real-estate'
import { commStateLabel, COMM_STATE_OPTIONS } from '@/lib/demo/vertical-templates'
import { buildDashboardSnapshot, PERIOD_OPTIONS, type SnapshotInput, type DashboardSnapshot, type PeriodKey } from '@/lib/dashboard-snapshot'
import { DonutChart } from '@/components/charts/DonutChart'
import { MiniBarChart } from '@/components/charts/MiniBarChart'
import { InfoTooltip } from '@/components/InfoTooltip'

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
  openOppsValue: number
  casesActive: number
  casesDocsPending: number
  propertiesActive: number
  tasksOpen: number
  tasksOverdue: number
}

// Estructuras normalizadas para los bloques "Hoy" y la semana operativa. Las calculamos igual en
// modo demo y modo real, así que el JSX no depende de la forma cruda de cada fuente.
type WeekDay = { label: string; dayNum: number; events: number; tasks: number; tooltip: string }
type UrgentTask = { id: string; title: string; dueDate?: string; clientName?: string; priority: string }
type ReviewOp = { id: string; title: string; stage: string; value: number | null }

// (El estado comercial de operaciones por estado se deriva del snapshot: snap.opsByState.)

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
  // La operación "a revisar" = la de mayor valor entre las operaciones abiertas (la que
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

// Humaniza el texto técnico de actividades antiguas (logs internos) para que el feed parezca premium:
// nada de "stage", "listed", "won/lost", inglés ni porcentajes de probabilidad legacy. Si no podemos
// reconstruirlo de forma fiable, lo compactamos a una etiqueta clara ("Operación actualizada"…).
const PROP_STATUS_ES: Record<string, string> = {
  listed: 'Publicado', available: 'Disponible', prospecting: 'En preparación',
  under_contract: 'Reservado', reserved: 'Reservado', sold: 'Vendido', rented: 'Alquilado', archived: 'Archivado',
}
const STAGE_ES: Record<string, string> = {
  new: 'Nueva', contacted: 'En gestión', qualified: 'En gestión', visit_scheduled: 'En gestión',
  negotiation: 'En gestión', proposal: 'En gestión', reserved: 'Reserva', won: 'Vendida', lost: 'Perdida',
}
const CASE_STATUS_ES: Record<string, string> = {
  open: 'Abierto', documentation_pending: 'Pendiente de documentación', in_review: 'En revisión',
  closed: 'Completado', resolved: 'Resuelto', cancelled: 'Cancelado',
}
function humanizeActivity(desc?: string | null): string {
  let s = (desc ?? '').trim()
  if (!s) return 'Actividad registrada'
  // Patrón legacy de edición de operación: "Stage won · 390000€ · 10%"
  const opEdit = s.match(/^stage\s+\w+\s*·\s*([\d.,]+)\s*€/i)
  if (opEdit) {
    const amt = Number(opEdit[1].replace(/[.,]/g, ''))
    return Number.isFinite(amt) && amt > 0 ? `Operación actualizada · ${formatEuro(amt)}` : 'Operación actualizada'
  }
  // Patrón legacy de edición de inmueble: "piso · venta · Valencia · listed" → conservamos el
  // contexto útil (tipo · operación · zona) y quitamos el estado técnico final en inglés.
  if (s.includes('·') && /(listed|available|prospecting|under_contract|reserved|sold|rented|archived)\s*\.?$/i.test(s)) {
    const parts = s.split('·').map((x) => x.trim()).filter(Boolean)
    const kept = parts.slice(0, -1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' · ')
    return kept ? `Inmueble actualizado: ${kept}` : 'Inmueble actualizado'
  }
  // Reemplazos de tokens sueltos dentro de frases ("… pasa a etapa won." / "… pasa a archived.").
  s = s.replace(/\betapa\s+(\w+)/gi, (_m, w: string) => STAGE_ES[w.toLowerCase()] ?? w)
  s = s.replace(/\b(listed|available|prospecting|under_contract|reserved|sold|rented|archived)\b/gi, (w) => PROP_STATUS_ES[w.toLowerCase()] ?? w)
  s = s.replace(/\b(documentation_pending|in_review|resolved|cancelled|closed|open)\b/gi, (w) => CASE_STATUS_ES[w.toLowerCase()] ?? w)
  s = s.replace(/\b(won|lost|negotiation|contacted|qualified|proposal|visit_scheduled)\b/gi, (w) => STAGE_ES[w.toLowerCase()] ?? w)
  // Quita "· NN%" (probabilidad legacy) y "Stage " sobrante.
  s = s.replace(/\s*·\s*\d{1,3}\s*%/g, '').replace(/\bstage\s+/gi, '')
  return s
}

// Textos de tooltips (control interno; sin facturación fiscal). Centralizados para mantener copy coherente.
const PERIOD_HINTS: Record<PeriodKey, string> = {
  month: 'Métricas cobradas y cerradas del mes actual.',
  quarter: 'Acumulado del trimestre actual.',
  semester: 'Acumulado del semestre actual.',
  year: 'Acumulado del año actual.',
  all: 'Histórico completo desde el inicio. La comisión cobrada es el total acumulado; cartera, pendiente y potencial reflejan el estado actual.',
}
const COMM_STATE_HINTS: Record<string, string> = {
  new: 'Operación recién creada, sin gestión todavía.',
  managing: 'Operación en gestión: contacto, visitas o negociación en curso.',
  reserved: 'Operación con reserva en firme, pendiente de cierre.',
  won: 'Operación cerrada: vendida o alquilada.',
  lost: 'Operación perdida o descartada.',
}

type MetricTileProps = {
  label: string
  value: string
  detail?: string
  icon: React.ReactNode
  href?: string
  hint?: string
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

function MetricTile({ label, value, detail, icon, href, hint, tone = 'indigo' }: MetricTileProps) {
  const inner = (
    <div title={hint} className="group relative h-full overflow-hidden rounded-2xl border border-gray-200/70 bg-white px-4 py-3.5 shadow-sm shadow-gray-950/[0.03] transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.05]">
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

// Tile económico compacto con variación opcional (↑/↓ vs periodo anterior) y tooltip de fórmula.
function EcoStat({ label, value, variation, hint, tone = 'gray' }: { label: string; value: string; variation?: number | null; hint?: string; tone?: 'emerald' | 'amber' | 'indigo' | 'gray' }) {
  const tones: Record<string, string> = {
    emerald: 'border-emerald-100 bg-emerald-50/50',
    amber: 'border-amber-100 bg-amber-50/50',
    indigo: 'border-indigo-100 bg-indigo-50/50',
    gray: 'border-gray-100 bg-gray-50/50',
  }
  return (
    <div className={cn('rounded-xl border px-2.5 py-2', tones[tone], hint && 'cursor-help')} title={hint}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-gray-900">{value}</p>
      {variation != null && (
        <p className={cn('text-[10px] font-semibold', variation >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
          {variation >= 0 ? '↑' : '↓'} {Math.abs(variation)}% vs anterior
        </p>
      )}
    </div>
  )
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


export default function DashboardPage() {
  const router = useRouter()
  const { currentUser, isLoading: userLoading } = useCurrentUser()
  const [activity, setActivity] = useState<CRMActivity[]>([])
  const [stats, setStats] = useState<RealStats | null>(null)
  const [upcoming, setUpcoming] = useState<{ id: string; title: string; startAt?: string; clientName?: string; type?: string }[]>([])
  const [weekActivity, setWeekActivity] = useState<WeekDay[]>([])
  const [urgentTask, setUrgentTask] = useState<UrgentTask | null>(null)
  const [reviewOp, setReviewOp] = useState<ReviewOp | null>(null)
  // Datos crudos ya cargados → snapshot derivado (cartera/comisiones/vencimientos) sin re-fetch.
  const [raw, setRaw] = useState<Omit<SnapshotInput, 'todayStr'> | null>(null)
  const [cycle, setCycle] = useState<EconomicCycle | null>(null)
  const [period, setPeriod] = useState<PeriodKey>('month')
  // Workspace activo (solo modo real) y tarea que se está completando desde "Vencimientos críticos".
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)
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
          openOppsValue: openOpps.reduce((s, o) => s + (o.value ?? 0), 0),
          casesActive: activeCases.length,
          casesDocsPending: demoServiceCases.filter((c) => c.status === 'documentation_pending').length,
          propertiesActive: activeProps.length,
          tasksOpen: openTasks.length,
          tasksOverdue: openTasks.filter((t) => t.due_date && Date.parse(t.due_date) < nowMs).length,
        })
        setActivity(demoActivity.filter((a) => !containsBlockedText(a.description, a.clientName)))
        setUpcoming(up)
        setWeekActivity(buildNext7Days(demoCalendarEvents, openTasks))
        setUrgentTask(pickUrgentTask(openTasks))
        setReviewOp(pickReviewOp(openOpps))
        setWorkspaceId(null) // modo demo: las acciones de completar se bloquean (no persiste)
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
          setWeekActivity([])
          setUrgentTask(null)
          setReviewOp(null)
          setRaw(null)
          setWorkspaceId(null)
          setLoadError('Tu cuenta aún no tiene workspace asignado. Contacta con el responsable interno.')
          return
        }
        setWorkspaceId(workspaceId)

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
          openOppsValue: openOpps.reduce((sum, o) => sum + (o.value ?? 0), 0),
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

        // Ciclo económico (honorarios): pendiente de facturar / facturado / cobrado, derivado de la factura
        // vinculada a cada operación. Base = comisión (computeHonorarios), nunca el precio del inmueble.
        const links: Record<string, { status?: string }> = await loadInvoiceLinksForOpportunities(workspaceId, opps.map((o) => o.id)).catch(() => ({}))
        const propsById: Record<string, { price?: number | null; operation_type?: string | null }> = Object.fromEntries(properties.map((p) => [p.id, p]))
        const ecoRows = opps.map((o) => {
          const p = o.property_id ? propsById[o.property_id] : undefined
          const isRental = p?.operation_type === 'alquiler' || p?.operation_type === 'alquiler_opcion_compra'
          const honorarios = computeHonorarios({ value: o.value ?? null, commissionRate: o.commission_rate ?? null, propertyPrice: p?.price ?? null, isRental, metadata: o.metadata ?? null })
          return { honorarios, closed: o.stage === 'won', invoiceStatus: links[o.id]?.status ?? null }
        })
        if (!cancelled) setCycle(computeEconomicCycle(ecoRows))
      } catch {
        if (cancelled) return
        setStats(null)
        setActivity([])
        setUpcoming([])
        setWeekActivity([])
        setUrgentTask(null)
        setReviewOp(null)
        setRaw(null)
        setWorkspaceId(null)
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
  const snap: DashboardSnapshot | null = useMemo(() => (raw ? buildDashboardSnapshot({ ...raw, todayStr, period }) : null), [raw, todayStr, period])

  const isEmpty = !!stats && stats.totalClients === 0 && stats.upcomingEvents === 0 && stats.pendingInvoices === 0 && stats.opportunitiesOpen === 0 && stats.casesActive === 0 && stats.propertiesActive === 0

  const handleNewClient = () => {
    router.push('/clients')
    toast.info('Crea el nuevo cliente desde la sección de Clientes.')
  }

  // Completar una tarea vencida/próxima directamente desde "Vencimientos críticos".
  // Optimista: marcamos la tarea como 'done' en los datos crudos (el snapshot recalcula y la quita
  // de la lista y del contador) y, si falla, revertimos y mostramos la causa real. Solo modo real.
  const handleCompleteDeadlineTask = async (rawId: string) => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo (no se guarda)')
      return
    }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    const prevRaw = raw
    const prevUrgent = urgentTask
    setCompletingId(rawId)
    setRaw((r) => (r ? { ...r, tasks: r.tasks.map((t) => (t.id === rawId ? { ...t, status: 'done' } : t)) } : r))
    setUrgentTask((u) => (u && u.id === rawId ? null : u))
    try {
      const updated = await updateTask(workspaceId, rawId, { status: 'done' })
      if (!updated) throw new Error('No se pudo guardar el cambio.')
      toast.success('Tarea completada')
    } catch (error) {
      setRaw(prevRaw) // rollback
      setUrgentTask(prevUrgent)
      toast.error('No se pudo completar la tarea', { description: error instanceof Error ? error.message : '' })
    } finally {
      setCompletingId(null)
    }
  }

  // Derivados de presentación (sin queries): qué enseñar en "Hoy", la actividad de
  // la semana y las prioridades con datos. (El estado comercial vive en el snapshot.)
  const nextEvent = upcoming[0]
  const hasTodayItems = Boolean(nextEvent || urgentTask || reviewOp)
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
                Asistente IA
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
        <div className="relative mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100/80 pt-2.5">
          <span className="flex items-center gap-1 text-[11px] font-medium text-gray-400">
            Vista:
            <InfoTooltip
              align="left"
              text="Filtra las métricas temporales (comisión cobrada, cerradas, variación). La cartera, el pendiente y el potencial siempre reflejan el estado actual. 'Todo' = histórico completo."
            />
          </span>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white/70 p-0.5 text-[11px] font-medium">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                title={PERIOD_HINTS[p.id]}
                className={cn('rounded-md px-2.5 py-1 transition-colors', period === p.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}
              >
                {p.label}
              </button>
            ))}
          </div>
          {snap && (
            <span className="text-[11px] text-gray-400">
              {period === 'all'
                ? <>· Comisión cobrada <span className="font-medium text-gray-400">histórica</span>: <span className="font-semibold text-gray-700">{formatEuro(snap.economics.cobradaPeriodo)}</span></>
                : <>· Comisión cobrada {snap.economics.periodLabel.toLowerCase()}: <span className="font-semibold text-gray-700">{formatEuro(snap.economics.cobradaPeriodo)}</span></>}
            </span>
          )}
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
          hint="Clientes con estado activo en tu cartera (total actual, no depende del periodo)."
          tone="indigo"
        />
        <MetricTile
          label="Inmuebles activos"
          value={snap ? String(snap.cartera.active) : loading ? '…' : '0'}
          detail={snap ? (snap.cartera.closed > 0 ? `${snap.cartera.closed} vendidos/alquilados` : snap.cartera.active ? 'En cartera' : 'Sin inmuebles') : undefined}
          icon={<Building2 className="h-5 w-5" />}
          href="/opportunities"
          hint={snap ? `Inmuebles gestionables ahora: en preparación, publicados o reservados. Total gestionados: ${snap.cartera.active + snap.cartera.history} (incluye vendidos/alquilados y archivados, que no cuentan en cartera activa).` : undefined}
          tone="sky"
        />
        <MetricTile
          label="Operaciones abiertas"
          value={stats ? String(stats.opportunitiesOpen) : loading ? '…' : '0'}
          detail={stats ? (stats.opportunitiesOpen === 0 ? 'Sin operaciones' : stats.openOppsValue > 0 ? `${formatEuro(stats.openOppsValue)} potencial` : 'En seguimiento') : undefined}
          icon={<FileText className="h-5 w-5" />}
          href="/opportunities"
          hint="Operaciones comerciales todavía no vendidas/alquiladas ni perdidas (estado actual)."
          tone="violet"
        />
        <MetricTile
          label="Citas de hoy"
          value={snap ? String(snap.todayEvents.length) : loading ? '…' : '0'}
          detail={snap ? (snap.todayEvents.length === 0 ? (nextEvent ? `Próxima: ${formatDateShort(nextEvent.startAt)}` : 'Agenda libre') : 'Programadas para hoy') : undefined}
          icon={<CalendarIcon className="h-5 w-5" />}
          href="/calendar"
          hint="Citas programadas para hoy (no canceladas)."
          tone="emerald"
        />
        <MetricTile
          label="Trámites urgentes"
          value={snap ? String(snap.deadlines.filter((d) => d.kind === 'case').length) : loading ? '…' : '0'}
          detail={snap ? ((() => { const o = snap.deadlines.filter((d) => d.kind === 'case' && d.days < 0).length; return o > 0 ? `${o} vencido${o === 1 ? '' : 's'}` : 'Sin vencimientos próximos' })()) : undefined}
          icon={<Clock className="h-5 w-5" />}
          href="/opportunities"
          hint="Trámites próximos a vencer o ya vencidos que requieren acción. Resuélvelos en 'Vencimientos críticos'."
          tone="amber"
        />
        <MetricTile
          label="Comisión cobrada"
          value={snap ? (snap.economics.cobradaPeriodo > 0 ? formatEuro(snap.economics.cobradaPeriodo) : '—') : loading ? '…' : '—'}
          detail={snap ? (period === 'all' ? 'Histórico · control interno' : `${snap.economics.periodLabel} · control interno`) : undefined}
          icon={<Coins className="h-5 w-5" />}
          href="/opportunities"
          hint="Comisiones marcadas como cobradas en el periodo seleccionado. Control interno."
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
          {/* Rendimiento comercial — comisiones (control interno) por periodo */}
          {snap && (
            <SectionCard
              title="Rendimiento comercial"
              description={period === 'all'
                ? 'Comisiones y cobros registrados en el CRM · histórico desde el inicio'
                : 'Comisiones y cobros registrados en el CRM'}
              action={<Link href="/opportunities" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver comisiones</Link>}
              bodyClassName="p-4"
            >
              {(snap.economics.donut.cobrada + snap.economics.donut.pendiente + snap.economics.donut.potencial) > 0 ? (
                <div className="grid gap-5 lg:grid-cols-[minmax(0,310px)_1fr]">
                  <DonutChart
                    segments={[
                      { key: 'cobrada', label: 'Cobrada', value: snap.economics.donut.cobrada, color: '#10b981', hint: 'Comisiones ya marcadas como cobradas.' },
                      { key: 'pendiente', label: 'Pendiente de cobro', value: snap.economics.donut.pendiente, color: '#f59e0b', hint: 'Operaciones cerradas con comisión pendiente de cobro.' },
                      { key: 'potencial', label: 'Potencial abierto', value: snap.economics.donut.potencial, color: '#6366f1', hint: 'Comisión prevista de operaciones abiertas con comisión pactada (orientativo).' },
                    ]}
                    centerValue={compactEuro(snap.economics.donut.cobrada + snap.economics.donut.pendiente + snap.economics.donut.potencial)}
                    centerLabel="total comisión"
                    formatValue={compactEuro}
                  />
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                      <EcoStat label="Pendiente de facturar" value={cycle && cycle.pendingInvoice > 0 ? formatEuro(cycle.pendingInvoice) : '—'} hint="Honorarios/comisión de operaciones cerradas todavía SIN factura emitida. No incluye el precio del inmueble; se calcula sobre los honorarios." tone="amber" />
                      <EcoStat label={period === 'all' ? 'Cobrada · histórico' : `Cobrada · ${snap.economics.periodLabel.toLowerCase()}`} value={snap.economics.cobradaPeriodo > 0 ? formatEuro(snap.economics.cobradaPeriodo) : '—'} variation={period === 'all' ? null : snap.economics.variationPct} hint="Comisiones marcadas como cobradas (cobros registrados a mano) en el periodo seleccionado." tone="emerald" />
                      <EcoStat label="Pendiente de cobro" value={snap.economics.pendiente > 0 ? formatEuro(snap.economics.pendiente) : '—'} hint="Comisión de operaciones vendidas/alquiladas con comisión pactada, todavía no cobrada. Estado actual." tone="amber" />
                      <EcoStat label="Potencial abierto" value={snap.economics.potencialAbierto > 0 ? formatEuro(snap.economics.potencialAbierto) : '—'} hint="Comisión prevista de operaciones abiertas, calculada solo sobre las que tienen comisión pactada. Orientativo, estado actual." tone="indigo" />
                      <EcoStat label="Operaciones cerradas" value={String(snap.economics.closedWithCommission)} hint="Operaciones vendidas/alquiladas con comisión pactada (sobre las que se calcula la comisión)." tone="gray" />
                    </div>
                    {snap.economics.buckets.some((b) => b.value > 0) ? (
                      <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                        <p className="mb-1.5 text-[11px] font-medium text-gray-500">Comisión cobrada por {snap.economics.bucketGranularity === 'week' ? 'semana' : 'mes'}</p>
                        <MiniBarChart
                          data={snap.economics.buckets.map((b) => ({
                            label: b.label,
                            value: b.value,
                            hint: `${b.label}: ${b.value > 0 ? formatEuro(b.value) : 'sin cobros'}${b.count > 0 ? ` · ${b.count} cobro${b.count === 1 ? '' : 's'}` : ''}`,
                          }))}
                          formatValue={compactEuro}
                          color="bg-emerald-500"
                          highlightLast
                        />
                      </div>
                    ) : (
                      <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-[11px] text-gray-400">Sin cobros registrados en {period === 'all' ? 'el histórico' : snap.economics.periodLabel.toLowerCase()}.</p>
                    )}
                    <p className="text-[10px] leading-snug text-gray-400">
                      {snap.economics.closedWithCommission} operación{snap.economics.closedWithCommission === 1 ? '' : 'es'} vendida{snap.economics.closedWithCommission === 1 ? '' : 's'}/alquilada{snap.economics.closedWithCommission === 1 ? '' : 's'} con comisión.
                      {period === 'all' ? ' En histórico, los cobros son el total acumulado; pendiente y potencial reflejan el estado actual.' : ''} Control interno · las facturas, gastos e impuestos se gestionarán en el módulo económico.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
                  <Coins className="mb-2 h-6 w-6 text-gray-300" />
                  <p className="text-sm font-medium text-gray-700">Todavía no hay comisiones registradas</p>
                  <p className="mt-1 text-xs text-gray-500">Cuando vendas/alquiles operaciones o registres cobros, verás aquí el rendimiento comercial (cobrada, pendiente y potencial).</p>
                </div>
              )}
            </SectionCard>
          )}

          {/* Banda visual — Cartera (donut) · Estado comercial (embudo) · Semana operativa */}
          {snap && (
            <div className="grid gap-4 lg:grid-cols-3">
              <SectionCard
                title="Cartera activa"
                description="Inmuebles actualmente gestionables"
                action={<Link href="/opportunities" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver inmuebles</Link>}
                bodyClassName="p-4"
              >
                {snap.cartera.active + snap.cartera.history > 0 ? (
                  <div className="space-y-3">
                    {/* Donut SOLO de cartera activa: vendidos/alquilados y archivados no entran (no distorsionan). */}
                    <DonutChart
                      size={130}
                      segments={[
                        { key: 'published', label: 'Publicados', value: snap.cartera.published, color: '#10b981', hint: 'Inmuebles publicados, visibles para clientes.' },
                        { key: 'reserved', label: 'Reservados', value: snap.cartera.reserved, color: '#f59e0b', hint: 'Inmuebles reservados, con operación en curso.' },
                        { key: 'prep', label: 'En preparación', value: snap.cartera.prep, color: '#6366f1', hint: 'Inmuebles en preparación, aún no publicados.' },
                      ]}
                      centerValue={String(snap.cartera.active)}
                      centerLabel="activos"
                    />
                    {/* Resultado comercial y dato de gestión, como contexto secundario (no como porción del donut). */}
                    <div className="space-y-1.5 border-t border-gray-100 pt-2.5 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500" title="Inmuebles vendidos o alquilados (operaciones cerradas). Resultado comercial.">Vendidos/alquilados</span>
                        <span className="font-semibold text-gray-700 tabular-nums">{snap.cartera.closed}</span>
                      </div>
                      {snap.cartera.archived > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400" title="Archivados: retirados de la cartera; no se eliminan y no cuentan como vendidos/alquilados.">Archivados</span>
                          <span className="font-medium text-gray-500 tabular-nums">{snap.cartera.archived}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500" title="Suma del precio de los inmuebles en cartera activa.">Valor activo</span>
                        <span className="font-semibold text-gray-700 tabular-nums">{formatEuro(snap.cartera.activeValue)}</span>
                      </div>
                    </div>
                    <p className="text-[10px] leading-snug text-gray-400">Vendidos/alquilados se conservan como histórico, pero no cuentan en la cartera activa.</p>
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
                title="Estado comercial"
                description="Operaciones por estado"
                action={<Link href="/opportunities" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ver operaciones</Link>}
                bodyClassName="p-4"
              >
                {(Object.values(snap.opsByState) as number[]).some((n) => n > 0) ? (
                  <div className="space-y-2">
                    {COMM_STATE_OPTIONS.map((s) => {
                      const count = snap.opsByState[s.id]
                      const totalOps = (Object.values(snap.opsByState) as number[]).reduce((a, b) => a + b, 0)
                      const pct = totalOps > 0 ? Math.round((count / totalOps) * 100) : 0
                      const barColor = s.id === 'won' ? 'bg-sky-500' : s.id === 'reserved' ? 'bg-amber-500' : s.id === 'lost' ? 'bg-rose-400' : s.id === 'new' ? 'bg-gray-400' : 'bg-indigo-500'
                      return (
                        <Link key={s.id} href="/opportunities" title={COMM_STATE_HINTS[s.id]} className="group flex items-center gap-2.5">
                          <span className="w-28 shrink-0 truncate text-[11px] font-medium text-gray-600">{s.label}</span>
                          <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500', barColor)} style={{ width: `${count > 0 ? Math.max(5, pct) : 0}%` }} />
                          </div>
                          <span className="w-5 text-right text-xs font-bold tabular-nums text-gray-800">{count}</span>
                        </Link>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-7 text-center">
                    <FileText className="mb-2 h-6 w-6 text-gray-300" />
                    <p className="text-sm font-medium text-gray-700">Sin operaciones</p>
                    <p className="mt-1 text-xs text-gray-500">Abre una operación de venta o alquiler para verla aquí por estado.</p>
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Semana operativa"
                description="Citas y tareas · 7 días"
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
              description="Trámites y tareas por vencer o vencidos · complétalos aquí mismo"
              action={snap && snap.deadlinesOverdue > 0 ? <Badge variant="warning" dot>{snap.deadlinesOverdue} vencido{snap.deadlinesOverdue === 1 ? '' : 's'}</Badge> : undefined}
              bodyClassName="p-4"
            >
              {snap && snap.deadlines.length > 0 ? (
                <ul className="space-y-1.5">
                  {snap.deadlines.slice(0, 5).map((d) => {
                    const overdue = d.days < 0
                    const dueLabel = overdue ? (d.days === -1 ? 'venció ayer' : `venció hace ${-d.days} días`) : d.days === 0 ? 'vence hoy' : d.days === 1 ? 'vence mañana' : `vence en ${d.days} días`
                    const busy = completingId === d.rawId
                    const text = (
                      <>
                        <p className="truncate text-xs font-semibold text-gray-900">{d.title}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px]">
                          <span className={cn('font-medium', overdue ? 'text-rose-600' : d.days <= 1 ? 'text-amber-600' : 'text-gray-500')}>{dueLabel}</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-gray-400">{d.kind === 'case' ? 'Trámite' : 'Tarea'}</span>
                          {d.subtitle && <><span className="text-gray-300">·</span><span className="max-w-[120px] truncate text-gray-500">{d.subtitle}</span></>}
                        </div>
                      </>
                    )
                    return (
                      <li key={d.id} className="group flex items-center gap-2.5 rounded-xl border border-gray-100 bg-white p-2.5 transition-colors hover:border-gray-200 hover:bg-gray-50/60">
                        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg', d.kind === 'case' ? 'bg-violet-50 text-violet-600' : 'bg-indigo-50 text-indigo-600')}>
                          {d.kind === 'case' ? <FileText className="h-3.5 w-3.5" /> : <ListChecks className="h-3.5 w-3.5" />}
                        </span>
                        {d.href
                          ? <Link href={d.href} className="min-w-0 flex-1">{text}</Link>
                          : <div className="min-w-0 flex-1">{text}</div>}
                        {d.kind === 'task' ? (
                          <button
                            type="button"
                            onClick={() => handleCompleteDeadlineTask(d.rawId)}
                            disabled={busy}
                            title="Marcar tarea como completada"
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            Completar
                          </button>
                        ) : d.href ? (
                          <Link
                            href={d.href}
                            title="Abrir trámite"
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                          >
                            Ver <ArrowRight className="h-3 w-3" />
                          </Link>
                        ) : null}
                      </li>
                    )
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
                        <p className="truncate text-xs text-gray-700" title={humanizeActivity(item.description)}>{humanizeActivity(item.description)}</p>
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
                    4. Pregunta al Asistente IA
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
