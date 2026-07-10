// P62 — Test del INCIDENTE real (oferta→aceptación, calendario, «sí» tras oferta, alcance global) contra
// el motor REAL (tryLocalAnswer) con mock realista del workspace demo. Sin red/secretos.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p62-real-incident-check.mts

import { tryLocalAnswer } from '@/lib/agents/local-answers'

type Row = Record<string, unknown>
function matchesOr(row: Row, orStr: string): boolean {
  return orStr.split(',').some((cond) => {
    const [col, op, ...rest] = cond.split('.')
    const val = rest.join('.')
    const cell = String(row[col] ?? '').toLowerCase()
    if (op === 'eq') return String(row[col] ?? '') === val
    if (op === 'ilike') return cell.includes(val.replace(/%/g, '').toLowerCase())
    return false
  })
}
function makeBuilder(rows: Row[]) {
  let cur = rows.slice()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  const chain = () => b
  b.select = chain; b.order = chain; b.range = chain; b.limit = chain; b.neq = chain
  b.gte = chain; b.lte = chain; b.is = chain
  b.eq = (col: string, val: unknown) => { cur = cur.filter((r) => String(r[col] ?? '') === String(val)); return b }
  b.ilike = (col: string, pat: unknown) => { const p = String(pat).replace(/%/g, '').toLowerCase(); cur = cur.filter((r) => String(r[col] ?? '').toLowerCase().includes(p)); return b }
  b.or = (s: unknown) => { cur = cur.filter((r) => matchesOr(r, String(s))); return b }
  b.in = (col: string, arr: unknown) => { cur = cur.filter((r) => (arr as unknown[]).includes(r[col])); return b }
  b.maybeSingle = () => Promise.resolve({ data: cur[0] ?? null, error: null })
  b.then = (res: (v: { data: Row[]; error: null; count: number }) => unknown) => Promise.resolve({ data: cur, error: null, count: cur.length }).then(res)
  return b
}
const WS = 'd0000000-0000-4000-8000-000000000001'
const properties: Row[] = [
  ...Array(6).fill(0).map((_, i) => ({ id: `p-s${i}`, workspace_id: WS, title: `Piso ${i}`, status: 'sold', city: 'Valencia', operation_type: 'venta', deleted_at: null })),
  { id: 'p-l', workspace_id: WS, title: 'Av. San Pedro 66', status: 'listed', city: 'Madrid', operation_type: 'venta', deleted_at: null },
  { id: 'p-r', workspace_id: WS, title: 'Av. Puerto 8', status: 'rented', city: 'Valencia', operation_type: 'alquiler', deleted_at: null },
]
const fixtures: Record<string, Row[]> = { properties, clients: [], calendar_events: [], tasks: [], opportunities: [], entity_files: [], activities: [] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase: any = { from: (t: string) => makeBuilder(fixtures[t] ?? []) }

type Check = { say: string; must: (a: string, handled: boolean) => boolean; desc: string }
const convo: Check[] = [
  { say: 'Hello que tal', must: (a, h) => h && /hola|encantad|aquí estoy|asistente/i.test(a), desc: 'social' },
  { say: 'Que hacemos ofreceme algo', must: (a, h) => h && /te propongo/i.test(a) && /cartera/i.test(a) && /citas/i.test(a), desc: 'oferta concreta (3 opciones), sin leer' },
  { say: 'Venga va muestramela a ver que tal', must: (a, h) => h && (/cartera tiene/i.test(a) || /¿cuál te muestro/i.test(a)) && !/no puedo acceder|fallo temporal/i.test(a), desc: 'aceptación resuelve la oferta (cartera) o aclara — nunca «no puedo acceder»' },
  { say: 'Vale pues en el calendario me puedes mirar?', must: (a, h) => h && /citas próximas/i.test(a) && !/no puedo consultar/i.test(a), desc: 'calendario: lectura real answer-first' },
  { say: 'Si explicame', must: (a, h) => h && !/citas próximas:/i.test(a), desc: '«sí explícame» explica (no ejecuta datos)' },
  { say: 'Si', must: (a, h) => h && /citas próximas/i.test(a), desc: '«sí» tras oferta de datos → ejecuta la consulta' },
  { say: 'Si explicame todo el crm resumido', must: (a, h) => h && /recorrido/i.test(a) && /Clientes/i.test(a) && /Cartera/i.test(a) && /Facturación/i.test(a), desc: '«todo el CRM» → tour global (no se queda en Calendario)' },
]

let fails = 0
let ctx = ''
for (const c of convo) {
  const r = await tryLocalAnswer(supabase, WS, c.say, { recentContext: ctx })
  const ans = r.handled ? r.answer : '(no manejado → n8n)'
  const ok = c.must(ans, r.handled)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.desc}\n    U: ${c.say}\n    A: ${ans.replace(/\n/g, ' ⏎ ').slice(0, 150)}\n`)
  ctx += `\nusuario: ${c.say}\nasistente: ${ans}`
}
console.log(fails === 0 ? 'P62 INCIDENT: TODO PASS' : `P62 INCIDENT: ${fails} FALLOS`)
process.exit(fails === 0 ? 0 : 1)
