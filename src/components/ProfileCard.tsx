'use client'

// Perfil (P17 + foto real en P20) — identidad del usuario. El nombre visible es EDITABLE (se persiste en
// profiles.full_name bajo RLS, sin service_role) y ahora la FOTO de perfil es real (Supabase Storage +
// user_metadata, ver AvatarUploader). Email, rol y estado son solo lectura.

import { useEffect, useState } from 'react'
import { Globe, Mail, Shield, User } from 'lucide-react'
import { toast } from 'sonner'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { AvatarUploader } from '@/components/AvatarUploader'
import { useCurrentUser } from '@/lib/current-user'
import { getSupabaseBrowserClient } from '@/lib/supabase'

const ROLE_LABEL: Record<string, string> = {
  client_admin: 'Administrador',
  nowlabs_admin: 'Operador interno',
  member: 'Usuario',
}

export function ProfileCard() {
  const { currentUser, isLoading: userLoading } = useCurrentUser()
  const [name, setName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [saving, setSaving] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(currentUser.avatarUrl)

  useEffect(() => {
    if (userLoading) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      const initial = currentUser.name || ''
      setName(initial)
      setSavedName(initial)
      setAvatarUrl(currentUser.avatarUrl)
    })
    return () => { cancelled = true }
  }, [userLoading, currentUser.name, currentUser.avatarUrl])

  const dirty = name.trim() !== savedName.trim() && name.trim().length > 0

  async function save() {
    if (!dirty) return
    if (currentUser.isDemo || !currentUser.id) {
      toast.info('Inicia sesión real para guardar', { description: 'En modo de ejemplo los cambios no se persisten.' })
      return
    }
    const supabase = getSupabaseBrowserClient()
    if (!supabase) return
    setSaving(true)
    try {
      const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', currentUser.id)
      if (error) {
        toast.error('No se pudo guardar el nombre', { description: 'Inténtalo de nuevo.' })
      } else {
        setSavedName(name.trim())
        toast.success('Nombre actualizado', { description: 'Se reflejará por completo al recargar.' })
      }
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { label: 'Email', value: currentUser.email, icon: <Mail className="h-4 w-4" /> },
    { label: 'Rol', value: ROLE_LABEL[currentUser.role] ?? 'Usuario', icon: <Shield className="h-4 w-4" /> },
    { label: 'Idioma', value: 'Español', icon: <Globe className="h-4 w-4" /> },
    { label: 'Estado de la cuenta', value: currentUser.trialLabel, icon: <User className="h-4 w-4" /> },
  ]

  return (
    <SectionCard title="Perfil" description="Tu identidad en el CRM.">
      <div className="mb-4 space-y-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AvatarUploader
            userId={currentUser.id}
            initials={userLoading ? '..' : currentUser.initials}
            avatarUrl={avatarUrl}
            disabled={userLoading}
            onChanged={(url) => setAvatarUrl(url ?? undefined)}
          />
          <Badge variant={userLoading ? 'default' : currentUser.isDemo ? 'indigo' : 'success'}>{userLoading ? 'Cargando' : currentUser.trialLabel}</Badge>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">Nombre visible</label>
          <div className="flex items-center gap-2">
            <input
              value={name}
              maxLength={80}
              disabled={userLoading}
              onChange={(e) => setName(e.target.value)}
              placeholder={currentUser.email}
              className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {dirty && <Button size="sm" onClick={save} loading={saving}>Guardar</Button>}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {fields.map(({ label, value, icon }) => (
          <div key={label} className="flex items-center gap-2.5 rounded-xl border border-gray-100 bg-white px-3 py-3">
            <span className="text-gray-400">{icon}</span>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="truncate text-sm font-medium text-gray-900">{userLoading ? '…' : value}</p>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
