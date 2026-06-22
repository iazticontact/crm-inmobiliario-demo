'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Mail, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// Enlaces de REDACCIÓN VACÍA (solo destinatario): sin asunto, cuerpo, plantilla ni tracking.
// El parámetro `to` se encodea (encodeURIComponent mantiene el email válido; '@' → '%40' es
// aceptado por Gmail/Outlook). El `mailto:` se deja literal para máxima compatibilidad.
function composeLinks(email: string) {
  const to = email.trim()
  const enc = encodeURIComponent(to)
  return {
    mailto: `mailto:${to}`,
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${enc}`,
    outlook: `https://outlook.office.com/mail/deeplink/compose?to=${enc}`,
  }
}

type Variant = 'button' | 'link'

/**
 * EmailAction — acción de email robusta y profesional.
 *
 * `mailto:` puede no abrir nada si el sistema/navegador no tiene cliente de correo asociado.
 * Para que el usuario NUNCA perciba el botón como roto, al pulsar se abre un popover con:
 *   • Abrir correo (mailto:)   • Abrir en Gmail   • Abrir en Outlook   • Copiar email
 * Todos abren redacción vacía con SOLO el destinatario (sin asunto/cuerpo/plantilla).
 */
export function EmailAction({
  email,
  variant = 'link',
  label = 'Email',
  className,
}: {
  email: string
  variant?: Variant
  label?: string
  className?: string
}) {
  const clean = email.trim()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node)) return
      if (triggerRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onMove() {
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  if (!clean) return null

  const links = composeLinks(clean)

  function toggle() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const panelW = 248
      const panelH = 184
      let left = rect.left
      if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8
      if (left < 8) left = 8
      let top = rect.bottom + 6
      if (top + panelH > window.innerHeight - 8) top = Math.max(8, rect.top - panelH - 6)
      setPos({ top, left })
    }
    setOpen((v) => !v)
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(clean)
      toast.success('Email copiado')
    } catch {
      toast.error('No se pudo copiar el email')
    }
    setOpen(false)
  }

  const itemCls = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-gray-700 transition-colors hover:bg-indigo-50/60 hover:text-indigo-700'

  return (
    <>
      {variant === 'button' ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Email: ${clean}`}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900',
            className,
          )}
        >
          <Mail className="h-3.5 w-3.5" /> {label}
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Email: ${clean}`}
          title={clean}
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-2 transition-colors hover:text-indigo-700 hover:decoration-indigo-500',
            className,
          )}
        >
          <Mail className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span className="truncate">{clean}</span>
        </button>
      )}

      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={`Opciones de email para ${clean}`}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: 248 }}
            className="z-[70] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg shadow-gray-950/10"
          >
            <div className="border-b border-gray-100 px-3 py-2">
              <p className="truncate text-xs font-semibold text-gray-900" title={clean}>{clean}</p>
              <p className="text-[10px] text-gray-400">Abre una redacción vacía (solo destinatario)</p>
            </div>
            <a role="menuitem" href={links.mailto} onClick={() => setOpen(false)} className={itemCls}>
              <Mail className="h-3.5 w-3.5 shrink-0 text-gray-400" /> Abrir correo
            </a>
            <a role="menuitem" href={links.gmail} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={itemCls}>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-gray-400" /> Abrir en Gmail
            </a>
            <a role="menuitem" href={links.outlook} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={itemCls}>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-gray-400" /> Abrir en Outlook
            </a>
            <button role="menuitem" type="button" onClick={copyEmail} className={cn(itemCls, 'border-t border-gray-100')}>
              <Copy className="h-3.5 w-3.5 shrink-0 text-gray-400" /> Copiar email
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
