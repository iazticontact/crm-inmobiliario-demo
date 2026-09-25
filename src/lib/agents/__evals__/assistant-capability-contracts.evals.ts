// Evals PURAS del catálogo contractual: cobertura total, tenant isolation y política de writes.

import { ASSISTANT_ACTIONS } from '@/lib/agents/action-registry'
import { CAPABILITY_CONTRACTS, CAPABILITY_RESULT_STATUSES } from '@/lib/agents/planner/capability-contracts'
import { CAPABILITY_ONTOLOGY } from '@/lib/agents/planner/capability-ontology'

export function runCapabilityContractEvals(): string[] {
  const fail: string[] = []
  const ok = (condition: boolean, message: string) => { if (!condition) fail.push(message) }
  const names = CAPABILITY_CONTRACTS.map((contract) => contract.name)

  ok(names.length === new Set(names).size, 'cada capability tiene un único contrato')
  ok(
    CAPABILITY_ONTOLOGY.every((capability) => names.includes(capability.id)) && names.length === CAPABILITY_ONTOLOGY.length,
    'el contrato cubre exactamente la ontología',
  )

  for (const contract of CAPABILITY_CONTRACTS) {
    ok(contract.tenantScope.source === 'server' && contract.tenantScope.modelMayChooseWorkspace === false, `${contract.name}: workspace solo server-side`)
    ok(contract.authorization.requirements.includes('authenticated_session'), `${contract.name}: exige sesión`)
    ok(contract.authorization.enforcement.includes('supabase_rls'), `${contract.name}: exige RLS`)
    ok(contract.errorContract.statuses.length === CAPABILITY_RESULT_STATUSES.length, `${contract.name}: taxonomía de error completa`)
    ok(contract.inputSchema.additionalProperties === false, `${contract.name}: input cerrado`)

    if (contract.implementation.kind === 'action') {
      ok(contract.accessClass === 'SAFE_WRITE' || contract.accessClass === 'SENSITIVE_WRITE', `${contract.name}: riesgo de escritura clasificado`)
      ok(contract.confirmationPolicy === 'preview_confirm', `${contract.name}: preview+confirm`)
      ok(contract.idempotency === 'required', `${contract.name}: idempotencia obligatoria`)
      ok(contract.authorization.enforcement.includes('action_control_plane'), `${contract.name}: control plane obligatorio`)
      ok(Boolean(ASSISTANT_ACTIONS[contract.name as keyof typeof ASSISTANT_ACTIONS]), `${contract.name}: acción registrada`)
      ok(contract.inputSchema.mutationFields?.atLeastOne === true, `${contract.name}: requiere cambios explícitos`)
    } else {
      ok(contract.accessClass === 'READ', `${contract.name}: lectura clasificada READ`)
      ok(contract.confirmationPolicy === 'none', `${contract.name}: lectura sin confirmación`)
      ok(contract.idempotency === 'not_applicable', `${contract.name}: lectura sin idempotency key`)
    }

    ok(contract.accessClass !== 'IRREVERSIBLE', `${contract.name}: no hay operaciones irreversibles publicadas`)
  }

  return fail
}
