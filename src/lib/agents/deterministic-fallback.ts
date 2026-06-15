// Deterministic safety net for the NowLabs AI assistant.
//
// Fires only on strict triggers (verb + entity). Never invents a client name,
// an amount or a date. Returns a PreparedActionDraft compatible with both the
// chat UI card and `/api/assistant/confirm`.
//
// Engage rules live in /api/assistant/v2: this module is invoked when the
// primary agent (runNowLabsAgent) returns without a `preparedAction` — either
// because OpenAI failed or because the agent answered conversationally for a
// message that clearly asks for an action. Never overrides a preparedAction
// produced by OpenAI.

import type { PreparedActionDraft } from '@/lib/agents/nowlabs-main-agent'

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

// Extracts an ISO date from the user's message. Supports:
//   - YYYY-MM-DD (validated, e.g. 2026-02-31 rejected)
//   - DD/MM and DD/MM/YYYY (DD/MM/YY also accepted, expanded to 20YY)
//   - "hoy", "manana", "pasado manana"
//   - day-of-week (next occurrence; "lunes" said on a Monday → +7)
// Returns undefined when no recognisable date is present.
export function extractDateIso(message: string): string | undefined {
  const raw = message
  const t = normalize(message)

  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (iso && isValidIsoDate(iso[1])) return iso[1]

  const short = raw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (short) {
    const day = Number(short[1])
    const month = Number(short[2])
    const yearRaw = short[3]
    const year = yearRaw
      ? (yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw))
      : new Date().getFullYear()
    const candidate = `${year}-${pad2(month)}-${pad2(day)}`
    if (isValidIsoDate(candidate)) return candidate
  }

  const today = new Date()
  if (/\bpasado\s+manana\b/.test(t)) {
    const d = new Date(today); d.setDate(today.getDate() + 2); return toIso(d)
  }
  if (/\bmanana\b/.test(t)) {
    const d = new Date(today); d.setDate(today.getDate() + 1); return toIso(d)
  }
  if (/\bhoy\b/.test(t)) return toIso(today)

  const weekdays = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  for (let i = 0; i < weekdays.length; i++) {
    if (new RegExp(`\\b${weekdays[i]}\\b`).test(t)) {
      const d = new Date(today)
      let delta = (i - today.getDay() + 7) % 7
      if (delta === 0) delta = 7
      d.setDate(today.getDate() + delta)
      return toIso(d)
    }
  }

  return undefined
}

// Extracts HH:MM in 24h. Accepts "a las 10", "a las 10:30", "10:30", "10.30",
// "a las 10h", "a las 10h30". Out-of-range values are rejected silently.
export function extractTimeHhmm(message: string): string | undefined {
  const t = normalize(message)
  const m1 = t.match(/\ba\s+las\s+(\d{1,2})(?::|\.|h)?(\d{2})?\b/)
  if (m1) {
    const hour = Number(m1[1])
    const minute = m1[2] ? Number(m1[2]) : 0
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return `${pad2(hour)}:${pad2(minute)}`
  }
  const m2 = t.match(/\b(\d{1,2})[:.](\d{2})\b/)
  if (m2) {
    const hour = Number(m2[1])
    const minute = Number(m2[2])
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return `${pad2(hour)}:${pad2(minute)}`
  }
  return undefined
}

function extractAmount(message: string): number | undefined {
  const m = message.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euros)/i)
  if (!m) return undefined
  const value = Number(m[1].replace(',', '.'))
  return value > 0 ? value : undefined
}

function extractConcept(message: string): string | undefined {
  const m = message.match(/\bpor\s+([^.,;\n]+?)(?:\s+(?:para|el|antes|despu[eé]s|que|vence|el\s+d[ií]a|ma[ñn]ana)\b|$)/i)
  if (!m) return undefined
  const cleaned = m[1].trim()
  if (cleaned.length < 3 || cleaned.length > 80) return undefined
  return cleaned
}

const NAME_STOP = /^(la|las|el|los|un|una|hoy|ayer|manana|pasado|proximo|lunes|martes|miercoles|jueves|viernes|sabado|domingo|revisar|llamar|hacer|preparar|enviar|cliente|documentacion|cita|tarea|factura|reunion)$/

function isStopWord(candidate: string): boolean {
  const first = normalize(candidate).split(/\s+/)[0]
  return NAME_STOP.test(first)
}

// Client name extraction is intentionally conservative: only matches when the
// captured name starts with an uppercase letter. We'd rather miss a client
// than invent one — confirm route handles tasks without a client cleanly.
function extractClientName(message: string): string | undefined {
  const m1 = message.match(/\bal\s+cliente\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ'-]+){0,2})\b/)
  if (m1 && !isStopWord(m1[1])) return m1[1].trim()
  const m2 = message.match(/\b(?:con|para|a)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ'-]+){0,2})\b/)
  if (m2 && !isStopWord(m2[1])) return m2[1].trim()
  return undefined
}

// Strips date/weekday/ISO noise so what remains can serve as a clean title.
function stripDateNoise(text: string): string {
  return text
    .replace(/\bpara\s+(?:el\s+(?:d[ií]a\s+)?)?(ma[ñn]ana|pasado\s+ma[ñn]ana|hoy|lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo)\b/gi, '')
    .replace(/\b(ma[ñn]ana|pasado\s+ma[ñn]ana|hoy)\b/gi, '')
    .replace(/\b(el\s+(?:d[ií]a\s+)?)?\d{4}-\d{2}-\d{2}\b/gi, '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:,.\-]+|[\s:,.\-]+$/g, '')
    .trim()
}

function extractTaskTitle(message: string): string | undefined {
  const raw = message.trim()

  // Strongest signal: explicit ":" after the trigger phrase.
  const colon = raw.match(/^(?:crea(?:r|me|nos)?|añade(?:me)?|anade(?:me)?|recu[eé]rdame|prepara(?:r|me)?|haz(?:me)?)\b[^:]*?:\s*(.+)$/i)
  if (colon) {
    const t = stripDateNoise(colon[1])
    if (t.length >= 3) return t.slice(0, 200)
  }

  const after = raw.match(/(?:crea(?:r|me|nos)?|añade(?:me)?|anade(?:me)?)\s+(?:una\s+)?tarea(?:\s+(?:para|de)\s+)?(.*)$/i)
  if (after) {
    const t = stripDateNoise(after[1])
    if (t.length >= 3) return t.slice(0, 200)
  }

  const rec = raw.match(/recu[eé]rdame\s+(?:que\s+)?(.+)$/i)
  if (rec) {
    const t = stripDateNoise(rec[1])
    if (t.length >= 3) return t.slice(0, 200)
  }

  return undefined
}

// Strict triggers. Avoid `.*` wildcards between verb and entity so we don't
// catch unrelated invoice text that happens to contain "cita", and so on.
const TASK_TRIGGER = /\b(?:crea(?:r|me|nos)?|añade(?:me)?|anade(?:me)?)\s+(?:una\s+)?tarea\b/i
const TASK_REC_TRIGGER = /\brecu[eé]rdame\b/i
const BOOKING_TRIGGER = /\b(?:prepara(?:r|me)?|crea(?:r|me)?|agenda(?:r|me)?|reserva(?:r|me)?|pon(?:me)?|programa(?:r|me)?)\s+(?:una\s+)?(?:cita|reunion|reunión)\b/i
const INVOICE_TRIGGER = /\b(?:crea(?:r|me)?|prepara(?:r|me)?|hazme)\s+(?:una\s+)?factura\b/i
// RT5.1b — creación conversacional de operaciones / expedientes. El cliente se
// resuelve canónicamente en /api/assistant/confirm (por nombre; candidatos si
// hay ambigüedad). Aquí nunca se inventa cliente ni id.
const OPERATION_TRIGGER = /\b(?:crea(?:r|me)?|abre(?:me)?|registra(?:r|me)?)\s+(?:una\s+)?operaci[oó]n\b/i
const CASE_TRIGGER = /\b(?:abre(?:me)?|crea(?:r|me)?|a[ñn]ade(?:me)?)\s+(?:un\s+)?(?:expediente|caso)\b/i

function extractOperationTitle(message: string): string {
  const t = normalize(message)
  if (/\bventa\b/.test(t)) return 'Operación de venta'
  if (/\balquiler\b/.test(t)) return 'Operación de alquiler'
  if (/\bcompra\b/.test(t)) return 'Operación de compra'
  return 'Nueva operación'
}

function extractOperationValue(message: string): number | undefined {
  const euros = extractAmount(message)
  if (euros) return euros
  const m = message.match(/\bpor\s+(\d[\d.]*(?:,\d+)?)\b/)
  if (m) {
    const value = Number(m[1].replace(/\./g, '').replace(',', '.'))
    if (value > 0) return value
  }
  return undefined
}

function extractProbability(message: string): number | undefined {
  const m = message.match(/\b(\d{1,3})\s*%/)
  if (!m) return undefined
  const value = Number(m[1])
  return value >= 0 && value <= 100 ? value : undefined
}

function extractCaseTitle(message: string): string {
  const m = message.match(/\b(?:expediente|caso)\s+(?:de\s+)?([^.,;\n]+?)(?:\s+(?:para|del?|al)\s+[A-ZÁÉÍÓÚÑ]|$)/i)
  if (m) {
    const cleaned = stripDateNoise(m[1]).trim()
    if (cleaned.length >= 3 && cleaned.length <= 80 && !isStopWord(cleaned)) {
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    }
  }
  return 'Expediente'
}

export type DeterministicOutcome = {
  preparedAction: PreparedActionDraft
  answer: string
}

export function detectDeterministicAction(message: string): DeterministicOutcome | null {
  if (!message || typeof message !== 'string') return null
  const raw = message.trim()
  if (raw.length < 3) return null

  if (TASK_TRIGGER.test(raw) || TASK_REC_TRIGGER.test(raw)) {
    const taskTitle = extractTaskTitle(raw)
    const dueDate = extractDateIso(raw)
    const clientName = extractClientName(raw)
    // Tasks don't structurally require a client — confirm route inserts
    // tasks with client_id/client_name=null when none is provided. Title is
    // the only mandatory field; the rest is optional context.
    const missingFields = !taskTitle ? ['título'] : []
    const action: PreparedActionDraft = {
      type: 'task',
      clientName,
      taskTitle,
      dueDate,
      missingFields,
    }
    const answer = missingFields.length
      ? `Tengo la tarea casi lista pero me falta ${missingFields.join(' y ')}. Dímelo y la dejo preparada.`
      : `Tarea preparada: ${taskTitle}${dueDate ? ` (vence ${dueDate})` : ''}${clientName ? ` para ${clientName}` : ''}. Revísala y pulsa Confirmar.`
    return { preparedAction: action, answer }
  }

  if (BOOKING_TRIGGER.test(raw)) {
    const clientName = extractClientName(raw)
    const date = extractDateIso(raw)
    const time = extractTimeHhmm(raw)
    const missingFields = [
      !clientName && 'cliente',
      !date && 'fecha',
      !time && 'hora',
    ].filter(Boolean) as string[]
    const action: PreparedActionDraft = {
      type: 'booking',
      clientName,
      date,
      time,
      duration: 60,
      missingFields,
    }
    const answer = missingFields.length
      ? `Cita casi lista — falta ${missingFields.join(', ')}. Dímelos y la preparo para confirmar.`
      : `Cita preparada con ${clientName} el ${date} a las ${time}. Revísala y confirma.`
    return { preparedAction: action, answer }
  }

  if (INVOICE_TRIGGER.test(raw)) {
    const clientName = extractClientName(raw)
    const amount = extractAmount(raw)
    const concept = extractConcept(raw)
    const dueDate = extractDateIso(raw)
    const missingFields = [
      !clientName && 'cliente',
      !amount && 'importe',
      !concept && 'concepto',
      !dueDate && 'vencimiento',
    ].filter(Boolean) as string[]
    const action: PreparedActionDraft = {
      type: 'invoice',
      clientName,
      amount,
      concept,
      dueDate,
      missingFields,
    }
    const answer = missingFields.length
      ? `Factura casi lista — falta ${missingFields.join(', ')}. Dímelos y la preparo para confirmar.`
      : `Factura preparada para ${clientName}: ${amount}€ por ${concept}, vence ${dueDate}. Confirma cuando quieras.`
    return { preparedAction: action, answer }
  }

  if (OPERATION_TRIGGER.test(raw)) {
    const clientName = extractClientName(raw)
    const title = extractOperationTitle(raw)
    const value = extractOperationValue(raw)
    const probability = extractProbability(raw)
    // El executor resuelve el cliente por nombre; si falta, lo pedimos.
    const missingFields = !clientName ? ['cliente'] : []
    const action: PreparedActionDraft = {
      type: 'create_operation',
      clientName,
      title,
      stage: 'new',
      value,
      probability,
      missingFields,
    }
    const answer = missingFields.length
      ? `Para crear la operación necesito el cliente. Dime para quién es y la dejo preparada.`
      : `Operación preparada: "${title}" para ${clientName}${value ? ` · ${value}€` : ''}${probability != null ? ` · ${probability}%` : ''}. Revísala y pulsa Confirmar.`
    return { preparedAction: action, answer }
  }

  if (CASE_TRIGGER.test(raw)) {
    const clientName = extractClientName(raw)
    const title = extractCaseTitle(raw)
    const priority = /\burgente\b/i.test(raw) ? 'high' : undefined
    const missingFields = !clientName ? ['cliente'] : []
    const action: PreparedActionDraft = {
      type: 'create_service_case',
      clientName,
      title,
      caseType: 'general',
      status: 'open',
      priority,
      missingFields,
    }
    const answer = missingFields.length
      ? `Para abrir el expediente necesito el cliente. Dime para quién es y lo dejo preparado.`
      : `Expediente preparado: "${title}" para ${clientName}${priority === 'high' ? ' · prioridad alta' : ''}. Revísalo y pulsa Confirmar.`
    return { preparedAction: action, answer }
  }

  return null
}
