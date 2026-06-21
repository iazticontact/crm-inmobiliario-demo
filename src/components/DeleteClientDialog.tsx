'use client'

// Eliminación de cliente con doble confirmación + preview de impacto.
//   Paso 1: muestra qué se borrará (operaciones, tareas, citas, expedientes,
//           actividades, referencias del asistente) leído de /api/clients/[id]/delete.
//   Paso 2: exige escribir el NOMBRE EXACTO del cliente antes de habilitar el
//           botón final. El backend revalida ese nombre y la autorización.
// Si el preview falla, NO se permite borrar.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/Button'

type Related = {
  opportunities: number
  service_cases: number
  tasks: number
  calendar_events: number
  activities: number
  assistant_memories: number
  properties: number
}

const IMPACT_LABELS: { key: keyof Related; singular: string; plural: string }[] = [
  { key: 'opportunities', singular: 'operación', plural: 'operaciones' },
  { key: 'service_cases', singular: 'expediente', plural: 'expedientes' },
  { key: 'tasks', singular: 'tarea', plural: 'tareas' },
  { key: 'calendar_events', singular: 'cita', plural: 'citas' },
  { key: 'activities', singular: 'actividad', plural: 'actividades' },
  { key: 'assistant_memories', singular: 'referencia del asistente', plural: 'referencias del asistente' },
]

export function DeleteClientDialog({
  client,
  onClose,
  onDeleted,
}: {
  client: { id: string; name: string } | null
  onClose: () => void
  onDeleted: (name: string) => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [related, setRelated] = useState<Related | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Cargar el preview de impacto al abrir. Diferimos el setState inicial con
  // setTimeout(0) para no llamar setState síncrono en el cuerpo del efecto
  // (regla react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!client) return
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      setStep(1)
      setTyped('')
      setRelated(null)
      setPreviewError('')
      setLoadingPreview(true)
      fetch(`/api/clients/${client.id}/delete`)
        .then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (cancelled) return
          if (!res.ok) { setPreviewError(body?.error || 'No se pudo calcular el impacto del borrado.'); return }
          setRelated(body?.related ?? null)
        })
        .catch(() => { if (!cancelled) setPreviewError('No se pudo conectar para calcular el impacto.') })
        .finally(() => { if (!cancelled) setLoadingPreview(false) })
    }, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [client])

  const nameMatches = client != null && typed.trim().toLowerCase() === client.name.trim().toLowerCase()

  const handleConfirm = useCallback(async () => {
    if (!client || !nameMatches) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/clients/${client.id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: typed.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error('No se pudo eliminar el cliente', { description: body?.error || 'Inténtalo de nuevo.' })
        return
      }
      onDeleted(client.name)
    } catch {
      toast.error('No se pudo eliminar el cliente', { description: 'Revisa tu conexión.' })
    } finally {
      setDeleting(false)
    }
  }, [client, nameMatches, typed, onDeleted])

  if (!client) return null

  const impactItems = related
    ? IMPACT_LABELS.map((l) => ({ ...l, count: related[l.key] })).filter((i) => i.count > 0)
    : []
  const hasImpact = impactItems.length > 0
  const propertiesKept = related?.properties ?? 0

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !deleting) onClose() }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600"><Trash2 className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-950">Eliminar cliente</h3>
              <p className="truncate text-[11px] text-gray-500">{client.name}</p>
            </div>
          </div>
          <button onClick={() => { if (!deleting) onClose() }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-6 py-5">
          {loadingPreview ? (
            <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculando impacto…</div>
          ) : previewError ? (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">{previewError}</div>
          ) : step === 1 ? (
            <>
              <p className="text-sm text-gray-700">
                Vas a eliminar a <span className="font-semibold text-gray-900">{client.name}</span>
                {hasImpact ? ' y su información relacionada:' : '. Este cliente no tiene información relacionada.'}
              </p>
              {hasImpact && (
                <ul className="mt-3 space-y-1.5 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                  {impactItems.map((i) => (
                    <li key={i.key} className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      <span className="font-semibold tabular-nums text-gray-900">{i.count}</span>
                      {i.count === 1 ? i.singular : i.plural}
                    </li>
                  ))}
                </ul>
              )}
              {propertiesKept > 0 && (
                <p className="mt-2 text-[11px] text-gray-500">
                  {propertiesKept} propiedad{propertiesKept === 1 ? '' : 'es'} se conservará{propertiesKept === 1 ? '' : 'n'} (sin propietario asignado).
                </p>
              )}
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50/60 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                <p className="text-[11px] leading-5 text-red-700">Esta acción no se puede deshacer.</p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-700">
                Para confirmar, escribe el nombre del cliente: <span className="font-semibold text-gray-900">{client.name}</span>
              </p>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={client.name}
                disabled={deleting}
                onKeyDown={(e) => { if (e.key === 'Enter' && nameMatches) void handleConfirm() }}
                className="mt-3 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none placeholder:text-gray-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
              />
            </>
          )}
        </div>

        {!loadingPreview && (
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            {previewError ? (
              <Button variant="secondary" size="sm" onClick={onClose}>Cerrar</Button>
            ) : step === 1 ? (
              <>
                <Button variant="secondary" size="sm" onClick={onClose} disabled={deleting}>Cancelar</Button>
                <Button variant="danger" size="sm" onClick={() => setStep(2)}>Continuar</Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => setStep(1)} disabled={deleting}>Volver</Button>
                <Button variant="danger" size="sm" loading={deleting} disabled={!nameMatches} onClick={() => void handleConfirm()}>Eliminar definitivamente</Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
