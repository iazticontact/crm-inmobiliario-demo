// Registro CENTRAL de acciones del Asistente (P65) — PURO. Ninguna escritura fuera de este registro.
// Cada acción declara sus campos permitidos/prohibidos, expiración y verificación. Facturación NUNCA.

export type AssistantActionId =
  | 'tasks.create' | 'tasks.complete' | 'tasks.update_due_date'
  | 'portfolio.update_price' | 'portfolio.update_status'
  | 'clients.update_phone' | 'clients.update_email'
  // ── P70 Wave C · catálogo multimódulo ──
  | 'clients.update_name' | 'clients.update_note' | 'clients.update_status'
  | 'portfolio.update_notes' | 'portfolio.update_zone'
  | 'tasks.reopen' | 'tasks.update_priority' | 'tasks.update_title'
  | 'calendar.create' | 'calendar.reschedule'
  | 'operations.change_stage' | 'operations.update_value'
  | 'cases.update_status' | 'cases.update_due_date'

// P70 — Enums REALES verificados en BD (CHECK constraints o vocabulario canónico de la app).
// clients.status: CHECK (active|lead|inactive|churned). tasks.status: CHECK (pending|done).
// calendar_events.type: CHECK. Los demás son el vocabulario canónico usado por la UI/detectores.
export const CLIENT_STATUSES = ['active', 'lead', 'inactive', 'churned'] as const
export const TASK_PRIORITIES = ['high', 'normal', 'low'] as const
export const CALENDAR_TYPES = ['visit', 'call', 'meeting', 'follow-up', 'signing', 'valuation', 'other', 'demo'] as const
export const CASE_STATUSES = ['open', 'documentation_pending', 'in_review', 'in_follow_up', 'submitted', 'resolved', 'closed'] as const

// P70 — Matriz de TRANSICIONES de etapa de Operaciones (modelo comercial real: new → gestión → cierre).
// won es final; lost es reactivable. Fuera de matriz NO se prepara.
export const OPERATION_TRANSITIONS: Record<string, string[]> = {
  new: ['contacted', 'qualified', 'visit_scheduled', 'offer', 'negotiation', 'reserved', 'won', 'lost'],
  contacted: ['new', 'qualified', 'visit_scheduled', 'offer', 'negotiation', 'reserved', 'won', 'lost'],
  qualified: ['contacted', 'visit_scheduled', 'offer', 'negotiation', 'reserved', 'won', 'lost'],
  visit_scheduled: ['qualified', 'contacted', 'offer', 'negotiation', 'reserved', 'won', 'lost'],
  offer: ['visit_scheduled', 'negotiation', 'reserved', 'won', 'lost'],
  negotiation: ['offer', 'reserved', 'won', 'lost'],
  reserved: ['negotiation', 'won', 'lost'],
  won: [],
  lost: ['new', 'contacted'],
}
export function isValidOperationTransition(from: string, to: string): boolean {
  return (OPERATION_TRANSITIONS[from] ?? []).includes(to)
}

// P67 — Matriz de TRANSICIONES de estado de Cartera (según producto real). Una transición fuera de la
// matriz NO se prepara: se explica el estado actual y las transiciones válidas.
export const PORTFOLIO_TRANSITIONS: Record<string, string[]> = {
  prospecting: ['listed', 'archived'],
  listed: ['under_contract', 'sold', 'rented', 'prospecting', 'archived'],
  available: ['under_contract', 'sold', 'rented', 'archived'],
  under_contract: ['sold', 'rented', 'listed', 'archived'],
  sold: ['archived'],
  rented: ['listed', 'archived'],
  archived: ['prospecting', 'listed'],
}
export function isValidPortfolioTransition(from: string, to: string): boolean {
  return (PORTFOLIO_TRANSITIONS[from] ?? []).includes(to)
}

export type AssistantActionDefinition = {
  id: AssistantActionId
  module: 'tasks' | 'portfolio' | 'clients' | 'calendar' | 'operations' | 'cases'
  description: string
  table: 'tasks' | 'properties' | 'clients' | 'calendar_events' | 'opportunities' | 'service_cases'
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
  // ── P67 · Ampliación ──
  'clients.update_email': {
    id: 'clients.update_email', module: 'clients', description: 'Actualizar el email de un cliente',
    table: 'clients', kind: 'update', requiredEntity: true, allowedFields: ['email'],
    forbiddenFields: ['workspace_id', 'id', 'phone', 'name'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
  'tasks.update_due_date': {
    id: 'tasks.update_due_date', module: 'tasks', description: 'Cambiar la fecha límite de una tarea',
    table: 'tasks', kind: 'update', requiredEntity: true, allowedFields: ['due_date'],
    forbiddenFields: ['workspace_id', 'id', 'title', 'status'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
  'portfolio.update_status': {
    id: 'portfolio.update_status', module: 'portfolio', description: 'Cambiar el estado de un inmueble',
    table: 'properties', kind: 'update', requiredEntity: true, allowedFields: ['status'],
    forbiddenFields: ['workspace_id', 'id', 'price', 'title'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'medium',
  },
  // ── P70 Wave C · Clientes ──
  // NOTA: clients.update_tax_id y clients.update_nationality NO son posibles: la tabla clients no tiene
  // esas columnas (auditado en BD). `country` existe pero es otro concepto y no se mapea en silencio.
  'clients.update_name': {
    id: 'clients.update_name', module: 'clients', description: 'Cambiar el nombre de un cliente',
    table: 'clients', kind: 'update', requiredEntity: true, allowedFields: ['name'],
    forbiddenFields: ['workspace_id', 'id', 'email', 'phone', 'status'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'medium',
  },
  'clients.update_note': {
    id: 'clients.update_note', module: 'clients', description: 'Actualizar la nota de un cliente',
    table: 'clients', kind: 'update', requiredEntity: true, allowedFields: ['notes'],
    forbiddenFields: ['workspace_id', 'id', 'name', 'email', 'phone', 'status'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
  'clients.update_status': {
    id: 'clients.update_status', module: 'clients', description: 'Cambiar el estado de un cliente',
    table: 'clients', kind: 'update', requiredEntity: true, allowedFields: ['status'],
    forbiddenFields: ['workspace_id', 'id', 'name', 'email', 'phone'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'medium',
  },
  // ── P70 Wave C · Cartera ──
  'portfolio.update_notes': {
    id: 'portfolio.update_notes', module: 'portfolio', description: 'Actualizar las notas de un inmueble',
    table: 'properties', kind: 'update', requiredEntity: true, allowedFields: ['notes'],
    forbiddenFields: ['workspace_id', 'id', 'price', 'status', 'title'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
  'portfolio.update_zone': {
    id: 'portfolio.update_zone', module: 'portfolio', description: 'Cambiar la zona de un inmueble',
    table: 'properties', kind: 'update', requiredEntity: true, allowedFields: ['area'],
    forbiddenFields: ['workspace_id', 'id', 'price', 'status', 'title', 'city'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
  // ── P70 Wave C · Tareas ──
  'tasks.reopen': {
    id: 'tasks.reopen', module: 'tasks', description: 'Reabrir una tarea completada',
    table: 'tasks', kind: 'update', requiredEntity: true, allowedFields: ['status'],
    forbiddenFields: ['workspace_id', 'id', 'title'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
  'tasks.update_priority': {
    id: 'tasks.update_priority', module: 'tasks', description: 'Cambiar la prioridad de una tarea',
    table: 'tasks', kind: 'update', requiredEntity: true, allowedFields: ['priority'],
    forbiddenFields: ['workspace_id', 'id', 'title', 'status'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
  'tasks.update_title': {
    id: 'tasks.update_title', module: 'tasks', description: 'Renombrar una tarea',
    table: 'tasks', kind: 'update', requiredEntity: true, allowedFields: ['title'],
    forbiddenFields: ['workspace_id', 'id', 'status', 'due_date'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
  // ── P70 Wave C · Calendario ──
  // La app escribe SIEMPRE start_at/end_at además de date/start_hour/start_minute/duration (verificado
  // en supabase-queries); las listas filtran por start_at. El parser compone ambos (Europe/Madrid).
  'calendar.create': {
    id: 'calendar.create', module: 'calendar', description: 'Crear una cita',
    table: 'calendar_events', kind: 'insert', requiredEntity: false,
    allowedFields: ['title', 'type', 'date', 'start_hour', 'start_minute', 'duration', 'start_at', 'end_at', 'client_name', 'location'],
    forbiddenFields: ['workspace_id', 'id', 'created_by', 'status', 'is_read_only', 'google_event_id', 'google_calendar_id', 'sync_source'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: false, expiryMinutes: 10, risk: 'low',
  },
  'calendar.reschedule': {
    id: 'calendar.reschedule', module: 'calendar', description: 'Reprogramar una cita',
    table: 'calendar_events', kind: 'update', requiredEntity: true,
    allowedFields: ['date', 'start_hour', 'start_minute', 'duration', 'start_at', 'end_at'],
    forbiddenFields: ['workspace_id', 'id', 'title', 'status', 'is_read_only', 'google_event_id', 'google_calendar_id', 'sync_source'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'medium',
  },
  // ── P70 Wave C · Operaciones ──
  'operations.change_stage': {
    id: 'operations.change_stage', module: 'operations', description: 'Cambiar la etapa de una operación',
    table: 'opportunities', kind: 'update', requiredEntity: true, allowedFields: ['stage'],
    forbiddenFields: ['workspace_id', 'id', 'title', 'value', 'commission_rate', 'commission_status', 'commission_paid_amount'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'medium',
  },
  'operations.update_value': {
    id: 'operations.update_value', module: 'operations', description: 'Cambiar el valor de una operación',
    table: 'opportunities', kind: 'update', requiredEntity: true, allowedFields: ['value'],
    forbiddenFields: ['workspace_id', 'id', 'title', 'stage', 'commission_rate', 'commission_status', 'commission_paid_amount'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'medium',
  },
  // ── P70 Wave C · Trámites ──
  'cases.update_status': {
    id: 'cases.update_status', module: 'cases', description: 'Cambiar el estado de un trámite',
    table: 'service_cases', kind: 'update', requiredEntity: true, allowedFields: ['status'],
    forbiddenFields: ['workspace_id', 'id', 'title', 'due_date'],
    confirmationRequired: true, idempotent: true, supportsOptimisticLock: true, expiryMinutes: 10, risk: 'low',
  },
  'cases.update_due_date': {
    id: 'cases.update_due_date', module: 'cases', description: 'Cambiar la fecha límite de un trámite',
    table: 'service_cases', kind: 'update', requiredEntity: true, allowedFields: ['due_date'],
    forbiddenFields: ['workspace_id', 'id', 'title', 'status'],
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
