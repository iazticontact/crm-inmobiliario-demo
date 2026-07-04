// Evals de la política de ERRORES y del guard "no forbidden data" (P48) — propiedades.
// Todo código produce mensaje humano + siguiente paso; ninguna respuesta filtra UUID/SQL/stack/técnico.

import {
  errorInfo, humanError, readFailedCodeFor, isSafeAnswer, type AssistantErrorCode,
} from '@/lib/agents/assistant-errors'
import type { CrmEntity } from '@/lib/agents/intent'

const ALL_CODES: AssistantErrorCode[] = [
  'INTENT_UNCLEAR', 'CONTEXT_MISSING', 'AUTH_MISSING', 'WORKSPACE_MISSING', 'RLS_DENIED',
  'CLIENTS_READ_FAILED', 'PROPERTIES_READ_FAILED', 'OPERATIONS_READ_FAILED', 'TASKS_READ_FAILED',
  'CALENDAR_READ_FAILED', 'DOCUMENTS_READ_FAILED', 'SERVICE_CASES_READ_FAILED', 'COMMISSIONS_READ_FAILED',
  'N8N_UNAVAILABLE', 'TOOL_TIMEOUT', 'VALIDATION_FAILED', 'UNKNOWN_ERROR',
]

export function runErrorPolicyEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // Cada código: mensaje + siguiente paso no vacíos, y la respuesta humana es "segura" (sin datos técnicos).
  for (const code of ALL_CODES) {
    const info = errorInfo(code)
    ok(info.message.length > 5 && info.nextStep.length > 5, `${code}: mensaje/nextStep no vacíos`)
    const h = humanError(code)
    ok(h.includes(code), `${code}: humanError incluye el código`)
    ok(isSafeAnswer(h), `${code}: humanError es seguro (sin datos técnicos)`)
  }

  // readFailedCodeFor mapea por entidad.
  const map: [CrmEntity, AssistantErrorCode][] = [
    ['clients', 'CLIENTS_READ_FAILED'], ['properties', 'PROPERTIES_READ_FAILED'],
    ['operations', 'OPERATIONS_READ_FAILED'], ['tasks', 'TASKS_READ_FAILED'],
    ['calendar', 'CALENDAR_READ_FAILED'], ['documents', 'DOCUMENTS_READ_FAILED'],
    ['service_cases', 'SERVICE_CASES_READ_FAILED'], ['commissions', 'COMMISSIONS_READ_FAILED'],
  ]
  for (const [e, c] of map) ok(readFailedCodeFor(e) === c, `readFailedCodeFor(${e}) = ${c}`)

  // isSafeAnswer: rechaza datos prohibidos, acepta texto limpio.
  ok(!isSafeAnswer('cliente id 550e8400-e29b-41d4-a716-446655440000'), 'rechaza UUID')
  ok(!isSafeAnswer('SELECT * FROM clients WHERE workspace_id = x'), 'rechaza SQL')
  ok(!isSafeAnswer('TypeError: cannot read property of undefined'), 'rechaza stack/técnico')
  ok(!isSafeAnswer('fallo en workspace_id nulo'), 'rechaza workspace_id')
  ok(!isSafeAnswer('usa el service_role para leer'), 'rechaza service_role')
  ok(isSafeAnswer('Tienes 9 clientes registrados: Javier Ortega — javier@example.com'), 'acepta respuesta limpia')
  ok(isSafeAnswer('No hay clientes registrados todavía.'), 'acepta vacío honesto')

  return fail
}
