'use client'

// Logo de empresa (P22). Distinto del avatar PERSONAL: identifica la inmobiliaria/cuenta. Sube a un
// bucket público (`company-logos`) con RLS por workspace (solo miembros escriben en {workspaceId}/...),
// con el cliente de navegador autenticado — NUNCA service_role. La URL pública se guarda en
// `workspace_settings.metadata` (tabla creada en la migración P25 — ver
// docs/supabase/p25_workspace_settings.sql). Reutiliza la validación de imagen del avatar.

import { getSupabaseBrowserClient } from '@/lib/supabase'
import { getWorkspaceSettings, upsertWorkspaceSettings } from '@/lib/workspace-settings'
import { validateAvatarFile, avatarExtension } from '@/lib/profile-avatar'

export const COMPANY_LOGO_BUCKET = 'company-logos'

export type LogoResult = { ok: true; url: string } | { ok: false; error: string }

export async function uploadCompanyLogo(workspaceId: string, file: File): Promise<LogoResult> {
  const v = validateAvatarFile(file)
  if (!v.ok) return v
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId) return { ok: false, error: 'No se pudo subir el logo ahora mismo.' }

  const settings = await getWorkspaceSettings(workspaceId)
  const meta = { ...((settings?.metadata ?? {}) as Record<string, unknown>) }
  const prevPath = typeof meta.company_logo_path === 'string' ? meta.company_logo_path : null

  const path = `${workspaceId}/${Date.now()}.${avatarExtension(file.type)}`
  const up = await supabase.storage.from(COMPANY_LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) return { ok: false, error: 'No se pudo subir el logo. Inténtalo de nuevo.' }

  const { data: pub } = supabase.storage.from(COMPANY_LOGO_BUCKET).getPublicUrl(path)
  const url = pub.publicUrl
  const row = await upsertWorkspaceSettings(workspaceId, {
    metadata: { ...meta, company_logo_url: url, company_logo_path: path, company_logo_updated_at: new Date().toISOString() },
  })
  if (!row) {
    await supabase.storage.from(COMPANY_LOGO_BUCKET).remove([path]).catch(() => {})
    return { ok: false, error: 'No se pudo guardar el logo de la empresa.' }
  }
  if (prevPath && prevPath !== path) await supabase.storage.from(COMPANY_LOGO_BUCKET).remove([prevPath]).catch(() => {})
  return { ok: true, url }
}

export async function removeCompanyLogo(workspaceId: string): Promise<{ ok: boolean }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId) return { ok: false }
  const settings = await getWorkspaceSettings(workspaceId)
  const meta = { ...((settings?.metadata ?? {}) as Record<string, unknown>) }
  const prevPath = typeof meta.company_logo_path === 'string' ? meta.company_logo_path : null
  delete meta.company_logo_url
  delete meta.company_logo_path
  delete meta.company_logo_updated_at
  const row = await upsertWorkspaceSettings(workspaceId, { metadata: meta })
  if (!row) return { ok: false }
  if (prevPath) await supabase.storage.from(COMPANY_LOGO_BUCKET).remove([prevPath]).catch(() => {})
  return { ok: true }
}
