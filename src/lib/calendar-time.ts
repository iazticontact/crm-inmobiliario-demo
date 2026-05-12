export type CalendarTimeInput = {
  date?: string | null
  time?: string | null
  startTime?: string | null
  start_time?: string | null
  endTime?: string | null
  end_time?: string | null
  startHour?: number | string | null
  start_hour?: number | string | null
  startMinute?: number | string | null
  start_minute?: number | string | null
  duration?: number | string | null
  startAt?: string | null
  start_at?: string | null
  endAt?: string | null
  end_at?: string | null
}

export type CalendarEventTimes = {
  startAtIso: string
  endAtIso: string
  date: string
  startHour: number
  startMinute: number
  duration: number
  time: string
}

function asNumber(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function parseTime(value?: string | null) {
  if (!value?.trim()) return null
  const match = value.trim().match(/^(\d{1,2})(?::?(\d{2}))?/)
  if (!match) return null
  const hour = Math.max(0, Math.min(23, Number(match[1]) || 0))
  const minute = Math.max(0, Math.min(59, Number(match[2] ?? 0) || 0))
  return { hour, minute }
}

function localDateIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localTimeParts(date: Date) {
  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
  }
}

function parseDateParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error('date debe tener formato YYYY-MM-DD')
  return {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3]),
  }
}

function validDate(value: Date) {
  return !Number.isNaN(value.getTime())
}

export function buildCalendarEventTimes(input: CalendarTimeInput): CalendarEventTimes {
  const startAtInput = input.startAt || input.start_at
  const endAtInput = input.endAt || input.end_at
  const requestedDuration = Math.max(1, asNumber(input.duration, 60))

  let startDate: Date
  if (startAtInput) {
    startDate = new Date(startAtInput)
    if (!validDate(startDate)) throw new Error('start_at no es una fecha valida')
  } else {
    const date = input.date
    if (!date) throw new Error('date es obligatorio para calcular start_at')
    const parsedTime =
      parseTime(input.time) ||
      parseTime(input.startTime) ||
      parseTime(input.start_time)
    const startHour = parsedTime?.hour ?? asNumber(input.startHour ?? input.start_hour, 10)
    const startMinute = parsedTime?.minute ?? asNumber(input.startMinute ?? input.start_minute, 0)
    const { year, month, day } = parseDateParts(date)
    startDate = new Date(year, month, day, Math.max(0, Math.min(23, startHour)), Math.max(0, Math.min(59, startMinute)), 0, 0)
  }

  const parsedEndTime = parseTime(input.endTime) || parseTime(input.end_time)
  let endDate: Date
  if (endAtInput) {
    endDate = new Date(endAtInput)
    if (!validDate(endDate)) throw new Error('end_at no es una fecha valida')
  } else if (parsedEndTime) {
    endDate = new Date(startDate)
    endDate.setHours(parsedEndTime.hour, parsedEndTime.minute, 0, 0)
    if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1)
  } else {
    endDate = new Date(startDate.getTime() + requestedDuration * 60_000)
  }

  const duration = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60_000))
  const { hour, minute } = localTimeParts(startDate)
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  return {
    startAtIso: startDate.toISOString(),
    endAtIso: endDate.toISOString(),
    date: localDateIso(startDate),
    startHour: hour,
    startMinute: minute,
    duration,
    time,
  }
}
