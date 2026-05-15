import { NextResponse } from 'next/server'
import { checkN8nStatus, triggerN8nWorkflow } from '@/lib/n8n-client'

export const runtime = 'nodejs'

export async function POST() {
  const n8nStatus = await checkN8nStatus()

  if (!n8nStatus.ok) {
    return NextResponse.json({
      ok: false,
      simulated: n8nStatus.status === 'pending_config',
      status: n8nStatus.status,
      message:
        n8nStatus.status === 'pending_config'
          ? 'n8n no configurado en el servidor. Contacta con el equipo tecnico para configurar N8N_BASE_URL y N8N_API_KEY.'
          : 'n8n configurado pero no disponible. Verifica que la instancia este activa.',
    })
  }

  const result = await triggerN8nWorkflow('test-flow', {
    event_type: 'test_flow',
    source: 'nowcrm',
    mode: 'test',
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json({
    ok: result.ok,
    simulated: false,
    status: result.status,
    message: result.message,
  })
}
