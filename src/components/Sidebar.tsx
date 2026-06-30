'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Bot, Users, Zap, Calendar, CreditCard, Settings,
  Sparkles, LogOut, ChevronUp, User, HelpCircle, Loader2, CheckCircle,
  Inbox, Building2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { clearWorkspaceIdentityCache } from '@/lib/supabase-queries'
import { getWorkspaceSettings } from '@/lib/workspace-settings'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { useWorkspaceIdentity } from '@/components/WorkspaceIdentityProvider'
import { featureFlags, type FlagKey } from '@/lib/feature-flags'
import { BRAND } from '@/lib/brand'

// `flag` lets a client clone hide a module via NEXT_PUBLIC_ENABLE_* env vars
// without touching code. `internal` marks entries that only appear when
// NEXT_PUBLIC_NOWLABS_INTERNAL=true — used for operator-only modules that
// still exist as routes but are not part of the client navigation surface
// (WhatsApp/Inbox, Automatizaciones, Facturación). See src/lib/feature-flags.ts.
const navItems: Array<{ href: string; label: string; icon: typeof LayoutDashboard; flag?: FlagKey; internal?: boolean }> = [
  { href: '/dashboard',     label: 'Dashboard',         icon: LayoutDashboard },
  { href: '/clients',       label: 'Clientes',          icon: Users },
  { href: '/opportunities', label: 'Cartera',           icon: Building2,  flag: 'opportunities' },
  { href: '/calendar',      label: 'Calendario',        icon: Calendar,   flag: 'calendar' },
  { href: '/assistant',     label: 'Asistente IA',      icon: Bot,        flag: 'assistant' },
  // Operator-only routes kept in code but hidden from the client sidebar.
  // WhatsApp/Inbox has no real backend yet (no conversations/messages tables,
  // no Meta Cloud API) — keep it operator-only until its phase. Route/page intact.
  { href: '/inbox',         label: 'WhatsApp',          icon: Inbox,      flag: 'inbox',       internal: true },
  { href: '/automations',   label: 'Automatizaciones',  icon: Zap,        flag: 'automations', internal: true },
  { href: '/billing',       label: 'Facturación',       icon: CreditCard, flag: 'billing',     internal: true },
  { href: '/settings',      label: 'Configuración',     icon: Settings },
]

const visibleNavItems = navItems.filter((item) => {
  if (item.flag && !featureFlags[item.flag]) return false
  if (item.internal && !featureFlags.nowlabsInternal) return false
  return true
})

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { currentUser, isLoading } = useWorkspaceIdentity()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutComplete, setLogoutComplete] = useState(false)
  // Logo de empresa (P22) — para la tarjeta de cuenta. Fallback a iniciales si no hay o si falla.
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)
  const [logoError, setLogoError] = useState(false)
  const workspaceId = currentUser.workspaceId
  useEffect(() => {
    let cancelled = false
    if (!workspaceId || currentUser.isDemo) {
      queueMicrotask(() => { if (!cancelled) setCompanyLogo(null) })
      return () => { cancelled = true }
    }
    void getWorkspaceSettings(workspaceId).then((s) => {
      const url = (s?.metadata as Record<string, unknown> | undefined)?.company_logo_url
      if (!cancelled) { setCompanyLogo(typeof url === 'string' ? url : null); setLogoError(false) }
    }).catch(() => { if (!cancelled) setCompanyLogo(null) })
    return () => { cancelled = true }
  }, [workspaceId, currentUser.isDemo])
  const menuRef = useRef<HTMLDivElement>(null)

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = async () => {
    if (loggingOut) return
    setUserMenuOpen(false)
    setLoggingOut(true)
    setLogoutComplete(false)
    toast.info('Cerrando sesión', { description: 'Guardando estado local y limpiando sesión.' })
    window.localStorage.removeItem(DEMO_MODE_KEY)
    // Drop the cached workspace identity immediately so no stale tenant context
    // can survive into the next login in this tab (the auth-event listener also
    // clears it on SIGNED_OUT; this is the belt-and-suspenders path).
    clearWorkspaceIdentityCache()
    const supabase = getSupabaseBrowserClient()
    if (supabase && !currentUser.isDemo) {
      const { error } = await supabase.auth.signOut()
      if (error) toast.warning('Sesión local cerrada', { description: 'No se confirmó el cierre remoto. Vuelve a iniciar sesión.' })
    }
    await wait(520)
    setLogoutComplete(true)
    toast.success('Sesión cerrada')
    await wait(520)
    router.replace('/login')
    router.refresh()
  }

  return (
    <>
    <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col border-r border-white/10 bg-[radial-gradient(circle_at_28%_0%,rgba(124,58,237,0.22),transparent_32%),linear-gradient(180deg,#180b38_0%,#110928_46%,#070814_100%)] text-white shadow-2xl shadow-slate-950/20">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-white to-indigo-100 text-indigo-700 shadow-lg shadow-indigo-950/30 ring-1 ring-white/60">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-white">{BRAND.appName}</span>
          </div>
          {BRAND.poweredBy && <p className="text-[10px] text-slate-500">{BRAND.poweredBy}</p>}
        </div>
      </div>

      {/* Nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-5">
        <ul className="space-y-0.5">
          {visibleNavItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-gradient-to-r from-white to-indigo-50 text-slate-950 shadow-lg shadow-black/20'
                      : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
                  )}
                >
                  {isActive && <span className="absolute -left-1 h-6 w-1 rounded-full bg-violet-400" />}
                  <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-indigo-100')} />
                  <span className="flex-1">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>

        {isLoading ? (
          <div className="mt-5 rounded-2xl border border-violet-300/15 bg-white/[0.065] p-3 shadow-xl shadow-black/10 ring-1 ring-white/[0.03]">
            <div className="h-3 w-24 rounded-full bg-white/10 animate-pulse" />
            <div className="mt-1.5 h-2 w-40 rounded-full bg-white/5 animate-pulse" />
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-violet-300/15 bg-white/[0.065] p-3 shadow-xl shadow-black/10 ring-1 ring-white/[0.03]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]" />
              <p className="text-xs font-semibold text-slate-100">Cuenta activa</p>
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
              {currentUser.workspaceName} — CRM listo para usar.
            </p>
          </div>
        )}

        {/* Divider + quick links */}
        <div className="mt-4 space-y-0.5 border-t border-white/10 pt-4">
          <button
            onClick={() => toast.info('Soporte', { description: `Para incidencias contacta con el responsable interno o con el ${BRAND.supportName}.` })}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <HelpCircle className="h-4 w-4 shrink-0 text-slate-500" />
            Ayuda
          </button>
        </div>
      </nav>

      {/* User menu */}
      <div className="relative shrink-0 border-t border-white/10 px-3 pb-8 pt-3" ref={menuRef}>
        {userMenuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-xl border border-gray-100 bg-white text-gray-900 shadow-xl">
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-xs font-semibold text-gray-900">{currentUser.workspaceName}</p>
              <p className="text-[10px] text-gray-400">{currentUser.email}</p>
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

        {isLoading ? (
          <div className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.07] p-3 shadow-lg shadow-black/10 ring-1 ring-white/[0.02]">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-24 rounded-full bg-white/10 animate-pulse" />
              <div className="mt-1.5 h-2 w-32 rounded-full bg-white/5 animate-pulse" />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.07] p-3 text-left shadow-lg shadow-black/10 ring-1 ring-white/[0.02] transition-colors hover:border-violet-200/20 hover:bg-white/[0.11]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-white to-indigo-100 text-xs font-bold text-indigo-700 ring-1 ring-white/70">
              {companyLogo && !logoError
                ? <img src={companyLogo} alt={`Logo de ${currentUser.workspaceName}`} className="h-full w-full object-contain p-0.5" onError={() => setLogoError(true)} />
                : currentUser.initials}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-xs font-semibold text-white">{currentUser.workspaceName}</p>
              <p className="truncate text-[10px] text-slate-500">{currentUser.email}</p>
            </div>
            <ChevronUp className={cn('h-3.5 w-3.5 text-slate-500 transition-transform', userMenuOpen ? 'rotate-180' : '')} />
          </button>
        )}
      </div>
    </aside>
    {loggingOut && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-md">
        <div className="w-full max-w-xs overflow-hidden rounded-2xl border border-white/10 bg-[#090d1b] px-5 py-5 text-center text-white shadow-2xl shadow-slate-950/35">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.08] text-indigo-100 ring-1 ring-white/10">
            {logoutComplete ? <CheckCircle className="h-5 w-5 text-emerald-200" /> : <Loader2 className="h-5 w-5 animate-spin" />}
          </div>
          <p className="text-sm font-semibold">{logoutComplete ? 'Sesión cerrada' : 'Cerrando sesión'}</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            {logoutComplete ? 'Volviendo a la pantalla de acceso.' : 'Guardando estado local y limpiando sesión...'}
          </p>
        </div>
      </div>
    )}
    </>
  )
}
