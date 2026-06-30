'use client'

// Logo de empresa (P22) — distinto del avatar personal. Cuadrado redondeado con object-contain (no
// deforma logos), fondo neutro. Subida real a Storage + persistencia en workspace_settings. Fallback a
// iniciales de la empresa. Validación tipo/tamaño y errores humanos.

import { useRef, useState } from 'react'
import { Camera, ImageIcon, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { uploadCompanyLogo, removeCompanyLogo } from '@/lib/company-logo'
import { validateAvatarFile, AVATAR_MIME_TYPES } from '@/lib/profile-avatar'

export function CompanyLogoUploader({
  workspaceId,
  companyName,
  logoUrl,
  disabled = false,
  onChanged,
}: {
  workspaceId?: string
  companyName: string
  logoUrl?: string
  disabled?: boolean
  onChanged?: (url: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  const shown = preview ?? (imgError ? null : logoUrl)
  const initials = (companyName || 'Empresa').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'EM'

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const v = validateAvatarFile(file)
    if (!v.ok) { toast.error('No se pudo usar la imagen', { description: v.error }); return }
    if (!workspaceId) { toast.info('Inicia sesión real para guardar el logo'); return }
    const localUrl = URL.createObjectURL(file)
    setPreview(localUrl); setImgError(false); setBusy(true)
    try {
      const res = await uploadCompanyLogo(workspaceId, file)
      if (res.ok) { setPreview(null); onChanged?.(res.url); toast.success('Logo de empresa actualizado') }
      else { setPreview(null); toast.error('No se pudo guardar el logo', { description: res.error }) }
    } finally { setBusy(false); URL.revokeObjectURL(localUrl) }
  }

  async function onRemove() {
    if (!logoUrl || busy || !workspaceId) return
    setBusy(true)
    try {
      const res = await removeCompanyLogo(workspaceId)
      if (res.ok) { onChanged?.(null); setImgError(false); toast.success('Logo eliminado') }
      else toast.error('No se pudo eliminar el logo')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        aria-label={logoUrl ? 'Cambiar logo de empresa' : 'Subir logo de empresa'}
        className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 transition-transform hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-wait"
      >
        {shown ? (
          <img src={shown} alt={`Logo de ${companyName || 'la empresa'}`} className="h-full w-full object-contain p-1.5" onError={() => setImgError(true)} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-base font-bold text-gray-400">{initials}</span>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-900 text-white shadow-sm transition-colors group-hover:bg-indigo-600">
          <Camera className="h-3 w-3" />
        </span>
        {busy && <div className="absolute inset-0 flex items-center justify-center bg-black/30"><Loader2 className="h-4 w-4 animate-spin text-white" /></div>}
      </button>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <button type="button" disabled={disabled || busy} onClick={() => inputRef.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60">
            <ImageIcon className="h-3.5 w-3.5" /> {logoUrl ? 'Cambiar logo' : 'Subir logo'}
          </button>
          {logoUrl && (
            <button type="button" disabled={disabled || busy} onClick={onRemove} aria-label="Eliminar logo de empresa" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-gray-400">Logo de empresa · JPG, PNG o WebP · máx. 2 MB</p>
      </div>

      <input ref={inputRef} type="file" accept={AVATAR_MIME_TYPES.join(',')} className="hidden" aria-hidden="true" tabIndex={-1} onChange={onPick} />
    </div>
  )
}
