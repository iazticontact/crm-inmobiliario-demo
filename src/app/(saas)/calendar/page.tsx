'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, ExternalLink, Lock, Phone, Plus, RefreshCw, Settings2, Trash2, User, X } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { calendarEvents as initialEvents } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { triggerN8nWebhook } from '@/lib/integrations'
import { buildCalendarEventTimes } from '@/lib/calendar-time'
import {
  createActivity,
  createCalendarEvent,
  cancelCalendarEvent,
  getCalendarEvents,
  getWorkspaceContext,
  updateCalendarEvent,
} from '@/lib/supabase-queries'
import type { CalendarEvent, EventType, GoogleCalendarListItem } from '@/lib/types'

type EventStyle = {
  label: string
  accent: string
  bg: string
  text: string
  dot: string
  border: string
}

const eventTypeConfig: Record<EventType, EventStyle> = {
  demo:        { label: 'Demo',         accent: 'bg-indigo-500',  bg: 'bg-indigo-50/80',  text: 'text-indigo-900',  dot: 'bg-indigo-500',  border: 'border-indigo-200' },
  call:        { label: 'Llamada',      accent: 'bg-emerald-500', bg: 'bg-emerald-50/80', text: 'text-emerald-900', dot: 'bg-emerald-500', border: 'border-emerald-200' },
  meeting:     { label: 'Reunión',      accent: 'bg-sky-500',     bg: 'bg-sky-50/80',     text: 'text-sky-900',     dot: 'bg-sky-500',     border: 'border-sky-200' },
  'follow-up': { label: 'Seguimiento',  accent: 'bg-amber-500',   bg: 'bg-amber-50/80',   text: 'text-amber-900',   dot: 'bg-amber-500',   border: 'border-amber-200' },
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
const TODAY = toDateInput(new Date())
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7)
const GRID_START_HOUR = HOURS[0]
const ROW_HEIGHT = 56

type EventForm = {
  id?: string
  title: string
  date: string
  type: EventType
  startHour: number
  startMinute: number
  duration: number
  clientName: string
  description: string
  googleEventId?: string
  googleCalendarId?: string
  isReadOnly?: boolean
}

const emptyEventForm: EventForm = { title: '', date: TODAY, type: 'meeting', startHour: 10, startMinute: 0, duration: 60, clientName: '', description: '' }

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

function formatRelativeDate(dateStr: string) {
  if (dateStr === TODAY) return 'Hoy'
  if (dateStr === addDays(TODAY, 1)) return 'Mañana'
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

function layoutOverlappingEvents(events: CalendarEvent[]): LaidOutEvent[] {
  if (!events.length) return []
  const sorted = [...events].sort((a, b) => eventStartMinutes(a) - eventStartMinutes(b))
  const result: LaidOutEvent[] = []
  let cluster: { ev: CalendarEvent; col: number; endsAt: number }[] = []
  let clusterMaxEnd = 0

  const flushCluster = () => {
    const cols = cluster.reduce((max, c) => Math.max(max, c.col + 1), 0)
    for (const c of cluster) result.push({ ev: c.ev, col: c.col, cols })
    cluster = []
    clusterMaxEnd = 0
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
  }
  flushCluster()
  return result
}

function getEventStyle(ev: CalendarEvent): EventStyle {
  if (ev.syncSource === 'google') return googleEventStyle
  return eventTypeConfig[ev.type] ?? eventTypeConfig.meeting
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
    description: event.description ?? '',
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

export default function CalendarPage() {
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<EventForm>(emptyEventForm)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isRealMode, setIsRealMode] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [googleLastSync, setGoogleLastSync] = useState<string | null>(null)
  const [syncingGoogle, setSyncingGoogle] = useState(false)
  const [calendarsPanelOpen, setCalendarsPanelOpen] = useState(false)
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarListItem[]>([])
  const [loadingCalendars, setLoadingCalendars] = useState(false)
  const [savingCalendars, setSavingCalendars] = useState(false)
  const [calendarSelection, setCalendarSelection] = useState<Set<string>>(new Set())
  const overlayRef = useRef<HTMLDivElement>(null)
  const calendarsOverlayRef = useRef<HTMLDivElement>(null)
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate])
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const calendarMonthCells = useMemo(() => monthCells(selectedDate), [selectedDate])

  const loadEvents = useCallback(async () => {
    const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
    if (isDemoMode) {
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
      const resolvedWorkspaceId = context?.workspace?.id || context?.profile?.workspace_id
      if (!resolvedWorkspaceId) {
        setEvents([])
        setWorkspaceId(null)
        setIsRealMode(false)
        setLoadError('No se ha encontrado workspace real. No se muestran eventos demo en modo real.')
        return
      }

      const realEvents = await getCalendarEvents(resolvedWorkspaceId)
      setEvents(realEvents)
      setWorkspaceId(resolvedWorkspaceId)
      setIsRealMode(true)
    } catch (error) {
      setEvents([])
      setWorkspaceId(null)
      setIsRealMode(false)
      const message = error instanceof Error ? error.message : 'Revisa RLS o columnas de calendar_events.'
      setLoadError(process.env.NODE_ENV === 'development' ? `No se pudieron cargar eventos reales: ${message}` : 'No se pudieron cargar eventos reales. Revisa RLS o columnas de calendar_events.')
      if (process.env.NODE_ENV === 'development') console.error('[calendar/loadEvents]', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/google/calendar/status')
      const data = await res.json() as { ok?: boolean; connection?: { connectionStatus?: string; lastSyncAt?: string } }
      const connected = data.ok === true && data.connection?.connectionStatus === 'connected'
      setGoogleConnected(connected)
      setGoogleLastSync(connected ? (data.connection?.lastSyncAt ?? null) : null)
    } catch {
      setGoogleConnected(false)
      setGoogleLastSync(null)
    }
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

  useEffect(() => {
    const t = window.setTimeout(() => { void loadGoogleStatus() }, 0)
    return () => window.clearTimeout(t)
  }, [loadGoogleStatus])

  const syncGoogleCalendar = useCallback(async () => {
    if (syncingGoogle) return
    if (!googleConnected) {
      toast.info('Google Calendar no conectado', { description: 'Conecta Google Calendar en Configuración antes de sincronizar.' })
      return
    }
    setSyncingGoogle(true)
    const loadingToast = toast.loading('Sincronizando Google Calendar…')
    try {
      const res = await fetch('/api/integrations/google/calendar/import-events', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; imported?: number; updated?: number; skipped?: number; skippedAllDay?: number; cancelled?: number; lastSyncAt?: string; reason?: string; error?: string }
      toast.dismiss(loadingToast)
      if (!data.ok) {
        toast.error('Error al sincronizar Google Calendar', { description: data.error ?? 'Revisa la conexión en Configuración.' })
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
        toast.warning('Google Calendar no sincronizado', { description: data.reason })
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
      if (cancelled) parts.push(`${cancelled} cancelado${cancelled === 1 ? '' : 's'} en Google`)
      const description = allDay ? `${allDay} evento(s) de día completo omitidos` : undefined
      if (total > 0) {
        toast.success(parts.join(' · '), description ? { description } : undefined)
      } else {
        toast.success('Google Calendar ya estaba al día', description ? { description } : undefined)
      }
      if (data.lastSyncAt) setGoogleLastSync(data.lastSyncAt)
      await loadEvents()
    } catch {
      toast.dismiss(loadingToast)
      toast.error('Error de red al sincronizar Google Calendar')
    } finally {
      setSyncingGoogle(false)
    }
  }, [googleConnected, syncingGoogle, loadEvents])

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
      const initial = new Set<string>(
        (data.selectedCalendarIds ?? []).length
          ? data.selectedCalendarIds!
          : list.filter((c) => c.primary).map((c) => c.id),
      )
      if (initial.size === 0) list.forEach((c) => { if (c.selected) initial.add(c.id) })
      if (initial.size === 0) {
        const primary = list.find((c) => c.primary)
        if (primary) initial.add(primary.id)
      }
      setCalendarSelection(initial)
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
      const data = await res.json() as { ok?: boolean; mode?: string; error?: string }
      if (!data.ok) {
        toast.error('No se pudo guardar la selección', { description: data.error ?? 'Inténtalo de nuevo.' })
        return
      }
      toast.success(
        selectedIds.length === 1 ? 'Calendario guardado' : `${selectedIds.length} calendarios guardados`,
        data.mode === 'legacy_single'
          ? { description: 'Schema legacy detectado — solo el primer calendario se sincronizará. Aplica la migración multi-calendar.' }
          : undefined,
      )
      setCalendarsPanelOpen(false)
      void syncGoogleCalendar()
    } catch (err) {
      toast.error('Error de red al guardar la selección')
      if (process.env.NODE_ENV === 'development') console.warn('[calendar/saveCalendarSelection]', err)
    } finally {
      setSavingCalendars(false)
    }
  }, [calendarSelection, googleCalendars, savingCalendars, syncGoogleCalendar])

  const toggleCalendarInSelection = useCallback((id: string) => {
    setCalendarSelection((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const upcomingEvents = useMemo(() => events
    .filter((e) => e.date >= TODAY)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
    .slice(0, 8), [events])

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const ev of events) {
      const list = map.get(ev.date) ?? []
      list.push(ev)
      map.set(ev.date, list)
    }
    return map
  }, [events])

  const eventsByDateLaidOut = useMemo(() => {
    const out = new Map<string, LaidOutEvent[]>()
    for (const [date, dayEvents] of eventsByDate) {
      out.set(date, layoutOverlappingEvents(dayEvents))
    }
    return out
  }, [eventsByDate])

  const openCreateModal = (preset?: Partial<EventForm>) => {
    setForm({ ...emptyEventForm, date: selectedDate, ...preset })
    setModalOpen(true)
  }

  const openEditModal = (event: CalendarEvent) => {
    setForm(toForm(event))
    setModalOpen(true)
  }

  const syncEventToGoogle = useCallback(async (localEventId: string) => {
    if (!googleConnected) return
    try {
      await fetch('/api/integrations/google/calendar/sync-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: localEventId }),
      })
    } catch (err) {
      if (process.env.NODE_ENV === 'development') console.warn('[calendar/syncEventToGoogle]', err)
    }
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
      notes: form.description.trim(),
      description: form.description.trim(),
    }

    setSaving(true)
    try {
      if (isRealMode && workspaceId) {
        if (form.id) {
          await updateCalendarEvent(form.id, workspaceId, payload)
          void createActivity(workspaceId, { type: 'call', description: `Evento actualizado: ${payload.title}`, clientName: payload.clientName }).catch(() => undefined)
          if (form.googleEventId) {
            void syncEventToGoogle(form.id)
            toast.success(`Evento actualizado: ${payload.title}`, { description: googleConnected ? 'Actualizando en Google Calendar…' : undefined })
          } else {
            toast.success(`Evento actualizado: ${payload.title}`)
          }
        } else {
          const created = await createCalendarEvent(workspaceId, payload)
          void createActivity(workspaceId, { type: 'call', description: `Evento creado: ${payload.title}`, clientName: payload.clientName }).catch(() => undefined)
          void triggerN8nWebhook('calendar_event_created', { workspace_id: workspaceId, mode: 'real', calendar_event: { ...payload, id: created.id } }).catch(() => undefined)
          if (googleConnected) {
            void syncEventToGoogle(created.id)
            toast.success(`Evento guardado: ${payload.title}`, { description: 'Sincronizando con Google Calendar…' })
          } else {
            toast.success(`Evento guardado: ${payload.title}`)
          }
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
          clientName: payload.clientName || undefined,
          description: payload.description || undefined,
        }
        setEvents((prev) => form.id ? prev.map((event) => event.id === form.id ? localEvent : event) : [...prev, localEvent])
        toast.success(form.id ? `Evento actualizado: ${payload.title}` : `Evento creado en demo: ${payload.title}`)
      }
      setSelectedDate(form.date)
      setModalOpen(false)
      setForm(emptyEventForm)
    } catch (error) {
      toast.error('No se pudo guardar el evento', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!form.id) return
    if (form.isReadOnly) {
      toast.info('Este evento es solo lectura', { description: 'Cancélalo desde Google Calendar — el CRM no puede modificarlo.' })
      return
    }
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
      toast.error('No se pudo cancelar el evento', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    } finally {
      setDeleting(false)
    }
  }

  const lastSyncLabel = formatLastSync(googleLastSync)
  const writableCalendars = useMemo(() => googleCalendars.filter((c) => canWriteToCalendar(c.accessRole)), [googleCalendars])
  const readOnlyCalendars = useMemo(() => googleCalendars.filter((c) => !canWriteToCalendar(c.accessRole)), [googleCalendars])

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Calendar"
        description={`${weekRangeLabel(weekStart)} · Visitas, asesorías y disponibilidad`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="hidden items-center gap-2 rounded-xl border border-gray-200/80 bg-white/80 px-3 py-1.5 shadow-sm shadow-gray-950/[0.02] md:flex">
              <span className={cn('h-1.5 w-1.5 rounded-full', googleConnected ? 'bg-emerald-500' : 'bg-gray-300')} />
              <span className="text-xs font-medium text-gray-700">
                {googleConnected ? 'Google Calendar conectado' : 'Google no conectado'}
              </span>
              {googleConnected && lastSyncLabel && (
                <span className="text-[10px] text-gray-400">· {lastSyncLabel}</span>
              )}
            </div>
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
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void syncGoogleCalendar()}
              disabled={syncingGoogle || !googleConnected}
              title={googleConnected ? (lastSyncLabel ?? 'Importar eventos de Google Calendar') : 'Conecta Google Calendar en Configuración'}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', syncingGoogle && 'animate-spin')} />
              {syncingGoogle ? 'Sincronizando…' : 'Sincronizar'}
            </Button>
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

      <div className="flex gap-5" style={{ minHeight: 640, height: 'clamp(640px, calc(100vh - 12rem), 800px)' }}>
        {/* SIDEBAR */}
        <aside className="hidden w-72 shrink-0 flex-col gap-4 lg:flex">
          <div className="rounded-2xl border border-gray-200/70 bg-white p-4 shadow-sm shadow-gray-950/[0.035]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold capitalize text-gray-900">{monthLabel(selectedDate)}</h3>
              <div className="flex gap-0.5">
                <button onClick={() => setSelectedDate(addMonths(selectedDate, -1))} aria-label="Mes anterior" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setSelectedDate(addMonths(selectedDate, 1))} aria-label="Mes siguiente" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
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
                const isToday = dateStr === TODAY
                const isSelected = dateStr === selectedDate
                const dayEvents = eventsByDate.get(dateStr) ?? []
                const hasGoogle = dayEvents.some((e) => e.syncSource === 'google')
                const types = new Set(dayEvents.filter((e) => e.syncSource !== 'google').map((e) => e.type))
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(dateStr)}
                    className={cn(
                      'relative mx-auto flex h-8 w-8 flex-col items-center justify-center rounded-full text-xs font-medium transition-colors',
                      isSelected && !isToday && 'bg-indigo-100 text-indigo-700',
                      isToday && 'bg-indigo-600 font-bold text-white shadow-sm shadow-indigo-500/40',
                      !isSelected && !isToday && 'text-gray-700 hover:bg-gray-100',
                    )}
                  >
                    <span>{day}</span>
                    {dayEvents.length > 0 && !isToday && (
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

          <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.035]">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">Próximos eventos</h3>
              {upcomingEvents.length > 0 && <span className="text-[10px] font-medium text-gray-400">{upcomingEvents.length}</span>}
            </div>
            <ul className="flex-1 space-y-2 overflow-y-auto p-3">
              {loading && [1, 2, 3].map((item) => <li key={item} className="h-16 animate-pulse rounded-xl bg-gray-100/70" />)}
              {!loading && upcomingEvents.map((ev) => {
                const style = getEventStyle(ev)
                const isGoogle = ev.syncSource === 'google'
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
                          <span className="font-medium text-gray-700">{formatRelativeDate(ev.date)}</span>
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
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {isGoogle && (
                            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                              <CalendarDays className="h-2.5 w-2.5" />
                              Google
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
              {!loading && upcomingEvents.length === 0 && (
                <li className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-6 text-center">
                  <CalendarDays className="h-6 w-6 text-gray-300" />
                  <div>
                    <p className="text-xs font-semibold text-gray-700">Sin próximos eventos</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">{googleConnected ? 'Crea una cita o sincroniza Google.' : 'Crea una cita para empezar.'}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => openCreateModal()}>
                    <Plus className="h-3 w-3" />
                    Nueva cita
                  </Button>
                </li>
              )}
            </ul>
          </div>
        </aside>

        {/* MAIN CALENDAR GRID */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.035]">
          <div className="flex shrink-0 border-b border-gray-100">
            <div className="w-14 shrink-0 border-r border-gray-100 px-2 py-3">
              <span className="text-[10px] font-medium text-gray-400">UTC+2</span>
            </div>
            {weekDates.map((dateStr, i) => {
              const day = WEEK_DAYS[i] ?? ''
              const isToday = dateStr === TODAY
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
                const laidOut = eventsByDateLaidOut.get(dateStr) ?? []
                const isToday = dateStr === TODAY
                return (
                  <div
                    key={dateStr}
                    onDoubleClick={() => openCreateModal({ date: dateStr })}
                    className={cn('relative min-w-0 flex-1 border-r border-gray-100 last:border-r-0', isToday && 'bg-indigo-50/20')}
                  >
                    {HOURS.map((h) => <div key={h} className="h-14 border-b border-gray-50" />)}

                    {laidOut.map(({ ev, col, cols }) => {
                      const style = getEventStyle(ev)
                      const isGoogle = ev.syncSource === 'google'
                      const topOffset = (ev.startHour - GRID_START_HOUR) * ROW_HEIGHT + (ev.startMinute / 60) * ROW_HEIGHT
                      const height = Math.max((ev.duration / 60) * ROW_HEIGHT - 2, 28)
                      const widthPct = 100 / cols
                      const leftPct = widthPct * col
                      const isTight = height < 38
                      return (
                        <button
                          key={ev.id}
                          onClick={() => openEditModal(ev)}
                          style={{ top: topOffset, height, width: `calc(${widthPct}% - 4px)`, left: `calc(${leftPct}% + 2px)` }}
                          title={`${ev.title}${ev.clientName ? ` · ${ev.clientName}` : ''} · ${String(ev.startHour).padStart(2, '0')}:${String(ev.startMinute).padStart(2, '0')} (${ev.duration} min)${isGoogle ? ' · Google Calendar' : ''}${ev.isReadOnly ? ' · Solo lectura' : ''}`}
                          className={cn(
                            'group absolute flex flex-col overflow-hidden rounded-md border text-left transition-all hover:z-10 hover:shadow-lg hover:ring-2 hover:ring-gray-900/5',
                            style.bg,
                            style.border,
                          )}
                        >
                          <span className={cn('absolute left-0 top-0 h-full w-1', style.accent)} />
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
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* MODAL EDIT EVENT */}
        {modalOpen && (
          <div ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) setModalOpen(false) }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-900">{form.id ? (form.isReadOnly ? 'Ver evento' : 'Editar evento') : 'Nuevo evento'}</h2>
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
                <button onClick={() => setModalOpen(false)} aria-label="Cerrar" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-6 py-5">
                {form.isReadOnly && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      Este evento viene de un calendario de Google solo lectura. El CRM lo tiene en cuenta para conflictos pero no puede modificarlo. Edítalo desde Google Calendar.
                    </span>
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Título *</label>
                  <input type="text" placeholder="Demo con cliente" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Fecha</label>
                    <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Tipo</label>
                    <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as EventType }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
                      <option value="meeting">Reunión</option>
                      <option value="call">Llamada</option>
                      <option value="demo">Demo</option>
                      <option value="follow-up">Seguimiento</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Hora</label>
                    <select value={form.startHour} onChange={(e) => setForm((p) => ({ ...p, startHour: Number(e.target.value) }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">{HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Min</label>
                    <select value={form.startMinute} onChange={(e) => setForm((p) => ({ ...p, startMinute: Number(e.target.value) }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
                      {[0, 15, 30, 45].map((min) => <option key={min} value={min}>:{String(min).padStart(2, '0')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Duración</label>
                    <select value={form.duration} onChange={(e) => setForm((p) => ({ ...p, duration: Number(e.target.value) }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
                      {[15, 30, 45, 60, 90, 120].map((duration) => <option key={duration} value={duration}>{duration} min</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Cliente</label>
                  <input type="text" placeholder="Ana Rodríguez" value={form.clientName} onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))} disabled={form.isReadOnly} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60" />
                </div>
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
                    Los cambios{form.googleEventId ? ' se aplicarán también en Google Calendar' : ' se sincronizarán con Google Calendar al guardar'}.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
                {form.id && !form.isReadOnly ? (
                  <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Cancelar evento
                  </Button>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>{form.isReadOnly ? 'Cerrar' : 'Cerrar'}</Button>
                  {!form.isReadOnly && (
                    <Button size="sm" loading={saving} onClick={handleSave}>{form.id ? 'Guardar cambios' : 'Crear evento'}</Button>
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

                {!loadingCalendars && writableCalendars.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      <Check className="h-3 w-3 text-emerald-500" />
                      Editables ({writableCalendars.length})
                    </h3>
                    <ul className="space-y-1.5">
                      {writableCalendars.map((cal) => {
                        const selected = calendarSelection.has(cal.id)
                        return (
                          <li key={cal.id}>
                            <button
                              onClick={() => toggleCalendarInSelection(cal.id)}
                              className={cn(
                                'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all',
                                selected ? 'border-indigo-200 bg-indigo-50/60' : 'border-gray-100 bg-white hover:border-gray-200',
                              )}
                            >
                              <span
                                className={cn(
                                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors',
                                  selected ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300 bg-white',
                                )}
                              >
                                {selected && <Check className="h-2.5 w-2.5 text-white" />}
                              </span>
                              <span
                                className="h-3 w-3 shrink-0 rounded-full"
                                style={{ backgroundColor: cal.backgroundColor ?? '#6366f1' }}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-gray-900">{cal.summary}</p>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-500">
                                  {cal.primary && <span className="font-medium text-indigo-600">Principal</span>}
                                  {cal.primary && <span className="text-gray-300">·</span>}
                                  <span>{accessRoleLabel(cal.accessRole)}</span>
                                </div>
                              </div>
                            </button>
                          </li>
                        )
                      })}
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
                      {readOnlyCalendars.map((cal) => {
                        const selected = calendarSelection.has(cal.id)
                        return (
                          <li key={cal.id}>
                            <button
                              onClick={() => toggleCalendarInSelection(cal.id)}
                              className={cn(
                                'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all',
                                selected ? 'border-amber-200 bg-amber-50/60' : 'border-gray-100 bg-white hover:border-gray-200',
                              )}
                            >
                              <span
                                className={cn(
                                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors',
                                  selected ? 'border-amber-500 bg-amber-500' : 'border-gray-300 bg-white',
                                )}
                              >
                                {selected && <Check className="h-2.5 w-2.5 text-white" />}
                              </span>
                              <span
                                className="h-3 w-3 shrink-0 rounded-full"
                                style={{ backgroundColor: cal.backgroundColor ?? '#f59e0b' }}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-gray-900">{cal.summary}</p>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-500">
                                  <span className="inline-flex items-center gap-0.5 font-medium text-amber-700">
                                    <Lock className="h-2 w-2" />
                                    {accessRoleLabel(cal.accessRole)}
                                  </span>
                                </div>
                              </div>
                            </button>
                          </li>
                        )
                      })}
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
          <span className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', googleEventStyle.dot)} />
            Google
          </span>
        </div>
        <Badge variant={isRealMode ? 'success' : loadError ? 'warning' : 'indigo'} dot>
          {isRealMode ? 'Datos reales' : loadError ? 'Sin datos reales' : 'Modo demo'}
        </Badge>
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
