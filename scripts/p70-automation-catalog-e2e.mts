// P70 Wave D — E2E del CATÁLOGO DE AUTOMATIZACIONES (11 runners reales) + gestión conversacional.
//
// Por cada tipo del registry: frase natural → preview opt-in → confirmación → regla real en BD con
// next_run_at FUTURO → run manual (runner real, run record persistido) → segunda ejecución vía run_due
// → DEDUPE verificado (0 findings nuevos) → next_run_at recalculado → disable → run_due NO ejecuta →
// cleanup. Además, ciclo conversacional completo sobre un tipo (cámbialo a las 9 / 8:30 / lunes a
// viernes / todos los lunes / pausa / reactiva / ejecuta ahora / cuándo / configuración / última vez /
// ejecuciones) y guardas (doble run_now mismo minuto → skipped; run_now en pausa → bloqueado;
// confirmación tras cancelar → no crea). No imprime secretos.
// Uso: AGENT_ACTION_URL=http://localhost:3211 npx tsx --tsconfig tsconfig.json scripts/p70-automation-catalog-e2e.mts

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
const BASE = String(process.env.AGENT_ACTION_URL).replace(/\/$/, '')
console.log(`Plano de automatizaciones: ${BASE}`)

const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { AUTOMATION_RULES, AUTOMATION_RULE_TYPE_LIST } = await import('@/lib/agents/findings-engine')
const { validateAssistantUi } = await import('@/lib/assistant/ui-contract')
const supabase = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}  ${extra}`) } }
const say = async (msg: string, ctx = '') => tryLocalAnswer(supabase as never, WS, msg, { recentContext: ctx })
async function api(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${BASE}/api/agent/automation`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': process.env.AGENT_TOOL_SECRET! }, body: JSON.stringify(body) })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
// Margen de 2 min contra el SKEW entre el reloj local y el now() de Postgres (una regla creada en el
// primer segundo del test quedaba fuera del filtro y del cleanup — bug real reproducido).
const testStartIso = new Date(Date.now() - 120_000).toISOString()

// Cleanup ROBUSTO: comprobando errores (un delete con FK violada jamás pasa en silencio).
async function cleanup() {
  const { data: rules } = await supabase.from('assistant_automation_rules').select('id').eq('workspace_id', WS).gte('created_at', testStartIso)
  for (const r of rules ?? []) {
    const d1 = await supabase.from('assistant_automation_runs').delete().eq('rule_id', r.id)
    const d2 = await supabase.from('assistant_automation_rules').delete().eq('id', r.id)
    if (d1.error || d2.error) console.error(`CLEANUP ERROR regla ${String(r.id).slice(0, 8)}…: ${d1.error?.message ?? d2.error?.message}`)
  }
  await supabase.from('assistant_findings').delete().eq('workspace_id', WS).gte('detected_at', testStartIso)
}

// P71·F3.6 — SWEEP de RESIDUOS de ejecuciones anteriores MATADAS. El cleanup vive en un `finally`, pero un
// proceso terminado con kill (timeout del runner) nunca lo ejecuta → quedaban reglas huérfanas que rompían
// la desambiguación («¿a cuál te refieres?») y el benchmark (bm-0304, 2×data_quality_watch del 07-15).
// Propiedad demostrable: el flujo del E2E deja SIEMPRE cada regla de tipo bajo test deshabilitada y borrada;
// una regla DESHABILITADA de un tipo bajo test en el workspace QA solo puede ser residuo de este E2E.
// Solo se toca el workspace QA y solo reglas deshabilitadas de los tipos que este script crea.
async function sweepResiduals() {
  const { data: stale } = await supabase.from('assistant_automation_rules')
    .select('id, type, created_at').eq('workspace_id', WS).eq('enabled', false)
    .in('type', [...AUTOMATION_RULE_TYPE_LIST])
  for (const r of stale ?? []) {
    const d1 = await supabase.from('assistant_automation_runs').delete().eq('rule_id', r.id)
    const d2 = await supabase.from('assistant_automation_rules').delete().eq('id', r.id)
    if (d1.error || d2.error) console.error(`SWEEP ERROR regla ${String(r.id).slice(0, 8)}…: ${d1.error?.message ?? d2.error?.message}`)
    else console.log(`SWEEP  residuo QA eliminado: ${String(r.type)} (${String(r.created_at).slice(0, 19)})`)
  }
}
await sweepResiduals()

const table: string[] = []
try {
  // ════ CICLO POR TIPO (11) ════
  for (const type of AUTOMATION_RULE_TYPE_LIST) {
    const def = AUTOMATION_RULES[type]
    const row: string[] = [type]
    // 1) frase natural → preview (opt-in, nada creado)
    const prev = await say(def.chatExamples[0])
    const prevUi = prev.handled ? validateAssistantUi(prev.ui ?? null) : null
    const previewOk = prev.handled && prevUi?.kind === 'automation_preview' && prevUi.automation?.status === 'awaiting_confirmation'
    row.push(previewOk ? 'preview✓' : 'preview✗')
    const { count: before } = await supabase.from('assistant_automation_rules').select('id', { count: 'exact', head: true }).eq('workspace_id', WS).eq('type', type).gte('created_at', testStartIso)
    // 2) confirmación → regla real
    const conf = await say('sí, confirma', prev.handled ? prev.answer : '')
    const confOk = conf.handled && /activada y programada/i.test(conf.answer)
    const { data: rules } = await supabase.from('assistant_automation_rules').select('id, enabled, next_run_at, schedule_json').eq('workspace_id', WS).eq('type', type).gte('created_at', testStartIso).order('created_at', { ascending: false }).limit(1)
    const rule = rules?.[0]
    const created = confOk && !!rule && rule.enabled === true && (before ?? 0) === 0
    row.push(created ? 'create✓' : 'create✗')
    row.push(rule && new Date(String(rule.next_run_at)).getTime() > Date.now() ? 'schedule✓' : 'schedule✗')
    if (!rule) { table.push(row.join(' | ')); check(`${type}: ciclo completo`, false, 'sin regla'); continue }
    // 3) run manual → runner real + run record
    const run1 = await api({ operation: 'run_rule_now', workspace_id: WS, rule_id: rule.id })
    const run1Ok = run1.status === 200 && ['success', 'partial'].includes(String(run1.json.status)) && typeof run1.json.run_id === 'string'
    row.push(run1Ok ? 'run✓' : 'run✗')
    // 4) segunda ejecución vía run_due (ventana pasada) → DEDUPE: 0 findings nuevos
    await supabase.from('assistant_automation_rules').update({ next_run_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', rule.id)
    const due = await api({ operation: 'run_due', workspace_id: WS })
    const dueRes = ((due.json.results ?? []) as Array<Record<string, unknown>>).find((x) => x.rule_id === rule.id)
    const dedupeOk = due.status === 200 && !!dueRes && Number(dueRes.new_findings ?? -1) === 0
    row.push(dedupeOk ? 'dedupe✓' : 'dedupe✗')
    const { data: after } = await supabase.from('assistant_automation_rules').select('next_run_at').eq('id', rule.id).maybeSingle()
    row.push(after && new Date(String(after.next_run_at)).getTime() > Date.now() ? 'nextrun✓' : 'nextrun✗')
    // 5) disable → run_due no ejecuta
    await api({ operation: 'set_rule_enabled', workspace_id: WS, rule_id: rule.id, enabled: false })
    await supabase.from('assistant_automation_rules').update({ next_run_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', rule.id)
    const { count: runsBefore } = await supabase.from('assistant_automation_runs').select('id', { count: 'exact', head: true }).eq('rule_id', rule.id)
    await api({ operation: 'run_due', workspace_id: WS })
    const { count: runsAfter } = await supabase.from('assistant_automation_runs').select('id', { count: 'exact', head: true }).eq('rule_id', rule.id)
    row.push((runsBefore ?? 0) === (runsAfter ?? 0) ? 'disabled-skip✓' : 'disabled-skip✗')
    table.push(row.join(' | '))
    check(`${type}: preview→create→schedule→run→dedupe→disable`, row.every((c) => !c.includes('✗')), row.join(' | '))
    // limpiar la regla de este tipo antes del siguiente (evita ambigüedad en resolución conversacional)
    await supabase.from('assistant_automation_runs').delete().eq('rule_id', rule.id)
    await supabase.from('assistant_automation_rules').delete().eq('id', rule.id)
  }

  // ════ GESTIÓN CONVERSACIONAL (sobre daily_executive_brief) ════
  const prev = await say('activa un resumen diario a las 8')
  const conf = await say('sí, confirma', prev.handled ? prev.answer : '')
  check('conversacional: regla base creada', conf.handled && /activada/i.test(conf.answer))
  const { data: baseRules } = await supabase.from('assistant_automation_rules').select('id, schedule_json, next_run_at').eq('workspace_id', WS).eq('type', 'daily_executive_brief').gte('created_at', testStartIso).limit(1)
  const baseRule = baseRules?.[0]

  // «Cámbialo a las 9» → preview antes/después SIN escribir
  const edit1 = await say('cámbialo a las 9', `${prev.handled ? prev.answer : ''} \n ${conf.handled ? conf.answer : ''}`)
  const edit1Ui = edit1.handled ? validateAssistantUi(edit1.ui ?? null) : null
  check('«cámbialo a las 9» → preview antes→después', edit1.handled && /Antes:.*8:00/.test(edit1.answer) && /Después:.*9:00/.test(edit1.answer) && edit1Ui?.automation?.status === 'awaiting_confirmation', edit1.handled ? edit1.answer.slice(0, 100) : '(no manejado)')
  const { data: noWrite } = await supabase.from('assistant_automation_rules').select('schedule_json').eq('id', String(baseRule?.id)).maybeSingle()
  check('preview de edición NO escribe', Number((noWrite?.schedule_json as Record<string, unknown>)?.hour) === 8)
  // confirmar la edición → verificada
  const edit1c = await say('sí, confirma', edit1.handled ? edit1.answer : '')
  check('edición confirmada → verificada', edit1c.handled && /Horario actualizado y verificado/i.test(edit1c.answer) && /9:00/.test(edit1c.answer), edit1c.handled ? edit1c.answer.slice(0, 90) : '')
  const { data: after9 } = await supabase.from('assistant_automation_rules').select('schedule_json, next_run_at').eq('id', String(baseRule?.id)).maybeSingle()
  check('BD: hora=9 y next_run_at futuro', Number((after9?.schedule_json as Record<string, unknown>)?.hour) === 9 && new Date(String(after9?.next_run_at)).getTime() > Date.now())

  // «Ponlo a las 8:30» → minutos soportados
  const edit2 = await say('pon el resumen diario a las 8:30')
  check('«ponlo a las 8:30» → preview con minutos', edit2.handled && /8:30/.test(edit2.answer), edit2.handled ? edit2.answer.slice(0, 90) : '')
  const edit2c = await say('confirma', edit2.handled ? edit2.answer : '')
  const { data: after830 } = await supabase.from('assistant_automation_rules').select('schedule_json').eq('id', String(baseRule?.id)).maybeSingle()
  const sj830 = (after830?.schedule_json ?? {}) as Record<string, unknown>
  check('BD: 8:30 aplicado', edit2c.handled && Number(sj830.hour) === 8 && Number(sj830.minute) === 30, JSON.stringify(sj830))

  // «Solo de lunes a viernes» → frecuencia weekdays
  const edit3 = await say('pon el resumen diario solo de lunes a viernes')
  check('«lunes a viernes» → preview weekdays', edit3.handled && /lunes a viernes/i.test(edit3.answer), edit3.handled ? edit3.answer.slice(0, 90) : '')
  await say('confirma', edit3.handled ? edit3.answer : '')
  const { data: afterWd } = await supabase.from('assistant_automation_rules').select('schedule_json').eq('id', String(baseRule?.id)).maybeSingle()
  check('BD: frequency=weekdays', String((afterWd?.schedule_json as Record<string, unknown>)?.frequency) === 'weekdays')

  // «Todos los lunes» → weekly (permitido en data_quality; en brief NO está permitido → rechazo honesto)
  const edit4 = await say('pon el resumen diario todos los lunes')
  check('weekly no permitido en brief → rechazo honesto', edit4.handled && /frecuencia no permitida/i.test(edit4.answer), edit4.handled ? edit4.answer.slice(0, 100) : '')

  // «¿Cuándo se ejecuta?» / configuración
  const when = await say('¿cuándo se ejecuta el resumen diario?')
  check('«¿cuándo se ejecuta?» → próxima ejecución', when.handled && /Próxima ejecución/i.test(when.answer), when.handled ? when.answer.slice(0, 90) : '')
  const cfg = await say('muéstrame la configuración del resumen diario')
  check('configuración → horario + criterio', cfg.handled && /Horario:/.test(cfg.answer) && /Qué vigila:/.test(cfg.answer), cfg.handled ? cfg.answer.slice(0, 110) : '')

  // «Ejecuta ahora» + última ejecución + historial
  const runNow = await say('ejecuta ahora el resumen diario')
  check('«ejecuta ahora» → ejecutada con resumen', runNow.handled && /Ejecutada ahora mismo/i.test(runNow.answer), runNow.handled ? runNow.answer.slice(0, 90) : '')
  const dupNow = await say('ejecuta ahora el resumen diario')
  check('doble run_now mismo minuto → no duplica', dupNow.handled && /no la duplico/i.test(dupNow.answer), dupNow.handled ? dupNow.answer.slice(0, 90) : '')
  const lastRun = await say('¿qué encontró la última vez el resumen diario?')
  check('«¿qué encontró la última vez?»', lastRun.handled && /Última ejecución/i.test(lastRun.answer), lastRun.handled ? lastRun.answer.slice(0, 90) : '')
  const runsList = await say('muéstrame las ejecuciones del resumen diario')
  check('historial de ejecuciones (sin UUIDs)', runsList.handled && /Ejecuciones de/i.test(runsList.answer) && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(runsList.answer), runsList.handled ? runsList.answer.slice(0, 110) : '')

  // Pausa → run_now bloqueado → reactivar (next_run recalculado)
  const pause = await say('pausa el resumen diario')
  check('«pausa» → en pausa reversible', pause.handled && /queda desactivada \(en pausa\)/i.test(pause.answer), pause.handled ? pause.answer.slice(0, 90) : '')
  const runPaused = await say('ejecuta ahora el resumen diario')
  check('run_now en pausa → bloqueado honesto', runPaused.handled && /está en pausa/i.test(runPaused.answer), runPaused.handled ? runPaused.answer.slice(0, 90) : '')
  const resume = await say('reactiva el resumen diario')
  check('«reactívala» → activa con próxima ejecución recalculada', resume.handled && /vuelve a estar activa/i.test(resume.answer) && /Próxima ejecución/i.test(resume.answer), resume.handled ? resume.answer.slice(0, 110) : '')

  // Cancelación de una edición → no escribe y neutraliza
  const edit5 = await say('cambia el resumen diario a las 11')
  const cancel5 = await say('mejor no, déjalo', edit5.handled ? edit5.answer : '')
  check('cancelar edición → no cambia horario', cancel5.handled && /no cambio el horario/i.test(cancel5.answer), cancel5.handled ? cancel5.answer.slice(0, 90) : '')
  const confAfterCancel = await say('sí, confirma', `${edit5.handled ? edit5.answer : ''} \n ${cancel5.handled ? cancel5.answer : ''}`)
  const { data: afterCancel } = await supabase.from('assistant_automation_rules').select('schedule_json').eq('id', String(baseRule?.id)).maybeSingle()
  check('confirmar tras cancelar → NO aplica la edición', Number((afterCancel?.schedule_json as Record<string, unknown>)?.hour) !== 11, JSON.stringify(afterCancel?.schedule_json) + (confAfterCancel.handled ? '' : ''))
} finally {
  await cleanup()
}

const { count: leftovers } = await supabase.from('assistant_automation_rules').select('id', { count: 'exact', head: true }).eq('workspace_id', WS).gte('created_at', testStartIso)
check('cleanup: cero reglas residuales', (leftovers ?? 0) === 0)
// P71·F3.6 — regresión PERMANENTE: cero duplicados por tipo en el workspace QA (un duplicado = residuo de
// una ejecución matada; rompe la desambiguación conversacional y el benchmark). Falla el gate si aparece.
{
  const { data: allRules } = await supabase.from('assistant_automation_rules').select('type').eq('workspace_id', WS)
  const byType = new Map<string, number>()
  for (const r of (allRules ?? []) as Array<{ type: string }>) byType.set(r.type, (byType.get(r.type) ?? 0) + 1)
  const dups = [...byType.entries()].filter(([, c]) => c > 1)
  check('higiene: cero duplicados por tipo en el workspace QA', dups.length === 0, dups.map(([t, c]) => `${t}×${c}`).join(', '))
}

console.log('\n── Tabla por tipo ──')
for (const r of table) console.log(r)
console.log(`\nP70 AUTOMATION CATALOG E2E: ${pass}/${pass + fail} ${fail ? 'CON FALLOS' : 'TODO PASS'}`)
process.exit(fail ? 1 : 0)
