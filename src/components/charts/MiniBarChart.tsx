'use client'

// Mini gráfico de barras (CSS/divs, sin dependencias) para tendencias por periodo (comisiones por
// mes/semana). Muestra el valor al hover y resalta el bucket actual. Discreto y premium.

import { cn } from '@/lib/utils'

export function MiniBarChart({
  data,
  formatValue,
  color = 'bg-indigo-500',
  height = 96,
  highlightLast = false,
}: {
  data: { label: string; value: number; hint?: string }[]
  formatValue?: (n: number) => string
  color?: string
  height?: number
  highlightLast?: boolean
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const barArea = height - 16

  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => {
        const h = d.value > 0 ? Math.max(3, Math.round((d.value / max) * barArea)) : 2
        const isLast = highlightLast && i === data.length - 1
        return (
          <div
            key={`${d.label}-${i}`}
            className="group flex flex-1 flex-col items-center justify-end gap-1"
            title={d.hint ?? `${d.label}: ${formatValue ? formatValue(d.value) : d.value}`}
          >
            <span className="h-3 text-[9px] font-semibold tabular-nums leading-none text-gray-500 opacity-0 transition-opacity group-hover:opacity-100">
              {d.value > 0 ? (formatValue ? formatValue(d.value) : String(d.value)) : ''}
            </span>
            <div
              className={cn('w-full max-w-[26px] rounded-t transition-all duration-300', d.value > 0 ? color : 'bg-gray-100', isLast && d.value > 0 && 'ring-2 ring-indigo-200')}
              style={{ height: h }}
            />
            <span className="text-[9px] leading-none text-gray-400">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}
