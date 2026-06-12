// /api/team/users — list and invite workspace members.
//
// Authorisation:
//   - GET: workspace_admin (client_admin / nowlabs_admin). member → 403.
//   - POST: workspace_admin. client_admin cannot create nowlabs_admin.
//
// Workspace scope is ALWAYS the caller's workspace, never read from body.
// Service-role is used only for the writes that authenticated users cannot
// perform under RLS (insert into profiles, auth.admin.inviteUserByEmail).

import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  buildUserSupabase,
  canAssignRole,
  isValidEmail,
  isValidRole,
  resolveCaller,
  shapeProfile,
  type ProfileRole,
} from './_helpers'

export const runtime = 'nodejs'

export async function GET() {
  const caller = await resolveCaller()
  if ('error' in caller) return NextResponse.json({ error: caller.error }, { status: caller.status })

  if (!caller.isWorkspaceAdmin) {
    return NextResponse.json({ error: 'No tienes permisos para ver el equipo del workspace.' }, { status: 403 })
  }

  // Use the cookie-bound client — RLS already restricts SELECT to:
  //   (a) own profile, (b) workspace members for client_admin, (c) all for
  //   nowlabs_admin. So this query returns exactly the right rows without
  //   needing service_role.
  const supabase = await buildUserSupabase()
  if (!supabase) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 503 })

  let q = supabase
    .from('profiles')
    .select('id, email, full_name, role, workspace_id, trial_status, created_at, updated_at')
    .order('created_at', { ascending: true })

  // Pin to caller's workspace unless they are nowlabs_admin (who may want
  // cross-workspace visibility from internal tools). For the UI we still
  // filter to their own workspace by default.
  q = q.eq('workspace_id', caller.workspaceId)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: 'No se pudieron cargar los usuarios.' }, { status: 500 })
  }

  return NextResponse.json({
    users: (data ?? []).map((row) => shapeProfile(row as Record<string, unknown>)),
    callerRole: caller.role,
  })
}

type InvitePayload = {
  email?: unknown
  full_name?: unknown
  role?: unknown
}

export async function POST(req: NextRequest) {
  const caller = await resolveCaller()
  if ('error' in caller) return NextResponse.json({ error: caller.error }, { status: caller.status })

  if (!caller.isWorkspaceAdmin) {
    return NextResponse.json({ error: 'No tienes permisos para invitar usuarios.' }, { status: 403 })
  }

  let body: InvitePayload = {}
  try { body = (await req.json()) as InvitePayload } catch { /* empty body */ }

  const emailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const fullNameRaw = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const roleRaw = typeof body.role === 'string' ? body.role.trim() : ''

  if (!isValidEmail(emailRaw)) {
    return NextResponse.json({ error: 'Email inválido.' }, { status: 400 })
  }
  if (!fullNameRaw) {
    return NextResponse.json({ error: 'El nombre es obligatorio.' }, { status: 400 })
  }
  if (!isValidRole(roleRaw)) {
    return NextResponse.json({ error: 'Rol no permitido.' }, { status: 400 })
  }

  if (!canAssignRole(caller, roleRaw)) {
    return NextResponse.json({
      error: 'No puedes asignar ese rol. Solo un operador interno puede crear nowlabs_admin.',
    }, { status: 403 })
  }

  const admin = getSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({
      error: 'Invitación no disponible: falta SUPABASE_SERVICE_ROLE_KEY en el servidor.',
    }, { status: 503 })
  }

  // Idempotencia mínima: si ya existe un profile con ese email en este
  // workspace, no creamos otro auth user. Devolvemos el profile existente.
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, email, full_name, role, workspace_id, trial_status, created_at, updated_at')
    .ilike('email', emailRaw)
    .eq('workspace_id', caller.workspaceId)
    .maybeSingle()

  if (existingProfile) {
    return NextResponse.json({
      user: shapeProfile(existingProfile as Record<string, unknown>),
      alreadyExisted: true,
    })
  }

  // Si el email ya existe en otro workspace (poco probable pero posible para
  // emails NOWLabs), no lo movemos — lo rechazamos para no romper invariantes.
  const { data: foreignProfile } = await admin
    .from('profiles')
    .select('id, workspace_id')
    .ilike('email', emailRaw)
    .maybeSingle()

  if (foreignProfile && String(foreignProfile.workspace_id) !== caller.workspaceId) {
    return NextResponse.json({
      error: 'Ese email ya está vinculado a otro workspace.',
    }, { status: 409 })
  }

  // Lanzar la invitación oficial de Supabase Auth. Esto crea un auth.users
  // row y envía email de set-password. NO genera passwords en claro.
  // Añadimos ?type=invite al redirectTo para que /auth/callback sepa
  // mandar al usuario a /reset-password a fijar contraseña.
  //
  // En producción, NEXT_PUBLIC_APP_URL es obligatoria: sin ella el email
  // del invitado caería al Site URL configurado en Supabase, que puede no
  // coincidir con el dominio real del CRM. En desarrollo dejamos pasar
  // sin redirectTo para no bloquear pruebas locales.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!appUrl && process.env.NODE_ENV === 'production') {
    return NextResponse.json({
      error: 'No se puede invitar: NEXT_PUBLIC_APP_URL no está configurada en el servidor.',
    }, { status: 503 })
  }
  const redirectTo = appUrl
    ? `${appUrl.replace(/\/$/, '')}/auth/callback?type=invite`
    : undefined

  const invite = await admin.auth.admin.inviteUserByEmail(emailRaw, {
    data: { full_name: fullNameRaw, workspace_id: caller.workspaceId, role: roleRaw },
    ...(redirectTo ? { redirectTo } : {}),
  })

  if (invite.error || !invite.data?.user) {
    const msg = invite.error?.message ?? 'No se pudo enviar la invitación.'
    return NextResponse.json({ error: `Error de Auth: ${msg}` }, { status: 500 })
  }

  const newUserId = invite.data.user.id as string
  const newRole = roleRaw as ProfileRole

  // Crear profile mediante upsert para tolerar re-intentos (auth user creado
  // en intento anterior pero profile no llegó). workspace_id viene SIEMPRE
  // del caller, nunca del body.
  const { data: insertedProfile, error: insertErr } = await admin
    .from('profiles')
    .upsert({
      id: newUserId,
      workspace_id: caller.workspaceId,
      email: emailRaw,
      full_name: fullNameRaw,
      role: newRole,
    }, { onConflict: 'id' })
    .select('id, email, full_name, role, workspace_id, trial_status, created_at, updated_at')
    .single()

  if (insertErr || !insertedProfile) {
    // Best-effort rollback del auth.user para no dejar usuarios huérfanos.
    await admin.auth.admin.deleteUser(newUserId).catch(() => null)
    return NextResponse.json({
      error: `No se pudo crear el perfil: ${insertErr?.message ?? 'desconocido'}`,
    }, { status: 500 })
  }

  return NextResponse.json({
    user: shapeProfile(insertedProfile as Record<string, unknown>),
    invited: true,
  })
}
