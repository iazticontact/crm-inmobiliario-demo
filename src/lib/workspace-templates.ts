'use client'

// Workspace-scoped editable templates. Backed by public.workspace_templates,
// added in workspace_settings_and_templates migration. The base catalog in
// src/lib/demo/vertical-templates.ts is still the source of truth for
// reference content — these rows are workspace-specific edits or new
// templates the operator chooses to save.
//
// Helpers degrade quietly to [] / null when Supabase is not configured.

import { getSupabaseBrowserClient } from '@/lib/supabase'
import type { VerticalKey } from '@/lib/demo/vertical-templates'

export type WorkspaceTemplateType = 'message' | 'proposal' | 'document_request' | 'custom'

export type WorkspaceTemplate = {
  id: string
  workspace_id: string
  type: WorkspaceTemplateType | string
  vertical: VerticalKey | string
  name: string
  channel: string | null
  content: string
  status: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type WorkspaceTemplateInput = {
  type: WorkspaceTemplateType
  vertical: VerticalKey
  name: string
  channel?: string | null
  content: string
  status?: string
  metadata?: Record<string, unknown>
}

export async function listWorkspaceTemplates(
  workspaceId: string | null | undefined,
  opts?: { vertical?: VerticalKey; type?: WorkspaceTemplateType; limit?: number },
): Promise<WorkspaceTemplate[]> {
  if (!workspaceId) return []
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []
  let q = supabase
    .from('workspace_templates')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(opts?.limit ?? 100)
  if (opts?.vertical) q = q.eq('vertical', opts.vertical)
  if (opts?.type) q = q.eq('type', opts.type)
  const { data, error } = await q
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[listWorkspaceTemplates]', error.message)
    return []
  }
  return (data ?? []) as WorkspaceTemplate[]
}

export async function createWorkspaceTemplate(
  workspaceId: string | null | undefined,
  input: WorkspaceTemplateInput,
): Promise<WorkspaceTemplate | null> {
  if (!workspaceId || !input.name?.trim() || !input.content?.trim()) return null
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('workspace_templates')
    .insert({
      workspace_id: workspaceId,
      type: input.type,
      vertical: input.vertical,
      name: input.name.trim(),
      channel: input.channel ?? null,
      content: input.content,
      status: input.status ?? 'active',
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[createWorkspaceTemplate]', error.message)
    return null
  }
  return data as WorkspaceTemplate
}

export type WorkspaceTemplatePatch = Partial<Pick<WorkspaceTemplateInput, 'name' | 'channel' | 'content' | 'status' | 'metadata' | 'vertical'>>

export async function updateWorkspaceTemplate(
  workspaceId: string | null | undefined,
  id: string,
  patch: WorkspaceTemplatePatch,
): Promise<WorkspaceTemplate | null> {
  if (!workspaceId || !id) return null
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.channel !== undefined) update.channel = patch.channel
  if (patch.content !== undefined) update.content = patch.content
  if (patch.status !== undefined) update.status = patch.status
  if (patch.metadata !== undefined) update.metadata = patch.metadata
  if (patch.vertical !== undefined) update.vertical = patch.vertical
  if (Object.keys(update).length === 0) return null
  const { data, error } = await supabase
    .from('workspace_templates')
    .update(update)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[updateWorkspaceTemplate]', error.message)
    return null
  }
  return data as WorkspaceTemplate
}

export async function archiveWorkspaceTemplate(
  workspaceId: string | null | undefined,
  id: string,
): Promise<boolean> {
  if (!workspaceId || !id) return false
  return Boolean(await updateWorkspaceTemplate(workspaceId, id, { status: 'archived' }))
}
