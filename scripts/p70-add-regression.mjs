#!/usr/bin/env node
// P70 Wave F — Añade una regresión al manifest (tests/regressions/manifest.json) de forma segura:
// valida el shape, evita ids duplicados, ordena y reescribe con formato estable. Ante un incidente
// nuevo, se registra aquí (id, fase, incidente, turnos reproductores, clase esperada, detector) para que
// no vuelva sin ser cazado. Idealmente, añadir también un escenario reg-* al benchmark.
//
// Uso: node scripts/p70-add-regression.mjs '{"id":"p71-...","phase":"P71","incident":"...","turns":["..."],"expectedClass":"...","detector":"..."}'

import { readFileSync, writeFileSync } from 'node:fs'

const PATH = 'tests/regressions/manifest.json'
const REQUIRED = ['id', 'phase', 'incident', 'turns', 'expectedClass', 'detector']

const arg = process.argv[2]
if (!arg) { console.error('Falta el JSON de la regresión. Uso: node scripts/p70-add-regression.mjs \'{"id":...}\''); process.exit(2) }

let entry
try { entry = JSON.parse(arg) } catch { console.error('JSON inválido.'); process.exit(2) }
for (const k of REQUIRED) {
  if (!(k in entry)) { console.error(`Falta el campo requerido: ${k}`); process.exit(2) }
}
if (!Array.isArray(entry.turns)) { console.error('turns debe ser un array de strings.'); process.exit(2) }

const manifest = JSON.parse(readFileSync(PATH, 'utf8'))
if (manifest.regressions.some((r) => r.id === entry.id)) { console.error(`Ya existe una regresión con id «${entry.id}».`); process.exit(1) }

manifest.regressions.push({ id: entry.id, phase: entry.phase, incident: entry.incident, turns: entry.turns, expectedClass: entry.expectedClass, detector: entry.detector })
manifest.updatedAt = new Date().toISOString().slice(0, 10)
writeFileSync(PATH, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Regresión «${entry.id}» añadida. Total: ${manifest.regressions.length}. Recuerda añadir su escenario reg-* al benchmark.`)
