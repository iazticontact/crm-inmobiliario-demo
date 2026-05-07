export type WebhookEvent =
  | 'new_lead'
  | 'whatsapp_incoming'
  | 'payment_registered'
  | 'appointment_scheduled'
  | 'invoice_overdue'
  | 'reengagement_sequence'
  | 'daily_ai_summary'
  | 'urgent_conversation'

export type WebhookPayload = Record<string, unknown>

export type WebhookConfig = {
  event: WebhookEvent
  label: string
  description: string
  trigger: string
  url: string
  status: 'active' | 'demo' | 'pending' | 'inactive'
  requires: Array<'Supabase' | 'n8n' | 'WhatsApp/API' | 'Email/API' | 'Billing/API'>
}

export const n8nWebhookConfigs: WebhookConfig[] = [
  { event: 'new_lead', label: 'Nuevo lead registrado', description: 'Crea lead, calcula score inicial y avisa al equipo.', trigger: 'Lead desde cualquier canal', url: 'https://n8n.tudominio.com/webhook/nuevo-lead', status: 'demo', requires: ['Supabase', 'n8n'] },
  { event: 'whatsapp_incoming', label: 'Mensaje entrante WhatsApp', description: 'Registra conversación, clasifica intención y propone respuesta IA.', trigger: 'Mensaje WhatsApp Business', url: 'https://n8n.tudominio.com/webhook/whatsapp-incoming', status: 'pending', requires: ['Supabase', 'n8n', 'WhatsApp/API'] },
  { event: 'appointment_scheduled', label: 'Reunión agendada', description: 'Guarda evento, envía confirmación y prepara resumen previo.', trigger: 'Nueva cita en calendario', url: 'https://n8n.tudominio.com/webhook/cita-agendada', status: 'demo', requires: ['Supabase', 'n8n', 'Email/API'] },
  { event: 'invoice_overdue', label: 'Factura vencida', description: 'Detecta impago, programa recordatorio y registra actividad.', trigger: 'Factura supera vencimiento', url: 'https://n8n.tudominio.com/webhook/factura-vencida', status: 'demo', requires: ['Supabase', 'n8n', 'Billing/API'] },
  { event: 'payment_registered', label: 'Cobro registrado', description: 'Actualiza factura y lanza confirmación al cliente.', trigger: 'Pago confirmado', url: 'https://n8n.tudominio.com/webhook/cobro-registrado', status: 'demo', requires: ['Supabase', 'n8n', 'Billing/API'] },
  { event: 'reengagement_sequence', label: 'Secuencia de re-engagement', description: 'Reactiva leads fríos con mensajes y tareas comerciales.', trigger: 'Lead sin contacto 7+ días', url: 'https://n8n.tudominio.com/webhook/reengagement', status: 'inactive', requires: ['Supabase', 'n8n', 'Email/API'] },
  { event: 'daily_ai_summary', label: 'Resumen diario IA', description: 'Genera briefing con ventas, alertas y siguientes acciones.', trigger: 'Cada día a las 08:00', url: 'https://n8n.tudominio.com/webhook/daily-summary', status: 'pending', requires: ['Supabase', 'n8n'] },
  { event: 'urgent_conversation', label: 'Conversación urgente', description: 'Escala conversaciones negativas o de alta intención.', trigger: 'Sentimiento negativo o score alto', url: 'https://n8n.tudominio.com/webhook/urgent-conversation', status: 'pending', requires: ['Supabase', 'n8n', 'WhatsApp/API'] },
]

export async function triggerN8nWebhook(eventName: WebhookEvent, payload: WebhookPayload): Promise<{ success: boolean; message: string }> {
  const endpoint = typeof payload.url === 'string' ? payload.url : undefined
  const mode = payload.mode === 'real' ? 'real' : 'demo'

  try {
    const response = await fetch('/api/n8n/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: eventName,
        endpoint,
        mode,
        payload,
      }),
    })
    const data = await response.json() as { success?: boolean; message?: string }
    return { success: Boolean(data.success), message: data.message || `Webhook "${eventName}" procesado.` }
  } catch {
    await new Promise((r) => setTimeout(r, 600))
    return { success: true, message: `Webhook "${eventName}" ejecutado en simulación local.` }
  }
}

export async function simulateWhatsAppIncomingLead(): Promise<{ success: boolean; lead: { name: string; phone: string; message: string } }> {
  await new Promise((r) => setTimeout(r, 600))
  return { success: true, lead: { name: 'Lead WhatsApp Demo', phone: '+34 699 000 001', message: '¡Hola! Vi vuestro anuncio y me interesa NowCRM.' } }
}

export async function simulatePaymentRegistered(): Promise<{ success: boolean; amount: number; client: string }> {
  await new Promise((r) => setTimeout(r, 600))
  return { success: true, amount: 299, client: 'Cliente Demo SL' }
}

const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
const hasSupabasePublishableKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
const hasSupabaseAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

export const supabaseStatus = {
  configured: hasSupabaseUrl && (hasSupabaseAnonKey || hasSupabasePublishableKey),
  hasUrl: hasSupabaseUrl,
  hasPublishableKey: hasSupabasePublishableKey,
  hasAnonKey: hasSupabaseAnonKey,
  connected: false,
  note: hasSupabaseUrl && (hasSupabaseAnonKey || hasSupabasePublishableKey)
    ? 'Variables públicas detectadas. Auth, clientes, facturas y calendario están preparados para datos reales.'
    : 'Pendiente: añade NEXT_PUBLIC_SUPABASE_URL y una clave pública de Supabase en .env.local.',
}
