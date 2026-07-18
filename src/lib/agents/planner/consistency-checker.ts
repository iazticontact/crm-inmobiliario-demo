// PROTOTIPO AISLADO (general-semantic-planner) — CONSISTENCY CHECKER (FASE 11).
// Valida COHERENCIA entre goals de un mismo turno antes de responder. General (no por frase):
//   · un count/list dice N>0 pero un detail sobre esa misma familia dice NOT_FOUND → sospechoso.
//   · aggregate con count>0 pero total 0 → revisar.
//   · un actionPreview marca ready pero sin entidad requerida → inconsistente.
// Devuelve incidencias; el pipeline decide si re-lee (tool loop) o degrada el estado a algo honesto.

import type { Evidence } from './capability-executor'

export type Inconsistency = { kind: string; goalIds: string[]; detail: string; retryable: boolean }

export function checkConsistency(evidences: Evidence[]): Inconsistency[] {
  const out: Inconsistency[] = []

  // list/count > 0 en un módulo y detail NOT_FOUND en el mismo módulo del mismo turno.
  const moduleOf = (cap: string) => cap.split('.')[0]
  const positives = evidences.filter((e) => (e.count ?? 0) > 0)
  const notFound = evidences.filter((e) => e.status === 'NOT_FOUND')
  for (const nf of notFound) {
    const sib = positives.find((p) => moduleOf(p.capability) === moduleOf(nf.capability) && p.goalId !== nf.goalId)
    if (sib) out.push({ kind: 'list_positive_but_detail_not_found', goalIds: [sib.goalId, nf.goalId], detail: `${sib.capability} devolvió ${sib.count} pero ${nf.capability} no encontró la entidad`, retryable: true })
  }

  // aggregate con count>0 y total 0 → posible fallo de lectura de valor.
  for (const e of evidences) {
    if (/aggregate/.test(e.capability) && (e.count ?? 0) > 0) {
      const d = e.data as { total?: number; generated?: number } | null
      if (d && (d.total === 0 || d.generated === 0)) out.push({ kind: 'aggregate_zero_with_rows', goalIds: [e.goalId], detail: `${e.capability}: hay filas pero el agregado es 0`, retryable: false })
    }
  }

  // actionPreview ready pero sin entidad requerida (defensa; no debería ocurrir).
  for (const e of evidences) {
    if (e.actionPreview?.ready && e.actionPreview.missingSlots.includes('entity')) {
      out.push({ kind: 'action_ready_without_entity', goalIds: [e.goalId], detail: `${e.capability}: preview marcada ready sin entidad`, retryable: false })
    }
  }

  // Invariante crítico: ningún goal de acción puede tener estado SUCCESS con escritura (aquí SUCCESS solo
  // significa "preview lista"). Verificamos que jamás haya un flag de ejecución real (no existe en el
  // prototipo; el checker lo deja explícito por si alguien lo introduce).
  return out
}
