// Registro CENTRAL de acciones del Asistente (P65) — PURO. Ninguna escritura fuera de este registro.
// Cada acción declara sus campos permitidos/prohibidos, expiración y verificación. Facturación NUNCA.

export type AssistantActionId = 'tasks.create' | 'tasks.complete' | 'portfolio.update_price' | 'clients.update_phone'

export type AssistantActionDefinition = {
  id: AssistantActionId
  module: 'tasks' | 'portfolio' | 'clients'
  description: string
  table: 'tasks' | 'properties' | 'clients'
  kind: 'insert' | 'update'
  requiredEntity: boolean
  allowedFields: string[]          // ÚNICOS campos que la acción puede escribir
  forbiddenFields: string[]        // nunca, ni siquiera si vienen en proposedChanges
  confirmationRequired: true
  idempotent: true
  supportsOptimisticLock: boolean  // usa expected_updated_at en el UPDATE
  expiryMinutes: number
  risk: 'low' | 'medium'
}

export const ASSISTANT_ACTIONS: Record<AssistantActionId, AssistantActionDefinition> = {
  'tasks.create': {
    id: 'tasks.create', module: 'tasks', description: 'Crear una tarea', table: 'tasks', kind: 'insert',
    requiredEntity: false, allowedFields: ['title', 'due_date', 'priority', 'client_id', 'client_name'],
    forbiddenFields: ['workspace_id', 'id', 'created_by', 'status'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: false, expiryMinutes: 10, risk: 'low',
  },
  'tasks.complete': {
    id: 'tasks.complete', module: 'tasks', description: 'Completar una tarea', table: 'tasks', kind: 'update',
    requiredEntity: true, allowedFields: ['status'], forbiddenFields: ['workspace_id', 'id', 'title'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
  'portfolio.update_price': {
    id: 'portfolio.update_price', module: 'portfolio', description: 'Actualizar el precio de un inmueble',
    table: 'properties', kind: 'update', requiredEntity: true, allowedFields: ['price'],
    forbiddenFields: ['workspace_id', 'id', 'status', 'title'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'medium',
  },
  'clients.update_phone': {
    id: 'clients.update_phone', module: 'clients', description: 'Actualizar el teléfono de un cliente',
    table: 'clients', kind: 'update', requiredEntity: true, allowedFields: ['phone'],
    forbiddenFields: ['workspace_id', 'id', 'email', 'name'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
}

export function getActionDefinition(id: string): AssistantActionDefinition | null {
  return (ASSISTANT_ACTIONS as Record<string, AssistantActionDefinition>)[id] ?? null
}

// Valida que proposedChanges solo toque campos permitidos. Devuelve el campo ilegal o null.
export function findDeniedField(def: AssistantActionDefinition, changes: Record<string, unknown>): string | null {
  for (const k of Object.keys(changes)) {
    if (def.forbiddenFields.includes(k) || !def.allowedFields.includes(k)) return k
  }
  return null
}
