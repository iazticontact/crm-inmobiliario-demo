// Evals PURAS del puente ConversationState ↔ General Planner. Protegen follow-ups, ordinales y el límite
// de seguridad que impide enviar UUIDs internos al modelo.

import { emptyState } from '@/lib/agents/conversation-state'
import type { Evidence } from '@/lib/agents/planner/capability-executor'
import { discourseFromConversationState, plannerStateUpdateFromTurn } from '@/lib/agents/planner/conversation-state-bridge'
import { plannerView } from '@/lib/agents/planner/discourse-state'
import { validatePlan } from '@/lib/agents/planner/plan-contract'
import type { Plan } from '@/lib/agents/planner/semantic-planner'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const CLIENT_2_ID = '22222222-2222-4222-8222-222222222222'

function readPlan(): ReturnType<typeof validatePlan> {
  const plan: Plan = {
    speechAct: 'read_request',
    goals: [{
      kind: 'read', capability: 'clients.list', entityRef: null, filters: {}, temporal: null,
      aggregation: null, selection: 'all', selectionCount: null, requestedOutput: 'list', query: null,
    }],
    needsClarification: false,
    clarificationQuestion: null,
    proposedStateUpdates: { activeModule: 'clients', offeredCapabilities: [] },
  }
  return validatePlan(plan)
}

export function runPlannerStateBridgeEvals(): string[] {
  const fail: string[] = []
  const ok = (condition: boolean, message: string) => { if (!condition) fail.push(message) }
  const state = emptyState()
  state.activeModule = 'clients'
  state.activeEntities = [{
    entityType: 'client', entityId: CLIENT_ID, displayLabel: 'ACME Telecom', confidence: 1, sourceTurnId: 'turn-1',
  }]
  state.lastDataQuery = {
    module: 'clients', capability: 'clients.list', entityType: 'client', executedAt: '2026-09-25T10:00:00.000Z',
    resultRefs: [
      { entityId: CLIENT_ID, label: 'ACME Telecom' },
      { entityId: CLIENT_2_ID, label: 'Beta Telecom' },
    ],
  }
  state.temporalScope = {
    start: '2026-09-25', end: '2026-09-25', timezone: 'Europe/Madrid', granularity: 'day',
    interpretation: 'hoy', sourceTurnId: 'turn-1', confidence: 1,
  }

  const discourse = discourseFromConversationState(state)
  ok(discourse.activeEntities[0]?.id === CLIENT_ID, 'mapea entityId canónico al discurso server-side')
  ok(discourse.activeEntities[0]?.label === 'ACME Telecom', 'mapea displayLabel canónico')
  ok(discourse.lastListed?.items[1]?.id === CLIENT_2_ID, 'mapea la última lista para ordinales')
  ok(discourse.temporalScope === 'hoy', 'mapea el alcance temporal lingüístico')

  const promptState = JSON.stringify(plannerView(discourse))
  ok(!promptState.includes(CLIENT_ID) && !promptState.includes(CLIENT_2_ID), 'plannerView nunca expone UUIDs al modelo')
  ok(promptState.includes('ACME Telecom'), 'plannerView conserva labels útiles')

  const evidence: Evidence = {
    goalId: 'g0', capability: 'clients.list', status: 'SUCCESS', count: 2,
    data: [
      { id: CLIENT_ID, name: 'ACME Telecom' },
      { id: CLIENT_2_ID, name: 'Beta Telecom' },
      { id: 'not-a-uuid', name: 'Fila inválida' },
    ],
    resolvedEntity: { type: 'client', id: CLIENT_ID, label: 'ACME Telecom' },
  }
  const update = plannerStateUpdateFromTurn({
    discourse, plan: readPlan(), evidences: [evidence], turnId: 'turn-2', now: '2026-09-25T11:00:00.000Z',
  })
  ok(update.resolvedModule === 'clients' && update.resolvedCapability === 'clients.list', 'persiste foco y capability')
  ok(update.resolvedEntities?.[0]?.entityId === CLIENT_ID, 'persiste referente resuelto')
  ok(update.lastDataQueryUpdate?.resultRefs.length === 2, 'persiste solo referencias UUID válidas')
  ok(update.lastDataQueryUpdate?.entityType === 'client', 'persiste el tipo de la lista')
  ok(update.lastAssistantResultUpdate?.turnId === 'turn-2', 'enlaza el resultado al turno')

  const legacy = discourseFromConversationState({ activeEntities: [{ type: 'client', id: CLIENT_ID, label: 'Legacy ACME' }] })
  ok(legacy.activeEntities[0]?.label === 'Legacy ACME', 'acepta forma legacy durante transición')

  return fail
}
