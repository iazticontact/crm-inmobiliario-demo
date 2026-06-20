// Server-side ONLY. Working-memory layer for the n8n Agent V2: persists the
// active entity of a conversation thread (this client / the previous one) in
// `public.assistant_agent_memory`, so context survives page reloads and cold
// n8n Window Memory.
//
// PRIVACY / SAFETY:
//   - Writes are done by the authenticated route (RLS by workspace + user),
//     NEVER by the LLM. The LLM only READS the activeEntity the route passes it.
//   - We store ONLY a reference (entity_type + entity_id + a display label),
//     never DNI / email / phone — those stay in the CRM tables and are read in
//     real time by tools.
//   - Fail-soft: every function swallows errors and returns a safe default. A
//     memory hiccup must never break the assistant response.

import type { SupabaseClient } from '@supabase/supabase-js'

export type AgentEntityType =
  | 'client' | 'opportunity' | 'service_case' | 'task' | 'calendar_event' | 'property' | 'document'

export type AgentActiveEntity = { type: AgentEntityType; id: string; label?: string }

type Row = { entity_type?: string | null; entity_id?: string | null; label?: string | null }

function toEntity(r: Row | null | undefined): AgentActiveEntity | null {
  if (!r || !r.entity_type || !r.entity_id) return null
  return { type: r.entity_type as AgentEntityType, id: r.entity_id, label: r.label ?? undefined }
}

/** Active entity for this thread (+ the previous one, for "el anterior"). */
export async function loadThreadMemory(
  supabase: SupabaseClient,
  threadId: string,
  userId: string,
): Promise<{ active: AgentActiveEntity | null; previous: AgentActiveEntity | null }> {
  if (!threadId || !userId) return { active: null, previous: null }
  try {
    const { data } = await supabase
      .from('assistant_agent_memory')
      .select('memory_type, entity_type, entity_id, label')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .in('memory_type', ['active_entity', 'previous_entity'])
    const rows = (data ?? []) as Array<Row & { memory_type?: string }>
    return {
      active: toEntity(rows.find((r) => r.memory_type === 'active_entity')),
      previous: toEntity(rows.find((r) => r.memory_type === 'previous_entity')),
    }
  } catch {
    return { active: null, previous: null }
  }
}

/** Promote `entity` to active for this thread; demote the old active to
 *  previous (only when it actually changed). No-op if unchanged. Fail-soft. */
export async function saveActiveEntity(
  supabase: SupabaseClient,
  params: { workspaceId: string; userId: string; threadId: string; entity: AgentActiveEntity },
): Promise<void> {
  const { workspaceId, userId, threadId, entity } = params
  if (!workspaceId || !userId || !threadId || !entity?.id) return
  try {
    const { active } = await loadThreadMemory(supabase, threadId, userId)
    if (active && active.id === entity.id && active.type === entity.type) return // unchanged

    if (active) {
      // demote current active -> previous
      await supabase.from('assistant_agent_memory')
        .delete().eq('thread_id', threadId).eq('user_id', userId).eq('memory_type', 'previous_entity')
      await supabase.from('assistant_agent_memory').insert({
        workspace_id: workspaceId, user_id: userId, thread_id: threadId,
        memory_type: 'previous_entity', entity_type: active.type, entity_id: active.id, label: active.label ?? null,
      })
    }
    // upsert active (partial unique index on (thread_id,user_id) where active)
    await supabase.from('assistant_agent_memory')
      .delete().eq('thread_id', threadId).eq('user_id', userId).eq('memory_type', 'active_entity')
    await supabase.from('assistant_agent_memory').insert({
      workspace_id: workspaceId, user_id: userId, thread_id: threadId,
      memory_type: 'active_entity', entity_type: entity.type, entity_id: entity.id, label: entity.label ?? null,
    })
  } catch {
    // fail-soft: memory is best-effort
  }
}
