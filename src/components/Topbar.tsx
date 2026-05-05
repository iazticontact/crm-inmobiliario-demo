'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Bell, Search, HelpCircle, Settings, CheckCircle, AlertCircle, Zap, Users, X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { clients } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const pageLabels: Record<string, { title: string; description: string }> = {
  '/dashboard': { title: 'Dashboard', description: 'Vista general de tu negocio' },
  '/assistant': { title: 'Asistente IA', description: 'Conversaciones y análisis inteligente' },
  '/clients': { title: 'Clientes', description: 'Gestión de leads y clientes' },
  '/automations': { title: 'Automatizaciones', description: 'Flujos y secuencias automáticas' },
  '/calendar': { title: 'Calendario', description: 'Reuniones y eventos' },
  '/billing': { title: 'Facturación', description: 'Facturas e ingresos' },
  '/settings': { title: 'Configuración', description: 'Ajustes del workspace' },
}

const mockNotifications = [
  { id: '1', icon: <Users className="h-3.5 w-3.5 text-indigo-500" />, bg: 'bg-indigo-50', title: 'Nuevo lead: Sofía Ramírez', desc: 'Vía WhatsApp — hace 5 min', unread: true },
  { id: '2', icon: <AlertCircle className="h-3.5 w-3.5 text-amber-500" />, bg: 'bg-amber-50', title: 'Factura vencida: Textil SL', desc: '€299 — vencida hace 15 días', unread: true },
  { id: '3', icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />, bg: 'bg-emerald-50', title: 'IA resolvió 12 consultas', desc: 'Tasa de éxito: 94% — hoy', unread: false },
  { id: '4', icon: <Zap className="h-3.5 w-3.5 text-violet-500" />, bg: 'bg-violet-50', title: 'Automatización ejecutada', desc: 'Bienvenida → 47 nuevos leads', unread: false },
]

export function Topbar() {
  const pathname = usePathname()
  const page = pageLabels[pathname] ?? { title: 'NowCRM', description: '' }

  const [notifOpen, setNotifOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [readNotifs, setReadNotifs] = useState<Set<string>>(new Set())

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

  const suggestions = query.length >= 2
    ? clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.company.toLowerCase().includes(query.toLowerCase())).slice(0, 4)
    : []

  const unreadCount = mockNotifications.filter((n) => n.unread && !readNotifs.has(n.id)).length

  const markAllRead = () => setReadNotifs(new Set(mockNotifications.map((n) => n.id)))

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200/70 bg-white/95 px-6 backdrop-blur">
      <div>
        <h1 className="text-base font-semibold text-gray-900">{page.title}</h1>
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
            className="h-8 w-48 rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white focus:w-56 transition-all"
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
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-gray-100 bg-white shadow-xl z-50 overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <span className="text-sm font-semibold text-gray-900">Notificaciones</span>
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
              <ul>
                {mockNotifications.map((n) => {
                  const isRead = readNotifs.has(n.id)
                  return (
                    <li
                      key={n.id}
                      onClick={() => setReadNotifs((prev) => new Set([...prev, n.id]))}
                      className={cn('flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 transition-colors', !isRead && 'bg-indigo-50/30')}
                    >
                      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${n.bg}`}>{n.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-xs font-medium text-gray-900', !isRead && 'font-semibold')}>{n.title}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{n.desc}</p>
                      </div>
                      {!isRead && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />}
                    </li>
                  )
                })}
              </ul>
              <div className="border-t border-gray-100 px-4 py-2.5 text-center">
                <button onClick={() => { setNotifOpen(false); toast.info('Centro de notificaciones próximamente') }} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                  Ver todas las notificaciones
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => toast.info('NowCRM Demo v2.0', { description: 'Prototipo funcional con IA y datos de ejemplo.' })}
          aria-label="Ayuda"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          <HelpCircle className="h-4 w-4" />
        </button>

        <Link
          href="/settings"
          aria-label="Configuración"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          <Settings className="h-4 w-4" />
        </Link>

        <Link
          href="/settings"
          aria-label="Abrir ajustes de usuario"
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white shadow-sm shadow-indigo-600/25 ring-2 ring-indigo-100 transition-transform hover:scale-105"
        >
          N
        </Link>
      </div>
    </header>
  )
}
