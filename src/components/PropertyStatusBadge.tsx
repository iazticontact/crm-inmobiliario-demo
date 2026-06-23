'use client'

import { cn } from '@/lib/utils'
import { propertyStatusBadge } from '@/lib/property-display'

// Badge de estado de inmueble (pill premium). Centraliza tamaño, color y el indicador "en directo"
// (punto verde pulsante) para que cards y ficha sean coherentes. `className` permite posicionar
// (p. ej. absolute en la card). `size="lg"` para la cabecera de la ficha.
export function PropertyStatusBadge({
  status,
  className,
  size = 'md',
}: {
  status: string
  className?: string
  size?: 'md' | 'lg'
}) {
  const b = propertyStatusBadge(status)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold leading-none',
        size === 'lg' ? 'px-3 py-1.5 text-xs' : 'px-2.5 py-1 text-[11px]',
        b.className,
        className,
      )}
    >
      {b.live && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      )}
      {b.label}
    </span>
  )
}
