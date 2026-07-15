// P71·It2 — REAL-TIME E2E (SIN MOCKS). Demuestra el GROUNDING en tiempo real: el estado conserva SOLO
// referencias (id+label), nunca el valor; cada continuación RECONSULTA la BD. Flujo:
//   1) leer el precio actual de un inmueble real (baseline);
//   2) mutar un fixture QA (UPDATE del precio en BD);
//   3) preguntar de nuevo en el MISMO hilo (referencia «¿y su precio?») → aparece el valor NUEVO;
//   4) repetir en OTRO hilo/pestaña (estado nuevo, misma referencia) → también ve el valor nuevo;
//   5) aislamiento de WORKSPACE: la misma referencia bajo otro workspace NO devuelve el dato;
//   6) restaurar el valor original y verificar.
// El estado se SIEMBRA con la referencia (id+label) — si el asistente respondiera «desde el contexto»,
// devolvería el precio viejo; como reconsulta la fuente, devuelve el nuevo. Uso:
//   npx tsx --tsconfig tsconfig.json scripts/p71-realtime-e2e.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
const WS = 'd0000000-0000-4000-8000-000000000001'
const WS_OTHER = 'd0000000-0000-4000-8000-0000000000ff' // workspace inexistente → prueba de aislamiento
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { emptyState } = await import('@/lib/agents/conversation-state')
import type { ConversationState, EntityRef } from '@/lib/agents/conversation-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const euro = (n: number) => `${n.toLocaleString('es-ES')} €`
const checks: Array<{ name: string; ok: boolean; detail: string }> = []
function check(name: string, ok: boolean, detail = '') { checks.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  →  ${detail}`}`) }

// Estado sembrado SOLO con la referencia (id+label). Ninguna cifra vive aquí: la verdad es la BD.
function seededState(p: { id: string; title: string }): ConversationState {
  const s = emptyState()
  const ref: EntityRef = { entityType: 'property', entityId: p.id, displayLabel: p.title, confidence: 0.9, sourceTurnId: 'seed' }
  s.activeEntities = [ref]; s.activeModule = 'portfolio'
  return s
}
async function askPrice(ws: string, state: ConversationState): Promise<string> {
  const r = await tryLocalAnswer(supabase as never, ws, '¿y su precio?', { state, turnId: `e2e-${Date.now()}` })
  return r.handled ? r.answer : '(no manejado)'
}

// Inmueble real con precio.
const { data: props } = await supabase.from('properties').select('id, title, price').eq('workspace_id', WS).is('deleted_at', null).not('price', 'is', null).limit(1)
const P = props?.[0] as { id: string; title: string; price: number } | undefined
if (!P) { console.log('No hay inmuebles con precio para el E2E.'); setTimeout(() => process.exit(1), 200) }
else {
  const oldPrice = Number(P.price)
  const newPrice = oldPrice + 12345
  console.log(`\nP71·It2 REAL-TIME E2E — inmueble «${P.title}»  precio actual ${euro(oldPrice)}\n`)
  try {
    // 1) baseline en el MISMO hilo
    const thread = seededState(P)
    const a1 = await askPrice(WS, thread)
    check('1· baseline: la lectura muestra el precio ACTUAL', a1.includes(euro(oldPrice)), `esperaba ${euro(oldPrice)} en: ${a1.slice(0, 120)}`)

    // 2) mutar fixture QA (UPDATE real en BD)
    const { error: upErr } = await supabase.from('properties').update({ price: newPrice }).eq('workspace_id', WS).eq('id', P.id)
    check('2· mutación de fixture aplicada en BD', !upErr, String(upErr?.message ?? ''))

    // 3) MISMO hilo, misma referencia sembrada → debe reconsultar y mostrar el valor NUEVO (no el cacheado)
    const a2 = await askPrice(WS, thread)
    check('3· mismo hilo: reconsulta y muestra el valor NUEVO', a2.includes(euro(newPrice)), `esperaba ${euro(newPrice)} en: ${a2.slice(0, 120)}`)
    check('3b· no arrastra el valor viejo (sin caché de resultados)', !a2.includes(euro(oldPrice)), `no debía aparecer ${euro(oldPrice)}`)

    // 4) OTRO hilo/pestaña (estado nuevo) → misma verdad de BD
    const a3 = await askPrice(WS, seededState(P))
    check('4· otro hilo/pestaña: ve el valor nuevo (verdad de workspace)', a3.includes(euro(newPrice)), `esperaba ${euro(newPrice)} en: ${a3.slice(0, 120)}`)

    // 5) aislamiento de WORKSPACE: misma referencia bajo otro workspace → no devuelve el dato
    const a4 = await askPrice(WS_OTHER, seededState(P))
    check('5· aislamiento de workspace: otro workspace no ve el inmueble', !a4.includes(euro(newPrice)) && !a4.includes(euro(oldPrice)), `fuga de datos entre workspaces: ${a4.slice(0, 120)}`)
  } finally {
    // 6) restaurar y verificar (limpieza garantizada)
    const { error: rbErr } = await supabase.from('properties').update({ price: oldPrice }).eq('workspace_id', WS).eq('id', P.id)
    const { data: after } = await supabase.from('properties').select('price').eq('id', P.id).maybeSingle()
    check('6· restauración del fixture al valor original', !rbErr && Number(after?.price) === oldPrice, `precio tras restaurar: ${after?.price}`)
  }
  const passed = checks.filter((c) => c.ok).length
  console.log(`\n${passed}/${checks.length} CHECKS ${passed === checks.length ? 'VERDE' : 'CON FALLOS'}`)
  setTimeout(() => process.exit(passed === checks.length ? 0 : 1), 200)
}
