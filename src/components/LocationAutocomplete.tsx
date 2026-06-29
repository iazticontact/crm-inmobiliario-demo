'use client'

// Autocompletado de ubicación (P15, ampliado en P16) — ciudad o zona/barrio. Free-text con sugerencias
// en capas: valores reales del workspace + catálogo local (+ proveedor externo opcional, apagado). El
// usuario escribe, ve opciones ordenadas, navega con teclado y puede usar un valor personalizado si no
// figura. Sin dependencias externas. Normaliza al confirmar. Pensado para no ensuciar datos pero sin
// bloquear al comercial.

import { useId, useRef, useState } from 'react'
import { Loader2, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { foldAccents, normalizeLocationText } from '@/lib/locations/normalize-location'
import type { LocationSuggestion } from '@/lib/locations/location-catalog'

const INPUT_CLS =
  'h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors'

// Resalta la parte del texto que coincide con la búsqueda (si las longitudes alinean tras el folding).
function highlight(text: string, query: string) {
  const q = foldAccents(query)
  if (!q) return text
  const folded = foldAccents(text)
  if (folded.length !== text.length) return text
  const i = folded.indexOf(q)
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <span className="font-semibold text-indigo-700">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  )
}

export function LocationAutocomplete({
  label,
  value,
  onChange,
  suggestions,
  loading = false,
  capped = false,
  placeholder,
  helperText,
  error,
  allowCustom = true,
  customLabel = (q) => `Usar “${q}” como valor personalizado`,
  maxLength = 80,
  disabled = false,
  inputRef,
  onCommit,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  /** Sugerencias ya ordenadas (workspace + catálogo). */
  suggestions: LocationSuggestion[]
  /** Cargando valores del workspace (muestra un spinner discreto en el dropdown). */
  loading?: boolean
  /** Había más resultados de los mostrados → invita a seguir escribiendo. */
  capped?: boolean
  placeholder?: string
  helperText?: string
  error?: string
  allowCustom?: boolean
  customLabel?: (query: string) => string
  maxLength?: number
  disabled?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Se llama cuando un valor queda confirmado (selección/Enter/blur) — útil para pasar el foco. */
  onCommit?: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  const listId = useId()

  const trimmed = value.trim()
  const showCustom = allowCustom
    && trimmed.length > 0
    && /\p{L}/u.test(trimmed)
    && !suggestions.some((s) => foldAccents(s.value) === foldAccents(trimmed))

  type Row =
    | { kind: 'suggestion'; value: string; hint?: string; source: LocationSuggestion['source'] }
    | { kind: 'custom'; value: string }
  const rows: Row[] = [
    ...suggestions.map((s) => ({ kind: 'suggestion' as const, value: s.value, hint: s.hint, source: s.source })),
    ...(showCustom ? [{ kind: 'custom' as const, value: trimmed }] : []),
  ]

  function commit(raw: string) {
    const normalized = normalizeLocationText(raw)
    onChange(normalized)
    setOpen(false)
    setHighlighted(-1)
    onCommit?.(normalized)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setHighlighted((h) => (rows.length ? (h + 1) % rows.length : -1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => (rows.length ? (h - 1 + rows.length) % rows.length : -1))
    } else if (e.key === 'Enter') {
      if (open && highlighted >= 0 && rows[highlighted]) {
        e.preventDefault()
        commit(rows[highlighted].value)
      } else if (open) {
        e.preventDefault()
        commit(value)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setHighlighted(-1)
    }
  }

  const showDropdown = open && (rows.length > 0 || loading)

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          ref={ref}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => { setOpen(false); if (value) commit(value) }, 120)}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlighted(-1) }}
          onKeyDown={onKeyDown}
          className={cn(INPUT_CLS, error && 'border-red-500 focus:ring-red-500')}
        />
        {showDropdown && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl shadow-gray-950/10"
          >
            {loading && rows.length === 0 && (
              <li className="flex items-center gap-2 px-3 py-2 text-[11px] text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Buscando ubicaciones…
              </li>
            )}
            {rows.map((row, i) => (
              <li key={`${row.kind}-${row.value}`} role="option" aria-selected={i === highlighted}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); commit(row.value) }}
                  onMouseEnter={() => setHighlighted(i)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors',
                    i === highlighted ? 'bg-indigo-50' : 'hover:bg-indigo-50/60',
                  )}
                >
                  {row.kind === 'custom' ? (
                    <>
                      <span className="truncate text-xs text-gray-600">{customLabel(row.value)}</span>
                      <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 ring-1 ring-amber-100">Personalizado</span>
                    </>
                  ) : (
                    <>
                      <span className="truncate text-xs font-medium text-gray-900">{highlight(row.value, value)}</span>
                      {row.source === 'workspace' ? (
                        <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-600 ring-1 ring-indigo-100">En este workspace</span>
                      ) : row.hint ? (
                        <span className="shrink-0 text-[10px] text-gray-400">{row.hint}</span>
                      ) : null}
                    </>
                  )}
                </button>
              </li>
            ))}
            {capped && (
              <li className="px-3 py-1.5 text-[10px] text-gray-400">Sigue escribiendo para afinar…</li>
            )}
          </ul>
        )}
      </div>
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : helperText ? (
        <p className="text-[11px] leading-4 text-gray-400">{helperText}</p>
      ) : null}
    </div>
  )
}
