// COHERENCIA DE CONVERSACIÓN COMPLETA (no solo turn-accuracy). Una conversación multi-turno real hilada por
// el discourse state; se validan invariantes CRUZADAS: continuidad de entidad, foco de módulo, no-contradicción,
// verdad de capacidad. Fraseos NO vistos + QA real. Synth off (juez estructural).
//   npx tsx --tsconfig tsconfig.json scripts/planner-coherence.mts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
const WS = 'd0000000-0000-4000-8000-000000000001'
const APIKEY = envLocal('OPENAI_API_KEY')!
const MODEL = envLocal('PLANNER_MODEL') || 'gpt-4.1-mini'
const { runTurn } = await import('@/lib/agents/planner/planner-pipeline')
const { emptyDiscourse } = await import('@/lib/agents/planner/discourse-state')
import type { RichDiscourse } from '@/lib/agents/planner/discourse-state'
import type { Evidence } from '@/lib/agents/planner/capability-executor'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

let d = emptyDiscourse() as RichDiscourse
const log: Array<{ msg: string; caps: string[]; ent: string | null; module: string | null; evs: Evidence[] }> = []
async function T(msg: string) {
  const r = await runTurn({ supabase: supabase as never, workspaceId: WS, message: msg, discourse: d, apiKey: APIKEY, plannerModel: MODEL, synth: false, selectionSeed: 5 })
  d = r.discourse
  const ent = r.trace.evidences.find((e) => e.resolvedEntity)?.resolvedEntity?.label ?? null
  log.push({ msg, caps: r.trace.plan.goals.map((g) => g.capability), ent, module: d.activeModule, evs: r.trace.evidences })
  console.log(`  T${log.length} «${msg.slice(0, 40)}» → caps=${log[log.length - 1].caps.join(',')} ent=${ent ?? '-'} focus=${d.activeModule ?? '-'}`)
  return log[log.length - 1]
}

console.log(`\nCOHERENCIA · conversación multi-turno · modelo ${MODEL}\n`)
await T('¿qué clientes tengo?')                 // T1: lista (lastListed)
const t2 = await T('abre el segundo de la lista') // T2: detalle del 2º (ordinal + continuidad)
const t3 = await T('¿y sus operaciones?')         // T3: relación del MISMO cliente
await T('vale, ahora enséñame la cartera de inmuebles') // T4: cambio de foco a portfolio
const t5 = await T('¿cuántos hay?')               // T5: cuenta de PORTFOLIO (no clientes)
const t6 = await T('dame uno al azar')            // T6: selección 1
const t7 = await T('¿qué cosas puedo hacer con él?') // T7: introspección (no search)

// ── Invariantes de coherencia CRUZADA ──
let pass = 0, total = 0
const inv = (name: string, ok: boolean, why: string) => { total++; if (ok) pass++; console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(40)} ${why}`) }
console.log('\nInvariantes cruzadas:')
inv('T2 continuidad: detalle de un cliente', t2.caps.includes('clients.detail') && !!t2.ent, `ent=${t2.ent}`)
inv('T3 consistencia de entidad (mismo cliente)', !!t3.ent && t3.ent === t2.ent, `T2=${t2.ent} T3=${t3.ent}`)
inv('T3 relación correcta (operaciones del cliente)', t3.caps.some((c) => c === 'clients.relation.operations'), `caps=${t3.caps.join(',')}`)
inv('T4/T5 foco cambiado a cartera', log[3].module === 'portfolio', `focus=${log[3].module}`)
inv('T5 no-contradicción: cuenta cartera, no clientes', t5.caps.some((c) => c.startsWith('portfolio')) && !t5.caps.some((c) => c.startsWith('clients')), `caps=${t5.caps.join(',')}`)
inv('T6 selección: uno, no la lista', (t6.evs.find((e) => e.capability.startsWith('portfolio'))?.count ?? 99) <= 1, `count=${t6.evs.find((e) => e.capability.startsWith('portfolio'))?.count}`)
inv('T7 verdad de capacidad (introspect, no search)', t7.caps.includes('capabilities.introspect') && !t7.caps.some((c) => c.endsWith('.search')), `caps=${t7.caps.join(',')}`)

console.log(`\nCOHERENCIA: ${pass}/${total}`)
setTimeout(() => process.exit(0), 400)
