// Evals de la foto de perfil (P20). Sin runner en el repo; `runAvatarEvals()` verifica la validación
// pura de tipo/tamaño (la subida real a Storage no se testea aquí; depende de la red/Supabase).

import { validateAvatarFile, avatarExtension, AVATAR_MAX_BYTES } from '@/lib/profile-avatar'

export function runAvatarEvals(): string[] {
  const fail: string[] = []
  const ok = (f: { type: string; size: number }) => validateAvatarFile(f).ok

  // Acepta JPG/PNG/WebP dentro del límite.
  if (!ok({ type: 'image/jpeg', size: 500_000 })) fail.push('debería aceptar image/jpeg ≤ 2MB')
  if (!ok({ type: 'image/png', size: 1_000_000 })) fail.push('debería aceptar image/png ≤ 2MB')
  if (!ok({ type: 'image/webp', size: AVATAR_MAX_BYTES })) fail.push('debería aceptar image/webp en el límite')
  // Rechaza tipos no permitidos.
  if (ok({ type: 'application/pdf', size: 1000 })) fail.push('debería rechazar application/pdf')
  if (ok({ type: 'image/gif', size: 1000 })) fail.push('debería rechazar image/gif')
  if (ok({ type: '', size: 1000 })) fail.push('debería rechazar tipo vacío')
  // Rechaza > 2MB.
  if (ok({ type: 'image/png', size: AVATAR_MAX_BYTES + 1 })) fail.push('debería rechazar > 2MB')

  // Extensión por MIME.
  if (avatarExtension('image/png') !== 'png') fail.push('ext png')
  if (avatarExtension('image/webp') !== 'webp') fail.push('ext webp')
  if (avatarExtension('image/jpeg') !== 'jpg') fail.push('ext jpg')

  return fail
}
