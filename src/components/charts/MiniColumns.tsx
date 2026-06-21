// MiniColumns — mini gráfico de columnas verticales (apilables), SIN dependencias
// (solo CSS/divs). Pensado para la "home" del CRM: ligero, SSR-safe y a tono con
// el sistema visual. Soporta una serie (p. ej. pipeline por etapa) o varias
// apiladas por columna (p. ej. citas + tareas por día). Presentacional y tipado;
// el caller decide cuándo mostrar el empty state (cuando no hay datos).

export type ColumnSegment = { value: number; tone: keyof typeof SEGMENT_TONES }
export type ColumnDatum = { label: string; segments: ColumnSegment[]; tooltip?: string }

const SEGMENT_TONES = {
  indigo: 'bg-gradient-to-t from-indigo-500 to-violet-400',
  sky: 'bg-gradient-to-t from-sky-500 to-sky-400',
  amber: 'bg-gradient-to-t from-amber-500 to-amber-400',
  emerald: 'bg-gradient-to-t from-emerald-500 to-teal-400',
} as const

export function MiniColumns({ data }: { data: ColumnDatum[] }) {
  // max ≥ 1 evita dividir por cero y mantiene proporciones estables.
  const max = Math.max(1, ...data.map((d) => d.segments.reduce((sum, seg) => sum + seg.value, 0)))
  return (
    <div className="flex items-end justify-between gap-1.5 sm:gap-2.5">
      {data.map((d) => {
        const total = d.segments.reduce((sum, seg) => sum + seg.value, 0)
        return (
          <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={d.tooltip}>
            <span className="text-[10px] font-semibold tabular-nums text-gray-600">{total > 0 ? total : ''}</span>
            <div className="flex h-28 w-full max-w-[40px] flex-col-reverse overflow-hidden rounded-md bg-gray-100/80">
              {d.segments.map((seg, i) =>
                seg.value > 0 ? (
                  <div
                    key={i}
                    className={`${SEGMENT_TONES[seg.tone]} transition-[height] duration-500`}
                    style={{ height: `${(seg.value / max) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
            <span className="w-full truncate text-center text-[10px] font-medium text-gray-500">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}
