import type { Conversation, Message } from '@/lib/types'
import { triggerN8nWebhook, type N8nTriggerResult } from '@/lib/integrations'

export type AssistantIntentName =
  | 'booking'
  | 'booking_concrete'
  | 'booking_strategy'
  | 'invoice'
  | 'invoice_concrete'
  | 'client_search'
  | 'client_summary'
  | 'next_action'
  | 'proposal'
  | 'collection'
  | 'pricing'
  | 'capabilities'
  | 'consultative'
  | 'general'

export type AssistantIntent = {
  intent: AssistantIntentName
  confidence: number
  extracted: {
    clientName?: string
    service?: string
    date?: string
    time?: string
    duration?: number
    dueDate?: string
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

function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}

function dateFromCurrentMonthDay(day: number) {
  const now = new Date()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const safeDay = Math.max(1, Math.min(lastDay, day))
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), safeDay))
}

function titleCase(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function extractClientName(raw: string) {
  const match = raw.match(/\b(?:para|a|cliente|nombre de)\s+(\p{Lu}[\p{L}]+(?:\s+\p{Lu}[\p{L}]+)?)/u)
  if (match?.[1]) return match[1].trim()

  const lowerMatch = raw.match(/\b(?:para|a|cliente|nombre de)\s+(\p{L}{3,})(?=\s|$)/iu)
  return lowerMatch?.[1] ? titleCase(lowerMatch[1]) : undefined
}

function extractDate(text: string) {
  if (text.includes('pasado manana')) return addDays(2)
  if (text.includes('manana')) return addDays(1)
  if (text.includes('hoy')) return addDays(0)

  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (iso?.[1]) return iso[1]

  const currentMonthDay = text.match(/\b(?:vence|vencimiento|para el|el)\s+(\d{1,2})(?:\s+de\s+este\s+mes)?\b/)
  if (currentMonthDay?.[1]) return dateFromCurrentMonthDay(Number(currentMonthDay[1]))

  const short = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/)
  if (!short) return undefined
  const day = short[1].padStart(2, '0')
  const month = short[2].padStart(2, '0')
  const year = short[3]?.length === 4 ? short[3] : String(new Date().getFullYear())
  return `${year}-${month}-${day}`
}

function extractTime(text: string) {
  const match =
    text.match(/\b(?:a las|las|hora)\s*(\d{1,2})(?::|\.|h)?(\d{2})?\s*(?:h|horas)?\b/) ??
    text.match(/\b(\d{1,2})(?::|\.|h)(\d{2})?\s*(?:h|horas)?\b/)
  const bareHour =
    !match && !/\b(min|minutos|hora|horas|dia|dias|mes|meses|importe|euros|eur)\b/.test(text)
      ? text.match(/\b(\d{1,2})\b/)
      : null
  const resolved = match ?? bareHour
  if (!resolved) return undefined
  const hour = Number(resolved[1])
  if (hour < 0 || hour > 23) return undefined
  const minute = Number(resolved[2] ?? 0)
  if (minute < 0 || minute > 59) return undefined
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function extractDuration(text: string) {
  const match = text.match(/\b(\d{1,3})\s*(?:min|minutos)\b/)
  if (match?.[1]) return Number(match[1])
  if (text.includes('media hora')) return 30
  if (text.includes('una hora') || text.includes('1 hora')) return 60
  return undefined
}

function extractService(raw: string, text: string) {
  const known = ['corte de pelo', 'corte', 'color', 'tinte', 'manicura', 'tratamiento', 'peinado', 'consulta', 'llamada', 'reunion', 'demo', 'seguimiento']
  const found = known.find((service) => text.includes(service))
  if (found) return found === 'corte' ? 'Corte de pelo' : found === 'reunion' ? 'Reunion' : titleCase(found)

  const match = raw.match(/\b(?:servicio de|por|para)\s+([^.,;]+)$/i)
  if (!match?.[1]) return undefined
  const value = match[1].replace(/\b(manana|mañana|hoy|pasado manana|pasado mañana|a las|las|\d{1,2}(:\d{2})?)\b/gi, '').trim()
  return value.length > 2 ? titleCase(value) : undefined
}

function extractAmount(raw: string, text: string) {
  const hasAmountSignal = /€|eur|euros/i.test(raw) || hasAny(text, ['importe', 'factura', 'facturar', 'cobrar', 'cobro', 'presupuesto', 'pago', 'plan'])
  if (!hasAmountSignal) return undefined
  const match = text.match(/\b(\d+(?:[,.]\d+)?)\s*(?:€|eur|euros)?\b/)
  if (!match?.[1]) return undefined
  return Number(match[1].replace(',', '.'))
}

function extractConcept(raw: string) {
  const planMatch = raw.match(/\b(plan\s+[^.,;]+)/i)
  if (planMatch?.[1]) return titleCase(planMatch[1])
  const match = raw.match(/\b(?:por|concepto)\s+([^.,;]+)/i)
  return match?.[1] ? titleCase(match[1]) : undefined
}

function isReservationAutomationQuery(text: string) {
  const mentionsReservations = /\b(reserv\w*|cita\w*|agenda\w*|turnos|horarios)\b/.test(text)
  const strategicLanguage = /\b(automatiz|gestionar|gestione|llevar|lleve|busco|quiero|como|tema|ia|negocio)\b/.test(text)
  const directBookingCommand = /\b(reserva|reservar|agenda|agendar|crea(?:r)?(?: una)? cita|apunta|programa|programar)\b/.test(text)
  return mentionsReservations && strategicLanguage && !directBookingCommand
}

function isOperationalBookingCommand(text: string, extracted: AssistantIntent['extracted']) {
  const directBookingCommand = /\b(reserva|reservar|agenda|agendar|crea(?:r)?(?: una)? cita|crear cita|apunta|programa|programar|prepara(?:r)? una cita)\b/.test(text)
  const explicitCreate = /\b(crea|crear|prepara|preparar|quiero crear)\b.*\bcita\b/.test(text)
  const hasConcreteData = Boolean(extracted.clientName || extracted.date || extracted.time)
  return directBookingCommand && (hasConcreteData || explicitCreate)
}

function isCapabilityQuestion(text: string) {
  return ['que haces', 'que puedes hacer', 'echame un cable', 'ayudame', 'que eres', 'para que sirves'].some((pattern) => text.includes(pattern))
}

function isPricingQuestion(text: string) {
  return ['precios', 'precio', 'planes', 'tarifas', 'cuanto cuesta', 'coste'].some((pattern) => text.includes(pattern)) || (text.includes('plan') && /precio|incluye|cuesta/.test(text))
}

function isConsultativeBusinessQuestion(text: string) {
  const business = /\b(peluqueria|clinica|restaurante|asesoria|negocio|empresa|salon|centro)\b/.test(text)
  const consultative = /\b(informarme|ofreceis|ofrecen|como funcionaria|como funciona|que me recomiendas|necesito ayuda|automatiz|organizar|gestionar|llamadas|reservas|citas|clientes)\b/.test(text)
  return business && consultative
}

export function detectAssistantIntent(message: string, context: { defaultClientName?: string } = {}): AssistantIntent {
  const raw = message.trim()
  const text = normalizeText(raw)
  const invoiceWords = ['factura', 'facturar', 'cobro', 'cobrar', 'importe', 'vencimiento', 'vence', 'vencida', 'pago', 'presupuesto', 'euros', 'eur', '€']
  const clientSearchWords = ['buscar cliente', 'localizar cliente', 'encuentra cliente', 'cliente por nombre', 'cliente por email']
  const nextActionWords = ['proxima accion', 'siguiente accion', 'que hago', 'prioridad', 'tareas']

  const extracted: AssistantIntent['extracted'] = {
    clientName: extractClientName(raw) || context.defaultClientName,
    date: extractDate(text),
    time: extractTime(text),
    duration: extractDuration(text),
  }

  if (isCapabilityQuestion(text)) {
    return { intent: 'capabilities', confidence: 0.85, extracted, missingFields: [] }
  }

  if (isPricingQuestion(text)) {
    return { intent: 'pricing', confidence: 0.82, extracted, missingFields: [] }
  }

  if (isReservationAutomationQuery(text)) {
    return {
      intent: 'booking_strategy',
      confidence: 0.82,
      extracted,
      missingFields: [],
    }
  }

  if (isOperationalBookingCommand(text, extracted)) {
    extracted.service = extractService(raw, text)
    const missingFields = [
      !extracted.clientName && 'cliente',
      !extracted.service && 'servicio',
      !extracted.date && 'fecha',
      !extracted.time && 'hora',
      !extracted.duration && 'duración',
    ].filter(Boolean) as string[]

    return {
      intent: 'booking_concrete',
      confidence: missingFields.length <= 1 ? 0.9 : 0.74,
      extracted,
      missingFields,
    }
  }

  if (hasAny(text, ['revisar cobros', 'cobros', 'facturas pendientes', 'facturas vencidas', 'pendientes de pago'])) {
    return { intent: 'collection', confidence: 0.76, extracted, missingFields: [] }
  }

  const bareInvoiceSignal = /\b\d+(?:[,.]\d+)?\b/.test(text) && /\bplan\b/.test(text)
  if (hasAny(text, invoiceWords) || bareInvoiceSignal) {
    extracted.amount = extractAmount(raw, text)
    extracted.concept = extractConcept(raw)
    extracted.dueDate = extractDate(text)
    const missingFields = [
      !extracted.clientName && 'cliente',
      !extracted.amount && 'importe',
      !extracted.concept && 'concepto',
      !extracted.dueDate && 'vencimiento',
    ].filter(Boolean) as string[]

    return {
      intent: 'invoice_concrete',
      confidence: missingFields.length <= 1 ? 0.88 : 0.72,
      extracted,
      missingFields,
    }
  }

  if (hasAny(text, ['resumen cliente', 'resume cliente', 'resume este cliente', 'resumir cliente']) || /^resume\s+/i.test(text)) {
    return { intent: 'client_summary', confidence: 0.82, extracted, missingFields: [] }
  }
  if (hasAny(text, clientSearchWords) || /^busca(?:r)?\s+/i.test(text)) {
    return { intent: 'client_search', confidence: 0.78, extracted, missingFields: extracted.clientName ? [] : ['criterio de búsqueda'] }
  }
  if (hasAny(text, nextActionWords)) return { intent: 'next_action', confidence: 0.8, extracted, missingFields: [] }
  if (hasAny(text, ['propuesta', 'presupuesto', 'oferta comercial'])) return { intent: 'proposal', confidence: 0.75, extracted, missingFields: [] }
  if (isConsultativeBusinessQuestion(text)) return { intent: 'consultative', confidence: 0.72, extracted, missingFields: [] }
  return { intent: 'general', confidence: 0.3, extracted: {}, missingFields: [] }
}

function formatRecentHistory(messages: Message[] = []) {
  const recent = messages.slice(-6)
  if (!recent.length) return 'Sin historial previo.'
  return recent
    .map((message) => {
      const role = message.sender === 'agent' ? 'Usuario CRM' : message.sender === 'ai' ? 'Assistant Agent' : 'Cliente'
      return `${role}: ${message.content.slice(0, 240)}`
    })
    .join('\n')
}

function buildOperationalPrompt(input: string, messages: Message[] = [], conversation?: Conversation | null) {
  return [
    'Eres el Assistant Agent interno de NowCRM, no el bot final de WhatsApp del negocio.',
    'Ayudas al usuario del CRM a gestionar clientes, citas, facturas, cobros, proximas acciones y respuestas comerciales.',
    'Si el usuario pregunta de forma consultiva, responde humano, concreto y adaptado a su negocio; no contestes como menu.',
    'Si detectas reserva/cita, pide solo datos mínimos o prepara la cita; no propongas llamadas comerciales genéricas.',
    'Si detectas factura, pide cliente, importe, concepto y vencimiento si faltan datos.',
    'Si preguntan por precios/planes, no inventes importes: pide tipo de negocio, usuarios y modulos a activar.',
    'WhatsApp/Whapi es siguiente fase; no digas que ya esta conectado.',
    'Responde en español, maximo 3 frases, con tono operativo.',
    'No confirmes acciones críticas como creadas si el usuario no las ha confirmado en NowCRM.',
    `Conversacion actual: ${conversation?.clientName ?? 'consulta interna'} · ${conversation?.intent ?? 'sin intencion asignada'}.`,
    `Historial reciente:\n${formatRecentHistory(messages)}`,
    `Mensaje del usuario: ${input}`,
  ].join('\n')
}

export function generateMockAIResponse({ input, workspaceName, conversation, messages = [], isDemo }: MockAIContext) {
  const text = input.toLowerCase()
  const normalized = normalizeText(input)
  const client = conversation?.clientName || 'el cliente'
  const workspace = workspaceName || 'tu workspace'
  const contextSize = messages.length > 3 ? 'Ya hay contexto suficiente en la conversacion.' : 'Aun conviene hacer una pregunta de cualificacion.'
  const modeLabel = isDemo ? 'modo demo' : 'workspace real'

  if (isCapabilityQuestion(normalized)) {
    return 'Soy tu Assistant Agent interno de NowCRM. Puedo ayudarte a buscar clientes, preparar citas, crear facturas con confirmación, revisar cobros y proponerte próximas acciones comerciales. También puedo preparar respuestas o propuestas para clientes.'
  }

  if (isPricingQuestion(normalized)) {
    return `Puedo ayudarte a preparar una propuesta para ${client}, pero no voy a inventar precios. Necesito saber tipo de negocio, numero de usuarios y modulos a activar: clientes, calendario, facturacion, IA o WhatsApp. Con eso dejaria una propuesta clara para revisar en ${workspace}.`
  }

  if (isConsultativeBusinessQuestion(normalized) || isReservationAutomationQuery(normalized)) {
    const businessLabel = normalized.includes('peluqueria') ? 'una peluquería' : normalized.includes('clinica') ? 'una clínica' : normalized.includes('restaurante') ? 'un restaurante' : 'ese negocio'
    return `Para ${businessLabel}, NowCRM puede ayudarte a centralizar clientes, preparar reservas en calendario y automatizar seguimientos. La idea sería que el Assistant recoja nombre, servicio, día y hora, y deje la cita lista con confirmación. Si quieres llevarlo a WhatsApp o llamadas reales, esa sería la siguiente fase con Whapi/n8n.`
  }

  if (hasAny(text, ['demo', 'reunion', 'reunir', 'llamada', 'agenda', 'cita', 'calendario', 'reserva'])) {
    return `Si. Para preparar la cita necesito cliente, servicio, fecha y hora. Con esos datos puedo dejar el evento listo para confirmar en Calendario.`
  }

  if (hasAny(text, ['factura', 'pago', 'cobro', 'vencida', 'impago', 'stripe'])) {
    return `Caso de facturacion. Responderia con tono tranquilo: confirmar que revisas el estado, reenviar enlace de pago si procede y registrar actividad. Si la factura esta vencida, conviene activar un flujo n8n de recordatorio con seguimiento humano.`
  }

  if (hasAny(text, ['problema', 'queja', 'error', 'mal', 'incidencia', 'molesto', 'enfadado'])) {
    return `Hay friccion potencial. Recomendacion: responder con empatia, asumir seguimiento inmediato y evitar automatizar en frio. Si el sentimiento sigue negativo, marca la conversacion como urgente y escala a una persona.`
  }

  if (hasAny(text, ['whatsapp', 'instagram', 'meta', 'canal', 'mensaje'])) {
    return `Buen caso para vender multicanalidad: centralizar mensajes, detectar intencion y convertir conversaciones en leads accionables. Hoy esta en ${modeLabel}; cuando conectes WhatsApp/Whapi, el mismo flujo podra crear clientes y mensajes reales.`
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
      content: buildOperationalPrompt(context.input, context.messages, context.conversation),
      original_content: context.input,
      role: 'user',
    },
    metadata: {
      source: 'assistant_ui',
      requested_action: 'generate_response',
      previous_messages: context.messages?.length ?? 0,
      recent_context: formatRecentHistory(context.messages),
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
