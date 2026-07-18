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
// manteniendo la forma base de DiscourseState que consume el planner.
export type RichDiscourse = DiscourseState & {
  lastListed?: { type: string; items: Array<{ id: string; label: string }> } | null
}

const LIST_CAP_TO_TYPE: Record<string, string> = {
  'clients.list': 'client', 'clients.count': 'client', 'clients.search': 'client',
  'portfolio.list': 'property', 'portfolio.summary': 'property',
  'operations.list': 'opportunity', 'tasks.list': 'task', 'calendar.list': 'calendar_event', 'cases.list': 'service_case',
}

export function toDiscourseRef(d: RichDiscourse): DiscourseRef {
  return { activeEntities: d.activeEntities.map((e) => ({ type: e.type, label: e.label })), lastListed: d.lastListed ?? null }
}

// Reducer: dado el estado previo + el plan + la evidencia, produce el discurso del siguiente turno.
export function advanceDiscourse(prev: RichDiscourse, plan: ValidatedPlan, evidences: Evidence[]): RichDiscourse {
  const next: RichDiscourse = { ...prev, activeEntities: [...prev.activeEntities], lastListed: prev.lastListed ?? null }

  // Módulo activo: lo que proponga el plan, si no el módulo del primer goal con datos.
  if (plan.proposedStateUpdates?.activeModule !== undefined && plan.proposedStateUpdates.activeModule !== null) {
    next.activeModule = plan.proposedStateUpdates.activeModule
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

  // Ofertas: se persisten estructuradas para que el turno siguiente se interprete con ellas.
  next.offeredCapabilities = plan.proposedStateUpdates?.offeredCapabilities ?? []

  // Temporal scope reciente.
  const temporalGoal = plan.goals.find((g) => g.temporal)
  next.temporalScope = temporalGoal?.temporal ?? prev.temporalScope ?? null
  return next
}
