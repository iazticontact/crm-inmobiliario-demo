'use client'

// Cliente 360 — drawer that aggregates everything the workspace knows about a
// single client: vertical entities, conversations, invoices, calendar events
// and activities. The CTAs delegate the actual create flow back to the parent
// page so we don't stack SideDrawers on top of each other.

import { useEffect, useState } from 'react'
import {
  Building2,
  Calendar,
  CreditCard,
  FileText,
  MessageSquare,
  Plus,
  Target,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { SideDrawer } from '@/components/SideDrawer'
import { cn } from '@/lib/utils'
import {
  getClientActivities,
  getClientCalendarEvents,
  getClientConversations,
  getClientInvoices,
} from '@/lib/supabase-queries'
import { getClientVerticalSummary, type OpportunityRow, type PropertyRow, type ServiceCaseRow } from '@/lib/vertical-queries'
import type { Activity, CalendarEvent, Client, Conversation, Invoice } from '@/lib/types'

export type Client360Action = 'opportunity' | 'service_case' | 'property'

type Client360DrawerProps = {
  open: boolean
  onClose: () => void
  workspaceId: string | null
  client: Client | null
  onCreate?: (action: Client360Action) => void
}

function formatCurrency(value: number | null | undefined, currency = 'EUR') {
  if (value == null || !Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${value} ${currency}`
  }
}

function formatDate(value?: string | null) {
  if (!value) return null
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  } catch { return null }
}

export function Client360Drawer({ open, onClose, workspaceId, client, onCreate }: Client360DrawerProps) {
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  const [cases, setCases] = useState<ServiceCaseRow[]>([])
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !client || !workspaceId) return
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setLoading(true) })
    Promise.all([
      getClientVerticalSummary(workspaceId, client.id).catch(() => ({ opportunities: [], cases: [], properties: [] })),
      getClientActivities(workspaceId, client.name).catch(() => [] as Activity[]),
      getClientInvoices(workspaceId, client.name).catch(() => [] as Invoice[]),
      getClientCalendarEvents(workspaceId, client.name).catch(() => [] as CalendarEvent[]),
      getClientConversations(workspaceId, client.id).catch(() => [] as Conversation[]),
    ]).then(([vertical, acts, invs, evs, convs]) => {
      if (cancelled) return
      setOpportunities(vertical.opportunities)
      setCases(vertical.cases)
      setProperties(vertical.properties)
      setActivities(acts.slice(0, 8))
      setInvoices(invs.slice(0, 5))
      setEvents(evs.slice(0, 5))
      setConversations(convs.slice(0, 5))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [open, client, workspaceId])

  if (!client) return null

  const activeOpps = opportunities.filter((o) => o.stage !== 'won' && o.stage !== 'lost' && o.stage !== 'closed')
  const activeCases = cases.filter((c) => c.status !== 'resolved' && c.status !== 'closed')
  const activeProps = properties.filter((p) => p.status !== 'archived' && p.status !== 'sold')
  const overdueInvoices = invoices.filter((i) => i.status === 'overdue')
  const pipelineValue = opportunities.reduce((sum, o) => sum + (o.value ?? 0), 0)

  // Suggest a next best action.
  let nextAction = 'Sin acciones críticas. Mantén el seguimiento habitual.'
  if (activeCases.some((c) => c.status === 'documentation_pending')) {
    nextAction = 'Pídele al cliente la documentación pendiente para avanzar el expediente.'
  } else if (overdueInvoices.length > 0) {
    nextAction = `Tiene ${overdueInvoices.length} factura(s) vencida(s). Manda recordatorio de cobro.`
  } else if (activeOpps.some((o) => o.stage === 'visit_scheduled' || o.stage === 'qualified')) {
    nextAction = 'Hay oportunidades calientes. Confirma la próxima visita o propuesta.'
  } else if (activeProps.some((p) => p.status === 'prospecting')) {
    nextAction = 'Tiene propiedad en captación. Recoge documentación de propietario o publica.'
  } else if (activeOpps.length === 0 && activeCases.length === 0) {
    nextAction = 'Sin oportunidad ni expediente abierto. Considera abrir una nueva oportunidad.'
  }

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title={client.name}
      description={`${client.company || 'Sin empresa'} · ${client.email}`}
      width="lg"
    >
      {/* Header summary */}
      <section className="mb-4 rounded-2xl border border-gray-100 bg-gradient-to-br from-indigo-50/50 to-white p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-50 to-sky-50 text-sm font-bold text-indigo-700 ring-1 ring-indigo-100">
            {client.avatar || client.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">{client.name}</h3>
              <Badge variant={client.status === 'active' ? 'success' : client.status === 'lead' ? 'indigo' : 'default'} dot>
                {client.status}
              </Badge>
              <span className="rounded-full border border-gray-100 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600">
                {client.channel}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                lead score {client.leadScore}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {[client.phone && client.phone !== '-' ? client.phone : null, client.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs text-gray-700">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <p>{nextAction}</p>
        </div>
      </section>

      {/* Quick stats */}
      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill icon={<Target className="h-3.5 w-3.5 text-indigo-600" />} label="Oport." value={String(opportunities.length)} detail={pipelineValue ? formatCurrency(pipelineValue) : 'sin valor'} />
        <StatPill icon={<FileText className="h-3.5 w-3.5 text-violet-600" />} label="Exped." value={String(cases.length)} detail={`${activeCases.length} activos`} />
        <StatPill icon={<Building2 className="h-3.5 w-3.5 text-sky-600" />} label="Propied." value={String(properties.length)} detail={`${activeProps.length} activas`} />
        <StatPill icon={<CreditCard className="h-3.5 w-3.5 text-amber-600" />} label="Facturas" value={String(invoices.length)} detail={overdueInvoices.length ? `${overdueInvoices.length} vencida(s)` : 'al día'} />
      </section>

      {/* CTAs */}
      <section className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => onCreate?.('opportunity')}>
          <Plus className="h-3.5 w-3.5" /> Crear oportunidad
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onCreate?.('service_case')}>
          <Plus className="h-3.5 w-3.5" /> Crear expediente
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onCreate?.('property')}>
          <Plus className="h-3.5 w-3.5" /> Registrar propiedad
        </Button>
      </section>

      {loading && (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando contexto del cliente…
        </div>
      )}

      {/* Vertical entities */}
      <SectionList
        title="Oportunidades"
        icon={<Target className="h-3.5 w-3.5 text-indigo-600" />}
        emptyHint="Sin oportunidades abiertas para este cliente."
        items={opportunities.map((o) => ({
          id: o.id,
          title: o.title,
          subtitle: `${o.stage}${o.vertical && o.vertical !== 'general' ? ` · ${o.vertical}` : ''}${o.value ? ` · ${formatCurrency(o.value, o.currency ?? 'EUR')}` : ''}`,
          accent: o.stage === 'won' ? 'success' : o.stage === 'lost' ? 'danger' : 'indigo',
        }))}
      />

      <SectionList
        title="Expedientes"
        icon={<FileText className="h-3.5 w-3.5 text-violet-600" />}
        emptyHint="Sin expedientes abiertos para este cliente."
        items={cases.map((c) => ({
          id: c.id,
          title: c.title,
          subtitle: `${c.case_type} · ${c.status}${c.due_date ? ` · vence ${formatDate(c.due_date)}` : ''}`,
          accent: c.status === 'resolved' || c.status === 'closed' ? 'default' : c.status === 'documentation_pending' ? 'warning' : 'purple',
        }))}
      />

      <SectionList
        title="Propiedades"
        icon={<Building2 className="h-3.5 w-3.5 text-sky-600" />}
        emptyHint="Sin propiedades vinculadas a este cliente."
        items={properties.map((p) => ({
          id: p.id,
          title: p.title,
          subtitle: `${p.property_type ?? ''}${p.operation_type ? ` · ${p.operation_type}` : ''}${p.city ? ` · ${p.city}` : ''}${p.price ? ` · ${formatCurrency(p.price, p.currency ?? 'EUR')}` : ''} · ${p.status}`,
          accent: p.status === 'sold' ? 'success' : p.status === 'archived' ? 'default' : 'info',
        }))}
      />

      <SectionList
        title="Conversaciones"
        icon={<MessageSquare className="h-3.5 w-3.5 text-emerald-600" />}
        emptyHint="Sin conversaciones registradas para este cliente."
        items={conversations.map((c) => ({
          id: c.id,
          title: c.clientName || c.lastMessage?.slice(0, 60) || 'Conversación',
          subtitle: `${c.channel}${c.status ? ` · ${c.status}` : ''}`,
          accent: 'success',
        }))}
      />

      <SectionList
        title="Facturas"
        icon={<CreditCard className="h-3.5 w-3.5 text-amber-600" />}
        emptyHint="Sin facturas asociadas a este cliente."
        items={invoices.map((i) => ({
          id: i.id,
          title: `${i.invoiceNumber || i.number || 'Factura'} — ${formatCurrency(i.amount, i.currency ?? 'EUR')}`,
          subtitle: `${i.status}${i.dueDate ? ` · vence ${formatDate(i.dueDate)}` : ''}`,
          accent: i.status === 'overdue' ? 'danger' : i.status === 'paid' ? 'success' : 'warning',
        }))}
      />

      <SectionList
        title="Próximas citas"
        icon={<Calendar className="h-3.5 w-3.5 text-rose-600" />}
        emptyHint="Sin eventos de calendario para este cliente."
        items={events.map((e) => {
          const hh = String(e.startHour ?? 0).padStart(2, '0')
          const mm = String(e.startMinute ?? 0).padStart(2, '0')
          return {
            id: e.id,
            title: e.title,
            subtitle: `${e.date ?? ''} ${hh}:${mm}${e.type ? ` · ${e.type}` : ''}`,
            accent: 'info' as const,
          }
        })}
      />

      <SectionList
        title="Actividad reciente"
        icon={<Sparkles className="h-3.5 w-3.5 text-indigo-600" />}
        emptyHint="Sin actividad registrada todavía."
        items={activities.map((a) => ({
          id: a.id,
          title: a.description || a.type,
          subtitle: a.type,
          accent: 'default',
        }))}
      />
    </SideDrawer>
  )
}

type AccentKey = 'success' | 'danger' | 'warning' | 'indigo' | 'purple' | 'info' | 'default'

const ACCENT_PILL: Record<AccentKey, string> = {
  success: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  danger: 'border-rose-100 bg-rose-50 text-rose-700',
  warning: 'border-amber-100 bg-amber-50 text-amber-700',
  indigo: 'border-indigo-100 bg-indigo-50 text-indigo-700',
  purple: 'border-violet-100 bg-violet-50 text-violet-700',
  info: 'border-sky-100 bg-sky-50 text-sky-700',
  default: 'border-gray-100 bg-gray-50 text-gray-600',
}

function StatPill(props: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-50 ring-1 ring-gray-100">{props.icon}</span>
        <span className="text-[10px] font-semibold text-gray-500">{props.label}</span>
      </div>
      <p className="mt-1.5 text-base font-bold text-gray-900">{props.value}</p>
      <p className="text-[10px] text-gray-500">{props.detail}</p>
    </div>
  )
}

type SectionItem = {
  id: string
  title: string
  subtitle: string
  accent: AccentKey
}

function SectionList({ title, icon, items, emptyHint }: { title: string; icon: React.ReactNode; items: SectionItem[]; emptyHint: string }) {
  return (
    <section className="mb-4 rounded-2xl border border-gray-100 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-50 ring-1 ring-gray-100">{icon}</span>
          <h4 className="text-xs font-semibold text-gray-800">{title}</h4>
        </div>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <div className="px-4 py-4">
          <EmptyState
            icon={icon}
            title="Sin datos"
            description={emptyHint}
          />
        </div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-2 px-4 py-2.5">
              <span className={cn('mt-0.5 inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold', ACCENT_PILL[it.accent])}>·</span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-gray-900">{it.title}</p>
                <p className="truncate text-[11px] text-gray-500">{it.subtitle}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
