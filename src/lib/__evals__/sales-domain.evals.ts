// Evals de la capa de VENTAS/VENDIDOS transversal (P58) — PURAS. Clase de fallo del transcript:
// «cuántos he vendido» no debe caer a n8n ni decir «no consta ninguna operación vendida»; debe leer
// Cartera + Operaciones según el alcance, con scope honesto y correcciones de alcance.

import { parseSalesIntent, SALES_DIFFERENCE_EXPLANATION } from '@/lib/sales-domain'
import { decideTurn, type TurnType } from '@/lib/agents/assistant-turn'

// Espejo del gate de tryLocalAnswer: los turnos en los que la capa de ventas se evalúa.
const SALES_TURNS: TurnType[] = ['data_read', 'data_followup', 'ambiguous']
function isCaught(q: string): boolean {
  const d = decideTurn(q)
  return SALES_TURNS.includes(d.turnType) && d.domain !== 'invoicing' && parseSalesIntent(q) !== null
}

export function runSalesDomainEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // A) Todas las frases del transcript/objetivo se CAPTURAN localmente (no caen a n8n).
  for (const q of [
    'Como que no, a ver cuantos he vendido?', 'En cartera o en operaciones no he vendido nada?',
    '¿Cuántos he vendido?', '¿He vendido algo?', '¿Tengo algún inmueble vendido?',
    '¿Cuántos inmuebles he vendido?', '¿Cuántas operaciones he cerrado?', '¿Cuántas ventas tengo?',
    '¿Qué he vendido?', '¿Qué pisos he vendido?', '¿Qué propiedades están vendidas?',
    '¿Qué operaciones están ganadas?', '¿Qué operaciones están cerradas?', 'muéstrame los vendidos',
  ]) ok(isCaught(q), `capturada localmente: "${q}"`)

  // B) Alcance correcto.
  const scope = (q: string) => parseSalesIntent(q)?.scope
  ok(scope('¿cuántos he vendido?') === 'both', 'cuántos he vendido → both')
  ok(scope('¿he vendido algo?') === 'both', 'he vendido algo → both')
  ok(scope('¿tengo algún inmueble vendido?') === 'portfolio_only', 'inmueble vendido → portfolio')
  ok(scope('¿qué pisos he vendido?') === 'portfolio_only', 'pisos vendidos → portfolio')
  ok(scope('¿cuántas operaciones he cerrado?') === 'operations_only', 'operaciones cerradas → operations')
  ok(scope('¿qué operaciones están ganadas?') === 'operations_only', 'operaciones ganadas → operations')
  ok(scope('en cartera o en operaciones no he vendido nada?') === 'both', 'cartera o operaciones → both')
  ok(scope('muéstrame los alquilados') === 'portfolio_only', 'alquilados → portfolio')

  // C) Métrica y tipo.
  ok(parseSalesIntent('¿cuántas operaciones he cerrado?')?.metric === 'closed_operations', 'métrica closed_operations')
  ok(parseSalesIntent('muéstrame los alquilados')?.operationType === 'rent', 'opType rent')
  ok(parseSalesIntent('¿cuántos he vendido?')?.metric === 'sales_summary', 'métrica sales_summary')

  // D) Actos.
  ok(parseSalesIntent('¿cuántos he vendido?')?.asksCount === true, 'asksCount')
  ok(parseSalesIntent('¿he vendido algo?')?.asksYesNo === true, 'asksYesNo')
  ok(parseSalesIntent('¿qué pisos he vendido?')?.asksList === true, 'asksList')
  ok(parseSalesIntent('¿qué diferencia hay entre inmueble vendido y operación cerrada?')?.asksExplanation === true, 'asksExplanation')
  ok(SALES_DIFFERENCE_EXPLANATION.includes('Inmueble vendido') && SALES_DIFFERENCE_EXPLANATION.includes('cerrada'), 'explicación honesta')

  // E) Correcciones de alcance (solo con contexto de ventas previo).
  ok(parseSalesIntent('No te he preguntado por operaciones, te he preguntado por cartera.', { priorWasSales: true })?.scope === 'portfolio_only', 'corrección → cartera')
  ok(parseSalesIntent('No te he preguntado por cartera, te he preguntado por operaciones.', { priorWasSales: true })?.scope === 'operations_only', 'corrección → operaciones')
  ok(parseSalesIntent('te he preguntado por cartera') === null, 'sin contexto de ventas no se activa la corrección')

  // F) NO falsos positivos (proceso/otros estados/social).
  for (const q of ['¿cómo vendo un inmueble?', 'muéstrame los disponibles', 'muéstrame los reservados', 'hola', '¿qué muestra la cartera?', '¿cuántos clientes tengo?']) {
    ok(parseSalesIntent(q) === null, `no falso positivo: "${q}"`)
  }

  // G) Lectura fresca dentro de ventas.
  ok(parseSalesIntent('acabo de cambiar el estado, mira otra vez ¿cuántos he vendido?')?.forceLiveRead === true, 'forceLiveRead')

  return fail
}
