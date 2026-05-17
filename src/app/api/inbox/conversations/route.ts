// GET /api/inbox/conversations
//
// Lists conversations for the current user's workspace with optional filters.
// Server-side, auth-aware, never exposes raw rows of other workspaces.
//
// Query params:
//   channel?: whatsapp | email | web | instagram | crm
//   status?: open | pending | resolved | archived
//   sentiment?: positive | neutral | negative | urgent
//   limit?: number (default 50, max 100)
//   offset?: number

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

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

export async function GET(req: NextRequest) {
  const supabase = await buildSupabase()
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const channel = sp.get('channel')?.trim() || undefined
  const status = sp.get('status')?.trim() || undefined
  const sentiment = sp.get('sentiment')?.trim() || undefined
  const limitRaw = Number(sp.get('limit'))
  const offsetRaw = Number(sp.get('offset'))
  const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 100)
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  let q = supabase
    .from('conversations')
    .select('id, workspace_id, client_id, client_name, client_avatar, channel, status, sentiment, intent, ai_summary, unread, updated_at, created_at, metadata')
    .eq('workspace_id', workspaceId)
    .neq('status', 'deleted')
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (channel) q = q.ilike('channel', channel)
  if (status) q = q.eq('status', status)
  if (sentiment) q = q.eq('sentiment', sentiment)

  const { data, error } = await q
  if (error) {
    console.error('[inbox/conversations] query error', error.message)
    return NextResponse.json({ ok: false, error: 'Error leyendo conversaciones' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, conversations: data ?? [], total: (data ?? []).length })
}
