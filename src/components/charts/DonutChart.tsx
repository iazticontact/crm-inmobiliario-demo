'use client'

// Donut SVG ligero (sin dependencias): segmentos proporcionales, leyenda con %/valor, total en el
// centro y resaltado al hover. Premium y discreto. Reutilizable en Dashboard (comisiones, cartera…).

import { useState } from 'react'
import { cn } from '@/lib/utils'

export type DonutSegment = { key: string; label: string; value: number; color: string }

export function DonutChart({
  segments,
  centerValue,
  centerLabel,
  size = 148,
  thickness = 16,
  formatValue,
}: {
  segments: DonutSegment[]
  centerValue?: string
  centerLabel?: string
  size?: number
  thickness?: number
  formatValue?: (n: number) => string
}) {
  const [active, setActive] = useState<string | null>(null)
  const total = segments.reduce((s, x) => s + x.value, 0)
  const r = (size - thickness) / 2
  const circ = 2 * Math.PI * r
  const cx = size / 2
  let offset = 0

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
          {total > 0 && segments.map((s) => {
            const dash = (s.value / total) * circ
            const node = (
              <circle
                key={s.key}
                cx={cx}
                cy={cx}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset}
                className="cursor-pointer transition-opacity duration-300"
                style={{ opacity: active && active !== s.key ? 0.35 : 1 }}
                onMouseEnter={() => setActive(s.key)}
                onMouseLeave={() => setActive(null)}
              />
            )
            offset += dash
            return node
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && <span className="text-[15px] font-bold leading-none text-gray-900">{centerValue}</span>}
          {centerLabel && <span className="mt-0.5 text-[10px] font-medium text-gray-400">{centerLabel}</span>}
        </div>
      </div>
      <ul className="w-full space-y-1">
        {segments.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0
          return (
            <li
              key={s.key}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              className={cn('flex items-center justify-between gap-2 rounded-md px-1.5 py-1 transition-colors', active === s.key && 'bg-gray-50')}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
                <span className="truncate text-[11px] text-gray-600">{s.label}</span>
              </span>
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-gray-800">
                {formatValue ? `${formatValue(s.value)} · ` : ''}{pct}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
