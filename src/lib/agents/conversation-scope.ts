// P71·It3 — SCOPE COMPOSICIONAL DE CONSULTA (capa PURA). Una consulta no es «una capacidad» sino la
// COMPOSICIÓN de dimensiones independientes: entidad, capability/módulo, periodo, filtros, orden, agregado y
// límite. Una referencia a entidad y un periodo temporal NO compiten: coexisten. Este resolver arma cada
// dimensión por separado a partir del mensaje + estado y las devuelve juntas; el planner (en local-answers)
// RECONSULTA la BD aplicando todas. Nunca responde de resultados previos.
//
// Regla dura: temporalScope no elimina entityScope y entityScope no elimina temporalScope. Si una entidad no
// tiene relaciones en el periodo → empty REAL (nunca fallback global).

import { foldText } from '@/lib/real-estate-search'
import type { ConversationState, ConvEntityType, TemporalScope, EntityRef } from './conversation-state'
import { detectReference, resolveAnchor } from './conversation-references'
import { resolveTemporalScope } from './conversation-temporal'

export type EntityScope = {
  entityType: ConvEntityType
  entityIds: string[]
  label: string
  source: 'explicit' | 'active' | 'ordinal' | 'referent'
  confidence: number
}
export type QueryOrdering = { field: string; direction: 'asc' | 'desc' }
export type QueryAggregation = { type: 'count' | 'sum' | 'average' | 'min' | 'max'; field?: string }

export type ConversationQueryScope = {
  module: string | null
  capability: string | null
  entityScope: EntityScope | null
  temporalScope: TemporalScope | null
  filters: Record<string, unknown>
  ordering: QueryOrdering | null
  aggregation: QueryAggregation | null
  limit: number | null
}

// Capability relacional pedida sobre una entidad (sustantivo de módulo del mensaje). General, no exhaustivo.
const CAPABILITY_NOUN: Array<[RegExp, string]> = [
  [/\b(cita|citas|calendario|agenda|reunion(es)?|visitas?)\b/, 'calendar'],
  [/\b(tarea|tareas|pendientes?)\b/, 'tasks'],
  [/\b(operacion|operaciones|oportunidad(es)?|venta|ventas)\b/, 'operations'],
  [/\b(tramite|tramites|expediente|expedientes)\b/, 'cases'],
  [/\b(inmueble|inmuebles|piso|pisos|propiedad(es)?|cartera)\b/, 'portfolio'],
]

// ── P71·F3.2 — CAPACIDADES TEMPORALES de lectura (metadata, no frases) ────────────────────────────────
// Derivadas del modelo REAL: cada entidad de CRM_QUERY_ENTITIES declara su `dateCol`; aquí se proyecta qué
// módulos tienen semántica temporal de lectura, con qué campo y con qué etiqueta honesta. Cartera queda
// FUERA a propósito (un inmueble no «ocurre» en una semana) y Facturación está aislada. La continuidad
// («¿y la semana que viene?») solo se hereda entre módulos declarados aquí.
export type TemporalCapability = {
  module: string
  queryEntity: 'calendar_events' | 'tasks' | 'opportunities' | 'service_cases'
  dateField: string          // columna real usada por crmReadQuery.dateRange
  periodLabel: string        // cómo se enuncia el periodo en la respuesta («con cierre previsto en …»)
  allowsContinuity: boolean
}
export const TEMPORAL_READ_CAPABILITIES: Record<string, TemporalCapability> = {
  calendar: { module: 'calendar', queryEntity: 'calendar_events', dateField: 'date', periodLabel: 'para', allowsContinuity: true },
  tasks: { module: 'tasks', queryEntity: 'tasks', dateField: 'due_date', periodLabel: 'con fecha límite en', allowsContinuity: true },
  operations: { module: 'operations', queryEntity: 'opportunities', dateField: 'expected_close_date', periodLabel: 'con cierre previsto en', allowsContinuity: true },
  cases: { module: 'cases', queryEntity: 'service_cases', dateField: 'due_date', periodLabel: 'con vencimiento en', allowsContinuity: true },
}

function detectCapability(message: string): string | null {
  const n = foldText(message)
  for (const [re, cap] of CAPABILITY_NOUN) if (re.test(n)) return cap
  return null
}

function detectAggregation(message: string): QueryAggregation | null {
  const n = foldText(message)
  if (/\bcuant[oa]s?\b|\bnumero de\b|\bcantidad de\b|\btotal de\b/.test(n)) return { type: 'count' }
  if (/\bsuma\b|\bsumatorio\b|\bvalor total\b|\bimporte total\b/.test(n)) return { type: 'sum' }
  if (/\bmedia\b|\bpromedio\b/.test(n)) return { type: 'average' }
  return null
}

// Resuelve el entityScope a partir de una REFERENCIA (pronombre/posesivo/demostrativo/ordinal/elisión) sobre
// el estado. La entidad explícita por nombre se resuelve aparte (necesita BD); aquí solo lo que vive en estado.
function resolveEntityScope(message: string, state: ConversationState): EntityScope | null {
  const n = foldText(message)
  // Elisión de 3ª persona («¿qué citas tiene?», «¿cuántas operaciones tiene este mes?»): el sujeto es la
  // entidad activa (cliente por defecto). Se resuelve ANTES que un demostrativo, que podría ser temporal.
  if (/\b(tiene|tienen|tenia|tenian)\b/.test(n) && !/\b(tengo|tienes|tenemos|teneis)\b/.test(n)) {
    const owner = state.activeEntities.find((x) => x.entityType === 'client') ?? state.activeEntities[0]
    if (owner) return { entityType: owner.entityType, entityIds: [owner.entityId], label: owner.displayLabel, source: 'active', confidence: 0.7 }
  }
  const ref = detectReference(message)
  if (ref) {
    const anchor = resolveAnchor(ref, state)
    if (anchor && anchor.type === 'entity') {
      const e = anchor.entity
      const source: EntityScope['source'] = ref.kind === 'ordinal' ? 'ordinal' : 'referent'
      return { entityType: e.entityType, entityIds: [e.entityId], label: e.displayLabel, source, confidence: anchor.confidence }
    }
  }
  return null
}

// Resuelve el scope COMPLETO combinando dimensiones independientes. No decide ejecución: solo describe.
export function resolveQueryScope(message: string, state: ConversationState, todayIso: string, turnId: string): ConversationQueryScope {
  const entityScope = resolveEntityScope(message, state)
  const temporal = resolveTemporalScope(message, state.temporalScope, todayIso, turnId)
  const capability = detectCapability(message)
  const aggregation = detectAggregation(message)
  return {
    module: capability,
    capability,
    entityScope,
    temporalScope: temporal ? temporal.scope : null,
    filters: {},
    ordering: null,
    aggregation,
    limit: null,
  }
}

// Conveniencia para el planner: ¿el scope combina entidad + periodo? (el caso composicional clave).
export function isEntityTemporalComposite(scope: ConversationQueryScope): boolean {
  return !!scope.entityScope && !!scope.temporalScope
}

export type { EntityRef }
