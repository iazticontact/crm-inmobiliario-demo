'use client'

// Workspace / Empresa (P16) — datos editables REALES del workspace, persistidos en workspace_settings
// bajo RLS (cliente de navegador, nunca service_role):
//   - Nombre comercial      → columna business_name
//   - Descripción           → metadata.description (sin migración)
//   - Tipo de workspace      → columna vertical
// Un único "Guardar" con feedback honesto (guardado/error). Sin humo: si no hay sesión real, no finge
// persistencia.

import { useEffect, useState } from 'react'
import { Building2, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/current-user'
import {
  getWorkspaceSettings,
  upsertWorkspaceSettings,
  type WorkspaceVertical,
} from '@/lib/workspace-settings'

const DESCRIPTION_MAX = 200

// Inmobiliaria primero (vertical principal de este CRM); el resto disponible como contexto.
const VERTICAL_OPTIONS: Array<{ id: WorkspaceVertical; label: string; recommended?: boolean }> = [
  { id: 'real_estate', label: 'Inmobiliaria', recommended: true },
  { id: 'immigration', label: 'Extranjería' },
  { id: 'professional_services', label: 'Servicios' },
  { id: 'mixed', label: 'Mixto' },
  { id: 'general', label: 'General' },
]

export function WorkspaceProfileCard() {
  const { currentUser, isLoading: userLoading } = useCurrentUser()
  const workspaceId = currentUser?.workspaceId ?? null

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [vertical, setVertical] = useState<WorkspaceVertical>('real_estate')
  const [metadata, setMetadata] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (userLoading) return
    let cancelled = false
    queueMicrotask(() => {
      setLoading(true)
      void (async () => {
        const settings = workspaceId ? await getWorkspaceSettings(workspaceId) : null
        if (cancelled) return
        if (settings) {
          setName(settings.business_name ?? currentUser.workspaceName ?? '')
          const meta = (settings.metadata ?? {}) as Record<string, unknown>
          setMetadata(meta)
          setDescription(typeof meta.description === 'string' ? meta.description : '')
          setVertical(VERTICAL_OPTIONS.some((o) => o.id === settings.vertical) ? (settings.vertical as WorkspaceVertical) : 'real_estate')
        } else {
          setName(currentUser.workspaceName ?? '')
        }
        setLoading(false)
      })()
    })
    return () => { cancelled = true }
  }, [workspaceId, userLoading, currentUser.workspaceName])

  async function save() {
    if (!workspaceId) {
      toast.info('Inicia sesión real para guardar', { description: 'En modo de ejemplo los cambios no se persisten.' })
      return
    }
    setSaving(true)
    try {
      const row = await upsertWorkspaceSettings(workspaceId, {
        business_name: name.trim() || null,
        vertical,
        metadata: { ...metadata, description: description.trim() || undefined },
      })
      if (row) {
        setSaved(true)
        window.setTimeout(() => setSaved(false), 2500)
        toast.success('Workspace actualizado', { description: 'Los cambios se han guardado.' })
      } else {
        toast.error('No se pudo guardar', { description: 'Revisa tu conexión e inténtalo de nuevo.' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Workspace / Empresa"
      description="Nombre, descripción y tipo de tu inmobiliaria. Da contexto al CRM y al Asistente IA."
      action={
        saved
          ? <Badge variant="success" dot>Guardado</Badge>
          : <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"><Building2 className="h-3 w-3" /> Editable</span>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Nombre comercial</label>
          <input
            value={name}
            maxLength={80}
            disabled={loading}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej.: Inmobiliaria Costa Azul"
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Descripción</label>
            <span className={cn('text-[10px] tabular-nums', description.length > DESCRIPTION_MAX ? 'text-rose-500' : 'text-gray-400')}>
              {description.length} / {DESCRIPTION_MAX}
            </span>
          </div>
          <textarea
            value={description}
            maxLength={DESCRIPTION_MAX}
            disabled={loading}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej.: Agencia especializada en venta y alquiler residencial en la Costa del Sol."
            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Tipo de workspace</label>
          <div className="flex flex-wrap gap-1.5">
            {VERTICAL_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={loading}
                onClick={() => setVertical(opt.id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60',
                  vertical === opt.id
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-100 hover:bg-indigo-50/40',
                )}
              >
                {vertical === opt.id && <CheckCircle2 className="h-3 w-3" />}
                {opt.label}
                {opt.recommended && vertical !== opt.id && <span className="text-[9px] text-indigo-400">· recomendado</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
          <Button size="sm" onClick={save} loading={saving} disabled={loading || saving}>Guardar cambios</Button>
        </div>
      </div>
    </SectionCard>
  )
}
