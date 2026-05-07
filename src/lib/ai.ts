import type { Conversation, Message } from '@/lib/types'

export type MockAIContext = {
  input: string
  workspaceName?: string
  conversation?: Conversation | null
  messages?: Message[]
  isDemo?: boolean
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word))
}

export function generateMockAIResponse({ input, workspaceName, conversation, messages = [], isDemo }: MockAIContext) {
  const text = input.toLowerCase()
  const client = conversation?.clientName || 'el cliente'
  const workspace = workspaceName || 'tu workspace'
  const contextSize = messages.length > 3 ? 'Ya hay contexto suficiente en la conversacion.' : 'Aun conviene hacer una pregunta de cualificacion.'
  const modeLabel = isDemo ? 'modo demo' : 'workspace real'

  if (hasAny(text, ['precio', 'plan', 'presupuesto', 'tarifa', 'coste', 'cuanto cuesta'])) {
    return `Para ${client}, responderia con una propuesta breve: validar necesidad, recomendar el plan Pro como punto de entrada y cerrar con una demo de 20 minutos. ${contextSize} En ${workspace}, lo dejaria como oportunidad caliente y siguiente paso comercial claro.`
  }

  if (hasAny(text, ['demo', 'reunion', 'reunir', 'llamada', 'agenda', 'cita', 'calendario'])) {
    return `Detecto intencion de reunion. Sugiero ofrecer dos franjas concretas, confirmar el objetivo de la llamada y crear un evento de seguimiento. Si activas n8n despues, este caso puede disparar confirmacion por email y recordatorio automatico.`
  }

  if (hasAny(text, ['factura', 'pago', 'cobro', 'vencida', 'impago', 'stripe'])) {
    return `Caso de facturacion. Responderia con tono tranquilo: confirmar que revisas el estado, reenviar enlace de pago si procede y registrar actividad. Si la factura esta vencida, conviene activar un flujo n8n de recordatorio con seguimiento humano.`
  }

  if (hasAny(text, ['problema', 'queja', 'error', 'mal', 'incidencia', 'molesto', 'enfadado'])) {
    return `Hay friccion potencial. Recomendacion: responder con empatia, asumir seguimiento inmediato y evitar automatizar en frio. Si el sentimiento sigue negativo, marca la conversacion como urgente y escala a una persona.`
  }

  if (hasAny(text, ['whatsapp', 'instagram', 'meta', 'canal', 'mensaje'])) {
    return `Buen caso para vender multicanalidad: centralizar mensajes, detectar intencion y convertir conversaciones en leads accionables. Hoy esta en ${modeLabel}; cuando conectes WhatsApp/Meta, el mismo flujo podra crear clientes y mensajes reales.`
  }

  if (hasAny(text, ['automatizacion', 'automatizar', 'n8n', 'webhook', 'flujo', 'workflow'])) {
    return `Recomendaria plantearlo como flujo n8n: trigger claro, payload desde NowCRM, validacion de requisitos y activity final. Para empezar, usaria "Nuevo lead" o "Factura vencida", porque ya tienen datos reales en Supabase.`
  }

  if (hasAny(text, ['funciona', 'caracteristica', 'feature', 'ia', 'crm'])) {
    return `Explicaria NowCRM como un CRM con datos reales, assistant persistente e integraciones preparadas. El mensaje clave: menos tareas manuales, mas seguimiento comercial y una base lista para IA/n8n reales.`
  }

  return `Mensaje registrado para ${client}. Mi siguiente paso recomendado: resumir el contexto, confirmar necesidad y proponer una accion concreta en las proximas 24 horas. ${contextSize}`
}
