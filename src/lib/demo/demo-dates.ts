// Fechas relativas para la demo offline.
//
// Las fechas mock (visitas, tareas, oportunidades, facturas) se calculan en
// función de "hoy" para que la demo siempre se vea fresca al abrirla, sin
// importar la fecha real — no envejecen. Solo se usan client-side: las páginas
// demo cargan estos datos dentro de efectos gated por `DEMO_MODE_KEY`, así que
// no entran en el HTML del render SSR ni provocan mismatch de hidratación.

function shiftDays(days: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Fecha `YYYY-MM-DD` desplazada `days` días desde hoy (negativo = pasado). */
export function demoDate(days: number): string {
  const d = shiftDays(days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Timestamp ISO desplazado `days` días desde hoy, fijado a las 09:00 locales. */
export function demoTimestamp(days: number): string {
  const d = shiftDays(days)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}
