// Sistema unificado de archivos por entidad (fotos + documentos). Real, sin service_role:
// usa el cliente de navegador autenticado → la RLS de Supabase (tabla entity_files +
// storage.objects) garantiza el aislamiento por workspace. Bucket privado → signed URLs.
import { getSupabaseBrowserClient } from '@/lib/supabase'

// 'invoice' añadido en P34 (el CHECK de entity_files.entity_type se amplió en P33).
export type EntityType = 'property' | 'client' | 'opportunity' | 'service_case' | 'invoice'
export type FileCategory = 'image' | 'document'

export type EntityFile = {
  id: string
  workspace_id: string
  entity_type: EntityType
  entity_id: string
  category: FileCategory
  bucket: string
  path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  is_cover: boolean
  sort_order: number
  caption: string | null
  created_at: string
}

const BUCKET = 'entity-files'

function safeName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\-]+/g, '_')
  return cleaned.slice(-80) || 'archivo'
}

export async function listEntityFiles(
  workspaceId: string,
  entityType: EntityType,
  entityId: string,
  category?: FileCategory,
): Promise<EntityFile[]> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []
  let q = supabase.from('entity_files').select('*')
    .eq('workspace_id', workspaceId).eq('entity_type', entityType).eq('entity_id', entityId)
  if (category) q = q.eq('category', category)
  const { data, error } = await q
    .order('is_cover', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as EntityFile[]
}

export async function signedUrls(paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, expiresIn)
  if (error || !data) return {}
  const out: Record<string, string> = {}
  for (const item of data) {
    if (item.signedUrl && item.path) out[item.path] = item.signedUrl
  }
  return out
}

export async function uploadEntityFile(opts: {
  workspaceId: string
  entityType: EntityType
  entityId: string
  file: File
  category?: FileCategory
  isCover?: boolean
}): Promise<EntityFile> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no disponible')
  const category: FileCategory = opts.category ?? (opts.file.type.startsWith('image/') ? 'image' : 'document')
  const path = `${opts.workspaceId}/${opts.entityType}/${opts.entityId}/${crypto.randomUUID()}-${safeName(opts.file.name)}`
  const up = await supabase.storage.from(BUCKET).upload(path, opts.file, {
    contentType: opts.file.type || undefined,
    upsert: false,
  })
  // Los errores de Storage/PostgREST no siempre son instancias de Error → normaliza a Error
  // con un mensaje claro para que la UI pueda mostrarlo y mapearlo.
  if (up.error) throw new Error(`[storage] ${up.error.message || 'fallo al subir el archivo'}`)
  const { data, error } = await supabase.from('entity_files').insert({
    workspace_id: opts.workspaceId,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    category,
    bucket: BUCKET,
    path,
    file_name: opts.file.name,
    mime_type: opts.file.type || null,
    size_bytes: opts.file.size,
    is_cover: !!opts.isCover,
  }).select('*').single()
  if (error) {
    // Evita huérfanos en Storage si falla el insert de metadatos.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw new Error(`[metadata] ${error.message || 'fallo al guardar los metadatos'}${error.code ? ` (${error.code})` : ''}`)
  }
  return data as EntityFile
}

// Borra TODOS los archivos (Storage + metadata) de una entidad. Para borrado seguro de un
// trámite/entidad: evita dejar entity_files huérfanos (no hay FK polimórfica). Best-effort.
export async function deleteEntityFilesFor(workspaceId: string, entityType: EntityType, entityId: string): Promise<void> {
  const files = await listEntityFiles(workspaceId, entityType, entityId).catch(() => [] as EntityFile[])
  for (const f of files) {
    await deleteEntityFile(f).catch(() => {})
  }
}

export async function deleteEntityFile(file: Pick<EntityFile, 'id' | 'path'>): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no disponible')
  await supabase.storage.from(BUCKET).remove([file.path]).catch(() => {})
  const { error } = await supabase.from('entity_files').delete().eq('id', file.id)
  if (error) throw error
}

export async function setCoverPhoto(
  workspaceId: string, entityType: EntityType, entityId: string, fileId: string,
): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no disponible')
  await supabase.from('entity_files').update({ is_cover: false })
    .eq('workspace_id', workspaceId).eq('entity_type', entityType).eq('entity_id', entityId)
  const { error } = await supabase.from('entity_files').update({ is_cover: true }).eq('id', fileId)
  if (error) throw error
}

// Nº de documentos por entidad (p. ej. trámites) en una sola lectura. Para mostrar
// "N documentos" en el listado sin N+1.
export async function documentCountsForEntities(
  workspaceId: string, entityType: EntityType, entityIds: string[],
): Promise<Record<string, number>> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || entityIds.length === 0) return {}
  const { data, error } = await supabase.from('entity_files')
    .select('entity_id')
    .eq('workspace_id', workspaceId).eq('entity_type', entityType).eq('category', 'document')
    .in('entity_id', entityIds)
  if (error || !data) return {}
  const m: Record<string, number> = {}
  for (const row of data as { entity_id: string }[]) m[row.entity_id] = (m[row.entity_id] ?? 0) + 1
  return m
}

// Portada (cover, o primera imagen) de varios inmuebles en una sola lectura + signed URLs.
export async function coverUrlsForProperties(
  workspaceId: string, propertyIds: string[],
): Promise<Record<string, string>> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || propertyIds.length === 0) return {}
  const { data, error } = await supabase.from('entity_files')
    .select('entity_id, path, is_cover, created_at')
    .eq('workspace_id', workspaceId).eq('entity_type', 'property').eq('category', 'image')
    .in('entity_id', propertyIds)
    .order('is_cover', { ascending: false }).order('created_at', { ascending: true })
  if (error || !data) return {}
  const chosen: Record<string, string> = {} // entity_id -> path (cover primero)
  for (const row of data as { entity_id: string; path: string }[]) {
    if (!chosen[row.entity_id]) chosen[row.entity_id] = row.path
  }
  const urls = await signedUrls(Object.values(chosen), 3600)
  const out: Record<string, string> = {}
  for (const [eid, path] of Object.entries(chosen)) {
    if (urls[path]) out[eid] = urls[path]
  }
  return out
}
