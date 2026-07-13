// CONTRATO UI COMPARTIDO del Asistente (P70 Wave A) — única definición para route y frontend.
// La UI NUNCA parsea texto para pintar tarjetas: consume este bloque estructurado. El texto (`answer`)
// sigue siendo SIEMPRE el fallback. Validación runtime incluida (sin dependencias).

export type AssistantUiMessageKind =
  | 'text' | 'explanation' | 'data' | 'summary' | 'detail'
  | 'action_preview' | 'action_status' | 'action_result'
  | 'automation_preview' | 'automation_status' | 'automation_result'
  | 'finding' | 'partial' | 'error'

export type AssistantUiAction =
  | 'confirm' | 'cancel' | 'modify' | 'retry' | 'open_entity'
  | 'enable' | 'disable' | 'run_now' | 'view_runs'
  | 'acknowledge' | 'resolve' | 'dismiss' | 'explain'

export type AssistantActionUiState = {
  actionId: string            // id corto/seguro; el server resuelve el resto
  actionType: string
  status: 'prepared' | 'confirmed' | 'executing' | 'completed' | 'cancelled' | 'expired' | 'superseded' | 'conflict' | 'partial' | 'failed'
  title: string
  entityLabel?: string
  fields: Array<{ key: string; label: string; currentValue?: string; proposedValue?: string }>
  expiresAt?: string
  verified: boolean
  allowedUiActions: AssistantUiAction[]
  safeErrorCode?: string
}

export type AssistantAutomationUiState = {
  ruleId?: string
  type: string
  name: string
  status: 'prepared' | 'awaiting_confirmation' | 'enabled' | 'disabled' | 'running' | 'completed' | 'partial' | 'failed' | 'skipped_duplicate'
  scheduleLabel: string
  timezone: string
  nextRunAt?: string
  lastRunAt?: string
  findingCount?: number
  allowedUiActions: AssistantUiAction[]
}

export type AssistantFindingUiState = {
  findingId: string
  severity: 'info' | 'warning' | 'critical'
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed'
  title: string
  summary: string
  criterion: string
  module?: string
  entityLabel?: string
  detectedAt: string
  allowedUiActions: AssistantUiAction[]
}

export type AssistantUiPayload = {
  kind: AssistantUiMessageKind
  action?: AssistantActionUiState
  automation?: AssistantAutomationUiState
  findings?: AssistantFindingUiState[]
}

const KINDS: ReadonlySet<string> = new Set(['text', 'explanation', 'data', 'summary', 'detail', 'action_preview', 'action_status', 'action_result', 'automation_preview', 'automation_status', 'automation_result', 'finding', 'partial', 'error'])
const ACTION_STATUSES: ReadonlySet<string> = new Set(['prepared', 'confirmed', 'executing', 'completed', 'cancelled', 'expired', 'superseded', 'conflict', 'partial', 'failed'])
const UI_ACTIONS: ReadonlySet<string> = new Set(['confirm', 'cancel', 'modify', 'retry', 'open_entity', 'enable', 'disable', 'run_now', 'view_runs', 'acknowledge', 'resolve', 'dismiss', 'explain'])

// Validación runtime: si el bloque no cumple el contrato → null (la UI cae al texto; nunca rompe el chat).
export function validateAssistantUi(ui: unknown): AssistantUiPayload | null {
  if (!ui || typeof ui !== 'object') return null
  const u = ui as AssistantUiPayload
  if (!KINDS.has(String(u.kind))) return null
  if (u.action) {
    const a = u.action
    if (typeof a.actionId !== 'string' || !a.actionId || typeof a.title !== 'string') return null
    if (!ACTION_STATUSES.has(String(a.status))) return null
    if (!Array.isArray(a.fields) || !Array.isArray(a.allowedUiActions)) return null
    if (!a.allowedUiActions.every((x) => UI_ACTIONS.has(String(x)))) return null
    // Nunca UUIDs completos visibles como id: se admite pero la UI debe truncar; tokens jamás.
    if (/token|secret/i.test(JSON.stringify(a))) return null
  }
  if (u.automation) {
    const m = u.automation
    if (typeof m.type !== 'string' || typeof m.name !== 'string' || typeof m.scheduleLabel !== 'string') return null
    if (!Array.isArray(m.allowedUiActions) || !m.allowedUiActions.every((x) => UI_ACTIONS.has(String(x)))) return null
  }
  if (u.findings) {
    if (!Array.isArray(u.findings)) return null
    for (const f of u.findings) {
      if (typeof f.findingId !== 'string' || typeof f.title !== 'string' || typeof f.criterion !== 'string') return null
      if (!['info', 'warning', 'critical'].includes(String(f.severity))) return null
    }
  }
  return u
}
