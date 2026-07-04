// Capa de PERMISOS de herramientas por turno (P50) — PURA. Fuente única de verdad de qué tools puede usar
// el turno actual. Regla: si el turno NO es de datos → allowedTools=[] (ni el motor local, ni n8n, ni el
// legacy pueden leer). Facturación nunca autoriza tools desde el Asistente general. Las escrituras solo
// autorizan "write_prepare" (nunca ejecutan sin confirmación).

import type { AssistantTurnDecision, TurnDomain } from './assistant-turn'

// Nombres lógicos de tool (dominio.acción). El backend los mapea a los readers concretos.
export type AssistantTool = `${Exclude<TurnDomain, null>}.${'read' | 'search' | 'write_prepare'}`

const READ_DOMAINS: ReadonlySet<Exclude<TurnDomain, null>> = new Set([
  'clients', 'properties', 'operations', 'commissions', 'calendar', 'tasks', 'cases', 'documents',
])

// Herramientas SIEMPRE prohibidas desde la ruta del Asistente (Facturación aislada).
export const FORBIDDEN_ASSISTANT_TOOLS: ReadonlySet<string> = new Set([
  'invoicing.read', 'invoicing.search', 'get_invoices_summary',
])

export function allowedToolsForTurn(decision: AssistantTurnDecision): AssistantTool[] {
  // Cualquier turno que no lea/escriba datos → sin tools (meta, corrección, queja, capacidad, cómo-funciona,
  // hipotético, social, ayuda, aclaración, ambiguo).
  if (!decision.shouldReadData && !decision.shouldWriteData) return []
  const d = decision.domain
  if (!d || d === 'invoicing' || d === 'assistant' || d === 'general') return []
  if (decision.shouldWriteData) return READ_DOMAINS.has(d) ? [`${d}.write_prepare` as AssistantTool] : []
  if (decision.shouldReadData && READ_DOMAINS.has(d)) return [`${d}.read` as AssistantTool, `${d}.search` as AssistantTool]
  return []
}

export function isToolAllowed(decision: AssistantTurnDecision, tool: string): boolean {
  if (FORBIDDEN_ASSISTANT_TOOLS.has(tool)) return false
  return (allowedToolsForTurn(decision) as string[]).includes(tool)
}

// Enforcement independiente del turno: ¿es una tool prohibida en la ruta del Asistente pase lo que pase?
export function isForbiddenAssistantTool(tool: string): boolean {
  return FORBIDDEN_ASSISTANT_TOOLS.has(tool)
}
