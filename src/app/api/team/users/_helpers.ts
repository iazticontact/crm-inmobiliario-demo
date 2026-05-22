// Shared helpers for /api/team/users routes.
//
// Authorisation model — verified against `docs/supabase/costadelsol_schema_v1.sql`:
//   - profiles.role ∈ {'nowlabs_admin','client_admin','member'} (CHECK constraint)
//   - INSERT on profiles is revoked from `authenticated` → profile rows can
//     only be created server-side with SUPABASE_SERVICE_ROLE_KEY.
//   - UPDATE on profiles is column-grained from the cookie session
//     (email/full_name/metadata/updated_at only); role and workspace_id
//     mutations must go through service_role.
//   - DELETE on profiles is restricted to nowlabs_admin.
//
// Every route in this folder MUST:
//   1. Authenticate the request via the cookie-bound Supabase client.
//   2. Resolve the caller's `profiles.role` + `profiles.workspace_id`.
//   3. Enforce role checks (workspace_admin → list/invite/edit;
//      nowlabs_admin → cross-workspace; member → forbidden).
//   4. Pin `workspace_id` to the caller's workspace — never trust the body.
//   5. Block role-escalation (client_admin assigning nowlabs_admin, etc.).
//   6. Use the service-role client (from `@/lib/supabase-admin`) ONLY for the
//      privileged write itself, after all checks have passed.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export type ProfileRole = 'nowlabs_admin' | 'client_admin' | 'member'

export const PROFILE_ROLES: readonly ProfileRole[] = ['nowlabs_admin', 'client_admin', 'member'] as const

export function isValidRole(value: unknown): value is ProfileRole {
  return typeof value === 'string' && (PROFILE_ROLES as readonly string[]).includes(value)
}

export async function buildUserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { /* static */ }
      },
    },
  })
}

export type Caller = {
  userId: string
  email: string
  workspaceId: string
  role: ProfileRole
  isNowlabsAdmin: boolean
  isWorkspaceAdmin: boolean
}

export type CallerError = { error: string; status: 401 | 403 | 500 | 503 }

/**
 * Authenticate the caller and resolve their `role` + `workspace_id` from
 * `profiles`. Returns either a fully-typed `Caller` or an error envelope.
 *
 * - 401 if there is no Supabase session.
 * - 403 if the user has no profile row or no workspace assigned. This is the
 *   "Tu usuario no está vinculado a un workspace" path; we do NOT auto-create
 *   profiles here.
 */
export async function resolveCaller(): Promise<Caller | CallerError> {
  const supabase = await buildUserSupabase()
  if (!supabase) return { error: 'Supabase no configurado', status: 503 }

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) return { error: 'No autenticado', status: 401 }

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, email, workspace_id, role')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileErr) return { error: 'No se pudo resolver el perfil del usuario', status: 500 }
  if (!profile || !profile.workspace_id) {
    return { error: 'Tu usuario no está vinculado a un workspace. Contacta con el responsable interno.', status: 403 }
  }

  const role = (isValidRole(profile.role) ? profile.role : 'member') as ProfileRole
  const isNowlabsAdmin = role === 'nowlabs_admin'
  const isWorkspaceAdmin = isNowlabsAdmin || role === 'client_admin'

  return {
    userId: String(profile.id),
    email: String(profile.email ?? userData.user.email ?? ''),
    workspaceId: String(profile.workspace_id),
    role,
    isNowlabsAdmin,
    isWorkspaceAdmin,
  }
}

/** Whether `assigner` is allowed to set the target role `nextRole`. */
export function canAssignRole(assigner: Caller, nextRole: ProfileRole): boolean {
  // nowlabs_admin can assign any role.
  if (assigner.isNowlabsAdmin) return true
  // client_admin can assign client_admin / member but NOT nowlabs_admin.
  if (assigner.role === 'client_admin') return nextRole === 'client_admin' || nextRole === 'member'
  // member can assign nothing.
  return false
}

export function shapeProfile(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    email: typeof row.email === 'string' ? row.email : null,
    full_name: typeof row.full_name === 'string' ? row.full_name : null,
    role: typeof row.role === 'string' ? row.role : 'member',
    workspace_id: typeof row.workspace_id === 'string' ? row.workspace_id : null,
    trial_status: typeof row.trial_status === 'string' ? row.trial_status : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_RE.test(value.trim())
}
