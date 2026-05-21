'use client'

// Workspace vertical preference. Persistence model after Fase E:
//   - With a real workspace_id → workspace_settings table (multi-device).
//   - Without a workspace_id (demo / offline) → localStorage fallback only.
//
// Save is honest about which path was taken: the badge below the grid reads
// "Guardado en workspace" when Supabase confirmed the write, and "Guardado
// localmente" if it only landed in localStorage. We never claim multi-device
// persistence when it didn't happen.

import { useEffect, useState } from 'react'
import { Briefcase, CheckCircle2, Cloud, HardDrive, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/current-user'
import {
  getWorkspaceSettings,
  upsertWorkspaceSettings,
  readLocalVertical,
  writeLocalVertical,
  type WorkspaceVertical,
} from '@/lib/workspace-settings'

type PersistenceState = 'local' | 'workspace' | 'unknown'

const OPTIONS: Array<{ id: WorkspaceVertical; label: string; description: string; tone: string }> = [
  { id: 'general',                label: 'General',         description: 'Pipeline genérico sin opinión por defecto.',                         tone: 'border-slate-100 bg-slate-50' },
  { id: 'real_estate',            label: 'Inmobiliaria',    description: 'Captaciones, visitas y operaciones de venta o alquiler.',           tone: 'border-sky-100 bg-sky-50' },
  { id: 'immigration',            label: 'Extranjería',     description: 'Trámites NIE, arraigo, reagrupación, etc. con checklist.',          tone: 'border-violet-100 bg-violet-50' },
  { id: 'professional_services',  label: 'Servicios',       description: 'Asesorías, consultoras y servicios profesionales recurrentes.',     tone: 'border-emerald-100 bg-emerald-50' },
  { id: 'mixed',                  label: 'Mixto',           description: 'El workspace opera varios verticales a la vez.',                     tone: 'border-amber-100 bg-amber-50' },
]

export function VerticalPreferenceCard() {
  const { currentUser, isLoading: userLoading } = useCurrentUser()
  const workspaceId = currentUser?.workspaceId ?? null

  const [selected, setSelected] = useState<WorkspaceVertical>('general')
  const [saved, setSaved] = useState<WorkspaceVertical | null>(null)
  const [persistence, setPersistence] = useState<PersistenceState>('unknown')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Load initial value: prefer Supabase row, fall back to localStorage.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const localValue = readLocalVertical()
      if (workspaceId) {
        const remote = await getWorkspaceSettings(workspaceId)
        if (cancelled) return
        if (remote) {
          const v = (OPTIONS.some((o) => o.id === remote.vertical) ? remote.vertical : 'general') as WorkspaceVertical
          setSelected(v)
          setSaved(v)
          setPersistence('workspace')
          setLoading(false)
          return
        }
      }
      // No remote row (or no workspace yet): use local.
      const v = localValue ?? 'general'
      if (cancelled) return
      setSelected(v)
      setSaved(localValue) // null if nothing was saved
      setPersistence(localValue ? 'local' : 'unknown')
      setLoading(false)
    }
    if (!userLoading) void load()
    return () => { cancelled = true }
  }, [workspaceId, userLoading])

  async function save() {
    setSaving(true)
    try {
      if (workspaceId) {
        const row = await upsertWorkspaceSettings(workspaceId, { vertical: selected })
        if (row) {
          // Mirror to localStorage so a refresh in the same tab is instant.
          writeLocalVertical(selected)
          setSaved(selected)
          setPersistence('workspace')
          toast.success('Vertical guardado en el workspace', { description: 'Persistencia multi-dispositivo activa.' })
          return
        }
        // Supabase write failed — fall through to local-only.
      }
      writeLocalVertical(selected)
      setSaved(selected)
      setPersistence('local')
      if (workspaceId) {
        toast.warning('Guardado solo localmente', { description: 'No se pudo escribir en workspace_settings — revisa RLS o conectividad.' })
      } else {
        toast.info('Guardado solo en este navegador', { description: 'Inicia sesión real para persistir entre dispositivos.' })
      }
    } finally {
      setSaving(false)
    }
  }

  const statusBadge = (() => {
    if (loading) return { tone: 'border-gray-100 bg-gray-50 text-gray-500', icon: <Loader2 className="h-3 w-3 animate-spin" />, label: 'Cargando…' }
    if (persistence === 'workspace') return { tone: 'border-emerald-100 bg-emerald-50 text-emerald-700', icon: <Cloud className="h-3 w-3" />, label: 'Guardado en workspace' }
    if (persistence === 'local') return { tone: 'border-amber-100 bg-amber-50 text-amber-700', icon: <HardDrive className="h-3 w-3" />, label: 'Guardado localmente' }
    return { tone: 'border-gray-100 bg-gray-50 text-gray-600', icon: <Briefcase className="h-3 w-3" />, label: 'Sin guardar todavía' }
  })()

  return (
    <SectionCard
      title="Vertical del workspace"
      description="Indica qué tipo de operación domina en este workspace. El Asistente IA y la sección Negocio lo usarán como contexto por defecto."
      action={
        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium', statusBadge.tone)}>
          {statusBadge.icon}
          {statusBadge.label}
        </span>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {OPTIONS.map((opt) => {
          const active = selected === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelected(opt.id)}
              disabled={loading || saving}
              className={cn(
                'group flex flex-col rounded-xl border p-3 text-left transition-all disabled:cursor-wait disabled:opacity-70',
                active
                  ? 'border-indigo-300 ring-2 ring-indigo-100 bg-white shadow-sm'
                  : 'border-gray-100 bg-white hover:border-indigo-100 hover:bg-indigo-50/30',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', opt.tone)}>{opt.label}</span>
                {active && <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600" />}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-gray-500">{opt.description}</p>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2 text-[11px] text-gray-500">
        <p>
          {saved
            ? <>Guardado como <span className="font-semibold text-gray-700">{OPTIONS.find((o) => o.id === saved)?.label}</span>{' '}
                {persistence === 'workspace'
                  ? <>en <code className="rounded bg-white px-1">workspace_settings</code> (multi-dispositivo).</>
                  : <>en este navegador (sin workspace conectado).</>}
              </>
            : workspaceId
              ? <>Se guardará en <code className="rounded bg-white px-1">workspace_settings</code> y se aplicará en todos los dispositivos del workspace.</>
              : <>Sin sesión real: se guardará solo en este navegador.</>}
        </p>
        <Button variant="primary" size="sm" onClick={save} disabled={loading || saving || selected === saved}>
          {saving ? 'Guardando…' : saved === selected ? 'Guardado' : 'Guardar'}
        </Button>
      </div>
    </SectionCard>
  )
}
