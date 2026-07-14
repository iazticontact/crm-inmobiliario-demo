// P70 Wave D — Horarios de automatización en Europe/Madrid, con offset REAL por fecha (DST correcto,
// jamás offsets fijos). Único módulo de verdad para route, motor conversacional y tests.

import type { AutomationFrequency } from './findings-engine'

export type ScheduleJson = { frequency: AutomationFrequency; hour: number; minute?: number; weekday?: number }

export function madridOffsetFor(dateIso: string): string {
  const probe = new Date(`${dateIso}T12:00:00Z`)
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'longOffset' })
    .formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00'
  const m = tz.match(/GMT([+-]\d{2}):?(\d{2})?/)
  return m ? `${m[1]}:${m[2] ?? '00'}` : '+01:00'
}

export function madridDateOf(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
}

/** 1 = lunes … 7 = domingo (ISO), calculado EN el calendario de Madrid. */
export function madridWeekday(dateIso: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', weekday: 'short' }).format(new Date(`${dateIso}T12:00:00Z`))
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[wd as 'Mon'] ?? 1
}

export function scheduleMatchesDay(schedule: ScheduleJson, dateIso: string): boolean {
  const wd = madridWeekday(dateIso)
  if (schedule.frequency === 'weekdays') return wd <= 5
  if (schedule.frequency === 'weekly') return wd === (schedule.weekday ?? 1)
  return true
}

/** Próxima ejecución ESTRICTAMENTE futura según el horario, en Europe/Madrid (DST por fecha). */
export function computeNextRunMadrid(schedule: ScheduleJson, from = new Date()): string {
  const minute = schedule.minute ?? 0
  for (let i = 0; i < 15; i++) {
    const day = madridDateOf(new Date(from.getTime() + i * 24 * 3600e3))
    if (!scheduleMatchesDay(schedule, day)) continue
    const off = madridOffsetFor(day)
    const candidate = new Date(`${day}T${String(schedule.hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${off}`)
    if (candidate.getTime() > from.getTime()) return candidate.toISOString()
  }
  // Inalcanzable con frecuencias válidas; fallback defensivo a +24h.
  return new Date(from.getTime() + 24 * 3600e3).toISOString()
}

export function parseSchedule(raw: unknown, fallback?: ScheduleJson): ScheduleJson | null {
  const s = (raw ?? {}) as Record<string, unknown>
  const frequency = String(s.frequency ?? fallback?.frequency ?? 'daily') as AutomationFrequency
  if (!['daily', 'weekdays', 'weekly'].includes(frequency)) return null
  const hour = Number(s.hour ?? fallback?.hour ?? 8)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  const minute = Number(s.minute ?? fallback?.minute ?? 0)
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  const weekday = s.weekday != null ? Number(s.weekday) : fallback?.weekday
  if (frequency === 'weekly' && !(Number.isInteger(weekday) && Number(weekday) >= 1 && Number(weekday) <= 7)) return null
  return { frequency, hour, ...(minute ? { minute } : {}), ...(frequency === 'weekly' ? { weekday: Number(weekday) } : {}) }
}

const WEEKDAY_LABEL = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
export function scheduleLabelOf(s: ScheduleJson): string {
  const h = `a las ${s.hour}:${String(s.minute ?? 0).padStart(2, '0')}`
  if (s.frequency === 'weekdays') return `De lunes a viernes ${h}`
  if (s.frequency === 'weekly') return `Todos los ${WEEKDAY_LABEL[s.weekday ?? 1]} ${h}`
  return `Todos los días ${h}`
}
