// Clasificación de errores del Asistente (P48) — PURO. Cada código produce un mensaje HUMANO + siguiente
// paso. Nunca stack traces, SQL ni UUIDs. Distingue "no hay datos" (vacío) de "error" (fallo real) de
// "resultado anterior válido" (anti-contradicción). El código va a un log seguro server-side; el usuario
// solo ve el mensaje humano.

import type { CrmEntity } from './intent'

export type AssistantErrorCode =
  | 'INTENT_UNCLEAR' | 'CONTEXT_MISSING' | 'AUTH_MISSING' | 'WORKSPACE_MISSING' | 'RLS_DENIED'
  | 'CLIENTS_READ_FAILED' | 'PROPERTIES_READ_FAILED' | 'OPERATIONS_READ_FAILED' | 'TASKS_READ_FAILED'
  | 'CALENDAR_READ_FAILED' | 'DOCUMENTS_READ_FAILED' | 'SERVICE_CASES_READ_FAILED' | 'COMMISSIONS_READ_FAILED'
  | 'N8N_UNAVAILABLE' | 'TOOL_TIMEOUT' | 'VALIDATION_FAILED' | 'UNKNOWN_ERROR'

const MESSAGES: Record<AssistantErrorCode, { message: string; nextStep: string }> = {
  INTENT_UNCLEAR: { message: 'No estoy seguro de qué necesitas.', nextStep: '¿Te refieres a clientes, inmuebles, operaciones o citas?' },
  CONTEXT_MISSING: { message: 'Me falta contexto para continuar.', nextStep: 'Dime sobre qué (cliente, inmueble u operación) quieres seguir.' },
  AUTH_MISSING: { message: 'Tu sesión ha caducado.', nextStep: 'Vuelve a iniciar sesión y repite la consulta.' },
  WORKSPACE_MISSING: { message: 'No he podido resolver tu cuenta de trabajo.', nextStep: 'Cierra sesión y vuelve a entrar.' },
  RLS_DENIED: { message: 'No tienes permiso para ver esos datos.', nextStep: 'Pide acceso al administrador del CRM.' },
  CLIENTS_READ_FAILED: { message: 'No he podido consultar los clientes por un problema de datos.', nextStep: 'Vuelve a intentarlo en unos segundos.' },
  PROPERTIES_READ_FAILED: { message: 'No he podido consultar la cartera por un problema de datos.', nextStep: 'Vuelve a intentarlo en unos segundos.' },
  OPERATIONS_READ_FAILED: { message: 'No he podido consultar las operaciones por un problema de datos.', nextStep: 'Vuelve a intentarlo en unos segundos.' },
  TASKS_READ_FAILED: { message: 'No he podido consultar las tareas por un problema de datos.', nextStep: 'Vuelve a intentarlo en unos segundos.' },
  CALENDAR_READ_FAILED: { message: 'No he podido consultar la agenda por un problema de datos.', nextStep: 'Vuelve a intentarlo en unos segundos.' },
  DOCUMENTS_READ_FAILED: { message: 'No he podido consultar los documentos por un problema de datos.', nextStep: 'Vuelve a intentarlo en unos segundos.' },
  SERVICE_CASES_READ_FAILED: { message: 'No he podido consultar los trámites por un problema de datos.', nextStep: 'Vuelve a intentarlo en unos segundos.' },
  COMMISSIONS_READ_FAILED: { message: 'No he podido consultar las comisiones por un problema de datos.', nextStep: 'Vuelve a intentarlo en unos segundos.' },
  N8N_UNAVAILABLE: { message: 'El asistente avanzado no está disponible ahora mismo.', nextStep: 'Para consultas básicas (clientes, inmuebles, citas) sigo funcionando.' },
  TOOL_TIMEOUT: { message: 'La consulta ha tardado demasiado.', nextStep: 'Prueba a acotarla o repítela en unos segundos.' },
  VALIDATION_FAILED: { message: 'No he entendido bien los datos de la consulta.', nextStep: 'Reformúlala con algo más de detalle.' },
  UNKNOWN_ERROR: { message: 'He tenido un problema técnico.', nextStep: 'Vuelve a intentarlo; si persiste, avisa al administrador.' },
}

export function errorInfo(code: AssistantErrorCode): { message: string; nextStep: string } {
  return MESSAGES[code] ?? MESSAGES.UNKNOWN_ERROR
}

// Mensaje completo listo para mostrar (humano, sin datos técnicos), con código embebido de forma discreta
// para soporte (no es un UUID ni SQL).
export function humanError(code: AssistantErrorCode): string {
  const info = errorInfo(code)
  return `${info.message} ${info.nextStep} (Código: ${code})`
}

// Código de "lectura fallida" por entidad → mapea el fallo de la tool al código correcto.
export function readFailedCodeFor(entity: CrmEntity): AssistantErrorCode {
  switch (entity) {
    case 'clients': return 'CLIENTS_READ_FAILED'
    case 'properties': return 'PROPERTIES_READ_FAILED'
    case 'operations': return 'OPERATIONS_READ_FAILED'
    case 'tasks': return 'TASKS_READ_FAILED'
    case 'calendar': return 'CALENDAR_READ_FAILED'
    case 'documents': return 'DOCUMENTS_READ_FAILED'
    case 'service_cases': return 'SERVICE_CASES_READ_FAILED'
    case 'commissions': return 'COMMISSIONS_READ_FAILED'
    default: return 'UNKNOWN_ERROR'
  }
}

// Un texto de respuesta es "seguro" si no filtra datos técnicos: sin UUID, sin SQL crudo, sin nombres de
// tabla evidentes, sin stack. Se usa en evals para proteger la propiedad "no forbidden data".
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const SQL_RE = /\b(select|insert|update|delete|from\s+["']?\w+["']?\s+where|join)\b/i
const STACK_RE = /\b(at\s+\w+\s*\(|TypeError|ReferenceError|undefined is not|cannot read propert)/i
export function isSafeAnswer(text: string): boolean {
  if (typeof text !== 'string') return false
  if (UUID_RE.test(text)) return false
  if (SQL_RE.test(text)) return false
  if (STACK_RE.test(text)) return false
  if (/workspace_id|service_role|storage_path/i.test(text)) return false
  return true
}
