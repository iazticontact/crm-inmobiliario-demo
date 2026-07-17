// P71 — MUTATION HARNESS conversacional (patrón P70): inyecta el bug REAL en el código, ejecuta el probe
// en un proceso fresco, confirma que el detector se pone en ROJO (mutación DETECTADA) y REVIERTE siempre.
// Todas las mutaciones COMPILAN: son bugs semánticos, no sintácticos. Al final el árbol queda idéntico.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p71-mutation-check.mts

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

type Mutation = { id: string; desc: string; file: string; find: string; replace: string; invariant: string }

const LA = 'src/lib/agents/local-answers.ts'
const MUTATIONS: Mutation[] = [
  {
    id: 'state-write-off', desc: 'local-first deja de EMITIR estado (ordinales/rerun quedan ciegos)',
    file: LA,
    find: `const withState = enrichReadStateUpdate(r, message, opts.turnId ?? '')`,
    replace: `const withState = { ...r, stateUpdate: undefined }`,
    invariant: 'state-emitted',
  },
  {
    id: 'state-read-off', desc: 'el posesivo deja de LEER la entidad activa del estado',
    file: 'src/lib/agents/conversation-references.ts',
    find: `      const owner = pickActive(state, 'client') ?? state.activeEntities[0] ?? null`,
    replace: `      const owner = null as EntityRef | null`,
    invariant: 'state-read-possessive',
  },
  {
    id: 'temporal-pisa-entidad', desc: 'temporalScope pisa entityScope (composición rota)',
    file: LA,
    find: `  if (mod === 'calendar' || mod === 'tasks') {
    if (scopedClient) {`,
    replace: `  if (mod === 'calendar' || mod === 'tasks') {
    if (scopedClient && false) {`,
    invariant: 'entity-plus-period-scoped',
  },
  {
    id: 'reader-ignores-entity', desc: 'el reader scoped ignora client_id (fuga a otras entidades)',
    file: LA,
    find: `.eq('workspace_id', ws).eq('client_id', e.entityId).neq('status', 'cancelled')`,
    replace: `.eq('workspace_id', ws).neq('status', 'cancelled')`,
    invariant: 'reader-respects-entity',
  },
  {
    id: 'scoped-empty-to-global', desc: 'una relación VACÍA cae a la agenda global',
    file: LA,
    find: `  if (!rows.length) return { handled: true, usedTool: 'local_client_events', entity: 'calendar', answer: \`\${e.displayLabel} no tiene citas\${per}.\`, stateUpdate: su }`,
    replace: `  if (!rows.length) return handleAgenda(supabase, ws, { calendar: true, tasks: false })`,
    invariant: 'scoped-empty-not-global',
  },
  {
    id: 'confirm-from-cache', desc: '«¿seguro?» vuelve a responder del conteo cacheado (lastResults)',
    file: LA,
    find: `  if (ctxDecision === 'confirm_prior') return await runFresh()`,
    replace: `  if (ctxDecision === 'confirm_prior') return { handled: true, usedTool: 'local_context', entity: intent.entity, answer: confirmPriorText(prior) }`,
    invariant: 'confirm-requeries',
  },
  {
    id: 'question-opens-action', desc: 'una pregunta de capacidad abre intención de acción',
    file: 'src/lib/agents/conversation-pending.ts',
    find: `    if (isQuestion && !Object.keys(acc).length) return null`,
    replace: `    if (false && isQuestion && !Object.keys(acc).length) return null`,
    invariant: 'capacity-question-no-action',
  },
  {
    id: 'temporal-hijacks-action', desc: 'la lógica temporal secuestra una acción con fecha',
    file: LA,
    find: `  if (/\\b(activa|crea|programa|configura|desactiva|pausa|reactiva|ejecuta|lanza|cambia|cambiale|modifica|actualiza|pon|ponle|edita|corrige|marca|mueve|reprograma|apunta|recuerdame|anade|añade|agendar|agendame)\\b/.test(n)) return null`,
    replace: `  if (false) return null`,
    invariant: 'action-not-hijacked-by-temporal',
  },
  {
    id: 'silent-entity-choice', desc: 'con varios candidatos se elige uno EN SILENCIO (sin preguntar)',
    file: LA,
    find: `    if (hits.length > 1 && res.exactMatches.length !== 1) {`,
    replace: `    if (false && hits.length > 1 && res.exactMatches.length !== 1) {`,
    invariant: 'ambiguous-asks',
  },
  {
    id: 'v1-discarded', desc: 'un ConversationState v1 válido se descarta en vez de adaptarse',
    file: 'src/lib/agents/conversation-state.ts',
    find: `  if (o.version === 1) {`,
    replace: `  if (false) {`,
    invariant: 'v1-upgrades',
  },
]

let pass = 0, fail = 0
const runProbe = (invariant: string): number => {
  try { execSync(`npx tsx --tsconfig tsconfig.json scripts/p71-mutation-probe.mts ${invariant}`, { stdio: 'ignore' }); return 0 }
  catch (e) { return (e as { status?: number }).status ?? 1 }
}

console.log('Baseline: los invariantes conversacionales se cumplen en código limpio…')
for (const m of MUTATIONS) {
  const base = runProbe(m.invariant)
  if (base !== 0) { console.log(`SKIP  ${m.id}: el invariante ya falla en limpio (probe=${base}) — revisar probe`); fail++; continue }
  const original = readFileSync(m.file, 'utf8')
  if (!original.includes(m.find)) { console.log(`FAIL  ${m.id}: cadena de inyección no encontrada en ${m.file}`); fail++; continue }
  const mutated = original.replace(m.find, m.replace)
  let detected = false
  try {
    writeFileSync(m.file, mutated)
    detected = runProbe(m.invariant) !== 0
  } finally {
    writeFileSync(m.file, original)
  }
  const restored = runProbe(m.invariant) === 0
  if (detected && restored) { pass++; console.log(`PASS  ${m.id.padEnd(26)} → DETECTADA por «${m.invariant}» · revert OK`) }
  else { fail++; console.log(`FAIL  ${m.id.padEnd(26)} → detected=${detected} restored=${restored}`) }
}
console.log(`\nP71 MUTATIONS: ${pass}/${pass + fail} ${fail ? 'CON FALLOS' : 'TODO PASS'}`)
console.log('Cobertura del mandato: workspace-validation y preview-verify se cubren con el harness P70 (7+2);')
console.log('n8n-ignora-estado y dato-viejo-tras-mutación se cubren con contrato F3.5 + realtime E2E (checks vivos).')
process.exit(fail ? 1 : 0)
