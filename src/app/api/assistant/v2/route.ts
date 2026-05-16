import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { runNowLabsAgent, type AgentContext } from '@/lib/agents/nowlabs-main-agent'

async function buildSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // route handlers can't always set cookies during static rendering
        }
      },
    },
  })
}

export async function POST(req: NextRequest) {
  const supabase = await buildSupabase()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase no configurado' }, { status: 503 })
  }

  // 1. Auth
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  // 2. Resolve workspace
  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })
  }

  // 3. Parse body
  let message: string
  let context: AgentContext
  try {
    const body = await req.json() as {
      message?: unknown
      lastReferencedClientId?: unknown
      lastReferencedClientName?: unknown
      lastResults?: unknown
      lastCalendarResults?: unknown
      lastPreparedAction?: unknown
      lastConfirmedEventId?: unknown
      lastConfirmedClientName?: unknown
      lastConfirmedDate?: unknown
    }
    message = typeof body.message === 'string' ? body.message.trim() : ''
    context = {
      lastReferencedClientId: typeof body.lastReferencedClientId === 'string' ? body.lastReferencedClientId : undefined,
      lastReferencedClientName: typeof body.lastReferencedClientName === 'string' ? body.lastReferencedClientName : undefined,
      lastResults: Array.isArray(body.lastResults) ? body.lastResults as Record<string, unknown>[] : [],
      lastCalendarResults: Array.isArray(body.lastCalendarResults) ? body.lastCalendarResults as Record<string, unknown>[] : [],
      lastPreparedAction: body.lastPreparedAction && typeof body.lastPreparedAction === 'object'
        ? body.lastPreparedAction as AgentContext['lastPreparedAction']
        : undefined,
      lastConfirmedEventId: typeof body.lastConfirmedEventId === 'string' ? body.lastConfirmedEventId : undefined,
      lastConfirmedClientName: typeof body.lastConfirmedClientName === 'string' ? body.lastConfirmedClientName : undefined,
      lastConfirmedDate: typeof body.lastConfirmedDate === 'string' ? body.lastConfirmedDate : undefined,
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 })
  }

  if (!message) {
    return NextResponse.json({ ok: false, error: 'Campo message requerido' }, { status: 400 })
  }

  // 4. Run agent
  const result = await runNowLabsAgent(supabase, workspaceId, message, context)

  return NextResponse.json({
    ok: !result.error,
    answer: result.answer,
    debugSource: result.debugSource,
    toolCalls: result.toolCalls,
    referencedClientId: result.referencedClientId ?? null,
    referencedClientName: result.referencedClientName ?? null,
    referencedList: result.referencedList ?? null,
    referencedCalendarList: result.referencedCalendarList ?? null,
    dataPreview: result.dataPreview ?? null,
    preparedAction: result.preparedAction ?? null,
    ...(result.error ? { error: result.error } : {}),
  })
}
