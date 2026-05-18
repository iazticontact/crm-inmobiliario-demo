'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type SideDrawerProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  width?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  footer?: React.ReactNode
}

const WIDTHS: Record<NonNullable<SideDrawerProps['width']>, string> = {
  sm: 'w-full sm:w-[420px]',
  md: 'w-full sm:w-[520px]',
  lg: 'w-full sm:w-[640px]',
}

export function SideDrawer({
  open,
  onClose,
  title,
  description,
  width = 'md',
  children,
  footer,
}: SideDrawerProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <aside
        className={cn(
          'absolute right-0 top-0 flex h-full flex-col bg-white shadow-2xl shadow-slate-950/20 transition-transform',
          WIDTHS[width],
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-gray-900">{title}</h2>
            {description ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="border-t border-gray-100 bg-gray-50/60 px-5 py-3">{footer}</footer>
        ) : null}
      </aside>
    </div>
  )
}
