// POST /api/integrations/meta/whatsapp/test
//
// Honest configuration test for the WhatsApp Meta Cloud API integration.
//
// Behavior:
//   - Verifies the user is authenticated and resolves their workspace.
//   - Reports the server-side config status (booleans + missing variable NAMES, never values).
//   - Reports the workspace connection status (phone_number_id, WABA, etc).
//   - Does NOT send a real WhatsApp message — that requires an explicit recipient
//     and is handled by /api/inbox/conversations/[id]/messages.
//   - Returns a stable JSON contract so the UI can render an honest state.

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getConfigSnapshot, getMetaReadinessRecommendation } from '@/lib/config-status'

export const runtime = 'nodejs'

export async function POST() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
    if (!url || !key) {
      return NextResponse.json({ ok: false, status: 'pending_config', message: 'Supabase no configurado.' }, { status: 503 })
    }

    const cookieStore = await cookies()
    const supabase = createServerClient(url, key, {
      cookies: { getAll: () => cookieStore.getAll(), setAll: () => { /* no-op */ } },
    })

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ ok: false, status: 'unauthorized', message: 'No autenticado.' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', user.id)
      .maybeSingle()

    const workspaceId = profile?.workspace_id as string | null | undefined
    if (!workspaceId) {
      return NextResponse.json({ ok: false, status: 'unauthorized', message: 'Sin workspace asignado.' }, { status: 403 })
    }

    const snapshot = getConfigSnapshot()
    const serverConfig = snapshot.meta

    const { data: row } = await supabase
      .from('whatsapp_connections')
      .select('phone_number_id, whatsapp_business_account_id, meta_business_id, connection_status, last_webhook_at')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'meta')
      .maybeSingle()

    const workspaceConfig = {
      hasPhoneNumberId: Boolean(row?.phone_number_id),
      hasWhatsappBusinessAccountId: Boolean(row?.whatsapp_business_account_id),
      hasMetaBusinessId: Boolean(row?.meta_business_id),
      connectionStatus: row?.connection_status ? String(row.connection_status) : 'not_configured',
      lastWebhookAt: row?.last_webhook_at ? String(row.last_webhook_at) : null,
    }

    const allServerReady = serverConfig.status === 'ready'
    const allWorkspaceReady = workspaceConfig.hasPhoneNumberId && workspaceConfig.hasWhatsappBusinessAccountId

    let status: 'ready' | 'pending_server_config' | 'pending_workspace_settings' | 'webhook_pending'
    let message: string

    if (!allServerReady) {
      status = 'pending_server_config'
      message = getMetaReadinessRecommendation(snapshot)
    } else if (!allWorkspaceReady) {
      status = 'pending_workspace_settings'
      message = 'El servidor está listo. Falta configurar Phone Number ID y WABA ID en Settings del workspace.'
    } else if (!workspaceConfig.lastWebhookAt) {
      status = 'webhook_pending'
      message = 'Todo configurado, pero todavía no se ha recibido ningún webhook real desde Meta. Registra la URL del webhook en Meta Developers y envía un mensaje de prueba.'
    } else {
      status = 'ready'
      message = 'WhatsApp Meta operativo. Último webhook recibido correctamente.'
    }

    return NextResponse.json({
      ok: status === 'ready',
      simulated: status !== 'ready',
      status,
      message,
      serverConfig,
      workspaceConfig,
      nextStep:
        status === 'pending_server_config'
          ? `Define las variables: ${serverConfig.missingVariables.join(', ')}.`
          : status === 'pending_workspace_settings'
            ? 'Edita los IDs de Meta en Settings → WhatsApp Business.'
            : status === 'webhook_pending'
              ? 'Registra el webhook en Meta Developers > WhatsApp > Configuration y envía un mensaje real al número.'
              : 'Listo para producción.',
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[meta/whatsapp/test]', msg.slice(0, 120))
    return NextResponse.json({ ok: false, status: 'error', message: 'Error al probar la conexión.' }, { status: 500 })
  }
}
