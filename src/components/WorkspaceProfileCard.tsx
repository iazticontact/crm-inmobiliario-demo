'use client'

// Empresa (P16→P17) — datos editables REALES de la empresa, persistidos bajo RLS (cliente de
// navegador, nunca service_role): nombre comercial → business_name; descripción, teléfono, web y email
// de contacto → metadata (sin migración). "Actividad principal: Inmobiliaria" es fija para este CRM
// (no se muestran chips multivertical). Un único Guardar con feedback honesto. UI sin la palabra
// "workspace".

import { useEffect, useState } from 'react'
import { Building2, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/current-user'
import { getWorkspaceSettings, upsertWorkspaceSettings } from '@/lib/workspace-settings'

const DESCRIPTION_MAX = 220
const URL_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FIELD_INPUT = 'h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60'

export function WorkspaceProfileCard() {
  const { currentUser, isLoading: userLoading } = useCurrentUser()
  const workspaceId = currentUser?.workspaceId ?? null

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [email, setEmail] = useState('')
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
        const meta = (settings?.metadata ?? {}) as Record<string, unknown>
        setMetadata(meta)
        setName(settings?.business_name ?? currentUser.workspaceName ?? '')
        setDescription(typeof meta.description === 'string' ? meta.description : '')
        setPhone(typeof meta.phone === 'string' ? meta.phone : '')
        setWebsite(typeof meta.website === 'string' ? meta.website : '')
        setEmail(typeof meta.contact_email === 'string' ? meta.contact_email : '')
        setLoading(false)
      })()
    })
    return () => { cancelled = true }
  }, [workspaceId, userLoading, currentUser.workspaceName])

  function validate(): string | null {
    if (!name.trim()) return 'El nombre de la empresa es obligatorio.'
    if (description.length > DESCRIPTION_MAX) return 'La descripción es demasiado larga.'
    if (website.trim() && !URL_RE.test(website.trim())) return 'La web no parece una URL válida.'
    if (email.trim() && !EMAIL_RE.test(email.trim())) return 'El email de contacto no es válido.'
    return null
  }

  async function save() {
    const err = validate()
    if (err) { toast.error('Revisa los datos', { description: err }); return }
    if (!workspaceId) { toast.info('Inicia sesión real para guardar', { description: 'En modo de ejemplo los cambios no se persisten.' }); return }
    setSaving(true)
    try {
      const row = await upsertWorkspaceSettings(workspaceId, {
        business_name: name.trim(),
        vertical: 'real_estate',
        metadata: {
          ...metadata,
          description: description.trim() || undefined,
          phone: phone.trim() || undefined,
          website: website.trim() || undefined,
          contact_email: email.trim() || undefined,
        },
      })
      if (row) {
        setSaved(true)
        window.setTimeout(() => setSaved(false), 2500)
        toast.success('Datos de la empresa guardados')
      } else {
        toast.error('No se pudo guardar', { description: 'Revisa tu conexión e inténtalo de nuevo.' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Empresa"
      description="Datos de tu inmobiliaria. Dan contexto al CRM y al Asistente IA."
      action={saved ? <Badge variant="success" dot>Guardado</Badge> : <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"><Building2 className="h-3 w-3" /> Editable</span>}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Nombre comercial</label>
            <input value={name} maxLength={80} disabled={loading} onChange={(e) => setName(e.target.value)} placeholder="Inmobiliaria Costa Azul" className={FIELD_INPUT} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Actividad principal</label>
            <div className="flex h-9 items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 text-sm text-gray-600">
              <CheckCircle2 className="h-3.5 w-3.5 text-indigo-500" /> Inmobiliaria
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Descripción</label>
            <span className={cn('text-[10px] tabular-nums', description.length > DESCRIPTION_MAX ? 'text-rose-500' : 'text-gray-400')}>{description.length} / {DESCRIPTION_MAX}</span>
          </div>
          <textarea value={description} maxLength={DESCRIPTION_MAX} disabled={loading} rows={2} onChange={(e) => setDescription(e.target.value)} placeholder="Agencia especializada en venta y alquiler residencial en la Costa del Sol." className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60" />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Teléfono</label>
            <input value={phone} maxLength={30} disabled={loading} onChange={(e) => setPhone(e.target.value)} placeholder="+34 600 000 000" className={FIELD_INPUT} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Web</label>
            <input value={website} maxLength={120} disabled={loading} onChange={(e) => setWebsite(e.target.value)} placeholder="www.tuinmobiliaria.com" className={FIELD_INPUT} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Email de contacto</label>
            <input value={email} maxLength={120} disabled={loading} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@tuinmobiliaria.com" className={FIELD_INPUT} />
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
