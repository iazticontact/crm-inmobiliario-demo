// Evals de detailLevel/expand (P22). Sin runner en el repo; `runExpandEvals()` verifica la parte pura:
// allowlist de expand, caps de payload y el mapa de relaciones por entidad. La expansión real (queries)
// se prueba en staging (requiere datos + Supabase).

import { EXPAND_ALLOWED, EXPAND_SPECS, REL_CAP, EXPAND_PRIMARY_CAP } from '@/lib/agent-tool-readers'

// Reproduce la resolución de claves de expand de crm_read_query (rawExpand + default por detailLevel,
// filtrado por allowlist).
function resolveExpand(entity: string, detailLevel: string, rawExpand: string[]): string[] {
  const defaultExpand = detailLevel === 'full' ? Object.keys(EXPAND_SPECS[entity] ?? {}) : []
  return [...new Set([...rawExpand.map((s) => s.toLowerCase()), ...defaultExpand])].filter((k) => EXPAND_ALLOWED.has(k))
}

export function runExpandEvals(): string[] {
  const fail: string[] = []

  // Allowlist: acepta las relaciones válidas, rechaza arbitrarias.
  for (const k of ['operation', 'property', 'events', 'tasks', 'service_case', 'documents', 'activity']) {
    if (!EXPAND_ALLOWED.has(k)) fail.push(`EXPAND_ALLOWED debería incluir "${k}"`)
  }
  if (EXPAND_ALLOWED.has('drop_table') || EXPAND_ALLOWED.has('secrets')) fail.push('EXPAND_ALLOWED no debería incluir claves arbitrarias')

  // Caps de protección de payload.
  if (REL_CAP > 10) fail.push('REL_CAP demasiado alto (riesgo de payload)')
  if (EXPAND_PRIMARY_CAP > 10) fail.push('EXPAND_PRIMARY_CAP demasiado alto')

  // Mapa de relaciones por entidad principal.
  if (!EXPAND_SPECS.clients?.operation || !EXPAND_SPECS.clients?.events || !EXPAND_SPECS.clients?.tasks || !EXPAND_SPECS.clients?.service_case) {
    fail.push('clients debería poder expandir operaciones/citas/tareas/trámites')
  }
  if (!EXPAND_SPECS.properties?.operation || !EXPAND_SPECS.properties?.events) {
    fail.push('properties debería poder expandir operaciones/citas')
  }
  // Cada spec apunta a un FK y una tabla coherentes.
  for (const [entity, specs] of Object.entries(EXPAND_SPECS)) {
    for (const [key, spec] of Object.entries(specs)) {
      if (!spec?.table || !spec?.fk || !spec?.outKey) fail.push(`spec ${entity}.${key} incompleta`)
    }
  }

  // Resolución: full aplica el set por defecto; expand arbitrario se descarta.
  if (resolveExpand('clients', 'full', []).length === 0) fail.push('detailLevel=full debería expandir clients por defecto')
  if (resolveExpand('clients', 'summary', ['operation']).join() !== 'operation') fail.push('expand explícito (operation) debería resolverse en summary')
  if (resolveExpand('clients', 'summary', ['hack', 'operation']).includes('hack')) fail.push('expand arbitrario "hack" debería filtrarse')
  if (resolveExpand('clients', 'summary', []).length !== 0) fail.push('sin expand ni full, no debería expandir')

  return fail
}
