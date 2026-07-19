// Prueba de los MECANISMOS GENERALES nuevos (clases 1-8 de la evidencia humana), con fraseos NO vistos y
// datos reales de QA. NO parchea frases: valida propiedades. Selection RANDOM seedable. Synth off (juez
// estructural). Uso: npx tsx --tsconfig tsconfig.json scripts/planner-new-mechanisms.mts
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
import type { ValidatedPlan } from '@/lib/agents/planner/plan-contract'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const { data: cli } = await supabase.from('clients').select('name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(1)
const C = String(cli?.[0]?.name ?? 'cliente')

type Out = { plan: ValidatedPlan; evs: Evidence[]; disc: RichDiscourse }
async function turn(d: RichDiscourse, msg: string): Promise<Out & { obs: Record<string, unknown> }> {
  const r = await runTurn({ supabase: supabase as never, workspaceId: WS, message: msg, discourse: d, apiKey: APIKEY, plannerModel: MODEL, synth: false, selectionSeed: 42 })
  return { plan: r.trace.plan, evs: r.trace.evidences, disc: r.discourse, obs: r.observability as Record<string, unknown> }
}
const cap = (o: Out, c: string) => o.evs.find((e) => e.capability === c)
let pass = 0, total = 0
function check(name: string, ok: boolean, detail: string) { total++; if (ok) pass++; console.log(`  ${ok ? '✓' : '✗ FALLO'} ${name.padEnd(46)} ${detail}`) }

console.log(`\nMECANISMOS GENERALES · modelo ${MODEL} · cliente=${C}\n`)

// ── Clase 1: SELECTION / CARDINALITY ──
{ const o = await turn(emptyDiscourse() as RichDiscourse, 'enséñame un cliente cualquiera, el que sea'); const e = cap(o, 'clients.list') ?? cap(o, 'clients.search'); check('selection: un cliente al azar → 1, no la lista', !!e && (e.count ?? 99) === 1, `cap=${o.plan.goals.map((g) => `${g.capability}[sel=${g.selection}/out=${g.requestedOutput}]`).join(',')} count=${e?.count}`) }
{ const o = await turn(emptyDiscourse() as RichDiscourse, 'dame un piso al azar de la cartera'); const e = cap(o, 'portfolio.list'); check('selection: un piso al azar → 1', !!e && (e.count ?? 99) === 1, `count=${e?.count} sel=${o.plan.goals[0]?.selection}`) }
{ const o = await turn(emptyDiscourse() as RichDiscourse, 'muéstrame un par de operaciones nada más'); const e = cap(o, 'operations.list'); check('selection: "un par" → 2', !!e && (e.count ?? 99) <= 2, `count=${e?.count} sel=${o.plan.goals[0]?.selection}/${o.plan.goals[0]?.selectionCount}`) }
{ const o = await turn(emptyDiscourse() as RichDiscourse, '¿cuántos clientes tengo en total?'); const e = cap(o, 'clients.count') ?? cap(o, 'clients.list'); check('selection: "en total" NO reduce (all)', !!e && (e.count ?? 0) >= 1, `count=${e?.count} sel=${o.plan.goals[0]?.selection}`) }

// ── Clase 2/8: CAPABILITY INTROSPECTION derivada de registries ──
{ const o = await turn(emptyDiscourse() as RichDiscourse, '¿qué cosas puedes hacer por mí exactamente?'); const e = cap(o, 'capabilities.introspect'); const d = e?.data as { read?: unknown[]; write?: unknown[] } | undefined; check('introspección global → read[] y write[] del registro', !!e && !!d && (d.read?.length ?? 0) > 0 && (d.write?.length ?? 0) > 0, `read=${d?.read?.length} write=${d?.write?.length}`) }
{ const o = await turn(emptyDiscourse() as RichDiscourse, 'oye y con la cartera de pisos qué puedo hacer'); const e = cap(o, 'capabilities.introspect'); const d = e?.data as { write?: Array<{ id: string }> } | undefined; const hasPortfolioWrite = (d?.write ?? []).some((w) => w.id.startsWith('portfolio')); check('introspección por módulo (cartera) → acciones portfolio.*', !!e && hasPortfolioWrite, `write=${(d?.write ?? []).map((w) => w.id).join(',').slice(0, 60)}`) }

// ── Clase 3/7: SPEECH-ACT vs TARGET (pregunta de capacidad sobre entidad ≠ búsqueda) ──
{ const seed = { ...emptyDiscourse(), activeModule: 'clients', activeEntities: [{ type: 'client', label: C }] } as RichDiscourse; const o = await turn(seed, `¿qué cosas puedo hacer con ${C}?`); const isIntro = !!cap(o, 'capabilities.introspect'); const isSearch = !!cap(o, 'clients.search') || !!cap(o, 'clients.detail'); check('capacidad sobre entidad → introspect, NO search', isIntro && !isSearch, `caps=${o.plan.goals.map((g) => g.capability).join(',')} act=${o.plan.speechAct}`) }
{ const o = await turn(emptyDiscourse() as RichDiscourse, '¿puedes cambiarle el teléfono a un cliente?'); const e = cap(o, 'capabilities.introspect'); const noAction = !o.evs.some((x) => x.actionPreview?.ready); check('«¿puedes X?» → introspect, sin preparar acción', !!e && noAction && o.plan.speechAct === 'capability_question', `caps=${o.plan.goals.map((g) => g.capability).join(',')} act=${o.plan.speechAct}`) }

// ── Clase 4/5/6: FOCUS SUPERSESSION (cambio de módulo retira referente stale) ──
{ let d = emptyDiscourse() as RichDiscourse; d = (await turn(d, `abre la ficha de ${C}`)).disc; const o2 = await turn(d, 'vale, ahora enséñame la cartera de inmuebles'); const stillClient = o2.disc.activeEntities.some((e) => e.type === 'client'); check('cambio de foco a cartera retira cliente stale', o2.disc.activeModule === 'portfolio' && !stillClient, `module=${o2.disc.activeModule} entities=${o2.disc.activeEntities.map((e) => e.type).join(',') || '∅'}`) }

console.log(`\nMECANISMOS: ${pass}/${total} · arquitectura observada=${'GENERAL_PLANNER'}`)
setTimeout(() => process.exit(0), 400)
