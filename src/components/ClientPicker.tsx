'use client'

// Compact client selector used by the edit drawers and the "Vincular cliente"
// CTA in Inbox. It searches `clients` by name/email/company and returns the
// chosen client id back to the parent — never mutating anything by itself.
//
// The result is intentionally simple: the parent decides what to do with the
// id (write it to opportunities.client_id, conversations.client_id, …). The
// picker only debounces the search and renders the results.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, User as UserIcon, Loader2 } from 'lucide-react'
import { listClientsLite, type ClientLite } from '@/lib/vertical-queries'
import { cn } from '@/lib/utils'

type ClientPickerProps = {
  workspaceId: string | null
  value: string | null
  /** Optional label for the currently selected client (rendered as a pill). */
  valueLabel?: string | null
  onChange: (clientId: string | null, client?: ClientLite | null) => void
  placeholder?: string
  /** When true, the input is disabled but still shows the current pill. */
  disabled?: boolean
}

export function ClientPicker({
  workspaceId,
  value,
  valueLabel,
  onChange,
  placeholder = 'Buscar cliente por nombre, email o empresa…',
  disabled,
}: ClientPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ClientLite[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    if (!open) return
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true)
      try {
        const rows = await listClientsLite(workspaceId, { query, limit: 12 })
        setResults(rows)
      } finally {
        setLoading(false)
      }
    }, 180)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [query, workspaceId, open])

  const selectedPill = useMemo(() => {
    if (!value) return null
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
        <UserIcon className="h-3 w-3 shrink-0" />
        <span className="truncate">{valueLabel || value.slice(0, 8) + '…'}</span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full hover:bg-indigo-100"
            aria-label="Quitar cliente vinculado"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </span>
    )
  }, [value, valueLabel, disabled, onChange])

  return (
    <div className="relative">
      {selectedPill ? (
        <div className="mb-1.5">{selectedPill}</div>
      ) : null}
      {!value && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            disabled={disabled || !workspaceId}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder={!workspaceId ? 'Sin workspace activo' : placeholder}
            className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50"
          />
        </div>
      )}
      {open && !value && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-lg">
          {loading ? (
            <div className="flex items-center justify-center px-3 py-3 text-xs text-gray-400">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Buscando…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400">
              {query.trim() ? 'Sin resultados. Crea el cliente desde /clients.' : 'Empieza a escribir para buscar clientes existentes.'}
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => { onChange(c.id, c); setOpen(false); setQuery('') }}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-indigo-50/40',
                    )}
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-700">
                      {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'C'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-gray-900">{c.name}</p>
                      <p className="truncate text-[10px] text-gray-500">
                        {[c.company, c.email, c.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-gray-100 px-3 py-1.5 text-right">
            <button
              type="button"
              onClick={() => { setOpen(false); setQuery('') }}
              className="text-[10px] font-medium text-gray-500 hover:text-gray-700"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
