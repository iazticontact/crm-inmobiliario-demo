// Evals P67 — transiciones de estado de Cartera, parsers de acciones ampliadas y registro coherente.

import { PORTFOLIO_TRANSITIONS, isValidPortfolioTransition, ASSISTANT_ACTIONS, getActionDefinition } from '@/lib/agents/action-registry'
import { parseActionIntent } from '@/lib/agents/assistant-action-intent'

export function runP67Evals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // A) Transiciones: coherentes con el producto real; las imposibles se rechazan.
  ok(isValidPortfolioTransition('listed', 'under_contract'), 'listed → reservado válida')
  ok(isValidPortfolioTransition('under_contract', 'sold'), 'reservado → vendido válida')
  ok(isValidPortfolioTransition('prospecting', 'listed'), 'preparación → publicado válida')
  ok(!isValidPortfolioTransition('sold', 'listed'), 'vendido → publicado INVÁLIDA')
  ok(!isValidPortfolioTransition('sold', 'under_contract'), 'vendido → reservado INVÁLIDA')
  ok(isValidPortfolioTransition('sold', 'archived'), 'vendido → archivado válida')
  ok(Object.keys(PORTFOLIO_TRANSITIONS).length >= 6, 'matriz cubre los estados reales')

  // B) Registro ampliado: nuevas acciones con las mismas garantías.
  for (const id of ['clients.update_email', 'tasks.update_due_date', 'portfolio.update_status'] as const) {
    const d = ASSISTANT_ACTIONS[id]
    ok(!!d && d.confirmationRequired && d.idempotent && d.supportsOptimisticLock, `${id}: garantías completas`)
    ok(d.forbiddenFields.includes('workspace_id'), `${id}: workspace prohibido`)
  }
  ok(getActionDefinition('invoices.update') === null, 'Facturación sigue inexistente')

  // C) Parsers nuevos.
  const email = parseActionIntent('Cambia el email de David Iglesias a david@test.com')
  ok(email?.act === 'prepare' && email.actionType === 'clients.update_email' && email.proposedChanges.email === 'david@test.com', 'update_email parseado')
  const due = parseActionIntent('Cambia la fecha de la tarea llamar a David a mañana')
  ok(due?.act === 'prepare' && due.actionType === 'tasks.update_due_date' && typeof due.proposedChanges.due_date === 'string', 'update_due_date parseado')
  const st = parseActionIntent('Marca Avenida San Pedro 66 como reservado')
  ok(st?.act === 'prepare' && st.actionType === 'portfolio.update_status' && st.proposedChanges.status === 'under_contract' && /San Pedro 66/.test(String(st.entityText)), 'update_status parseado (reservado→under_contract)')
  const sold = parseActionIntent('Marca el piso Calle Mayor 14 como vendido')
  ok(sold?.act === 'prepare' && sold.proposedChanges.status === 'sold', 'vendido → sold')
  // D) Sin falsos positivos: lecturas de estado NO son acciones.
  ok(parseActionIntent('muéstrame los vendidos') === null, '«muéstrame los vendidos» no es acción')
  ok(parseActionIntent('¿cuáles están reservados?') === null, 'lectura de reservados no es acción')
  // «marca como hecha la tarea» sigue siendo tasks.complete (no update_status).
  const done2 = parseActionIntent('Marca como hecha la tarea de llamar a David')
  ok(done2?.act === 'prepare' && done2.actionType === 'tasks.complete', 'tasks.complete intacto')

  return fail
}
