import type { Conversation, Message } from '@/lib/types'

export type MockAIContext = {
  input: string
  workspaceName?: string
  conversation?: Conversation | null
  messages?: Message[]
  isDemo?: boolean
}

export function generateMockAIResponse({ input, workspaceName, conversation }: MockAIContext) {
  const text = input.toLowerCase()
  const client = conversation?.clientName || 'el cliente'
  const workspace = workspaceName || 'tu workspace'

  if (text.includes('precio') || text.includes('plan') || text.includes('presupuesto') || text.includes('tarifa')) {
    return `Puedo ayudarte con una respuesta comercial para ${client}. Recomiendo explicar el plan Pro como punto de entrada, ofrecer una demo breve y cerrar con una pregunta clara: "¿Quieres que te reserve 20 minutos esta semana para verlo aplicado a ${workspace}?"`
  }

  if (text.includes('demo') || text.includes('reun') || text.includes('llamada') || text.includes('agenda') || text.includes('cita')) {
    return `He detectado intención de reunión. Sugerencia: confirma disponibilidad con dos franjas concretas, promete una demo orientada a resultados y deja preparado un evento de seguimiento para ${client}.`
  }

  if (text.includes('factura') || text.includes('pago') || text.includes('cobro') || text.includes('vencida')) {
    return `Parece un caso de facturación. Responde con tono tranquilo, confirma que revisas la factura y propone una acción: reenviar enlace de pago, corregir datos o marcar prioridad si hay incidencia.`
  }

  if (text.includes('problema') || text.includes('queja') || text.includes('error') || text.includes('mal') || text.includes('incidencia')) {
    return `Hay posible fricción. Recomiendo responder con empatía, asumir seguimiento inmediato y escalar internamente si el cliente tiene alto valor o sentimiento negativo.`
  }

  if (text.includes('whatsapp') || text.includes('instagram') || text.includes('email') || text.includes('automat')) {
    return `Para este caso destacaría el valor de NowCRM: conversaciones unificadas, IA que prioriza intención y automatizaciones listas para n8n cuando conectes los flujos reales.`
  }

  return `Mensaje registrado. Mi recomendación para ${client}: resume el contexto, confirma el siguiente paso y agenda una acción comercial dentro de las próximas 24 horas para no perder momentum.`
}
