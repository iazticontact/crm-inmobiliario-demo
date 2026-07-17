// P70 Wave F — MUTATION HARNESS. Para cada mutación conocida: inyecta el bug REAL en el código fuente,
// ejecuta el detector (probe) en un proceso tsx FRESCO que recoge la mutación sin build, confirma que el
// detector se pone en ROJO (bug DETECTADO) y REVIERTE siempre (finally). Al final el árbol queda idéntico.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p70-mutation-check.mts

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

type Mutation = {
  id: string
  desc: string
  file: string
  find: string
  replace: string
  invariant: string   // probe que asserta el invariante (0=cumple, 1=roto)
  detector: string    // suite/artefacto que lo caza en el pipeline real
}

const MUTATIONS: Mutation[] = [
  {
    id: 'usar-completed', desc: 'tasks.complete propone «completed» en vez de «done» (rompe CHECK real)',
    file: 'src/lib/agents/assistant-action-intent.ts',
    find: `proposedChanges: { status: 'done' }`, replace: `proposedChanges: { status: 'completed' }`,
    invariant: 'tasks-done-not-completed', detector: 'p70-parser-tests + action-catalog-e2e',
  },
  {
    id: 'reintroducir-todo', desc: 'reintroduce «todo» como señal de tasks (secuestro P63)',
    file: 'src/lib/agents/intent.ts',
    find: `tasks: ['tarea', 'recordatorio', 'to-do', 'checklist', 'pendiente'],`,
    replace: `tasks: ['tarea', 'recordatorio', 'to-do', 'todo', 'checklist', 'pendiente'],`,
    invariant: 'todo-not-hijacked-by-tasks', detector: 'benchmark reg-p63-todo-hijack',
  },
  {
    id: 'permitir-invoice', desc: 'añade una acción de facturación al registro',
    file: 'src/lib/agents/action-registry.ts',
    find: `export const ASSISTANT_ACTIONS: Record<AssistantActionId, AssistantActionDefinition> = {`,
    replace: `export const ASSISTANT_ACTIONS: Record<AssistantActionId, AssistantActionDefinition> = {\n  'invoices.create': { id: 'invoices.create', module: 'clients', description: 'MUT', table: 'clients', kind: 'insert', requiredEntity: false, allowedFields: [], forbiddenFields: [], confirmationRequired: true, idempotent: true, supportsOptimisticLock: false, expiryMinutes: 10, risk: 'low' },`,
    invariant: 'invoice-not-in-registry', detector: 'benchmark gate invoicing + action-catalog (ACTION_UNKNOWN)',
  },
  {
    id: 'cita-pasada-proxima', desc: 'isUpcoming marca una cita PASADA como próxima (rompe verdad temporal)',
    file: 'src/lib/assistant-temporal.ts',
    find: `  return d >= today\n}`, replace: `  return d <= today\n}`,
    invariant: 'past-event-not-upcoming', detector: 'benchmark gate temporal + morning_agenda runner',
  },
  {
    id: 'quitar-dedupe', desc: 'persistFindings deja de deduplicar por fingerprint',
    file: 'src/lib/agents/findings-engine.ts',
    find: `=== '23505') duplicates++`, replace: `=== 'ZZZZZ') duplicates++`,
    invariant: 'findings-dedupe', detector: 'p67-e2e (dedupe) + automation-catalog (dedupe)',
  },
  {
    id: 'confirmacion-sin-pending', desc: 'elimina la guarda: «confirma» sin acción pendiente pasaría a ejecutar',
    file: 'src/lib/agents/local-answers.ts',
    find: `    if (!row) return { handled: false }`, replace: `    if (!row && false) return { handled: false }`,
    invariant: 'confirm-without-pending-no-write', detector: 'p66-chat-action-e2e («sí» sin pending no ejecuta)',
  },
  {
    id: 'quitar-workspace', desc: 'quita el scoping por workspace en una lectura (fuga cross-workspace)',
    file: 'src/lib/agents/local-answers.ts',
    find: `    .from('clients').select('id, name, company, email, phone', { count: 'exact' })\n    .eq('workspace_id', ws).is('deleted_at', null)`,
    replace: `    .from('clients').select('id, name, company, email, phone', { count: 'exact' })\n    .is('deleted_at', null)`,
    invariant: 'workspace-scoped-reads', detector: 'benchmark gate workspace + action-catalog (404 ws ajeno)',
  },
]

let pass = 0, fail = 0
const runProbe = (inv: string): number => {
  try { execSync(`npx tsx --tsconfig tsconfig.json scripts/p70-mutation-probe.mts ${inv}`, { stdio: 'ignore' }); return 0 }
  catch (e) { return (e as { status?: number }).status ?? 1 }
}

console.log('Baseline: los invariantes se cumplen en código limpio…')
for (const m of MUTATIONS) {
  const base = runProbe(m.invariant)
  if (base !== 0) { console.log(`SKIP  ${m.id}: el invariante ya falla en limpio (probe=${base}) — revisar probe`); fail++; continue }
  const path = m.file
  const original = readFileSync(path, 'utf8')
  // Robustez EOL (Windows): un checkout puede re-materializar el archivo con CRLF; el find multilínea
  // debe casar en ambas formas. La mutación inyectada respeta el EOL del archivo.
  const find = original.includes(m.find) ? m.find : m.find.replace(/\n/g, '\r\n')
  const replace = find === m.find ? m.replace : m.replace.replace(/\n/g, '\r\n')
  if (!original.includes(find)) { console.log(`FAIL  ${m.id}: cadena de inyección no encontrada en ${m.file}`); fail++; continue }
  const mutated = original.replace(find, replace)
  if (mutated === original) { console.log(`FAIL  ${m.id}: la mutación no cambió el archivo`); fail++; continue }
  let detected = false
  try {
    writeFileSync(path, mutated)
    detected = runProbe(m.invariant) !== 0 // el detector debe ponerse en ROJO
  } finally {
    writeFileSync(path, original) // REVERT siempre
  }
  const restored = runProbe(m.invariant) === 0
  if (detected && restored) { pass++; console.log(`PASS  ${m.id.padEnd(24)} → mutación DETECTADA por «${m.invariant}» · revert OK · caza real: ${m.detector}`) }
  else { fail++; console.log(`FAIL  ${m.id.padEnd(24)} → detected=${detected} restored=${restored}`) }
}

console.log(`\nMutaciones funcionales inyectadas: ${pass}/${pass + fail} ${fail ? 'CON FALLOS' : 'TODO PASS'}`)
console.log('Notas: «quitar verify» (route /api/agent/action) se verifica con inyección+build en la comprobación dedicada;')
console.log('       «eliminar GRANT SELECT authenticated» se verifica con revoke/regrant real seguro sobre p70-grants-check.')
process.exit(fail ? 1 : 0)
