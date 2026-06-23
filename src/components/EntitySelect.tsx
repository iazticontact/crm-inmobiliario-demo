'use client'

// Combobox simple y ligero (sin dependencias) para vincular entidades del CRM en formularios:
// cliente, inmueble, operación, trámite. Busca por label+sublabel, muestra texto humano (nunca
// UUID), permite limpiar la selección y no bloquea si no hay opciones.

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type EntityOption = { id: string; label: string; sublabel?: string }

export function EntitySelect({
  value,
  onChange,
  options,
  placeholder = 'Buscar…',
  emptyText = 'Sin opciones disponibles',
  disabled = false,
}: {
  value: string | null
  onChange: (id: string | null) => void
  options: EntityOption[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? options.filter((o) => `${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(q))
      : options
    return base.slice(0, 8)
  }, [options, query])

  const inputCls = 'h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-8 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        disabled={disabled}
        value={open ? query : (selected?.label ?? '')}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery('') }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true) }}
        className={inputCls}
      />
      {selected && !disabled && (
        <button
          type="button"
          aria-label="Quitar vínculo"
          onMouseDown={(e) => { e.preventDefault(); onChange(null); setQuery('') }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-gray-400">{emptyText}</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-gray-400">Sin resultados</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(o.id); setOpen(false); setQuery('') }}
                className={cn(
                  'flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors hover:bg-indigo-50/60',
                  o.id === value && 'bg-indigo-50/40',
                )}
              >
                <span className="truncate text-xs font-medium text-gray-900">{o.label}</span>
                {o.sublabel && <span className="truncate text-[10px] text-gray-400">{o.sublabel}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
