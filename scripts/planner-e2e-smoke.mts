// E2E SMOKE del pipeline general (plan → validate → execute → synthesize) contra QA REAL.
// Lecturas en vivo; acciones SIEMPRE dry-run (nunca escribe). Demuestra multi-goal, resolución de
// entidad, follow-up con pronombre, semántica financiera, preview de acción, capability-question y
// NOT_FOUND sin fuga global. Uso: npx tsx --tsconfig tsconfig.json scripts/planner-e2e-smoke.mts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
const WS = 'd0000000-0000-4000-8000-000000000001'
const APIKEY = envLocal('OPENAI_API_KEY')!
const MODEL = 'gpt-4.1-mini'
const { runTurn } = await import('@/lib/agents/planner/planner-pipeline')
const { emptyDiscourse } = await import('@/lib/agents/planner/discourse-state')
import type { RichDiscourse } from '@/lib/agents/planner/discourse-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// Snapshot de fixtures ANTES para probar que el dry-run no muta nada.
const { data: propsBefore } = await supabase.from('properties').select('id, title, price').eq('workspace_id', WS).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1)
const prop = propsBefore?.[0]
const { data: cli } = await supabase.from('clients').select('id, name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(1)
const C = String(cli?.[0]?.name ?? 'cliente')

async function turn(d: RichDiscourse, msg: string) {
  const r = await runTurn({ supabase: supabase as never, workspaceId: WS, message: msg, discourse: d, apiKey: APIKEY, plannerModel: MODEL })
  console.log(`\n▸ «${msg}»`)
  console.log('  obs:', JSON.stringify(r.observability))
  console.log('  →', r.answer.replace(/\s+/g, ' ').slice(0, 400))
  return r.discourse
}

console.log(`E2E pipeline · modelo ${MODEL} · cliente=${C} · piso=${prop?.title ?? 'n/a'}`)
let d = emptyDiscourse() as RichDiscourse

// 1. multi-goal explain + count
d = await turn(d, 'oye explícame para qué sirve el módulo de operaciones y de paso dime cuántas tengo abiertas')
// 2. detalle de cliente real
d = await turn(emptyDiscourse() as RichDiscourse, `dame la ficha completa de ${C}`)
// 3. follow-up con pronombre (mantiene discourse del #2)
d = await turn(d, '¿y qué citas tiene esta semana?')
// 4. financiero (comisiones ≠ facturación)
await turn(emptyDiscourse() as RichDiscourse, '¿cuánto llevo generado en comisiones este mes?')
// 5. acción → DRY-RUN preview (no ejecuta)
if (prop) await turn(emptyDiscourse() as RichDiscourse, `sube el precio del piso ${prop.title} a 999999`)
// 6. pregunta de capacidad (no acción)
await turn(emptyDiscourse() as RichDiscourse, '¿se pueden cambiar los precios de los pisos desde aquí?')
// 7. NOT_FOUND sin fuga global
await turn(emptyDiscourse() as RichDiscourse, 'dame la ficha de Zoltan Kirkpatrick Nonexistent')

// Verificar que el precio del piso NO cambió (dry-run real).
if (prop) {
  const { data: after } = await supabase.from('properties').select('price').eq('id', prop.id).maybeSingle()
  console.log(`\n[dry-run check] precio piso antes=${prop.price} después=${after?.price} · ${String(after?.price) === String(prop.price) ? 'SIN MUTACIÓN ✓' : 'MUTÓ ✗✗✗'}`)
}
setTimeout(() => process.exit(0), 400)
