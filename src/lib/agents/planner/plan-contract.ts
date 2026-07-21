// PROTOTIPO AISLADO (general-semantic-planner) — CONTRATO DE PLAN + TAXONOMÍA DE ERROR.
// El planner LLM PROPONE un plan; ESTE módulo lo VALIDA server-side antes de que el executor lo toque.
// Regla central: el modelo interpreta, el código controla. Nada de lo que el modelo diga se ejecuta sin
// pasar por esta validación. NO cableado a la route ni a producción.

import { CAPABILITY_IDS, getCapability } from './capability-ontology'
import type { Plan, PlanGoal } from './semantic-planner'

export const PLAN_CONTRACT_VERSION = 1

// ── FASE 10 · Taxonomía de error ÚNICA ────────────────────────────────────────────────────────────────
// Un estado por goal. No colapsar todo en "problema de acceso". FORBIDDEN solo con evidencia REAL de
// permiso denegado; NOT_FOUND = no existe en el scope consultado; EMPTY = existe pero sin resultados.
export type GoalStatus =
  | 'SUCCESS' | 'EMPTY' | 'PARTIAL' | 'AMBIGUOUS' | 'NOT_FOUND'
  | 'FORBIDDEN' | 'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_INPUT'
  | 'CONFLICT' | 'POLICY_BLOCK' | 'INTERNAL_ERROR'

export const TERMINAL_ERROR_STATUSES: ReadonlySet<GoalStatus> = new Set<GoalStatus>([
  'FORBIDDEN', 'UNAVAILABLE', 'INVALID_INPUT', 'CONFLICT', 'POLICY_BLOCK', 'INTERNAL_ERROR',
])

// Mapea el error CRUDO de un reader (agent-tool-readers) a la taxonomía única. NUNCA inventa FORBIDDEN.
export function mapReaderError(code: string): GoalStatus {
  switch (code) {
    case 'not_found': return 'NOT_FOUND'
    case 'not_available': return 'UNAVAILABLE'
    case 'invalid_input': return 'INVALID_INPUT'
    case 'query_failed': return 'INTERNAL_ERROR'
    default: return 'INTERNAL_ERROR'
  }
}

// ── FASE 1 · Validación estricta del plan ───────────────────────────────────────────────────────────
export type ValidatedGoal = PlanGoal & { goalId: string; dependsOn: string[] }
export type ValidatedPlan = {
  version: number
  speechAct: Plan['speechAct']
  goals: ValidatedGoal[]
  needsClarification: boolean
  clarificationQuestion: string | null
  proposedStateUpdates: Plan['proposedStateUpdates']
  rejected: Array<{ capability: string; reason: string }>   // goals descartados por la validación (trazable)
  model?: string
}

const MAX_GOALS = 6                 // cota dura contra grafos gigantes (DoS del planner)
const MAX_FILTER_KEYS = 12
const MAX_STR = 200

// Campos que el modelo NUNCA puede introducir en un plan ejecutable. Si aparecen, el goal se rechaza
// entero (no se "limpia" en silencio): el modelo no decide identidad, permisos ni destino.
const FORBIDDEN_FILTER_KEYS = new Set([
  'workspace_id', 'workspaceid', 'sql', 'query_sql', 'table', 'tablename', 'url', 'endpoint',
  'permission', 'role', 'is_admin', 'service_role', 'apikey', 'api_key', 'token', 'secret',
  'id', 'client_id', 'created_by', 'deleted_at',
])
// Patrón defensivo: cualquier valor que huela a SQL/inyección invalida el goal.
const INJECTION_RE = /(--|;|\/\*|\*\/|\bunion\b|\bselect\b|\bdrop\b|\binsert\b|\bdelete\b|\bupdate\b\s+\w+\s+\bset\b|\bwhere\b\s+\d+=\d+)/i

function sanitizeFilters(raw: unknown): { ok: true; filters: Record<string, string | number> } | { ok: false; reason: string } {
  if (raw == null) return { ok: true, filters: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'filters_not_object' }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_FILTER_KEYS) return { ok: false, reason: 'too_many_filters' }
  const out: Record<string, string | number> = {}
  for (const [k, v] of entries) {
    const key = String(k).toLowerCase()
    if (FORBIDDEN_FILTER_KEYS.has(key)) return { ok: false, reason: `forbidden_filter:${key}` }
    // null/undefined = «no proporcionado» (habitual en structured output): se OMITE la clave (narrowing-
    // safe, jamás inventa ni amplía). Arrays/objetos/booleanos siguen invalidando el goal (estructura).
    if (v == null) continue
    if (typeof v === 'number' && Number.isFinite(v)) { out[k] = v; continue }
    if (typeof v === 'string') {
      if (v.length > MAX_STR) return { ok: false, reason: 'filter_too_long' }
      if (INJECTION_RE.test(v)) return { ok: false, reason: 'injection_in_filter' }
      out[k] = v
      continue
    }
    return { ok: false, reason: 'filter_bad_type' }
  }
  return { ok: true, filters: out }
}

function sanitizeEntityRef(ref: unknown): { ok: true; ref: string | null } | { ok: false; reason: string } {
  if (ref == null) return { ok: true, ref: null }
  if (typeof ref !== 'string') return { ok: false, reason: 'entityRef_bad_type' }
  const t = ref.trim()
  if (!t) return { ok: true, ref: null }
  if (t.length > MAX_STR) return { ok: false, reason: 'entityRef_too_long' }
  // Un id UUID inventado por el modelo NO es una referencia autoritativa: se rechaza. El código resuelve
  // identidades contra la BD, jamás confía en un id del LLM.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return { ok: false, reason: 'model_supplied_uuid' }
  if (INJECTION_RE.test(t)) return { ok: false, reason: 'injection_in_entityRef' }
  return { ok: true, ref: t }
}

// Normaliza el goal de "explicación": el modelo a veces etiqueta explain con una capability de lectura
// (p. ej. portfolio.list). Si kind=explain, la capability correcta es explain.module (salvo onboarding).
const EXPLAIN_EXEMPT = new Set(['onboarding.tour', 'capabilities.introspect'])
function normalizeExplainCapability(g: PlanGoal): PlanGoal {
  if (g.kind !== 'explain') return g
  if (EXPLAIN_EXEMPT.has(g.capability)) return g          // introspect/onboarding NO son explain.module
  if (g.capability !== 'explain.module') return { ...g, capability: 'explain.module' }
  return g
}

export function validatePlan(plan: Plan): ValidatedPlan {
  const rejected: ValidatedPlan['rejected'] = []
  const goals: ValidatedGoal[] = []
  const rawGoals = Array.isArray(plan.goals) ? plan.goals.slice(0, MAX_GOALS) : []

  let i = 0
  for (const raw0 of rawGoals) {
    const raw = normalizeExplainCapability(raw0)
    let capId = String(raw.capability ?? '')
    // Coherencia acto↔objetivo (general): bajo una PREGUNTA DE CAPACIDAD, explicar «cómo funciona un módulo»
    // no responde «¿qué puedes hacer / puedes X?». Se redirige a introspección (deriva capacidades del
    // registro). No es una regla por frase: es una invariante del acto comunicativo.
    if (plan.speechAct === 'capability_question' && capId === 'explain.module') capId = 'capabilities.introspect'
    if (!CAPABILITY_IDS.has(capId)) { rejected.push({ capability: capId || '(vacío)', reason: 'unknown_capability' }); continue }

    // Coherencia acto↔capability: una PREGUNTA DE CAPACIDAD nunca produce un goal de acción ejecutable.
    // El modelo puede proponerlo; el contrato lo bloquea aquí (defensa independiente del prompt).
    const spec = getCapability(capId)!
    if (plan.speechAct === 'capability_question' && spec.mutation) {
      rejected.push({ capability: capId, reason: 'action_goal_in_capability_question' }); continue
    }

    const ef = sanitizeFilters(raw.filters)
    if (!ef.ok) { rejected.push({ capability: capId, reason: ef.reason }); continue }
    const er = sanitizeEntityRef(raw.entityRef)
    if (!er.ok) { rejected.push({ capability: capId, reason: er.reason }); continue }

    const kind: PlanGoal['kind'] = spec.mutation ? 'action' : spec.operation === 'explain' ? 'explain' : 'read'
    const SELECTIONS = new Set(['all', 'one', 'first', 'last', 'random', 'top', 'bottom', 'n', 'matching'])
    const selection = typeof raw.selection === 'string' && SELECTIONS.has(raw.selection) ? raw.selection : null
    const selCount = typeof raw.selectionCount === 'number' && Number.isFinite(raw.selectionCount) && raw.selectionCount > 0 ? Math.min(Math.floor(raw.selectionCount), 50) : null
    const OUTPUTS = new Set(['list', 'detail', 'count', 'value', 'explanation'])
    const requestedOutput = typeof raw.requestedOutput === 'string' && OUTPUTS.has(raw.requestedOutput) ? raw.requestedOutput : null
    goals.push({
      goalId: `g${i++}`,
      kind,
      capability: capId,
      entityRef: er.ref,
      filters: ef.filters,
      temporal: typeof raw.temporal === 'string' && raw.temporal.trim() ? raw.temporal.trim().slice(0, MAX_STR) : null,
      aggregation: raw.aggregation ?? null,
      selection,
      selectionCount: selCount,
      requestedOutput,
      // El plan de consulta componible solo se conserva para crm.query; el executor lo valida con la query
      // layer (allowlists). Para el resto de capabilities se descarta (no aplica).
      query: capId === 'crm.query' && raw.query && typeof raw.query === 'object' ? raw.query : null,
      dependsOn: [],
    })
  }

  // Dependencias: un goal de RELACIÓN/DETALLE sobre una entidad depende de un goal previo que la produzca
  // (p. ej. search → detail). Derivado del propio plan, NO de frases. Si el modelo mandó un dependsOn
  // explícito válido, se respeta; si no, se deja []. (El executor también infiere por entityRef.)
  const clarification = plan.needsClarification === true
  return {
    version: PLAN_CONTRACT_VERSION,
    speechAct: plan.speechAct ?? 'unknown',
    goals,
    needsClarification: clarification || (goals.length === 0 && !!plan.clarificationQuestion),
    clarificationQuestion: typeof plan.clarificationQuestion === 'string' ? plan.clarificationQuestion.slice(0, 400) : null,
    proposedStateUpdates: plan.proposedStateUpdates ?? { activeModule: null, offeredCapabilities: [] },
    rejected,
    model: plan.rawModel,
  }
}
