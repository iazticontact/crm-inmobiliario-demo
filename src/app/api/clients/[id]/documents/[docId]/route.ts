import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

const BUCKET = 'client-files'

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

async function buildUserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
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

function buildServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

type ResolvedDoc = {
  workspaceId: string
  clientName: string
  doc: {
    id: string
    workspace_id: string
    client_id: string
    storage_bucket: string
    storage_path: string
    title: string
  }
}

async function resolveContext(
  supabase: NonNullable<Awaited<ReturnType<typeof buildUserSupabase>>>,
  clientId: string,
  docId: string,
): Promise<{ error: string; status: 400 | 401 | 403 | 404 } | ResolvedDoc> {
  if (!isUuid(clientId)) return { error: 'clientId inválido', status: 400 }
  if (!isUuid(docId)) return { error: 'docId inválido', status: 400 }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: 'No autenticado', status: 401 }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  const workspaceId = profile?.workspace_id ? String(profile.workspace_id) : null
  if (!workspaceId) return { error: 'Workspace no encontrado', status: 403 }

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, workspace_id')
    .eq('id', clientId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!client) return { error: 'Cliente no encontrado o sin permisos', status: 404 }

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, workspace_id, client_id, storage_bucket, storage_path, title')
    .eq('id', docId)
    .maybeSingle()
  if (docError || !doc) return { error: 'Documento no encontrado', status: 404 }

  // Hardening — nunca confiamos en `storage_path` tal cual viene de DB.
  // El path debe pertenecer al mismo workspace, mismo cliente, mismo bucket,
  // y al prefijo canónico. Cualquier desviación → 403.
  const expectedPrefix = `${workspaceId}/clients/${clientId}/`
  const path = String(doc.storage_path ?? '')
  if (
    String(doc.workspace_id) !== workspaceId ||
    String(doc.client_id) !== clientId ||
    String(doc.storage_bucket) !== BUCKET ||
    !path.startsWith(expectedPrefix) ||
    path.startsWith('/') ||
    path.includes('..')
  ) {
    return { error: 'Documento fuera de scope', status: 403 }
  }

  return {
    workspaceId,
    clientName: String(client.name ?? ''),
    doc: {
      id: String(doc.id),
      workspace_id: String(doc.workspace_id),
      client_id: String(doc.client_id),
      storage_bucket: String(doc.storage_bucket),
      storage_path: path,
      title: String(doc.title ?? ''),
    },
  }
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const supabase = await buildUserSupabase()
  if (!supabase) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 })

  const { id: clientId, docId } = await ctx.params
  const resolved = await resolveContext(supabase, clientId, docId)
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrl(resolved.doc.storage_path, 60 * 10)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ url: data.signedUrl })
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const userClient = await buildUserSupabase()
  if (!userClient) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 })

  const { id: clientId, docId } = await ctx.params
  // 1-5: validar sesión, workspace, cliente, documento, bucket/path (con cookie user).
  const resolved = await resolveContext(userClient, clientId, docId)
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  // RLS `documents_delete` exige is_workspace_admin() — usuarios normales no
  // pueden borrar la fila. Para no dejar fila huérfana (objeto borrado y row
  // sigue viva o al revés) el borrado se hace server-side con service_role
  // tras todas las validaciones de arriba.
  const adminClient = buildServiceSupabase()
  if (!adminClient) {
    return NextResponse.json({
      error: 'Borrado no disponible: falta SUPABASE_SERVICE_ROLE_KEY en el servidor. Contacta con el equipo técnico.',
    }, { status: 503 })
  }

  // 1) Borrar fila documents primero (scoped por id + workspace + client).
  const { data: deletedRows, error: deleteRowError } = await adminClient
    .from('documents')
    .delete()
    .eq('id', resolved.doc.id)
    .eq('workspace_id', resolved.workspaceId)
    .eq('client_id', clientId)
    .select('id')

  if (deleteRowError) {
    return NextResponse.json({ error: `No se pudo eliminar el registro: ${deleteRowError.message}` }, { status: 500 })
  }
  if (!deletedRows || deletedRows.length === 0) {
    return NextResponse.json({ error: 'El documento ya no existe en la base de datos.' }, { status: 404 })
  }

  // 2) Borrar objeto de storage. Si ya no existía, lo reportamos pero no rompemos.
  const storageResult = await adminClient.storage.from(BUCKET).remove([resolved.doc.storage_path])
  let storageWarning: string | null = null
  if (storageResult.error) {
    storageWarning = storageResult.error.message
  } else if (!storageResult.data || storageResult.data.length === 0) {
    storageWarning = 'El objeto no estaba en storage (ya eliminado o nunca existió).'
  }

  // 3) Best-effort activity log; no rompe si falla.
  await adminClient.from('activities').insert({
    workspace_id: resolved.workspaceId,
    type: 'note',
    description: `Documento eliminado: ${resolved.doc.title}`,
    client_name: resolved.clientName,
    client_id: clientId,
    metadata: { source: 'documents_delete', storage_path: resolved.doc.storage_path },
  }).then(() => null, () => null)

  return NextResponse.json({ ok: true, storageWarning })
}
