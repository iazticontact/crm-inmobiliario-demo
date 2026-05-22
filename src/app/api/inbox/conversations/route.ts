// GET /api/inbox/conversations
//
// Lista las conversaciones del workspace del usuario autenticado.
//
// Decisión de producto:
//   La vista cliente de Inbox es WhatsApp-only. Para cualquier usuario
//   autenticado "normal" (rol distinto de `nowlabs_admin`), este endpoint
//   devuelve EXCLUSIVAMENTE filas con `channel='whatsapp'`. Los query params
//   `channel` e `includeInternal` se IGNORAN para usuarios normales — no
//   pueden saltarse el filtro WhatsApp manipulando la URL.
//
//   Sólo los `nowlabs_admin` (operadores internos NOWLabs) pueden:
//     - pasar `?channel=…` para ver email/instagram/web/crm.
//     - pasar `?includeInternal=1` para incluir conversaciones internas
//       (`crm`/`crm_internal`) junto a las WhatsApp.
//   La autorización se comprueba server-side leyendo `profiles.role`;
//   no basta con el query param.
//
// Query params (sólo honrados para nowlabs_admin):
//   channel?: whatsapp | email | web | instagram | crm | crm_internal
//   includeInternal?: 1 | true
//
// Query params (todos los usuarios):
//   status?: open | pending | resolved | archived
//   sentiment?: positive | neutral | negative | urgent
//   limit?: number (default 50, max 100)
//   offset?: number

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

const ALLOWED_ADMIN_CHANNELS = new Set(['whatsapp', 'email', 'web', 'instagram', 'crm', 'crm_internal'])

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

  // Resolvemos workspace + role en una sola lectura de profiles. El role es
  // la única señal de autorización: NO confiamos en ningún query param para
  // ampliar el alcance de la consulta.
  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .maybeSingle()
  const workspaceId = profile?.workspace_id as string | null | undefined
  if (!workspaceId) return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })

  const isNowlabsAdmin = String(profile?.role ?? '').toLowerCase() === 'nowlabs_admin'

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')?.trim() || undefined
  const sentiment = sp.get('sentiment')?.trim() || undefined
  const limitRaw = Number(sp.get('limit'))
  const offsetRaw = Number(sp.get('offset'))
  const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 100)
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  // Cálculo del filtro de canal — WhatsApp-only por defecto.
  // Para usuarios normales (no nowlabs_admin) IGNORAMOS los query params
  // `channel` e `includeInternal` y forzamos `channel='whatsapp'` server-side.
  let effectiveChannelFilter: string | null = 'whatsapp'

  if (isNowlabsAdmin) {
    const channelParam = sp.get('channel')?.trim().toLowerCase() || undefined
    const includeInternalRaw = sp.get('includeInternal')?.trim().toLowerCase()
    const includeInternal = includeInternalRaw === '1' || includeInternalRaw === 'true'

    if (channelParam && ALLOWED_ADMIN_CHANNELS.has(channelParam)) {
      effectiveChannelFilter = channelParam
    } else if (includeInternal) {
      effectiveChannelFilter = null // sin filtro de canal
    } else {
      effectiveChannelFilter = 'whatsapp'
    }
  }

  let q = supabase
    .from('conversations')
    .select('id, workspace_id, client_id, client_name, client_avatar, channel, status, sentiment, intent, ai_summary, unread, updated_at, created_at, metadata')
    .eq('workspace_id', workspaceId)
    .neq('status', 'deleted')
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (effectiveChannelFilter) {
    q = q.ilike('channel', effectiveChannelFilter)
  }
  if (status) q = q.eq('status', status)
  if (sentiment) q = q.eq('sentiment', sentiment)

  const { data, error } = await q
  if (error) {
    console.error('[inbox/conversations] query error', error.message)
    return NextResponse.json({ ok: false, error: 'Error leyendo conversaciones' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, conversations: data ?? [], total: (data ?? []).length })
}
