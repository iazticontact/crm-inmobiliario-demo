// GET    /api/inbox/conversations/[id]  → conversation + last N messages + client snapshot
// PATCH  /api/inbox/conversations/[id]  → update status (open/pending/resolved/archived), unread, intent, sentiment
//
// Workspace guard enforced on every operation.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

function isUuid(value?: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

async function buildSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
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

async function resolveAuthAndWorkspace() {
  const supabase = await buildSupabase()
  if (!supabase) return { error: NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 }) }
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { error: NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) return { error: NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 }) }
  return { supabase, workspaceId }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ ok: false, error: 'id inválido' }, { status: 400 })

  const auth = await resolveAuthAndWorkspace()
  if ('error' in auth) return auth.error
  const { supabase, workspaceId } = auth

  const convRes = await supabase
    .from('conversations')
    .select('id, workspace_id, client_id, client_name, client_avatar, channel, status, sentiment, intent, ai_summary, unread, updated_at, created_at, metadata')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (convRes.error) {
    console.error('[inbox/conversations:get] conv error', convRes.error.message)
    return NextResponse.json({ ok: false, error: 'Error leyendo conversación' }, { status: 500 })
  }
  if (!convRes.data) return NextResponse.json({ ok: false, error: 'Conversación no encontrada' }, { status: 404 })

  // Prefer to fetch metadata so the UI can render send_status badges; if the
  // schema doesn't have a metadata column yet, fall back to the basic select.
  type MessageRow = Record<string, unknown>
  let messages: MessageRow[] = []
  let msgError: { message: string; code?: string } | null = null

  const firstRes = await supabase
    .from('messages')
    .select('id, conversation_id, sender, body, is_ai, created_at, metadata')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(200)

  if (firstRes.error) {
    const code = String((firstRes.error as { code?: string }).code ?? '')
    const message = String(firstRes.error.message ?? '').toLowerCase()
    const isSchema = code === 'PGRST204' || code === '42703' || message.includes('column') || message.includes('schema cache')
    if (isSchema) {
      const fallback = await supabase
        .from('messages')
        .select('id, conversation_id, sender, body, is_ai, created_at')
        .eq('workspace_id', workspaceId)
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(200)
      if (fallback.error) {
        msgError = { message: fallback.error.message, code: (fallback.error as { code?: string }).code }
      } else {
        messages = (fallback.data ?? []) as MessageRow[]
      }
    } else {
      msgError = { message: firstRes.error.message, code: (firstRes.error as { code?: string }).code }
    }
  } else {
    messages = (firstRes.data ?? []) as MessageRow[]
  }

  if (msgError) {
    console.error('[inbox/conversations:get] messages error', msgError.message)
    return NextResponse.json({ ok: false, error: 'Error leyendo mensajes' }, { status: 500 })
  }

  let client: Record<string, unknown> | null = null
  const clientId = convRes.data.client_id as string | null
  if (clientId) {
    const clientRes = await supabase
      .from('clients')
      .select('id, name, email, phone, company, status, lead_score, channel, notes, created_at')
      .eq('workspace_id', workspaceId)
      .eq('id', clientId)
      .maybeSingle()
    if (!clientRes.error) client = clientRes.data
  }

  return NextResponse.json({
    ok: true,
    conversation: convRes.data,
    messages,
    client,
  })
}

const ALLOWED_STATUS = new Set(['open', 'pending', 'resolved', 'archived'])
const ALLOWED_SENTIMENT = new Set(['positive', 'neutral', 'negative', 'urgent'])

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ ok: false, error: 'id inválido' }, { status: 400 })

  const auth = await resolveAuthAndWorkspace()
  if ('error' in auth) return auth.error
  const { supabase, workspaceId } = auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.status === 'string' && ALLOWED_STATUS.has(body.status)) patch.status = body.status
  if (typeof body.sentiment === 'string' && ALLOWED_SENTIMENT.has(body.sentiment)) patch.sentiment = body.sentiment
  if (typeof body.intent === 'string' && body.intent.length <= 60) patch.intent = body.intent
  if (typeof body.ai_summary === 'string' && body.ai_summary.length <= 1000) patch.ai_summary = body.ai_summary
  if (typeof body.unread === 'boolean') patch.unread = body.unread

  // client_id is allowed too — we accept null (to unlink) or a UUID that belongs
  // to the same workspace. Validating ownership prevents linking against another
  // tenant's client row even if RLS would block the read anyway.
  if (body.client_id === null) {
    patch.client_id = null
    patch.client_name = null
  } else if (typeof body.client_id === 'string' && isUuid(body.client_id)) {
    const clientCheck = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', body.client_id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (clientCheck.error || !clientCheck.data) {
      return NextResponse.json({ ok: false, error: 'Cliente no encontrado en este workspace' }, { status: 404 })
    }
    patch.client_id = clientCheck.data.id
    patch.client_name = (clientCheck.data as { name?: string | null }).name ?? null
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ ok: false, error: 'Nada que actualizar' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('conversations')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id, status, sentiment, intent, ai_summary, unread, updated_at, client_id, client_name')
    .maybeSingle()

  if (error) {
    console.error('[inbox/conversations:patch] error', error.message)
    return NextResponse.json({ ok: false, error: 'Error actualizando conversación' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ ok: false, error: 'Conversación no encontrada' }, { status: 404 })

  return NextResponse.json({ ok: true, conversation: data })
}
