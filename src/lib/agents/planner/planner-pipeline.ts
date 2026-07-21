// PROTOTIPO AISLADO (general-semantic-planner) — PIPELINE (FASE 7, tool loop controlado).
// Orquesta: PLAN → VALIDATE → EXECUTE → OBSERVE → (REPLAN acotado) → SYNTHESIZE. Máx. de ciclos duro.
// El replan recibe el plan previo + evidence + errores estructurados; puede refinar, NUNCA cambiar
// workspace, saltarse policy, inventar tool ni ejecutar acción (todo eso lo garantiza el contrato+executor).
// NO cableado a la route. El workspace lo fija el llamante.

import type { SupabaseClient } from '@supabase/supabase-js'
import { planTurn } from './semantic-planner'
import { validatePlan, type ValidatedPlan } from './plan-contract'
import { executePlan, type Evidence } from './capability-executor'
import { synthesize } from './response-synthesizer'
import { checkConsistency, type Inconsistency } from './consistency-checker'
import { advanceDiscourse, toDiscourseRef, plannerView, type RichDiscourse } from './discourse-state'
import { plannerMode } from './planner-flag'

export type TurnTrace = {
  plan: ValidatedPlan
  evidences: Evidence[]
  inconsistencies: Inconsistency[]
  cycles: number
  planMs: number
  execMs: number
  synthMs: number
}
export type TurnResult = {
  answer: string
  discourse: RichDiscourse
  trace: TurnTrace
  observability: Record<string, unknown>   // FASE 27: log estructurado sin PII
}

const MAX_CYCLES = 3

// Mensaje VERAZ de indisponibilidad de infraestructura. NUNCA se disfraza un fallo técnico de "no te he
// entendido" (eso es una aclaración semántica) ni se enruta en silencio al parser legacy P71 (FASE 9).
export const PLANNER_UNAVAILABLE_MSG = 'Ahora mismo no puedo analizar tu petición (el servicio de interpretación no responde). No he perdido tu conversación: vuelve a intentarlo en unos segundos.'

export async function runTurn(args: {
  supabase: SupabaseClient
  workspaceId: string
  message: string
  discourse: RichDiscourse
  apiKey: string
  plannerModel?: string
  plannerFallbackModel?: string | null   // modelo ALTERNATIVO validado por config (no elegido por el LLM)
  synthModel?: string
  synth?: boolean            // si false, no llama al redactor (eval estructural barata)
  selectionSeed?: number | null   // para tests deterministas de selección RANDOM
}): Promise<TurnResult> {
  const { supabase, workspaceId, message, discourse } = args
  const ref = toDiscourseRef(discourse)
  const pview = plannerView(discourse)

  // ── PLAN ── (el planner ve una PROYECCIÓN del discurso sin ids internos: solo referencias lingüísticas)
  // Resiliencia INFRA acotada (FASE 9): fallo técnico (fetch/timeout/JSON/HTTP) → 1 reintento con el mismo
  // modelo → 1 intento con el modelo alternativo de config si existe. Máx. 3 llamadas; nunca P71 silencioso.
  let p = await planTurn(message, pview, { apiKey: args.apiKey, model: args.plannerModel })
  let planInfraRetries = 0
  if (!p.ok) {
    planInfraRetries++
    p = await planTurn(message, pview, { apiKey: args.apiKey, model: args.plannerModel })
  }
  if (!p.ok && args.plannerFallbackModel && args.plannerFallbackModel !== args.plannerModel) {
    planInfraRetries++
    p = await planTurn(message, pview, { apiKey: args.apiKey, model: args.plannerFallbackModel })
  }
  let planMs = p.ok ? p.ms : 0
  let plan: ValidatedPlan = p.ok
    ? validatePlan(p.plan)
    : { version: 1, speechAct: 'unknown', goals: [], needsClarification: true, clarificationQuestion: PLANNER_UNAVAILABLE_MSG, proposedStateUpdates: { activeModule: null, offeredCapabilities: [] }, rejected: [{ capability: '(planner)', reason: p.error }] }

  // ── REPLAN SEMÁNTICO acotado (máx. 1): el modelo QUISO actuar pero TODOS sus goals cayeron en la
  // validación (p. ej. capability inexistente por id casi-correcto). Mecanismo general, no por frase: se
  // replanifica UNA vez con el motivo estructurado del rechazo; validatePlan vuelve a mandar sobre el
  // resultado. Nunca amplía permisos (misma ontología, mismo contrato) y el coste está acotado (1 llamada).
  let planAttempts = 1
  if (p.ok && plan.goals.length === 0 && !plan.needsClarification && plan.rejected.length > 0) {
    const motivos = plan.rejected.map((r) => `«${r.capability}» → ${r.reason}`).join('; ')
    const p2 = await planTurn(message, pview, {
      apiKey: args.apiKey, model: args.plannerModel,
      feedback: `Goals rechazados por el validador: ${motivos}. Elige SOLO ids EXACTOS presentes en la ontología dada y no repitas el motivo del rechazo.`,
    })
    planAttempts = 2
    if (p2.ok) {
      const v2 = validatePlan(p2.plan)
      planMs += p2.ms
      // Se adopta el replan solo si mejora (produce goals o pide aclaración específica); si no, se conserva
      // el plan original con sus rejected trazables.
      if (v2.goals.length > 0 || v2.needsClarification) plan = { ...v2, rejected: [...plan.rejected, ...v2.rejected] }
    }
  }

  // ── FUSIÓN DE ACCIÓN EN CURSO (slot-accumulation, FASE 53) ── si hay pendingAction y el plan trae un
  // goal de la MISMA acción, se fusionan los slots ya acumulados (los NUEVOS mandan: permiten corregir) y
  // se hereda la entidad ya resuelta si el goal no trae otra referencia. El usuario no repite lo ya dicho.
  const pending = discourse.pendingAction
  if (pending && plan.goals.some((g) => g.capability === pending.capability)) {
    plan = {
      ...plan,
      goals: plan.goals.map((g) => g.capability === pending.capability
        ? { ...g, filters: { ...pending.slots, ...g.filters }, entityRef: g.entityRef ?? pending.entity?.label ?? null }
        : g),
    }
  }

  // ── EXECUTE ──
  let exec = await executePlan(supabase, workspaceId, plan, ref, { selectionSeed: args.selectionSeed })
  let evidences = exec.evidences
  let inconsistencies = checkConsistency(evidences)
  let cycles = 1
  let execMs = exec.ms

  // ── OBSERVE → REPLAN acotado: solo ante fallo transitorio (INTERNAL_ERROR/TIMEOUT) o inconsistencia
  // retryable. No se replanifica por gusto (coste). El replan re-ejecuta el MISMO plan validado (re-read),
  // que es el remedio correcto para errores transitorios y referencias stale. Nunca amplía permisos.
  while (cycles < MAX_CYCLES && (evidences.some((e) => e.status === 'INTERNAL_ERROR' || e.status === 'TIMEOUT') || inconsistencies.some((i) => i.retryable))) {
    exec = await executePlan(supabase, workspaceId, plan, ref, { selectionSeed: args.selectionSeed })
    evidences = exec.evidences
    inconsistencies = checkConsistency(evidences)
    execMs += exec.ms
    cycles++
  }

  // ── SYNTHESIZE ──
  let answer = ''
  let synthMs = 0
  if (args.synth !== false) {
    const s = await synthesize(message, plan, evidences, { apiKey: args.apiKey, model: args.synthModel ?? args.plannerModel })
    synthMs = s.ok ? s.ms : 0
    answer = s.ok ? s.text : (plan.clarificationQuestion ?? 'Ahora mismo no puedo completar esa consulta.')
  }

  const nextDiscourse = advanceDiscourse(discourse, plan, evidences)
  const trace: TurnTrace = { plan, evidences, inconsistencies, cycles, planMs, execMs, synthMs }
  const observability = {
    assistantArchitecture: 'GENERAL_PLANNER' as const,   // FASE 1: nunca atribuir a P71 lo que respondió el planner
    featureFlagState: plannerMode(),
    plannerModel: p.ok ? (p.plan.rawModel ?? args.plannerModel) : 'unavailable',
    speechAct: plan.speechAct,
    goalCount: plan.goals.length,
    capabilities: plan.goals.map((g) => g.capability),
    rejected: plan.rejected,
    planAttempts,
    planInfraRetries,
    plannerUnavailable: !p.ok,
    statuses: evidences.map((e) => e.status),
    entityResolution: evidences.filter((e) => e.resolvedEntity).map((e) => ({ cap: e.capability, label: e.resolvedEntity?.label })),
    inconsistencies: inconsistencies.map((i) => i.kind),
    cycles,
    latencyMs: { plan: planMs, exec: execMs, synth: synthMs, total: planMs + execMs + synthMs },
  }
  return { answer, discourse: nextDiscourse, trace, observability }
}
