'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, ChevronLeft, ChevronRight, Clock, Phone, Plus, Trash2, User, X } from 'lucide-react'
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
  deleteCalendarEvent,
  getCalendarEvents,
  getWorkspaceContext,
  updateCalendarEvent,
} from '@/lib/supabase-queries'
import type { CalendarEvent, EventType } from '@/lib/types'

const eventTypeConfig: Record<EventType, { label: string; color: string; bg: string; border: string }> = {
  demo: { label: 'Demo', color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
  call: { label: 'Llamada', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  meeting: { label: 'Reunión', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  'follow-up': { label: 'Seguimiento', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
}

const eventVariant: Record<EventType, 'indigo' | 'success' | 'info' | 'warning'> = {
  demo: 'indigo',
  call: 'success',
  meeting: 'info',
  'follow-up': 'warning',
}

const WEEK_DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const TODAY = toDateInput(new Date())
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7)  // 7:00 – 21:00
const GRID_START_HOUR = HOURS[0]

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
}

const emptyEventForm: EventForm = { title: '', date: TODAY, type: 'demo', startHour: 10, startMinute: 0, duration: 60, clientName: '', description: '' }

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
  }
}

export default function CalendarPage() {
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<EventForm>(emptyEventForm)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isRealMode, setIsRealMode] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
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
        setEvents(initialEvents)
        setWorkspaceId(null)
        setIsRealMode(false)
        setLoadError('No se ha encontrado workspace real. Se muestran eventos demo.')
        return
      }

      const realEvents = await getCalendarEvents(resolvedWorkspaceId)
      setEvents(realEvents)
      setWorkspaceId(resolvedWorkspaceId)
      setIsRealMode(true)
    } catch (error) {
      setEvents(initialEvents)
      setWorkspaceId(null)
      setIsRealMode(false)
      const message = error instanceof Error ? error.message : 'Revisa RLS o columnas de calendar_events.'
      setLoadError(process.env.NODE_ENV === 'development' ? `No se pudieron cargar eventos reales: ${message}` : 'No se pudieron cargar eventos reales. Revisa RLS o columnas de calendar_events.')
      if (process.env.NODE_ENV === 'development') console.error('[calendar/loadEvents]', error)
    } finally {
      setLoading(false)
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
      if (e.key === 'Escape') setModalOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const upcomingEvents = useMemo(() => events
    .filter((e) => e.date >= TODAY)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
    .slice(0, 6), [events])

  const openCreateModal = (preset?: Partial<EventForm>) => {
    setForm({ ...emptyEventForm, date: selectedDate, ...preset })
    setModalOpen(true)
  }

  const openEditModal = (event: CalendarEvent) => {
    setForm(toForm(event))
    setModalOpen(true)
  }

  const handleSave = async () => {
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
          void createActivity(workspaceId, { type: 'call', description: `Evento actualizado: ${payload.title}`, clientName: payload.clientName }).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[calendar/createActivity:update]', error)
          })
          toast.success(`Evento actualizado: ${payload.title}`)
        } else {
          const created = await createCalendarEvent(workspaceId, payload)
          void createActivity(workspaceId, { type: 'call', description: `Evento creado: ${payload.title}`, clientName: payload.clientName }).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[calendar/createActivity:create]', error)
          })
          void triggerN8nWebhook('calendar_event_created', { workspace_id: workspaceId, mode: 'real', calendar_event: { ...payload, id: created.id } }).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[calendar/n8n:create]', error)
          })
          toast.success(`Evento guardado: ${payload.title}`)
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
    setDeleting(true)
    try {
      if (isRealMode && workspaceId) {
        await deleteCalendarEvent(form.id, workspaceId)
        await loadEvents()
      } else {
        setEvents((prev) => prev.filter((event) => event.id !== form.id))
      }
      toast.success(`Evento eliminado: ${form.title}`)
      setModalOpen(false)
      setForm(emptyEventForm)
    } catch (error) {
      toast.error('No se pudo eliminar el evento', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Calendario"
        description="Semana comercial, llamadas y demos programadas"
        action={
          <div className="flex items-center gap-3">
            <Badge variant={isRealMode ? 'success' : 'indigo'} dot>{isRealMode ? 'Datos reales' : 'Modo demo'}</Badge>
            <div className="hidden items-center gap-1 xl:flex">
              {(Object.keys(eventTypeConfig) as EventType[]).map((type) => <Badge key={type} variant={eventVariant[type]} className="text-[10px]">{eventTypeConfig[type].label}</Badge>)}
            </div>
            <Button size="sm" onClick={() => openCreateModal({ type: 'call', title: 'Llamada de seguimiento' })}>
              <Phone className="h-3.5 w-3.5" />
              Agendar llamada
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

      <div className="flex gap-5" style={{ minHeight: 620, height: 'clamp(620px, calc(100vh - 12rem), 760px)' }}>
        <aside className="flex w-64 shrink-0 flex-col gap-4">
          <div className="rounded-xl border border-gray-200/70 bg-white p-4 shadow-sm shadow-gray-950/[0.035]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">{monthLabel(selectedDate)}</h3>
              <div className="flex gap-0.5">
                <button onClick={() => setSelectedDate(addMonths(selectedDate, -1))} className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100"><ChevronLeft className="h-3.5 w-3.5" /></button>
                <button onClick={() => setSelectedDate(addMonths(selectedDate, 1))} className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100"><ChevronRight className="h-3.5 w-3.5" /></button>
              </div>
            </div>

            <div className="mb-1 grid grid-cols-7">
              {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => <div key={d} className="py-1 text-center text-[10px] font-semibold text-gray-400">{d}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5">
              {calendarMonthCells.map((dateStr, i) => {
                if (!dateStr) return <div key={`empty-${i}`} />
                const day = Number(dateStr.slice(-2))
                const isToday = dateStr === TODAY
                const isSelected = dateStr === selectedDate
                const hasEvent = events.some((e) => e.date === dateStr)
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(dateStr)}
                    className={cn('relative mx-auto flex h-7 w-7 flex-col items-center justify-center rounded-full text-xs font-medium transition-colors', isSelected || isToday ? 'bg-indigo-600 font-bold text-white' : 'text-gray-700 hover:bg-gray-100')}
                  >
                    {day}
                    {hasEvent && !isSelected && !isToday && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-indigo-400" />}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex-1 overflow-hidden rounded-xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.035]">
            <div className="border-b border-gray-100 px-4 py-3.5">
              <h3 className="text-sm font-semibold text-gray-900">Próximos eventos</h3>
            </div>
            <ul className="space-y-2 overflow-y-auto p-3" style={{ maxHeight: '280px' }}>
              {loading && [1, 2, 3].map((item) => <li key={item} className="h-20 animate-pulse rounded-xl bg-gray-100" />)}
              {!loading && upcomingEvents.map((ev) => {
                const cfg = eventTypeConfig[ev.type]
                return (
                  <li key={ev.id} onClick={() => setSelectedDate(ev.date)} className={cn('cursor-pointer rounded-xl border p-3 shadow-sm shadow-gray-950/[0.02] transition-all hover:-translate-y-0.5 hover:shadow-md', cfg.bg, cfg.border)}>
                    <p className={cn('text-xs font-semibold', cfg.color)}>{ev.title}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-gray-400" />
                      <span className="text-[10px] text-gray-500">{ev.date.slice(5).replace('-', '/')} · {ev.startHour}:{String(ev.startMinute).padStart(2, '0')}h</span>
                    </div>
                    {ev.clientName && <div className="mt-0.5 flex items-center gap-1.5"><User className="h-3 w-3 text-gray-400" /><span className="text-[10px] text-gray-500">{ev.clientName}</span></div>}
                  </li>
                )
              })}
              {!loading && upcomingEvents.length === 0 && (
                <li className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 p-4 text-center">
                  <p className="text-xs font-semibold text-indigo-800">Sin próximos eventos</p>
                  <p className="mt-1 text-[11px] text-indigo-600">Agenda una llamada para activar el calendario real.</p>
                </li>
              )}
            </ul>
          </div>

          <Button size="sm" className="w-full" onClick={() => openCreateModal()}>
            <Plus className="h-3.5 w-3.5" />
            Nuevo evento
          </Button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.035]">
          <div className="flex shrink-0 border-b border-gray-100">
            <div className="w-16 shrink-0 border-r border-gray-100 px-2 py-3"><span className="text-[10px] text-gray-400">UTC+2</span></div>
            {weekDates.map((dateStr, i) => {
              const day = WEEK_DAYS[i] ?? ''
              const isToday = dateStr === TODAY
              const isSelected = dateStr === selectedDate
              return (
                <div key={day} onClick={() => setSelectedDate(dateStr)} className={cn('flex flex-1 cursor-pointer flex-col items-center border-r border-gray-100 py-3 transition-colors last:border-r-0', isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50')}>
                  <span className={cn('text-[10px] font-medium', isSelected ? 'text-indigo-600' : 'text-gray-400')}>{day}</span>
                  <span className={cn('mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold', isToday ? 'bg-indigo-600 text-white' : isSelected ? 'text-indigo-700' : 'text-gray-700')}>{Number(dateStr.slice(-2))}</span>
                </div>
              )
            })}
          </div>

          <div className="flex flex-1 overflow-y-auto">
            <div className="w-16 shrink-0 border-r border-gray-100">
              {HOURS.map((h) => <div key={h} className="flex h-14 items-start justify-end pr-2 pt-1"><span className="text-[10px] text-gray-400">{h}:00</span></div>)}
            </div>

            <div className="flex min-w-0 flex-1">
              {weekDates.map((dateStr) => {
                const dayEvents = events.filter((e) => e.date === dateStr)
                const isToday = dateStr === TODAY
                return (
                  <div key={dateStr} className={cn('relative min-w-0 flex-1 border-r border-gray-100 last:border-r-0', isToday && 'bg-indigo-50/30')}>
                    {HOURS.map((h) => <div key={h} className="h-14 border-b border-gray-50" />)}
                    {dayEvents.map((ev) => {
                      const cfg = eventTypeConfig[ev.type]
                      const topOffset = (ev.startHour - GRID_START_HOUR) * 56 + (ev.startMinute / 60) * 56
                      const height = Math.max((ev.duration / 60) * 56, 28)
                      return (
                        <div key={ev.id} onClick={() => openEditModal(ev)} style={{ top: topOffset, height }} className={cn('absolute left-0.5 right-0.5 cursor-pointer overflow-hidden rounded-lg border px-1.5 py-1 shadow-sm shadow-gray-950/[0.025] transition-all hover:-translate-y-0.5 hover:shadow-md', cfg.bg, cfg.border)}>
                          <p className={cn('text-[10px] font-bold leading-tight', cfg.color)}>{ev.title}</p>
                          {height > 36 && ev.clientName && <p className="mt-0.5 truncate text-[9px] text-gray-500">{ev.clientName}</p>}
                          {height > 48 && <p className="mt-0.5 text-[9px] text-gray-400">{ev.startHour}:{String(ev.startMinute).padStart(2, '0')} · {ev.duration} min</p>}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {modalOpen && (
          <div ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) setModalOpen(false) }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                <h2 className="text-sm font-semibold text-gray-900">{form.id ? 'Editar evento' : 'Nuevo evento'}</h2>
                <button onClick={() => setModalOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100"><X className="h-4 w-4" /></button>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Título *</label>
                  <input type="text" placeholder="Demo con cliente" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Fecha</label>
                    <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Tipo</label>
                    <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as EventType }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="demo">Demo</option>
                      <option value="call">Llamada</option>
                      <option value="meeting">Reunión</option>
                      <option value="follow-up">Seguimiento</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Hora</label>
                    <select value={form.startHour} onChange={(e) => setForm((p) => ({ ...p, startHour: Number(e.target.value) }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">{HOURS.map((h) => <option key={h} value={h}>{h}:00</option>)}</select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Min</label>
                    <select value={form.startMinute} onChange={(e) => setForm((p) => ({ ...p, startMinute: Number(e.target.value) }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      {[0, 15, 30, 45].map((min) => <option key={min} value={min}>:{String(min).padStart(2, '0')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-700">Duración</label>
                    <select value={form.duration} onChange={(e) => setForm((p) => ({ ...p, duration: Number(e.target.value) }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      {[15, 30, 45, 60, 90, 120].map((duration) => <option key={duration} value={duration}>{duration} min</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Cliente</label>
                  <input type="text" placeholder="Ana Rodríguez" value={form.clientName} onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Notas</label>
                  <textarea rows={3} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Objetivo de la llamada o siguiente paso..." className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
                {form.id ? <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}><Trash2 className="h-3.5 w-3.5" />Eliminar</Button> : <span />}
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cancelar</Button>
                  <Button size="sm" loading={saving} onClick={handleSave}>{form.id ? 'Guardar cambios' : 'Crear evento'}</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
