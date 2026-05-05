export type WebhookEvent = 'new_lead' | 'payment_registered' | 'appointment_scheduled' | 'invoice_overdue'
export type WebhookPayload = Record<string, unknown>

export type WebhookConfig = {
  event: WebhookEvent
  label: string
  description: string
  url: string
}

export const n8nWebhookConfigs: WebhookConfig[] = [
  { event: 'new_lead', label: 'Nuevo lead registrado', description: 'Dispara cuando un lead entra por cualquier canal.', url: 'https://n8n.tudominio.com/webhook/nuevo-lead' },
  { event: 'payment_registered', label: 'Cobro registrado', description: 'Dispara cuando se confirma un pago.', url: 'https://n8n.tudominio.com/webhook/cobro-registrado' },
  { event: 'appointment_scheduled', label: 'Cita agendada', description: 'Dispara cuando se agenda una llamada o reunión.', url: 'https://n8n.tudominio.com/webhook/cita-agendada' },
  { event: 'invoice_overdue', label: 'Factura vencida', description: 'Dispara cuando una factura supera su vencimiento.', url: 'https://n8n.tudominio.com/webhook/factura-vencida' },
]

export async function triggerN8nWebhook(eventName: WebhookEvent, payload: WebhookPayload): Promise<{ success: boolean; message: string }> {
  console.log('[n8n] Webhook triggered:', eventName, payload)
  await new Promise((r) => setTimeout(r, 900))
  return { success: true, message: `Webhook "${eventName}" ejecutado en simulación.` }
}

export async function simulateWhatsAppIncomingLead(): Promise<{ success: boolean; lead: { name: string; phone: string; message: string } }> {
  await new Promise((r) => setTimeout(r, 600))
  return { success: true, lead: { name: 'Lead WhatsApp Demo', phone: '+34 699 000 001', message: '¡Hola! Vi vuestro anuncio y me interesa NowCRM.' } }
}

export async function simulatePaymentRegistered(): Promise<{ success: boolean; amount: number; client: string }> {
  await new Promise((r) => setTimeout(r, 600))
  return { success: true, amount: 299, client: 'Cliente Demo SL' }
}

export const supabaseStatus = {
  connected: false,
  projectUrl: 'https://xxxx.supabase.co',
  note: 'Pendiente: configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local',
}
