// P61 — Test del INCIDENTE real, multi-turn, contra el motor REAL (tryLocalAnswer) con un mock de Supabase
// que refleja los datos reales del workspace demo: 0 citas próximas, 0 tareas pendientes, 9 clientes,
// David Iglesias con ficha. Prueba planificación + readers + composición (no solo decideTurn). Sin red.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p61-incident-conversation-check.mts

import { tryLocalAnswer } from '@/lib/agents/local-answers'

// ── Mock de Supabase con filtrado real de eq / ilike / or / maybeSingle ──
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
  b.gte = chain; b.lte = chain; b.gt = chain; b.is = chain
  b.eq = (col: string, val: unknown) => { cur = cur.filter((r) => String(r[col] ?? '') === String(val)); return b }
  b.ilike = (col: string, pat: unknown) => { const p = String(pat).replace(/%/g, '').toLowerCase(); cur = cur.filter((r) => String(r[col] ?? '').toLowerCase().includes(p)); return b }
  b.or = (s: unknown) => { cur = cur.filter((r) => matchesOr(r, String(s))); return b }
  b.in = (col: string, arr: unknown) => { cur = cur.filter((r) => (arr as unknown[]).includes(r[col])); return b }
  b.maybeSingle = () => Promise.resolve({ data: cur[0] ?? null, error: null })
  b.then = (res: (v: { data: Row[]; error: null; count: number }) => unknown) => Promise.resolve({ data: cur, error: null, count: cur.length }).then(res)
  return b
}
const WS = 'd0000000-0000-4000-8000-000000000001'
const clients: Row[] = Array.from({ length: 9 }, (_, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, workspace_id: WS, name: i === 3 ? 'David Iglesias' : `Cliente ${i}`, company: null, email: `c${i}@x.com`, phone: '600000000', status: 'active', deleted_at: null, created_at: '2026-01-01' }))
const properties: Row[] = [
  ...Array(6).fill(0).map((_, i) => ({ id: `p-sold-${i}`, workspace_id: WS, title: `Piso ${i}`, status: 'sold', city: 'Valencia', operation_type: 'venta', deleted_at: null })),
  { id: 'p-listed', workspace_id: WS, title: 'Av. San Pedro 66', status: 'listed', city: 'Madrid', operation_type: 'venta', deleted_at: null },
  { id: 'p-rented', workspace_id: WS, title: 'Av. Puerto 8', status: 'rented', city: 'Valencia', operation_type: 'alquiler', deleted_at: null },
]
const fixtures: Record<string, Row[]> = { clients, properties, calendar_events: [], tasks: [], opportunities: [], entity_files: [], activities: [], assistant_actions: [] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase: any = { from: (t: string) => makeBuilder(fixtures[t] ?? []) }

type Check = { say: string; must: (a: string) => boolean; desc: string }
const convo: Check[] = [
  { say: 'Hola que hay', must: (a) => /hola|qué tal|aquí estoy|encantad/i.test(a), desc: 'saludo social' },
  { say: 'Pues ahora quiero que me digas si tengo citas proximas en el calendario', must: (a) => /no tienes ninguna/i.test(a) && !/no hay citas para mostrar/i.test(a), desc: 'citas answer-first NO' },
  { say: 'No tengo nada me quieres decir?', must: (a) => /no\b/i.test(a) && !/aquí esperando|nada especial|para ayudarte/i.test(a), desc: 'confirmación NO es social' },
  { say: 'Pero tengo citas o tareas en el calendario o no?', must: (a) => /citas próximas/i.test(a) && /tareas pendientes/i.test(a), desc: 'DOS fuentes (citas + tareas)' },
  { say: 'Hazme un resumen de mi cartera', must: (a) => /8 inmuebles/i.test(a) && !/entender el CRM|con tus datos actuales/i.test(a), desc: 'resumen cartera con datos, sin clarify' },
  { say: 'Los clientes que tengo me los puedes mostrar?', must: (a) => /9 clientes/i.test(a), desc: 'lista 9 clientes' },
  { say: 'Si, quiero que me imprimas toda la ficha de David Iglesias', must: (a) => /ficha de david iglesias/i.test(a) && !/no puedo acceder|no tengo acceso/i.test(a), desc: 'ficha David (core, sin «no puedo acceder»)' },
]

let fails = 0
let ctx = ''
let last: unknown[] | undefined
for (const c of convo) {
  const r = await tryLocalAnswer(supabase, WS, c.say, { recentContext: ctx, lastResults: last })
  const ans = r.handled ? r.answer : '(no manejado → n8n)'
  const ok = r.handled && c.must(ans)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.desc}\n    U: ${c.say}\n    A: ${ans.replace(/\n/g, ' ⏎ ').slice(0, 160)}\n`)
  ctx += `\nusuario: ${c.say}\nasistente: ${ans}`
  if (r.handled && r.referencedList) last = r.referencedList
}
console.log(fails === 0 ? 'INCIDENT CHECK: TODO PASS' : `INCIDENT CHECK: ${fails} FALLOS`)
process.exit(fails === 0 ? 0 : 1)
