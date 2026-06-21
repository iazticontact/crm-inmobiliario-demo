// /api/clients/[id]/delete — safe client deletion with relational cleanup.
//
//   GET  → impact preview (counts of related rows that will be removed).
//   POST → confirm + execute the cascade (atomic, via the delete_client_cascade RPC).
//
// Security:
//   - Cookie-bound Supabase client → real session required (401 otherwise).
//   - Workspace is resolved from the caller's profile; the client must belong to
//     it (404 otherwise) — workspace_id is NEVER taken from the request.
//   - Only workspace admins (client_admin / nowlabs_admin) may delete (403).
//   - POST requires `confirm` to equal the exact client name (backend guard
//     against an accidental/automated delete on top of the double-confirm UI).
//   - The RPC re-validates is_workspace_admin and runs the whole cascade in one
//     transaction, workspace-scoped. No service_role is exposed to the frontend.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

async function buildSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { /* static */ }
      },
    },
  })
}

type Resolved = { workspaceId: string; client: { id: string; name: string } }
type ResolveError = { error: string; status: 400 | 401 | 403 | 404 | 503 }

async function resolveAdminClient(
  supabase: NonNullable<Awaited<ReturnType<typeof buildSupabase>>>,
  clientId: string,
): Promise<Resolved | ResolveError> {
  if (!isUuid(clientId)) return { error: 'clientId inválido', status: 400 }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: 'No autenticado', status: 401 }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError || !profile?.workspace_id) return { error: 'Workspace no encontrado', status: 403 }

  const isAdmin = profile.role === 'client_admin' || profile.role === 'nowlabs_admin'
  if (!isAdmin) return { error: 'No tienes permisos para eliminar clientes.', status: 403 }

  const workspaceId = String(profile.workspace_id)
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (clientError || !client) return { error: 'Cliente no encontrado o sin permisos', status: 404 }

  return { workspaceId, client: { id: String(client.id), name: String(client.name ?? '') } }
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await buildSupabase()
  if (!supabase) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 503 })

  const { id: clientId } = await ctx.params
  const resolved = await resolveAdminClient(supabase, clientId)
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const { workspaceId, client } = resolved
  const countOf = async (table: string, column: string) => {
    const { count } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq(column, client.id)
    return count ?? 0
  }

  const [opportunities, service_cases, tasks, calendar_events, activities, assistant_memories, properties] =
    await Promise.all([
      countOf('opportunities', 'client_id'),
      countOf('service_cases', 'client_id'),
      countOf('tasks', 'client_id'),
      countOf('calendar_events', 'client_id'),
      countOf('activities', 'client_id'),
      countOf('assistant_agent_memory', 'entity_id'),
      countOf('properties', 'client_id'),
    ])

  return NextResponse.json({
    client,
    related: { opportunities, service_cases, tasks, calendar_events, activities, assistant_memories, properties },
  })
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await buildSupabase()
  if (!supabase) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 503 })

  const { id: clientId } = await ctx.params
  const resolved = await resolveAdminClient(supabase, clientId)
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  const { client } = resolved

  let body: { confirm?: unknown } = {}
  try { body = (await request.json()) as { confirm?: unknown } } catch { /* empty body */ }
  const confirm = typeof body.confirm === 'string' ? body.confirm.trim() : ''

  // Backend guard: the typed confirmation must match the exact client name.
  if (!client.name || confirm.toLowerCase() !== client.name.trim().toLowerCase()) {
    return NextResponse.json({ error: 'La confirmación no coincide con el nombre del cliente.' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('delete_client_cascade', { p_client_id: client.id })
  if (error) {
    const forbidden = error.code === '42501' || /not_workspace_admin/.test(error.message ?? '')
    const notFound = error.code === 'P0002' || /client_not_found/.test(error.message ?? '')
    if (forbidden) return NextResponse.json({ error: 'No tienes permisos para eliminar este cliente.' }, { status: 403 })
    if (notFound) return NextResponse.json({ error: 'Cliente no encontrado.' }, { status: 404 })
    return NextResponse.json({ error: 'No se pudo eliminar el cliente. Inténtalo de nuevo.' }, { status: 500 })
  }

  return NextResponse.json({ deleted: true, result: data })
}
