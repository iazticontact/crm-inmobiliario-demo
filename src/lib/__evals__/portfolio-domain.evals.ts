// Evals de la semántica de Cartera (P56) — PURAS. Estados reales, publicación vía status (listed =
// «Publicado»), intención de estado, y la clase de fallo: preguntas de estado binario NUNCA con
// «lo más cercano»; vendidos nunca como disponibles; sin status crudos al usuario.

import {
  normalizePropertyState, parseStatusIntent, matchesStatusIntent, isBinaryStateQuestion, STATUS_INTENT_LABEL,
} from '@/lib/portfolio-domain'
import { decideTurn } from '@/lib/agents/assistant-turn'

export function runPortfolioDomainEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // Normalización: estados reales → semántica honesta con etiqueta en español (nunca status crudo).
  ok(normalizePropertyState('listed').publication === 'published', 'listed = publicado')
  ok(normalizePropertyState('prospecting').publication === 'unpublished' && !normalizePropertyState('prospecting').isClosed, 'prospecting = sin publicar, activo')
  ok(normalizePropertyState('sold').availability === 'sold' && normalizePropertyState('sold').isClosed, 'sold = vendido, cerrado')
  ok(normalizePropertyState('rented').availability === 'rented' && normalizePropertyState('rented').isClosed, 'rented = alquilado, cerrado')
  ok(normalizePropertyState('under_contract').availability === 'reserved', 'under_contract = reservado')
  for (const s of ['listed', 'sold', 'rented', 'under_contract', 'prospecting', 'archived']) {
    const l = normalizePropertyState(s).labelEs
    ok(!/[a-z_]{4,}/.test(l) || !/_|listed|sold|rented|prospecting/.test(l), `sin status crudo en etiqueta (${s}: ${l})`)
  }
  ok(normalizePropertyState('raro_xyz').availability === 'unknown', 'estado desconocido → unknown interno')

  // Intención de estado (publicado/vendido/reservado/recientes) en variantes.
  ok(parseStatusIntent('¿tengo algún inmueble publicado?') === 'published', 'publicado → published')
  ok(parseStatusIntent('¿cuáles no están publicados?') === 'unpublished', 'no publicados → unpublished')
  ok(parseStatusIntent('muéstrame los vendidos') === 'sold', 'vendidos')
  ok(parseStatusIntent('los alquilados') === 'rented', 'alquilados')
  ok(parseStatusIntent('¿hay reservados?') === 'reserved', 'reservados')
  ok(parseStatusIntent('inmuebles disponibles') === 'available', 'disponibles')
  ok(parseStatusIntent('¿qué inmuebles se han actualizado recientemente?') === 'recent', 'recientes')
  ok(parseStatusIntent('pisos en Malasaña con 3 habs') === null, 'búsqueda por características NO es estado')

  // matchesStatusIntent: vendidos nunca como disponibles ni publicados; reservados no libres.
  ok(!matchesStatusIntent('sold', 'available') && !matchesStatusIntent('sold', 'published'), 'vendido ∉ disponibles/publicados')
  ok(!matchesStatusIntent('rented', 'available'), 'alquilado ∉ disponibles')
  ok(matchesStatusIntent('listed', 'published') && matchesStatusIntent('listed', 'available'), 'listed ∈ publicados y disponibles')
  ok(matchesStatusIntent('under_contract', 'reserved') && !matchesStatusIntent('under_contract', 'sold'), 'reservado correcto')
  ok(matchesStatusIntent('sold', 'closed') && matchesStatusIntent('archived', 'closed'), 'histórico incluye cerrados')
  ok(!matchesStatusIntent('sold', 'unpublished'), 'vendido no cuenta como «sin publicar» (activos)')

  // Estado binario → prohibido «lo más cercano»; criterio siempre etiquetado.
  ok(isBinaryStateQuestion('¿tengo algún inmueble publicado?') && isBinaryStateQuestion('muéstrame los vendidos'), 'binario detectado')
  ok(!isBinaryStateQuestion('pisos de 3 habitaciones en Malasaña'), 'búsqueda NO es binario')
  for (const k of Object.values(STATUS_INTENT_LABEL)) ok(k.length > 5, `criterio etiquetado (${k})`)

  // Decisión: preguntas de publicación LEEN datos (no explican ni caen a ambiguo).
  ok(decideTurn('¿tengo algún inmueble publicado?').shouldReadData, 'publicado → lectura')
  ok(decideTurn('muéstrame los vendidos').shouldReadData, 'vendidos → lectura')
  // «no entiendo esa respuesta» tras cartera → se queda en cartera, sin leer.
  const conf = decideTurn('no entiendo esa respuesta', { priorModule: 'portfolio' })
  ok(conf.turnType === 'user_confused' && conf.module === 'portfolio' && !conf.shouldReadData, 'no-entiendo mantiene Cartera')
  // Lectura fresca: «acabo de editar un inmueble, mira otra vez» → data_read en vivo.
  const fresh = decideTurn('acabo de editar un inmueble, mira otra vez')
  ok(fresh.turnType === 'data_read' && fresh.shouldReadData && fresh.reason === 'p56:fresh-read', 'fresh-read fuerza lectura viva')
  ok(decideTurn('revisa la cartera').shouldReadData, '«revisa» → lectura viva')
  // Corrección sobre cartera: no lee, repara.
  ok(!decideTurn('no te he pedido que busques, te pregunté si están publicados').shouldReadData, 'corrección/meta no lee')

  return fail
}
