// POST /api/onboarding/workspace — self-service provisioning of an EMPTY
// workspace for an authenticated user who does not have one yet.
//
// This is the "factory" alta flow: an operator creates (or invites) the auth
// user, the client logs in, and on first entry creates their own empty
// workspace here — no manual SQL editor step. The new workspace starts with
// ZERO data: no demo seed, no Oier/Familia Soler/"Demo Inmobiliaria". The
// client lands on the factory empty states.
//
// Security model (mirrors /api/team/users):
//   - Requires a valid Supabase session (cookie-bound client). 401 otherwise.
//   - Idempotent: if the user already has a profile with a workspace, we return
//     it and never create a second workspace.
//   - profiles / workspaces INSERT are revoked from `authenticated`, so the
//     writes go through the service-role client ONLY after the session is
//     verified. workspace_id is taken from the freshly created row, never body.

import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase-admin'
import { buildUserSupabase } from '@/app/api/team/users/_helpers'

export const runtime = 'nodejs'

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 80) : ''
}

export async function POST(req: NextRequest) {
  const supabase = await buildUserSupabase()
  if (!supabase) {
    return NextResponse.json({ error: 'Configuración de acceso incompleta.' }, { status: 503 })
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }
  const user = userData.user

  const admin = getSupabaseAdminClient()
  if (!admin) {
    // Sin service_role no podemos provisionar de forma segura: el alta vuelve a
    // ser un paso de operador (ver docs/FACTORY_STATE_AND_DEMO_DATA_POLICY.md).
    return NextResponse.json({
      error: 'El alta automática de espacio de trabajo no está disponible en este servidor. Contacta con el responsable.',
    }, { status: 503 })
  }

  // Idempotencia: si el usuario ya tiene profile con workspace, NO creamos otro.
  const { data: existing } = await admin
    .from('profiles')
    .select('id, workspace_id')
    .eq('id', user.id)
    .maybeSingle()
  if (existing?.workspace_id) {
    return NextResponse.json({ workspaceId: String(existing.workspace_id), alreadyExisted: true })
  }

  let body: { name?: unknown; fullName?: unknown } = {}
  try { body = (await req.json()) as typeof body } catch { /* cuerpo vacío permitido */ }

  const metaName = cleanName((user.user_metadata as Record<string, unknown> | null)?.full_name)
  const wsName = cleanName(body.name) || metaName || 'Mi inmobiliaria'
  const fullName = cleanName(body.fullName) || metaName || (user.email ? user.email.split('@')[0] : 'Usuario')

  // 1) Workspace VACÍO. slug se deja null (la UNIQUE admite varios null), plan
  //    'basic'. branding/settings toman sus defaults '{}'. SIN seed de demo.
  const { data: ws, error: wsErr } = await admin
    .from('workspaces')
    .insert({ name: wsName, plan: 'basic' })
    .select('id')
    .single()
  if (wsErr || !ws) {
    return NextResponse.json({
      error: `No se pudo crear el espacio de trabajo: ${wsErr?.message ?? 'desconocido'}`,
    }, { status: 500 })
  }
  const workspaceId = String(ws.id)

  // 2) Profile del owner como client_admin (upsert para tolerar reintentos).
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({
      id: user.id,
      workspace_id: workspaceId,
      email: user.email ?? null,
      full_name: fullName,
      role: 'client_admin',
    }, { onConflict: 'id' })
  if (profileErr) {
    // Rollback del workspace recién creado para no dejarlo huérfano.
    await admin.from('workspaces').delete().eq('id', workspaceId)
    return NextResponse.json({ error: `No se pudo crear el perfil: ${profileErr.message}` }, { status: 500 })
  }

  // 3) Membership owner (upsert sobre la UNIQUE (workspace_id, user_id)).
  const { error: memberErr } = await admin
    .from('workspace_members')
    .upsert({ workspace_id: workspaceId, user_id: user.id, role: 'owner' }, { onConflict: 'workspace_id,user_id' })
  if (memberErr) {
    // El profile ya quedó vinculado al workspace (el acceso funciona); el member
    // es secundario. No hacemos rollback destructivo: reportamos el fallo.
    return NextResponse.json({
      error: `Espacio creado, pero falló el alta de miembro: ${memberErr.message}`,
    }, { status: 500 })
  }

  return NextResponse.json({ workspaceId, created: true })
}
