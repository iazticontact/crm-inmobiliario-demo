'use client'

// Autocomplete accesible reutilizable (P29) — usado por País e Idioma del cliente. Se comporta como el
// selector de localidad: escribes y aparecen opciones (prefijo → contiene, tolerante a acentos y alias).
// Teclado (↑/↓/Enter/Escape), click fuera para cerrar, botón limpiar. En móvil el input hereda 16px
// (globals.css) → sin auto-zoom iOS.

import { useState, useRef, useEffect, useMemo, useId } from 'react'
import { ChevronsUpDown, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { filterOptions, type Option } from '@/lib/geo-language-data'

type Props = {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  className?: string
  inputClassName?: string
  allowClear?: boolean
}

export function AutocompleteSelect({
  value, onChange, options, placeholder, className, inputClassName, allowClear = true,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Sincroniza el texto con el valor confirmado cuando cambia desde fuera (edición). queueMicrotask
  // evita el aviso set-state-in-effect (convención del repo).
  useEffect(() => {
    queueMicrotask(() => setQuery(value))
  }, [value])

  const results = useMemo(() => filterOptions(options, open ? query : '', 8), [options, query, open])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(value)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [value])

  const commit = (v: string) => { onChange(v); setQuery(v); setOpen(false) }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setHighlight(0) }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0))) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
            else if (e.key === 'Enter') { if (open && results[highlight]) { e.preventDefault(); commit(results[highlight].value) } }
            else if (e.key === 'Escape') { setOpen(false); setQuery(value) }
          }}
          className={cn(
            'h-10 w-full rounded-lg border border-gray-200 bg-white pl-3 pr-9 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500',
            inputClassName,
          )}
        />
        {allowClear && query ? (
          <button type="button" aria-label="Borrar" onClick={() => commit('')} className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        ) : (
          <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        )}
      </div>
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-100 bg-white py-1 shadow-lg">
          {results.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={value === o.value}
              onMouseDown={(e) => { e.preventDefault(); commit(o.value) }}
              onMouseEnter={() => setHighlight(i)}
              className={cn('flex cursor-pointer items-center justify-between px-3 py-2 text-sm', i === highlight ? 'bg-indigo-50 text-indigo-800' : 'text-gray-700')}
            >
              <span>{o.label}</span>
              {value === o.value && <Check className="h-4 w-4 text-indigo-600" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
