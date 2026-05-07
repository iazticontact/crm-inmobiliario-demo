import type { Conversation, Message } from '@/lib/types'
import { triggerN8nWebhook, type N8nTriggerResult } from '@/lib/integrations'

export type AssistantIntentName = 'booking' | 'invoice' | 'client_search' | 'next_action' | 'general'

export type AssistantIntent = {
  intent: AssistantIntentName
  confidence: number
  extracted: {
    clientName?: string
    service?: string
    date?: string
    time?: string
    duration?: number
    amount?: number
    concept?: string
  }
  missingFields: string[]
}

export type MockAIContext = {
  input: string
  workspaceName?: string
  conversation?: Conversation | null
  messages?: Message[]
  isDemo?: boolean
  workspaceId?: string | null
  webhookUrl?: string
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word))
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function addDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function titleCase(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function extractClientName(raw: string) {
  const match = raw.match(/\b(?:para|a|cliente|nombre de)\s+([A-ZÁÉÍÓÚÑ][\p{L}]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}]+)?)/u)
  if (match?.[1]) return match[1].trim()

  const lowerMatch = raw.match(/\b(?:para|cliente|nombre de)\s+([a-záéíóúñ]{3,})(?=\s|$)/i)
  return lowerMatch?.[1] ? titleCase(lowerMatch[1]) : undefined
}

function extractDate(text: string) {
  if (text.includes('pasado manana')) return addDays(2)
  if (text.includes('manana')) return addDays(1)
  if (text.includes('hoy')) return addDays(0)

  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (iso?.[1]) return iso[1]

  const short = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/)
  if (!short) return undefined
  const day = short[1].padStart(2, '0')
  const month = short[2].padStart(2, '0')
  const year = short[3]?.length === 4 ? short[3] : String(new Date().getFullYear())
  return `${year}-${month}-${day}`
}

function extractTime(text: string) {
  const match = text.match(/\b(?:a las|las|hora)\s*(\d{1,2})(?::|\.|h)?(\d{2})?\s*(?:h|horas)?\b/) ?? text.match(/\b(\d{1,2})(?::|\.|h)(\d{2})?\s*(?:h|horas)?\b/)
  if (!match) return undefined
  const hour = Number(match[1])
  if (hour < 0 || hour > 23) return undefined
  const minute = Number(match[2] ?? 0)
  if (minute < 0 || minute > 59) return undefined
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function extractDuration(text: string) {
  const match = text.match(/\b(\d{2,3})\s*(?:min|minutos)\b/)
  if (match?.[1]) return Number(match[1])
  if (text.includes('media hora')) return 30
  if (text.includes('una hora') || text.includes('1 hora')) return 60
  return undefined
}

function extractService(raw: string, text: string) {
  const known = ['corte de pelo', 'corte', 'color', 'tinte', 'manicura', 'peinado', 'consulta', 'demo', 'seguimiento']
  const found = known.find((service) => text.includes(service))
  if (found) return found === 'corte' ? 'Corte de pelo' : titleCase(found)

  const match = raw.match(/\b(?:servicio de|por|para)\s+([^.,;]+)$/i)
  if (!match?.[1]) return undefined
  const value = match[1].replace(/\b(mañana|manana|hoy|pasado mañana|pasado manana|a las|las|\d{1,2}(:\d{2})?)\b/gi, '').trim()
  return value.length > 2 ? titleCase(value) : undefined
}

function extractAmount(text: string) {
  const match = text.match(/\b(\d+(?:[,.]\d+)?)\s*(?:€|eur|euros)?\b/)
  if (!match?.[1]) return undefined
  return Number(match[1].replace(',', '.'))
}

function extractConcept(raw: string) {
  const match = raw.match(/\b(?:por|concepto|plan)\s+([^.,;]+)/i)
  return match?.[1] ? titleCase(match[1]) : undefined
}

export function detectAssistantIntent(message: string, context: { defaultClientName?: string } = {}): AssistantIntent {
  const raw = message.trim()
  const text = normalizeText(raw)
  const bookingWords = ['reserv', 'cita', 'agenda', 'agendar', 'calendario', 'peluqueria', 'llamadas', 'llamada', 'hueco']
  const invoiceWords = ['factura', 'facturar', 'cobro', 'importe', 'vencimiento', 'pago']
  const clientSearchWords = ['buscar cliente', 'localizar cliente', 'encuentra cliente', 'cliente por nombre', 'cliente por email']
  const nextActionWords = ['proxima accion', 'siguiente accion', 'que hago', 'prioridad', 'tareas']

  const extracted: AssistantIntent['extracted'] = {
    clientName: extractClientName(raw) || context.defaultClientName,
    date: extractDate(text),
    time: extractTime(text),
  }

  if (hasAny(text, bookingWords)) {
    extracted.service = extractService(raw, text)
    extracted.duration = extractDuration(text) ?? (extracted.clientName && extracted.service && extracted.date && extracted.time ? 60 : undefined)
    const missingFields = [
      !extracted.clientName && 'cliente',
      !extracted.service && 'servicio',
      !extracted.date && 'fecha',
      !extracted.time && 'hora',
    ].filter(Boolean) as string[]

    return {
      intent: 'booking',
      confidence: missingFields.length <= 1 ? 0.9 : 0.74,
      extracted,
      missingFields,
    }
  }

  if (hasAny(text, invoiceWords)) {
    extracted.amount = extractAmount(text)
    extracted.concept = extractConcept(raw)
    const missingFields = [
      !extracted.clientName && 'cliente',
      !extracted.amount && 'importe',
      !extracted.concept && 'concepto',
    ].filter(Boolean) as string[]

    return {
      intent: 'invoice',
      confidence: missingFields.length <= 1 ? 0.88 : 0.72,
      extracted,
      missingFields,
    }
  }

  if (hasAny(text, clientSearchWords)) return { intent: 'client_search', confidence: 0.78, extracted, missingFields: ['criterio de búsqueda'] }
  if (hasAny(text, nextActionWords)) return { intent: 'next_action', confidence: 0.8, extracted, missingFields: [] }
  return { intent: 'general', confidence: 0.3, extracted: {}, missingFields: [] }
}

function buildOperationalPrompt(input: string) {
  return [
    'Eres el Assistant Agent de NowCRM. Responde en español, corto y operativo.',
    'Si detectas reserva/cita, pide solo datos mínimos o prepara la cita; no propongas llamadas comerciales genéricas.',
    'Si detectas factura, pide cliente, importe, concepto y vencimiento si faltan datos.',
    'No confirmes acciones críticas como creadas si el usuario no las ha confirmado en NowCRM.',
    `Mensaje del usuario: ${input}`,
  ].join('\n')
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

  if (hasAny(text, ['demo', 'reunion', 'reunir', 'llamada', 'agenda', 'cita', 'calendario', 'reserva'])) {
    return `Sí. Para preparar la cita necesito cliente, servicio, fecha y hora. Con esos datos puedo dejar el evento listo para confirmar en Calendario.`
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

export async function triggerAssistantN8nFlow(context: MockAIContext): Promise<N8nTriggerResult> {
  return triggerN8nWebhook('assistant_message', {
    workspace_id: context.workspaceId || undefined,
    mode: context.workspaceId && !context.isDemo ? 'real' : 'demo',
    webhook_url: context.webhookUrl,
    flow_status: context.webhookUrl ? 'active' : 'pending_config',
    conversation: context.conversation ? {
      id: context.conversation.id,
      client_name: context.conversation.clientName,
      channel: context.conversation.channel,
      sentiment: context.conversation.sentiment,
      intent: context.conversation.intent,
    } : {},
    client: context.conversation ? {
      name: context.conversation.clientName,
      status: 'lead',
    } : {},
    message: {
      content: buildOperationalPrompt(context.input),
      original_content: context.input,
      role: 'user',
    },
    metadata: {
      source: 'assistant_ui',
      requested_action: 'generate_response',
      previous_messages: context.messages?.length ?? 0,
      max_tokens_hint: 260,
      response_style: 'short_operational',
    },
  })
}

export async function respondWithAssistant(context: MockAIContext) {
  const n8nResult = await triggerAssistantN8nFlow(context)
  if (n8nResult.status === 'ok' && n8nResult.suggested_response?.trim()) {
    return {
      response: n8nResult.suggested_response.trim(),
      source: 'n8n' as const,
      trigger: n8nResult,
    }
  }

  return {
    response: generateMockAIResponse(context),
    source: 'mock' as const,
    trigger: n8nResult,
  }
}
