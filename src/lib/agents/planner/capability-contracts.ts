// Contrato estable y machine-readable de las capabilities del asistente.
// Se DERIVA de la ontología de lectura y del action registry: no introduce tablas, campos ni acciones.

import { ASSISTANT_ACTIONS, getActionDefinition } from '../action-registry'
import { CAPABILITY_ONTOLOGY, type CapabilitySpec } from './capability-ontology'
import type { GoalStatus } from './plan-contract'

export const CAPABILITY_CONTRACT_VERSION = 1

export const CAPABILITY_RESULT_STATUSES: readonly GoalStatus[] = [
  'SUCCESS', 'EMPTY', 'PARTIAL', 'AMBIGUOUS', 'NOT_FOUND', 'FORBIDDEN',
  'TIMEOUT', 'UNAVAILABLE', 'INVALID_INPUT', 'CONFLICT', 'POLICY_BLOCK', 'INTERNAL_ERROR',
]

export type CapabilityAccessClass = 'READ' | 'SAFE_WRITE' | 'SENSITIVE_WRITE' | 'IRREVERSIBLE'

export type CapabilityContract = {
  version: typeof CAPABILITY_CONTRACT_VERSION
  name: string
  description: string
  inputSchema: {
    type: 'object'
    required: string[]
    optional: string[]
    entityRef: 'required' | 'optional' | 'forbidden'
    temporal: 'supported' | 'unsupported'
    mutationFields: { allowed: string[]; atLeastOne: boolean } | null
    additionalProperties: false
  }
  outputSchema: {
    type: 'structured_evidence' | 'action_preview'
    statuses: readonly GoalStatus[]
    groundedBy: 'live_reader' | 'server_registry' | 'action_control_plane'
  }
  authorization: {
    actor: 'authenticated_user'
    requirements: readonly ['authenticated_session', 'server_resolved_workspace']
    enforcement: Array<'route_auth' | 'supabase_rls' | 'workspace_scoped_reader' | 'action_control_plane'>
  }
  tenantScope: {
    source: 'server'
    modelMayChooseWorkspace: false
    required: true
  }
  accessClass: CapabilityAccessClass
  confirmationPolicy: 'none' | 'preview_confirm'
  idempotency: 'not_applicable' | 'required'
  errorContract: {
    statuses: readonly GoalStatus[]
    safeMessageRequired: true
    rawProviderErrorExposed: false
  }
  implementation: {
    kind: 'reader' | 'action'
    handler: string
  }
}

function accessClass(spec: CapabilitySpec): CapabilityAccessClass {
  if (!spec.mutation) return 'READ'
  return getActionDefinition(spec.id)?.risk === 'medium' ? 'SENSITIVE_WRITE' : 'SAFE_WRITE'
}

function contractFromSpec(spec: CapabilitySpec): CapabilityContract {
  const action = getActionDefinition(spec.id)
  const required = action
    ? (action.requiredEntity ? ['entity'] : [])
    : [...spec.requiredSlots]
  const optional = action
    ? []
    : [...spec.optionalFilters]
  const acceptsLinguisticEntityRef = spec.entityTypes.some((type) => type !== 'none') ||
    ['crm.query', 'explain.module', 'capabilities.introspect'].includes(spec.id)
  const registryBacked = ['moduleCatalog', 'onboarding', 'introspect'].includes(spec.reader ?? '')

  return {
    version: CAPABILITY_CONTRACT_VERSION,
    name: spec.id,
    description: spec.description,
    inputSchema: {
      type: 'object',
      required,
      optional,
      entityRef: required.includes('entity') ? 'required' : acceptsLinguisticEntityRef ? 'optional' : 'forbidden',
      temporal: spec.temporal?.supported ? 'supported' : 'unsupported',
      mutationFields: action ? { allowed: [...action.allowedFields], atLeastOne: true } : null,
      additionalProperties: false,
    },
    outputSchema: {
      type: action ? 'action_preview' : 'structured_evidence',
      statuses: CAPABILITY_RESULT_STATUSES,
      groundedBy: action ? 'action_control_plane' : registryBacked || !spec.reader ? 'server_registry' : 'live_reader',
    },
    authorization: {
      actor: 'authenticated_user',
      requirements: ['authenticated_session', 'server_resolved_workspace'],
      enforcement: action
        ? ['route_auth', 'supabase_rls', 'workspace_scoped_reader', 'action_control_plane']
        : ['route_auth', 'supabase_rls', 'workspace_scoped_reader'],
    },
    tenantScope: { source: 'server', modelMayChooseWorkspace: false, required: true },
    accessClass: accessClass(spec),
    confirmationPolicy: action ? 'preview_confirm' : 'none',
    idempotency: action ? 'required' : 'not_applicable',
    errorContract: {
      statuses: CAPABILITY_RESULT_STATUSES,
      safeMessageRequired: true,
      rawProviderErrorExposed: false,
    },
    implementation: {
      kind: action ? 'action' : 'reader',
      handler: spec.reader ?? 'server-registry',
    },
  }
}

export const CAPABILITY_CONTRACTS: readonly CapabilityContract[] = CAPABILITY_ONTOLOGY.map(contractFromSpec)
const CONTRACT_BY_NAME = new Map(CAPABILITY_CONTRACTS.map((contract) => [contract.name, contract]))

export function getCapabilityContract(name: string): CapabilityContract | null {
  return CONTRACT_BY_NAME.get(name) ?? null
}

// Falla pronto en desarrollo si ambos registries se desalinean. La comprobación completa también vive
// en evals, pero esta invariante evita publicar una acción sin contrato incluso si no se ejecuta la suite.
for (const actionId of Object.keys(ASSISTANT_ACTIONS)) {
  if (!CONTRACT_BY_NAME.has(actionId)) throw new Error(`Action without capability contract: ${actionId}`)
}
