// Integración SHADOW/ON del General Semantic Planner con la route activa (FASE 1-3).
// SEGURIDAD: todo aquí es NO-OP salvo que GENERAL_SEMANTIC_PLANNER esté en shadow|on. En OFF (default de
// producción) la route ni importa el comportamiento de este módulo. El planner NUNCA escribe (dry-run) y
// en SHADOW NUNCA altera la respuesta ni el estado autoritativo de P71: solo observa y registra atribución.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { StateUpdate } from '../conversation-state'
import { runTurn, PLANNER_UNAVAILABLE_MSG } from './planner-pipeline'
import { discourseFromConversationState, plannerStateUpdateFromTurn } from './conversation-state-bridge'
import { plannerMode, type PlannerMode } from './planner-flag'

export { plannerMode, type PlannerMode }

function apiKey(): string | null { return process.env.OPENAI_API_KEY || null }
function plannerModelName(): string { return process.env.PLANNER_MODEL || process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini' }
// Modelo ALTERNATIVO de config para resiliencia INFRA (FASE 9). Lo fija el operador, jamás el LLM.
function plannerFallbackModelName(): string | null { return process.env.PLANNER_FALLBACK_MODEL?.trim() || null }

export type ShadowObservation = {
  assistantArchitecture: 'GENERAL_PLANNER'
  featureFlagState: PlannerMode
  plannerModel: string
  speechAct: string
  goalCount: number
  capabilities: string[]
  statuses: string[]
  cycles: number
  latencyMs: number
  error?: string
}

// SHADOW: ejecuta el planner en PARALELO lógico (solo lecturas + acciones dry-run), NO sintetiza respuesta
// (barato) y devuelve una observación estructurada para el log de comparación. Fail-soft: nunca lanza.
export async function plannerShadowObserve(args: {
  supabase: SupabaseClient; workspaceId: string; message: string; convState: unknown; selectionSeed?: number | null
}): Promise<ShadowObservation | null> {
  const key = apiKey()
  if (!key) return null
  const model = plannerModelName()
  try {
    const r = await runTurn({ supabase: args.supabase, workspaceId: args.workspaceId, message: args.message, discourse: discourseFromConversationState(args.convState), apiKey: key, plannerModel: model, synth: false, selectionSeed: args.selectionSeed ?? null })
    const o = r.observability as Record<string, unknown>
    const lat = (o.latencyMs as { total?: number } | undefined)?.total ?? 0
    return { assistantArchitecture: 'GENERAL_PLANNER', featureFlagState: plannerMode(), plannerModel: model, speechAct: String(o.speechAct ?? ''), goalCount: Number(o.goalCount ?? 0), capabilities: (o.capabilities as string[]) ?? [], statuses: (o.statuses as string[]) ?? [], cycles: Number(o.cycles ?? 1), latencyMs: lat }
  } catch (e) {
    return { assistantArchitecture: 'GENERAL_PLANNER', featureFlagState: plannerMode(), plannerModel: model, speechAct: 'error', goalCount: 0, capabilities: [], statuses: [], cycles: 0, latencyMs: 0, error: (e as Error).message.slice(0, 80) }
  }
}

// ON: el planner es el cerebro para lenguaje humano abierto. Sintetiza respuesta. Sigue sin escribir
// (acciones dry-run/preview) en el prototipo; las escrituras reales seguirían el plano de acción P65.
//
// FASE 9 — SIN FALLBACK SEMÁNTICO SILENCIOSO A P71: esta función NUNCA lanza y solo devuelve null si el
// planner NO ESTÁ CONFIGURADO (falta OPENAI_API_KEY; estado equivalente a OFF que la route registra
// explícitamente). Cualquier fallo de RUNTIME (timeout, modelo caído, JSON inválido, bug) produce una
// respuesta VERAZ de indisponibilidad con atribución GENERAL_PLANNER — jamás cae al parser legacy.
export type PlannerAnswer = { answer: string; observability: Record<string, unknown>; referencedList: unknown; stateUpdate?: StateUpdate; degraded?: boolean }
export async function plannerAnswer(args: {
  supabase: SupabaseClient; workspaceId: string; message: string; convState: unknown; turnId?: string; selectionSeed?: number | null
}): Promise<PlannerAnswer | null> {
  const key = apiKey()
  if (!key) return null   // ÚNICO caso null: planner no configurado (la route lo registra como tal)
  const model = plannerModelName()
  try {
    const r = await runTurn({ supabase: args.supabase, workspaceId: args.workspaceId, message: args.message, discourse: discourseFromConversationState(args.convState), apiKey: key, plannerModel: model, plannerFallbackModel: plannerFallbackModelName(), synth: true, selectionSeed: args.selectionSeed ?? null })
    // Lista referenciada (para ordinales/seguimientos) desde la última evidencia de lista, sin ids sensibles.
    const listEv = r.trace.evidences.find((e) => Array.isArray(e.data) && (e.data as unknown[]).length > 0)
    const referencedList = listEv && Array.isArray(listEv.data) ? (listEv.data as Array<Record<string, unknown>>).slice(0, 20).map((x) => ({ label: String(x.name ?? x.title ?? '') })).filter((x) => x.label) : null
    const o = r.observability as Record<string, unknown>
    const answer = r.answer && r.answer.trim() ? r.answer : PLANNER_UNAVAILABLE_MSG
    const stateUpdate = plannerStateUpdateFromTurn({ discourse: r.discourse, plan: r.trace.plan, evidences: r.trace.evidences, turnId: args.turnId ?? `planner-${Date.now()}` })
    return { answer, observability: o, referencedList, stateUpdate, degraded: Boolean(o.plannerUnavailable) || !r.answer?.trim() }
  } catch (e) {
    return {
      answer: PLANNER_UNAVAILABLE_MSG,
      observability: { assistantArchitecture: 'GENERAL_PLANNER', featureFlagState: plannerMode(), plannerModel: 'unavailable', error: (e as Error).message.slice(0, 80) },
      referencedList: null,
      degraded: true,
    }
  }
}
