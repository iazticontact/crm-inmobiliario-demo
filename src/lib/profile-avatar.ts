'use client'

// Foto de perfil real (P20). Sube a un bucket público de Supabase Storage (RLS: cada usuario solo
// gestiona SU carpeta {uid}/...) con el cliente de navegador autenticado — NUNCA service_role. La URL
// pública se guarda en el user_metadata del propio usuario vía auth.updateUser (sin migración de
// profiles ni grants). Validación de tipo/tamaño en cliente; el bucket también limita 2 MB y MIME.

import { getSupabaseBrowserClient } from '@/lib/supabase'

export const AVATAR_BUCKET = 'profile-avatars'
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type AvatarValidation = { ok: true } | { ok: false; error: string }

// Validación pura (testeable): tipo permitido + tamaño ≤ 2 MB.
export function validateAvatarFile(file: { type: string; size: number }): AvatarValidation {
  if (!AVATAR_MIME_TYPES.includes(file.type as (typeof AVATAR_MIME_TYPES)[number])) {
    return { ok: false, error: 'Formato no válido. Usa una imagen JPG, PNG o WebP.' }
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return { ok: false, error: 'La imagen supera 2 MB. Elige una más ligera.' }
  }
  return { ok: true }
}

export function avatarExtension(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}

export type AvatarResult = { ok: true; url: string } | { ok: false; error: string }

export async function uploadAvatar(userId: string, file: File): Promise<AvatarResult> {
  const v = validateAvatarFile(file)
  if (!v.ok) return v
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !userId) return { ok: false, error: 'No se pudo subir la imagen ahora mismo.' }

  // Ruta anterior (para borrarla luego, best-effort).
  const { data: current } = await supabase.auth.getUser()
  const prevPath = typeof current.user?.user_metadata?.avatar_path === 'string' ? current.user.user_metadata.avatar_path : null

  const path = `${userId}/${Date.now()}.${avatarExtension(file.type)}`
  const up = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) return { ok: false, error: 'No se pudo subir la imagen. Inténtalo de nuevo.' }

  const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  const url = pub.publicUrl
  const { error: updErr } = await supabase.auth.updateUser({ data: { avatar_url: url, avatar_path: path } })
  if (updErr) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]).catch(() => {})
    return { ok: false, error: 'No se pudo guardar la foto de perfil.' }
  }
  // Borra la imagen anterior (no bloquea el éxito).
  if (prevPath && prevPath !== path) await supabase.storage.from(AVATAR_BUCKET).remove([prevPath]).catch(() => {})
  return { ok: true, url }
}

export async function removeAvatar(): Promise<{ ok: boolean }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { ok: false }
  const { data: current } = await supabase.auth.getUser()
  const prevPath = typeof current.user?.user_metadata?.avatar_path === 'string' ? current.user.user_metadata.avatar_path : null
  const { error } = await supabase.auth.updateUser({ data: { avatar_url: null, avatar_path: null } })
  if (error) return { ok: false }
  if (prevPath) await supabase.storage.from(AVATAR_BUCKET).remove([prevPath]).catch(() => {})
  return { ok: true }
}
