#!/usr/bin/env node
// P51C — Analiza la ESTRUCTURA de un workflow n8n (desde un backup JSON) para saber CÓMO llama a las tools.
// No imprime valores de parámetros (posibles secretos): solo tipos de nodo, nombres de header y si el nodo
// referencia el endpoint de tools. Uso: node scripts/n8n-analyze.mjs <backup.json>

import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('Uso: node scripts/n8n-analyze.mjs <backup.json>'); process.exit(2) }
const wf = JSON.parse(readFileSync(file, 'utf8'))
const nodes = wf.nodes || []

// Tipos de nodo (recuento).
const types = {}
for (const n of nodes) types[n.type] = (types[n.type] || 0) + 1
console.log('── Tipos de nodo ──')
for (const [t, c] of Object.entries(types).sort()) console.log(`  ${c}×  ${t}`)

// Nodos que referencian el endpoint de tools (búsqueda profunda, sin imprimir valores).
console.log('\n── Nodos que referencian /agent/tool ──')
const REF = /agent[\/_-]?tool|\/api\/agent/i
for (const n of nodes) {
  const s = JSON.stringify(n.parameters || {})
  if (!REF.test(s)) continue
  const hdrNames = (n.parameters?.headerParameters?.parameters || []).map((p) => p?.name).filter(Boolean)
  const hasTP = hdrNames.some((h) => String(h).toLowerCase() === 'x-nowcrm-turn-policy')
  // ¿La URL es literal o expresión? (sin volcar la URL entera)
  const url = n.parameters?.url
  const urlKind = typeof url === 'string' ? (url.startsWith('=') || url.includes('{{') ? 'expr' : 'literal') : (url ? 'other' : 'none')
  console.log(`  • ${n.name}  [${n.type}]  url:${urlKind}  headers:[${hdrNames.join(', ')}]  turnPolicy:${hasTP ? 'YES' : 'no'}`)
}

// Nodos AI Agent (para el system prompt).
console.log('\n── Nodos tipo Agent / LLM (para el system prompt) ──')
for (const n of nodes) {
  if (/agent|chattrigger|lmchat|langchain/i.test(n.type || '')) {
    const hasSystem = JSON.stringify(n.parameters || {}).toLowerCase().includes('system')
    console.log(`  • ${n.name}  [${n.type}]  system-msg-param:${hasSystem ? 'yes' : 'no'}`)
  }
}
