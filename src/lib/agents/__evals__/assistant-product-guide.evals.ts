// Evals de la GUÍA DE PRODUCTO (P53) — por PROPIEDADES, no frases hardcodeadas.
// Propiedad central: aprender/navegar/entender el CRM («¿qué muestra X?», «no entiendo», «soy nuevo»,
// «¿dónde está X?») EXPLICA y NUNCA lee datos, aunque mencione módulos/entidades; pedir datos reales
// («muéstrame», «cuántos tengo») SÍ lee.

import {
  CRM_MODULES, ALL_MODULE_IDS, resolveModuleFromText, explainModule, navigationAnswer,
  onboardingAnswer, confusedAnswer,
} from '@/lib/agents/crm-module-catalog'
import { decideTurn } from '@/lib/agents/assistant-turn'
import { allowedToolsForTurn } from '@/lib/agents/assistant-tool-permissions'
import { isSafeAnswer } from '@/lib/agents/assistant-errors'

export function runProductGuideEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const reads = (q: string) => decideTurn(q).shouldReadData
  const type = (q: string) => decideTurn(q).turnType

  // A) Catálogo completo: 12 módulos, cada explicación es segura, no vacía y nombra el módulo.
  ok(ALL_MODULE_IDS.length === 12, `catálogo con 12 módulos (hay ${ALL_MODULE_IDS.length})`)
  for (const id of ALL_MODULE_IDS) {
    const m = CRM_MODULES[id]
    ok(m.aliases.length >= 2 && m.purpose.length > 15 && m.shows.length > 15, `${id}: campos completos`)
    const e = explainModule(id)
    ok(isSafeAnswer(e) && e.includes(m.name) && e.length > 60, `${id}: explainModule seguro/no vacío/nombra módulo`)
  }
  // Facturación: la explicación deja claro que el Asistente no lee facturas.
  ok(/NO leo facturas|no leo facturas/.test(explainModule('invoicing')), 'invoicing: explica que no lee facturas')

  // B) Resolución de módulo por alias (y el alias más largo gana).
  const aliasCases: [string, string][] = [
    ['el dashboard', 'dashboard'], ['mis clientes', 'clients'], ['la cartera', 'portfolio'],
    ['los inmuebles', 'portfolio'], ['el pipeline', 'operations'], ['las comisiones', 'commissions'],
    ['la facturación', 'invoicing'], ['el calendario', 'calendar'], ['mis tareas', 'tasks'],
    ['los trámites', 'cases'], ['los documentos', 'documents'], ['la configuración', 'settings'],
    ['el asistente', 'assistant'],
  ]
  for (const [t, id] of aliasCases) ok(resolveModuleFromText(t) === id, `resolve "${t}" → ${id} (got ${resolveModuleFromText(t)})`)
  ok(resolveModuleFromText('hola qué tal') === null, 'sin módulo → null')

  // C) EXPLICACIÓN por módulo → module_explanation, sin lectura (para varios módulos y varias formas).
  const explainForms = (mod: string) => [
    `¿qué muestra el ${mod}?`, `¿para qué sirve ${mod}?`, `¿qué es el apartado de ${mod}?`, `explícame ${mod}`,
  ]
  for (const mod of ['dashboard', 'cartera', 'clientes', 'trámites', 'comisiones', 'facturación']) {
    for (const q of explainForms(mod)) {
      const d = decideTurn(q)
      ok(!d.shouldReadData, `explicación NO lee: "${q}" (${d.turnType})`)
      ok(d.shouldExplainProduct || d.turnType === 'how_it_works' || d.turnType === 'capability', `explicación clasifica guía: "${q}" → ${d.turnType}`)
      ok(allowedToolsForTurn(d).length === 0, `explicación sin tools: "${q}"`)
    }
  }
  // El caso exacto del bug histórico: «¿qué muestra el dashboard?» contenía la señal débil «muestra».
  ok(type('¿Qué muestra el Dashboard?') === 'module_explanation' && !reads('¿Qué muestra el Dashboard?'), 'BUG P53: «qué muestra el dashboard» explica, no lee')
  ok(decideTurn('¿qué resume esta pantalla?').shouldExplainProduct, '«qué resume esta pantalla» → guía')

  // D) Onboarding / confusión / navegación → guía, sin lectura.
  for (const q of ['soy nuevo, ¿por dónde empiezo?', 'acabo de empezar con el CRM', 'primera vez que uso esto']) {
    ok(type(q) === 'onboarding' && !reads(q), `onboarding no lee: "${q}" (${type(q)})`)
  }
  for (const q of ['no entiendo', 'no me queda claro esto', 'estoy perdido', 'no entiendo la cartera']) {
    ok(type(q) === 'user_confused' && !reads(q), `confusión no lee: "${q}" (${type(q)})`)
  }
  for (const q of ['¿dónde está la facturación?', '¿cómo llego a la cartera?', '¿dónde veo mis tareas?']) {
    ok(type(q) === 'navigation_help' && !reads(q), `navegación no lee: "${q}" (${type(q)})`)
  }
  // «no entiendo la cartera» resuelve el módulo del propio mensaje.
  ok(decideTurn('no entiendo la cartera').module === 'portfolio', 'confusión resuelve módulo propio')
  // «no entiendo» hereda el módulo del contexto (context kind: product_explanation).
  ok(decideTurn('no entiendo', { priorModule: 'dashboard' }).module === 'dashboard', 'confusión hereda módulo del hilo')
  // Cambio de módulo: el módulo del mensaje GANA al del contexto (sin arrastre).
  ok(decideTurn('¿qué muestra la cartera?', { priorModule: 'dashboard' }).module === 'portfolio', 'cambio de módulo no arrastra')

  // E) CONTRASTE — lecturas reales siguen leyendo.
  for (const q of ['muéstrame los clientes', '¿qué pisos hay en cartera?', '¿cuántos clientes tengo?', 'lista mis tareas', '¿qué tengo ahora en la agenda?']) {
    ok(reads(q), `lectura sí lee: "${q}" (${type(q)})`)
  }

  // F) Metamórfico: mayúsculas/acentos no cambian la clase.
  ok(type('¿QUÉ MUESTRA EL DASHBOARD?') === type('que muestra el dashboard'), 'metamórfico explicación')
  ok(type('SOY NUEVO') === type('soy nuevo'), 'metamórfico onboarding')

  // G) Calidad de respuesta: generadores seguros, no robóticos, sin exceso de preguntas.
  const gens = [onboardingAnswer(), confusedAnswer('portfolio'), confusedAnswer(null), navigationAnswer('invoicing'), explainModule('dashboard')]
  for (const g of gens) {
    ok(isSafeAnswer(g), `generador seguro: "${g.slice(0, 30)}…"`)
    ok((g.match(/\?/g) ?? []).length <= 2, `máx 2 preguntas: "${g.slice(0, 30)}…"`)
    ok(g.length > 40 && g.length < 900, `longitud razonable: "${g.slice(0, 30)}…"`)
  }
  // Explicar un módulo no vuelca datos (no UUID lo cubre isSafeAnswer; tampoco líneas de datos con €).
  ok(!/\d{3}\.\d{3} €/.test(explainModule('portfolio')), 'explicación sin datos concretos')

  return fail
}
