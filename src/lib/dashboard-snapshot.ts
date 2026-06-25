// Snapshot del Dashboard: deriva, a partir de los datos YA cargados (sin fetch ni N+1), todo lo que
// el centro de mando necesita: cartera por estado, operaciones por estado comercial, comisiones
// (control interno), rendimiento económico por periodo, vencimientos críticos y citas de hoy.
// Reutiliza los helpers existentes (commStateOf, isClosedPropertyStatus, isRentalProperty) para no
// duplicar reglas. Función PURA (sin Supabase, sin side effects). Funciona igual con datos reales o
// de ejemplo (tipos estructurales).

import { commStateOf, type CommState } from '@/lib/demo/vertical-templates'
import { isClosedPropertyStatus, isRentalProperty } from '@/lib/property-display'

export type SnapProperty = {
  id: string; status: string; price?: number | null; title: string
  operation_type?: string | null; metadata?: Record<string, unknown> | null
}
export type SnapOpportunity = {
  id: string; title: string; stage: string; value: number | null
  commission_rate?: number | null; commission_status?: string | null
  commission_paid_amount?: number | null; commission_paid_at?: string | null
  expected_close_date?: string | null; created_at?: string; updated_at?: string
  property_id?: string | null; metadata?: Record<string, unknown> | null
}
export type SnapCase = {
  id: string; title: string; status: string; due_date?: string | null
  client_id?: string | null; property_id?: string | null; opportunity_id?: string | null; case_type?: string
}
export type SnapTask = {
  id: string; title: string; status: string; due_date?: string | null
  client_id?: string | null; client_name?: string | null
}
export type SnapEvent = {
  id: string; title: string; startAt?: string | null; date?: string | null
  status?: string | null; type?: string; clientName?: string | null
}

export type PeriodKey = 'month' | 'quarter' | 'semester' | 'year' | 'all'
export const PERIOD_OPTIONS: { id: PeriodKey; label: string }[] = [
  { id: 'month', label: 'Este mes' },
  { id: 'quarter', label: 'Trimestre' },
  { id: 'semester', label: 'Semestre' },
  { id: 'year', label: 'Año' },
  { id: 'all', label: 'Todo' },
]

export type SnapshotInput = {
  properties: SnapProperty[]
  opportunities: SnapOpportunity[]
  cases: SnapCase[]
  tasks: SnapTask[]
  events: SnapEvent[]
  clients: { id: string; name: string }[]
  todayStr: string // 'YYYY-MM-DD'
  period?: PeriodKey // por defecto 'all'
}

export type Deadline = {
  id: string; rawId: string; kind: 'case' | 'task'; title: string; subtitle: string
  due: string; days: number; href?: string
}

export type Economics = {
  period: PeriodKey
  periodLabel: string
  cobradaPeriodo: number       // comisión cobrada con fecha de cobro dentro del periodo
  cobradaPrev: number          // cobrada en el periodo anterior (para variación)
  variationPct: number | null  // % vs periodo anterior (null si no hay base)
  pendiente: number            // pendiente de cobro actual (operaciones cerradas con comisión, no cobrada)
  potencialAbierto: number     // comisión prevista de operaciones abiertas
  totalPotencial: number       // pendiente + potencial abierto
  closedWithCommission: number // nº de operaciones cerradas con comisión
  ticketMedio: number | null   // comisión media por operación cerrada con comisión
  opsClosedInPeriod: number     // operaciones cerradas en el periodo
  donut: { cobrada: number; pendiente: number; potencial: number }
  buckets: { label: string; value: number; count: number }[]
  bucketGranularity: 'week' | 'month'
}

export type DashboardSnapshot = {
  cartera: {
    active: number; history: number; closed: number; archived: number
    prep: number; published: number; reserved: number; activeValue: number; closedValue: number
  }
  opsByState: Record<CommState, number>
  opsValueByState: Record<CommState, number>
  commissions: { prevista: number; pendiente: number; cobrada: number; closedWithCommission: number }
  economics: Economics
  deadlines: Deadline[]
  deadlinesOverdue: number
  todayEvents: SnapEvent[]
}

const DEADLINE_WINDOW_DAYS = 14
const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const isOpenCase = (s: string) => !['closed', 'resolved', 'cancelled'].includes(s)
const isOpenTask = (s: string) => !['done', 'completed', 'cancelled', 'archived', 'closed'].includes(s)

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysFromToday(due: string, todayStr: string): number {
  const a = new Date(`${todayStr}T00:00:00`).getTime()
  const b = new Date(`${due}T00:00:00`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 9999
  return Math.round((b - a) / 86_400_000)
}

// Límites del periodo actual y del anterior (para variación). 'all' = sin límites.
function periodBounds(todayStr: string, period: PeriodKey): { start: string | null; end: string | null; prevStart: string | null; prevEnd: string | null } {
  if (period === 'all') return { start: null, end: null, prevStart: null, prevEnd: null }
  const today = new Date(`${todayStr}T00:00:00`)
  const y = today.getFullYear()
  const m = today.getMonth()
  let s: Date, e: Date, ps: Date, pe: Date
  if (period === 'month') {
    s = new Date(y, m, 1); e = new Date(y, m + 1, 0); ps = new Date(y, m - 1, 1); pe = new Date(y, m, 0)
  } else if (period === 'quarter') {
    const q = Math.floor(m / 3) * 3
    s = new Date(y, q, 1); e = new Date(y, q + 3, 0); ps = new Date(y, q - 3, 1); pe = new Date(y, q, 0)
  } else if (period === 'semester') {
    const h = m < 6 ? 0 : 6
    s = new Date(y, h, 1); e = new Date(y, h + 6, 0); ps = new Date(y, h - 6, 1); pe = new Date(y, h, 0)
  } else {
    s = new Date(y, 0, 1); e = new Date(y, 12, 0); ps = new Date(y - 1, 0, 1); pe = new Date(y - 1, 12, 0)
  }
  return { start: ymd(s), end: ymd(e), prevStart: ymd(ps), prevEnd: ymd(pe) }
}

// Comisión prevista (orientativa) de una operación. Espejo de la lógica de Cartera (commissionOf):
// modelos percent | one_month | fixed; en alquiler % la base es la renta ANUAL (no la mensualidad).
function commissionForOp(o: SnapOpportunity, propById: Map<string, SnapProperty>): number | null {
  const meta = o.metadata ?? {}
  const model = typeof meta.commission_model === 'string' ? meta.commission_model : 'percent'
  const prop = o.property_id ? propById.get(o.property_id) : undefined
  const rental = (typeof meta.operation_kind === 'string' && meta.operation_kind === 'alquiler') || isRentalProperty(prop?.operation_type ?? null)
  const monthly = rental && prop ? (prop.price ?? null) : null
  if (model === 'fixed') {
    const f = Number(meta.commission_fixed)
    return Number.isFinite(f) && f > 0 ? Math.round(f) : null
  }
  if (model === 'one_month') return monthly ? Math.round(monthly) : null
  const base = rental ? o.value : ((prop ? prop.price : null) ?? o.value)
  return base && o.commission_rate ? Math.round((base * o.commission_rate) / 100) : null
}

function buildEconomics(
  opportunities: SnapOpportunity[],
  propById: Map<string, SnapProperty>,
  todayStr: string,
  period: PeriodKey,
): Economics {
  const b = periodBounds(todayStr, period)
  const periodLabel = PERIOD_OPTIONS.find((p) => p.id === period)?.label ?? 'Todo'
  const inRange = (iso: string | null | undefined, start: string | null, end: string | null) => {
    if (!iso) return false
    const d = iso.slice(0, 10)
    return (!start || d >= start) && (!end || d <= end)
  }

  let cobradaPeriodo = 0, cobradaPrev = 0, pendiente = 0, potencialAbierto = 0
  let closedWithCommission = 0, previstaTotal = 0, opsClosedInPeriod = 0
  const payments: { d: string; amt: number }[] = []

  for (const o of opportunities) {
    const st = commStateOf(o.stage)
    const est = commissionForOp(o, propById)
    if (st === 'won') {
      if (est != null) { closedWithCommission += 1; previstaTotal += est }
      if (o.commission_status === 'cobrada') {
        const amt = o.commission_paid_amount ?? est ?? 0
        if (o.commission_paid_at) payments.push({ d: o.commission_paid_at.slice(0, 10), amt })
        if (period === 'all' || inRange(o.commission_paid_at, b.start, b.end)) cobradaPeriodo += amt
        if (inRange(o.commission_paid_at, b.prevStart, b.prevEnd)) cobradaPrev += amt
      } else if (est != null) {
        pendiente += est
      }
      const closeRef = o.commission_paid_at ?? o.expected_close_date ?? o.updated_at ?? null
      if (period === 'all' || inRange(closeRef, b.start, b.end)) opsClosedInPeriod += 1
    } else if (st !== 'lost' && est != null) {
      potencialAbierto += est
    }
  }

  // Buckets: semanas si el periodo es "este mes"; meses en el resto. Cada bucket lleva además el
  // nº de cobros (operaciones cobradas) para el tooltip. En "Todo" mostramos los últimos 12 meses
  // (rolling) hasta el mes actual, para no recortar el histórico a un solo año natural.
  let buckets: { label: string; value: number; count: number }[]
  let bucketGranularity: 'week' | 'month'
  if (period === 'month') {
    bucketGranularity = 'week'
    const weeks = Array.from({ length: 5 }, () => ({ value: 0, count: 0 }))
    for (const p of payments) {
      if (!inRange(p.d, b.start, b.end)) continue
      const day = Number(p.d.slice(8, 10))
      const w = weeks[Math.min(4, Math.floor((day - 1) / 7))]
      w.value += p.amt; w.count += 1
    }
    buckets = weeks.map((w, i) => ({ label: `S${i + 1}`, value: w.value, count: w.count }))
  } else {
    bucketGranularity = 'month'
    let startMonth: number, startYear: number, count: number
    if (period === 'all') {
      const ty = Number(todayStr.slice(0, 4)); const tm = Number(todayStr.slice(5, 7)) - 1
      count = 12
      const anchor = tm - 11 // 12 meses terminando en el mes actual
      startMonth = ((anchor % 12) + 12) % 12
      startYear = ty + Math.floor(anchor / 12)
    } else {
      startMonth = b.start ? Number(b.start.slice(5, 7)) - 1 : 0
      startYear = b.start ? Number(b.start.slice(0, 4)) : Number(todayStr.slice(0, 4))
      count = period === 'quarter' ? 3 : period === 'semester' ? 6 : 12
    }
    const arr = Array.from({ length: count }, (_, i) => {
      const mi = startMonth + i
      return { m: ((mi % 12) + 12) % 12, y: startYear + Math.floor(mi / 12), value: 0, count: 0 }
    })
    for (const p of payments) {
      const py = Number(p.d.slice(0, 4)); const pm = Number(p.d.slice(5, 7)) - 1
      const cell = arr.find((a) => a.m === pm && a.y === py)
      if (cell) { cell.value += p.amt; cell.count += 1 }
    }
    buckets = arr.map((a) => ({ label: MONTHS_ES[a.m], value: a.value, count: a.count }))
  }

  return {
    period,
    periodLabel,
    cobradaPeriodo,
    cobradaPrev,
    variationPct: cobradaPrev > 0 ? Math.round(((cobradaPeriodo - cobradaPrev) / cobradaPrev) * 100) : null,
    pendiente,
    potencialAbierto,
    totalPotencial: pendiente + potencialAbierto,
    closedWithCommission,
    ticketMedio: closedWithCommission > 0 ? Math.round(previstaTotal / closedWithCommission) : null,
    opsClosedInPeriod,
    donut: { cobrada: cobradaPeriodo, pendiente, potencial: potencialAbierto },
    buckets,
    bucketGranularity,
  }
}

export function buildDashboardSnapshot(input: SnapshotInput): DashboardSnapshot {
  const { properties, opportunities, cases, tasks, events, clients, todayStr } = input
  const period: PeriodKey = input.period ?? 'all'
  const propById = new Map(properties.map((p) => [p.id, p]))
  const clientName = new Map(clients.map((c) => [c.id, c.name]))

  // Cartera por estado. Para el Dashboard separamos "cerrados" (vendidos/alquilados = negocio hecho)
  // de "archivados" (retirados, no se eliminan) en vez de mezclarlos en un "histórico" gris genérico.
  const active = properties.filter((p) => !isClosedPropertyStatus(p.status))
  const closedProps = properties.filter((p) => p.status === 'sold' || p.status === 'rented')
  const archivedProps = properties.filter((p) => p.status === 'archived')
  const cartera = {
    active: active.length,
    history: properties.length - active.length, // cerrados + archivados (todo lo que ya no está en cartera activa)
    closed: closedProps.length,                 // vendidos/alquilados
    archived: archivedProps.length,             // archivados (dato secundario, fuera del donut)
    prep: active.filter((p) => p.status === 'prospecting').length,
    published: active.filter((p) => p.status === 'listed' || p.status === 'available').length,
    reserved: active.filter((p) => p.status === 'under_contract' || p.status === 'reserved').length,
    activeValue: active.reduce((s, p) => s + (p.price ?? 0), 0),
    closedValue: closedProps.reduce((s, p) => s + (p.price ?? 0), 0),
  }

  // Operaciones por estado comercial (nº y valor).
  const opsByState: Record<CommState, number> = { new: 0, managing: 0, reserved: 0, won: 0, lost: 0 }
  const opsValueByState: Record<CommState, number> = { new: 0, managing: 0, reserved: 0, won: 0, lost: 0 }
  for (const o of opportunities) {
    const st = commStateOf(o.stage)
    opsByState[st] += 1
    opsValueByState[st] += o.value ?? 0
  }

  // Comisiones (control interno) sobre operaciones cerradas con comisión — stock total (sin periodo).
  let prevista = 0, cobrada = 0, closedWithCommission = 0
  for (const o of opportunities) {
    if (commStateOf(o.stage) !== 'won') continue
    const est = commissionForOp(o, propById)
    if (est == null) continue
    closedWithCommission += 1
    prevista += est
    if (o.commission_status === 'cobrada') cobrada += o.commission_paid_amount ?? est
  }
  const commissions = { prevista, cobrada, pendiente: Math.max(0, prevista - cobrada), closedWithCommission }

  const economics = buildEconomics(opportunities, propById, todayStr, period)

  // Vencimientos críticos: trámites + tareas abiertos con vencimiento próximo o ya vencido.
  const deadlines: Deadline[] = []
  for (const c of cases) {
    if (!c.due_date || !isOpenCase(c.status)) continue
    const days = daysFromToday(c.due_date, todayStr)
    if (days > DEADLINE_WINDOW_DAYS) continue
    const prop = c.property_id ? propById.get(c.property_id) : undefined
    const cli = c.client_id ? clientName.get(c.client_id) : ''
    deadlines.push({
      id: `case-${c.id}`, rawId: c.id, kind: 'case', title: c.title || 'Trámite', due: c.due_date, days,
      subtitle: [prop?.title, cli].filter(Boolean).join(' · '),
      href: c.property_id ? `/opportunities/properties/${c.property_id}` : c.client_id ? `/clients/${c.client_id}` : '/opportunities',
    })
  }
  for (const t of tasks) {
    if (!t.due_date || !isOpenTask(t.status)) continue
    const days = daysFromToday(t.due_date, todayStr)
    if (days > DEADLINE_WINDOW_DAYS) continue
    deadlines.push({
      id: `task-${t.id}`, rawId: t.id, kind: 'task', title: t.title || 'Tarea', due: t.due_date, days,
      subtitle: (t.client_id ? clientName.get(t.client_id) : '') || t.client_name || '',
      href: t.client_id ? `/clients/${t.client_id}` : undefined,
    })
  }
  deadlines.sort((a, b) => a.due.localeCompare(b.due))
  const deadlinesOverdue = deadlines.filter((d) => d.days < 0).length

  // Citas de hoy (no canceladas).
  const todayEvents = events.filter((e) => {
    if (e.status === 'cancelled') return false
    const d = (e.startAt ?? e.date ?? '').slice(0, 10)
    return d === todayStr
  })

  return { cartera, opsByState, opsValueByState, commissions, economics, deadlines, deadlinesOverdue, todayEvents }
}
