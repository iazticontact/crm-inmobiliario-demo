'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Bot, Users, Zap, Calendar, CreditCard, Settings,
  ChevronRight, Sparkles, LogOut, ChevronUp, User, HelpCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/assistant', label: 'Asistente IA', icon: Bot },
  { href: '/clients', label: 'Clientes', icon: Users },
  { href: '/automations', label: 'Automatizaciones', icon: Zap },
  { href: '/calendar', label: 'Calendario', icon: Calendar },
  { href: '/billing', label: 'Facturación', icon: CreditCard },
  { href: '/settings', label: 'Configuración', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = () => {
    setUserMenuOpen(false)
    toast.success('Sesión cerrada', { description: 'Hasta la próxima. ¡Hasta pronto!' })
    setTimeout(() => router.push('/login'), 800)
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-gray-200/70 bg-white/95 shadow-sm shadow-gray-950/[0.02]">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-gray-100 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 shadow-sm">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-bold text-gray-900">NowCRM</span>
          <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">Pro</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                    isActive ? 'bg-indigo-50 text-indigo-700 shadow-sm shadow-indigo-950/[0.03]' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-indigo-600' : 'text-gray-400')} />
                  <span className="flex-1">{item.label}</span>
                  {isActive && <ChevronRight className="h-3.5 w-3.5 text-indigo-400" />}
                </Link>
              </li>
            )
          })}
        </ul>

        {/* Divider + quick links */}
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-0.5">
          <button
            onClick={() => toast.info('NowCRM Demo v2.0', { description: 'Prototipo funcional con IA y datos de ejemplo.' })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            <HelpCircle className="h-4 w-4 shrink-0 text-gray-400" />
            Ayuda
          </button>
        </div>
      </nav>

      {/* User menu */}
      <div className="shrink-0 border-t border-gray-100 p-3 relative" ref={menuRef}>
        {userMenuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-gray-100 bg-white shadow-lg overflow-hidden">
            <div className="border-b border-gray-50 px-4 py-3">
              <p className="text-xs font-semibold text-gray-900">NowCRM Demo</p>
              <p className="text-[10px] text-gray-400">iazti.contact@gmail.com</p>
            </div>
            <div className="p-1">
              <Link
                href="/settings"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Settings className="h-3.5 w-3.5 text-gray-400" />
                Configuración
              </Link>
              <button
                onClick={() => { setUserMenuOpen(false); toast.info('Perfil de usuario', { description: 'Edición de perfil próximamente.' }) }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <User className="h-3.5 w-3.5 text-gray-400" />
                Mi perfil
              </button>
              <div className="my-1 border-t border-gray-100" />
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Cerrar sesión
              </button>
            </div>
          </div>
        )}

        <button
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-lg p-2.5 hover:bg-gray-50 transition-colors"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">N</div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-xs font-semibold text-gray-900">NowCRM Demo</p>
            <p className="truncate text-[10px] text-gray-400">iazti.contact@gmail.com</p>
          </div>
          <ChevronUp className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', userMenuOpen ? 'rotate-180' : '')} />
        </button>
      </div>
    </aside>
  )
}
