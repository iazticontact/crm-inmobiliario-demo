// Política TEMPORAL del Asistente (P64) — PURA. Evidencia del incidente: una ficha mostró como «cita
// próxima» un evento pasado (24/06/2026) y una tarea completada como «vencida». Reglas de verdad temporal:
//   · próxima  = fecha ≥ hoy (Europe/Madrid) y no cancelada;
//   · pasada   = fecha < hoy;
//   · vencida  = NO completada + fecha límite < hoy;
//   · completada nunca se presenta como pendiente/vencida activa (se puede decir «completada; su fecha
//     límite era …»).
// Las fechas sin hora se comparan como YYYY-MM-DD en Europe/Madrid (sin desplazamientos UTC).

export function todayMadridIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now) // YYYY-MM-DD
}

function dateOnly(d: string | null | undefined): string | null {
  if (!d || typeof d !== 'string') return null
  const m = d.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

export function isUpcoming(date: string | null | undefined, status?: string | null, today = todayMadridIso()): boolean {
  const d = dateOnly(date)
  if (!d) return false
  if (status && String(status).toLowerCase() === 'cancelled') return false
  return d >= today
}

export function isPast(date: string | null | undefined, today = todayMadridIso()): boolean {
  const d = dateOnly(date)
  return d !== null && d < today
}

// Tarea vencida = pendiente (no completada/cancelada) con fecha límite anterior a hoy.
export function isOverdueTask(dueDate: string | null | undefined, status: string | null | undefined, today = todayMadridIso()): boolean {
  const s = String(status ?? '').toLowerCase()
  if (s !== 'pending') return false
  const d = dateOnly(dueDate)
  return d !== null && d < today
}

export function isPendingTask(status: string | null | undefined): boolean {
  return String(status ?? '').toLowerCase() === 'pending'
}
