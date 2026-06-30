'use client'

// Foto de perfil (P20). Preview inmediata, validación de tipo/tamaño, subida real a Supabase Storage y
// persistencia en el user_metadata del usuario. Fallback estable a iniciales. Sin recorte obligatorio
// (forma circular con object-cover). Accesible (input file oculto + labels).

import { useRef, useState } from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { uploadAvatar, removeAvatar, validateAvatarFile, AVATAR_MIME_TYPES } from '@/lib/profile-avatar'

export function AvatarUploader({
  userId,
  initials,
  avatarUrl,
  disabled = false,
  onChanged,
}: {
  userId?: string
  initials: string
  avatarUrl?: string
  disabled?: boolean
  /** Se llama tras subir/eliminar con la nueva URL (o null) para refrescar la UI. */
  onChanged?: (url: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)

  const shown = preview ?? (imgError ? null : avatarUrl)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite re-elegir el mismo archivo
    if (!file) return
    const v = validateAvatarFile(file)
    if (!v.ok) { toast.error('No se pudo usar la imagen', { description: v.error }); return }
    if (!userId) { toast.info('Inicia sesión real para guardar tu foto'); return }
    const localUrl = URL.createObjectURL(file)
    setPreview(localUrl)
    setImgError(false)
    setBusy(true)
    try {
      const res = await uploadAvatar(userId, file)
      if (res.ok) {
        setPreview(null)
        onChanged?.(res.url)
        toast.success('Foto de perfil actualizada')
      } else {
        setPreview(null)
        toast.error('No se pudo guardar la foto', { description: res.error })
      }
    } finally {
      setBusy(false)
      URL.revokeObjectURL(localUrl)
    }
  }

  async function onRemove() {
    if (!avatarUrl || busy) return
    setBusy(true)
    try {
      const res = await removeAvatar()
      if (res.ok) { onChanged?.(null); setImgError(false); toast.success('Foto eliminada') }
      else toast.error('No se pudo eliminar la foto')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        aria-label={avatarUrl ? 'Cambiar foto de perfil' : 'Subir foto de perfil'}
        className="group relative h-16 w-16 shrink-0 rounded-full ring-2 ring-indigo-100 transition-transform hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-wait"
      >
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-violet-700 text-xl font-bold text-white">
          {shown ? (
            <img src={shown} alt="Foto de perfil" className="h-full w-full object-cover" onError={() => setImgError(true)} />
          ) : (
            <span>{initials}</span>
          )}
        </div>
        {/* Insignia de cámara: invita a cambiar la foto al pasar el ratón / siempre visible en táctil. */}
        <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-900 text-white shadow-sm transition-colors group-hover:bg-indigo-600">
          <Camera className="h-3 w-3" />
        </span>
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30">
            <Loader2 className="h-4 w-4 animate-spin text-white" />
          </div>
        )}
      </button>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            <Camera className="h-3.5 w-3.5" /> {avatarUrl ? 'Cambiar foto' : 'Subir foto'}
          </button>
          {avatarUrl && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={onRemove}
              aria-label="Eliminar foto de perfil"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-gray-400">JPG, PNG o WebP · máx. 2 MB</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_MIME_TYPES.join(',')}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={onPick}
      />
    </div>
  )
}
