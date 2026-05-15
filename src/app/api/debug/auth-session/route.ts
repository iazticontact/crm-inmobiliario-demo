import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = await cookies()
  const cookiesSeen = cookieStore.getAll().map((c) => c.name)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()

  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'Supabase no configurado', cookiesSeen })
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll() { /* read-only in GET — intentional */ },
    },
  })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()

  if (authErr || !user) {
    return NextResponse.json({
      ok: false,
      hasUser: false,
      userId: null,
      email: null,
      hasProfile: false,
      workspaceId: null,
      cookiesSeen,
      authError: authErr?.message ?? 'no_user',
    })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    hasUser: true,
    userId: user.id,
    email: user.email,
    hasProfile: Boolean(profile),
    workspaceId: profile?.workspace_id ?? null,
    cookiesSeen,
  })
}
