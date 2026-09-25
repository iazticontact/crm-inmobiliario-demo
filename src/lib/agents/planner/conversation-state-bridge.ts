// Puente PURO entre el estado conversacional compartido (P71) y el discurso del planner general.
// Mantiene una única memoria por hilo sin convertirla en fuente de verdad: solo mueve referencias,
// capacidades y alcance conversacional. Los datos de negocio siempre se releen con readers autorizados.

import {
  CONV_ENTITY_TYPES,
  type ConvEntityType,
  type ConversationState,
  type EntityRef,
  type StateUpdate,
} from '../conversation-state'
import type { Evidence } from './capability-executor'
import { getCapability } from './capability-ontology'
import { emptyDiscourse, type RichDiscourse } from './discourse-state'
import type { ValidatedPlan } from './plan-contract'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ACTIVE_ENTITIES = 4
const MAX_LIST_ITEMS = 20

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function scalarSlots(value: unknown): Record<string, string | number> {
  const input = asRecord(value)
  if (!input) return {}
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string | number] =>
      typeof entry[1] === 'string' || (typeof entry[1] === 'number' && Number.isFinite(entry[1])),
    ),
  )
}

function discourseEntity(value: unknown): RichDiscourse['activeEntities'][number] | null {
  const entity = asRecord(value)
  if (!entity) return null

  // Forma canónica de ConversationState v2. La forma type/id/label queda como compatibilidad defensiva
  // para estados transitorios producidos por prototipos anteriores.
  const type = typeof entity.entityType === 'string' ? entity.entityType : entity.type
  const id = typeof entity.entityId === 'string' ? entity.entityId : entity.id
  const label = typeof entity.displayLabel === 'string' ? entity.displayLabel : entity.label
  if (typeof type !== 'string' || !CONV_ENTITY_TYPES.has(type) || typeof label !== 'string') return null

  return {
    type,
    label: label.slice(0, 160),
    ...(typeof id === 'string' && UUID_RE.test(id) ? { id } : {}),
  }
}

/** Convierte el estado persistido en discurso server-side. Nunca lanza ante memoria corrupta. */
export function discourseFromConversationState(state: unknown): RichDiscourse {
  const discourse = emptyDiscourse() as RichDiscourse
  const source = asRecord(state)
  if (!source) return discourse

  if (typeof source.activeModule === 'string') discourse.activeModule = source.activeModule
  if (Array.isArray(source.activeEntities)) {
    discourse.activeEntities = source.activeEntities
      .map(discourseEntity)
      .filter((entity): entity is NonNullable<typeof entity> => entity !== null)
      .slice(0, MAX_ACTIVE_ENTITIES)
  }

  const lastQuery = asRecord(source.lastDataQuery)
  if (lastQuery && CONV_ENTITY_TYPES.has(String(lastQuery.entityType)) && Array.isArray(lastQuery.resultRefs)) {
    const items = lastQuery.resultRefs.slice(0, MAX_LIST_ITEMS).flatMap((value) => {
      const ref = asRecord(value)
      if (!ref || typeof ref.entityId !== 'string' || !UUID_RE.test(ref.entityId)) return []
      return [{ id: ref.entityId, label: typeof ref.label === 'string' ? ref.label.slice(0, 160) : '' }]
    })
    if (items.length) {
      const type = String(lastQuery.entityType)
      discourse.lastListed = { type, items }
      discourse.lastListedEntityType = type
    }
  }

  const temporal = asRecord(source.temporalScope)
  if (temporal && typeof temporal.interpretation === 'string') {
    discourse.temporalScope = temporal.interpretation
  }

  const pending = asRecord(source.pendingIntent)
  if (pending && pending.kind === 'action' && typeof pending.capability === 'string') {
    const missingSlots = Array.isArray(pending.requiredSlots)
      ? pending.requiredSlots.filter((slot): slot is string => typeof slot === 'string').slice(0, 12)
      : []
    discourse.pendingAction = {
      capability: pending.capability,
      entity: discourse.activeEntities[0] ?? null,
      slots: scalarSlots(pending.collectedSlots),
      missingSlots,
    }
  }

  return discourse
}

function validEntityType(type: string): type is ConvEntityType {
  return CONV_ENTITY_TYPES.has(type)
}

function entityRefFromEvidence(entity: Evidence['resolvedEntity'], turnId: string): EntityRef | null {
  if (!entity || !validEntityType(entity.type) || !UUID_RE.test(entity.id)) return null
  return {
    entityType: entity.type,
    entityId: entity.id,
    displayLabel: entity.label.slice(0, 160),
    confidence: 1,
    sourceTurnId: turnId,
  }
}

function resultEntityType(capability: string): ConvEntityType | null {
  const spec = getCapability(capability)
  if (!spec || spec.id === 'crm.query') return null
  const types = spec.entityTypes.filter((type): type is ConvEntityType => validEntityType(type))
  if (!types.length) return null
  return spec.operation === 'relation' ? types.at(-1) ?? null : types[0]
}

function resultRefs(evidence: Evidence): Array<{ entityId: string; label: string }> {
  if (!Array.isArray(evidence.data)) return []
  return evidence.data.slice(0, MAX_LIST_ITEMS).flatMap((value) => {
    const row = asRecord(value)
    if (!row || typeof row.id !== 'string' || !UUID_RE.test(row.id)) return []
    const label = [row.name, row.title, row.email].find((candidate) => typeof candidate === 'string')
    return typeof label === 'string' ? [{ entityId: row.id, label: label.slice(0, 160) }] : []
  })
}

/** Proyecta el resultado de un turno del planner al update canónico que persiste P71. */
export function plannerStateUpdateFromTurn(args: {
  discourse: RichDiscourse
  plan: ValidatedPlan
  evidences: Evidence[]
  turnId: string
  now?: string
}): StateUpdate {
  const { discourse, plan, evidences, turnId } = args
  const primaryGoal = plan.goals[0] ?? null
  const primarySpec = primaryGoal ? getCapability(primaryGoal.capability) : null
  const activeModule = discourse.activeModule ?? (primarySpec?.module && primarySpec.module !== 'any' ? primarySpec.module : null)
  const resolvedEntities = evidences
    .map((evidence) => entityRefFromEvidence(evidence.resolvedEntity, turnId))
    .filter((entity): entity is EntityRef => entity !== null)

  const listEvidence = evidences.find((evidence) => resultEntityType(evidence.capability) !== null && resultRefs(evidence).length > 0)
  const listType = listEvidence ? resultEntityType(listEvidence.capability) : null
  const refs = listEvidence ? resultRefs(listEvidence) : []
  const entityIds = [...new Set([
    ...resolvedEntities.map((entity) => entity.entityId),
    ...refs.map((ref) => ref.entityId),
  ])].slice(0, 25)

  const resultType: NonNullable<ConversationState['lastAssistantResult']>['type'] =
    evidences.some((evidence) => evidence.actionPreview) ? 'action'
      : primaryGoal?.kind === 'explain' ? 'explanation'
        : 'read'

  return {
    resolvedModule: activeModule,
    resolvedCapability: primaryGoal?.capability ?? null,
    resolvedGoal: plan.speechAct,
    ...(resolvedEntities.length ? { resolvedEntities } : {}),
    ...(listEvidence && listType ? {
      lastDataQueryUpdate: {
        module: getCapability(listEvidence.capability)?.module ?? activeModule ?? 'assistant',
        capability: listEvidence.capability,
        entityType: listType,
        resultRefs: refs,
        executedAt: args.now ?? new Date().toISOString(),
      },
    } : {}),
    lastAssistantResultUpdate: {
      type: resultType,
      module: activeModule,
      capability: primaryGoal?.capability ?? null,
      entityIds,
      turnId,
    },
  }
}
