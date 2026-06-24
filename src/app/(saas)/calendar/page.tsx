'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { AlertCircle, Building2, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, ExternalLink, FileText, Lock, Phone, Plus, RefreshCw, Settings2, Trash2, User, X } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/Badge'
import { UpcomingDeadlinesPanel } from '@/components/UpcomingDeadlinesPanel'
import { calendarEvents as initialEvents } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { triggerN8nWebhook } from '@/lib/integrations'
import { buildCalendarEventTimes } from '@/lib/calendar-time'
import {
  createActivity,
  createCalendarEvent,
  cancelCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvents,
  getClients,
  getWorkspaceContext,
  updateCalendarEvent,
} from '@/lib/supabase-queries'
import { listProperties, listOpportunities, listServiceCases, type PropertyRow, type OpportunityRow, type ServiceCaseRow } from '@/lib/vertical-queries'
import { commStateLabel } from '@/lib/demo/vertical-templates'
import { serviceCaseStatusLabel } from '@/components/VerticalForms'
import { EntitySelect } from '@/components/EntitySelect'
import type { CalendarEvent, EventType, GoogleCalendarConnectionStatus, GoogleCalendarListItem } from '@/lib/types'
import {
  areSameCalendarId,
  canonicalCalendarId,
  dedupeCalendarIds,
  getPrimaryCalendarRealId,
  isPrimaryAlias,
} from '@/lib/calendar-primary'

type EventStyle = {
  label: string
  accent: string
  bg: string
  text: string
  dot: string
  border: string
}

const eventTypeConfig: Record<EventType, EventStyle> = {
  visit:       { label: 'Visita',       accent: 'bg-indigo-500',  bg: 'bg-indigo-50/80',  text: 'text-indigo-900',  dot: 'bg-indigo-500',  border: 'border-indigo-200' },
  call:        { label: 'Llamada',      accent: 'bg-emerald-500', bg: 'bg-emerald-50/80', text: 'text-emerald-900', dot: 'bg-emerald-500', border: 'border-emerald-200' },
  meeting:     { label: 'Reunión',      accent: 'bg-sky-500',     bg: 'bg-sky-50/80',     text: 'text-sky-900',     dot: 'bg-sky-500',     border: 'border-sky-200' },
  'follow-up': { label: 'Seguimiento',  accent: 'bg-amber-500',   bg: 'bg-amber-50/80',   text: 'text-amber-900',   dot: 'bg-amber-500',   border: 'border-amber-200' },
  signing:     { label: 'Firma',        accent: 'bg-violet-500',  bg: 'bg-violet-50/80',  text: 'text-violet-900',  dot: 'bg-violet-500',  border: 'border-violet-200' },
  valuation:   { label: 'Valoración',   accent: 'bg-teal-500',    bg: 'bg-teal-50/80',    text: 'text-teal-900',    dot: 'bg-teal-500',    border: 'border-teal-200' },
  other:       { label: 'Otro',         accent: 'bg-gray-400',    bg: 'bg-gray-50/80',    text: 'text-gray-700',    dot: 'bg-gray-400',    border: 'border-gray-200' },
}

// Duración por defecto (min) al elegir tipo en "Nueva cita".
const DEFAULT_DURATION_BY_TYPE: Record<EventType, number> = {
  visit: 60, call: 15, meeting: 45, 'follow-up': 30, signing: 60, valuation: 45, other: 30,
}

// Lookup tolerante: un tipo desconocido/legacy (p. ej. "demo") no rompe el render.
function styleForType(type: string): EventStyle {
  if (type === 'demo') return eventTypeConfig.visit
  return eventTypeConfig[type as EventType] ?? eventTypeConfig.other
}

const googleEventStyle: EventStyle = {
  label: 'Google',
  accent: 'bg-violet-500',
  bg: 'bg-violet-50/70',
  text: 'text-violet-900',
  dot: 'bg-violet-500',
  border: 'border-violet-200',
}

const WEEK_DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
// `INITIAL_TODAY` is the module-load value used to seed `selectedDate` etc.
// The live "today" string is held in state (`todayStr`) and refreshed when
// the tab gains focus, so a session that crosses midnight stops highlighting
// yesterday as today.
const INITIAL_TODAY = toDateInput(new Date())
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7)
const GRID_START_HOUR = HOURS[0]
const ROW_HEIGHT = 56
const AGENDA_RANGE_DAYS = 45

type EventForm = {
  id?: string
  title: string
  date: string
  type: EventType
  startHour: number
  startMinute: number
  duration: number
  clientName: string
  clientId?: string | null
  propertyId?: string | null
  opportunityId?: string | null
  caseId?: string | null
  location?: string
  description: string
  durationTouched?: boolean
  googleEventId?: string
  googleCalendarId?: string
  isReadOnly?: boolean
}

const emptyEventForm: EventForm = { title: '', date: INITIAL_TODAY, type: 'visit', startHour: 10, startMinute: 0, duration: 60, clientName: '', clientId: null, propertyId: null, opportunityId: null, caseId: null, location: '', description: '' }

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function fromDateInput(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function addDays(value: string, days: number) {
  const date = fromDateInput(value)
  date.setDate(date.getDate() + days)
  return toDateInput(date)
}

function startOfDateIso(value: string) {
  const date = fromDateInput(value)
  date.setHours(0, 0, 0, 0)
  return date.toISOString()
}

function endOfDateIso(value: string) {
  const date = fromDateInput(value)
  date.setHours(23, 59, 59, 999)
  return date.toISOString()
}

function addMonths(value: string, months: number) {
  const date = fromDateInput(value)
  date.setMonth(date.getMonth() + months)
  return toDateInput(date)
}

function startOfWeek(value: string) {
  const date = fromDateInput(value)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return toDateInput(date)
}

function monthLabel(value: string) {
  return fromDateInput(value).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}

function weekRangeLabel(weekStart: string) {
  const start = fromDateInput(weekStart)
  const end = fromDateInput(addDays(weekStart, 6))
  const sameMonth = start.getMonth() === end.getMonth()
  const startStr = sameMonth
    ? start.toLocaleDateString('es-ES', { day: 'numeric' })
    : start.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  const endStr = end.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
  return `${startStr} – ${endStr}`
}

function monthCells(value: string) {
  const date = fromDateInput(value)
  const year = date.getFullYear()
  const month = date.getMonth()
  const firstOffset = (new Date(year, month, 1).getDay() || 7) - 1
  const lastDay = new Date(year, month + 1, 0).getDate()
  return [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: lastDay }, (_, index) => toDateInput(new Date(year, month, index + 1))),
  ]
}

function formatRelativeDate(dateStr: string, todayStr: string) {
  if (dateStr === todayStr) return 'Hoy'
  if (dateStr === addDays(todayStr, 1)) return 'Mañana'
  const date = fromDateInput(dateStr)
  const weekday = date.toLocaleDateString('es-ES', { weekday: 'short' })
  const monthDay = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1).replace('.', '')} ${monthDay.replace('.', '')}`
}

function formatLastSync(iso?: string | null) {
  if (!iso) return null
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (diffMin < 1) return 'Sincronizado hace unos segundos'
  if (diffMin === 1) return 'Sincronizado hace 1 minuto'
  if (diffMin < 60) return `Sincronizado hace ${diffMin} minutos`
  const hours = Math.round(diffMin / 60)
  if (hours === 1) return 'Sincronizado hace 1 hora'
  if (hours < 24) return `Sincronizado hace ${hours} horas`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Sincronizado hace 1 día' : `Sincronizado hace ${days} días`
}

function eventStartMinutes(ev: CalendarEvent) {
  return ev.startHour * 60 + (ev.startMinute ?? 0)
}

function eventEndMinutes(ev: CalendarEvent) {
  return eventStartMinutes(ev) + (ev.duration ?? 60)
}

type LaidOutEvent = { ev: CalendarEvent; col: number; cols: number }
type OverflowMarker = { startMinutes: number; endMinutes: number; count: number; events: CalendarEvent[]; col: number; cols: number }
type DayLayout = { events: LaidOutEvent[]; overflows: OverflowMarker[] }

// Hard cap on horizontal slots within a cluster (cards + overflow pill share
// the cap). Google Calendar stops slicing space around the same number: when
// an hour is jammed with 8+ overlapping events, splitting the day into 8
// columns produces unreadable cards. We cap total slots and route extras into
// a "+N más" pill the user can expand into Agenda.
const MAX_VISIBLE_COLS_PER_CLUSTER = 3

function layoutOverlappingEvents(events: CalendarEvent[]): DayLayout {
  if (!events.length) return { events: [], overflows: [] }
  const sorted = [...events].sort((a, b) => eventStartMinutes(a) - eventStartMinutes(b))
  const visible: LaidOutEvent[] = []
  const overflows: OverflowMarker[] = []
  let cluster: { ev: CalendarEvent; col: number; endsAt: number }[] = []
  let clusterMaxEnd = 0
  let clusterMinStart = Number.POSITIVE_INFINITY

  const flushCluster = () => {
    if (cluster.length === 0) return
    const rawCols = cluster.reduce((max, c) => Math.max(max, c.col + 1), 0)
    // When the cluster overflows the cap, we reserve the rightmost slot for
    // the "+N más" pill so it shares the cluster's column grid instead of
    // floating on top of the last card. Without this reservation, the pill
    // (right:2 width:34%) would collide with the col-2 event (left:66% width:33%).
    const wouldOverflow = rawCols > MAX_VISIBLE_COLS_PER_CLUSTER
    const visibleCap = wouldOverflow ? MAX_VISIBLE_COLS_PER_CLUSTER - 1 : MAX_VISIBLE_COLS_PER_CLUSTER
    const totalCols = wouldOverflow
      ? MAX_VISIBLE_COLS_PER_CLUSTER
      : Math.min(rawCols, MAX_VISIBLE_COLS_PER_CLUSTER)
    const overflowEvents: CalendarEvent[] = []
    for (const c of cluster) {
      if (c.col < visibleCap) {
        visible.push({ ev: c.ev, col: c.col, cols: totalCols })
      } else {
        overflowEvents.push(c.ev)
      }
    }
    if (overflowEvents.length > 0) {
      overflows.push({
        startMinutes: clusterMinStart,
        endMinutes: clusterMaxEnd,
        count: overflowEvents.length,
        events: overflowEvents,
        col: visibleCap,
        cols: totalCols,
      })
    }
    cluster = []
    clusterMaxEnd = 0
    clusterMinStart = Number.POSITIVE_INFINITY
  }

  for (const ev of sorted) {
    const start = eventStartMinutes(ev)
    const end = eventEndMinutes(ev)
    if (start >= clusterMaxEnd && cluster.length > 0) flushCluster()
    const used = new Set(cluster.filter((c) => c.endsAt > start).map((c) => c.col))
    let col = 0
    while (used.has(col)) col++
    cluster.push({ ev, col, endsAt: end })
    if (end > clusterMaxEnd) clusterMaxEnd = end
    if (start < clusterMinStart) clusterMinStart = start
  }
  flushCluster()
  return { events: visible, overflows }
}

function getEventStyle(ev: CalendarEvent): EventStyle {
  if (ev.syncSource === 'google') return googleEventStyle
  return styleForType(ev.type)
}

function toForm(event: CalendarEvent): EventForm {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    type: event.type,
    startHour: event.startHour,
    startMinute: event.startMinute,
    duration: event.duration,
    clientName: event.clientName ?? '',
    clientId: event.clientId ?? null,
    propertyId: event.propertyId ?? null,
    opportunityId: event.opportunityId ?? null,
    caseId: event.caseId ?? null,
    location: event.location ?? '',
    description: event.description ?? '',
    durationTouched: true,
    googleEventId: event.googleEventId,
    googleCalendarId: event.googleCalendarId,
    isReadOnly: event.isReadOnly === true,
  }
}

function accessRoleLabel(role: string): string {
  if (role === 'owner') return 'Propietario'
  if (role === 'writer') return 'Escritura'
  if (role === 'reader') return 'Solo lectura'
  if (role === 'freeBusyReader') return 'Solo disponibilidad'
  return role
}

function canWriteToCalendar(role: string): boolean {
  return role === 'owner' || role === 'writer'
}

function googleSyncFailureMessage(reason?: string) {
  if (reason === 'calendar_read_only') return 'El calendario seleccionado es de solo lectura.'
  if (reason === 'read_only_event') return 'Este evento viene de un calendario de solo lectura.'
  if (reason === 'calendar_not_selected') return 'El calendario seleccionado no esta en la sincronizacion.'
  if (reason === 'not_connected') return 'Google Calendar no esta conectado.'
  if (reason === 'no_refresh_token' || reason === 'token_refresh_failed' || reason === 'token_refresh_error') return 'Google requiere reconexion.'
  if (reason === 'credentials_not_configured') return 'Faltan credenciales de Google en el servidor.'
  if (reason === 'missing_event_times') return 'La cita no tiene fecha y hora validas.'
  if (reason === 'local_update_failed') return 'Google guardo el evento, pero el CRM no pudo confirmar la sincronizacion.'
  if (reason === 'google_api_error' || reason === 'google_fetch_error') return 'Google Calendar rechazo la operacion.'
  return 'No se pudo sincronizar con Google Calendar.'
}

// Selection identity. `selected_calendar_ids` may contain either the literal
// alias "primary" OR the user's primary calendar email-id. The UI treats both
// as the same logical selection so we never split a single calendar into two
// rows in the modal.
function isSameCalendarSelection(selectedId: string, cal: { id: string; primary?: boolean }): boolean {
  if (selectedId === cal.id) return true
  if (selectedId === 'primary' && cal.primary) return true
  if (cal.id === 'primary' && cal.primary && selectedId.includes('@')) return true
  return false
}

// Shared shape of `sync` payload returned by import-events and
// save-selected-calendars. Kept local since both routes already declare their
// own response types; this is purely for the client-side consumers. The wire
// payload no longer carries `dbErrorMessage` (raw Postgres text) so it's not
// declared here either — the friendly `reason` is the only thing the UI renders.
type SyncPayload = {
  imported?: number
  updated?: number
  cancelled?: number
  skippedAllDay?: number
  lastSyncAt?: string
  partialFailure?: boolean
  failedCalendars?: FailedCalendarInfo[]
  safeWriteFailures?: {
    calendarId: string
    calendarSummary?: string
    operation: string
    googleEventId?: string
    title?: string
    start?: string
    dbErrorCode?: string
  }[]
}

type FailedCalendarInfo = {
  id: string
  summary?: string
  errorCode: string
  reason: string
  retryable: boolean
  operation?: string
  failedEventId?: string
  failedEventTitle?: string
  failedEventStart?: string
  dbErrorCode?: string
}

// Row props for the calendars modal. Kept here so the modal can render a single
// row component for every band (editables, solo lectura, no disponibles) and we
// never lose the "Revisar / Quitar" affordance just because a calendar happens
// to be read-only or no longer returned by Google.
type CalendarRowProps = {
  cal: GoogleCalendarListItem
  selected: boolean
  selectionSize: number
  savingCalendars: boolean
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}

function CalendarRow({ cal, selected, selectionSize, savingCalendars, onToggle, onRemove }: CalendarRowProps) {
  const hasError = Boolean(cal.lastSyncError) || cal.unavailable === true
  const isUnavailable = cal.unavailable === true
  const isReadOnly = !canWriteToCalendar(cal.accessRole)
  const canRemove = selected && hasError && selectionSize > 1
  const checkboxDisabled = isUnavailable // ghost calendars can't be re-selected, only removed
  const containerTone = !selected
    ? 'border-gray-100 bg-white hover:border-gray-200'
    : hasError
      ? 'border-amber-200 bg-amber-50/60'
      : isReadOnly
        ? 'border-gray-200 bg-gray-50/40'
        : 'border-indigo-200 bg-indigo-50/60'
  const checkboxTone = !selected
    ? 'border-gray-300 bg-white'
    : hasError
      ? 'border-amber-500 bg-amber-500'
      : isReadOnly
        ? 'border-gray-400 bg-gray-400'
        : 'border-indigo-600 bg-indigo-600'
  const dotColor = cal.backgroundColor ?? (isReadOnly ? '#f59e0b' : '#6366f1')

  return (
    <div className={cn('flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all', containerTone)}>
      <button
        type="button"
        onClick={() => !checkboxDisabled && onToggle(cal.id)}
        disabled={checkboxDisabled}
        className="flex flex-1 items-start gap-3 text-left disabled:cursor-not-allowed"
      >
        <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors', checkboxTone)}>
          {selected && <Check className="h-2.5 w-2.5 text-white" />}
        </span>
        <span
          className={cn('mt-1 h-3 w-3 shrink-0 rounded-full', isUnavailable && 'opacity-50')}
          style={{ backgroundColor: dotColor }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className={cn('truncate text-xs font-semibold', isUnavailable ? 'text-gray-500' : 'text-gray-900')}>
              {cal.summary}
            </p>
            {cal.primary && (
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-700">Principal</span>
            )}
            {!cal.primary && !isUnavailable && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-gray-600">
                {isReadOnly ? 'Solo lectura' : 'Compartido'}
              </span>
            )}
            {isUnavailable && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-700">No disponible</span>
            )}
            {hasError && !isUnavailable && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">Revisar</span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-500">
            <span>{isUnavailable ? 'Sin permisos o calendario eliminado' : accessRoleLabel(cal.accessRole)}</span>
          </div>
          {hasError && cal.lastSyncError?.reason && (
            <p className="mt-1 text-[10px] leading-4 text-amber-800">
              {cal.lastSyncError.reason}
              {cal.lastSyncError.title ? ` Evento: ${cal.lastSyncError.title}.` : ''}
            </p>
          )}
        </div>
      </button>
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(cal.id)}
          disabled={savingCalendars}
          className="shrink-0 rounded-lg border border-amber-200 bg-white px-2 py-1 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50"
        >
          Quitar
        </button>
      )}
      {selected && hasError && selectionSize === 1 && (
        <span className="shrink-0 text-[10px] text-amber-700">Añade otro calendario antes de quitar este.</span>
      )}
    </div>
  )
}

export default function CalendarPage() {
  const [selectedDate, setSelectedDate] = useState(INITIAL_TODAY)
  // Live "today" — refreshed on focus/visibility so a session that crosses
  // midnight stops marking yesterday as today in the grid header and
  // mini-calendar. Used everywhere `TODAY` used to be referenced from the
  // render tree.
  const [todayStr, setTodayStr] = useState<string>(INITIAL_TODAY)
  useEffect(() => {
    function refresh() {
      const next = toDateInput(new Date())
      setTodayStr((current) => (current === next ? current : next))
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<EventForm>(emptyEventForm)
  const [saving, setSaving] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  // Entidades del CRM para vincular en "Nueva cita" (cliente/inmueble/operación/trámite).
  const [crmClients, setCrmClients] = useState<{ id: string; name: string; email?: string; phone?: string; company?: string }[]>([])
  const [crmProperties, setCrmProperties] = useState<PropertyRow[]>([])
  const [crmOpportunities, setCrmOpportunities] = useState<OpportunityRow[]>([])
  const [crmCases, setCrmCases] = useState<ServiceCaseRow[]>([])
  const [isRealMode, setIsRealMode] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [googleConnectionStatus, setGoogleConnectionStatus] = useState<GoogleCalendarConnectionStatus | 'loading'>('loading')
  const [googleSelectedCalendarIds, setGoogleSelectedCalendarIds] = useState<string[]>([])
  const [googleLastSync, setGoogleLastSync] = useState<string | null>(null)
  const [syncingGoogle, setSyncingGoogle] = useState(false)
  const [autoSyncing, setAutoSyncing] = useState(false)
  const [partialFailure, setPartialFailure] = useState(false)
  const [failedCalendars, setFailedCalendars] = useState<FailedCalendarInfo[]>([])
  const autoSyncRanRef = useRef(false)
  // Single-attempt guard for the eager calendar list load. Reset when the
  // user disconnects/reconnects Google or changes workspace so a fresh
  // connection retries; otherwise a `/list-calendars` returning `[]` or
  // failing would spin forever via the previous `length === 0` dependency.
  const initialCalendarLoadAttemptedRef = useRef(false)
  const [calendarsPanelOpen, setCalendarsPanelOpen] = useState(false)
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarListItem[]>([])
  const [loadingCalendars, setLoadingCalendars] = useState(false)
  const [savingCalendars, setSavingCalendars] = useState(false)
  const [calendarSelection, setCalendarSelection] = useState<Set<string>>(new Set())
  // Visible vs synchronised. `hiddenCalendarIds` is a purely client-side filter
  // (persisted to localStorage) over what the user wants to SEE on the grid —
  // hiding a calendar here never desincronises it from `selected_calendar_ids`.
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'week' | 'agenda'>('week')
  const overlayRef = useRef<HTMLDivElement>(null)
  const calendarsOverlayRef = useRef<HTMLDivElement>(null)
  const loadEventsRequestRef = useRef(0)
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate])
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const calendarQueryRange = useMemo(() => {
    const fromDate = viewMode === 'agenda' ? addDays(selectedDate, -1) : addDays(weekStart, -1)
    const toDate = viewMode === 'agenda' ? addDays(selectedDate, AGENDA_RANGE_DAYS) : addDays(weekEnd, 1)
    return {
      from: startOfDateIso(fromDate),
      to: endOfDateIso(toDate),
    }
  }, [selectedDate, viewMode, weekStart, weekEnd])
  const calendarDisplayRange = useMemo(() => {
    if (viewMode === 'agenda') {
      return { fromDate: selectedDate, toDate: addDays(selectedDate, AGENDA_RANGE_DAYS) }
    }
    return { fromDate: weekStart, toDate: weekEnd }
  }, [selectedDate, viewMode, weekStart, weekEnd])
  // `miniCalCursor` controls which MONTH is visible in the sidebar mini-calendar.
  // Decoupled from `selectedDate` so clicking the month chevrons only paints a
  // different month without jumping the week view. We auto-follow `selectedDate`
  // whenever it moves to a different month (e.g. via prev/next week or the
  // upcoming-events list) so the mini-cal always shows the selection in view.
  //
  // The setState is deferred via setTimeout(0) — same pattern as the
  // `hiddenCalendarIds` hydration below — so the eslint rule against
  // synchronous setState in effects (which guards against cascading renders)
  // is satisfied.
  const [miniCalCursor, setMiniCalCursor] = useState(INITIAL_TODAY)
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setMiniCalCursor((current) => (current.slice(0, 7) === selectedDate.slice(0, 7) ? current : selectedDate))
    }, 0)
    return () => window.clearTimeout(handle)
  }, [selectedDate])
  const calendarMonthCells = useMemo(() => monthCells(miniCalCursor), [miniCalCursor])

  // Week navigation. Always shift by exactly 7 days so the weekday under the
  // user's cursor (Lun, Mar, etc.) stays the same — Google Calendar's
  // behaviour. "Hoy" reads the live clock so a session that crossed midnight
  // jumps to the new day, not yesterday.
  const goPrevWeek = useCallback(() => {
    setSelectedDate((d) => addDays(d, -7))
  }, [])
  const goNextWeek = useCallback(() => {
    setSelectedDate((d) => addDays(d, 7))
  }, [])
  const goToday = useCallback(() => {
    setSelectedDate(toDateInput(new Date()))
  }, [])

  const loadEvents = useCallback(async () => {
    const requestId = loadEventsRequestRef.current + 1
    loadEventsRequestRef.current = requestId
    const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
    if (isDemoMode) {
      if (requestId !== loadEventsRequestRef.current) return
      setEvents(initialEvents)
      setWorkspaceId(null)
      setIsRealMode(false)
      setLoadError('')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError('')
    try {
      const context = await getWorkspaceContext()
      if (requestId !== loadEventsRequestRef.current) return
      const resolvedWorkspaceId = context?.workspace?.id || context?.profile?.workspace_id
      if (!resolvedWorkspaceId) {
        setEvents([])
        setWorkspaceId(null)
        setIsRealMode(false)
        setLoadError('Tu cuenta no está vinculada a un workspace. Contacta con el responsable interno.')
        return
      }

      const realEvents = await getCalendarEvents(resolvedWorkspaceId, {
        from: calendarQueryRange.from,
        to: calendarQueryRange.to,
      })
      if (requestId !== loadEventsRequestRef.current) return
      setEvents(realEvents)
      setWorkspaceId(resolvedWorkspaceId)
      setIsRealMode(true)
    } catch (error) {
      if (requestId !== loadEventsRequestRef.current) return
      setEvents([])
      setWorkspaceId(null)
      setIsRealMode(false)
      setLoadError('No se pudieron cargar los eventos del calendario. Inténtalo de nuevo en unos segundos.')
      if (process.env.NODE_ENV === 'development') console.error('[calendar/loadEvents]', error)
    } finally {
      if (requestId === loadEventsRequestRef.current) setLoading(false)
    }
  }, [calendarQueryRange.from, calendarQueryRange.to])

  const loadGoogleStatus = useCallback(async (): Promise<{ connected: boolean; lastSyncAt: string | null }> => {
    try {
      const res = await fetch('/api/integrations/google/calendar/status')
      const data = await res.json() as {
        ok?: boolean
        connection?: {
          connectionStatus?: GoogleCalendarConnectionStatus
          lastSyncAt?: string
          selectedCalendarIds?: string[]
        }
      }
      const status = data.connection?.connectionStatus ?? 'error'
      const connected = data.ok === true && status === 'connected'
      const lastSyncAt = connected ? (data.connection?.lastSyncAt ?? null) : null
      const selectedIds = Array.isArray(data.connection?.selectedCalendarIds) ? data.connection.selectedCalendarIds : []
      setGoogleConnectionStatus(status)
      setGoogleConnected(connected)
      setGoogleLastSync(lastSyncAt)
      setGoogleSelectedCalendarIds(selectedIds)
      return { connected, lastSyncAt }
    } catch {
      setGoogleConnectionStatus('error')
      setGoogleConnected(false)
      setGoogleLastSync(null)
      setGoogleSelectedCalendarIds([])
      return { connected: false, lastSyncAt: null }
    }
  }, [])

  // Single source of truth for "what does the most recent sync say about
  // partial failure". Every code path that produces a `sync` payload (manual,
  // save-selected, remove, auto-background) calls this so chip/banner never
  // drift from the latest response. Defined BEFORE the auto-sync useEffect so
  // the React Compiler can preserve memoization.
  const applySyncResult = useCallback((sync: SyncPayload) => {
    const failed = Array.isArray(sync.failedCalendars) ? sync.failedCalendars : []
    const hasPartial = Boolean(sync.partialFailure) || failed.length > 0
    setFailedCalendars(failed)
    setPartialFailure(hasPartial)
    if (sync.lastSyncAt) setGoogleLastSync(sync.lastSyncAt)
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadEvents()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadEvents])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setModalOpen(false)
        setCalendarsPanelOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Re-fetch /status whenever the tab becomes visible again or the window regains
  // focus. Fixes the case where the user connects Google in another tab/window
  // (or just returns to /calendar after OAuth) and the chip / banner are stuck
  // showing "Google no conectado" against a stale state.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible') void loadGoogleStatus()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [loadGoogleStatus])


  // Hydrate `hiddenCalendarIds` from localStorage on mount. Scoped per workspace
  // so two different workspaces on the same browser don't share visibility prefs.
  // Deferred via setTimeout(0) to keep the effect async — React's "no setState
  // synchronously in effect" rule.
  useEffect(() => {
    if (!workspaceId) return
    const handle = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(`nowcrm:hiddenCalendars:${workspaceId}`)
        if (!raw) return
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setHiddenCalendarIds(new Set(parsed.filter((v): v is string => typeof v === 'string')))
        }
      } catch { /* ignore corrupt localStorage */ }
    }, 0)
    return () => window.clearTimeout(handle)
  }, [workspaceId])

  const toggleCalendarVisibility = useCallback((calendarId: string) => {
    if (!workspaceId) return
    setHiddenCalendarIds((prev) => {
      // Hiding the primary should also hide its alias counterpart so legacy
      // rows with `google_calendar_id="primary"` disappear from the grid.
      const primaryRealId = getPrimaryCalendarRealId(googleCalendars)
      const next = new Set(prev)
      const aliasPresent = Array.from(next).some((hid) => areSameCalendarId(hid, calendarId, primaryRealId))
      if (aliasPresent) {
        for (const hid of Array.from(next)) {
          if (areSameCalendarId(hid, calendarId, primaryRealId)) next.delete(hid)
        }
      } else {
        next.add(canonicalCalendarId(calendarId, primaryRealId))
      }
      try {
        window.localStorage.setItem(`nowcrm:hiddenCalendars:${workspaceId}`, JSON.stringify(Array.from(next)))
      } catch { /* quota / private mode */ }
      return next
    })
  }, [workspaceId, googleCalendars])

  // On open: load status. If connected and last sync is older than ~2 minutes,
  // fire a silent incremental sync in background so the user sees fresh events
  // without pressing anything. We never block the UI on this — events are
  // already showing from the BD via `loadEvents`. Errors are swallowed (no toast
  // spam during silent runs); the manual "Actualizar ahora" path surfaces them.
  //
  // Guard with `autoSyncRanRef` so re-renders never re-trigger this effect (it
  // depends on `loadGoogleStatus` and `loadEvents` which are stable but could in
  // theory change identity). One auto-sync per mount is plenty.
  useEffect(() => {
    if (autoSyncRanRef.current) return
    autoSyncRanRef.current = true
    const t = window.setTimeout(async () => {
      const status = await loadGoogleStatus()
      if (!status.connected) return
      const lastMs = status.lastSyncAt ? new Date(status.lastSyncAt).getTime() : 0
      const isStale = !lastMs || Date.now() - lastMs > 2 * 60_000
      if (!isStale) return
      setAutoSyncing(true)
      try {
        const res = await fetch('/api/integrations/google/calendar/import-events', { method: 'POST' })
        const data = await res.json() as {
          ok?: boolean
          imported?: number; updated?: number; cancelled?: number
          lastSyncAt?: string; reason?: string
          partialFailure?: boolean
          failedCalendars?: FailedCalendarInfo[]
        }
        if (!data.ok || data.reason) return
        applySyncResult(data as SyncPayload)
        const total = (data.imported ?? 0) + (data.updated ?? 0) + (data.cancelled ?? 0)
        if (total > 0) {
          await loadEvents()
          if (!data.partialFailure && !(data.failedCalendars && data.failedCalendars.length > 0)) {
            toast.success('Calendario actualizado', { duration: 2500 })
          }
        }
      } catch {
        // silent — the user can press "Actualizar ahora" to get a clear error.
      } finally {
        setAutoSyncing(false)
      }
    }, 0)
    return () => window.clearTimeout(t)
  }, [loadGoogleStatus, loadEvents, applySyncResult])

  const syncGoogleCalendar = useCallback(async () => {
    if (syncingGoogle) return
    if (!googleConnected) {
      toast.info('Google Calendar no conectado', { description: 'Conecta Google Calendar en Configuración antes de sincronizar.' })
      return
    }
    setSyncingGoogle(true)
    const loadingToast = toast.loading('Buscando cambios en Google Calendar…')
    try {
      const res = await fetch('/api/integrations/google/calendar/import-events', { method: 'POST' })
      const data = await res.json() as {
        ok?: boolean
        imported?: number; updated?: number; skipped?: number; skippedAllDay?: number; cancelled?: number
        lastSyncAt?: string; reason?: string; error?: string
        partialFailure?: boolean
        failedCalendars?: { id: string; summary?: string; errorCode: string; reason: string; retryable: boolean }[]
      }
      toast.dismiss(loadingToast)
      if (!data.ok) {
        toast.error('No se pudo actualizar el calendario', { description: data.error ?? 'Inténtalo de nuevo en unos segundos.' })
        return
      }
      if (data.reason === 'no_google_connection') {
        toast.info('Google Calendar no conectado', { description: 'Conecta Google Calendar en Configuración.' })
        return
      }
      if (data.reason === 'token_refresh_failed') {
        toast.error('La sesión de Google ha expirado', { description: 'Reconecta Google Calendar en Configuración.' })
        return
      }
      if (data.reason) {
        toast.warning('Calendario no actualizado', { description: 'Inténtalo de nuevo en unos segundos.' })
        return
      }
      const imported = data.imported ?? 0
      const updated = data.updated ?? 0
      const cancelled = data.cancelled ?? 0
      const allDay = data.skippedAllDay ?? 0
      const total = imported + updated + cancelled
      const parts: string[] = []
      if (imported) parts.push(`${imported} importado${imported === 1 ? '' : 's'}`)
      if (updated) parts.push(`${updated} actualizado${updated === 1 ? '' : 's'}`)
      if (cancelled) parts.push(`${cancelled} cancelado${cancelled === 1 ? '' : 's'}`)
      const description = allDay ? `${allDay} evento${allDay === 1 ? '' : 's'} de día completo omitido${allDay === 1 ? '' : 's'}` : undefined
      applySyncResult(data as SyncPayload)
      const failed = data.failedCalendars ?? []
      if (failed.length > 0 || data.partialFailure) {
        const first = failed[0]
        toast.warning(
          failed.length === 1
            ? `Revisar 1 calendario · ${first?.summary ?? 'Calendario'}`
            : failed.length > 1
              ? `Revisar ${failed.length} calendarios`
              : 'Sincronización parcial',
          {
            description: total > 0
              ? `Tus eventos principales se actualizaron. ${parts.join(' · ')}.`
              : 'Tus eventos principales se actualizaron. Hay calendarios que necesitan revisión.',
          },
        )
      } else {
        if (total > 0) {
          toast.success('Calendario actualizado', { description: [parts.join(' · '), description].filter(Boolean).join(' · ') })
        } else {
          toast.success('No hay cambios nuevos', description ? { description } : undefined)
        }
      }
      await loadEvents()
    } catch {
      toast.dismiss(loadingToast)
      toast.error('Error de red al actualizar el calendario')
    } finally {
      setSyncingGoogle(false)
    }
  }, [googleConnected, syncingGoogle, loadEvents, applySyncResult])

  const loadGoogleCalendars = useCallback(async () => {
    if (loadingCalendars) return
    setLoadingCalendars(true)
    try {
      const res = await fetch('/api/integrations/google/calendar/list-calendars')
      const data = await res.json() as {
        ok?: boolean
        calendars?: GoogleCalendarListItem[]
        selectedCalendarIds?: string[]
        reason?: string
        error?: string
      }
      if (!data.ok) {
        toast.error('No se pudieron cargar los calendarios', { description: data.error ?? 'Revisa la conexión en Configuración.' })
        return
      }
      if (data.reason === 'no_google_connection') {
        toast.info('Google Calendar no conectado', { description: 'Conecta Google Calendar en Configuración antes de elegir calendarios.' })
        return
      }
      if (data.reason === 'token_refresh_failed') {
        toast.error('La sesión de Google ha expirado', { description: 'Reconecta Google Calendar en Configuración.' })
        return
      }
      if (data.reason) {
        toast.warning('No se pudieron cargar los calendarios', { description: data.reason })
        return
      }
      const list = data.calendars ?? []
      setGoogleCalendars(list)
      // Canonicalise the initial selection: collapse "primary" and the real
      // primary id into a single entry. Without this, a legacy
      // selected_calendar_ids of ["primary", "user@gmail.com"] would seed the
      // modal with two checkboxes both marked.
      const primaryRealId = getPrimaryCalendarRealId(list)
      const rawSelection = (data.selectedCalendarIds ?? []).length
        ? data.selectedCalendarIds!
        : list.filter((c) => c.primary).map((c) => c.id)
      let canonicalIds = dedupeCalendarIds(rawSelection, primaryRealId)
      if (canonicalIds.length === 0) {
        canonicalIds = list.filter((c) => c.selected).map((c) => c.id)
      }
      if (canonicalIds.length === 0) {
        const primary = list.find((c) => c.primary)
        if (primary) canonicalIds = [primary.id]
      }
      canonicalIds = dedupeCalendarIds(canonicalIds, primaryRealId)
      setCalendarSelection(new Set(canonicalIds))
      setGoogleSelectedCalendarIds(canonicalIds)
    } catch (err) {
      toast.error('Error de red al cargar calendarios')
      if (process.env.NODE_ENV === 'development') console.warn('[calendar/loadGoogleCalendars]', err)
    } finally {
      setLoadingCalendars(false)
    }
  }, [loadingCalendars])

  const openCalendarsPanel = useCallback(() => {
    setCalendarsPanelOpen(true)
    void loadGoogleCalendars()
  }, [loadGoogleCalendars])

  // Eagerly load the calendar list ONCE per Google connection so the sidebar
  // "Mis calendarios" widget, color resolver and label resolver have data
  // before the user opens the modal.
  //
  // Critical: guard with a ref, NOT with `googleCalendars.length === 0`.
  // If Google returns `[]` or the call fails, the array stays empty and the
  // previous version would keep retrying on every render. The ref ensures
  // exactly one attempt per connection cycle; the user can still retry
  // explicitly from the modal (which calls `loadGoogleCalendars` directly).
  //
  // Reset the attempt flag when Google disconnects (or the user changes
  // workspace) so reconnecting triggers a fresh load.
  useEffect(() => {
    if (!googleConnected) {
      initialCalendarLoadAttemptedRef.current = false
      return
    }
    if (initialCalendarLoadAttemptedRef.current) return
    if (loadingCalendars) return
    initialCalendarLoadAttemptedRef.current = true
    const handle = window.setTimeout(() => { void loadGoogleCalendars() }, 0)
    return () => window.clearTimeout(handle)
  }, [googleConnected, loadingCalendars, loadGoogleCalendars])

  // If the workspace identity changes (rare but possible: org switching),
  // forget the previous attempt so the new workspace gets a fresh load.
  useEffect(() => {
    initialCalendarLoadAttemptedRef.current = false
  }, [workspaceId])

  const saveCalendarSelection = useCallback(async () => {
    if (savingCalendars) return
    const selectedIds = Array.from(calendarSelection)
    if (selectedIds.length === 0) {
      toast.warning('Selecciona al menos un calendario.')
      return
    }
    setSavingCalendars(true)
    try {
      const calendarMetadata: Record<string, { summary?: string; accessRole?: string; backgroundColor?: string; primary?: boolean }> = {}
      for (const c of googleCalendars) {
        if (selectedIds.includes(c.id)) {
          calendarMetadata[c.id] = { summary: c.summary, accessRole: c.accessRole, backgroundColor: c.backgroundColor, primary: c.primary }
        }
      }
      const res = await fetch('/api/integrations/google/calendar/save-selected-calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedCalendarIds: selectedIds, calendarMetadata }),
      })
      const data = await res.json() as {
        ok?: boolean
        error?: string
        sync?: (SyncPayload & { skipped?: string })
      }
      if (!data.ok) {
        toast.error('No se pudo guardar la selección', { description: data.error ?? 'Inténtalo de nuevo.' })
        return
      }
      setGoogleSelectedCalendarIds(selectedIds)
      setCalendarsPanelOpen(false)
      const sync = data.sync ?? {}
      // Apply the sync result FIRST so chip/banner reflect the latest state
      // (including failedCalendars), even if the sync was skipped or partial.
      if ('skipped' in sync) {
        // Sync was deferred (e.g., no refresh token yet). Don't pollute the
        // partial-failure state with a stale list.
        applySyncResult({ partialFailure: false, failedCalendars: [], lastSyncAt: sync.lastSyncAt })
      } else {
        applySyncResult(sync)
      }
      const imported = sync.imported ?? 0
      const updated = sync.updated ?? 0
      const cancelled = sync.cancelled ?? 0
      const total = imported + updated + cancelled
      const parts: string[] = []
      if (imported) parts.push(`${imported} importado${imported === 1 ? '' : 's'}`)
      if (updated) parts.push(`${updated} actualizado${updated === 1 ? '' : 's'}`)
      if (cancelled) parts.push(`${cancelled} cancelado${cancelled === 1 ? '' : 's'}`)
      const failed = sync.failedCalendars ?? []
      if ('skipped' in sync) {
        toast.success(selectedIds.length === 1 ? 'Calendario guardado' : `${selectedIds.length} calendarios guardados`)
      } else if (failed.length > 0 || sync.partialFailure) {
        toast.warning(
          failed.length === 1
            ? `Revisar 1 calendario · ${failed[0]?.summary ?? 'Calendario'}`
            : failed.length > 1
              ? `Revisar ${failed.length} calendarios`
              : 'Sincronización parcial',
          {
            description: total > 0
              ? `${parts.join(' · ')}. Los demás se actualizaron correctamente.`
              : 'Lo reintentaremos en la próxima sincronización.',
          },
        )
      } else if (total > 0) {
        toast.success('Calendarios guardados y sincronizados', { description: parts.join(' · ') })
      } else {
        toast.success('Calendarios guardados', { description: 'No hay cambios nuevos.' })
      }
      await loadEvents()
    } catch (err) {
      toast.error('Error de red al guardar la selección')
      if (process.env.NODE_ENV === 'development') console.warn('[calendar/saveCalendarSelection]', err)
    } finally {
      setSavingCalendars(false)
    }
  }, [calendarSelection, googleCalendars, savingCalendars, loadEvents, applySyncResult])

  // Toggle a calendar in the selection set, treating "primary" and the real
  // primary id as equivalent. Without alias-aware membership the toggle would
  // ADD the real id even when the legacy `"primary"` string is already there,
  // leaving the set with BOTH — which downstream would duplicate the sync.
  const toggleCalendarInSelection = useCallback((id: string) => {
    setCalendarSelection((prev) => {
      const primaryRealId = getPrimaryCalendarRealId(googleCalendars)
      const next = new Set(prev)
      // Strip every alias variant of `id` so removing the calendar always wins.
      const aliasPresent = Array.from(next).some((sid) => areSameCalendarId(sid, id, primaryRealId))
      if (aliasPresent) {
        for (const sid of Array.from(next)) {
          if (areSameCalendarId(sid, id, primaryRealId)) next.delete(sid)
        }
      } else {
        // Add only the canonical form so the set never holds two aliases of
        // the same calendar.
        next.add(canonicalCalendarId(id, primaryRealId))
      }
      return next
    })
  }, [googleCalendars])

  // One-click "Quitar de sincronización": deselect this calendar AND immediately
  // save+sync so the partial-failure state clears without a second user step.
  // The local selection is updated optimistically and reverted if the request
  // fails — we never want the modal showing a fake state.
  const removeCalendarFromSync = useCallback(async (id: string) => {
    const previousSelection = new Set(calendarSelection)
    const remaining = Array.from(previousSelection).filter((cid) => cid !== id)
    if (remaining.length === 0) {
      toast.warning('Necesitas al menos un calendario seleccionado.', {
        description: 'Añade otro calendario antes de quitar este.',
      })
      return
    }
    setCalendarSelection(new Set(remaining))
    setSavingCalendars(true)
    try {
      const calendarMetadata: Record<string, { summary?: string; accessRole?: string; backgroundColor?: string; primary?: boolean }> = {}
      for (const c of googleCalendars) {
        if (remaining.includes(c.id)) {
          calendarMetadata[c.id] = { summary: c.summary, accessRole: c.accessRole, backgroundColor: c.backgroundColor, primary: c.primary }
        }
      }
      const res = await fetch('/api/integrations/google/calendar/save-selected-calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedCalendarIds: remaining, calendarMetadata }),
      })
      const data = await res.json() as {
        ok?: boolean
        error?: string
        reason?: string
        sync?: (SyncPayload & { skipped?: string })
      }
      if (!data.ok) {
        // Rollback the optimistic update so the modal doesn't show a fake
        // "removed" state while the calendar is still on the server.
        setCalendarSelection(previousSelection)
        toast.error('No se pudo quitar el calendario', { description: data.error ?? 'Inténtalo de nuevo.' })
        return
      }
      setGoogleSelectedCalendarIds(remaining)
      const sync = data.sync ?? {}
      if ('skipped' in sync) {
        // Save succeeded but sync didn't run (no refresh token / no calendars).
        // Don't keep a stale partial-failure list from a previous run.
        applySyncResult({ partialFailure: false, failedCalendars: [], lastSyncAt: sync.lastSyncAt })
      } else {
        applySyncResult(sync)
      }
      toast.success('Calendario quitado de la sincronización')
      // Refresh both the events grid and the list of calendars so any new
      // ghost/unavailable entries (or the removed one's marker) re-render.
      await loadEvents()
      void loadGoogleCalendars()
    } catch {
      setCalendarSelection(previousSelection)
      toast.error('Error de red al quitar el calendario')
    } finally {
      setSavingCalendars(false)
    }
  }, [calendarSelection, googleCalendars, loadEvents, applySyncResult, loadGoogleCalendars])

  // Single source of truth for the user's primary calendar id. Recomputed only
  // when the list of Google calendars changes. Downstream memos depend on this
  // so the per-event filter doesn't pay the cost of walking `googleCalendars`
  // again on every event.
  const primaryRealId = useMemo(() => getPrimaryCalendarRealId(googleCalendars), [googleCalendars])

  // Expand both selection and hidden lists to a Set of every alias variant.
  // Filter membership for an event then becomes a single O(1) `Set.has` lookup
  // instead of O(n) alias-aware comparisons per event — which was the dominant
  // cost when a user has many recurring events (each instance is one event).
  const selectedAliasSet = useMemo(() => {
    const set = new Set<string>()
    for (const sid of googleSelectedCalendarIds) {
      if (!sid) continue
      set.add(sid)
      const canonical = canonicalCalendarId(sid, primaryRealId)
      set.add(canonical)
      if (isPrimaryAlias(canonical, primaryRealId)) {
        set.add('primary')
        if (primaryRealId) set.add(primaryRealId)
      }
    }
    return set
  }, [googleSelectedCalendarIds, primaryRealId])

  const hiddenAliasSet = useMemo(() => {
    const set = new Set<string>()
    for (const hid of hiddenCalendarIds) {
      if (!hid) continue
      set.add(hid)
      const canonical = canonicalCalendarId(hid, primaryRealId)
      set.add(canonical)
      if (isPrimaryAlias(canonical, primaryRealId)) {
        set.add('primary')
        if (primaryRealId) set.add(primaryRealId)
      }
    }
    return set
  }, [hiddenCalendarIds, primaryRealId])

  // Visibility filter — three gates so the grid mirrors Google strictly:
  //
  //   • Pure CRM events (no `google_calendar_id`) always render. They're
  //     never owned by Google so the sync/visibility model doesn't apply.
  //
  //   • Google events must pass BOTH:
  //       (a) Their calendar is currently in the SAVED `selected_calendar_ids`
  //           (alias-aware via `selectedAliasSet`). The check is STRICT —
  //           when the saved selection is empty (e.g. user disconnected
  //           Google, or connected but hasn't picked calendars yet), NO
  //           Google events render.
  //       (b) Their calendar is NOT in the per-device `hiddenCalendarIds`
  //           set (alias-aware via `hiddenAliasSet`).
  //
  // We use the SAVED selection (`googleSelectedCalendarIds`) — not the
  // in-flight modal state — so the grid doesn't flicker while the user is
  // editing the calendar list. After save, /status refetches and the
  // grid catches up.
  const visibleEvents = useMemo(() => {
    if (selectedAliasSet.size === 0) {
      // Strict empty-selection rule: no Google calendars selected → no Google
      // events render at all (no ghosts from a former selection).
      return events.filter((e) => !e.googleCalendarId)
    }
    const checkHidden = hiddenAliasSet.size > 0
    return events.filter((e) => {
      if (!e.googleCalendarId) return true
      if (!selectedAliasSet.has(e.googleCalendarId)) return false
      if (checkHidden && hiddenAliasSet.has(e.googleCalendarId)) return false
      return true
    })
  }, [events, selectedAliasSet, hiddenAliasSet])

  // Defensive de-dup. The backend merge path (see `resolveDuplicateAliasRows`
  // in `_sync-engine.ts`) reconciles legacy alias duplicates on every sync,
  // but BD can still hold transient duplicates between merges or while a
  // partialFailure is pending. Without this, two rows for the same Google
  // event (one under `"primary"`, one under the email-id) render side by
  // side as if they were distinct meetings — the "Comer, descansar" pattern.
  // Key: canonical-calendar | google_event_id | start_at, so recurring
  // instances (different start_at, same gid) still render once each.
  const visibleEventsUnique = useMemo(() => {
    const seen = new Set<string>()
    const out: CalendarEvent[] = []
    let dropped = 0
    for (const e of visibleEvents) {
      let key: string
      if (e.googleEventId) {
        const canonical = e.googleCalendarId
          ? canonicalCalendarId(e.googleCalendarId, primaryRealId)
          : 'primary'
        key = `g|${canonical}|${e.googleEventId}|${e.startAt ?? e.date}`
      } else {
        key = `l|${e.id}`
      }
      if (seen.has(key)) {
        dropped++
        continue
      }
      seen.add(key)
      out.push(e)
    }
    if (dropped > 0 && process.env.NODE_ENV === 'development') {
      console.warn(`[calendar] visibleEventsUnique dropped ${dropped} visual duplicate(s)`)
    }
    return out
  }, [visibleEvents, primaryRealId])

  const visibleEventsInDisplayRange = useMemo(() => {
    return visibleEventsUnique.filter((e) => e.date >= calendarDisplayRange.fromDate && e.date <= calendarDisplayRange.toDate)
  }, [visibleEventsUnique, calendarDisplayRange.fromDate, calendarDisplayRange.toDate])

  // "Upcoming" = events that haven't ended yet. Compare on `startAt` when present
  // (precise to the minute) and fall back to `date >= todayStr` so demo events
  // without a timestamp still show up. Respects the visibility filter so the
  // sidebar matches the grid.
  const upcomingEvents = useMemo(() => {
    const nowIso = new Date().toISOString()
    return visibleEventsInDisplayRange
      .filter((e) => (e.startAt ? e.startAt >= nowIso : e.date >= todayStr))
      .sort((a, b) => {
        if (a.startAt && b.startAt) return a.startAt.localeCompare(b.startAt)
        return a.date.localeCompare(b.date) || a.startHour - b.startHour
      })
      .slice(0, 8)
  }, [visibleEventsInDisplayRange, todayStr])

  // Agenda view items for the selected bounded range, useful when the week grid
  // is too crowded to read.
  const agendaEvents = useMemo(() => {
    return visibleEventsInDisplayRange
      .sort((a, b) => {
        if (a.startAt && b.startAt) return a.startAt.localeCompare(b.startAt)
        return a.date.localeCompare(b.date) || a.startHour - b.startHour
      })
      .slice(0, 30)
  }, [visibleEventsInDisplayRange])

  // Count of events in the visible week so the sidebar's empty state can be
  // honest: "no upcoming, but here's how many you have this week".
  const eventsInVisibleWeek = useMemo(() => {
    return visibleEventsInDisplayRange.filter((e) => e.date >= weekStart && e.date <= weekEnd).length
  }, [visibleEventsInDisplayRange, weekStart, weekEnd])

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const ev of visibleEventsInDisplayRange) {
      const list = map.get(ev.date) ?? []
      list.push(ev)
      map.set(ev.date, list)
    }
    return map
  }, [visibleEventsInDisplayRange])

  // Lay out only the dates currently visible in the week grid. The previous
  // version iterated EVERY date in `eventsByDate` — including months the user
  // wasn't looking at — which is wasted work for an account with many
  // recurring events. Computing the cluster/column algorithm for ~50 dates
  // per render adds up. We still build the per-date map above (cheap) so
  // counts and mini-calendar dots stay correct.
  const eventsByDateLaidOut = useMemo(() => {
    const out = new Map<string, DayLayout>()
    for (const date of weekDates) {
      const dayEvents = eventsByDate.get(date) ?? []
      out.set(date, layoutOverlappingEvents(dayEvents))
    }
    return out
  }, [eventsByDate, weekDates])

  const selectedGoogleCalendarIds = useMemo(
    () => calendarSelection.size > 0 ? Array.from(calendarSelection) : googleSelectedCalendarIds,
    [calendarSelection, googleSelectedCalendarIds],
  )
  const writableSelectedGoogleCalendars = useMemo(
    () => googleCalendars.filter((calendar) =>
      !calendar.unavailable &&
      canWriteToCalendar(calendar.accessRole) &&
      (selectedGoogleCalendarIds.length === 0 || selectedGoogleCalendarIds.some((selectedId) => isSameCalendarSelection(selectedId, calendar))),
    ),
    [googleCalendars, selectedGoogleCalendarIds],
  )
  const defaultGoogleCalendarId = writableSelectedGoogleCalendars[0]?.id ?? selectedGoogleCalendarIds[0]

  const openCreateModal = (preset?: Partial<EventForm>) => {
    if (googleConnected && googleCalendars.length === 0 && !loadingCalendars) void loadGoogleCalendars()
    // Si el preset trae tipo pero no duración, aplica la duración por defecto de ese tipo.
    const presetDuration = preset?.type && preset.duration == null ? DEFAULT_DURATION_BY_TYPE[preset.type] : undefined
    setForm({ ...emptyEventForm, googleCalendarId: defaultGoogleCalendarId, date: selectedDate, ...preset, ...(presetDuration != null ? { duration: presetDuration } : {}) })
    setModalOpen(true)
  }

  const openEditModal = (event: CalendarEvent) => {
    setForm(toForm(event))
    setModalOpen(true)
  }

  // Carga de entidades CRM para los selectores (RLS, Promise.all, sin N+1). Solo modo real.
  useEffect(() => {
    let active = true
    void (async () => {
      if (!workspaceId) {
        if (active) { setCrmClients([]); setCrmProperties([]); setCrmOpportunities([]); setCrmCases([]) }
        return
      }
      const [cl, pr, op, ca] = await Promise.all([
        getClients(workspaceId).catch(() => [] as { id: string; name: string }[]),
        listProperties(workspaceId).catch(() => [] as PropertyRow[]),
        listOpportunities(workspaceId).catch(() => [] as OpportunityRow[]),
        listServiceCases(workspaceId).catch(() => [] as ServiceCaseRow[]),
      ])
      if (!active) return
      setCrmClients(cl as { id: string; name: string; email?: string; phone?: string; company?: string }[])
      setCrmProperties(pr)
      setCrmOpportunities(op)
      setCrmCases(ca)
    })()
    return () => { active = false }
  }, [workspaceId])

  // Mapas por id (sin N+1) y opciones humanas (nunca UUID) para los selectores.
  const clientById = useMemo(() => new Map(crmClients.map((c) => [c.id, c])), [crmClients])
  const propertyById = useMemo(() => new Map(crmProperties.map((p) => [p.id, p])), [crmProperties])
  const opportunityById = useMemo(() => new Map(crmOpportunities.map((o) => [o.id, o])), [crmOpportunities])
  const caseById = useMemo(() => new Map(crmCases.map((c) => [c.id, c])), [crmCases])

  const propertyLocation = (p?: PropertyRow): string =>
    !p ? '' : ([p.address, [p.city, p.area].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || p.title)

  const clientOptions = useMemo(
    () => crmClients.map((c) => ({ id: c.id, label: c.name || 'Cliente', sublabel: [c.email, c.phone, c.company].filter(Boolean).join(' · ') })),
    [crmClients],
  )
  const propertyOptions = useMemo(
    () => crmProperties.map((p) => ({ id: p.id, label: p.title, sublabel: [p.reference ? `Ref. ${p.reference}` : '', [p.city, p.area].filter(Boolean).join(', ')].filter(Boolean).join(' · ') })),
    [crmProperties],
  )
  const opportunityOptions = useMemo(
    () => crmOpportunities.map((o) => ({ id: o.id, label: o.title, sublabel: [o.client_id ? clientById.get(o.client_id)?.name : '', commStateLabel(o.stage, typeof o.metadata?.operation_kind === 'string' ? o.metadata.operation_kind : null)].filter(Boolean).join(' · ') })),
    [crmOpportunities, clientById],
  )
  const caseOptions = useMemo(
    () => crmCases.map((c) => ({ id: c.id, label: c.title, sublabel: [c.client_id ? clientById.get(c.client_id)?.name : '', serviceCaseStatusLabel(c.status), c.due_date ? `vence ${c.due_date}` : ''].filter(Boolean).join(' · ') })),
    [crmCases, clientById],
  )

  // Título sugerido por tipo (solo si el usuario no escribió título).
  const suggestTitle = (type: EventType, propTitle?: string, clientName?: string): string => {
    if ((type === 'visit' || type === 'valuation') && propTitle) return `${eventTypeConfig[type].label} — ${propTitle}`
    if (clientName) return `${eventTypeConfig[type].label} — ${clientName}`
    if (propTitle) return `${eventTypeConfig[type].label} — ${propTitle}`
    return ''
  }

  // Selección de entidades con autocompletado seguro (solo rellena lo vacío; todo editable).
  const pickClient = (id: string | null) => setForm((p) => ({ ...p, clientId: id, clientName: id ? (clientById.get(id)?.name ?? p.clientName) : '' }))
  const pickProperty = (id: string | null) => setForm((p) => {
    const prop = id ? propertyById.get(id) : undefined
    const next: EventForm = { ...p, propertyId: id }
    if (prop) {
      if (!p.location?.trim()) next.location = propertyLocation(prop)
      if (!p.clientId && prop.client_id) { next.clientId = prop.client_id; next.clientName = clientById.get(prop.client_id)?.name ?? p.clientName }
      if (!p.title.trim()) next.title = suggestTitle(p.type, prop.title, next.clientName)
    }
    return next
  })
  const pickOpportunity = (id: string | null) => setForm((p) => {
    const op = id ? opportunityById.get(id) : undefined
    const next: EventForm = { ...p, opportunityId: id }
    if (op) {
      if (!p.clientId && op.client_id) { next.clientId = op.client_id; next.clientName = clientById.get(op.client_id)?.name ?? p.clientName }
      if (!p.propertyId && op.property_id) { next.propertyId = op.property_id; if (!p.location?.trim()) next.location = propertyLocation(propertyById.get(op.property_id)) }
      if (!p.title.trim()) next.title = op.title
    }
    return next
  })
  const pickCase = (id: string | null) => setForm((p) => {
    const cs = id ? caseById.get(id) : undefined
    const next: EventForm = { ...p, caseId: id }
    if (cs) {
      if (!p.opportunityId && cs.opportunity_id) next.opportunityId = cs.opportunity_id
      if (!p.clientId && cs.client_id) { next.clientId = cs.client_id; next.clientName = clientById.get(cs.client_id)?.name ?? p.clientName }
      const propId = cs.property_id || (cs.opportunity_id ? opportunityById.get(cs.opportunity_id)?.property_id ?? null : null)
      if (!p.propertyId && propId) { next.propertyId = propId; if (!p.location?.trim()) next.location = propertyLocation(propertyById.get(propId)) }
      if (!p.title.trim()) next.title = cs.title
    }
    return next
  })

  type SyncEventResponse = {
    ok?: boolean
    synced?: boolean
    reason?: string
    error?: string
    googleEventId?: string
    calendarId?: string
  }

  const syncEventToGoogle = useCallback(async (localEventId: string, calendarId?: string): Promise<SyncEventResponse> => {
    if (!googleConnected) return { ok: true, synced: false, reason: 'not_connected' }
    const res = await fetch('/api/integrations/google/calendar/sync-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: localEventId, calendarId }),
    })
    const data = await res.json().catch(() => ({})) as SyncEventResponse
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || googleSyncFailureMessage(data.reason))
    }
    return data
  }, [googleConnected])

  type CancelRouteResponse = {
    ok?: boolean
    localCancelled?: boolean
    googleCancelled?: boolean
    googleAlreadyGone?: boolean
    reason?: string
    message?: string
  }

  // Calls the unified cancel-event route. This route handles BOTH Google DELETE and
  // local soft-cancel atomically when there's an active Google connection, so the UI
  // should NOT call cancelCalendarEvent locally first — that order caused the
  // previous bug where the local row was deleted before the Google call read it.
  const cancelEventViaRoute = useCallback(async (localEventId: string): Promise<CancelRouteResponse> => {
    try {
      const res = await fetch('/api/integrations/google/calendar/cancel-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localEventId }),
      })
      const data = await res.json().catch(() => ({})) as CancelRouteResponse
      return data
    } catch (err) {
      if (process.env.NODE_ENV === 'development') console.warn('[calendar/cancelEventViaRoute]', err)
      return { ok: false, reason: 'network_error', message: 'No se pudo contactar con el servidor.' }
    }
  }, [])

  function payloadFromCalendarEvent(event: CalendarEvent) {
    return {
      title: event.title,
      date: event.date,
      time: `${String(event.startHour).padStart(2, '0')}:${String(event.startMinute ?? 0).padStart(2, '0')}`,
      startHour: event.startHour,
      startMinute: event.startMinute ?? 0,
      duration: event.duration ?? 60,
      type: event.type,
      clientName: event.clientName ?? '',
      clientId: event.clientId ?? null,
      propertyId: event.propertyId ?? null,
      opportunityId: event.opportunityId ?? null,
      caseId: event.caseId ?? null,
      location: event.location ?? '',
      notes: event.notes ?? event.description ?? '',
      description: event.description ?? event.notes ?? '',
    }
  }

  const handleSave = async () => {
    if (form.isReadOnly) {
      toast.info('Este evento es solo lectura', { description: 'Viene de un calendario de Google sin permisos de escritura. Edítalo desde Google.' })
      return
    }
    if (!form.title.trim()) {
      toast.error('El título es obligatorio')
      return
    }
    if (!form.date) {
      toast.error('La fecha es obligatoria')
      return
    }

    const payload = {
      title: form.title.trim(),
      date: form.date,
      time: `${String(form.startHour).padStart(2, '0')}:${String(form.startMinute).padStart(2, '0')}`,
      startHour: Number(form.startHour),
      startMinute: Number(form.startMinute),
      duration: Number(form.duration),
      type: form.type,
      clientName: form.clientName.trim(),
      clientId: form.clientId || null,
      propertyId: form.propertyId || null,
      opportunityId: form.opportunityId || null,
      caseId: form.caseId || null,
      location: form.location?.trim() || undefined,
      notes: form.description.trim(),
      description: form.description.trim(),
    }

    const destinationCalendarId = form.googleCalendarId || defaultGoogleCalendarId

    setSaving(true)
    try {
      if (isRealMode && workspaceId) {
        if (form.id) {
          const original = events.find((event) => event.id === form.id)
          await updateCalendarEvent(form.id, workspaceId, payload)
          if (form.googleEventId) {
            const sync = await syncEventToGoogle(form.id, form.googleCalendarId)
            if (!sync.synced) {
              if (original) await updateCalendarEvent(form.id, workspaceId, payloadFromCalendarEvent(original))
              throw new Error(googleSyncFailureMessage(sync.reason))
            }
            toast.success(`Cita actualizada: ${payload.title}`, { description: 'Cambios aplicados en Google Calendar.' })
          } else {
            toast.success(`Cita actualizada: ${payload.title}`, { description: 'Cambios guardados en el CRM.' })
          }
          void createActivity(workspaceId, { type: 'call', description: `Cita actualizada: ${payload.title}`, clientName: payload.clientName }).catch(() => undefined)
        } else {
          if (googleConnected && googleNeedsCalendarSelection) {
            throw new Error('Selecciona calendarios de Google antes de crear citas sincronizadas.')
          }
          if (googleConnected && googleCalendars.length > 0 && writableSelectedGoogleCalendars.length === 0) {
            throw new Error('Selecciona un calendario editable antes de crear citas en Google.')
          }
          const created = await createCalendarEvent(workspaceId, payload)
          if (googleConnected) {
            const sync = await syncEventToGoogle(created.id, destinationCalendarId)
            if (!sync.synced) {
              await deleteCalendarEvent(created.id, workspaceId).catch(() => undefined)
              throw new Error(googleSyncFailureMessage(sync.reason))
            }
            toast.success(`Cita creada: ${payload.title}`, { description: 'Guardada en CRM y Google Calendar.' })
          } else {
            toast.success(`Cita creada en CRM: ${payload.title}`)
          }
          void createActivity(workspaceId, { type: 'call', description: `Cita creada: ${payload.title}`, clientName: payload.clientName }).catch(() => undefined)
          void triggerN8nWebhook('calendar_event_created', { workspace_id: workspaceId, mode: 'real', calendar_event: { ...payload, id: created.id } }).catch(() => undefined)
        }
        await loadEvents()
      } else {
        const times = buildCalendarEventTimes(payload)
        const localEvent: CalendarEvent = {
          id: form.id || `ev-${Date.now()}`,
          ...payload,
          startAt: times.startAtIso,
          endAt: times.endAtIso,
          date: times.date,
          startHour: times.startHour,
          startMinute: times.startMinute,
          duration: times.duration,
          clientId: payload.clientId || undefined,
          propertyId: payload.propertyId || undefined,
          opportunityId: payload.opportunityId || undefined,
          caseId: payload.caseId || undefined,
          clientName: payload.clientName || undefined,
          description: payload.description || undefined,
        }
        setEvents((prev) => form.id ? prev.map((event) => event.id === form.id ? localEvent : event) : [...prev, localEvent])
        toast.success(form.id ? `Cita actualizada: ${payload.title}` : `Cita creada en demo: ${payload.title}`)
      }
      setSelectedDate(form.date)
      setModalOpen(false)
      setForm(emptyEventForm)
    } catch (error) {
      toast.error('No se pudo guardar el evento', { description: error instanceof Error ? error.message : 'Inténtalo de nuevo en unos segundos.' })
    } finally {
      setSaving(false)
    }
  }

  // Opens the in-CRM confirmation modal (read-only events can't be cancelled here).
  const requestDelete = () => {
    if (!form.id) return
    if (form.isReadOnly) {
      toast.info('Este evento es solo lectura', { description: 'Cancélalo desde Google Calendar — el CRM no puede modificarlo.' })
      return
    }
    setCancelDialogOpen(true)
  }

  const handleDelete = async () => {
    if (!form.id) return
    setDeleting(true)
    const idToCancel = form.id
    const title = form.title || 'Evento'
    const hadGoogleEvent = Boolean(form.googleEventId)
    const useUnifiedRoute = isRealMode && Boolean(workspaceId) && (hadGoogleEvent || googleConnected)
    try {
      if (useUnifiedRoute) {
        // Unified flow: the route handles Google DELETE + local soft-cancel atomically.
        // Do NOT call cancelCalendarEvent first — the previous order caused the row to be deleted
        // before the route could read its google_event_id.
        const result = await cancelEventViaRoute(idToCancel)
        await loadEvents()

        if (result.ok && result.googleCancelled && !result.googleAlreadyGone) {
          toast.success(`Evento cancelado: ${title}`, { description: 'También se eliminó en Google Calendar.' })
          setModalOpen(false)
          setForm(emptyEventForm)
        } else if (result.ok && result.googleCancelled && result.googleAlreadyGone) {
          toast.success(`Evento cancelado: ${title}`, { description: 'En Google ya no existía.' })
          setModalOpen(false)
          setForm(emptyEventForm)
        } else if (result.ok && result.localCancelled && !result.googleCancelled) {
          // Local OK, Google not done (not_synced_to_google, not_connected, credentials_not_configured)
          const desc = result.message || 'Cancelado en el CRM. Google no se actualizó.'
          toast.success(`Evento cancelado: ${title}`, { description: desc })
          setModalOpen(false)
          setForm(emptyEventForm)
        } else if (result.reason === 'read_only_event') {
          toast.info('Este evento es solo lectura', { description: result.message || 'Cancélalo desde Google Calendar.' })
        } else if (result.reason === 'needs_reconnect') {
          toast.error('Google requiere reconexión', { description: result.message || 'Reconecta Google Calendar desde Configuración.' })
        } else if (result.reason === 'google_forbidden') {
          toast.error('Google rechazó el borrado', { description: result.message || 'Comprueba permisos del calendario en Google.' })
        } else if (result.reason === 'rate_limited') {
          toast.error('Google está limitando peticiones', { description: result.message || 'Inténtalo en unos minutos.' })
        } else if (result.reason === 'google_api_error' || result.reason === 'google_fetch_error') {
          toast.error('No se pudo cancelar en Google', { description: result.message || 'El CRM no canceló el evento local para mantener la coherencia. Inténtalo de nuevo.' })
        } else if (result.reason === 'event_not_found') {
          toast.error('Evento no encontrado', { description: 'Quizá ya estaba cancelado. Refrescando lista.' })
        } else {
          toast.error('No se pudo cancelar el evento', { description: result.message || 'Inténtalo otra vez.' })
        }
      } else if (isRealMode && workspaceId) {
        // Local-only mode (no Google connection at all and no googleEventId on the row)
        await cancelCalendarEvent(idToCancel, workspaceId)
        await loadEvents()
        toast.success(`Evento cancelado: ${title}`)
        setModalOpen(false)
        setForm(emptyEventForm)
      } else {
        // Demo / offline mode
        setEvents((prev) => prev.filter((event) => event.id !== idToCancel))
        toast.success(`Evento cancelado: ${title}`)
        setModalOpen(false)
        setForm(emptyEventForm)
      }
    } catch (error) {
      toast.error('No se pudo cancelar el evento', { description: error instanceof Error ? error.message : 'Inténtalo de nuevo en unos segundos.' })
    } finally {
      setDeleting(false)
      setCancelDialogOpen(false)
    }
  }

  const lastSyncLabel = formatLastSync(googleLastSync)
  const googleStatusLoading = googleConnectionStatus === 'loading'
  const isInitialCalendarLoading = loading && events.length === 0
  const googleNeedsCalendarSelection = googleConnected && googleSelectedCalendarIds.length === 0
  // La sincronización con Google Calendar es un módulo premium/futuro: el pack
  // básico usa el calendario interno. Ocultamos el CTA "Conecta tu Google
  // Calendar" salvo en build de operador (NOWLABS_INTERNAL) para no exponer un
  // módulo que el cliente no tiene contratado.
  const showGoogleConnectCta = !isInitialCalendarLoading && !loadError && isRealMode && !googleConnected && !googleStatusLoading && process.env.NEXT_PUBLIC_NOWLABS_INTERNAL === 'true'
  // Igual que el CTA: los indicadores de estado de Google ("Google no conectado",
  // "Sin Google Calendar") solo tienen sentido en el build de operador. En el
  // pack básico Google nunca está conectado, así que mostrarlos es solo ruido.
  const showGoogleStatus = process.env.NEXT_PUBLIC_NOWLABS_INTERNAL === 'true'
  const writableCalendars = useMemo(
    () => googleCalendars.filter((c) => !c.unavailable && canWriteToCalendar(c.accessRole)),
    [googleCalendars],
  )
  const readOnlyCalendars = useMemo(
    () => googleCalendars.filter((c) => !c.unavailable && !canWriteToCalendar(c.accessRole)),
    [googleCalendars],
  )
  const unavailableCalendars = useMemo(
    () => googleCalendars.filter((c) => c.unavailable),
    [googleCalendars],
  )
  const googleCalendarLabelById = useMemo(() => {
    const labels = new Map<string, string>()
    for (const calendar of googleCalendars) {
      labels.set(calendar.id, calendar.summary)
      if (calendar.primary) labels.set('primary', calendar.summary)
    }
    return labels
  }, [googleCalendars])

  // Per-calendar hex color, populated from Google's `backgroundColor`. Used as
  // the inline-style accent on event cards so events from different calendars
  // look visually distinct, instead of all "Google = violet".
  const googleCalendarColorById = useMemo(() => {
    const colors = new Map<string, string>()
    for (const calendar of googleCalendars) {
      if (calendar.backgroundColor) {
        colors.set(calendar.id, calendar.backgroundColor)
        if (calendar.primary) colors.set('primary', calendar.backgroundColor)
      }
    }
    return colors
  }, [googleCalendars])

  // Synced calendars that are still visible to Google (excludes ghosts) — used
  // to drive the sidebar's "Mis calendarios" mini-list.
  //
  // We derive `selected` from the SAVED `googleSelectedCalendarIds` (alias-aware),
  // not from `cal.selected` returned by /list-calendars. The latter is a snapshot
  // of what was selected when the calendar list was last fetched; after
  // "Guardar y sincronizar" the saved selection updates immediately via /status
  // but the calendar list isn't necessarily reloaded — `cal.selected` would
  // stay stale until a manual refresh, leaving the sidebar with the previous
  // checkboxes.
  const syncedVisibleCalendars = useMemo(() => {
    return googleCalendars.filter((c) => {
      if (c.unavailable) return false
      return googleSelectedCalendarIds.some((sid) => areSameCalendarId(sid, c.id, primaryRealId))
    })
  }, [googleCalendars, googleSelectedCalendarIds, primaryRealId])

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <ConfirmDialog
        open={cancelDialogOpen}
        title="Cancelar cita"
        description={`Vas a cancelar "${form.title || 'esta cita'}". No se eliminará el cliente, inmueble, operación ni trámite vinculado. Esta acción no se puede deshacer.`}
        confirmLabel="Cancelar cita"
        loadingLabel="Cancelando…"
        cancelLabel="Volver"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => { if (!deleting) setCancelDialogOpen(false) }}
      />
      <PageHeader
        title="Calendario"
        description={`${weekRangeLabel(weekStart)} · Visitas, llamadas, reuniones y vencimientos`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {showGoogleStatus && (
            <button
              type="button"
              onClick={partialFailure && googleConnected ? openCalendarsPanel : undefined}
              disabled={!partialFailure || !googleConnected}
              className={cn(
                'hidden items-center gap-2 rounded-xl border border-gray-200/80 bg-white/80 px-3 py-1.5 shadow-sm shadow-gray-950/[0.02] md:flex',
                partialFailure && googleConnected ? 'cursor-pointer hover:border-amber-200 hover:bg-amber-50' : 'cursor-default',
              )}
              title={partialFailure && googleConnected ? 'Ver calendarios que necesitan revisión' : undefined}
            >
              <span className={cn(
                'h-1.5 w-1.5 rounded-full',
                (syncingGoogle || autoSyncing) ? 'bg-amber-400 animate-pulse'
                  : partialFailure && googleConnected ? 'bg-amber-500'
                  : googleConnected ? 'bg-emerald-500'
                  : 'bg-gray-300',
              )} />
              <span className="text-xs font-medium text-gray-700">
                {syncingGoogle || autoSyncing
                  ? 'Actualizando…'
                  : partialFailure && googleConnected
                    ? failedCalendars.length === 1
                      ? 'Revisar 1 calendario'
                      : `Revisar ${failedCalendars.length || ''} calendarios`.trim()
                    : googleNeedsCalendarSelection
                      ? 'Seleccionar calendarios'
                      : googleConnected
                      ? 'Sincronización automática'
                      : googleStatusLoading
                        ? 'Comprobando Google...'
                        : 'Google no conectado'}
              </span>
              {googleConnected && !syncingGoogle && !autoSyncing && !partialFailure && lastSyncLabel && (
                <span className="text-[10px] text-gray-400">· {lastSyncLabel}</span>
              )}
            </button>
            )}
            <div className="hidden items-center gap-1 md:flex" role="group" aria-label="Navegación de semana">
              <button
                type="button"
                onClick={goPrevWeek}
                aria-label="Semana anterior"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white/80 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={goToday}
                className="rounded-lg border border-gray-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={goNextWeek}
                aria-label="Semana siguiente"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white/80 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="hidden items-center gap-0.5 rounded-lg border border-gray-200 bg-white/80 p-0.5 md:flex" role="group" aria-label="Vista">
              <button
                type="button"
                onClick={() => setViewMode('week')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  viewMode === 'week' ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900',
                )}
              >
                Semana
              </button>
              <button
                type="button"
                onClick={() => setViewMode('agenda')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  viewMode === 'agenda' ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900',
                )}
                title="Lista cronológica de próximos eventos — útil cuando la semana está saturada"
              >
                Agenda
              </button>
            </div>
            {loading && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white/80 px-2 py-1 text-[11px] font-medium text-gray-500">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Cargando rango
              </span>
            )}
            {googleConnected && (
              <Button
                size="sm"
                variant="secondary"
                onClick={openCalendarsPanel}
                title="Elegir qué calendarios de Google se sincronizan con el CRM"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Calendarios
              </Button>
            )}
            {googleConnected && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void syncGoogleCalendar()}
                disabled={syncingGoogle}
                title={lastSyncLabel ?? 'Buscar cambios en Google Calendar'}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', syncingGoogle && 'animate-spin')} />
                {syncingGoogle ? 'Actualizando…' : 'Actualizar ahora'}
              </Button>
            )}
            <Button size="sm" onClick={() => openCreateModal()}>
              <Plus className="h-3.5 w-3.5" />
              Nueva cita
            </Button>
          </div>
        }
      />

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      {!loadError && partialFailure && googleConnected && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-[12px] text-amber-900">
          <div className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-amber-900">
                Se han sincronizado tus eventos principales.
              </p>
              <p className="mt-0.5 text-[11px] leading-5 text-amber-800">
                {failedCalendars.length === 1
                  ? `Hay 1 calendario que necesita revisión${failedCalendars[0]?.summary ? `: ${failedCalendars[0].summary}` : ''}.`
                  : `Hay ${failedCalendars.length} calendarios que necesitan revisión.`}{' '}
                {failedCalendars[0]?.reason ?? 'Lo reintentaremos automáticamente en la próxima sincronización.'}
                {failedCalendars[0]?.failedEventTitle ? ` Evento: ${failedCalendars[0].failedEventTitle}.` : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => void syncGoogleCalendar()} disabled={syncingGoogle}>
              <RefreshCw className={cn('h-3.5 w-3.5', syncingGoogle && 'animate-spin')} />
              {syncingGoogle ? 'Actualizando…' : 'Actualizar ahora'}
            </Button>
            <Button size="sm" variant="secondary" onClick={openCalendarsPanel}>
              <Settings2 className="h-3.5 w-3.5" />
              Ver calendarios
            </Button>
          </div>
        </div>
      )}

      {showGoogleConnectCta && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-white px-4 py-3 shadow-sm shadow-indigo-950/[0.03]">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-indigo-100">
              <CalendarDays className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">Conecta tu Google Calendar</p>
              <p className="text-[11px] leading-5 text-gray-600">
                Cada usuario conecta su propio calendario. Las visitas y citas que crees aquí se sincronizan de forma controlada con Google Calendar.
              </p>
            </div>
          </div>
          <a
            href="/settings#google-calendar"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-gray-900"
          >
            <ExternalLink className="h-3 w-3" />
            Ir a Configuración
          </a>
        </div>
      )}

      {!loadError && googleNeedsCalendarSelection && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50/70 px-4 py-3 text-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 ring-1 ring-violet-100">
              <Settings2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900">Selecciona calendarios de Google</p>
              <p className="text-[11px] leading-5 text-gray-600">Google esta conectado. Elige al menos un calendario para activar el mirror automatico.</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={openCalendarsPanel}>
            <Settings2 className="h-3.5 w-3.5" />
            Elegir calendarios
          </Button>
        </div>
      )}

      <div className="flex gap-5" style={{ minHeight: 640, height: 'clamp(640px, calc(100vh - 12rem), 800px)' }}>
        {/* SIDEBAR */}
        <aside className="hidden w-72 shrink-0 flex-col gap-4 lg:flex">
          <div className="rounded-2xl border border-gray-200/70 bg-white p-4 shadow-sm shadow-gray-950/[0.035]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold capitalize text-gray-900">{monthLabel(miniCalCursor)}</h3>
              <div className="flex gap-0.5">
                <button onClick={() => setMiniCalCursor((c) => addMonths(c, -1))} aria-label="Mes anterior" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setMiniCalCursor((c) => addMonths(c, 1))} aria-label="Mes siguiente" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="mb-1 grid grid-cols-7">
              {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => <div key={d} className="py-1 text-center text-[10px] font-semibold text-gray-400">{d}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-y-1">
              {calendarMonthCells.map((dateStr, i) => {
                if (!dateStr) return <div key={`empty-${i}`} />
                const day = Number(dateStr.slice(-2))
                const isToday = dateStr === todayStr
                const isSelected = dateStr === selectedDate
                const dayEvents = eventsByDate.get(dateStr) ?? []
                const hasGoogle = dayEvents.some((e) => e.syncSource === 'google')
                const types = new Set(dayEvents.filter((e) => e.syncSource !== 'google').map((e) => e.type))
                // Selected wins over today visually. Otherwise navigating away
                // from today leaves the heavy "today" bubble dominating the
                // sidebar while the actual selection becomes barely visible
                // — the "el día X seguía destacado" complaint.
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(dateStr)}
                    aria-label={isToday ? `${day} (hoy)` : String(day)}
                    aria-current={isSelected ? 'date' : undefined}
                    className={cn(
                      'relative mx-auto flex h-8 w-8 flex-col items-center justify-center rounded-full text-xs font-medium transition-colors',
                      isSelected && 'bg-indigo-600 font-bold text-white shadow-sm shadow-indigo-500/40',
                      !isSelected && isToday && 'font-bold text-indigo-700 ring-1 ring-inset ring-indigo-300',
                      !isSelected && !isToday && 'text-gray-700 hover:bg-gray-100',
                    )}
                  >
                    <span>{day}</span>
                    {dayEvents.length > 0 && !isSelected && (
                      <span className="absolute -bottom-0.5 flex gap-0.5">
                        {hasGoogle && <span className={cn('h-1 w-1 rounded-full', googleEventStyle.dot)} />}
                        {Array.from(types).slice(0, 2).map((t) => (
                          <span key={t} className={cn('h-1 w-1 rounded-full', eventTypeConfig[t].dot)} />
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* MIS CALENDARIOS — toggle de visibilidad por calendario sincronizado.
              Ocultar aquí NO desincroniza; sólo filtra la vista. Sincronización
              y selección se gestionan en el modal "Calendarios". */}
          {syncedVisibleCalendars.length > 0 && (() => {
            // Derive the visible count from the calendars themselves (not from
            // `Set.size`) so stale or alias-duplicated hidden ids don't poison
            // the display. A primary calendar hidden via `"primary"` AND via
            // its email-id would otherwise be counted twice in the size. The
            // alias-aware hidden set is the same one the grid filter uses.
            const isCalendarHidden = (cal: GoogleCalendarListItem) => hiddenAliasSet.has(cal.id)
            const visibleCount = syncedVisibleCalendars.filter((cal) => !isCalendarHidden(cal)).length
            const totalAvailable = googleCalendars.filter((c) => !c.unavailable).length
            return (
            <div className="rounded-2xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.035]">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-gray-900">Mis calendarios</h3>
                <span className="text-[10px] font-medium text-gray-400">
                  {visibleCount}/{syncedVisibleCalendars.length} visibles · {syncedVisibleCalendars.length}/{totalAvailable} sincronizados
                </span>
              </div>
              <ul className="space-y-0.5 px-2 py-2">
                {syncedVisibleCalendars.map((cal) => {
                  const isHidden = isCalendarHidden(cal)
                  const dotColor = cal.backgroundColor ?? '#6366f1'
                  return (
                    <li key={cal.id}>
                      <button
                        type="button"
                        onClick={() => toggleCalendarVisibility(cal.id)}
                        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50"
                        title={isHidden ? 'Mostrar en la vista' : 'Ocultar de la vista'}
                      >
                        <span
                          className={cn('h-3 w-3 shrink-0 rounded-sm border-2', isHidden ? 'bg-white' : '')}
                          style={isHidden
                            ? { borderColor: dotColor }
                            : { backgroundColor: dotColor, borderColor: dotColor }}
                        />
                        <span className={cn('flex-1 truncate text-xs', isHidden ? 'text-gray-400' : 'text-gray-800')}>
                          {cal.summary}
                          {cal.primary && <span className="ml-1 text-[9px] font-medium text-indigo-600">·Principal</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="border-t border-gray-100 px-4 py-2 text-[10px] leading-4 text-gray-400">
                Ocultar un calendario solo afecta a esta vista. La sincronización sigue activa.
              </p>
            </div>
            )
          })()}

          <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.035]">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">Próximas citas</h3>
              {upcomingEvents.length > 0 && <span className="text-[10px] font-medium text-gray-400">{upcomingEvents.length}</span>}
            </div>
            <ul className="flex-1 space-y-2 overflow-y-auto p-3">
              {isInitialCalendarLoading && [1, 2, 3].map((item) => <li key={item} className="h-16 animate-pulse rounded-xl bg-gray-100/70" />)}
              {!isInitialCalendarLoading && upcomingEvents.map((ev) => {
                const style = getEventStyle(ev)
                const isGoogle = ev.syncSource === 'google'
                const calendarLabel = isGoogle
                  ? (ev.googleCalendarId ? googleCalendarLabelById.get(ev.googleCalendarId) : undefined) ?? 'Google'
                  : eventTypeConfig[ev.type]?.label ?? 'CRM'
                return (
                  <li
                    key={ev.id}
                    onClick={() => { setSelectedDate(ev.date); openEditModal(ev) }}
                    className="group cursor-pointer rounded-xl border border-gray-100 bg-white p-3 transition-all hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', style.dot)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-gray-900">{ev.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-500">
                          <span className="font-medium text-gray-700">{formatRelativeDate(ev.date, todayStr)}</span>
                          <span className="text-gray-300">·</span>
                          <span className="inline-flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            {String(ev.startHour).padStart(2, '0')}:{String(ev.startMinute ?? 0).padStart(2, '0')}
                          </span>
                          {ev.clientName && (
                            <>
                              <span className="text-gray-300">·</span>
                              <span className="inline-flex items-center gap-0.5 text-gray-500">
                                <User className="h-2.5 w-2.5" />
                                <span className="max-w-[120px] truncate">{ev.clientName}</span>
                              </span>
                            </>
                          )}
                          {ev.propertyId && propertyById.get(ev.propertyId) && (
                            <>
                              <span className="text-gray-300">·</span>
                              <span className="inline-flex items-center gap-0.5 text-gray-500">
                                <Building2 className="h-2.5 w-2.5" />
                                <span className="max-w-[120px] truncate">{propertyById.get(ev.propertyId)?.title}</span>
                              </span>
                            </>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {isGoogle && (
                            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                              <CalendarDays className="h-2.5 w-2.5" />
                              {calendarLabel}
                            </span>
                          )}
                          {ev.isReadOnly && (
                            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                              <Lock className="h-2.5 w-2.5" />
                              Solo lectura
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
              {!isInitialCalendarLoading && upcomingEvents.length === 0 && (
                <li className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-6 text-center">
                  <CalendarDays className="h-6 w-6 text-gray-300" />
                  <div>
                    <p className="text-xs font-semibold text-gray-700">Sin citas próximas</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {eventsInVisibleWeek > 0
                        ? `Estás viendo eventos pasados de esta semana (${eventsInVisibleWeek}).`
                        : googleConnected
                          ? 'Crea una cita o sincroniza Google.'
                          : 'Empieza creando tu primera cita.'}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => openCreateModal()}>
                    <Plus className="h-3 w-3" />
                    Nueva cita
                  </Button>
                </li>
              )}
            </ul>
          </div>

          {/* Vencen pronto — conexión con trámites/tareas del CRM */}
          <UpcomingDeadlinesPanel workspaceId={workspaceId} todayStr={todayStr} />
        </aside>

        {/* MAIN CALENDAR GRID */}
        {viewMode === 'agenda' ? (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.035]">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Agenda</h3>
                <p className="text-[11px] text-gray-500">
                  {agendaEvents.length} {agendaEvents.length === 1 ? 'cita' : 'citas'} en rango
                  {hiddenCalendarIds.size > 0 ? ' · Ocultando calendarios desactivados' : ''}
                </p>
              </div>
              <Button size="sm" onClick={() => openCreateModal()}>
                <Plus className="h-3.5 w-3.5" />
                Nueva cita
              </Button>
            </div>
            <ul className="flex-1 divide-y divide-gray-100 overflow-y-auto">
              {isInitialCalendarLoading && (
                <li className="flex items-center gap-2 px-4 py-3 text-[11px] font-medium text-gray-500">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Cargando eventos
                </li>
              )}
              {!isInitialCalendarLoading && agendaEvents.length === 0 && (
                <li className="flex flex-col items-center gap-2 p-10 text-center">
                  <CalendarDays className="h-7 w-7 text-gray-300" />
                  <p className="text-sm font-semibold text-gray-700">Sin próximas citas</p>
                  <p className="text-[11px] text-gray-500">
                    {hiddenCalendarIds.size > 0
                      ? 'Quizá tienes calendarios desactivados. Cámbialos en "Mis calendarios".'
                      : 'Crea una cita o sincroniza Google.'}
                  </p>
                </li>
              )}
              {!isInitialCalendarLoading && agendaEvents.map((ev) => {
                const calendarColor = ev.googleCalendarId ? googleCalendarColorById.get(ev.googleCalendarId) : undefined
                const calendarLabel = ev.googleCalendarId ? googleCalendarLabelById.get(ev.googleCalendarId) : undefined
                const style = getEventStyle(ev)
                return (
                  <li key={ev.id}>
                    <button
                      type="button"
                      onClick={() => openEditModal(ev)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                    >
                      {calendarColor ? (
                        <span
                          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: calendarColor }}
                        />
                      ) : (
                        <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', style.dot)} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-semibold text-gray-900">{ev.title}</p>
                          {ev.isReadOnly && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">Solo lectura</span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                          <span className="font-medium text-gray-700">{formatRelativeDate(ev.date, todayStr)}</span>
                          <span className="text-gray-300">·</span>
                          <span className="inline-flex items-center gap-0.5">
                            <Clock className="h-3 w-3" />
                            {String(ev.startHour).padStart(2, '0')}:{String(ev.startMinute ?? 0).padStart(2, '0')}
                            {ev.duration ? ` (${ev.duration} min)` : ''}
                          </span>
                          {ev.clientName && (
                            <>
                              <span className="text-gray-300">·</span>
                              <span className="inline-flex items-center gap-0.5">
                                <User className="h-3 w-3" />
                                <span className="max-w-[160px] truncate">{ev.clientName}</span>
                              </span>
                            </>
                          )}
                          {calendarLabel && (
                            <>
                              <span className="text-gray-300">·</span>
                              <span className="truncate text-gray-500" title={calendarLabel}>
                                {calendarLabel}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.035]">
          {eventsInVisibleWeek > 30 && (
            <button
              type="button"
              onClick={() => setViewMode('agenda')}
              className="flex items-center justify-between gap-2 border-b border-amber-100 bg-amber-50/70 px-4 py-1.5 text-left text-[11px] text-amber-900 transition-colors hover:bg-amber-50"
              title="Cambiar a vista Agenda"
            >
              <span>
                Semana con muchos eventos ({eventsInVisibleWeek}). Usa <span className="font-semibold">Agenda</span> para revisión rápida.
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Ver Agenda →</span>
            </button>
          )}
          <div className="flex shrink-0 border-b border-gray-100">
            <div className="w-14 shrink-0 border-r border-gray-100 px-2 py-3">
              <span className="text-[10px] font-medium text-gray-400">UTC+2</span>
            </div>
            {weekDates.map((dateStr, i) => {
              const day = WEEK_DAYS[i] ?? ''
              const isToday = dateStr === todayStr
              const isSelected = dateStr === selectedDate
              const dayEvents = eventsByDate.get(dateStr) ?? []
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDate(dateStr)}
                  className={cn(
                    'flex flex-1 cursor-pointer flex-col items-center border-r border-gray-100 py-3 transition-colors last:border-r-0',
                    isSelected && !isToday && 'bg-indigo-50/60',
                    !isSelected && 'hover:bg-gray-50',
                  )}
                >
                  <span className={cn('text-[10px] font-medium uppercase', isSelected ? 'text-indigo-600' : 'text-gray-400')}>{day}</span>
                  <span className={cn(
                    'mt-1 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold',
                    isToday && 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/40',
                    !isToday && isSelected && 'text-indigo-700',
                    !isToday && !isSelected && 'text-gray-700',
                  )}>
                    {Number(dateStr.slice(-2))}
                  </span>
                  {dayEvents.length > 0 && (
                    <span className="mt-1 text-[9px] font-medium text-gray-400">{dayEvents.length} evento{dayEvents.length === 1 ? '' : 's'}</span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="flex flex-1 overflow-y-auto">
            <div className="w-14 shrink-0 border-r border-gray-100">
              {HOURS.map((h) => (
                <div key={h} className="flex h-14 items-start justify-end pr-2 pt-1">
                  <span className="text-[10px] font-medium text-gray-400">{String(h).padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>

            <div className="flex min-w-0 flex-1">
              {weekDates.map((dateStr) => {
                const layout = eventsByDateLaidOut.get(dateStr) ?? { events: [], overflows: [] }
                const isToday = dateStr === todayStr
                return (
                  <div
                    key={dateStr}
                    onDoubleClick={() => openCreateModal({ date: dateStr })}
                    className={cn('relative min-w-0 flex-1 border-r border-gray-100 last:border-r-0', isToday && 'bg-indigo-50/20')}
                  >
                    {HOURS.map((h) => <div key={h} className="h-14 border-b border-gray-50" />)}

                    {layout.events.map(({ ev, col, cols }) => {
                      const style = getEventStyle(ev)
                      const isGoogle = ev.syncSource === 'google'
                      const topOffset = (ev.startHour - GRID_START_HOUR) * ROW_HEIGHT + (ev.startMinute / 60) * ROW_HEIGHT
                      const height = Math.max((ev.duration / 60) * ROW_HEIGHT - 2, 28)
                      const widthPct = 100 / cols
                      const leftPct = widthPct * col
                      const isTight = height < 38
                      const calendarColor = ev.googleCalendarId ? googleCalendarColorById.get(ev.googleCalendarId) : undefined
                      const calendarLabel = ev.googleCalendarId ? googleCalendarLabelById.get(ev.googleCalendarId) : undefined
                      return (
                        <button
                          key={ev.id}
                          onClick={() => openEditModal(ev)}
                          style={{ top: topOffset, height, width: `calc(${widthPct}% - 4px)`, left: `calc(${leftPct}% + 2px)` }}
                          title={`${ev.title}${ev.clientName ? ` · ${ev.clientName}` : ''} · ${String(ev.startHour).padStart(2, '0')}:${String(ev.startMinute).padStart(2, '0')} (${ev.duration} min)${isGoogle ? ` · ${calendarLabel ?? 'Google Calendar'}` : ''}${ev.isReadOnly ? ' · Solo lectura' : ''}`}
                          className={cn(
                            'group absolute flex flex-col overflow-hidden rounded-md border text-left transition-all hover:z-10 hover:shadow-lg hover:ring-2 hover:ring-gray-900/5',
                            style.bg,
                            style.border,
                          )}
                        >
                          {calendarColor
                            ? <span className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: calendarColor }} />
                            : <span className={cn('absolute left-0 top-0 h-full w-1', style.accent)} />}
                          <div className={cn('flex flex-1 flex-col gap-0.5 pl-2 pr-1.5', isTight ? 'py-0.5' : 'py-1')}>
                            <div className="flex items-start justify-between gap-1">
                              <p className={cn('truncate text-[11px] font-semibold leading-tight', style.text)}>{ev.title}</p>
                              <div className="flex shrink-0 items-center gap-0.5">
                                {ev.isReadOnly && <Lock className={cn('h-2.5 w-2.5', style.text)} />}
                                {isGoogle && <CalendarDays className={cn('h-2.5 w-2.5', style.text)} />}
                              </div>
                            </div>
                            {!isTight && (
                              <p className="truncate text-[10px] text-gray-500">
                                {String(ev.startHour).padStart(2, '0')}:{String(ev.startMinute).padStart(2, '0')}
                                {ev.duration ? ` · ${ev.duration}min` : ''}
                              </p>
                            )}
                            {height > 56 && ev.clientName && (
                              <p className="truncate text-[10px] text-gray-600">{ev.clientName}</p>
                            )}
                          </div>
                        </button>
                      )
                    })}

                    {/* Overflow pills. Each one stands in for events that
                        couldn't fit into the cluster's first MAX_VISIBLE_COLS.
                        Each pill occupies its own reserved column slot (set by
                        layoutOverlappingEvents) so it never overlaps a card.
                        Clicking jumps to Agenda focused on the cluster's day. */}
                    {layout.overflows.map((ov, ovIdx) => {
                      const top = ((ov.startMinutes / 60) - GRID_START_HOUR) * ROW_HEIGHT
                      const span = Math.max(((ov.endMinutes - ov.startMinutes) / 60) * ROW_HEIGHT, 28)
                      const widthPct = 100 / ov.cols
                      const leftPct = widthPct * ov.col
                      return (
                        <button
                          key={`ov-${dateStr}-${ovIdx}`}
                          onClick={() => { setSelectedDate(dateStr); setViewMode('agenda') }}
                          style={{
                            top,
                            height: Math.min(span, 48),
                            width: `calc(${widthPct}% - 4px)`,
                            left: `calc(${leftPct}% + 2px)`,
                          }}
                          title={`+${ov.count} eventos más a esta hora. Abrir en Agenda.`}
                          className="absolute z-10 flex items-center justify-center rounded-md border border-dashed border-gray-300 bg-white/95 px-1 text-[10px] font-semibold text-gray-700 shadow-sm transition-colors hover:border-gray-400 hover:bg-gray-50"
                        >
                          +{ov.count} más
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        )}

        {/* MODAL EDIT EVENT */}
        {modalOpen && (
          <div ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) setModalOpen(false) }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex shrink-0 items-start justify-between border-b border-gray-100 px-6 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-gray-900">{form.id ? (form.isReadOnly ? 'Ver cita' : 'Editar cita') : 'Nueva cita'}</h2>
                    {form.googleEventId && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                        <CalendarDays className="h-3 w-3" />
                        Vinculado a Google
                      </span>
                    )}
                    {form.isReadOnly && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        <Lock className="h-3 w-3" />
                        Solo lectura
                      </span>
                    )}
                  </div>
                  {!form.id && !form.isReadOnly && (
                    <p className="mt-0.5 text-[11px] text-gray-500">Programa una visita, llamada, firma o seguimiento.</p>
                  )}
                </div>
                <button onClick={() => setModalOpen(false)} aria-label="Cerrar" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
                {form.isReadOnly && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      Este evento viene de un calendario de Google solo lectura. El CRM lo tiene en cuenta para conflictos pero no puede modificarlo. Edítalo desde Google Calendar.
                    </span>
                  </div>
                )}
                {!form.id && googleConnected && (
                  <div className="rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2">
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Calendario destino</label>
                    {writableSelectedGoogleCalendars.length > 1 ? (
                      <select
                        value={form.googleCalendarId || defaultGoogleCalendarId || ''}
                        onChange={(e) => setForm((p) => ({ ...p, googleCalendarId: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-violet-100 bg-white px-3 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {writableSelectedGoogleCalendars.map((calendar) => (
                          <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>
                        ))}
                      </select>
                    ) : writableSelectedGoogleCalendars.length === 1 ? (
                      <p className="text-[11px] text-gray-600">Se creara en {writableSelectedGoogleCalendars[0].summary}.</p>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-amber-800">No hay calendarios editables seleccionados.</p>
                        <Button size="sm" variant="ghost" onClick={openCalendarsPanel}>Elegir</Button>
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Título *</label>
                  <input type="text" placeholder="Visita piso — Calle Mayor 14" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Fecha</label>
                    <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Tipo</label>
                    <select value={form.type} onChange={(e) => { const t = e.target.value as EventType; setForm((p) => ({ ...p, type: t, duration: p.durationTouched ? p.duration : (DEFAULT_DURATION_BY_TYPE[t] ?? p.duration) })) }} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
                      {(Object.keys(eventTypeConfig) as EventType[]).map((t) => <option key={t} value={t}>{eventTypeConfig[t].label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Hora</label>
                    <select value={form.startHour} onChange={(e) => setForm((p) => ({ ...p, startHour: Number(e.target.value) }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">{HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Minuto</label>
                    <select value={form.startMinute} onChange={(e) => setForm((p) => ({ ...p, startMinute: Number(e.target.value) }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
                      {[0, 15, 30, 45].map((min) => <option key={min} value={min}>:{String(min).padStart(2, '0')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Duración</label>
                    <select value={form.duration} onChange={(e) => setForm((p) => ({ ...p, duration: Number(e.target.value), durationTouched: true }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
                      {[15, 30, 45, 60, 90, 120].map((duration) => <option key={duration} value={duration}>{duration} min</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Cliente</label>
                    <EntitySelect value={form.clientId ?? null} onChange={pickClient} options={clientOptions} placeholder="Buscar cliente…" emptyText="Sin clientes disponibles" disabled={form.isReadOnly} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Inmueble</label>
                    <EntitySelect value={form.propertyId ?? null} onChange={pickProperty} options={propertyOptions} placeholder="Buscar inmueble…" emptyText="Sin inmuebles disponibles" disabled={form.isReadOnly} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Operación</label>
                    <EntitySelect value={form.opportunityId ?? null} onChange={pickOpportunity} options={opportunityOptions} placeholder="Buscar operación…" emptyText="Sin operaciones disponibles" disabled={form.isReadOnly} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Trámite</label>
                    <EntitySelect value={form.caseId ?? null} onChange={pickCase} options={caseOptions} placeholder="Buscar trámite…" emptyText="Sin trámites disponibles" disabled={form.isReadOnly} />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Ubicación</label>
                  <input type="text" placeholder="Dirección de la cita (se rellena con el inmueble)" value={form.location ?? ''} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60" />
                </div>
                {form.id && (form.clientId || form.propertyId || form.opportunityId) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[11px]">
                    <span className="font-medium text-gray-500">Abrir ficha:</span>
                    {form.clientId && <Link href={`/clients/${form.clientId}`} className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-700"><User className="h-3 w-3" /> Cliente</Link>}
                    {form.propertyId && <Link href={`/opportunities/properties/${form.propertyId}`} className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-700"><Building2 className="h-3 w-3" /> Inmueble</Link>}
                    {form.opportunityId && <Link href="/opportunities" className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-700"><FileText className="h-3 w-3" /> Operación</Link>}
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Notas</label>
                  <textarea rows={3} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} disabled={form.isReadOnly} placeholder="Objetivo de la llamada o siguiente paso..." className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60" />
                </div>
                {form.googleEventId && (
                  <a
                    href={`https://calendar.google.com/calendar/u/0/r/eventedit/${encodeURIComponent(form.googleEventId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-700 hover:text-violet-900"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Abrir en Google Calendar
                  </a>
                )}
                {form.id && isRealMode && googleConnected && !form.isReadOnly && (
                  <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                    {form.googleEventId ? 'Los cambios se aplicaran tambien en Google Calendar.' : 'Los cambios se guardaran en el CRM.'}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-6 py-4">
                {form.id && !form.isReadOnly ? (
                  <Button variant="danger" size="sm" loading={deleting} onClick={requestDelete}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Cancelar cita
                  </Button>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cerrar</Button>
                  {!form.isReadOnly && (
                    <Button size="sm" loading={saving} onClick={handleSave}>{form.id ? 'Guardar cambios' : 'Crear cita'}</Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL MULTI-CALENDAR */}
        {calendarsPanelOpen && (
          <div ref={calendarsOverlayRef} onClick={(e) => { if (e.target === calendarsOverlayRef.current) setCalendarsPanelOpen(false) }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" style={{ maxHeight: 'calc(100vh - 6rem)' }}>
              <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-violet-600" />
                  <h2 className="text-sm font-semibold text-gray-900">Calendarios de Google</h2>
                </div>
                <button onClick={() => setCalendarsPanelOpen(false)} aria-label="Cerrar" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                <p className="mb-4 text-xs text-gray-500">
                  Elige qué calendarios de Google quieres ver en el CRM. Los eventos de cada calendario aparecerán al sincronizar y se tendrán en cuenta para los conflictos del asistente.
                </p>

                {loadingCalendars && (
                  <ul className="space-y-2">
                    {[1, 2, 3, 4].map((i) => <li key={i} className="h-14 animate-pulse rounded-xl bg-gray-100/70" />)}
                  </ul>
                )}

                {!loadingCalendars && googleCalendars.length === 0 && (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-6 text-center">
                    <CalendarDays className="h-6 w-6 text-gray-300" />
                    <p className="text-xs font-semibold text-gray-700">No se han podido cargar los calendarios</p>
                    <p className="text-[11px] text-gray-400">Comprueba la conexión de Google Calendar en Configuración.</p>
                    <Button size="sm" variant="ghost" onClick={() => void loadGoogleCalendars()}>
                      <RefreshCw className="h-3 w-3" />
                      Reintentar
                    </Button>
                  </div>
                )}

                {!loadingCalendars && unavailableCalendars.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-rose-600">
                      <AlertCircle className="h-3 w-3" />
                      No disponibles ({unavailableCalendars.length})
                    </h3>
                    <p className="mb-2 text-[10px] text-gray-500">
                      Estos calendarios estaban en tu sincronización pero Google ya no nos los devuelve. Quítalos para que dejen de aparecer en avisos de revisión.
                    </p>
                    <ul className="space-y-1.5">
                      {unavailableCalendars.map((cal) => (
                        <li key={cal.id}>
                          <CalendarRow
                            cal={cal}
                            selected={calendarSelection.has(cal.id) || (cal.id === 'primary' && Array.from(calendarSelection).some((s) => s === 'primary'))}
                            selectionSize={calendarSelection.size}
                            savingCalendars={savingCalendars}
                            onToggle={toggleCalendarInSelection}
                            onRemove={(id) => void removeCalendarFromSync(id)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {!loadingCalendars && writableCalendars.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      <Check className="h-3 w-3 text-emerald-500" />
                      Editables ({writableCalendars.length})
                    </h3>
                    <ul className="space-y-1.5">
                      {writableCalendars.map((cal) => (
                        <li key={cal.id}>
                          <CalendarRow
                            cal={cal}
                            selected={Array.from(calendarSelection).some((sid) => isSameCalendarSelection(sid, cal))}
                            selectionSize={calendarSelection.size}
                            savingCalendars={savingCalendars}
                            onToggle={toggleCalendarInSelection}
                            onRemove={(id) => void removeCalendarFromSync(id)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {!loadingCalendars && readOnlyCalendars.length > 0 && (
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      <Lock className="h-3 w-3 text-amber-500" />
                      Solo lectura ({readOnlyCalendars.length})
                    </h3>
                    <p className="mb-2 text-[10px] text-gray-400">Estos calendarios se muestran para evitar conflictos, pero el CRM no puede modificarlos.</p>
                    <ul className="space-y-1.5">
                      {readOnlyCalendars.map((cal) => (
                        <li key={cal.id}>
                          <CalendarRow
                            cal={cal}
                            selected={Array.from(calendarSelection).some((sid) => isSameCalendarSelection(sid, cal))}
                            selectionSize={calendarSelection.size}
                            savingCalendars={savingCalendars}
                            onToggle={toggleCalendarInSelection}
                            onRemove={(id) => void removeCalendarFromSync(id)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
                <span className="text-[11px] text-gray-500">
                  {calendarSelection.size === 0
                    ? 'Selecciona al menos un calendario'
                    : `${calendarSelection.size} calendario${calendarSelection.size === 1 ? '' : 's'} seleccionado${calendarSelection.size === 1 ? '' : 's'}`}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setCalendarsPanelOpen(false)}>Cancelar</Button>
                  <Button size="sm" loading={savingCalendars} onClick={() => void saveCalendarSelection()} disabled={calendarSelection.size === 0 || loadingCalendars}>
                    Guardar y sincronizar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200/60 bg-white/60 px-4 py-2.5 text-[11px] text-gray-500">
        <div className="flex flex-wrap items-center gap-3">
          {(Object.keys(eventTypeConfig) as EventType[]).map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', eventTypeConfig[type].dot)} />
              {eventTypeConfig[type].label}
            </span>
          ))}
          {showGoogleStatus && (
            <span className="inline-flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', googleEventStyle.dot)} />
              Google
            </span>
          )}
        </div>
        {/* Para el cliente (pack básico) no exponemos el estado de Google: solo
            informamos de un fallo real de carga. El operador interno ve el
            estado completo de la sincronización. */}
        {showGoogleStatus ? (
          <Badge variant={googleConnected ? 'success' : loadError ? 'warning' : 'default'} dot>
            {googleConnected ? 'Google Calendar conectado' : googleStatusLoading ? 'Comprobando Google Calendar' : loadError ? 'Sin conexión' : 'Sin Google Calendar'}
          </Badge>
        ) : loadError ? (
          <Badge variant="warning" dot>Sin conexión</Badge>
        ) : null}
      </div>

      <button
        type="button"
        aria-label="Agendar llamada rápida"
        onClick={() => openCreateModal({ type: 'call', title: 'Llamada de seguimiento' })}
        className="fixed bottom-6 right-6 z-30 hidden h-12 items-center gap-2 rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 transition-transform hover:-translate-y-0.5 hover:bg-emerald-700 md:inline-flex"
      >
        <Phone className="h-4 w-4" />
        Llamada rápida
      </button>
    </motion.div>
  )
}
