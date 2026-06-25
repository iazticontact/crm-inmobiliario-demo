'use client'

// Tooltip ligero y accesible (sin dependencias): icono (i) que muestra una explicación corta al
// pasar el cursor, al enfocar con teclado o al tocar en móvil. Premium y discreto. Pensado para
// aclarar métricas del Dashboard sin saturar la interfaz.

import { useState } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export function InfoTooltip({
  text,
  label = 'Más información',
  side = 'top',
  align = 'center',
  className,
}: {
  text: string
  label?: string
  side?: 'top' | 'bottom'
  align?: 'center' | 'left' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className={cn('relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v) }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className={cn(
            'absolute z-30 w-52 rounded-lg bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-white shadow-lg',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            align === 'center' && 'left-1/2 -translate-x-1/2',
            align === 'left' && 'left-0',
            align === 'right' && 'right-0',
          )}
        >
          {text}
        </span>
      )}
    </span>
  )
}
