'use client'

// DonutChart — donut interactivo, SIN dependencias (SVG + CSS). Se usa en la
// "home" del CRM, por lo que evitamos cargar una librería de charts (recharts
// solo vive en páginas internas). Al pasar el cursor por un segmento o por su
// fila de leyenda, el centro muestra ese dato y el arco se resalta.
//
// El tamaño de cada arco lo da `count`; `value` (p. ej. importe) se muestra en
// el centro/leyenda. Presentacional y tipado.

import { useState } from 'react'
import { cn } from '@/lib/utils'

export type DonutSegment = {
  key: string
  label: string
  count: number
  value: number
  color: string
}

const RADIUS = 16
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function DonutChart({
  segments,
  totalLabel = 'Total',
  formatValue,
}: {
  segments: DonutSegment[]
  totalLabel?: string
  formatValue?: (value: number) => string
}) {
  const [active, setActive] = useState<number | null>(null)

  const totalCount = segments.reduce((sum, s) => sum + s.count, 0)
  const totalValue = segments.reduce((sum, s) => sum + s.value, 0)

  const arcs = segments.map((seg, i) => {
    const before = segments.slice(0, i).reduce((sum, s) => sum + s.count, 0)
    const frac = totalCount > 0 ? seg.count / totalCount : 0
    const dash = frac * CIRCUMFERENCE
    const offset = totalCount > 0 ? (before / totalCount) * CIRCUMFERENCE : 0
    return { seg, i, dasharray: `${dash} ${CIRCUMFERENCE - dash}`, dashoffset: -offset }
  })

  const shown = active != null ? segments[active] : null
  const centerCount = shown ? shown.count : totalCount
  const centerLabel = shown ? shown.label : totalLabel
  const centerValue = shown ? shown.value : totalValue

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[118px] w-[118px] shrink-0">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90">
          <circle cx="21" cy="21" r={RADIUS} fill="none" stroke="#f1f5f9" strokeWidth="5" />
          {arcs.map((a) => (
            <circle
              key={a.seg.key}
              cx="21"
              cy="21"
              r={RADIUS}
              fill="none"
              stroke={a.seg.color}
              strokeWidth={active === a.i ? 6.5 : 5}
              strokeDasharray={a.dasharray}
              strokeDashoffset={a.dashoffset}
              strokeLinecap="butt"
              className="cursor-pointer transition-[stroke-width] duration-200"
              onMouseEnter={() => setActive(a.i)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-bold leading-none tabular-nums text-gray-900">{centerCount}</span>
          <span className="mt-0.5 max-w-[88px] truncate text-[10px] font-medium text-gray-400">{centerLabel}</span>
          {centerValue > 0 && formatValue && (
            <span className="mt-0.5 text-[10px] font-semibold text-gray-600">{formatValue(centerValue)}</span>
          )}
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-0.5">
        {segments.map((seg, i) => {
          const pct = totalCount > 0 ? Math.round((seg.count / totalCount) * 100) : 0
          return (
            <li
              key={seg.key}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className={cn('flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors', active === i && 'bg-gray-50')}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-600">{seg.label}</span>
              <span className="shrink-0 text-[11px] font-bold tabular-nums text-gray-800">{seg.count}</span>
              <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-gray-400">{pct}%</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
