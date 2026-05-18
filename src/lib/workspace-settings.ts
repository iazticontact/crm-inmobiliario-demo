'use client'

// Workspace settings — single-row-per-workspace preferences persisted to
// Supabase. Created in the workspace_settings_and_templates migration.
//
// The browser client always operates under RLS (user_has_workspace), so no
// extra ownership check is needed here. Callers must pass the resolved
// workspace_id from useCurrentUser; we never trust caller-supplied IDs to
// circumvent RLS.
//
// All helpers degrade quietly when Supabase isn't configured so the UI can
// fall back to localStorage without crashing.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseBrowserClient } from '@/lib/supabase'

export type WorkspaceVertical =
  | 'general'
  | 'real_estate'
  | 'immigration'
  | 'professional_services'
  | 'mixed'

export type WorkspaceAiTone = 'professional' | 'friendly' | 'concise' | 'casual'

export type WorkspaceSettings = {
  id: string
  workspace_id: string
  vertical: WorkspaceVertical | string
  business_name: string | null
  default_language: string
  timezone: string
  ai_tone: WorkspaceAiTone | string
  auto_reply_enabled: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type WorkspaceSettingsPatch = {
  vertical?: WorkspaceVertical
  business_name?: string | null
  default_language?: string
  timezone?: string
  ai_tone?: WorkspaceAiTone
  auto_reply_enabled?: boolean
  metadata?: Record<string, unknown>
}

const LOCAL_STORAGE_KEY = 'nowcrm.workspaceVertical'

function safeBrowser(): SupabaseClient | null {
  return getSupabaseBrowserClient() ?? null
}

export async function getWorkspaceSettings(workspaceId: string | null | undefined): Promise<WorkspaceSettings | null> {
  if (!workspaceId) return null
  const supabase = safeBrowser()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('workspace_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[getWorkspaceSettings]', error.message)
    return null
  }
  return (data as WorkspaceSettings | null) ?? null
}

export async function upsertWorkspaceSettings(
  workspaceId: string | null | undefined,
  patch: WorkspaceSettingsPatch,
): Promise<WorkspaceSettings | null> {
  if (!workspaceId) return null
  const supabase = safeBrowser()
  if (!supabase) return null

  // Read first so we can preserve untouched columns. We avoid `upsert` with
  // ON CONFLICT to keep the round trip explicit and easier to reason about.
  const existing = await getWorkspaceSettings(workspaceId)
  if (existing) {
    const update: Record<string, unknown> = {}
    if (patch.vertical !== undefined) update.vertical = patch.vertical
    if (patch.business_name !== undefined) update.business_name = patch.business_name
    if (patch.default_language !== undefined) update.default_language = patch.default_language
    if (patch.timezone !== undefined) update.timezone = patch.timezone
    if (patch.ai_tone !== undefined) update.ai_tone = patch.ai_tone
    if (patch.auto_reply_enabled !== undefined) update.auto_reply_enabled = patch.auto_reply_enabled
    if (patch.metadata !== undefined) update.metadata = patch.metadata
    if (Object.keys(update).length === 0) return existing

    const { data, error } = await supabase
      .from('workspace_settings')
      .update(update)
      .eq('workspace_id', workspaceId)
      .select('*')
      .single()
    if (error) {
      if (process.env.NODE_ENV === 'development') console.warn('[upsertWorkspaceSettings:update]', error.message)
      return null
    }
    return data as WorkspaceSettings
  }

  const insert: Record<string, unknown> = {
    workspace_id: workspaceId,
    vertical: patch.vertical ?? 'general',
    business_name: patch.business_name ?? null,
    default_language: patch.default_language ?? 'es',
    timezone: patch.timezone ?? 'Europe/Madrid',
    ai_tone: patch.ai_tone ?? 'professional',
    auto_reply_enabled: patch.auto_reply_enabled ?? false,
    metadata: patch.metadata ?? {},
  }
  const { data, error } = await supabase
    .from('workspace_settings')
    .insert(insert)
    .select('*')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[upsertWorkspaceSettings:insert]', error.message)
    return null
  }
  return data as WorkspaceSettings
}

// localStorage helpers — used as a fallback when there's no workspace yet
// (demo mode) or when the Supabase round trip fails.

export function readLocalVertical(): WorkspaceVertical | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(LOCAL_STORAGE_KEY) as WorkspaceVertical | null
    return v && ['general', 'real_estate', 'immigration', 'professional_services', 'mixed'].includes(v) ? v : null
  } catch { return null }
}

export function writeLocalVertical(value: WorkspaceVertical) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(LOCAL_STORAGE_KEY, value) } catch { /* quota / privacy mode */ }
}
