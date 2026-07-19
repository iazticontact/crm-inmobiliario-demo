// PROTOTIPO AISLADO (general-semantic-planner) — DISCOURSE STATE (FASE 5).
// Estado de DISCURSO, no verdad de negocio: qué se está hablando, qué se ofreció, a qué apuntan los
// pronombres. Los datos SIEMPRE se releen en vivo; aquí solo viven referencias e intención. Las OFERTAS
// se persisten de forma ESTRUCTURADA (offeredCapabilities) para que el turno siguiente se interprete
// semánticamente (no hay lista de "sí/vale/ok": el planner interpreta la aceptación).

import type { DiscourseState } from './semantic-planner'
import type { ValidatedPlan } from './plan-contract'
import type { Evidence } from './capability-executor'
import type { DiscourseRef } from './entity-resolver'

export function emptyDiscourse(): DiscourseState {
  return { activeModule: null, activeEntities: [], lastListedEntityType: null, offeredCapabilities: [], pendingAction: null, temporalScope: null }
}

// Extensión con memoria de la última lista (para ordinales) y del último resultado (para pronombres),
// manteniendo la forma base de DiscourseState que consume el planner. Los `id` que viven aquí son
// SERVER-SIDE (para resolver ordinales/pronombres contra datos ya autorizados): jamás viajan al prompt.
export type RichDiscourse = Omit<DiscourseState, 'activeEntities'> & {
  activeEntities: Array<{ type: string; label: string; id?: string }>
  lastListed?: { type: string; items: Array<{ id: string; label: string }> } | null
}

// Proyección del discurso para el PROMPT del planner: SOLO referencias lingüísticas (labels/tipos), JAMÁS
// ids internos. Si el modelo nunca ve un UUID no puede copiarlo a entityRef (el contrato lo rechazaría como
// model_supplied_uuid y se perdería el turno). Los labels de la última lista sí ayudan a referenciar.
export function plannerView(d: RichDiscourse): DiscourseState & { lastListedLabels: string[] | null } {
  return {
    activeModule: d.activeModule,
    activeEntities: d.activeEntities.map((e) => ({ type: e.type, label: e.label })),
    lastListedEntityType: d.lastListedEntityType,
    offeredCapabilities: d.offeredCapabilities,
    pendingAction: d.pendingAction,
    temporalScope: d.temporalScope,
    lastListedLabels: d.lastListed ? d.lastListed.items.slice(0, 20).map((i) => i.label) : null,
  }
}

const LIST_CAP_TO_TYPE: Record<string, string> = {
  'clients.list': 'client', 'clients.count': 'client', 'clients.search': 'client',
  'portfolio.list': 'property', 'portfolio.summary': 'property',
  'operations.list': 'opportunity', 'tasks.list': 'task', 'calendar.list': 'calendar_event', 'cases.list': 'service_case',
}

export function toDiscourseRef(d: RichDiscourse): DiscourseRef {
  return { activeEntities: d.activeEntities.map((e) => ({ type: e.type, label: e.label })), lastListed: d.lastListed ?? null }
}

// Qué tipo de entidad "pertenece" a cada módulo — para la supersession de foco (clase 4/5/6).
const MODULE_ENTITY: Record<string, string> = {
  clients: 'client', portfolio: 'property', operations: 'opportunity', tasks: 'task',
  calendar: 'calendar_event', cases: 'service_case', commissions: 'commission',
}

// Reducer: dado el estado previo + el plan + la evidencia, produce el discurso del siguiente turno.
export function advanceDiscourse(prev: RichDiscourse, plan: ValidatedPlan, evidences: Evidence[]): RichDiscourse {
  const next: RichDiscourse = { ...prev, activeEntities: [...prev.activeEntities], lastListed: prev.lastListed ?? null }
  const prevModule = prev.activeModule

  // Módulo activo: lo que proponga el plan, si no el módulo del primer goal con datos.
  if (plan.proposedStateUpdates?.activeModule !== undefined && plan.proposedStateUpdates.activeModule !== null) {
    next.activeModule = plan.proposedStateUpdates.activeModule
  } else {
    const firstMod = plan.goals.map((g) => g.capability.split('.')[0]).find((m) => MODULE_ENTITY[m])
    if (firstMod) next.activeModule = firstMod
  }

  // Entidades activas: cualquier entidad resuelta en este turno pasa a ser referente (la más reciente
  // primero). Se conserva por tipo (no se pisan tipos distintos).
  for (const ev of evidences) {
    if (ev.resolvedEntity) {
      const rest = next.activeEntities.filter((e) => e.type !== ev.resolvedEntity!.type)
      next.activeEntities = [{ type: ev.resolvedEntity.type, label: ev.resolvedEntity.label, id: ev.resolvedEntity.id }, ...rest].slice(0, 4)
    }
  }

  // Última lista: para resolver ordinales ("el segundo de la lista") en el próximo turno.
  const listEv = evidences.find((ev) => LIST_CAP_TO_TYPE[ev.capability] && Array.isArray(ev.data) && ev.data.length > 0)
  if (listEv && Array.isArray(listEv.data)) {
    const type = LIST_CAP_TO_TYPE[listEv.capability]
    const items = (listEv.data as Array<Record<string, unknown>>).slice(0, 20).map((r) => ({ id: String(r.id ?? ''), label: String(r.name ?? r.title ?? '') })).filter((x) => x.id)
    if (items.length) { next.lastListed = { type, items }; next.lastListedEntityType = type }
  }

  // SUPERSESSION de foco (clase 4/5/6): si el usuario cambió explícitamente de módulo, se retiran los
  // referentes STALE del módulo anterior (los que NO se resolvieron este turno y no son compatibles con el
  // nuevo foco). No se limpia todo: los referentes compatibles o recién resueltos se conservan. General.
  if (next.activeModule && next.activeModule !== prevModule) {
    const compatType = MODULE_ENTITY[next.activeModule]
    const justResolved = new Set(evidences.filter((e) => e.resolvedEntity).map((e) => e.resolvedEntity!.type))
    next.activeEntities = next.activeEntities.filter((e) => e.type === compatType || justResolved.has(e.type))
  }

  // Ofertas: se persisten estructuradas para que el turno siguiente se interprete con ellas.
  next.offeredCapabilities = plan.proposedStateUpdates?.offeredCapabilities ?? []

  // Temporal scope reciente.
  const temporalGoal = plan.goals.find((g) => g.temporal)
  next.temporalScope = temporalGoal?.temporal ?? prev.temporalScope ?? null
  return next
}
