import { tryLocalAnswer } from '@/lib/agents/local-answers'
import { decideTurn } from '@/lib/agents/assistant-turn'

type Row = Record<string, unknown>
function makeBuilder(rows: Row[]) {
  let cur = rows.slice()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  const chain = () => b
  b.select = chain; b.order = chain; b.range = chain; b.limit = chain; b.neq = chain; b.gte = chain; b.lte = chain; b.gt = chain; b.is = chain
  b.eq = (c: string, v: unknown) => { cur = cur.filter((r) => String(r[c] ?? '') === String(v)); return b }
  b.ilike = chain; b.or = chain; b.in = chain
  b.maybeSingle = () => Promise.resolve({ data: cur[0] ?? null, error: null })
  b.then = (res: (v: { data: Row[]; error: null; count: number }) => unknown) => Promise.resolve({ data: cur, error: null, count: cur.length }).then(res)
  return b
}
const WS = 'd0000000-0000-4000-8000-000000000001'
const properties: Row[] = [
  ...Array(6).fill(0).map((_, i) => ({ id: `p${i}`, workspace_id: WS, title: `Piso ${i}`, status: 'sold', city: 'Valencia', operation_type: 'venta', deleted_at: null })),
  { id: 'pl', workspace_id: WS, title: 'Av. San Pedro 66', status: 'listed', city: 'Madrid', operation_type: 'venta', deleted_at: null },
  { id: 'pr', workspace_id: WS, title: 'Av. Puerto 8', status: 'rented', city: 'Valencia', operation_type: 'alquiler', deleted_at: null },
]
const fixtures: Record<string, Row[]> = { properties, clients: [], calendar_events: [], tasks: [], opportunities: [], entity_files: [], activities: [] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase: any = { from: (t: string) => makeBuilder(fixtures[t] ?? []) }

// P63 — aserciones: petición explícita de inmuebles JAMÁS termina en Tareas.
type Check = { say: string; must: (a: string, tool: string) => boolean; desc: string }
const checks: Check[] = [
  { say: 'Venga va, coméntame cómo va lo de cartera que no entiendo', must: (a, t) => t.startsWith('local_turn') && /inventario|inmueble/i.test(a), desc: 'explica Cartera, no lee' },
  { say: 'Pues nada, lístame todo lo que tengo en inmuebles', must: (a, t) => t === 'local_properties' && /8 inmuebles/i.test(a) && !/tareas/i.test(a), desc: 'lista TODOS los inmuebles (jamás Tareas)' },
  { say: 'Quiero que me digas todo lo de inmuebles que tengo, resúmeme', must: (a, t) => t === 'local_properties' && !/tareas/i.test(a), desc: 'todo lo de inmuebles (jamás Tareas)' },
  { say: 'Muéstrame los publicados', must: (a) => /Publicado/i.test(a) && !/lo más cercano/i.test(a), desc: 'publicados vía estado' },
  { say: '¿Y vendidos?', must: (a) => /vendid/i.test(a) && !/tareas/i.test(a), desc: 'vendidos vía estado' },
  { say: 'mira otra vez, acabo de modificar uno', must: (a, t) => /inmueble|cartera|propiedad/i.test(a) || t.includes('properties'), desc: 'reread vivo mantiene Cartera' },
]
let ctx = ''
let fails = 0
for (const c of checks) {
  const d = decideTurn(c.say)
  const r = await tryLocalAnswer(supabase, WS, c.say, { recentContext: ctx })
  const ans = r.handled ? r.answer : '(no manejado → n8n)'
  const tool = r.handled ? r.usedTool : '-'
  const pass = r.handled && c.must(ans, tool)
  if (!pass) fails++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.desc}  [${d.turnType}/${d.module ?? '-'} → ${tool}]\n    A: ${ans.replace(/\n/g, ' ⏎ ').slice(0, 110)}\n`)
  ctx += `\nusuario: ${c.say}\nasistente: ${ans}`
}
console.log(fails === 0 ? 'P63 INCIDENT: TODO PASS' : `P63 INCIDENT: ${fails} FALLOS`)
process.exit(fails === 0 ? 0 : 1)
