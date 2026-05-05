'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Plus, Clock, User, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { calendarEvents as initialEvents } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
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
const WEEK_DATES = ['4 may', '5 may', '6 may', '7 may', '8 may', '9 may', '10 may']
const WEEK_FULL = ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10']
const TODAY = '2026-05-05'

const HOURS = Array.from({ length: 11 }, (_, i) => i + 8)

const emptyEventForm = { title: '', date: TODAY, type: 'demo' as EventType, startHour: 10, startMinute: 0, duration: 60, clientName: '', description: '' }

export default function CalendarPage() {
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyEventForm)
  const [saving, setSaving] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setModalOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const upcomingEvents = events
    .filter((e) => e.date >= TODAY)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
    .slice(0, 5)

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error('El título es obligatorio')
      return
    }
    setSaving(true)
    await new Promise((r) => setTimeout(r, 500))
    const newEvent: CalendarEvent = {
      id: `ev-${Date.now()}`,
      title: form.title.trim(),
      date: form.date,
      startHour: Number(form.startHour),
      startMinute: Number(form.startMinute),
      duration: Number(form.duration),
      type: form.type,
      clientName: form.clientName.trim() || undefined,
      description: form.description.trim() || undefined,
    }
    setEvents((prev) => [...prev, newEvent])
    setSelectedDate(form.date)
    setSaving(false)
    setModalOpen(false)
    setForm(emptyEventForm)
    toast.success(`Evento creado: ${newEvent.title}`, {
      description: `${newEvent.date.slice(5).replace('-', '/')} · ${newEvent.startHour}:${String(newEvent.startMinute).padStart(2, '0')}h`,
    })
  }

  return (
    <div className="flex gap-5 h-full" style={{ height: 'calc(100vh - 7rem)' }}>
      {/* Left panel */}
      <aside className="flex w-64 shrink-0 flex-col gap-4">
        {/* Mini calendar */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Mayo 2026</h3>
            <div className="flex gap-0.5">
              <button className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: 31 }, (_, i) => {
              const day = i + 1
              const dateStr = `2026-05-${String(day).padStart(2, '0')}`
              const isToday = dateStr === TODAY
              const isSelected = dateStr === selectedDate
              const hasEvent = events.some((e) => e.date === dateStr)
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDate(dateStr)}
                  className={cn(
                    'flex flex-col items-center justify-center h-7 w-7 mx-auto rounded-full text-xs font-medium transition-colors relative',
                    isSelected && !isToday ? 'bg-indigo-600 text-white' : '',
                    isToday ? 'bg-indigo-600 text-white font-bold' : '',
                    !isSelected && !isToday ? 'text-gray-700 hover:bg-gray-100' : ''
                  )}
                >
                  {day}
                  {hasEvent && !isSelected && !isToday && (
                    <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-indigo-400" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Upcoming events */}
        <div className="flex-1 rounded-xl bg-white border border-gray-100 shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 px-4 py-3.5">
            <h3 className="text-sm font-semibold text-gray-900">Próximos eventos</h3>
          </div>
          <ul className="overflow-y-auto p-3 space-y-2" style={{ maxHeight: '280px' }}>
            {upcomingEvents.map((ev) => {
              const cfg = eventTypeConfig[ev.type]
              return (
                <li
                  key={ev.id}
                  onClick={() => setSelectedDate(ev.date)}
                  className={cn('rounded-xl border p-3 cursor-pointer transition-colors hover:opacity-80', cfg.bg, cfg.border)}
                >
                  <p className={cn('text-xs font-semibold', cfg.color)}>{ev.title}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Clock className="h-3 w-3 text-gray-400" />
                    <span className="text-[10px] text-gray-500">
                      {ev.date.slice(5).replace('-', '/')} · {ev.startHour}:{String(ev.startMinute).padStart(2, '0')}h
                    </span>
                  </div>
                  {ev.clientName && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <User className="h-3 w-3 text-gray-400" />
                      <span className="text-[10px] text-gray-500">{ev.clientName}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <Button size="sm" className="w-full" onClick={() => { setForm({ ...emptyEventForm, date: selectedDate }); setModalOpen(true) }}>
          <Plus className="h-3.5 w-3.5" />
          Nuevo evento
        </Button>
      </aside>

      {/* Weekly view */}
      <div className="flex flex-1 min-w-0 flex-col rounded-xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        {/* Week header */}
        <div className="flex border-b border-gray-100 shrink-0">
          <div className="w-16 shrink-0 border-r border-gray-100 px-2 py-3">
            <span className="text-[10px] text-gray-400">UTC+2</span>
          </div>
          {WEEK_DAYS.map((day, i) => {
            const dateStr = WEEK_FULL[i]
            const isToday = dateStr === TODAY
            const isSelected = dateStr === selectedDate
            return (
              <div
                key={day}
                onClick={() => setSelectedDate(dateStr)}
                className={cn(
                  'flex-1 flex flex-col items-center py-3 border-r border-gray-100 last:border-r-0 cursor-pointer transition-colors',
                  isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'
                )}
              >
                <span className={cn('text-[10px] font-medium', isSelected ? 'text-indigo-600' : 'text-gray-400')}>{day}</span>
                <span className={cn(
                  'mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold',
                  isToday ? 'bg-indigo-600 text-white' : isSelected ? 'text-indigo-700' : 'text-gray-700'
                )}>
                  {WEEK_DATES[i].split(' ')[0]}
                </span>
              </div>
            )
          })}
        </div>

        {/* Time grid */}
        <div className="flex flex-1 overflow-y-auto">
          <div className="w-16 shrink-0 border-r border-gray-100">
            {HOURS.map((h) => (
              <div key={h} className="flex h-14 items-start justify-end pr-2 pt-1">
                <span className="text-[10px] text-gray-400">{h}:00</span>
              </div>
            ))}
          </div>

          <div className="flex flex-1 min-w-0">
            {WEEK_FULL.map((dateStr) => {
              const dayEvents = events.filter((e) => e.date === dateStr)
              const isToday = dateStr === TODAY
              return (
                <div key={dateStr} className={cn('flex-1 relative border-r border-gray-100 last:border-r-0 min-w-0', isToday && 'bg-indigo-50/30')}>
                  {HOURS.map((h) => (
                    <div key={h} className="h-14 border-b border-gray-50" />
                  ))}

                  {dayEvents.map((ev) => {
                    const cfg = eventTypeConfig[ev.type]
                    const topOffset = (ev.startHour - 8) * 56 + (ev.startMinute / 60) * 56
                    const height = Math.max((ev.duration / 60) * 56, 28)
                    return (
                      <div
                        key={ev.id}
                        onClick={() => toast.info(ev.title, { description: ev.clientName ? `Con ${ev.clientName}` : ev.description ?? '' })}
                        style={{ top: topOffset, height }}
                        className={cn(
                          'absolute left-0.5 right-0.5 rounded-lg border px-1.5 py-1 cursor-pointer hover:opacity-80 transition-opacity overflow-hidden',
                          cfg.bg,
                          cfg.border
                        )}
                      >
                        <p className={cn('text-[10px] font-bold leading-tight', cfg.color)}>{ev.title}</p>
                        {height > 36 && ev.clientName && (
                          <p className="text-[9px] text-gray-500 mt-0.5 truncate">{ev.clientName}</p>
                        )}
                        {height > 48 && (
                          <p className="text-[9px] text-gray-400 mt-0.5">
                            {ev.startHour}:{String(ev.startMinute).padStart(2, '0')} — {ev.startHour + Math.floor((ev.startMinute + ev.duration) / 60)}:{String((ev.startMinute + ev.duration) % 60).padStart(2, '0')}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Event type legend */}
      <div className="flex flex-col gap-1 justify-start pt-0.5">
        {(Object.keys(eventTypeConfig) as EventType[]).map((type) => {
          const cfg = eventTypeConfig[type]
          return (
            <Badge key={type} variant={eventVariant[type]} className="text-[10px]">
              {cfg.label}
            </Badge>
          )
        })}
      </div>

      {/* New event modal */}
      {modalOpen && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) setModalOpen(false) }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-900">Nuevo evento</h2>
              <button onClick={() => setModalOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Título *</label>
                <input
                  type="text"
                  placeholder="Demo con cliente"
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Fecha</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Tipo</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as EventType }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  >
                    <option value="demo">Demo</option>
                    <option value="call">Llamada</option>
                    <option value="meeting">Reunión</option>
                    <option value="follow-up">Seguimiento</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Hora inicio</label>
                  <select
                    value={form.startHour}
                    onChange={(e) => setForm((p) => ({ ...p, startHour: Number(e.target.value) }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  >
                    {HOURS.map((h) => <option key={h} value={h}>{h}:00</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Minutos</label>
                  <select
                    value={form.startMinute}
                    onChange={(e) => setForm((p) => ({ ...p, startMinute: Number(e.target.value) }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  >
                    <option value={0}>:00</option>
                    <option value={15}>:15</option>
                    <option value={30}>:30</option>
                    <option value={45}>:45</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Duración</label>
                  <select
                    value={form.duration}
                    onChange={(e) => setForm((p) => ({ ...p, duration: Number(e.target.value) }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  >
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={45}>45 min</option>
                    <option value={60}>1 hora</option>
                    <option value={90}>1,5 h</option>
                    <option value={120}>2 horas</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Cliente (opcional)</label>
                <input
                  type="text"
                  placeholder="Ana Rodríguez"
                  value={form.clientName}
                  onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button size="sm" loading={saving} onClick={handleSave}>Crear evento</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
