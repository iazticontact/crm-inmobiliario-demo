// Integración SHADOW/ON del General Semantic Planner con la route activa (FASE 1-3).
// SEGURIDAD: todo aquí es NO-OP salvo que GENERAL_SEMANTIC_PLANNER esté en shadow|on. En OFF (default de
// producción) la route ni importa el comportamiento de este módulo. El planner NUNCA escribe (dry-run) y
// en SHADOW NUNCA altera la respuesta ni el estado autoritativo de P71: solo observa y registra atribución.

import type { SupabaseClient } from '@supabase/supabase-js'
import { runTurn } from './planner-pipeline'
import { emptyDiscourse, type RichDiscourse } from './discourse-state'
import { plannerMode, type PlannerMode } from './planner-flag'

export { plannerMode, type PlannerMode }

// Mapea el ConversationState de P71 (verdad conversacional actual) a un discurso para el planner. Best-effort
// y defensivo: si algo no encaja, discurso vacío (el planner sigue funcionando, solo sin contexto previo).
function discourseFromConvState(state: unknown): RichDiscourse {
  const d = emptyDiscourse() as RichDiscourse
  try {
    const s = state as Record<string, unknown>
    if (typeof s?.activeModule === 'string') d.activeModule = s.activeModule
    const ents = s?.activeEntities
    if (Array.isArray(ents)) d.activeEntities = ents.filter((e) => e && typeof e === 'object' && typeof (e as Record<string, unknown>).type === 'string' && typeof (e as Record<string, unknown>).label === 'string').slice(0, 4).map((e) => ({ type: String((e as Record<string, unknown>).type), label: String((e as Record<string, unknown>).label) }))
  } catch { /* discurso vacío */ }
  return d
}

function apiKey(): string | null { return process.env.OPENAI_API_KEY || null }
function plannerModelName(): string { return process.env.PLANNER_MODEL || process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini' }

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
    const r = await runTurn({ supabase: args.supabase, workspaceId: args.workspaceId, message: args.message, discourse: discourseFromConvState(args.convState), apiKey: key, plannerModel: model, synth: false, selectionSeed: args.selectionSeed ?? null })
    const o = r.observability as Record<string, unknown>
    const lat = (o.latencyMs as { total?: number } | undefined)?.total ?? 0
    return { assistantArchitecture: 'GENERAL_PLANNER', featureFlagState: plannerMode(), plannerModel: model, speechAct: String(o.speechAct ?? ''), goalCount: Number(o.goalCount ?? 0), capabilities: (o.capabilities as string[]) ?? [], statuses: (o.statuses as string[]) ?? [], cycles: Number(o.cycles ?? 1), latencyMs: lat }
  } catch (e) {
    return { assistantArchitecture: 'GENERAL_PLANNER', featureFlagState: plannerMode(), plannerModel: model, speechAct: 'error', goalCount: 0, capabilities: [], statuses: [], cycles: 0, latencyMs: 0, error: (e as Error).message.slice(0, 80) }
  }
}

// ON: el planner es el cerebro para lenguaje humano abierto. Sintetiza respuesta. Sigue sin escribir
// (acciones dry-run/preview) en el prototipo; las escrituras reales seguirían el plano de acción P65.
export type PlannerAnswer = { answer: string; observability: Record<string, unknown>; referencedList: unknown }
export async function plannerAnswer(args: {
  supabase: SupabaseClient; workspaceId: string; message: string; convState: unknown; selectionSeed?: number | null
}): Promise<PlannerAnswer | null> {
  const key = apiKey()
  if (!key) return null
  const model = plannerModelName()
  const r = await runTurn({ supabase: args.supabase, workspaceId: args.workspaceId, message: args.message, discourse: discourseFromConvState(args.convState), apiKey: key, plannerModel: model, synth: true, selectionSeed: args.selectionSeed ?? null })
  // Lista referenciada (para ordinales/seguimientos) desde la última evidencia de lista, sin ids sensibles.
  const listEv = r.trace.evidences.find((e) => Array.isArray(e.data) && (e.data as unknown[]).length > 0)
  const referencedList = listEv && Array.isArray(listEv.data) ? (listEv.data as Array<Record<string, unknown>>).slice(0, 20).map((x) => ({ label: String(x.name ?? x.title ?? '') })).filter((x) => x.label) : null
  return { answer: r.answer, observability: r.observability as Record<string, unknown>, referencedList }
}
