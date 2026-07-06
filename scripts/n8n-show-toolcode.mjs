#!/usr/bin/env node
// P51C — Muestra el jsCode de un nodo toolCode con TODOS los secretos conocidos de .env.local redactados
// (valor → «NOMBRE»). Sirve para diseñar el parche sin filtrar secretos. Uso:
//   node scripts/n8n-show-toolcode.mjs <backup.json> [nodeName]

import { readFileSync } from 'node:fs'

function loadEnv(path) {
  const env = {}
  let raw = ''
  try { raw = readFileSync(path, 'utf8') } catch { return env }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    env[m[1]] = v
  }
  return env
}

const file = process.argv[2]
const wanted = process.argv[3]
if (!file) { console.error('Uso: node scripts/n8n-show-toolcode.mjs <backup.json> [nodeName]'); process.exit(2) }

const env = loadEnv('.env.local')
// Mapa de redacción: cualquier valor "secreto" (>=8 chars) → «NOMBRE»
const redactions = Object.entries(env)
  .filter(([k, v]) => typeof v === 'string' && v.length >= 8 && /SECRET|KEY|TOKEN|PASSWORD|PWD/i.test(k))
  .sort((a, b) => b[1].length - a[1].length) // valores largos primero
function redact(s) {
  let out = s
  for (const [k, v] of redactions) out = out.split(v).join(`«${k}»`)
  return out
}

const wf = JSON.parse(readFileSync(file, 'utf8'))
const allNodes = wf.nodes || []
const node = wanted
  ? allNodes.find((n) => n.name === wanted)
  : allNodes.filter((n) => /toolCode/i.test(n.type || '')).find((n) => /agent[\/_-]?tool|\/api\/agent/i.test(JSON.stringify(n.parameters || {})))
if (!node) { console.error('No encontré el nodo.'); process.exit(1) }

const p = node.parameters || {}
const code = p.jsCode ?? p.code ?? p.functionCode ?? null
console.log(`Node: ${node.name}  [${node.type}]`)
console.log('param keys:', Object.keys(p).join(', '))
if (code != null) {
  console.log('\n── code (secretos redactados) ──')
  console.log(redact(String(code)))
} else {
  console.log('\n── parameters (secretos redactados, recortado) ──')
  console.log(redact(JSON.stringify(p, null, 2)).slice(0, 2000))
}
