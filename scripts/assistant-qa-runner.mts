// P54 — QA runner conversacional del Asistente (sin red, sin auth, sin secretos).
// Simula las categorías del playbook contra la lógica REAL de decisión (decideTurn + permisos +
// generadores) e imprime por caso: turnType, shouldReadData, tools y PASS/FAIL. Complementa (no sustituye)
// la QA de chat en la UI.
//
// Uso:  npx tsx --tsconfig tsconfig.json scripts/assistant-qa-runner.mts

import { decideTurn } from '@/lib/agents/assistant-turn'
import { allowedToolsForTurn } from '@/lib/agents/assistant-tool-permissions'
import { isSafeAnswer } from '@/lib/agents/assistant-errors'
import { explainModule, onboardingAnswer, confusedAnswer } from '@/lib/agents/crm-module-catalog'

type Case = { cat: string; msg: string; ctx?: Parameters<typeof decideTurn>[1]; expectRead: boolean; expectType?: string[] }

const cases: Case[] = [
  { cat: 'Onboarding', msg: 'soy nuevo, ¿por dónde empiezo?', expectRead: false, expectType: ['onboarding'] },
  { cat: 'Capacidades', msg: '¿qué puedes hacer?', expectRead: false, expectType: ['capability'] },
  { cat: 'Módulo Dashboard', msg: '¿qué muestra el dashboard?', expectRead: false, expectType: ['module_explanation'] },
  { cat: 'Módulo Cartera', msg: '¿para qué sirve la cartera?', expectRead: false, expectType: ['module_explanation'] },
  { cat: 'Módulo Clientes', msg: 'explícame el apartado de clientes', expectRead: false, expectType: ['module_explanation'] },
  { cat: 'Módulo Trámites', msg: '¿qué es el apartado de trámites?', expectRead: false, expectType: ['module_explanation'] },
  { cat: 'Qué resume', msg: '¿qué resume esta pantalla?', expectRead: false, expectType: ['module_explanation'] },
  { cat: 'No entiendo', msg: 'no entiendo', ctx: { priorModule: 'dashboard' }, expectRead: false, expectType: ['user_confused'] },
  { cat: 'Corrección', msg: 'no me refiero a eso', expectRead: false, expectType: ['user_correction'] },
  { cat: 'Meta', msg: '¿por qué me listas los clientes?', expectRead: false, expectType: ['assistant_meta'] },
  { cat: 'Lectura clientes', msg: 'muéstrame los clientes', expectRead: true },
  { cat: 'Lectura inmuebles', msg: '¿qué pisos hay en cartera?', expectRead: true },
  { cat: 'Lectura tareas', msg: 'lista mis tareas pendientes', expectRead: true },
  { cat: 'Lectura trámites', msg: '¿qué trámites hay abiertos?', expectRead: true },
  { cat: 'Follow-up datos', msg: '¿y el de Malasaña?', ctx: { priorEntity: 'properties', hasLastResult: true }, expectRead: true },
  { cat: 'Cambio de módulo', msg: '¿qué muestra el dashboard?', ctx: { priorModule: 'portfolio' }, expectRead: false, expectType: ['module_explanation'] },
  { cat: 'Facturación', msg: '¿cuánto he facturado?', expectRead: false },
  { cat: 'Ambigüedad', msg: 'mmm', expectRead: false, expectType: ['ambiguous'] },
  { cat: 'Social', msg: '¡Hola!', expectRead: false, expectType: ['social'] },
  { cat: 'Agradecimiento', msg: 'gracias', expectRead: false, expectType: ['social'] },
]

let failed = 0
console.log(`\nQA conversacional (${cases.length} categorías) — lógica real, sin red\n`)
for (const c of cases) {
  const d = decideTurn(c.msg, c.ctx)
  const tools = allowedToolsForTurn(d)
  const typeOk = !c.expectType || c.expectType.includes(d.turnType)
  const readOk = d.shouldReadData === c.expectRead
  const toolsOk = c.expectRead ? true : tools.length === 0
  const pass = typeOk && readOk && toolsOk
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.cat.padEnd(18)} "${c.msg}" → ${d.turnType} read:${d.shouldReadData} tools:${tools.length}${d.module ? ` mod:${d.module}` : ''}`)
}

// Muestras de generadores (inspección visual rápida + guard de seguridad).
const samples: [string, string][] = [
  ['explainModule(dashboard)', explainModule('dashboard')],
  ['onboarding', onboardingAnswer()],
  ['confused(portfolio)', confusedAnswer('portfolio')],
]
console.log('\n── Muestras de respuesta ──')
for (const [n, s] of samples) {
  if (!isSafeAnswer(s)) { failed++; console.log(`FAIL ${n}: contiene señales prohibidas`) }
  console.log(`\n[${n}]\n${s}`)
}

console.log(failed === 0 ? '\nQA RUNNER: TODO PASS' : `\nQA RUNNER: ${failed} FALLOS`)
process.exit(failed === 0 ? 0 : 1)
