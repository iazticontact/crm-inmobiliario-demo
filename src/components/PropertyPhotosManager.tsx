'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Star, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  listEntityFiles, signedUrls, uploadEntityFile, deleteEntityFile, setCoverPhoto,
  type EntityFile,
} from '@/lib/entity-files'

const MAX_BYTES = 10 * 1024 * 1024

// Mensaje legible desde cualquier error (Error, PostgrestError {message}, StorageError…).
function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return ''
}

// Mapea el error técnico a un mensaje útil para el usuario.
function friendlyUploadError(raw: string): { title: string; description?: string } {
  const m = raw.toLowerCase()
  if (/permission|denied|42501|not authorized|rls|policy/.test(m)) {
    return { title: 'No tienes permisos para subir fotos a este inmueble.' }
  }
  if (/mime|not allowed|invalid_mime|unsupported/.test(m)) {
    return { title: 'Formato no permitido.', description: 'Usa JPG, PNG, WebP o GIF.' }
  }
  if (/size|exceed|too large|maximum|payload/.test(m)) {
    return { title: 'La imagen es demasiado grande.', description: 'Máximo 10 MB por foto.' }
  }
  return { title: 'No se pudo subir la foto.', description: raw || 'Revisa formato (JPG/PNG/WebP) y tamaño (máx. 10 MB).' }
}

// Galería real de fotos de un inmueble: subir (múltiples), ver, portada y borrar.
// Storage privado + signed URLs + RLS por workspace (sin service_role).
export function PropertyPhotosManager({ workspaceId, propertyId }: { workspaceId: string | null; propertyId: string }) {
  const [files, setFiles] = useState<EntityFile[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return }
    try {
      const rows = await listEntityFiles(workspaceId, 'property', propertyId, 'image')
      setFiles(rows)
      setUrls(await signedUrls(rows.map((r) => r.path)))
    } catch {
      /* RLS / red: deja la galería vacía sin romper */
    }
    setLoading(false)
  }, [workspaceId, propertyId])

  useEffect(() => { queueMicrotask(() => { void reload() }) }, [reload])

  async function handlePick(list: FileList | null) {
    if (!list || !workspaceId) return
    const picked = Array.from(list)
    setUploading(true)
    let ok = 0
    for (let i = 0; i < picked.length; i++) {
      const file = picked[i]
      if (!file.type.startsWith('image/')) { toast.error(`«${file.name}» no es una imagen`); continue }
      if (file.size > MAX_BYTES) { toast.error(`«${file.name}» supera 10 MB`); continue }
      try {
        await uploadEntityFile({ workspaceId, entityType: 'property', entityId: propertyId, file, category: 'image', isCover: files.length === 0 && i === 0 })
        ok += 1
      } catch (e) {
        const raw = errText(e)
        if (typeof console !== 'undefined') console.error('[PropertyPhotos] upload failed', { propertyId, workspaceId, name: file.name, type: file.type, size: file.size, error: raw })
        const f = friendlyUploadError(raw)
        toast.error(f.title, { description: f.description })
      }
    }
    if (ok > 0) toast.success(ok === 1 ? 'Foto subida' : `${ok} fotos subidas`)
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
    await reload()
  }

  async function handleCover(f: EntityFile) {
    if (!workspaceId || f.is_cover) return
    setBusyId(f.id)
    try { await setCoverPhoto(workspaceId, 'property', propertyId, f.id); toast.success('Portada actualizada') }
    catch { toast.error('No se pudo fijar la portada') }
    setBusyId(null)
    await reload()
  }

  async function handleDelete(f: EntityFile) {
    setBusyId(f.id)
    try { await deleteEntityFile(f); toast.success('Foto eliminada') }
    catch { toast.error('No se pudo eliminar la foto') }
    setBusyId(null)
    await reload()
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Fotos del inmueble</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || !workspaceId}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} {uploading ? 'Subiendo…' : 'Subir fotos'}
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => void handlePick(e.target.files)} />
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((s) => <div key={s} className="aspect-[4/3] animate-pulse rounded-lg bg-slate-100" />)}</div>
      ) : files.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!workspaceId}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center transition-colors hover:border-indigo-200 hover:bg-indigo-50/30 disabled:opacity-50"
        >
          <ImagePlus className="h-6 w-6 text-gray-300" />
          <span className="text-xs font-medium text-gray-600">Sube fotos del inmueble</span>
          <span className="text-[11px] text-gray-400">Fachada, salón, cocina, dormitorios… (JPG/PNG/WebP, hasta 10 MB)</span>
        </button>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {files.map((f) => (
            <li key={f.id} className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
              {urls[f.path]
                ? <img src={urls[f.path]} alt={f.caption ?? f.file_name} className="h-full w-full object-cover" />
                : <div className="flex h-full w-full items-center justify-center text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /></div>}
              {f.is_cover && (
                <span className="absolute left-1 top-1 inline-flex items-center gap-1 rounded-full bg-amber-500/95 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
                  <Star className="h-2.5 w-2.5 fill-white" /> Portada
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/55 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
                {!f.is_cover && (
                  <button type="button" title="Fijar como portada" disabled={busyId === f.id} onClick={() => void handleCover(f)} className="flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-gray-600 hover:text-amber-600 disabled:opacity-50">
                    <Star className="h-3 w-3" />
                  </button>
                )}
                <button type="button" title="Eliminar foto" disabled={busyId === f.id} onClick={() => void handleDelete(f)} className="flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-gray-600 hover:text-red-600 disabled:opacity-50">
                  {busyId === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
