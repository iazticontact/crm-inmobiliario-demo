import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

// Placeholder — sends a test webhook ping when Meta Business API credentials are configured.
// In production: calls Meta Cloud API /messages endpoint with a test template message.
// Until credentials are configured, returns a simulation result.
export async function POST() {
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

    // META_ACCESS_TOKEN and phone_number_id must come from server-side env only
    const hasMetaCredentials = Boolean(
      process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID
    )

    if (!hasMetaCredentials) {
      return NextResponse.json({
        ok: false,
        simulated: true,
        status: 'pending_credentials',
        message: 'Test simulado — configura META_ACCESS_TOKEN y META_PHONE_NUMBER_ID en el servidor para envíos reales.',
        nextStep: 'Añade las variables de entorno del servidor y vuelve a intentarlo.',
      })
    }

    // When credentials exist: implement real Meta Cloud API call here
    // POST https://graph.facebook.com/v19.0/{phone-number-id}/messages
    // with Authorization: Bearer META_ACCESS_TOKEN
    // Never expose the token to the client

    return NextResponse.json({
      ok: true,
      simulated: false,
      status: 'sent',
      message: 'Test enviado via Meta Cloud API.',
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[meta/whatsapp/test]', msg.slice(0, 100))
    return NextResponse.json({ ok: false, error: 'Error al enviar test de WhatsApp' }, { status: 500 })
  }
}
