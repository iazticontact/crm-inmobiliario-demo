// Evals de la política de CONTEXTO / ANTI-CONTRADICCIÓN (P48) — propiedades, no frases.
// Un resultado válido reciente no puede ser borrado por un error posterior; empty ≠ error; un seguimiento
// sin contexto pide aclaración (no error genérico).

import { decideFollowUp, shouldAnswerFromPrior, confirmPriorText, type PriorRead } from '@/lib/agents/context-policy'

export function runContextEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const priorOk: PriorRead = { entity: 'clients', count: 9, ok: true }

  // Confirmación con éxito previo → confirmar (sin reconsultar → imposible contradecir).
  ok(decideFollowUp({ followUpType: 'confirm', prior: priorOk }) === 'confirm_prior', 'confirm + prior ok → confirm_prior')
  // Confirmación con éxito previo pero revalidación fallida → conservar el previo (no error).
  ok(decideFollowUp({ followUpType: 'confirm', prior: priorOk, freshOk: false }) === 'keep_prior_on_error', 'confirm + fresh fail → keep_prior')
  // Confirmación sin contexto → pedir aclaración.
  ok(decideFollowUp({ followUpType: 'confirm', prior: null }) === 'ask_clarify', 'confirm sin prior → ask_clarify')

  // Regla transversal: cualquier reconsulta fallida NO borra un resultado válido.
  ok(decideFollowUp({ followUpType: 'filter', prior: priorOk, freshOk: false }) === 'keep_prior_on_error', 'error no borra resultado válido')
  // Filtro con contexto → consulta nueva.
  ok(decideFollowUp({ followUpType: 'filter', prior: priorOk }) === 'use_fresh', 'filtro con prior → use_fresh')
  // Seguimiento sin contexto → aclarar.
  ok(decideFollowUp({ followUpType: 'reference', prior: null }) === 'ask_clarify', 'referencia sin prior → ask_clarify')
  // Consulta normal (no seguimiento) → fresca.
  ok(decideFollowUp({ followUpType: 'none', prior: null }) === 'use_fresh', 'none → use_fresh')
  ok(decideFollowUp({ followUpType: 'none', prior: priorOk }) === 'use_fresh', 'none con prior → use_fresh')

  // Empty ≠ error: un prior con count 0 pero ok=true sigue siendo "válido" (no error).
  const priorEmpty: PriorRead = { entity: 'properties', count: 0, ok: true }
  ok(decideFollowUp({ followUpType: 'confirm', prior: priorEmpty }) === 'confirm_prior', 'confirm sobre vacío-válido → confirm (no error)')

  // shouldAnswerFromPrior.
  ok(shouldAnswerFromPrior('confirm_prior') && shouldAnswerFromPrior('keep_prior_on_error'), 'answer-from-prior en confirm/keep')
  ok(!shouldAnswerFromPrior('use_fresh') && !shouldAnswerFromPrior('ask_clarify'), 'no answer-from-prior en fresh/clarify')

  // confirmPriorText: menciona el recuento; sin prior pide aclaración.
  ok(/\b9\b/.test(confirmPriorText(priorOk)) && /clientes/.test(confirmPriorText(priorOk)), 'confirmPriorText menciona 9 clientes')
  ok(confirmPriorText(null).includes('?'), 'confirmPriorText sin prior pide aclaración')

  return fail
}
