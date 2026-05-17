// POST /api/inbox/agent
//
// NowLabs WhatsApp Agent — operates on a single conversation.
//
// Body:
//   {
//     conversationId: uuid,
//     task: 'summarize' | 'classify_intent' | 'detect_sentiment' | 'suggest_reply' | 'full_review',
//     persist?: boolean   // if true and task includes intent/sentiment/summary, patches the conversation row
//   }
//
// Returns the agent decision plus a sanitized `applied` block describing what was persisted.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { runAgentTask, isAgentTask, type WhatsappAgentContext } from '@/lib/agents/whatsapp-agent'

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

export async function POST(req: NextRequest) {
  const supabase = await buildSupabase()
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })

  let body: { conversationId?: unknown; task?: unknown; persist?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 })
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  if (!isUuid(conversationId)) return NextResponse.json({ ok: false, error: 'conversationId inválido' }, { status: 400 })

  const task = body.task
  if (!isAgentTask(task)) return NextResponse.json({ ok: false, error: 'task inválida' }, { status: 400 })

  // Load conversation + last messages + client + inbox agent settings
  const convRes = await supabase
    .from('conversations')
    .select('id, client_id, client_name, channel, metadata')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (convRes.error || !convRes.data) {
    return NextResponse.json({ ok: false, error: 'Conversación no encontrada' }, { status: 404 })
  }

  const msgsRes = await supabase
    .from('messages')
    .select('sender, body, is_ai, created_at')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(40)
  if (msgsRes.error) {
    console.error('[inbox/agent] messages error', msgsRes.error.message)
    return NextResponse.json({ ok: false, error: 'Error leyendo mensajes' }, { status: 500 })
  }

  let clientPhone: string | undefined
  const clientId = convRes.data.client_id as string | null
  if (clientId) {
    const clientRes = await supabase
      .from('clients')
      .select('phone, name')
      .eq('workspace_id', workspaceId)
      .eq('id', clientId)
      .maybeSingle()
    clientPhone = (clientRes.data?.phone as string | null) || undefined
  }

  const settingsRes = await supabase
    .from('inbox_agent_settings')
    .select('business_context, tone, enabled, mode, auto_reply_enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const context: WhatsappAgentContext = {
    workspaceId,
    conversationId,
    clientName: (convRes.data.client_name as string | null) || undefined,
    clientPhone,
    channel: (convRes.data.channel as string | null) || undefined,
    businessContext: (settingsRes.data?.business_context as string | null) || undefined,
    tone: (settingsRes.data?.tone as string | null) || undefined,
    recentMessages: (msgsRes.data ?? []).slice(-20).map((m) => ({
      sender: String(m.sender ?? 'agent'),
      body: String(m.body ?? ''),
      createdAt: m.created_at ? String(m.created_at) : undefined,
    })),
  }

  const decision = await runAgentTask(task, context)

  let applied: Record<string, unknown> | null = null
  if (decision.ok && body.persist === true) {
    const patch: Record<string, unknown> = {}
    if (decision.summary) patch.ai_summary = decision.summary.slice(0, 1000)
    if (decision.intent) patch.intent = decision.intent
    if (decision.sentiment) patch.sentiment = decision.sentiment
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString()
      const { error: patchErr, data: patchData } = await supabase
        .from('conversations')
        .update(patch)
        .eq('id', conversationId)
        .eq('workspace_id', workspaceId)
        .select('id, ai_summary, intent, sentiment, updated_at')
        .maybeSingle()
      if (!patchErr && patchData) applied = patchData as Record<string, unknown>
    }
  }

  return NextResponse.json({
    ok: true,
    task,
    decision,
    applied,
    auto_reply_enabled: Boolean(settingsRes.data?.auto_reply_enabled),
    agent_enabled: Boolean(settingsRes.data?.enabled),
  })
}
