// FASE 9 — SIN FALLBACK SEMÁNTICO SILENCIOSO ON→P71. Prueba las rutas de fallo del planner:
//   1) modelo caído sin alternativo → respuesta VERAZ de indisponibilidad (no "no te entendí", no P71);
//   2) modelo caído + PLANNER_FALLBACK_MODEL válido → el plan se recupera vía modelo alternativo de config;
//   3) plannerAnswer con modelo roto → SIEMPRE non-null degraded (la route jamás cae a P71 por runtime);
//   4) plannerAnswer sin OPENAI_API_KEY → null (ÚNICO caso config, la route lo registra explícito).
//   npx tsx --tsconfig tsconfig.json scripts/planner-on-fallback.mts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
const WS = 'd0000000-0000-4000-8000-000000000001'
const APIKEY = envLocal('OPENAI_API_KEY')!
const GOOD = envLocal('PLANNER_MODEL') || 'gpt-4.1-mini'
const BROKEN = 'gpt-nonexistent-model-zz9'
const { runTurn, PLANNER_UNAVAILABLE_MSG } = await import('@/lib/agents/planner/planner-pipeline')
const { plannerAnswer } = await import('@/lib/agents/planner/shadow-hook')
const { emptyDiscourse } = await import('@/lib/agents/planner/discourse-state')
import type { RichDiscourse } from '@/lib/agents/planner/discourse-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

let pass = 0, tot = 0
const check = (name: string, ok: boolean, detail = '') => { tot++; if (ok) pass++; console.log(`  ${ok ? '✓' : '✗ FALLO'} ${name}${detail ? ` · ${detail}` : ''}`) }

console.log('\nFASE 9 — RUTAS DE FALLO DEL PLANNER BAJO ON\n')

// 1) Modelo caído, sin alternativo → indisponibilidad VERAZ (nunca clarificación engañosa, nunca P71).
const r1 = await runTurn({ supabase: supabase as never, workspaceId: WS, message: '¿cuántos clientes tengo?', discourse: emptyDiscourse() as RichDiscourse, apiKey: APIKEY, plannerModel: BROKEN, synth: true, selectionSeed: 1 })
const o1 = r1.observability as Record<string, unknown>
check('modelo caído → plannerUnavailable=true', o1.plannerUnavailable === true, `model=${o1.plannerModel}`)
check('modelo caído → respuesta = mensaje VERAZ de indisponibilidad', r1.answer.includes('no puedo analizar') || r1.answer === PLANNER_UNAVAILABLE_MSG, `answer=«${r1.answer.slice(0, 60)}»`)
check('modelo caído → reintento infra acotado registrado', Number(o1.planInfraRetries) >= 1, `retries=${o1.planInfraRetries}`)
check('modelo caído → atribución GENERAL_PLANNER intacta', o1.assistantArchitecture === 'GENERAL_PLANNER')

// 2) Modelo caído + fallback de config válido → el plan se RECUPERA con el modelo alternativo.
const r2 = await runTurn({ supabase: supabase as never, workspaceId: WS, message: '¿cuántos clientes tengo?', discourse: emptyDiscourse() as RichDiscourse, apiKey: APIKEY, plannerModel: BROKEN, plannerFallbackModel: GOOD, synth: false, selectionSeed: 1 })
const o2 = r2.observability as Record<string, unknown>
check('fallback de config → plan recuperado', o2.plannerUnavailable === false && (o2.capabilities as string[]).some((c) => c.startsWith('clients.')), `caps=${(o2.capabilities as string[]).join(',')}`)
check('fallback de config → retries=2 (mismo modelo + alternativo)', Number(o2.planInfraRetries) === 2)

// 3) plannerAnswer con modelo roto → non-null degraded (la route NUNCA cae a P71 por fallo de runtime).
const prevModel = process.env.PLANNER_MODEL
process.env.PLANNER_MODEL = BROKEN
delete process.env.PLANNER_FALLBACK_MODEL
process.env.OPENAI_API_KEY = APIKEY
const pa3 = await plannerAnswer({ supabase: supabase as never, workspaceId: WS, message: 'hola, ¿qué tal?', convState: null })
check('plannerAnswer(runtime roto) → non-null', pa3 !== null)
check('plannerAnswer(runtime roto) → degraded + respuesta veraz no vacía', Boolean(pa3?.degraded) && Boolean(pa3?.answer?.trim()), `answer=«${String(pa3?.answer).slice(0, 50)}»`)

// 4) Sin OPENAI_API_KEY → null (único caso de continuación a P71: misconfiguración explícita).
delete process.env.OPENAI_API_KEY
const pa4 = await plannerAnswer({ supabase: supabase as never, workspaceId: WS, message: 'hola', convState: null })
check('plannerAnswer(sin API key) → null (config, no runtime)', pa4 === null)
process.env.OPENAI_API_KEY = APIKEY
if (prevModel) process.env.PLANNER_MODEL = prevModel; else delete process.env.PLANNER_MODEL

console.log(`\nFASE 9: ${pass}/${tot} ${pass === tot ? '· SIN FALLBACK SEMÁNTICO SILENCIOSO ✓' : '· HAY DEUDA ✗'}`)
setTimeout(() => process.exit(pass === tot ? 0 : 1), 300)
