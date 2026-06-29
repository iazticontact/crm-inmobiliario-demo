// Evals del mapa funcional del producto (P14). Sin runner en el repo; este fichero documenta y permite
// verificar que `src/lib/product-capabilities.ts` describe el estado REAL de Configuración (cero humo)
// y que su resumen para el Asistente no contiene términos prohibidos ni funciones inventadas.

import {
  PRODUCT_CAPABILITIES,
  getCapability,
  configCapabilitiesSummary,
  type CapabilityState,
} from '@/lib/product-capabilities'

// Estado esperado de cada bloque visible de Configuración (alineado con la UI y el prompt del Asistente).
// P16: sin "Notificaciones" ni roadmap; Perfil (solo lectura) + Workspace/Empresa (editable) + Equipo.
export const EXPECTED_STATES: Record<string, CapabilityState> = {
  'settings.profile': 'readonly',
  'settings.workspace': 'configurable',
  'settings.team': 'active',
  'settings.assistant': 'active',
}

// Términos que NUNCA deben aparecer en explicaciones de cara al usuario.
const FORBIDDEN_TERMS = ['lead', 'pipeline', 'oportunidad', 'expediente', 'score', 'copiloto']
// Funciones que el Asistente NO debe inventar al hablar de Configuración.
const INVENTED_TERMS = ['zonas', 'plantillas', 'permisos avanzados', 'tipos de inmueble']

export function runProductCapabilitiesEvals(): string[] {
  const failures: string[] = []

  for (const [id, expected] of Object.entries(EXPECTED_STATES)) {
    const cap = getCapability(id)
    if (!cap) { failures.push(`falta capability: ${id}`); continue }
    if (cap.state !== expected) failures.push(`${id}: estado ${cap.state}, esperado ${expected}`)
  }

  // P16: ya NO existe una sección de Notificaciones en Configuración (no roadmap visible).
  if (getCapability('settings.notifications')) failures.push('no debería existir settings.notifications (P16: notificaciones fuera)')

  // Workspace/Empresa es editable de verdad.
  const ws = getCapability('settings.workspace')
  if (!ws?.canDo?.some((a) => /descripci[oó]n/i.test(a))) failures.push('settings.workspace debería permitir editar la descripción')

  // Equipo SÍ es activo y permite invitar.
  const team = getCapability('settings.team')
  if (!team?.canDo?.some((a) => /invitar/i.test(a))) failures.push('settings.team debería permitir invitar')

  // El resumen para el Asistente: sin términos prohibidos, sin funciones inventadas y sin "próximamente".
  const summary = configCapabilitiesSummary().toLowerCase()
  for (const t of FORBIDDEN_TERMS) {
    if (summary.includes(t)) failures.push(`resumen contiene término prohibido: "${t}"`)
  }
  for (const t of INVENTED_TERMS) {
    if (summary.includes(t)) failures.push(`resumen contiene función inventada: "${t}"`)
  }
  if (summary.includes('próximamente') || summary.includes('proximamente')) {
    failures.push('resumen no debería contener "Próximamente" (P16)')
  }

  // Todas las capabilities marcadas explicables deben tener explicación de usuario.
  for (const c of PRODUCT_CAPABILITIES) {
    if (c.assistantCanExplain && !c.userExplanation.trim()) failures.push(`${c.id}: sin userExplanation`)
  }

  return failures
}
