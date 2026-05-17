import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { MetaWhatsAppConnection, MetaWhatsAppConnectionStatus } from '@/lib/types'
import { getConfigSnapshot, getMetaReadinessRecommendation } from '@/lib/config-status'

export const runtime = 'nodejs'

function deriveStatus(row: Record<string, unknown>): MetaWhatsAppConnectionStatus {
  const s = String(row.status ?? row.connection_status ?? '')
  if (s === 'connected') return 'connected'
  if (s === 'error') return 'error'
  if (s === 'webhook_pending') return 'webhook_pending'
  if (row.phone_number_id && row.whatsapp_business_account_id) return 'webhook_pending'
  if (row.meta_business_id || row.whatsapp_business_account_id) return 'pending_meta_business'
  return 'not_configured'
}

export async function GET() {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', user.id)
      .maybeSingle()

    const workspaceId = profile?.workspace_id
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: 'Workspace no encontrado' }, { status: 404 })
    }

    const { data: row } = await supabase
      .from('whatsapp_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'meta')
      .maybeSingle()

    const cfgSnapshot = getConfigSnapshot()
    const serverConfig = {
      ...cfgSnapshot.meta,
      recommendation: getMetaReadinessRecommendation(cfgSnapshot),
    }

    if (!row) {
      const status: MetaWhatsAppConnection = {
        workspaceId,
        provider: 'meta',
        webhookVerifyTokenConfigured: cfgSnapshot.meta.hasWebhookVerifyToken,
        connectionStatus: 'not_configured',
      }
      return NextResponse.json({ ok: true, connection: status, serverConfig })
    }

    const connection: MetaWhatsAppConnection = {
      id: String(row.id ?? ''),
      workspaceId,
      provider: 'meta',
      metaBusinessId: row.meta_business_id ? String(row.meta_business_id) : undefined,
      whatsappBusinessAccountId: row.whatsapp_business_account_id ? String(row.whatsapp_business_account_id) : undefined,
      phoneNumberId: row.phone_number_id ? String(row.phone_number_id) : undefined,
      displayPhoneNumber: row.phone_number ? String(row.phone_number) : undefined,
      webhookVerifyTokenConfigured: cfgSnapshot.meta.hasWebhookVerifyToken,
      webhookUrl: row.webhook_url ? String(row.webhook_url) : undefined,
      connectionStatus: deriveStatus(row as Record<string, unknown>),
      lastWebhookAt: row.last_webhook_at ? String(row.last_webhook_at) : undefined,
      lastTestAt: row.last_test_at ? String(row.last_test_at) : undefined,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    }

    return NextResponse.json({ ok: true, connection, serverConfig })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[meta/whatsapp/status]', msg.slice(0, 100))
    return NextResponse.json({ ok: false, error: 'Error al leer estado de WhatsApp Business' }, { status: 500 })
  }
}
