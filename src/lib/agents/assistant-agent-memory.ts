// Server-side ONLY. Working-memory layer for the n8n Agent V2: persists the
// active entity of a conversation thread (this client / the previous one /
// a recently-resolved property/document) in `public.assistant_agent_memory`,
// so context survives page reloads and a cold n8n Window Memory.
//
// PRIVACY / SAFETY:
//   - Writes are done by the authenticated route (RLS by workspace + user),
//     NEVER by the LLM. The LLM only READS what the route passes it.
//   - We store ONLY a reference (entity_type + entity_id + a display label),
//     never DNI / email / phone — those stay in the CRM tables and are read in
//     real time by tools.
//   - Active/previous entities are kept PER TYPE (N4.1): resolving a property or
//     document never clobbers the active client.
//   - Fail-soft: every function swallows errors. A memory hiccup must never
//     break the assistant response.

import type { SupabaseClient } from '@supabase/supabase-js'

export type AgentEntityType =
  | 'client' | 'opportunity' | 'service_case' | 'task' | 'calendar_event' | 'property' | 'document'

export type AgentActiveEntity = { type: AgentEntityType; id: string; label?: string }

const ALLOWED_TYPES = new Set<AgentEntityType>([
  'client', 'opportunity', 'service_case', 'task', 'calendar_event', 'property', 'document',
])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Row = { memory_type?: string | null; entity_type?: string | null; entity_id?: string | null; label?: string | null }

function toEntity(r: Row | undefined | null): AgentActiveEntity | null {
  if (!r || !r.entity_type || !r.entity_id) return null
  if (!ALLOWED_TYPES.has(r.entity_type as AgentEntityType)) return null
  return { type: r.entity_type as AgentEntityType, id: r.entity_id, label: r.label ?? undefined }
}

/** Validate an activeEntityUpdate coming back from n8n. The id is already
 *  workspace-scoped (it can only come from a workspace-scoped read tool), so we
 *  just enforce shape: an allowed type + a real UUID. Returns null if invalid. */
export function validateActiveEntityUpdate(v: unknown): AgentActiveEntity | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const type = typeof o.type === 'string' ? (o.type as AgentEntityType) : ('' as AgentEntityType)
  const id = typeof o.id === 'string' ? o.id : ''
  if (!ALLOWED_TYPES.has(type) || !UUID_RE.test(id)) return null
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 120) : undefined
  return { type, id, label }
}

/** Active client (+ previous client for "el anterior") + the most recently
 *  resolved NON-client entity (for "ese inmueble / documento"). */
export async function loadThreadMemory(
  supabase: SupabaseClient,
  threadId: string,
  userId: string,
): Promise<{ client: AgentActiveEntity | null; previousClient: AgentActiveEntity | null; recent: AgentActiveEntity | null }> {
  if (!threadId || !userId) return { client: null, previousClient: null, recent: null }
  try {
    const { data } = await supabase
      .from('assistant_agent_memory')
      .select('memory_type, entity_type, entity_id, label, updated_at')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .in('memory_type', ['active_entity', 'previous_entity'])
      .order('updated_at', { ascending: false })
    const rows = (data ?? []) as Row[]
    const active = rows.filter((r) => r.memory_type === 'active_entity')
    const prev = rows.filter((r) => r.memory_type === 'previous_entity')
    return {
      client: toEntity(active.find((r) => r.entity_type === 'client')),
      previousClient: toEntity(prev.find((r) => r.entity_type === 'client')),
      recent: toEntity(active.find((r) => r.entity_type && r.entity_type !== 'client')),
    }
  } catch {
    return { client: null, previousClient: null, recent: null }
  }
}

/** Promote `entity` to active for its TYPE in this thread; demote the old active
 *  of the same type to previous (only when it actually changed). Fail-soft. */
export async function saveActiveEntity(
  supabase: SupabaseClient,
  params: { workspaceId: string; userId: string; threadId: string; entity: AgentActiveEntity },
): Promise<void> {
  const { workspaceId, userId, threadId, entity } = params
  if (!workspaceId || !userId || !threadId || !entity?.id || !entity?.type) return
  try {
    const { data: cur } = await supabase
      .from('assistant_agent_memory')
      .select('entity_id, label')
      .eq('thread_id', threadId).eq('user_id', userId)
      .eq('memory_type', 'active_entity').eq('entity_type', entity.type)
      .maybeSingle()
    const current = cur as { entity_id?: string; label?: string | null } | null
    if (current?.entity_id === entity.id) return // unchanged

    const base = { workspace_id: workspaceId, user_id: userId, thread_id: threadId, entity_type: entity.type }
    if (current?.entity_id) {
      // demote current active -> previous (same type)
      await supabase.from('assistant_agent_memory').delete()
        .eq('thread_id', threadId).eq('user_id', userId).eq('memory_type', 'previous_entity').eq('entity_type', entity.type)
      await supabase.from('assistant_agent_memory').insert({
        ...base, memory_type: 'previous_entity', entity_id: current.entity_id, label: current.label ?? null,
      })
    }
    await supabase.from('assistant_agent_memory').delete()
      .eq('thread_id', threadId).eq('user_id', userId).eq('memory_type', 'active_entity').eq('entity_type', entity.type)
    await supabase.from('assistant_agent_memory').insert({
      ...base, memory_type: 'active_entity', entity_id: entity.id, label: entity.label ?? null,
    })
  } catch {
    // fail-soft: memory is best-effort
  }
}
