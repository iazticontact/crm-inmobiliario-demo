'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Bell, BellOff, Search, HelpCircle, X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/current-user'
import { searchClients } from '@/lib/supabase-queries'
import type { Client } from '@/lib/types'

const pageLabels: Record<string, { title: string; description: string }> = {
  '/dashboard':     { title: 'Dashboard',     description: 'Resumen del día y estado del negocio' },
  '/inbox':         { title: 'Inbox',         description: 'Conversaciones entrantes y borradores' },
  '/assistant':     { title: 'Asistente IA',  description: 'Copiloto del CRM para inmobiliaria y gestoría' },
  '/clients':       { title: 'Clientes',      description: 'Compradores, propietarios y leads' },
  '/opportunities': { title: 'Negocio',       description: 'Inmobiliaria · Gestoría · Pipeline' },
  '/automations':   { title: 'Automatizaciones', description: 'Flujos internos' },
  '/calendar':      { title: 'Calendar',      description: 'Visitas, asesorías y disponibilidad' },
  '/billing':       { title: 'Facturación',   description: 'Facturas e ingresos' },
  '/settings':      { title: 'Configuración', description: 'Ajustes del CRM' },
}

export function Topbar() {
  const pathname = usePathname()
  const page = pageLabels[pathname] ?? { title: 'Costa del Sol CRM', description: '' }
  const { currentUser, isLoading } = useCurrentUser()

  const [notifOpen, setNotifOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [readNotifs, setReadNotifs] = useState<Set<string>>(new Set())
  const [suggestions, setSuggestions] = useState<Client[]>([])

  const notifRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchFocused(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const runSearch = useCallback(async (q: string) => {
    if (!currentUser.workspaceId || q.length < 2) { setSuggestions([]); return }
    try {
      const results = await searchClients(currentUser.workspaceId, q)
      setSuggestions(results.slice(0, 4))
    } catch {
      setSuggestions([])
    }
  }, [currentUser.workspaceId])

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 300)
    return () => clearTimeout(t)
  }, [query, runSearch])

  // The notification center is wired to read real workspace alerts in a later
  // phase. Until then we keep the surface visible but empty — no demo
  // notifications, no fake leads, no fake overdue invoices.
  const visibleNotifications: Array<{ id: string; icon: React.ReactNode; bg: string; title: string; desc: string; unread: boolean }> = []
  const unreadCount = visibleNotifications.filter((n) => n.unread && !readNotifs.has(n.id)).length

  const markAllRead = () => setReadNotifs(new Set(visibleNotifications.map((n) => n.id)))

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center justify-between border-b border-gray-200/70 bg-white/88 px-6 shadow-sm shadow-gray-950/[0.025] backdrop-blur-xl">
      <div>
        <h1 className="text-base font-semibold text-gray-950">{page.title}</h1>
        {page.description && <p className="text-xs text-gray-400">{page.description}</p>}
      </div>

      <div className="flex items-center gap-1.5">
        {/* Search */}
        <div className="relative hidden md:block" ref={searchRef}>
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            placeholder="Buscar clientes..."
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            className="h-8 w-48 rounded-xl border border-gray-200 bg-white/80 pl-8 pr-3 text-sm text-gray-900 shadow-sm shadow-gray-950/[0.02] placeholder:text-gray-400 transition-all focus:w-56 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searchFocused && query.length >= 2 && (
            <div className="absolute top-full left-0 right-0 mt-1.5 rounded-xl border border-gray-100 bg-white shadow-lg overflow-hidden min-w-[220px] z-50">
              {suggestions.length > 0 ? (
                <>
                  <div className="px-3 py-2 border-b border-gray-50">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase">Clientes</span>
                  </div>
                  {suggestions.map((s) => (
                    <Link
                      key={s.id}
                      href="/clients"
                      onClick={() => { setQuery(''); setSearchFocused(false) }}
                      className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600">{s.avatar}</div>
                      <div>
                        <p className="text-xs font-medium text-gray-900">{s.name}</p>
                        <p className="text-[10px] text-gray-400">{s.company}</p>
                      </div>
                    </Link>
                  ))}
                </>
              ) : (
                <div className="px-3 py-3 text-xs text-gray-400">Sin resultados para &ldquo;{query}&rdquo;</div>
              )}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((v) => !v)}
            aria-label="Abrir notificaciones"
            className="relative flex h-8 w-8 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div
              role="dialog"
              aria-label="Notificaciones"
              className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] origin-top-right overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl shadow-gray-950/10 ring-1 ring-black/[0.04]"
            >
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">Notificaciones</span>
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">{unreadCount}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-[10px] font-medium text-indigo-600 hover:text-indigo-700">
                      Marcar todas leídas
                    </button>
                  )}
                  <button onClick={() => setNotifOpen(false)} aria-label="Cerrar notificaciones" className="text-gray-400 hover:text-gray-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <ul className="max-h-[60vh] overflow-y-auto">
                {visibleNotifications.map((n) => {
                  const isRead = readNotifs.has(n.id)
                  return (
                    <li
                      key={n.id}
                      onClick={() => setReadNotifs((prev) => new Set([...prev, n.id]))}
                      className={cn('flex items-start gap-3 border-b border-gray-50 px-4 py-3 last:border-0 cursor-pointer transition-colors hover:bg-gray-50', !isRead && 'bg-indigo-50/30')}
                    >
                      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${n.bg}`}>{n.icon}</div>
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-xs font-medium text-gray-900', !isRead && 'font-semibold')}>{n.title}</p>
                        <p className="mt-0.5 text-[10px] text-gray-400">{n.desc}</p>
                      </div>
                      {!isRead && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />}
                    </li>
                  )
                })}
                {visibleNotifications.length === 0 && (
                  <li className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                      <BellOff className="h-4 w-4" />
                    </div>
                    <p className="text-xs font-medium text-gray-600">Sin notificaciones nuevas</p>
                    <p className="text-[10px] leading-snug text-gray-400">
                      Aquí verás los nuevos leads, citas próximas y conversaciones urgentes en cuanto el CRM detecte actividad.
                    </p>
                  </li>
                )}
              </ul>
              <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-2.5 text-center">
                <button onClick={() => { setNotifOpen(false); toast.info('Centro de notificaciones próximamente') }} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                  Ver todas las notificaciones
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => toast.info('Ayuda', { description: 'Para soporte técnico contacta con el equipo de NOWLabs.' })}
          aria-label="Ayuda"
          className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
        >
          <HelpCircle className="h-4 w-4" />
        </button>

        {isLoading ? (
          <div className="ml-1 h-8 w-8 shrink-0 animate-pulse rounded-full bg-indigo-200/60 ring-2 ring-indigo-100" />
        ) : (
          <Link
            href="/settings"
            aria-label="Abrir ajustes de usuario"
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-700 text-xs font-bold text-white shadow-sm shadow-indigo-600/25 ring-2 ring-indigo-100 transition-transform hover:scale-105"
            title={`${currentUser.name} · ${currentUser.trialLabel}`}
          >
            {currentUser.initials}
          </Link>
        )}
      </div>
    </header>
  )
}
