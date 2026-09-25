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
// ACCIÓN EN CURSO (clase slot-accumulation): una acción multi-turno acumula server-side la entidad ya
// resuelta y los slots ya proporcionados. El usuario NUNCA debe repetir lo que ya dijo (FASE 53).
export type PendingActionState = {
  capability: string
  entity: { type: string; label: string; id?: string } | null
  slots: Record<string, string | number>   // acumulados (ya filtrados por allowedFields en la preview)
  missingSlots: string[]
}

export type RichDiscourse = Omit<DiscourseState, 'activeEntities' | 'pendingAction'> & {
  activeEntities: Array<{ type: string; label: string; id?: string }>
  pendingAction: PendingActionState | null
  lastListed?: { type: string; items: Array<{ id: string; label: string }> } | null
}

// Proyección del discurso para el PROMPT del planner: SOLO referencias lingüísticas (labels/tipos), JAMÁS
// ids internos. Si el modelo nunca ve un UUID no puede copiarlo a entityRef (el contrato lo rechazaría como
// model_supplied_uuid y se perdería el turno). Los labels de la última lista sí ayudan a referenciar.
export function plannerView(d: RichDiscourse): DiscourseState & { lastListedLabels: string[] | null; pendingActionContext: { entity: string | null; providedSlots: string[] } | null } {
  return {
    activeModule: d.activeModule,
    activeEntities: d.activeEntities.map((e) => ({ type: e.type, label: e.label })),
    lastListedEntityType: d.lastListedEntityType,
    offeredCapabilities: d.offeredCapabilities,
    pendingAction: d.pendingAction ? { capability: d.pendingAction.capability, missingSlots: d.pendingAction.missingSlots } : null,
    temporalScope: d.temporalScope,
    lastListedLabels: d.lastListed ? d.lastListed.items.slice(0, 20).map((i) => i.label) : null,
    // Contexto de la acción en curso para el PROMPT: entidad por LABEL (sin ids) + NOMBRES de slots ya
    // dados (sin valores sensibles). El modelo emite SOLO lo nuevo; el servidor fusiona.
    pendingActionContext: d.pendingAction ? { entity: d.pendingAction.entity?.label ?? null, providedSlots: Object.keys(d.pendingAction.slots) } : null,
  }
}

const LIST_CAP_TO_TYPE: Record<string, string> = {
  'clients.list': 'client', 'clients.count': 'client', 'clients.search': 'client',
  'portfolio.list': 'property', 'portfolio.summary': 'property',
  'operations.list': 'opportunity', 'tasks.list': 'task', 'calendar.list': 'calendar_event', 'cases.list': 'service_case',
}

export function toDiscourseRef(d: RichDiscourse): DiscourseRef {
  return { activeEntities: d.activeEntities.map((e) => ({ type: e.type, label: e.label, id: e.id })), lastListed: d.lastListed ?? null }
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

  // ACCIÓN EN CURSO (slot-accumulation, FASE 53): la preview NO ejecutada persiste con la entidad ya
  // resuelta y los slots ya dados. Se limpia con cancel explícito o cuando el foco cambia a un módulo
  // incompatible con la acción (supersession, sin arrastres); se REEMPLAZA si aparece otra acción.
  const actionEv = evidences.find((e) => e.actionPreview)
  if (plan.speechAct === 'cancel') {
    next.pendingAction = null
  } else if (actionEv?.actionPreview) {
    const p = actionEv.actionPreview
    next.pendingAction = {
      capability: actionEv.capability,
      entity: p.entity ? { type: p.entity.type, label: p.entity.label, id: p.entity.id } : null,
      slots: { ...p.changes },
      missingSlots: [...p.missingSlots],
    }
  } else if (next.pendingAction && next.activeModule && next.activeModule !== next.pendingAction.capability.split('.')[0]) {
    next.pendingAction = null
  }

  // Ofertas: se persisten estructuradas para que el turno siguiente se interprete con ellas.
  next.offeredCapabilities = plan.proposedStateUpdates?.offeredCapabilities ?? []

  // Temporal scope reciente.
  const temporalGoal = plan.goals.find((g) => g.temporal)
  next.temporalScope = temporalGoal?.temporal ?? prev.temporalScope ?? null
  return next
}
