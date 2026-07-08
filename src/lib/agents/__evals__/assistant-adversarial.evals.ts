// Evals ADVERSARIALES (P55) — corpus de usuario real (nuevo, jefe, comercial, enfadado, confuso,
// coloquial, mixto). Blinda los fallos encontrados y corregidos en el pase final para que no vuelvan.

import { decideTurn } from '@/lib/agents/assistant-turn'
import { allowedToolsForTurn } from '@/lib/agents/assistant-tool-permissions'

export function runAdversarialEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const d = (q: string, ctx?: Parameters<typeof decideTurn>[1]) => decideTurn(q, ctx)

  // ── Fixes P55 (fallos reales encontrados en el sondeo) ──
  // 1) Capacidad en 3ª persona (jefe probando la demo).
  ok(d('qué puede hacer este asistente').turnType === 'capability', '3ª persona → capability')
  // 2) «qué son los X» explica.
  ok(d('qué son los trámites').turnType === 'module_explanation' && !d('qué son los trámites').shouldReadData, '«qué son los» explica')
  // 3) «qué hace X» explica (pero «qué hace falta…» NO se clasifica como explicación de módulo).
  ok(d('qué hace facturación').turnType === 'module_explanation', '«qué hace facturación» explica')
  ok(d('¿qué hace falta para facturar?').turnType !== 'module_explanation', '«hace falta» excluido')
  // 4) Cambio de tema con solo el módulo (mensaje corto sin verbo de datos) → explica, nunca lee a ciegas.
  for (const q of ['ahora cartera', 'vale, y clientes', 'facturas']) {
    const r = d(q)
    ok(r.turnType === 'module_explanation' && !r.shouldReadData, `módulo-solo explica: "${q}" (${r.turnType})`)
  }
  // 5) «te has liado» → corrección; «no listes datos» → meta (instrucción sobre el comportamiento).
  ok(d('te has liado').turnType === 'user_correction', '«te has liado» → corrección')
  ok(d('no listes datos').turnType === 'assistant_meta' && !d('no listes datos').shouldReadData, '«no listes datos» → meta sin lectura')

  // ── Invariantes que NO deben regresar con los fixes ──
  for (const q of ['muéstrame los clientes', '¿qué pisos hay en cartera?', 'lista mis tareas pendientes', '¿cuántos clientes tengo?']) {
    ok(d(q).shouldReadData, `lectura sigue leyendo: "${q}"`)
  }
  for (const q of ['¿qué muestra el dashboard?', 'no entiendo', 'soy nuevo', 'hola', 'gracias', 'esto está mal']) {
    const r = d(q)
    ok(!r.shouldReadData && allowedToolsForTurn(r).length === 0, `no-datos sin tools: "${q}" (${r.turnType})`)
  }
  // Mixto: explicación gana; el generador ya ofrece los datos al final.
  ok(!d('qué muestra cartera y qué inmuebles tengo').shouldReadData, 'mixto → explica primero')
  // Contexto: «y eso qué significa» hereda el módulo del hilo sin leer.
  const ctx = d('y eso qué significa', { priorModule: 'dashboard' })
  ok(ctx.turnType === 'module_explanation' && ctx.module === 'dashboard' && !ctx.shouldReadData, 'contexto significa → explica el tema')

  return fail
}
