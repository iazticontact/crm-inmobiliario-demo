// Persistencia dedicada del Copiloto interno del CRM.
//
// Guarda las consultas del asistente como un chat real en
// public.assistant_threads / public.assistant_messages (RLS por workspace),
// SIN acoplarse a public.conversations / public.messages (Inbox/WhatsApp).
//
// Cliente browser con la clave anon/publishable (RLS). NUNCA service_role.
// Devuelve formas `Conversation` / `Message` para encajar directo en el estado
// del módulo de asistente.

import { getSupabaseBrowserClient } from '@/lib/supabase'
import type { Conversation, Message, MessageSender } from '@/lib/types'

export type ThreadRole = 'user' | 'assistant' | 'system'

type ThreadRow = {
  id: string
  workspace_id: string
  user_id: string
  title: string
  status: string
  last_message_at: string
  created_at: string
  updated_at: string
}

type MessageRow = {
  id: string
  workspace_id: string
  thread_id: string
  role: ThreadRole
  content: string
  message_type: string
  prepared_action: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
}

function senderToRole(sender: MessageSender): ThreadRole {
  return sender === 'ai' ? 'assistant' : 'user'
}

function roleToSender(role: ThreadRole): MessageSender {
  return role === 'assistant' || role === 'system' ? 'ai' : 'agent'
}

function threadToConversation(row: ThreadRow): Conversation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    clientId: '',
    clientName: row.title || 'Consulta interna',
    clientAvatar: 'IA',
    lastMessage: row.title || 'Consulta interna',
    timestamp: row.last_message_at,
    unread: false,
    sentiment: 'neutral',
    channel: 'web',
    intent: 'Asistente IA',
    assistantMode: 'copilot',
    status: row.status,
    metadata: { source: 'assistant_thread', assistant_mode: 'copilot' },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function messageRowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.thread_id,
    workspaceId: row.workspace_id,
    content: row.content,
    sender: roleToSender(row.role),
    timestamp: row.created_at,
    metadata: { ...(row.metadata ?? {}), prepared_action: row.prepared_action ?? undefined },
    createdAt: row.created_at,
  }
}

/** Lista los hilos del copiloto del workspace, más recientes primero. */
export async function listAssistantThreads(workspaceId: string): Promise<Conversation[]> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId) return []
  const { data, error } = await supabase
    .from('assistant_threads')
    .select('id, workspace_id, user_id, title, status, last_message_at, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false })
    .limit(50)
  if (error || !data) return []
  return (data as ThreadRow[]).map(threadToConversation)
}

/** Crea un hilo nuevo y devuelve la Conversation correspondiente. */
export async function createAssistantThread(
  workspaceId: string,
  userId: string,
  title?: string,
): Promise<Conversation | null> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !userId) return null
  const { data, error } = await supabase
    .from('assistant_threads')
    .insert({ workspace_id: workspaceId, user_id: userId, title: (title?.trim() || 'Consulta interna').slice(0, 120) })
    .select('id, workspace_id, user_id, title, status, last_message_at, created_at, updated_at')
    .single()
  if (error || !data) return null
  return threadToConversation(data as ThreadRow)
}

/** Mensajes de un hilo, en orden cronológico. */
export async function listThreadMessages(threadId: string): Promise<Message[]> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !threadId) return []
  const { data, error } = await supabase
    .from('assistant_messages')
    .select('id, workspace_id, thread_id, role, content, message_type, prepared_action, metadata, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(500)
  if (error || !data) return []
  return (data as MessageRow[]).map(messageRowToMessage)
}

/** Guarda un mensaje en el hilo y actualiza last_message_at. Fail-soft. */
export async function appendThreadMessage(
  workspaceId: string,
  threadId: string,
  input: { sender: MessageSender; content: string; preparedAction?: Record<string, unknown> | null; metadata?: Record<string, unknown> | null },
): Promise<Message | null> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !threadId) return null
  const { data, error } = await supabase
    .from('assistant_messages')
    .insert({
      workspace_id: workspaceId,
      thread_id: threadId,
      role: senderToRole(input.sender),
      content: input.content,
      prepared_action: input.preparedAction ?? null,
      metadata: input.metadata ?? null,
    })
    .select('id, workspace_id, thread_id, role, content, message_type, prepared_action, metadata, created_at')
    .single()
  if (error || !data) return null
  // touch del hilo (best-effort, no bloquea)
  void supabase
    .from('assistant_threads')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', threadId)
    .then(() => undefined, () => undefined)
  return messageRowToMessage(data as MessageRow)
}

/** Renombra un hilo (p. ej. autotítulo desde el primer mensaje). Fail-soft. */
export async function renameAssistantThread(threadId: string, title: string): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !threadId || !title.trim()) return
  await supabase.from('assistant_threads').update({ title: title.trim().slice(0, 120) }).eq('id', threadId)
}

/** Borra un hilo y, por FK ON DELETE CASCADE, todos sus mensajes. RLS: solo hilos
 * del propio workspace (policy at_delete). Nunca toca public.conversations/messages.
 * Devuelve true si se borró. */
export async function deleteAssistantThread(threadId: string): Promise<boolean> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !threadId) return false
  const { error } = await supabase.from('assistant_threads').delete().eq('id', threadId)
  return !error
}
