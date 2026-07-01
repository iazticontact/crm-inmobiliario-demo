'use client'

// App shell responsive (P28B). En desktop (lg+) el sidebar es fijo como siempre.
// En móvil/tablet (<lg) el sidebar NO ocupa ancho: se oculta y se abre como drawer
// deslizable desde el botón de menú del Topbar. El contenido principal ocupa el
// 100% del ancho en móvil (sin margen del sidebar, sin scroll horizontal).

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import { cn } from '@/lib/utils'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false)
  const pathname = usePathname()

  // Cierra el drawer al navegar (cambio de ruta). queueMicrotask evita el aviso
  // set-state-in-effect (convención del repo) sin cambiar el comportamiento.
  useEffect(() => {
    queueMicrotask(() => setNavOpen(false))
  }, [pathname])

  // Escape cierra el drawer en móvil.
  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen])

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#f4f6fb_44%,#f7f8fb_100%)]">
      {/* Sidebar fijo — solo desktop (lg+) */}
      <div className="hidden h-full lg:flex">
        <Sidebar />
      </div>

      {/* Drawer de navegación — solo móvil/tablet (<lg) */}
      <div
        className={cn('fixed inset-0 z-50 lg:hidden', navOpen ? '' : 'pointer-events-none')}
        aria-hidden={!navOpen}
      >
        {/* Overlay */}
        <div
          className={cn(
            'absolute inset-0 bg-slate-950/60 backdrop-blur-[1px] transition-opacity duration-300',
            navOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setNavOpen(false)}
        />
        {/* Panel deslizable */}
        <div
          className={cn(
            'absolute inset-y-0 left-0 flex w-64 max-w-[84%] transform transition-transform duration-300 ease-out',
            navOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Navegación"
        >
          <Sidebar onClose={() => setNavOpen(false)} />
        </div>
      </div>

      {/* Columna principal — 100% del ancho en móvil */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setNavOpen(true)} />
        <main className="relative flex-1 overflow-y-auto overflow-x-hidden p-4 pb-8 sm:p-5 xl:p-6 xl:pb-10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.12),transparent_42%),radial-gradient(ellipse_at_top_right,rgba(14,165,233,0.08),transparent_38%)]" />
          <div className="relative pb-2">{children}</div>
        </main>
      </div>
    </div>
  )
}
