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
import { advanceDiscourse, toDiscourseRef, type RichDiscourse } from './discourse-state'
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

export async function runTurn(args: {
  supabase: SupabaseClient
  workspaceId: string
  message: string
  discourse: RichDiscourse
  apiKey: string
  plannerModel?: string
  synthModel?: string
  synth?: boolean            // si false, no llama al redactor (eval estructural barata)
  selectionSeed?: number | null   // para tests deterministas de selección RANDOM
}): Promise<TurnResult> {
  const { supabase, workspaceId, message, discourse } = args
  const ref = toDiscourseRef(discourse)

  // ── PLAN ──
  const p = await planTurn(message, discourse, { apiKey: args.apiKey, model: args.plannerModel })
  const planMs = p.ok ? p.ms : 0
  let plan: ValidatedPlan = p.ok
    ? validatePlan(p.plan)
    : { version: 1, speechAct: 'unknown', goals: [], needsClarification: true, clarificationQuestion: 'No he podido interpretar tu mensaje; ¿puedes reformularlo?', proposedStateUpdates: { activeModule: null, offeredCapabilities: [] }, rejected: [{ capability: '(planner)', reason: p.ok ? '' : p.error }] }

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
    statuses: evidences.map((e) => e.status),
    entityResolution: evidences.filter((e) => e.resolvedEntity).map((e) => ({ cap: e.capability, label: e.resolvedEntity?.label })),
    inconsistencies: inconsistencies.map((i) => i.kind),
    cycles,
    latencyMs: { plan: planMs, exec: execMs, synth: synthMs, total: planMs + execMs + synthMs },
  }
  return { answer, discourse: nextDiscourse, trace, observability }
}
