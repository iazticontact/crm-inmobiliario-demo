// P66 — E2E CONVERSACIONAL de acciones: frases naturales por el MOTOR REAL del chat (tryLocalAnswer, con
// Supabase real para resolver entidades) contra el plano P65 DESPLEGADO en staging. Restaura el precio
// original al final. Fixture QA aislado para tareas. No imprime secretos.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p66-chat-action-e2e.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function envLocal(name: string): string | undefined {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined
}
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const SUPA_URL = envLocal('NEXT_PUBLIC_SUPABASE_URL')!
const SERVICE = envLocal('SUPABASE_SERVICE_ROLE_KEY')!
const WS = 'd0000000-0000-4000-8000-000000000001'

const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const supabase = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })

let pass = 0, fail = 0
const say = async (msg: string) => {
  const r = await tryLocalAnswer(supabase as never, WS, msg, {})
  return r.handled ? r.answer : '(no manejado)'
}
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}  ${extra}`) } }

// Precio original real (para restaurar).
const { data: prop } = await supabase.from('properties').select('id, title, price').eq('workspace_id', WS).ilike('title', '%San Pedro 66%').is('deleted_at', null).maybeSingle()
if (!prop) { console.error('No existe el inmueble San Pedro 66 en demo'); process.exit(2) }
const ORIGINAL = Number(prop.price)
console.log(`Inmueble QA: ${prop.title} · precio original: ${ORIGINAL}`)

// 1) Frase natural → PREVIEW (sin ejecutar).
const a1 = await say('Cambia el precio de Avenida San Pedro 66 a 280.000 €')
check('frase natural → preview con actual→nuevo', /Cambio preparado/.test(a1) && /280\.000/.test(a1) && /No.*aplicad/i.test(a1), a1.slice(0, 90))
const { data: mid } = await supabase.from('properties').select('price').eq('id', prop.id).maybeSingle()
check('prepare NO ejecuta (precio intacto)', Number(mid?.price) === ORIGINAL)

// 2) «sí, confirma» → execute + verify.
const a2 = await say('sí, confirma')
check('confirmación → aplicado y verificado', /aplicado y verificado/i.test(a2) && /280\.000/.test(a2), a2.slice(0, 90))
const { data: after } = await supabase.from('properties').select('price').eq('id', prop.id).maybeSingle()
check('BD real actualizada a 280000', Number(after?.price) === 280000)

// 3) RESTAURAR al original con el mismo ciclo (frase → preview → confirmar).
const a3 = await say(`Cambia el precio de Avenida San Pedro 66 a ${ORIGINAL.toLocaleString('es-ES')} €`)
check('preview de restauración', /Cambio preparado/.test(a3))
const a4 = await say('confirma')
check('restauración verificada', /aplicado y verificado/i.test(a4))
const { data: restored } = await supabase.from('properties').select('price').eq('id', prop.id).maybeSingle()
check('precio original restaurado', Number(restored?.price) === ORIGINAL, `(${restored?.price})`)

// 4) Crear tarea + CANCELAR (no ejecuta).
const a5 = await say('Crea una tarea para llamar mañana a David Iglesias QA P66')
check('tarea → preview', /Cambio preparado/.test(a5) && /llamar/i.test(a5), a5.slice(0, 90))
const a6 = await say('mejor no, cancela')
check('cancelación descarta', /descartado|no se ha aplicado/i.test(a6), a6.slice(0, 90))
const { count } = await supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('workspace_id', WS).ilike('title', '%QA P66%')
check('la tarea cancelada NO existe en BD', (count ?? 0) === 0, `(count=${count})`)

// 5) «sí» SIN pending action → jamás ejecuta una escritura (cae al flujo normal).
const a7 = await say('sí')
check('«sí» sin pending no ejecuta escritura', !/aplicado y verificado/i.test(a7), a7.slice(0, 70))

console.log(fail === 0 ? `\nP66 CHAT-ACTION E2E: ${pass}/${pass + fail} TODO PASS` : `\nP66 CHAT-ACTION E2E: ${fail} FALLOS`)
process.exit(fail === 0 ? 0 : 1)
