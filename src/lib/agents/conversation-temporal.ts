// P71·It2 — MOTOR TEMPORAL CONVERSACIONAL. Capa PURA que interpreta expresiones de tiempo del español de
// forma COMPOSICIONAL (no por frases del incidente) y produce un `TemporalScope` estructurado en
// Europe/Madrid: {start, end, granularity, interpretation}. Distingue dos familias:
//   · ABSOLUTAS   — «hoy», «esta semana», «el mes que viene», «últimos 7 días», «entre X e Y», «desde X».
//   · CONTINUACIÓN— «¿y la siguiente?», «¿y la anterior?»: NO traen periodo propio; heredan la granularidad
//                    del alcance previo y lo desplazan (semana→±7d, mes→±1 mes, día→±1d…).
// REGLA DURA: devolver un RANGO (criterio), jamás datos. El llamador RECONSULTA la BD con ese rango. Ante
// una continuación sin alcance previo, no se inventa nada: se devuelve null (el llamador sigue su flujo).

import { foldText } from '@/lib/real-estate-search'
import type { TemporalScope, TemporalGranularity } from './conversation-state'

const TZ = 'Europe/Madrid'

export function todayMadridIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now) // YYYY-MM-DD
}
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay() // 0=domingo … 6=sábado
  return addDaysIso(iso, -((dow + 6) % 7))
}
function monthRange(year: number, month0: number): { start: string; end: string } {
  const start = `${year}-${String(month0 + 1).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10)
  return { start, end }
}
function scope(start: string, end: string, granularity: TemporalGranularity, interpretation: string, turnId: string, confidence = 0.85): TemporalScope {
  return { start, end, timezone: TZ, granularity, interpretation, sourceTurnId: turnId, confidence }
}

const MONTHS: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6,
  agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
}

// Parsea UNA fecha suelta del español a ISO yyyy-mm-dd (para «entre X e Y», «desde X»). General:
// ISO, dd/mm(/yyyy), «15 de octubre (de 2026)», «hoy/mañana/pasado mañana». Devuelve null si no cuadra.
export function parseSpanishDate(token: string, todayIso: string): string | null {
  const n = foldText(token).trim()
  if (/\bpasado manana\b/.test(n)) return addDaysIso(todayIso, 2)
  if (/\bmanana\b/.test(n)) return addDaysIso(todayIso, 1)
  if (/\bhoy\b/.test(n)) return todayIso
  if (/\bayer\b/.test(n)) return addDaysIso(todayIso, -1)
  const iso = n.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dm = n.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/)
  if (dm) {
    const day = Number(dm[1]), mon = Number(dm[2])
    let yr = dm[3] ? Number(dm[3]) : Number(todayIso.slice(0, 4))
    if (yr < 100) yr += 2000
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const named = n.match(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?/)
  if (named && MONTHS[named[2]] !== undefined) {
    const day = Number(named[1]); const mon0 = MONTHS[named[2]]
    const yr = named[3] ? Number(named[3]) : Number(todayIso.slice(0, 4))
    if (day >= 1 && day <= 31) return `${yr}-${String(mon0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

// ── EXPRESIÓN ABSOLUTA → alcance ─────────────────────────────────────────────────────────────────────
export function parseAbsoluteTemporal(message: string, todayIso: string, turnId: string): TemporalScope | null {
  const n = foldText(message)

  // Rangos explícitos primero (ganan a las palabras sueltas de dentro).
  const between = n.match(/\bentre\s+(?:el\s+)?(.+?)\s+y\s+(?:el\s+)?(.+?)(?:[.!?]|$)/)
  if (between) {
    const a = parseSpanishDate(between[1], todayIso); const b = parseSpanishDate(between[2], todayIso)
    if (a && b) { const [s, e] = a <= b ? [a, b] : [b, a]; return scope(s, e, 'range', `entre ${s} y ${e}`, turnId) }
  }
  const since = n.match(/\bdesde\s+(?:el\s+)?(.+?)(?:[.!?]|$)/)
  if (since && !/\bhasta\b/.test(n)) {
    const a = parseSpanishDate(since[1], todayIso)
    if (a) { const e = a > todayIso ? addDaysIso(a, 14) : todayIso; return scope(a, e, 'range', `desde ${a}`, turnId) }
  }
  const untilM = n.match(/\bhasta\s+(?:el\s+)?(.+?)(?:[.!?]|$)/)
  if (untilM) {
    const b = parseSpanishDate(untilM[1], todayIso)
    if (b && b >= todayIso) return scope(todayIso, b, 'range', `hasta ${b}`, turnId)
  }

  // Ventanas relativas «últimos/próximos N días».
  const lastN = n.match(/\bultim[oa]s?\s+(\d{1,3})\s+dias\b/)
  if (lastN) { const nn = Math.min(365, Number(lastN[1])); return scope(addDaysIso(todayIso, -nn), todayIso, 'relative_days', `últimos ${nn} días`, turnId) }
  const nextN = n.match(/\bproxim[oa]s?\s+(\d{1,3})\s+dias\b/)
  if (nextN) { const nn = Math.min(365, Number(nextN[1])); return scope(todayIso, addDaysIso(todayIso, nn), 'relative_days', `próximos ${nn} días`, turnId) }

  // Meses.
  const [y, m] = todayIso.split('-').map(Number)
  if (/\b(el\s+)?mes que viene\b|\bproxim[oa] mes\b|\bel mes proximo\b/.test(n)) { const r = monthRange(m === 12 ? y + 1 : y, m === 12 ? 0 : m); return scope(r.start, r.end, 'month', 'el mes que viene', turnId) }
  if (/\b(el\s+)?mes pasad[oa]\b|\bel mes anterior\b/.test(n)) { const r = monthRange(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2); return scope(r.start, r.end, 'month', 'el mes pasado', turnId) }
  if (/\beste mes\b|\bdel mes\b|\ben el mes\b/.test(n)) { const r = monthRange(y, m - 1); return scope(r.start, r.end, 'month', 'este mes', turnId) }

  // Semanas.
  const monday = mondayOf(todayIso)
  if (/\b(la\s+)?semana que viene\b|\bproxim[oa] semana\b|\bla semana proxima\b/.test(n)) { const s = addDaysIso(monday, 7); return scope(s, addDaysIso(s, 6), 'week', 'la semana que viene', turnId) }
  if (/\b(la\s+)?semana pasad[oa]\b|\bla semana anterior\b/.test(n)) { const s = addDaysIso(monday, -7); return scope(s, addDaysIso(s, 6), 'week', 'la semana pasada', turnId) }
  if (/\besta semana\b|\bde la semana\b|\ben la semana\b|\besta misma semana\b/.test(n)) return scope(monday, addDaysIso(monday, 6), 'week', 'esta semana', turnId)

  // Días concretos.
  if (/\bpasado manana\b/.test(n)) { const d = addDaysIso(todayIso, 2); return scope(d, d, 'day', 'pasado mañana', turnId) }
  if (/\bmanana\b/.test(n)) { const d = addDaysIso(todayIso, 1); return scope(d, d, 'day', 'mañana', turnId) }
  if (/\bayer\b/.test(n)) { const d = addDaysIso(todayIso, -1); return scope(d, d, 'day', 'ayer', turnId) }
  if (/\bhoy\b|\bpara hoy\b/.test(n)) return scope(todayIso, todayIso, 'day', 'hoy', turnId)

  return null
}

// ── CONTINUACIÓN (sin periodo propio) → dirección de desplazamiento ────────────────────────────────────
export function detectTemporalShift(message: string): 'next' | 'previous' | null {
  const n = foldText(message)
  // Continuación breve y elidida: «¿y la siguiente?», «¿y el anterior?», «¿y la que viene?». Requiere un
  // marcador de continuación aislado (sin sustantivo de periodo, que ya lo capta parseAbsoluteTemporal).
  if (/\b(la|el|los|las)\s+(siguiente|proxim[oa]s?)\b/.test(n) || /\bque viene\b/.test(n) || /\by despues\b/.test(n)) return 'next'
  if (/\b(la|el|los|las)\s+(anterior(es)?|previ[oa]s?)\b/.test(n) || /\bde antes\b/.test(n) || /\by antes\b/.test(n)) return 'previous'
  return null
}

// Desplaza un alcance según su granularidad (semana→±7d, mes→±1 mes, día→±1d, ventanas/rango→±su longitud).
export function shiftScope(prev: TemporalScope, dir: 'next' | 'previous', turnId: string): TemporalScope | null {
  if (!prev.start || !prev.end) return null
  const sign = dir === 'next' ? 1 : -1
  const label = (base: string) => dir === 'next' ? `${base} siguiente` : `${base} anterior`
  switch (prev.granularity) {
    case 'week': {
      const s = addDaysIso(prev.start, 7 * sign); return scope(s, addDaysIso(s, 6), 'week', label('la semana'), turnId)
    }
    case 'month': {
      const [y, m] = prev.start.split('-').map(Number) // m es 1-based
      const m0 = (m - 1) + sign
      const yy = y + Math.floor(m0 / 12); const mm = ((m0 % 12) + 12) % 12
      const r = monthRange(yy, mm); return scope(r.start, r.end, 'month', label('el mes'), turnId)
    }
    case 'day': {
      const d = addDaysIso(prev.start, sign); return scope(d, d, 'day', label('el día'), turnId)
    }
    case 'relative_days':
    case 'range': {
      const len = Math.round((Date.parse(prev.end) - Date.parse(prev.start)) / 86_400_000) + 1
      const s = addDaysIso(prev.start, len * sign); const e = addDaysIso(prev.end, len * sign)
      return scope(s, e, prev.granularity, label('el periodo'), turnId)
    }
    default:
      return null
  }
}

// Resuelve el alcance temporal de un turno: primero absoluto; si no, continuación sobre el alcance previo.
export type TemporalResolution = { scope: TemporalScope; via: 'absolute' | 'shift' } | null
export function resolveTemporalScope(message: string, prevScope: TemporalScope | null, todayIso: string, turnId: string): TemporalResolution {
  const abs = parseAbsoluteTemporal(message, todayIso, turnId)
  if (abs) return { scope: abs, via: 'absolute' }
  const dir = detectTemporalShift(message)
  if (dir && prevScope) { const s = shiftScope(prevScope, dir, turnId); if (s) return { scope: s, via: 'shift' } }
  return null
}

// Etiqueta legible del rango para el texto de respuesta (día completo, sin horas).
export function formatScopeLabel(s: TemporalScope): string {
  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  const range = s.start === s.end ? fmt(s.start!) : `${fmt(s.start!)}–${fmt(s.end!)}`
  return s.interpretation ? `${s.interpretation} (${range})` : range
}
