// GET /api/config/status
//
// Returns a sanitized snapshot of the platform configuration: which env
// variables are present (booleans only), which are missing (NAMES only), and
// per-area status. NEVER returns values, tokens or keys.
//
// Auth-aware: requires a logged-in user so the snapshot doesn't leak
// readiness info publicly. Returns 401 for unauthenticated requests.

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getConfigSnapshot, getMetaReadinessRecommendation } from '@/lib/config-status'

export const runtime = 'nodejs'

export async function GET() {
  // Auth gate — never expose config readiness to anonymous callers.
  // (The booleans are not secrets, but they describe attack surface.)
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
    if (!url || !key) {
      const snapshot = getConfigSnapshot()
      return NextResponse.json({
        ok: false,
        error: 'Supabase no configurado',
        snapshot: { supabase: snapshot.supabase, publicAppUrl: snapshot.publicAppUrl },
      }, { status: 503 })
    }

    const cookieStore = await cookies()
    const supabase = createServerClient(url, key, {
      cookies: { getAll: () => cookieStore.getAll(), setAll: () => { /* no-op */ } },
    })

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
    }

    const snapshot = getConfigSnapshot()
    return NextResponse.json({
      ok: true,
      snapshot,
      recommendations: {
        meta: getMetaReadinessRecommendation(snapshot),
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[config/status]', msg.slice(0, 120))
    return NextResponse.json({ ok: false, error: 'Error leyendo configuración' }, { status: 500 })
  }
}
