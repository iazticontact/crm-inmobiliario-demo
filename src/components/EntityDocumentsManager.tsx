'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Upload, Trash2, Loader2, ExternalLink, Pencil, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  listEntityFiles, signedUrls, uploadEntityFile, deleteEntityFile, updateEntityFileMetadata,
  type EntityFile, type EntityType,
} from '@/lib/entity-files'
import { DOCUMENT_KINDS, documentKindLabel, normalizeDocumentKind } from '@/lib/document-kinds'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
const inputCls = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500'

function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return ''
}
function friendlyError(raw: string): { title: string; description?: string } {
  const m = raw.toLowerCase()
  if (/permission|denied|42501|not authorized|rls|policy/.test(m)) return { title: 'No tienes permisos para subir documentos aquí.' }
  if (/mime|not allowed|invalid_mime|unsupported/.test(m)) return { title: 'Formato no permitido.', description: 'Sube PDF o imagen (JPG/PNG/WebP).' }
  if (/size|exceed|too large|maximum|payload/.test(m)) return { title: 'El documento es demasiado grande.', description: 'Máximo 10 MB.' }
  return { title: 'No se pudo subir el documento.', description: raw || 'Revisa formato (PDF/imagen) y tamaño (máx. 10 MB).' }
}
function formatBytes(n: number | null): string {
  if (!n || n <= 0) return ''
  const u = ['B', 'KB', 'MB']; let v = n; let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1 }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}
function formatDate(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
const kindOf = (f: EntityFile) => (f.metadata && typeof f.metadata === 'object' ? (f.metadata as Record<string, unknown>).kind : undefined)

/**
 * Gestor de documentos reales por entidad (PDF/imagen). Reutilizable para cliente, inmueble, operación,
 * trámite o factura. Storage privado + signed URLs + RLS por workspace (sin service_role). Tipo (kind),
 * descripción, edición de metadata, borrado con confirmación y actividad (P36).
 */
export function EntityDocumentsManager({
  workspaceId, entityType, entityId, onCountChange,
  title = 'Documentos',
  description = 'Sube contratos, DNI/NIE, notas simples, escrituras o justificantes. PDF o imagen, hasta 10 MB.',
  emptyLabel = 'Aún no hay documentos vinculados. PDF o imagen, hasta 10 MB.',
}: {
  workspaceId: string | null
  entityType: EntityType
  entityId: string
  onCountChange?: (entityId: string, count: number) => void
  title?: string
  description?: string
  emptyLabel?: string
}) {
  const [files, setFiles] = useState<EntityFile[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [uploadKind, setUploadKind] = useState('document')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editKind, setEditKind] = useState('document')
  const [editDesc, setEditDesc] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return }
    try {
      const rows = await listEntityFiles(workspaceId, entityType, entityId, 'document')
      setFiles(rows)
      setUrls(await signedUrls(rows.map((r) => r.path)))
      onCountChange?.(entityId, rows.length)
    } catch {
      /* RLS / red: lista vacía sin romper */
    }
    setLoading(false)
  }, [workspaceId, entityType, entityId, onCountChange])

  useEffect(() => { queueMicrotask(() => { void reload() }) }, [reload])

  async function handlePick(list: FileList | null) {
    if (!list || !workspaceId) return
    const ws = workspaceId
    const kind = uploadKind
    const valid: File[] = []
    for (const f of Array.from(list)) {
      const okType = f.type === 'application/pdf' || f.type.startsWith('image/')
      if (!okType) { toast.error(`«${f.name}»: solo PDF o imagen`); continue }
      if (f.size > MAX_BYTES) { toast.error(`«${f.name}» supera 10 MB`); continue }
      if (f.size <= 0) { toast.error(`«${f.name}» está vacío`); continue }
      valid.push(f)
    }
    if (inputRef.current) inputRef.current.value = ''
    if (valid.length === 0) return
    setPending(valid.map((f) => ({ id: crypto.randomUUID(), name: f.name })))
    setUploading(true)
    let ok = 0
    for (const file of valid) {
      try {
        await uploadEntityFile({ workspaceId: ws, entityType, entityId, file, category: 'document', kind })
        ok += 1
      } catch (e) {
        const raw = errText(e)
        if (typeof console !== 'undefined') console.error('[EntityDocuments] upload failed', { entityType, entityId, name: file.name, error: raw })
        const fr = friendlyError(raw)
        toast.error(fr.title, { description: fr.description })
      }
    }
    setPending([])
    setUploading(false)
    if (ok > 0) toast.success(ok === 1 ? 'Documento subido' : `${ok} documentos subidos`)
    await reload()
  }

  async function handleDelete(f: EntityFile) {
    setBusyId(f.id)
    try { await deleteEntityFile(f); toast.success('Documento eliminado') }
    catch { toast.error('No se pudo eliminar el documento') }
    setBusyId(null)
    setConfirmId(null)
    await reload()
  }

  function startEdit(f: EntityFile) {
    setEditId(f.id)
    setEditKind(normalizeDocumentKind(kindOf(f)))
    setEditDesc(f.caption ?? '')
    setConfirmId(null)
  }
  async function saveEdit(f: EntityFile) {
    setBusyId(f.id)
    try { await updateEntityFileMetadata(f, { kind: editKind, description: editDesc }); toast.success('Documento actualizado') }
    catch { toast.error('No se pudo actualizar el documento') }
    setBusyId(null)
    setEditId(null)
    await reload()
  }

  function openDoc(f: EntityFile) {
    const url = urls[f.path]
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    else toast.error('No se pudo abrir el documento')
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</p>
          <p className="text-[10px] text-gray-400">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <select
            aria-label="Tipo de documento"
            value={uploadKind}
            onChange={(e) => setUploadKind(e.target.value)}
            disabled={uploading || !workspaceId}
            className="h-7 rounded-lg border border-gray-200 bg-white px-2 text-[11px] text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {DOCUMENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || !workspaceId}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploading ? 'Subiendo…' : 'Subir documento'}
          </button>
          <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void handlePick(e.target.files)} />
        </div>
      </div>

      {loading ? (
        <div className="space-y-1.5">{[0, 1].map((s) => <div key={s} className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />)}</div>
      ) : files.length === 0 && pending.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!workspaceId}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-3 py-3 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/30 disabled:opacity-50"
        >
          <FileText className="h-5 w-5 shrink-0 text-gray-300" />
          <span className="text-[11px] text-gray-500">{emptyLabel}</span>
        </button>
      ) : (
        <ul className="space-y-1.5">
          {pending.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-2.5 py-2">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />
              <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{p.name}</span>
              <span className="text-[10px] text-gray-400">Subiendo…</span>
            </li>
          ))}
          {files.map((f) => (
            <li key={f.id} className="rounded-lg border border-gray-100 bg-white px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100"><FileText className="h-3.5 w-3.5" /></span>
                <button type="button" onClick={() => openDoc(f)} className="min-w-0 flex-1 text-left" title="Abrir documento">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-xs font-medium text-gray-900">{f.file_name}</p>
                    <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">{documentKindLabel(kindOf(f))}</span>
                  </div>
                  <p className="truncate text-[10px] text-gray-400">{[formatBytes(f.size_bytes), formatDate(f.created_at), f.caption || ''].filter(Boolean).join(' · ')}</p>
                </button>
                <button type="button" onClick={() => openDoc(f)} title="Abrir / descargar" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"><ExternalLink className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => startEdit(f)} title="Editar" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => { setConfirmId(f.id); setEditId(null) }} disabled={busyId === f.id} title="Eliminar" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                  {busyId === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>

              {confirmId === f.id && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50/60 px-2.5 py-2">
                  <span className="text-[11px] text-red-700">
                    ¿Eliminar «{f.file_name}»?{kindOf(f) === 'invoice_pdf' ? ' Es el PDF de una factura emitida.' : ''}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => void handleDelete(f)} className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700">Eliminar</button>
                    <button type="button" onClick={() => setConfirmId(null)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
                  </div>
                </div>
              )}

              {editId === f.id && (
                <div className="mt-2 space-y-2 rounded-lg bg-gray-50/60 px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={editKind} onChange={(e) => setEditKind(e.target.value)} className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500">
                      {DOCUMENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                    <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Descripción (opcional)" className={`${inputCls} min-w-[160px] flex-1`} />
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <button type="button" onClick={() => void saveEdit(f)} disabled={busyId === f.id} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"><Check className="h-3 w-3" /> Guardar</button>
                    <button type="button" onClick={() => setEditId(null)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"><X className="h-3 w-3" /> Cancelar</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
