// /api/team/users/[id] — edit (PATCH) and remove (DELETE) workspace members.
//
// PATCH:
//   - workspace_admin can update full_name.
//   - role changes require canAssignRole(caller, nextRole). client_admin can
//     promote/demote between client_admin/member, but never to nowlabs_admin.
//   - workspace_id is never read from the body. The target must already
//     belong to the caller's workspace (nowlabs_admin can cross workspaces).
//   - We block degrading the last workspace_admin of a workspace.
//   - A user cannot demote / change their own role from this endpoint.
//
// DELETE:
//   - Restricted to nowlabs_admin (matches the RLS `profiles_delete_admins`).
//   - Removes both the profile row and the auth.users entry (service_role).
//   - Cannot delete yourself.

import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  canAssignRole,
  isValidRole,
  resolveCaller,
  shapeProfile,
  type ProfileRole,
} from '../_helpers'

export const runtime = 'nodejs'

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

type TargetProfile = {
  id: string
  email: string | null
  full_name: string | null
  role: ProfileRole
  workspace_id: string | null
}

async function loadTargetProfile(admin: NonNullable<ReturnType<typeof getSupabaseAdminClient>>, targetId: string): Promise<TargetProfile | null> {
  const { data } = await admin
    .from('profiles')
    .select('id, email, full_name, role, workspace_id')
    .eq('id', targetId)
    .maybeSingle()
  if (!data) return null
  return {
    id: String(data.id ?? ''),
    email: typeof data.email === 'string' ? data.email : null,
    full_name: typeof data.full_name === 'string' ? data.full_name : null,
    role: (isValidRole(data.role) ? data.role : 'member') as ProfileRole,
    workspace_id: typeof data.workspace_id === 'string' ? data.workspace_id : null,
  }
}

/**
 * Cuenta cuántos administradores (client_admin OR nowlabs_admin) quedan en
 * `workspaceId` EXCLUYENDO el `excludeProfileId` (el target que estamos
 * a punto de degradar o borrar). Si devuelve 0, no podemos continuar:
 * dejaríamos el workspace sin administradores.
 */
async function countOtherAdminsInWorkspace(
  admin: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  workspaceId: string,
  excludeProfileId: string,
): Promise<number> {
  const { count } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('role', ['client_admin', 'nowlabs_admin'])
    .neq('id', excludeProfileId)
  return count ?? 0
}

type PatchBody = { full_name?: unknown; role?: unknown }

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await resolveCaller()
  if ('error' in caller) return NextResponse.json({ error: caller.error }, { status: caller.status })

  const { id: targetId } = await ctx.params
  if (!isUuid(targetId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  if (!caller.isWorkspaceAdmin) {
    return NextResponse.json({ error: 'No tienes permisos para editar usuarios.' }, { status: 403 })
  }

  // A user cannot change their own role through this endpoint. Updating your
  // own full_name still goes through the safe column-level grant + RLS path
  // from the cookie session, not here.
  if (targetId === caller.userId) {
    return NextResponse.json({
      error: 'No puedes cambiar tu propio rol desde el panel de equipo.',
    }, { status: 403 })
  }

  const admin = getSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({
      error: 'Edición no disponible: falta SUPABASE_SERVICE_ROLE_KEY en el servidor.',
    }, { status: 503 })
  }

  const target = await loadTargetProfile(admin, targetId)
  if (!target) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 })

  // Workspace scope. nowlabs_admin can edit users in any workspace; everyone
  // else can only edit within their own.
  if (!caller.isNowlabsAdmin && target.workspace_id !== caller.workspaceId) {
    return NextResponse.json({ error: 'Usuario fuera de tu workspace.' }, { status: 403 })
  }

  // Guarda transversal: NADA tocable en perfiles `nowlabs_admin` por quien
  // no sea nowlabs_admin. Esto cubre full_name, role, y cualquier campo que
  // pudiéramos añadir en el futuro al PATCH. Va ANTES del parseo del body
  // para que un client_admin no pueda renombrar a un operador NOWLabs.
  if (target.role === 'nowlabs_admin' && !caller.isNowlabsAdmin) {
    return NextResponse.json({
      error: 'Solo un operador interno puede modificar el perfil de otro nowlabs_admin.',
    }, { status: 403 })
  }

  let body: PatchBody = {}
  try { body = (await req.json()) as PatchBody } catch { /* empty body */ }

  const patch: { full_name?: string; role?: ProfileRole; updated_at?: string } = {}

  if (typeof body.full_name === 'string') {
    const trimmed = body.full_name.trim()
    if (!trimmed) return NextResponse.json({ error: 'El nombre no puede quedar vacío.' }, { status: 400 })
    patch.full_name = trimmed.slice(0, 200)
  }

  if (body.role !== undefined) {
    if (!isValidRole(body.role)) return NextResponse.json({ error: 'Rol no permitido.' }, { status: 400 })
    if (!canAssignRole(caller, body.role)) {
      return NextResponse.json({
        error: 'No puedes asignar ese rol. Solo un operador interno puede crear nowlabs_admin.',
      }, { status: 403 })
    }

    // No quedarse sin admins del workspace: si target era el último
    // workspace_admin (client_admin o nowlabs_admin) del workspace y vamos
    // a bajarlo a member, bloqueamos.
    if (
      body.role === 'member' &&
      (target.role === 'client_admin' || target.role === 'nowlabs_admin') &&
      target.workspace_id
    ) {
      const remaining = await countOtherAdminsInWorkspace(admin, target.workspace_id, target.id)
      if (remaining === 0) {
        return NextResponse.json({
          error: 'No puedes dejar el workspace sin administradores. Asigna otro admin antes de degradar este usuario.',
        }, { status: 409 })
      }
    }

    patch.role = body.role
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Sin cambios.' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()

  const { data, error } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', targetId)
    .select('id, email, full_name, role, workspace_id, trial_status, created_at, updated_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: `No se pudo actualizar: ${error?.message ?? 'desconocido'}` }, { status: 500 })
  }

  return NextResponse.json({ user: shapeProfile(data as Record<string, unknown>) })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await resolveCaller()
  if ('error' in caller) return NextResponse.json({ error: caller.error }, { status: caller.status })

  const { id: targetId } = await ctx.params
  if (!isUuid(targetId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  // RLS `profiles_delete_admins` restricts DELETE to nowlabs_admin. Mirror that.
  if (!caller.isNowlabsAdmin) {
    return NextResponse.json({
      error: 'Sólo un operador interno puede eliminar usuarios.',
    }, { status: 403 })
  }
  if (targetId === caller.userId) {
    return NextResponse.json({ error: 'No puedes eliminar tu propio usuario.' }, { status: 403 })
  }

  const admin = getSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({
      error: 'Eliminación no disponible: falta SUPABASE_SERVICE_ROLE_KEY en el servidor.',
    }, { status: 503 })
  }

  const target = await loadTargetProfile(admin, targetId)
  if (!target) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 })

  // No dejar el workspace del target sin administradores. Si target es
  // client_admin o nowlabs_admin y no hay otro admin en su workspace, el
  // borrado se rechaza con 409. Asignar primero otro admin y reintentar.
  if (
    (target.role === 'client_admin' || target.role === 'nowlabs_admin') &&
    target.workspace_id
  ) {
    const remaining = await countOtherAdminsInWorkspace(admin, target.workspace_id, target.id)
    if (remaining === 0) {
      return NextResponse.json({
        error: 'No puedes eliminar el último administrador del workspace. Asigna otro administrador antes.',
      }, { status: 409 })
    }
  }

  // Borrar profile primero (scoped por id). Tras éxito, intentar borrar
  // auth.users — su fallo se reporta como warning pero el profile ya queda
  // fuera, así que el usuario pierde acceso al workspace.
  const { data: deletedRows, error: deleteRowError } = await admin
    .from('profiles')
    .delete()
    .eq('id', targetId)
    .select('id')

  if (deleteRowError) {
    return NextResponse.json({ error: `No se pudo eliminar el perfil: ${deleteRowError.message}` }, { status: 500 })
  }
  if (!deletedRows || deletedRows.length === 0) {
    return NextResponse.json({ error: 'El usuario ya no existe.' }, { status: 404 })
  }

  let authWarning: string | null = null
  const authResult = await admin.auth.admin.deleteUser(targetId)
  if (authResult.error) authWarning = authResult.error.message

  return NextResponse.json({ ok: true, authWarning })
}
