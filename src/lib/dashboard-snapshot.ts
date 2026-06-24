// Snapshot del Dashboard: deriva, a partir de los datos YA cargados (sin fetch ni N+1), todo lo que
// el centro de mando necesita: cartera por estado, operaciones por estado comercial, comisiones
// (control interno), vencimientos críticos (trámites + tareas) y citas de hoy. Reutiliza los
// helpers ya existentes (commStateOf, isClosedPropertyStatus, isRentalProperty) para no duplicar
// reglas. Funciona igual con datos del workspace real o del ejemplo (tipos estructurales).

import { commStateOf, type CommState } from '@/lib/demo/vertical-templates'
import { isClosedPropertyStatus, isRentalProperty } from '@/lib/property-display'

export type SnapProperty = {
  id: string; status: string; price?: number | null; title: string
  operation_type?: string | null; metadata?: Record<string, unknown> | null
}
export type SnapOpportunity = {
  id: string; title: string; stage: string; value: number | null
  commission_rate?: number | null; commission_status?: string | null; commission_paid_amount?: number | null
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

export type SnapshotInput = {
  properties: SnapProperty[]
  opportunities: SnapOpportunity[]
  cases: SnapCase[]
  tasks: SnapTask[]
  events: SnapEvent[]
  clients: { id: string; name: string }[]
  todayStr: string // 'YYYY-MM-DD'
}

export type Deadline = {
  id: string; kind: 'case' | 'task'; title: string; subtitle: string
  due: string; days: number; href?: string
}

export type DashboardSnapshot = {
  cartera: { active: number; history: number; prep: number; published: number; reserved: number; activeValue: number }
  opsByState: Record<CommState, number>
  commissions: { prevista: number; pendiente: number; cobrada: number; closedWithCommission: number }
  deadlines: Deadline[]
  deadlinesOverdue: number
  todayEvents: SnapEvent[]
}

const DEADLINE_WINDOW_DAYS = 14
const isOpenCase = (s: string) => !['closed', 'resolved', 'cancelled'].includes(s)
const isOpenTask = (s: string) => !['done', 'completed', 'cancelled', 'archived', 'closed'].includes(s)

function daysFromToday(due: string, todayStr: string): number {
  const a = new Date(`${todayStr}T00:00:00`).getTime()
  const b = new Date(`${due}T00:00:00`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 9999
  return Math.round((b - a) / 86_400_000)
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

export function buildDashboardSnapshot(input: SnapshotInput): DashboardSnapshot {
  const { properties, opportunities, cases, tasks, events, clients, todayStr } = input
  const propById = new Map(properties.map((p) => [p.id, p]))
  const clientName = new Map(clients.map((c) => [c.id, c.name]))

  // Cartera por estado (activos vs histórico).
  const active = properties.filter((p) => !isClosedPropertyStatus(p.status))
  const cartera = {
    active: active.length,
    history: properties.length - active.length,
    prep: active.filter((p) => p.status === 'prospecting').length,
    published: active.filter((p) => p.status === 'listed' || p.status === 'available').length,
    reserved: active.filter((p) => p.status === 'under_contract' || p.status === 'reserved').length,
    activeValue: active.reduce((s, p) => s + (p.price ?? 0), 0),
  }

  // Operaciones por estado comercial.
  const opsByState: Record<CommState, number> = { new: 0, managing: 0, reserved: 0, won: 0, lost: 0 }
  for (const o of opportunities) opsByState[commStateOf(o.stage)] += 1

  // Comisiones (control interno) sobre operaciones cerradas (vendidas/alquiladas) con comisión.
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

  // Vencimientos críticos: trámites + tareas abiertos con vencimiento próximo o ya vencido.
  const deadlines: Deadline[] = []
  for (const c of cases) {
    if (!c.due_date || !isOpenCase(c.status)) continue
    const days = daysFromToday(c.due_date, todayStr)
    if (days > DEADLINE_WINDOW_DAYS) continue
    const prop = c.property_id ? propById.get(c.property_id) : undefined
    const cli = c.client_id ? clientName.get(c.client_id) : ''
    deadlines.push({
      id: `case-${c.id}`, kind: 'case', title: c.title || 'Trámite', due: c.due_date, days,
      subtitle: [prop?.title, cli].filter(Boolean).join(' · '),
      href: c.property_id ? `/opportunities/properties/${c.property_id}` : c.client_id ? `/clients/${c.client_id}` : '/opportunities',
    })
  }
  for (const t of tasks) {
    if (!t.due_date || !isOpenTask(t.status)) continue
    const days = daysFromToday(t.due_date, todayStr)
    if (days > DEADLINE_WINDOW_DAYS) continue
    deadlines.push({
      id: `task-${t.id}`, kind: 'task', title: t.title || 'Tarea', due: t.due_date, days,
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

  return { cartera, opsByState, commissions, deadlines, deadlinesOverdue, todayEvents }
}
