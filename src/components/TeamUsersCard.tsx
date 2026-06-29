'use client'

// Equipo / Usuarios — gestión del workspace.
//
// Reglas de UI (mirroring de la autorización server-side):
//   - Sólo se renderiza si current user es client_admin o nowlabs_admin.
//   - El selector de rol esconde 'nowlabs_admin' a quienes no lo son.
//   - El servidor revalida cada acción; estos checks de UI solo evitan
//     mostrar opciones sin sentido — no son seguridad.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Mail, Plus, ShieldCheck, Trash2, User as UserIcon, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { cn } from '@/lib/utils'
import type { ProfileRole } from '@/lib/current-user'
import { BRAND } from '@/lib/brand'

type TeamUser = {
  id: string
  email: string | null
  full_name: string | null
  role: string
  workspace_id: string | null
  trial_status: string | null
  created_at: string | null
  updated_at: string | null
}

const ROLE_LABEL: Record<string, string> = {
  nowlabs_admin: 'Operador interno',
  client_admin: 'Administrador',
  member: 'Usuario',
}

const ROLE_BADGE: Record<string, 'success' | 'indigo' | 'default'> = {
  nowlabs_admin: 'success',
  client_admin: 'indigo',
  member: 'default',
}

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function TeamUsersCard({
  currentRole,
  currentUserId,
}: {
  currentRole: ProfileRole
  currentUserId?: string
}) {
  const isWorkspaceAdmin = currentRole === 'client_admin' || currentRole === 'nowlabs_admin'
  const isNowlabsAdmin = currentRole === 'nowlabs_admin'

  const [users, setUsers] = useState<TeamUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetch('/api/team/users')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUsers([])
        setLoadError(body?.error || `Error ${res.status}`)
        return
      }
      setUsers(Array.isArray(body?.users) ? body.users : [])
    } catch (err) {
      setUsers([])
      setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el equipo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isWorkspaceAdmin) return
    const timeout = window.setTimeout(() => { void loadUsers() }, 0)
    return () => window.clearTimeout(timeout)
  }, [isWorkspaceAdmin, loadUsers])

  if (!isWorkspaceAdmin) return null

  return (
    <SectionCard
      title="Equipo"
      description="Usuarios con acceso al workspace. Invita por email con un rol; recibirán un enlace seguro para definir su contraseña."
      action={
        <div className="flex items-center gap-2">
          <Badge variant="success" dot>Activo</Badge>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Invitar usuario
          </Button>
        </div>
      }
    >
      {/* Un fallo de carga del equipo no se le enseña al cliente como una alerta
          técnica: cae con elegancia al empty state (abajo). Solo el build de
          operador interno ve el detalle del error para poder diagnosticarlo. */}
      {loadError && process.env.NEXT_PUBLIC_NOWLABS_INTERNAL === 'true' && (
        <div className="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando equipo…
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-8 text-center">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-400 ring-1 ring-gray-200">
            <UserIcon className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-gray-700">Aún no hay otros usuarios en este workspace</p>
          <p className="mt-1 text-xs text-gray-500">Invita a tu equipo para trabajar juntos en el CRM.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-100">
          <table className="w-full">
            <thead className="bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Usuario</th>
                <th className="px-4 py-2.5 text-left font-semibold">Email</th>
                <th className="px-4 py-2.5 text-left font-semibold">Rol</th>
                <th className="px-4 py-2.5 text-left font-semibold">Alta</th>
                <th className="px-4 py-2.5 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isSelf={u.id === currentUserId}
                  canDelete={isNowlabsAdmin}
                  canEditRole={u.role !== 'nowlabs_admin' || isNowlabsAdmin}
                  showNowlabsAdminOption={isNowlabsAdmin}
                  onChanged={() => void loadUsers()}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inviteOpen && (
        <InviteUserModal
          showNowlabsAdminOption={isNowlabsAdmin}
          onClose={() => setInviteOpen(false)}
          onInvited={() => { setInviteOpen(false); void loadUsers() }}
        />
      )}
    </SectionCard>
  )
}

function UserRow({
  user,
  isSelf,
  canDelete,
  canEditRole,
  showNowlabsAdminOption,
  onChanged,
}: {
  user: TeamUser
  isSelf: boolean
  canDelete: boolean
  canEditRole: boolean
  showNowlabsAdminOption: boolean
  onChanged: () => void
}) {
  const [savingRole, setSavingRole] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleRoleChange = async (nextRole: string) => {
    if (nextRole === user.role) return
    setSavingRole(true)
    try {
      const res = await fetch(`/api/team/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `Error ${res.status}`)
      toast.success('Rol actualizado', { description: `${user.full_name ?? user.email ?? 'Usuario'} · ${ROLE_LABEL[nextRole] ?? nextRole}` })
      onChanged()
    } catch (err) {
      toast.error('No se pudo cambiar el rol', { description: err instanceof Error ? err.message : '' })
    } finally {
      setSavingRole(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/team/users/${user.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `Error ${res.status}`)
      toast.success('Usuario eliminado')
      onChanged()
    } catch (err) {
      toast.error('No se pudo eliminar el usuario', { description: err instanceof Error ? err.message : '' })
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const allowedRoles: string[] = showNowlabsAdminOption
    ? ['nowlabs_admin', 'client_admin', 'member']
    : ['client_admin', 'member']

  // No exponemos en el selector roles a los que el usuario no podría llegar.
  const visibleRoles = user.role === 'nowlabs_admin' && !showNowlabsAdminOption
    ? [user.role]
    : allowedRoles.includes(user.role)
      ? allowedRoles
      : [user.role, ...allowedRoles]

  return (
    <tr className="hover:bg-indigo-50/30">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-50 to-sky-50 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
            {(user.full_name ?? user.email ?? 'U').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">{user.full_name || 'Sin nombre'}</p>
            {isSelf && <p className="text-[10px] text-indigo-500">Tu cuenta</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-600">{user.email ?? '—'}</td>
      <td className="px-4 py-3">
        {isSelf || !canEditRole ? (
          <Badge variant={ROLE_BADGE[user.role] ?? 'default'}>{ROLE_LABEL[user.role] ?? user.role}</Badge>
        ) : (
          <select
            value={user.role}
            disabled={savingRole}
            onChange={(e) => void handleRoleChange(e.target.value)}
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {visibleRoles.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
            ))}
          </select>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(user.created_at)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {canDelete && !isSelf && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Eliminar usuario"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {confirmDelete && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancelar</Button>
              <Button size="sm" variant="danger" loading={deleting} onClick={() => void handleDelete()}>Confirmar</Button>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function InviteUserModal({
  showNowlabsAdminOption,
  onClose,
  onInvited,
}: {
  showNowlabsAdminOption: boolean
  onClose: () => void
  onInvited: () => void
}) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<string>('member')
  const [submitting, setSubmitting] = useState(false)

  const roleOptions = useMemo(() => {
    return showNowlabsAdminOption
      ? [
          { value: 'member', label: 'Usuario' },
          { value: 'client_admin', label: 'Administrador' },
          { value: 'nowlabs_admin', label: 'Operador interno' },
        ]
      : [
          { value: 'member', label: 'Usuario' },
          { value: 'client_admin', label: 'Administrador' },
        ]
  }, [showNowlabsAdminOption])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/team/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), full_name: fullName.trim(), role }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `Error ${res.status}`)
      if (body?.alreadyExisted) {
        toast.info('Usuario ya existía', { description: `${body.user?.email ?? email} ya tenía acceso al workspace.` })
      } else {
        toast.success('Invitación enviada', { description: `Hemos enviado el enlace de acceso a ${email}.` })
      }
      onInvited()
    } catch (err) {
      toast.error('No se pudo invitar', { description: err instanceof Error ? err.message : '' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <UserIcon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-950">Invitar usuario</h3>
              <p className="text-[11px] text-gray-500">El usuario recibirá acceso al workspace de {BRAND.workspaceName}.</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <p className="rounded-lg bg-indigo-50/60 px-3 py-2 text-[11px] leading-5 text-indigo-700 ring-1 ring-indigo-100">
            Invita a miembros de tu equipo (comerciales, administradores, gestores) para que accedan a
            este workspace y trabajen sobre los mismos clientes, inmuebles, operaciones y tareas. No es
            para clientes finales.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Nombre completo</span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              placeholder="Patricia García"
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Email</span>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="nombre@inmobiliaria.com"
                className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Rol</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {roleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          <div className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
            <p className="text-[11px] leading-5 text-gray-500">
              Le enviaremos un email con un enlace seguro para que defina su contraseña. No se generan ni se muestran contraseñas en claro.
            </p>
          </div>

          <div className={cn('flex items-center justify-end gap-2 pt-2')}>
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={submitting}>Cancelar</Button>
            <Button type="submit" size="sm" loading={submitting}>Enviar invitación</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
