import { NextResponse } from 'next/server'

type N8nTriggerBody = {
  event_type?: string
  endpoint?: string
  mode?: 'demo' | 'real'
  payload?: Record<string, unknown>
}

export async function POST(request: Request) {
  let body: N8nTriggerBody

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Payload inválido' }, { status: 400 })
  }

  const eventType = body.event_type || 'unknown'
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
  const isDemoEndpoint = !endpoint || endpoint.includes('tudominio.com')
  const payload = {
    event_type: eventType,
    source: 'nowcrm',
    mode: body.mode || (isDemoEndpoint ? 'demo' : 'real'),
    metadata: {
      triggered_at: new Date().toISOString(),
    },
    ...(body.payload || {}),
  }

  if (isDemoEndpoint) {
    return NextResponse.json({
      success: true,
      mode: 'demo',
      message: `Webhook "${eventType}" simulado desde NowCRM.`,
      payload,
    })
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    return NextResponse.json({
      success: response.ok,
      mode: 'real',
      status: response.status,
      message: response.ok ? `Webhook "${eventType}" enviado a n8n.` : 'n8n respondió con error.',
    }, { status: response.ok ? 200 : 502 })
  } catch {
    return NextResponse.json({
      success: false,
      mode: 'real',
      message: 'No se pudo contactar con el endpoint n8n.',
    }, { status: 502 })
  }
}
