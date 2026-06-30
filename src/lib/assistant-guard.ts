// Protección de coste/abuso del Asistente IA del CRM. Puro y sin dependencias, reutilizable en el
// frontend (aviso + bloqueo antes de llamar al agente) y en el backend (validación DURA antes de
// tocar n8n/OpenAI). El objetivo: que un megaprompt o un mensaje gigante NO gaste tokens ni dispare
// timeouts. Límites configurables por env con valores seguros por defecto.

const toNum = (v: string | undefined, def: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def
}

export const ASSISTANT_LIMITS = {
  // Frontend avisa/bloquea aquí; el backend rechaza por encima de hardMaxInputChars.
  maxInputChars: toNum(process.env.NEXT_PUBLIC_ASSISTANT_MAX_INPUT_CHARS, 2000),
  warnAtChars: toNum(process.env.NEXT_PUBLIC_ASSISTANT_WARN_AT_CHARS, 1700),
  hardMaxInputChars: toNum(process.env.ASSISTANT_MAX_INPUT_CHARS, 2500),
  // Historial enviado al agente (control de payload/tokens).
  maxHistoryMessages: toNum(process.env.ASSISTANT_MAX_HISTORY_MESSAGES, 8),
  maxHistoryCharsPerMessage: toNum(process.env.ASSISTANT_MAX_HISTORY_CHARS_PER_MESSAGE, 600),
  // Rate limiting (best-effort en memoria).
  ratePerMinute: toNum(process.env.ASSISTANT_RATE_LIMIT_PER_MINUTE, 10),
}

export const ASSISTANT_BLOCK_MESSAGES = {
  too_long: 'El mensaje es demasiado largo para el asistente del CRM. Resume la petición o divídela en partes más pequeñas.',
  megaprompt: 'Esto parece una instrucción técnica o un prompt largo. El Asistente IA está limitado a consultas y acciones del CRM. Para trabajo técnico usa Claude Code o tu entorno de desarrollo.',
  rate_limited: 'Has alcanzado temporalmente el límite de uso del asistente. Espera un momento y vuelve a intentarlo.',
} as const

export type GuardReason = keyof typeof ASSISTANT_BLOCK_MESSAGES
export type GuardResult = { ok: true } | { ok: false; reason: GuardReason; message: string }

// Patrones de "prompt para otro modelo" / instrucción técnica (orientativos, case-insensitive).
const MEGAPROMPT_PATTERNS: RegExp[] = [
  /\beres un\b/i, /\bact[uú]a como\b/i, /system\s*prompt/i, /developer\s*message/i,
  /ignora (las |tus )?instrucciones/i, /prompt maestro/i, /pega esto a (claude|chatgpt|gpt)/i,
  /\bfase\s+p?\d/i, /no toques(\s+sin)?/i, /\bclaude code\b/i, /veredicto esperado/i,
  /npm run (build|lint)|tsc --noEmit/i, /modo desarrollador/i,
]
// Cabeceras de "plan/entrega" que delatan un megaprompt pegado.
const SECTION_HEADERS = /^\s*(objetivo|entrega|validaciones?|contexto|reglas?|tareas?|diagn[oó]stico|veredicto)\s*:/im

// Mensajes CRM normales son cortos; no bloqueamos por debajo de este umbral.
const MIN_LEN_TO_INSPECT = 320

export function looksLikeMegaprompt(text: string): boolean {
  const t = text || ''
  if (t.length < MIN_LEN_TO_INSPECT) return false
  let hits = 0
  for (const re of MEGAPROMPT_PATTERNS) if (re.test(t)) hits++
  if (SECTION_HEADERS.test(t)) hits++
  const lines = t.split(/\r?\n/)
  const bulletLines = lines.filter((l) => /^\s*[-*•]/.test(l) || /^\s*\d+[.)]\s/.test(l)).length
  const headerLines = lines.filter((l) => /^[0-9A-ZÁÉÍÓÚÑ][0-9A-ZÁÉÍÓÚÑ ()\/.,&:-]{8,}:?\s*$/.test(l)).length
  const hasCodeOrJson = /```|\{\s*"\w+"\s*:|=>|function\s+\w+\s*\(|\$json|webhook|inputSchema/i.test(t)
  if (hits >= 2) return true
  if (t.length > 1200 && (bulletLines >= 8 || headerLines >= 3)) return true
  if (hasCodeOrJson && t.length > 800) return true
  return false
}

// Validación de entrada. `hard: true` en backend (límite absoluto); sin él, límite normal de UI.
export function checkAssistantInput(text: string, opts?: { hard?: boolean }): GuardResult {
  const limit = opts?.hard ? ASSISTANT_LIMITS.hardMaxInputChars : ASSISTANT_LIMITS.maxInputChars
  if ((text?.length ?? 0) > limit) return { ok: false, reason: 'too_long', message: ASSISTANT_BLOCK_MESSAGES.too_long }
  if (looksLikeMegaprompt(text)) return { ok: false, reason: 'megaprompt', message: ASSISTANT_BLOCK_MESSAGES.megaprompt }
  return { ok: true }
}

// Trunca el historial que se manda al agente: pocos mensajes y recortados (control de tokens).
// Además omite mensajes que ya fueron bloqueados o son gigantes (no reenviar basura cara).
export function truncateHistory<T extends { role: string; content: string }>(messages: T[]): Array<{ role: string; content: string }> {
  return messages
    .filter((m) => (m.content || '').length <= ASSISTANT_LIMITS.hardMaxInputChars * 2)
    .slice(-ASSISTANT_LIMITS.maxHistoryMessages)
    .map((m) => ({ role: m.role, content: (m.content || '').slice(0, ASSISTANT_LIMITS.maxHistoryCharsPerMessage) }))
}

// ─────────────────────────────────────────────────────────── Protección ante crisis humana (P18)
// Detección de ALTO RIESGO explícito (intención de suicidio / autolesión). Prioriza la seguridad de la
// persona por encima del CRM: cuando dispara, se responde con un protocolo humano y breve SIN llamar al
// agente (no gasta tokens, no almacena el contenido sensible). NO se activa con tristeza/cansancio
// normales: requiere intención explícita. Alta precisión, sesgada a seguridad ante la duda real.
const CRISIS_PATTERNS: RegExp[] = [
  /\bsuicid/i, // suicidio, suicidarme, suicidarse, suicide
  /\bquitar(me|se)?\s+la\s+vida\b/i,
  /\bacabar\s+con\s+mi\s+vida\b/i,
  /\b(no\s+quiero|ya\s+no\s+quiero)\s+(seguir\s+)?vivir\b/i,
  /\bno\s+quiero\s+seguir\s+viviendo\b/i,
  /\b(voy\s+a|quiero|pienso)\s+matarme\b/i,
  /\b(me\s+quiero|quiero|voy\s+a|pienso)\s+hacer(me)?\s+daño\b/i,
  /\bautolesion/i,
  /\bmejor\s+(estar[ií]a\s+)?muerto\b/i,
  /\bno\s+merece\s+la\s+pena\s+(seguir\s+)?(vivir|viviendo)\b/i,
  // inglés
  /\bkill\s+myself\b/i, /\bi\s+want\s+to\s+die\b/i, /\bself.?harm\b/i, /\bend\s+my\s+life\b/i,
]

export function detectCrisis(text: string): boolean {
  const t = text || ''
  if (!t) return false
  return CRISIS_PATTERNS.some((re) => re.test(t))
}

// Respuesta de seguridad (España): humana, breve, prioritaria. Menciona 024 y 112, anima a contactar
// con alguien de confianza y a no quedarse solo/a. No reconduce al CRM, sin tono legalista.
export const CRISIS_RESPONSE =
  'Siento mucho que estés pasando por esto, y me importa de verdad. Ahora mismo lo más importante eres tú, mucho más que cualquier cosa del CRM. Si sientes que puedes hacerte daño, por favor pide ayuda ya: en España puedes llamar al 024 (línea de atención a la conducta suicida, gratuita y 24 h) o al 112 si es una emergencia. No te quedes solo/a: contacta cuanto antes con alguien de confianza y, si puedes, aléjate de cualquier cosa con la que puedas hacerte daño. No estás solo/a en esto.'

// Rate limiter best-effort en memoria (ventana deslizante por clave usuario:workspace). En serverless
// el estado no persiste entre instancias frías; es una primera barrera barata, no una cuota estricta.
const HITS = new Map<string, number[]>()
export function checkRateLimit(key: string, perMinute = ASSISTANT_LIMITS.ratePerMinute): boolean {
  const now = Date.now()
  const windowStart = now - 60_000
  const arr = (HITS.get(key) ?? []).filter((t) => t > windowStart)
  if (arr.length >= perMinute) { HITS.set(key, arr); return false }
  arr.push(now)
  HITS.set(key, arr)
  if (HITS.size > 5000) HITS.clear() // poda de seguridad
  return true
}
