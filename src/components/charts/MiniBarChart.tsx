// MiniBarChart — gráfico de barras horizontales mínimo, SIN dependencias (solo
// CSS/divs). Se usa en la "home" del CRM (dashboard), por lo que evitamos cargar
// una librería de charts: es más ligero, no rompe SSR y encaja con el sistema
// visual existente. Presentacional y tipado; el caller decide cuándo mostrar el
// empty state (cuando no hay datos suficientes).

export type MiniBarDatum = {
  label: string
  value: number
}

const ACCENTS = {
  indigo: 'from-indigo-500 to-violet-500',
  sky: 'from-sky-500 to-indigo-500',
  emerald: 'from-emerald-500 to-teal-500',
} as const

export function MiniBarChart({
  data,
  accent = 'indigo',
}: {
  data: MiniBarDatum[]
  accent?: keyof typeof ACCENTS
}) {
  // max ≥ 1 evita dividir por cero y mantiene proporciones estables aunque todas
  // las barras valgan 0 (en ese caso el caller debería mostrar el empty state).
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span
            className="w-20 shrink-0 truncate text-[11px] font-medium text-gray-500 sm:w-24"
            title={d.label}
          >
            {d.label}
          </span>
          <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${ACCENTS[accent]} transition-[width] duration-500`}
              style={{ width: `${Math.round((d.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-700">
            {d.value}
          </span>
        </div>
      ))}
    </div>
  )
}
