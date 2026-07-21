// FASE 53 — ACUMULACIÓN DE SLOTS DE ACCIÓN multi-turno (mecanismo general, fraseos NO vistos).
// Una acción se completa a lo largo de VARIOS turnos: el servidor acumula entidad+slots en pendingAction,
// el turno siguiente FUSIONA (lo nuevo manda → permite corregir) y un cambio de tema/cancel la supersede.
// El usuario JAMÁS repite lo ya dicho. Todo dry-run (jamás escribe).
//   npx tsx --tsconfig tsconfig.json scripts/planner-action-slots.mts
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
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const { data: cli } = await supabase.from('clients').select('name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(1)
const C = String(cli?.[0]?.name ?? 'cliente')

let d = emptyDiscourse() as RichDiscourse
let pass = 0, tot = 0
const check = (name: string, ok: boolean, detail = '') => { tot++; if (ok) pass++; console.log(`  ${ok ? '✓' : '✗ FALLO'} ${name}${detail ? ` · ${detail}` : ''}`) }
async function T(msg: string) {
  const r = await runTurn({ supabase: supabase as never, workspaceId: WS, message: msg, discourse: d, apiKey: APIKEY, plannerModel: MODEL, synth: false, selectionSeed: 9 })
  d = r.discourse
  const ev = r.trace.evidences.find((e) => e.actionPreview)
  console.log(`  T «${msg.slice(0, 52)}» → caps=${r.trace.plan.goals.map((g) => `${g.capability}(${JSON.stringify(g.filters)})`).join(',') || '∅'} rejected=${JSON.stringify(r.trace.plan.rejected)} clarif=${r.trace.plan.needsClarification} preview=${ev ? `${ev.actionPreview!.actionId}[${Object.keys(ev.actionPreview!.changes).join('+') || 'sin-campos'}]ready=${ev.actionPreview!.ready}` : '-'} pending=${d.pendingAction ? `${d.pendingAction.capability}{${Object.keys(d.pendingAction.slots).join(',')}}` : 'null'}`)
  return { r, ev }
}

console.log(`\nFASE 53 — SLOT ACCUMULATION multi-turno · modelo ${MODEL} · cliente=${C}\n`)

// T1 — inicia la acción con datos PARCIALES.
const t1 = await T(`apúntame una visita con ${C} para el viernes por la tarde`)
const slots1 = d.pendingAction ? Object.keys(d.pendingAction.slots) : []
check('T1 emite calendar.create con preview', t1.ev?.actionPreview?.actionId === 'calendar.create')
check('T1 pendingAction persistida con slots', !!d.pendingAction && slots1.length > 0, `slots={${slots1.join(',')}}`)

// T2 — aporta SOLO datos nuevos; el servidor debe FUSIONAR (sin repetir lo de T1).
const t2 = await T('ponla a las 16:00 y de título pon Visita piso centro')
const merged = t2.ev?.actionPreview?.changes ?? {}
check('T2 sigue en la MISMA acción', t2.ev?.actionPreview?.actionId === 'calendar.create')
check('T2 fusiona: conserva slots de T1', slots1.every((k) => k in merged), `merged={${Object.keys(merged).join(',')}}`)
check('T2 añade lo nuevo (hora o título)', 'start_hour' in merged || 'title' in merged)

// T3 — CORRECCIÓN: lo nuevo MANDA sobre lo acumulado.
const t3 = await T('mejor que sea a las 17:00')
const c3 = t3.ev?.actionPreview?.changes ?? {}
check('T3 corrección aplicada (nuevo manda)', Number(c3.start_hour) === 17, `start_hour=${c3.start_hour}`)
check('T3 conserva el resto de lo acumulado', Object.keys(merged).filter((k) => k !== 'start_hour').every((k) => k in c3))

// T4 — CAMBIO DE TEMA explícito: la acción pendiente se supersede (no contamina la cartera).
const t4 = await T('vale, déjalo por ahora; enséñame la cartera de inmuebles')
check('T4 no arrastra la acción al nuevo tema', !t4.r.trace.plan.goals.some((g) => g.capability === 'calendar.create'), `caps=${t4.r.trace.plan.goals.map((g) => g.capability).join(',')}`)
check('T4 pendingAction superseded', d.pendingAction === null || d.pendingAction?.capability !== 'calendar.create', `pending=${d.pendingAction?.capability ?? 'null'}`)

// Verificación de NO-MUTACIÓN: nada de esto escribió en calendar_events.
const { count } = await supabase.from('calendar_events').select('id', { count: 'exact', head: true }).eq('workspace_id', WS).ilike('title', '%Visita piso centro%')
check('0 escrituras reales (dry-run)', (count ?? 0) === 0, `matches=${count}`)

console.log(`\nFASE 53: ${pass}/${tot} ${pass === tot ? '· SLOT ACCUMULATION OK ✓' : '· REVISAR ✗'}`)
setTimeout(() => process.exit(pass === tot ? 0 : 1), 300)
