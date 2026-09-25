import type { PeriodKey } from '@/lib/dashboard-snapshot'

export type RealStats = {
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

export type WeekDay = {
  label: string
  dayNum: number
  events: number
  tasks: number
  tooltip: string
}

export type UrgentTask = {
  id: string
  title: string
  dueDate?: string
  clientName?: string
  priority: string
}

export type ReviewOp = {
  id: string
  title: string
  stage: string
  value: number | null
}

const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export function buildNext7Days(
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

  for (const event of events) {
    if (event.status === 'cancelled') continue
    const index = indexFor(event.startAt ?? event.date)
    if (index >= 0) counts[index].events += 1
  }

  for (const task of openTasks) {
    const index = indexFor(task.due_date)
    if (index >= 0) counts[index].tasks += 1
  }

  return counts.map((count, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() + index)
    const label = index === 0 ? 'Hoy' : WEEKDAY_LABELS[date.getDay()]
    return {
      label,
      dayNum: date.getDate(),
      events: count.events,
      tasks: count.tasks,
      tooltip: `${label} ${date.getDate()} · ${count.events} cita(s) · ${count.tasks} tarea(s)`,
    }
  })
}

export function pickUrgentTask(
  openTasks: { id: string; title: string; due_date?: string | null; client_name?: string | null; priority: string }[],
): UrgentTask | null {
  if (openTasks.length === 0) return null
  const sorted = [...openTasks].sort((a, b) => {
    const aDue = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY
    const bDue = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY
    return aDue - bDue
  })
  const task = sorted[0]
  return {
    id: task.id,
    title: task.title,
    dueDate: task.due_date ?? undefined,
    clientName: task.client_name ?? undefined,
    priority: task.priority,
  }
}

export function pickReviewOp(
  openOpportunities: { id: string; title: string; stage: string; value: number | null }[],
): ReviewOp | null {
  if (openOpportunities.length === 0) return null
  const opportunity = [...openOpportunities].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0]
  return {
    id: opportunity.id,
    title: opportunity.title,
    stage: opportunity.stage,
    value: opportunity.value,
  }
}

export function formatEuro(value: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value)
}

export function compactEuro(value: number) {
  if (value >= 1000) return `€${Math.round(value / 1000)}k`
  return `€${Math.round(value)}`
}

export function formatDateShort(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const PROPERTY_STATUS_LABELS: Record<string, string> = {
  listed: 'Publicado',
  available: 'Disponible',
  prospecting: 'En preparación',
  under_contract: 'Reservado',
  reserved: 'Reservado',
  sold: 'Vendido',
  rented: 'Alquilado',
  archived: 'Archivado',
}

const STAGE_LABELS: Record<string, string> = {
  new: 'Nueva',
  contacted: 'En gestión',
  qualified: 'En gestión',
  visit_scheduled: 'En gestión',
  negotiation: 'En gestión',
  proposal: 'En gestión',
  reserved: 'Reserva',
  won: 'Vendida',
  lost: 'Perdida',
}

const CASE_STATUS_LABELS: Record<string, string> = {
  open: 'Abierto',
  documentation_pending: 'Pendiente de documentación',
  in_review: 'En revisión',
  closed: 'Completado',
  resolved: 'Resuelto',
  cancelled: 'Cancelado',
}

export function humanizeActivity(description?: string | null): string {
  let text = (description ?? '').trim()
  if (!text) return 'Actividad registrada'

  const operationEdit = text.match(/^stage\s+\w+\s*·\s*([\d.,]+)\s*€/i)
  if (operationEdit) {
    const amount = Number(operationEdit[1].replace(/[.,]/g, ''))
    return Number.isFinite(amount) && amount > 0
      ? `Operación actualizada · ${formatEuro(amount)}`
      : 'Operación actualizada'
  }

  if (text.includes('·') && /(listed|available|prospecting|under_contract|reserved|sold|rented|archived)\s*\.?$/i.test(text)) {
    const parts = text.split('·').map((part) => part.trim()).filter(Boolean)
    const usefulParts = parts
      .slice(0, -1)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' · ')
    return usefulParts ? `Inmueble actualizado: ${usefulParts}` : 'Inmueble actualizado'
  }

  text = text.replace(/\betapa\s+(\w+)/gi, (_match, word: string) => STAGE_LABELS[word.toLowerCase()] ?? word)
  text = text.replace(
    /\b(listed|available|prospecting|under_contract|reserved|sold|rented|archived)\b/gi,
    (word) => PROPERTY_STATUS_LABELS[word.toLowerCase()] ?? word,
  )
  text = text.replace(
    /\b(documentation_pending|in_review|resolved|cancelled|closed|open)\b/gi,
    (word) => CASE_STATUS_LABELS[word.toLowerCase()] ?? word,
  )
  text = text.replace(
    /\b(won|lost|negotiation|contacted|qualified|proposal|visit_scheduled)\b/gi,
    (word) => STAGE_LABELS[word.toLowerCase()] ?? word,
  )
  return text.replace(/\s*·\s*\d{1,3}\s*%/g, '').replace(/\bstage\s+/gi, '')
}

export const PERIOD_HINTS: Record<PeriodKey, string> = {
  month: 'Métricas cobradas y cerradas del mes actual.',
  quarter: 'Acumulado del trimestre actual.',
  semester: 'Acumulado del semestre actual.',
  year: 'Acumulado del año actual.',
  all: 'Histórico completo desde el inicio. La comisión cobrada es el total acumulado; cartera, pendiente y potencial reflejan el estado actual.',
}

export const COMM_STATE_HINTS: Record<string, string> = {
  new: 'Operación recién creada, sin gestión todavía.',
  managing: 'Operación en gestión: contacto, visitas o negociación en curso.',
  reserved: 'Operación con reserva en firme, pendiente de cierre.',
  won: 'Operación cerrada: vendida o alquilada.',
  lost: 'Operación perdida o descartada.',
}
