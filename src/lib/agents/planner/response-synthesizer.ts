// PROTOTIPO AISLADO (general-semantic-planner) — RESPONSE SYNTHESIZER (FASE 9).
// SEPARADO del planner. Convierte EVIDENCE (hechos reales de los readers) + plan validado en una respuesta
// natural. Reglas duras: los hechos SOLO salen de evidence; nunca inventa; nunca da falso éxito; respeta
// EMPTY/PARTIAL/errores; combina multi-goal de forma coherente; oculta ids internos. Si la evidence
// contradice el plan, GANA la evidence.

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

import type { ValidatedPlan } from './plan-contract'
import type { Evidence } from './capability-executor'

const SYNTH_SYSTEM = `Eres el REDACTOR de un asistente de CRM inmobiliario. Recibes (a) el mensaje del usuario, (b) un plan interpretado y (c) EVIDENCE: los datos REALES ya obtenidos por el sistema. Tu tarea es redactar UNA respuesta natural en español, cercana y clara.

REGLAS ABSOLUTAS:
- Usa ÚNICAMENTE hechos presentes en EVIDENCE. Está PROHIBIDO inventar números, nombres o datos que no estén.
- Si un goal tiene status EMPTY: dilo con naturalidad ("no tienes ninguna…"), no lo conviertas en error.
- Si status NOT_FOUND: di que no encontraste ESA entidad; no ofrezcas datos de otra ni una lista global.
- Si status AMBIGUOUS: pide que elija entre las opciones dadas en EVIDENCE (no elijas tú).
- Si status FORBIDDEN/UNAVAILABLE/POLICY_BLOCK: explica con honestidad la limitación; nunca finjas acceso.
- Si hay VARIOS goals con éxito: responde a TODOS, en orden, de forma cohesionada (no elijas uno solo).
- Nunca muestres ids técnicos (UUID). Usa nombres/títulos.
- Para acciones (actionPreview): NO afirmes que se ha hecho; es una PROPUESTA. Describe qué harías y pide confirmación. Si ready=false, di qué falta.
- No añadas datos "de relleno". Sé conciso y veraz.`

export type SynthResult = { ok: true; text: string; ms: number } | { ok: false; error: string; ms: number }

// Proyección compacta y SIN ids de la evidence para el prompt (evita fugas de UUID y ahorra tokens).
function evidenceForPrompt(evidences: Evidence[]): unknown {
  return evidences.map((e) => ({
    capability: e.capability,
    status: e.status,
    count: e.count,
    entity: e.resolvedEntity ? e.resolvedEntity.label : undefined,
    message: e.message,
    actionPreview: e.actionPreview ? { action: e.actionPreview.actionId, target: e.actionPreview.entity?.label ?? null, changes: e.actionPreview.changes, ready: e.actionPreview.ready, missing: e.actionPreview.missingSlots } : undefined,
    data: stripIds(e.data),
  }))
}
function stripIds(v: unknown, depth = 0): unknown {
  if (depth > 4) return undefined
  if (Array.isArray(v)) return v.slice(0, 12).map((x) => stripIds(x, depth + 1))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/(^id$|_id$|workspace|metadata|deleted_at)/i.test(k)) continue
      out[k] = stripIds(val, depth + 1)
    }
    return out
  }
  if (typeof v === 'string') return v.slice(0, 300)
  return v
}

export async function synthesize(
  userTurn: string, plan: ValidatedPlan, evidences: Evidence[], opts: { apiKey: string; model?: string },
): Promise<SynthResult> {
  const t0 = Date.now()
  const payload = { userMessage: userTurn, speechAct: plan.speechAct, clarification: plan.clarificationQuestion, evidence: evidenceForPrompt(evidences) }
  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model ?? 'gpt-4.1-mini', temperature: 0.3,
        messages: [{ role: 'system', content: SYNTH_SYSTEM }, { role: 'user', content: JSON.stringify(payload) }],
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) { return { ok: false, error: `fetch_error:${(e as Error).message.slice(0, 60)}`, ms: Date.now() - t0 } }
  if (!res.ok) return { ok: false, error: `http_${res.status}`, ms: Date.now() - t0 }
  const j = await res.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null
  const text = j?.choices?.[0]?.message?.content?.trim()
  if (!text) return { ok: false, error: 'empty_completion', ms: Date.now() - t0 }
  return { ok: true, text, ms: Date.now() - t0 }
}
