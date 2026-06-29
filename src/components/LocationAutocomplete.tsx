'use client'

// Autocompletado de ubicación 2.0 (P17) — async, tipo logística. Llama a /api/locations/suggest
// (empresa + proveedor externo opcional + catálogo local) con debounce, cancelación de peticiones
// obsoletas y caché por consulta. Si la red/proveedor falla, no rompe: deja las sugerencias previas.
// Soporta valor personalizado, navegación por teclado y normaliza al confirmar.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Loader2, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { foldAccents, normalizeLocationText } from '@/lib/locations/normalize-location'

const INPUT_CLS =
  'h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors'

type Source = 'workspace' | 'provider' | 'local'
type Item = { id: string; label: string; secondary?: string; kind?: string; source: Source; province?: string }

const KIND_LABEL: Record<string, string> = {
  municipality: 'Municipio', neighborhood: 'Barrio', district: 'Distrito', province: 'Provincia', locality: 'Localidad',
}

function highlight(text: string, query: string) {
  const q = foldAccents(query)
  if (!q) return text
  const folded = foldAccents(text)
  if (folded.length !== text.length) return text
  const i = folded.indexOf(q)
  if (i < 0) return text
  return (<>{text.slice(0, i)}<span className="font-semibold text-indigo-700">{text.slice(i, i + q.length)}</span>{text.slice(i + q.length)}</>)
}

export function LocationAutocomplete({
  label,
  value,
  onChange,
  type,
  locality,
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
  /** Tipo de ubicación buscada. */
  type: 'locality' | 'area'
  /** Localidad seleccionada (contexto para sugerir barrios). */
  locality?: string
  placeholder?: string
  helperText?: string
  error?: string
  allowCustom?: boolean
  customLabel?: (query: string) => string
  maxLength?: number
  disabled?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  onCommit?: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [capped, setCapped] = useState(false)
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  const listId = useId()
  const cacheRef = useRef<Map<string, { items: Item[]; capped: boolean }>>(new Map())
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<number | undefined>(undefined)

  const fetchSuggestions = useCallback((q: string) => {
    const key = `${type}:${(locality ?? '').toLowerCase()}:${q.trim().toLowerCase()}`
    const cached = cacheRef.current.get(key)
    if (cached) { setItems(cached.items); setCapped(cached.capped); setLoading(false); return }
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    const params = new URLSearchParams({ q: q.trim(), type })
    if (locality) params.set('locality', locality)
    fetch(`/api/locations/suggest?${params.toString()}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { items: [], capped: false }))
      .then((d: { items?: Item[]; capped?: boolean }) => {
        const next = { items: Array.isArray(d.items) ? d.items : [], capped: !!d.capped }
        cacheRef.current.set(key, next)
        if (cacheRef.current.size > 200) cacheRef.current.clear()
        setItems(next.items)
        setCapped(next.capped)
      })
      .catch(() => { /* abortada o de red: conservar sugerencias previas */ })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
  }, [type, locality])

  useEffect(() => {
    if (!open) return
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => fetchSuggestions(value), 250)
    return () => window.clearTimeout(debounceRef.current)
  }, [value, open, fetchSuggestions])

  const trimmed = value.trim()
  const showCustom = allowCustom && trimmed.length > 0 && /\p{L}/u.test(trimmed)
    && !items.some((s) => foldAccents(s.label) === foldAccents(trimmed))

  type Row = { kind: 'item'; item: Item } | { kind: 'custom'; value: string }
  const rows: Row[] = [
    ...items.map((item) => ({ kind: 'item' as const, item })),
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
        commit(rows[highlighted].kind === 'custom' ? (rows[highlighted] as { value: string }).value : (rows[highlighted] as { item: Item }).item.label)
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
        {loading && <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-300" />}
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
          <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl shadow-gray-950/10">
            {loading && rows.length === 0 && (
              <li className="flex items-center gap-2 px-3 py-2 text-[11px] text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> Buscando ubicaciones…</li>
            )}
            {rows.map((row, i) => (
              <li key={row.kind === 'custom' ? 'custom' : row.item.id} role="option" aria-selected={i === highlighted}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); commit(row.kind === 'custom' ? row.value : row.item.label) }}
                  onMouseEnter={() => setHighlighted(i)}
                  className={cn('flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors', i === highlighted ? 'bg-indigo-50' : 'hover:bg-indigo-50/60')}
                >
                  {row.kind === 'custom' ? (
                    <>
                      <span className="truncate text-xs text-gray-600">{customLabel(row.value)}</span>
                      <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 ring-1 ring-amber-100">Personalizado</span>
                    </>
                  ) : (
                    <>
                      <span className="truncate text-xs font-medium text-gray-900">{highlight(row.item.label, value)}</span>
                      {row.item.source === 'workspace' ? (
                        <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-600 ring-1 ring-indigo-100">Usado en tu empresa</span>
                      ) : row.item.secondary ? (
                        <span className="shrink-0 text-[10px] text-gray-400">{row.item.secondary}</span>
                      ) : row.item.kind && KIND_LABEL[row.item.kind] ? (
                        <span className="shrink-0 text-[10px] text-gray-400">{KIND_LABEL[row.item.kind]}</span>
                      ) : null}
                    </>
                  )}
                </button>
              </li>
            ))}
            {capped && <li className="px-3 py-1.5 text-[10px] text-gray-400">Sigue escribiendo para afinar…</li>}
          </ul>
        )}
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : helperText ? <p className="text-[11px] leading-4 text-gray-400">{helperText}</p> : null}
    </div>
  )
}
