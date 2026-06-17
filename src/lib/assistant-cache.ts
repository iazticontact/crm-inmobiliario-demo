// Client-only, in-memory stale-while-revalidate cache for the assistant's
// thread list and per-thread messages.
//
// Why (S6): re-entering /assistant or switching threads re-fetched from scratch
// and showed loaders. This lets the UI paint cached data instantly and
// revalidate silently. It mirrors the S3 identity-cache safety model exactly:
//   - keyed by userId (+ workspaceId (+ threadId)) so it can NEVER surface
//     another user's or another workspace's data;
//   - lives ONLY in browser memory (no localStorage/sessionStorage) — a full
//     reload (F5) always starts clean;
//   - bypassed entirely on the server (typeof window) — never a process-wide
//     cache shared between users/requests;
//   - cleared on SIGNED_OUT and on any user-id change via onAuthStateChange.

import type { AssistantMode, Conversation, Message } from '@/lib/types'
import { getSupabaseBrowserClient } from '@/lib/supabase'

const THREAD_TTL_MS = 120_000
const MESSAGE_TTL_MS = 120_000

type SelectedIds = Record<AssistantMode, string>
type ThreadEntry = { conversations: Conversation[]; selectedIds: SelectedIds; at: number }
type MessageEntry = { messages: Message[]; at: number }

const threadCache = new Map<string, ThreadEntry>()
const messageCache = new Map<string, MessageEntry>()
let authSubscribed = false
let lastSeenUserId: string | null = null

function tKey(userId: string, workspaceId: string) {
  return `${userId}::${workspaceId}`
}
function mKey(userId: string, workspaceId: string, threadId: string) {
  return `${userId}::${workspaceId}::${threadId}`
}

/** Wipe the whole assistant cache (logout / user change / demo). */
export function clearAssistantCache() {
  threadCache.clear()
  messageCache.clear()
}

// Subscribe once (client-only) so a sign-out or a different user empties the
// cache. Keying already prevents cross-user reads; this is defense in depth.
function ensureInvalidation(userId: string) {
  lastSeenUserId = userId
  if (authSubscribed || typeof window === 'undefined') return
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return
  authSubscribed = true
  supabase.auth.onAuthStateChange((event, session) => {
    const uid = session?.user?.id ?? null
    if (event === 'SIGNED_OUT' || (lastSeenUserId !== null && uid !== null && uid !== lastSeenUserId)) {
      clearAssistantCache()
    }
    if (uid) lastSeenUserId = uid
  })
}

export type CachedThreads = { conversations: Conversation[]; selectedIds: SelectedIds; stale: boolean }

export function getCachedThreads(userId?: string, workspaceId?: string | null): CachedThreads | null {
  if (typeof window === 'undefined' || !userId || !workspaceId) return null
  ensureInvalidation(userId)
  const entry = threadCache.get(tKey(userId, workspaceId))
  if (!entry) return null
  return { conversations: entry.conversations, selectedIds: entry.selectedIds, stale: Date.now() - entry.at > THREAD_TTL_MS }
}

export function setCachedThreads(
  userId: string | undefined,
  workspaceId: string | null | undefined,
  conversations: Conversation[],
  selectedIds: SelectedIds,
) {
  if (typeof window === 'undefined' || !userId || !workspaceId) return
  ensureInvalidation(userId)
  threadCache.set(tKey(userId, workspaceId), { conversations, selectedIds, at: Date.now() })
}

export function getCachedMessages(
  userId?: string,
  workspaceId?: string | null,
  threadId?: string,
): { messages: Message[]; stale: boolean } | null {
  if (typeof window === 'undefined' || !userId || !workspaceId || !threadId) return null
  ensureInvalidation(userId)
  const entry = messageCache.get(mKey(userId, workspaceId, threadId))
  if (!entry) return null
  return { messages: entry.messages, stale: Date.now() - entry.at > MESSAGE_TTL_MS }
}

export function setCachedMessages(
  userId: string | undefined,
  workspaceId: string | null | undefined,
  threadId: string | undefined,
  messages: Message[],
) {
  if (typeof window === 'undefined' || !userId || !workspaceId || !threadId) return
  ensureInvalidation(userId)
  messageCache.set(mKey(userId, workspaceId, threadId), { messages, at: Date.now() })
}

/** Drop the cached messages of a deleted thread. */
export function removeCachedMessages(userId?: string, workspaceId?: string | null, threadId?: string) {
  if (typeof window === 'undefined' || !userId || !workspaceId || !threadId) return
  messageCache.delete(mKey(userId, workspaceId, threadId))
}
