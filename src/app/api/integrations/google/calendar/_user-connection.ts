// Shared helpers for the user-level Google Calendar connection model.
//
// Contract (verified against docs/supabase/calendar_user_level_v1.sql):
//   - public.google_calendar_connections MUST have `user_id uuid` and a
//     unique constraint over (workspace_id, user_id).
//   - Until that migration is applied, every read/write below detects the
//     missing column (Postgres error 42703) or missing constraint (42P10)
//     and returns `{ error: 'schema_pending_migration' }` so the route can
//     surface a 503 with a clear message. We never silently fall back to
//     workspace-level queries, because that would let one member overwrite
//     or read another member's tokens.
//
// Authorisation invariants enforced here:
//   - workspace_id always comes from `profiles.workspace_id` of the cookie
//     session. Never from body/query.
//   - user_id always comes from `supabase.auth.getUser().id`. Never from
//     body/query.
//   - service_role is only used by server routes, never returned to the
//     client.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const CONNECTIONS_TABLE = 'google_calendar_connections'

/** Postgres error codes we care about. */
const PG_UNDEFINED_COLUMN = '42703'
const PG_INVALID_ON_CONFLICT = '42P10'

export type ResolvedAuth = {
  userId: string
  email: string
  workspaceId: string
}

export type AuthError = {
  ok: false
  status: 401 | 403 | 503
  error: string
}

export async function buildCookieClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { /* static render */ }
      },
    },
  })
}

/**
 * Resolves the authenticated user + their workspace from the cookie session.
 * Returns a typed result that every Google Calendar route can pattern-match on.
 */
export async function resolveCalendarAuth(): Promise<ResolvedAuth | AuthError> {
  const supabase = await buildCookieClient()
  if (!supabase) return { ok: false, status: 503, error: 'Supabase no configurado' }

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { ok: false, status: 401, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, email')
    .eq('id', user.id)
    .maybeSingle()

  const workspaceId = (profile?.workspace_id as string | null | undefined) ?? null
  if (!workspaceId) return { ok: false, status: 403, error: 'Tu usuario no está vinculado a un workspace.' }

  return {
    userId: user.id,
    email: String(profile?.email ?? user.email ?? ''),
    workspaceId,
  }
}

/**
 * Selects the current user's Google Calendar connection. Returns:
 *   - null when there is no connection row for (workspace_id, user_id).
 *   - the row when found.
 *   - { schemaPending: true } when the BD doesn't have the user_id column yet
 *     (i.e. calendar_user_level_v1.sql hasn't been applied). Callers MUST
 *     surface this as a 503 with a clear message; they MUST NOT degrade to
 *     a workspace-level query because that would leak/sobrescribir tokens.
 */
export async function selectUserConnection<T extends Record<string, unknown>>(
  admin: SupabaseClient,
  workspaceId: string,
  userId: string,
  columns: string,
): Promise<{ row: T | null; schemaPending: false } | { row: null; schemaPending: true }> {
  const { data, error } = await admin
    .from(CONNECTIONS_TABLE)
    .select(columns)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (String(error.code ?? '') === PG_UNDEFINED_COLUMN) {
      return { row: null, schemaPending: true }
    }
    throw error
  }
  return { row: (data as T | null) ?? null, schemaPending: false }
}

/**
 * Upserts the current user's connection. Uses ON CONFLICT (workspace_id, user_id)
 * so two distinct users never collide on the legacy unique(workspace_id).
 * Refuses to write if the BD is still on the legacy schema.
 */
export async function upsertUserConnection(
  admin: SupabaseClient,
  workspaceId: string,
  userId: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; schemaPending: true } | { ok: false; error: string }> {
  const row = {
    ...payload,
    workspace_id: workspaceId,
    user_id: userId,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await admin
    .from(CONNECTIONS_TABLE)
    .upsert(row, { onConflict: 'workspace_id,user_id' })
    .select('*')
    .single()

  if (error) {
    const code = String(error.code ?? '')
    if (code === PG_UNDEFINED_COLUMN || code === PG_INVALID_ON_CONFLICT) {
      return { ok: false, schemaPending: true }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true, row: data as Record<string, unknown> }
}

/**
 * Updates the current user's connection by (workspace_id, user_id). Refuses if
 * the schema is still legacy.
 */
export async function updateUserConnection(
  admin: SupabaseClient,
  workspaceId: string,
  userId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true; rows: number } | { ok: false; schemaPending: true } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from(CONNECTIONS_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .select('id')

  if (error) {
    const code = String(error.code ?? '')
    if (code === PG_UNDEFINED_COLUMN) return { ok: false, schemaPending: true }
    return { ok: false, error: error.message }
  }
  return { ok: true, rows: data?.length ?? 0 }
}

/** Standard 503 payload for "schema needs calendar_user_level_v1.sql applied". */
export const SCHEMA_PENDING_RESPONSE = {
  ok: false as const,
  status: 503 as const,
  reason: 'schema_pending_migration',
  error: 'Esta operación requiere aplicar la migración calendar_user_level_v1.sql en Supabase. Contacta con el equipo técnico.',
}
