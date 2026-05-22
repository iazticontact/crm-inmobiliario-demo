import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

const BUCKET = 'client-files'
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

// MIME ↔ extension allowlist. MIME must be non-empty and explicitly listed.
// The filename extension must also be on the list, and (loosely) coherent with
// the MIME so an attacker can't upload `evil.exe` declaring `application/pdf`.
const ALLOWED_MIME_EXT: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
}

const ALLOWED_EXTENSIONS = new Set(Object.values(ALLOWED_MIME_EXT).flat())

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

async function buildSupabase() {
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

function sanitizeFilename(name: string): string {
  // Strip directory traversal, slashes, control chars; keep [a-zA-Z0-9._-].
  const stripped = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[\\/]/g, '_')           // no path separators
    .replace(/\.{2,}/g, '_')          // collapse `..`
    .replace(/[^a-zA-Z0-9._-]/g, '_') // allowlist chars
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+/, '')           // no leading dot/dash/underscore
    .slice(0, 120)
  return stripped || 'archivo'
}

async function resolveWorkspaceForClient(
  supabase: NonNullable<Awaited<ReturnType<typeof buildSupabase>>>,
  clientId: string,
) {
  if (!isUuid(clientId)) return { error: 'clientId inválido', status: 400 as const }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: 'No autenticado', status: 401 as const }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError || !profile?.workspace_id) {
    return { error: 'Workspace no encontrado', status: 403 as const }
  }

  const workspaceId = String(profile.workspace_id)

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, name, workspace_id')
    .eq('id', clientId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (clientError || !client) {
    return { error: 'Cliente no encontrado o sin permisos', status: 404 as const }
  }

  return { workspaceId, clientName: String(client.name ?? ''), userId: userData.user.id }
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await buildSupabase()
  if (!supabase) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 })

  const { id: clientId } = await ctx.params
  const resolved = await resolveWorkspaceForClient(supabase, clientId)
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const { data, error } = await supabase
    .from('documents')
    .select('id, title, type, storage_bucket, storage_path, mime_type, size, created_at, created_by, metadata')
    .eq('workspace_id', resolved.workspaceId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ documents: data ?? [] })
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await buildSupabase()
  if (!supabase) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 })

  const { id: clientId } = await ctx.params
  const resolved = await resolveWorkspaceForClient(supabase, clientId)
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const formData = await request.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'FormData inválido' }, { status: 400 })

  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })

  // Tamaño
  if (file.size <= 0) {
    return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'El archivo supera el límite de 50 MB' }, { status: 413 })
  }

  // MIME — debe venir, no vacío, y estar en la allowlist
  const mime = typeof file.type === 'string' ? file.type.trim().toLowerCase() : ''
  if (!mime) {
    return NextResponse.json({ error: 'Tipo MIME del archivo no informado' }, { status: 415 })
  }
  const allowedExtensionsForMime = ALLOWED_MIME_EXT[mime]
  if (!allowedExtensionsForMime) {
    return NextResponse.json({ error: `Tipo de archivo no permitido: ${mime}` }, { status: 415 })
  }

  // Extensión — debe estar en la allowlist y ser coherente con el MIME
  const originalName = typeof file.name === 'string' ? file.name : 'archivo'
  const extension = getExtension(originalName)
  if (!extension) {
    return NextResponse.json({ error: 'El archivo no tiene extensión' }, { status: 400 })
  }
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return NextResponse.json({ error: `Extensión no permitida: .${extension}` }, { status: 415 })
  }
  if (!allowedExtensionsForMime.includes(extension)) {
    return NextResponse.json({
      error: `La extensión .${extension} no coincide con el tipo MIME ${mime}`,
    }, { status: 415 })
  }

  // Title
  const titleRaw = formData.get('title')
  const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim().slice(0, 200) : originalName.slice(0, 200)

  // Path final, sanitizado, con prefijo obligatorio
  const timestamp = Date.now()
  const safeName = sanitizeFilename(originalName)
  const path = `${resolved.workspaceId}/clients/${clientId}/${timestamp}-${safeName}`

  // Defensa en profundidad: el path generado nunca debe contener `..` ni doble slash.
  if (path.includes('..') || path.includes('//')) {
    return NextResponse.json({ error: 'Path generado inválido' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const uploadResult = await supabase
    .storage
    .from(BUCKET)
    .upload(path, arrayBuffer, {
      contentType: mime,
      upsert: false,
    })

  if (uploadResult.error) {
    return NextResponse.json({ error: `Error al subir archivo: ${uploadResult.error.message}` }, { status: 500 })
  }

  const { data: inserted, error: insertError } = await supabase
    .from('documents')
    .insert({
      workspace_id: resolved.workspaceId,
      client_id: clientId,
      title,
      type: 'client_file',
      storage_bucket: BUCKET,
      storage_path: path,
      mime_type: mime,
      size: file.size,
      created_by: resolved.userId,
      metadata: { original_name: originalName.slice(0, 200) },
    })
    .select('*')
    .single()

  if (insertError) {
    // Best-effort rollback del objeto subido para no dejar storage huérfano.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => null)
    return NextResponse.json({ error: `No se pudo registrar el documento: ${insertError.message}` }, { status: 500 })
  }

  await supabase.from('activities').insert({
    workspace_id: resolved.workspaceId,
    type: 'note',
    description: `Documento subido: ${title}`,
    client_name: resolved.clientName,
    client_id: clientId,
    metadata: { source: 'documents_upload' },
  }).then(() => null, () => null)

  return NextResponse.json({ document: inserted })
}
