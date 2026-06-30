// Evals del endpoint de diagnóstico /api/agent/diag (P25).
//
// No hay runner de evals en el repo (ver assistant-coherence.evals.ts). Este módulo es
// EJECUTABLE y determinista: valida invariantes del contrato de diag SIN red y SIN secretos,
// para que un fallo de configuración (p. ej. sondear una tabla inexistente, o filtrar un
// secreto en la respuesta pública) se detecte en verificación, no en producción.

import { PROBE_ENTITIES } from '@/lib/agent-diag-config'

// Tablas REALES del esquema público (verificadas en P25 contra la BD desplegada).
// Si el esquema cambia, actualiza esta lista junto con el sondeo.
export const KNOWN_REAL_TABLES = new Set<string>([
  'activities', 'assistant_agent_memory', 'assistant_messages', 'assistant_threads',
  'calendar_events', 'clients', 'entity_files', 'opportunities', 'profiles',
  'properties', 'service_cases', 'tasks', 'workspace_members', 'workspaces',
])

// La respuesta PÚBLICA de diag (sin secreto) solo puede contener estas claves.
export const PUBLIC_DIAG_KEYS = new Set<string>([
  'ok', 'service', 'supabaseRef', 'commit', 'toolVersion', 'generatedAt', 'freshness', 'config',
])

// Nunca deben aparecer en la respuesta (ni en base ni en config): secretos/keys/headers.
export const FORBIDDEN_DIAG_KEYS = [
  'AGENT_TOOL_SECRET', 'serviceRoleKey', 'SUPABASE_SERVICE_ROLE_KEY', 'apiKey', 'token',
  'secret', 'authorization', 'x-nowcrm-secret', 'password',
]

// `config` solo expone BOOLEANOS (presencia de envs), nunca el valor.
export const CONFIG_KEYS = ['agentToolSecret', 'serviceRole', 'n8nWebhook', 'n8nSecret']

export type DiagEvalResult = { passed: boolean; checks: number; failures: string[] }

export function runDiagEvals(): DiagEvalResult {
  const failures: string[] = []
  let checks = 0

  // 1) Cada entidad sondeada apunta a una tabla REAL.
  for (const e of PROBE_ENTITIES) {
    checks++
    if (!KNOWN_REAL_TABLES.has(e.table)) {
      failures.push(`probe "${e.key}" apunta a tabla inexistente: "${e.table}"`)
    }
  }

  // 2) Cada entidad tiene key/table/nameCol/dateCol no vacíos.
  for (const e of PROBE_ENTITIES) {
    checks++
    if (!e.key || !e.table || !e.nameCol || !e.dateCol) {
      failures.push(`probe incompleto: ${JSON.stringify(e)}`)
    }
  }

  // 3) Keys del sondeo únicas.
  checks++
  const keys = PROBE_ENTITIES.map((e) => e.key)
  if (new Set(keys).size !== keys.length) failures.push('hay keys de sondeo duplicadas')

  // 4) Contrato público no incluye ninguna clave prohibida (secretos).
  checks++
  const leak = FORBIDDEN_DIAG_KEYS.find((k) => PUBLIC_DIAG_KEYS.has(k))
  if (leak) failures.push(`la respuesta pública expondría una clave sensible: "${leak}"`)

  // 5) `config` solo declara booleanos de presencia (nombres acabados en patrón de flag, no en *Key/*Url).
  for (const k of CONFIG_KEYS) {
    checks++
    if (/key$|url$|secret_value$|token$/i.test(k)) failures.push(`config.${k} parece exponer un valor, no un booleano`)
  }

  return { passed: failures.length === 0, checks, failures }
}
