'use client'

// Workspace vertical preference — purely cosmetic for v1: stored in
// localStorage so the operator can save "this workspace is mainly immigration"
// without needing a schema migration. The /opportunities page can read this
// key later to pre-select the right vertical tab; nothing else depends on it.

import { useState } from 'react'
import { Briefcase, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'

type VerticalOption = 'general' | 'real_estate' | 'immigration' | 'professional_services' | 'mixed'

const STORAGE_KEY = 'nowcrm.workspaceVertical'

const OPTIONS: Array<{ id: VerticalOption; label: string; description: string; tone: string }> = [
  { id: 'general',                label: 'General',         description: 'Pipeline genérico sin opinión por defecto.',                         tone: 'border-slate-100 bg-slate-50' },
  { id: 'real_estate',            label: 'Inmobiliaria',    description: 'Captaciones, visitas y operaciones de venta o alquiler.',           tone: 'border-sky-100 bg-sky-50' },
  { id: 'immigration',            label: 'Extranjería',     description: 'Trámites NIE, arraigo, reagrupación, etc. con checklist.',          tone: 'border-violet-100 bg-violet-50' },
  { id: 'professional_services',  label: 'Servicios',       description: 'Asesorías, consultoras y servicios profesionales recurrentes.',   tone: 'border-emerald-100 bg-emerald-50' },
  { id: 'mixed',                  label: 'Mixto',           description: 'El workspace opera varios verticales a la vez.',                     tone: 'border-amber-100 bg-amber-50' },
]

function readStoredVertical(): VerticalOption | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) as VerticalOption | null
    return stored && OPTIONS.some((o) => o.id === stored) ? stored : null
  } catch { return null }
}

export function VerticalPreferenceCard() {
  const [selected, setSelected] = useState<VerticalOption>(() => readStoredVertical() ?? 'general')
  const [saved, setSaved] = useState<VerticalOption | null>(() => readStoredVertical())

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, selected)
      setSaved(selected)
      toast.success('Vertical del workspace guardado', { description: 'Solo aplica a esta sesión hasta que persistamos en Supabase.' })
    } catch {
      toast.error('No se pudo guardar la preferencia.')
    }
  }

  return (
    <SectionCard
      title="Vertical del workspace"
      description="Indica qué tipo de operación domina en este workspace. NowLabs y /operaciones lo usarán como contexto por defecto."
      action={
        <span className="inline-flex items-center gap-1 rounded-full border border-gray-100 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600">
          <Briefcase className="h-3 w-3" /> Preferencia local
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
              className={cn(
                'group flex flex-col rounded-xl border p-3 text-left transition-all',
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
            ? <>Guardado como <span className="font-semibold text-gray-700">{OPTIONS.find((o) => o.id === saved)?.label}</span>. La persistencia multi-dispositivo llegará cuando exista <code className="rounded bg-white px-1">workspace_settings</code>.</>
            : <>Se guarda como preferencia local de tu navegador. La persistencia multi-dispositivo llegará cuando exista <code className="rounded bg-white px-1">workspace_settings</code>.</>}
        </p>
        <Button variant="primary" size="sm" onClick={save} disabled={selected === saved}>
          {saved === selected ? 'Guardado' : 'Guardar'}
        </Button>
      </div>
    </SectionCard>
  )
}
