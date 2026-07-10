// Evals del runtime de CARTERA (P63) — invariante anti-secuestro: una petición EXPLÍCITA de inmuebles
// jamás puede terminar en Tareas/Agenda/Calendario. Causa raíz cerrada: 'todo' (palabra española) estaba
// como señal de tasks en el clasificador y como `to ?do` en el gate de agenda.

import { decideTurn } from '@/lib/agents/assistant-turn'
import { classifyIntent } from '@/lib/agents/intent'
import { parseStatusIntent } from '@/lib/portfolio-domain'

export function runPortfolioRuntimeEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // A) INVARIANTE portfolioPromptMustNeverSelectTasks — módulo explícito del mensaje actual manda.
  const portfolioPrompts = [
    'Lístame todo lo que tengo en inmuebles', 'Resúmeme mis inmuebles', 'Qué tengo en cartera',
    'Todo lo de propiedades', 'Cuántos pisos tengo', 'Muéstrame la cartera', 'Dime los publicados',
    'quiero que me digas todo lo de inmuebles que tengo, resúmeme', 'dame todos los inmuebles',
  ]
  for (const q of portfolioPrompts) {
    const e = classifyIntent(q).entity
    ok(e !== 'tasks' && e !== 'calendar', `no task-hijack: "${q}" (entity=${e})`)
    const d = decideTurn(q)
    // El routing captura además los ambiguos con intención de estado + vocab de inmuebles (gate P63).
    const routedByStatusGate = d.turnType === 'ambiguous' && parseStatusIntent(q) !== null && e === 'properties'
    ok(d.shouldReadData || d.turnType === 'module_explanation' || routedByStatusGate, `portfolio lee o explica: "${q}" (${d.turnType})`)
  }
  // La palabra «todo» NUNCA es señal de tareas por sí sola.
  ok(classifyIntent('lístame todo lo que tengo en inmuebles').entity === 'properties', '«todo…inmuebles» → properties')
  ok(classifyIntent('enséñame todo').entity !== 'tasks', '«todo» a secas no es tasks')
  // Tareas reales siguen siendo tareas.
  ok(classifyIntent('lista mis tareas pendientes').entity === 'tasks', 'tareas reales → tasks')
  ok(classifyIntent('¿qué tengo pendiente?').entity === 'tasks', 'pendiente → tasks')

  // B) «todo lo de inmuebles» → listado completo (todos los estados, sin excluir vendidos).
  ok(parseStatusIntent('lístame todo lo que tengo en inmuebles') === 'all', 'todo…inmuebles → all')
  ok(parseStatusIntent('todo lo de cartera') === 'all', 'todo lo de cartera → all')
  ok(parseStatusIntent('muéstrame todos los inmuebles') === 'all', 'todos los inmuebles → all')
  // Estados concretos intactos (P56).
  ok(parseStatusIntent('muéstrame los publicados') === 'published', 'publicados')
  ok(parseStatusIntent('¿y vendidos?') === 'sold', 'vendidos')

  // C) Corrección «no te he pedido tareas, te he pedido inmuebles» → meta/corrección, sin leer tareas.
  const corr = decideTurn('No te he pedido tareas, te he pedido inmuebles')
  ok(!corr.shouldReadData, 'corrección no lee')

  // D) Cambio de módulo: tareas → inmuebles y viceversa sin arrastre.
  ok(decideTurn('muéstrame los inmuebles', { priorModule: 'tasks' }).module === 'portfolio', 'tasks→portfolio limpio')
  ok(decideTurn('lista mis tareas', { priorModule: 'portfolio' }).module === 'tasks', 'portfolio→tasks limpio')

  // E) Tiempo real: pregunta conceptual sobre relectura no es corrección ni tarea.
  const rt = decideTurn('si modifico el precio y te pregunto otra vez, ¿lo ves?')
  ok(rt.turnType !== 'data_read' || rt.domain !== 'tasks', 'pregunta de tiempo real no va a tasks')

  return fail
}
