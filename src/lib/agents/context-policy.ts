// Política de CONTEXTO y ANTI-CONTRADICCIÓN del Asistente (P48) — PURA.
//
// Principio: un resultado válido reciente NO puede ser contradicho por un error posterior sin explicación.
//   - success beats later transient error (para seguimientos de confirmación).
//   - un error NO borra el último resultado válido.
//   - "vacío" (0 filas) NO es lo mismo que "error".
//   - un seguimiento sin contexto suficiente → pedir aclaración, nunca error genérico.

import type { CrmEntity, FollowUpType } from './intent'

export type PriorRead = { entity: CrmEntity; count: number; ok: boolean } | null

export type FollowUpDecision =
  | 'use_fresh'            // consulta nueva/seguimiento con filtro → ejecutar normalmente
  | 'confirm_prior'        // seguimiento de confirmación con éxito previo → confirmar/resumir lo anterior
  | 'keep_prior_on_error'  // la revalidación falló pero había resultado válido → conservarlo
  | 'ask_clarify'          // seguimiento sin contexto suficiente → pedir aclaración

export function decideFollowUp(params: {
  followUpType: FollowUpType
  prior: PriorRead
  freshOk?: boolean | null // resultado de reconsultar (undefined/null = aún no se reconsultó)
}): FollowUpDecision {
  const { followUpType, prior } = params
  const freshOk = params.freshOk ?? null
  const priorOk = Boolean(prior && prior.ok)

  // Confirmación ("¿seguro?", "repite", "confírmame"): con éxito previo, confirmamos SIN re-consultar
  // (así es imposible contradecirlo). Si por lo que sea se reconsultó y falló, conservamos el previo.
  if (followUpType === 'confirm') {
    if (priorOk && freshOk === false) return 'keep_prior_on_error'
    if (priorOk) return 'confirm_prior'
    return 'ask_clarify'
  }

  // Regla transversal: si se reconsultó y falló pero había resultado válido → no lo borres.
  if (freshOk === false && priorOk) return 'keep_prior_on_error'

  // Seguimiento (filtro/referencia/detalle) sin contexto previo → pedir aclaración.
  if (followUpType !== 'none' && !priorOk) return 'ask_clarify'

  return 'use_fresh'
}

// ¿La respuesta a un seguimiento debe evitar reconsultar la BD? (confirmación con éxito previo).
export function shouldAnswerFromPrior(decision: FollowUpDecision): boolean {
  return decision === 'confirm_prior' || decision === 'keep_prior_on_error'
}

// Prefacio honesto cuando usamos un resultado anterior porque la revalidación falló.
export function stalePreface(): string {
  return 'La última consulta válida mostraba estos resultados; no he podido revalidarlos ahora, pero no los sustituyo por un error:'
}

// Confirmación de un resultado previo (sin reconsultar): resume cuántos había.
export function confirmPriorText(prior: PriorRead): string {
  if (!prior || !prior.ok) return 'No tengo un resultado anterior que confirmar. ¿Qué necesitas exactamente?'
  const label = ENTITY_LABEL[prior.entity] ?? 'resultados'
  if (prior.count <= 0) return `La última consulta no devolvió ${label}.`
  return `Sí: la última consulta válida mostraba ${prior.count} ${label}. ¿Quieres que los detalle o que filtre por algún criterio?`
}

const ENTITY_LABEL: Record<CrmEntity, string> = {
  clients: 'clientes', properties: 'inmuebles', operations: 'operaciones', commissions: 'comisiones',
  calendar: 'citas', tasks: 'tareas', service_cases: 'trámites', documents: 'documentos',
  invoicing: 'facturas', help: 'opciones', unknown: 'resultados',
}
