// Asistente IA de WhatsApp — server-side helpers for Inbox conversations.
//
// Capabilities:
//   - summarize_conversation
//   - classify_intent
//   - detect_sentiment
//   - suggest_reply
//
// Rules:
//   - Never invents data not in the conversation/CRM context.
//   - Never auto-sends. The caller chooses whether to draft, queue or send.
//   - Returns sanitized JSON with explicit confidence/notes.
//   - Workspace-scoped: the caller must already have validated the conversation.
//   - Never logs OpenAI keys, refresh tokens or PII beyond what was already in messages.
//
// This is a thin wrapper over OpenAI's Responses API (same backend as the main
// agent). It deliberately ships a small, deterministic JSON schema instead of free
// text so callers can drive the UI predictably.

const OPENAI_URL = 'https://api.openai.com/v1/responses'

export type ConversationMessageForAgent = {
  sender: 'client' | 'agent' | 'ai' | string
  body: string
  createdAt?: string
}

export type WhatsappAgentContext = {
  workspaceId: string
  conversationId: string
  clientName?: string
  clientPhone?: string
  channel?: string
  businessContext?: string
  tone?: string
  recentMessages: ConversationMessageForAgent[] // chronological, oldest first, up to ~20
}

export type IntentLabel =
  | 'booking'
  | 'quote'
  | 'support'
  | 'complaint'
  | 'invoice'
  | 'followup'
  | 'sales'
  | 'other'

export type SentimentLabel = 'positive' | 'neutral' | 'negative' | 'urgent'

export type AgentDecision = {
  ok: boolean
  reason?:
    | 'no_api_key'
    | 'empty_conversation'
    | 'openai_error'
    | 'parse_error'
    | 'unsupported_task'
  summary?: string
  next_action?: string
  intent?: IntentLabel
  intent_confidence?: number
  sentiment?: SentimentLabel
  suggested_reply?: string
  needs_human?: boolean
  notes?: string
  raw_warning?: string
}

const MODEL = process.env.NOWLABS_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini'

type AgentTask = 'summarize' | 'classify_intent' | 'detect_sentiment' | 'suggest_reply' | 'full_review'

function buildInstructions(task: AgentTask, ctx: WhatsappAgentContext): string {
  const tone = ctx.tone || 'profesional, claro y cercano'
  const businessContext = ctx.businessContext || 'PYME que usa WhatsApp para hablar con clientes.'

  const base = [
    'Eres el Asistente IA de WhatsApp, un asistente operativo para la Inbox de WhatsApp de un CRM real.',
    `Contexto de negocio: ${businessContext}`,
    `Tono esperado: ${tone}.`,
    'Reglas estrictas:',
    '- Responde SIEMPRE en español neutro.',
    '- No inventes precios, horarios ni datos del cliente que no aparezcan en el contexto.',
    '- Si la conversación pide algo que requiere datos del CRM que no tienes, marca needs_human=true y explica qué falta.',
    '- No prometas disponibilidad ni descuentos.',
    '- Si el sentimiento es negativo o urgente, prefiere needs_human=true.',
    '- Devuelve SIEMPRE un objeto JSON conforme al esquema indicado. Sin texto adicional.',
  ].join('\n')

  if (task === 'summarize') {
    return `${base}\n\nTarea: resumir la conversación. Devuelve JSON {"summary": string (1-2 frases), "next_action": string (1 frase con la siguiente acción recomendada)}.`
  }
  if (task === 'classify_intent') {
    return `${base}\n\nTarea: clasificar intención. Devuelve JSON {"intent": one of [booking|quote|support|complaint|invoice|followup|sales|other], "intent_confidence": number 0..1, "notes": string (opcional)}.`
  }
  if (task === 'detect_sentiment') {
    return `${base}\n\nTarea: detectar sentimiento. Devuelve JSON {"sentiment": one of [positive|neutral|negative|urgent]}.`
  }
  if (task === 'suggest_reply') {
    return `${base}\n\nTarea: redactar una respuesta breve (máx 3 frases) que un humano pueda enviar tal cual. Devuelve JSON {"suggested_reply": string, "needs_human": boolean, "notes": string (opcional)}.`
  }
  // full_review
  return `${base}\n\nTarea: análisis completo. Devuelve JSON {"summary": string, "next_action": string, "intent": one of [booking|quote|support|complaint|invoice|followup|sales|other], "intent_confidence": number 0..1, "sentiment": one of [positive|neutral|negative|urgent], "suggested_reply": string, "needs_human": boolean, "notes": string (opcional)}.`
}

function buildConversationContext(ctx: WhatsappAgentContext): string {
  const header = [
    `Cliente: ${ctx.clientName || 'desconocido'}${ctx.clientPhone ? ` (${ctx.clientPhone})` : ''}`,
    `Canal: ${ctx.channel || 'whatsapp'}`,
  ].join(' · ')

  const lines = ctx.recentMessages.slice(-20).map((m) => {
    const who = m.sender === 'client' ? 'CLIENTE' : m.sender === 'ai' ? 'IA' : 'AGENTE'
    const body = (m.body || '').replace(/\s+/g, ' ').trim().slice(0, 600)
    return `[${who}] ${body}`
  })

  return `${header}\n\nHistorial reciente:\n${lines.join('\n')}`
}

async function callOpenAI(apiKey: string, instructions: string, userInput: string): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      instructions,
      input: userInput,
      max_output_tokens: 512,
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`)
  }
  const data = await res.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }
  if (typeof data.output_text === 'string') return data.output_text
  const collected: string[] = []
  for (const item of data.output ?? []) {
    for (const part of item.content ?? []) {
      if (typeof part.text === 'string') collected.push(part.text)
    }
  }
  return collected.join('\n').trim()
}

function safeParse(text: string): Record<string, unknown> | null {
  if (!text) return null
  // Strip code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Try to find a JSON object inside
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
      } catch { /* fallthrough */ }
    }
  }
  return null
}

function normalizeIntent(value: unknown): IntentLabel | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.toLowerCase().trim()
  const allowed: IntentLabel[] = ['booking', 'quote', 'support', 'complaint', 'invoice', 'followup', 'sales', 'other']
  return (allowed as string[]).includes(v) ? (v as IntentLabel) : undefined
}

function normalizeSentiment(value: unknown): SentimentLabel | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.toLowerCase().trim()
  const allowed: SentimentLabel[] = ['positive', 'neutral', 'negative', 'urgent']
  return (allowed as string[]).includes(v) ? (v as SentimentLabel) : undefined
}

async function runTask(task: AgentTask, ctx: WhatsappAgentContext): Promise<AgentDecision> {
  if (!ctx.recentMessages.length) {
    return { ok: false, reason: 'empty_conversation' }
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return { ok: false, reason: 'no_api_key' }
  }

  const instructions = buildInstructions(task, ctx)
  const userInput = buildConversationContext(ctx)

  let rawText = ''
  try {
    rawText = await callOpenAI(apiKey, instructions, userInput)
  } catch (err) {
    console.error('[whatsapp-agent] openai error', err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'openai_error' }
  }

  const parsed = safeParse(rawText)
  if (!parsed) {
    return { ok: false, reason: 'parse_error', raw_warning: rawText.slice(0, 200) }
  }

  const decision: AgentDecision = { ok: true }
  if (typeof parsed.summary === 'string') decision.summary = parsed.summary.trim().slice(0, 500)
  if (typeof parsed.next_action === 'string') decision.next_action = parsed.next_action.trim().slice(0, 280)
  const intent = normalizeIntent(parsed.intent)
  if (intent) decision.intent = intent
  if (typeof parsed.intent_confidence === 'number' && parsed.intent_confidence >= 0 && parsed.intent_confidence <= 1) {
    decision.intent_confidence = parsed.intent_confidence
  }
  const sentiment = normalizeSentiment(parsed.sentiment)
  if (sentiment) decision.sentiment = sentiment
  if (typeof parsed.suggested_reply === 'string') decision.suggested_reply = parsed.suggested_reply.trim().slice(0, 1500)
  if (typeof parsed.needs_human === 'boolean') decision.needs_human = parsed.needs_human
  if (typeof parsed.notes === 'string') decision.notes = parsed.notes.trim().slice(0, 400)

  // Safety net: negative/urgent → push human review
  if (decision.sentiment === 'negative' || decision.sentiment === 'urgent') {
    decision.needs_human = true
  }

  return decision
}

export async function summarizeConversation(ctx: WhatsappAgentContext) {
  return runTask('summarize', ctx)
}
export async function classifyIntent(ctx: WhatsappAgentContext) {
  return runTask('classify_intent', ctx)
}
export async function detectSentiment(ctx: WhatsappAgentContext) {
  return runTask('detect_sentiment', ctx)
}
export async function suggestReply(ctx: WhatsappAgentContext) {
  return runTask('suggest_reply', ctx)
}
export async function fullReview(ctx: WhatsappAgentContext) {
  return runTask('full_review', ctx)
}

export function isAgentTask(value: unknown): value is AgentTask {
  return value === 'summarize' || value === 'classify_intent' || value === 'detect_sentiment' || value === 'suggest_reply' || value === 'full_review'
}

export async function runAgentTask(task: AgentTask, ctx: WhatsappAgentContext) {
  return runTask(task, ctx)
}
