// P70 Wave D — CHAOS E2E del scheduler: concurrencia real (dos run_due simultáneos), idempotencia por
// ventana, catch-up con ventanas omitidas auditadas, recuperación de runs colgados, DST Europe/Madrid
// (primavera/otoño), medianoche, weekdays/weekly, disabled/future skip, config corrupta, conflicto de
// edición y aislamiento cross-workspace. Fixtures QA en un workspace SINTÉTICO (uuid propio) para no
// tocar reglas reales; cleanup total. No imprime secretos.
// Uso: AGENT_ACTION_URL=http://localhost:3211 npx tsx --tsconfig tsconfig.json scripts/p70-scheduler-chaos-e2e.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function envLocal(name: string): string | undefined {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined
}
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const SUPA_URL = envLocal('NEXT_PUBLIC_SUPABASE_URL')!
const SERVICE = envLocal('SUPABASE_SERVICE_ROLE_KEY')!
const BASE = String(process.env.AGENT_ACTION_URL).replace(/\/$/, '')
const WS = 'd0000000-0000-4000-8000-000000000001'                       // demo (para findings reales)
const WS_OTHER = 'facadeb0-0000-4000-8000-0000c4a05000'                 // workspace sintético (aislamiento)
console.log(`Plano: ${BASE}`)

const { computeNextRunMadrid, madridOffsetFor, scheduleLabelOf } = await import('@/lib/agents/automation-schedule')
const supabase = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}  ${extra}`) } }
async function api(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${BASE}/api/agent/automation`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': process.env.AGENT_TOOL_SECRET! }, body: JSON.stringify(body) })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
// Margen de 2 min contra el SKEW reloj local vs now() de Postgres (residuos que escapaban al cleanup).
const testStartIso = new Date(Date.now() - 120_000).toISOString()
// Cleanup ROBUSTO: por timestamp Y por nombre (residuos de runs fallidos previos), comprobando errores
// (un delete con FK violada no puede pasar en silencio — lección de un residuo real que rompió P69).
async function cleanup() {
  for (const ws of [WS, WS_OTHER]) {
    const { data: rules } = await supabase.from('assistant_automation_rules').select('id')
      .eq('workspace_id', ws).or(`created_at.gte.${testStartIso},name.ilike.chaos %`)
    for (const r of rules ?? []) {
      const d1 = await supabase.from('assistant_automation_runs').delete().eq('rule_id', r.id)
      const d2 = await supabase.from('assistant_automation_rules').delete().eq('id', r.id)
      if (d1.error || d2.error) console.error(`CLEANUP ERROR regla ${String(r.id).slice(0, 8)}…: ${d1.error?.message ?? d2.error?.message}`)
    }
    await supabase.from('assistant_findings').delete().eq('workspace_id', ws).gte('detected_at', testStartIso)
  }
}
async function mkRule(ws: string, type: string, schedule: Record<string, unknown>, nextRunAt: string, enabled = true): Promise<string> {
  const { data, error } = await supabase.from('assistant_automation_rules').insert({
    workspace_id: ws, type, name: `chaos ${type}`, enabled, schedule_json: schedule, timezone: 'Europe/Madrid', next_run_at: nextRunAt,
  }).select('id').single()
  if (error || !data) throw new Error(`mkRule falló: ${error?.message}`)
  return String(data.id)
}

// ════ 1) computeNextRunMadrid — DST, medianoche, weekdays, weekly ════
{
  // DST PRIMAVERA (EU 2026-03-29): el sábado previo a las 20:00 Madrid (+01) → domingo 08:00 con +02.
  const beforeSpring = new Date('2026-03-28T19:00:00Z') // 20:00 Madrid (+01)
  const spring = computeNextRunMadrid({ frequency: 'daily', hour: 8 }, beforeSpring)
  check('DST primavera: 08:00 Madrid = 06:00Z tras el cambio', spring === '2026-03-29T06:00:00.000Z', spring)
  check('offset real: 2026-03-28 = +01:00 y 2026-03-29 = +02:00', madridOffsetFor('2026-03-28') === '+01:00' && madridOffsetFor('2026-03-29') === '+02:00', `${madridOffsetFor('2026-03-28')} ${madridOffsetFor('2026-03-29')}`)
  // DST OTOÑO (EU 2026-10-25): el sábado previo a las 20:00 Madrid (+02) → domingo 08:00 con +01.
  const beforeFall = new Date('2026-10-24T18:00:00Z') // 20:00 Madrid (+02)
  const fall = computeNextRunMadrid({ frequency: 'daily', hour: 8 }, beforeFall)
  check('DST otoño: 08:00 Madrid = 07:00Z tras el cambio', fall === '2026-10-25T07:00:00.000Z', fall)
  // Hora futura HOY vs pasada HOY.
  const base = new Date('2026-07-15T06:00:00Z') // 08:00 Madrid
  check('hora futura hoy → hoy', computeNextRunMadrid({ frequency: 'daily', hour: 10 }, base) === '2026-07-15T08:00:00.000Z')
  check('hora pasada hoy → mañana', computeNextRunMadrid({ frequency: 'daily', hour: 7 }, base) === '2026-07-16T05:00:00.000Z')
  // Weekdays: viernes tarde → lunes; domingo → lunes.
  const friday = new Date('2026-07-17T18:00:00Z')
  check('weekdays: viernes tarde → lunes', computeNextRunMadrid({ frequency: 'weekdays', hour: 8 }, friday) === '2026-07-20T06:00:00.000Z', computeNextRunMadrid({ frequency: 'weekdays', hour: 8 }, friday))
  const sunday = new Date('2026-07-19T10:00:00Z')
  check('weekdays: domingo → lunes', computeNextRunMadrid({ frequency: 'weekdays', hour: 8 }, sunday) === '2026-07-20T06:00:00.000Z')
  // Weekly lunes desde martes → siguiente lunes.
  const tuesday = new Date('2026-07-14T10:00:00Z')
  check('weekly lunes desde martes → próximo lunes', computeNextRunMadrid({ frequency: 'weekly', weekday: 1, hour: 9 }, tuesday) === '2026-07-20T07:00:00.000Z', computeNextRunMadrid({ frequency: 'weekly', weekday: 1, hour: 9 }, tuesday))
  // Medianoche y minutos.
  check('medianoche (hour 0)', computeNextRunMadrid({ frequency: 'daily', hour: 0 }, base) === '2026-07-15T22:00:00.000Z', computeNextRunMadrid({ frequency: 'daily', hour: 0 }, base))
  check('minutos (8:30)', computeNextRunMadrid({ frequency: 'daily', hour: 8, minute: 30 }, base) === '2026-07-15T06:30:00.000Z')
  check('labels correctos', scheduleLabelOf({ frequency: 'weekdays', hour: 8, minute: 30 }) === 'De lunes a viernes a las 8:30' && scheduleLabelOf({ frequency: 'weekly', weekday: 1, hour: 9 }) === 'Todos los lunes a las 9:00')
}

try {
  // ════ 2) Concurrencia: DOS run_due simultáneos → una sola ejecución por ventana ════
  const dueIso = new Date(Date.now() - 60_000).toISOString()
  const r1 = await mkRule(WS, 'overdue_tasks_watch', { frequency: 'daily', hour: 8 }, dueIso)
  const [a, b] = await Promise.all([api({ operation: 'run_due', workspace_id: WS }), api({ operation: 'run_due', workspace_id: WS })])
  check('dos run_due simultáneos responden 200', a.status === 200 && b.status === 200)
  const { data: runs1 } = await supabase.from('assistant_automation_runs').select('id, status, scheduled_for').eq('rule_id', r1)
  const executed1 = (runs1 ?? []).filter((r) => r.scheduled_for && String(r.scheduled_for).slice(0, 19) === dueIso.slice(0, 19) && r.status !== 'skipped')
  check('una sola ejecución para la misma ventana', executed1.length === 1, JSON.stringify(runs1))
  // misma ventana otra vez (retry HTTP): next_run_at ya es futuro → no ejecuta
  const again = await api({ operation: 'run_due', workspace_id: WS })
  const { count: countAfter } = await supabase.from('assistant_automation_runs').select('id', { count: 'exact', head: true }).eq('rule_id', r1)
  check('retry tras completar → no re-ejecuta (future skip)', again.status === 200 && (countAfter ?? 0) === (runs1?.length ?? 0))

  // ════ 3) Catch-up: ventana perdida hace 3 días → UNA ejecución + run skipped auditado ════
  const oldIso = new Date(Date.now() - 3 * 24 * 3600e3).toISOString()
  const r2 = await mkRule(WS, 'overdue_tasks_watch', { frequency: 'daily', hour: 8 }, oldIso)
  await api({ operation: 'run_due', workspace_id: WS })
  const { data: runs2 } = await supabase.from('assistant_automation_runs').select('status, scheduled_for, result_count, safe_error_code').eq('rule_id', r2)
  const exec2 = (runs2 ?? []).filter((r) => r.status !== 'skipped')
  const skip2 = (runs2 ?? []).filter((r) => r.status === 'skipped')
  check('catch-up: exactamente UNA ejecución', exec2.length === 1, JSON.stringify(runs2))
  check('catch-up: ventanas omitidas auditadas en un run skipped', skip2.length === 1 && Number(skip2[0].result_count) >= 2 && skip2[0].safe_error_code === 'AUTOMATION_CATCHUP_SKIPPED', JSON.stringify(skip2))
  const { data: r2row } = await supabase.from('assistant_automation_rules').select('next_run_at').eq('id', r2).maybeSingle()
  check('catch-up: next_run_at recalculado a futuro', new Date(String(r2row?.next_run_at)).getTime() > Date.now())

  // ════ 4) Run colgado: running >15 min → error AUTOMATION_TIMEOUT ════
  const r3 = await mkRule(WS, 'overdue_tasks_watch', { frequency: 'daily', hour: 8 }, new Date(Date.now() + 3600e3).toISOString())
  await supabase.from('assistant_automation_runs').insert({ rule_id: r3, workspace_id: WS, scheduled_for: new Date(Date.now() - 30 * 60_000).toISOString(), status: 'running', started_at: new Date(Date.now() - 30 * 60_000).toISOString() })
  await api({ operation: 'run_due', workspace_id: WS })
  const { data: stuck } = await supabase.from('assistant_automation_runs').select('status, safe_error_code').eq('rule_id', r3)
  check('run colgado → error AUTOMATION_TIMEOUT', stuck?.length === 1 && stuck[0].status === 'error' && stuck[0].safe_error_code === 'AUTOMATION_TIMEOUT', JSON.stringify(stuck))
  check('regla future NO ejecutada por el dispatcher', (await supabase.from('assistant_automation_runs').select('id', { count: 'exact', head: true }).eq('rule_id', r3)).count === 1)

  // ════ 5) Config corrupta → no revienta y next_run_at queda futuro ════
  const r4 = await mkRule(WS, 'overdue_tasks_watch', { frequency: 'yearly', hour: 99 }, new Date(Date.now() - 60_000).toISOString())
  const badCfg = await api({ operation: 'run_due', workspace_id: WS })
  const { data: r4row } = await supabase.from('assistant_automation_rules').select('next_run_at').eq('id', r4).maybeSingle()
  check('config corrupta: run_due 200 + fallback a horario por defecto', badCfg.status === 200 && new Date(String(r4row?.next_run_at)).getTime() > Date.now())

  // ════ 6) Tipo inválido y disabled ════
  const badType = await api({ operation: 'create_rule', workspace_id: WS, type: 'invoice_watch', confirmed: true, schedule: { hour: 8 } })
  check('tipo inválido → AUTOMATION_INVALID_TYPE', badType.status === 422 && badType.json.error === 'AUTOMATION_INVALID_TYPE')
  const noConfirm = await api({ operation: 'create_rule', workspace_id: WS, type: 'overdue_tasks_watch', schedule: { hour: 8 } })
  check('create sin confirmed → 403', noConfirm.status === 403 && noConfirm.json.error === 'AUTOMATION_CONFIRMATION_REQUIRED')
  const r5 = await mkRule(WS, 'overdue_tasks_watch', { frequency: 'daily', hour: 8 }, new Date(Date.now() - 60_000).toISOString(), false)
  await api({ operation: 'run_due', workspace_id: WS })
  check('disabled: jamás ejecuta', (await supabase.from('assistant_automation_runs').select('id', { count: 'exact', head: true }).eq('rule_id', r5)).count === 0)
  const runDisabled = await api({ operation: 'run_rule_now', workspace_id: WS, rule_id: r5 })
  check('run_now sobre disabled → AUTOMATION_DISABLED', runDisabled.status === 409 && runDisabled.json.error === 'AUTOMATION_DISABLED')
  // enable → next_run_at recalculado (nunca la ventana rancia)
  const en = await api({ operation: 'set_rule_enabled', workspace_id: WS, rule_id: r5, enabled: true })
  check('enable recalcula next_run_at a futuro', en.status === 200 && new Date(String(en.json.next_run_at)).getTime() > Date.now(), String(en.json.next_run_at))

  // ════ 7) Edición: conflicto de hash (regla cambió tras el preview) ════
  const prep = await api({ operation: 'prepare_update_rule', workspace_id: WS, rule_id: r5, schedule: { hour: 10 } })
  check('prepare_update_rule → antes/después + hash', prep.status === 200 && typeof prep.json.update_hash === 'string')
  await supabase.from('assistant_automation_rules').update({ schedule_json: { frequency: 'daily', hour: 12 } }).eq('id', r5)
  const staleConfirm = await api({ operation: 'confirm_update_rule', workspace_id: WS, rule_id: r5, update_hash: prep.json.update_hash, confirmed: true, schedule: { hour: 10 } })
  check('confirm con hash rancio → AUTOMATION_UPDATE_CONFLICT', staleConfirm.status === 409 && staleConfirm.json.error === 'AUTOMATION_UPDATE_CONFLICT', `(${staleConfirm.status})`)
  const noConfirmEdit = await api({ operation: 'confirm_update_rule', workspace_id: WS, rule_id: r5, update_hash: 'x', schedule: { hour: 10 } })
  check('confirm_update_rule sin confirmed → 403', noConfirmEdit.status === 403)

  // ════ 8) Aislamiento cross-workspace ════
  const rOther = await mkRule(WS_OTHER, 'daily_executive_brief', { frequency: 'daily', hour: 8 }, new Date(Date.now() - 60_000).toISOString())
  await api({ operation: 'run_due', workspace_id: WS })
  const { data: otherFindings } = await supabase.from('assistant_findings').select('workspace_id').gte('detected_at', testStartIso).eq('workspace_id', WS_OTHER)
  const { data: otherRuns } = await supabase.from('assistant_automation_runs').select('workspace_id').eq('rule_id', rOther)
  check('cross-workspace: los findings del run del ws sintético se quedan en su ws', (otherRuns ?? []).every((r) => r.workspace_id === WS_OTHER) && (otherFindings ?? []).every((f) => f.workspace_id === WS_OTHER))
  const foreignRunNow = await api({ operation: 'run_rule_now', workspace_id: WS, rule_id: rOther })
  check('run_now de regla de OTRO workspace → 404', foreignRunNow.status === 404)
  const foreignEdit = await api({ operation: 'prepare_update_rule', workspace_id: WS, rule_id: rOther, schedule: { hour: 9 } })
  check('editar regla de OTRO workspace → 404', foreignEdit.status === 404)
} finally {
  await cleanup()
}

const { count: leftovers } = await supabase.from('assistant_automation_rules').select('id', { count: 'exact', head: true }).in('workspace_id', [WS, WS_OTHER]).gte('created_at', testStartIso)
check('cleanup: cero reglas residuales', (leftovers ?? 0) === 0)

console.log(`\nP70 SCHEDULER CHAOS E2E: ${pass}/${pass + fail} ${fail ? 'CON FALLOS' : 'TODO PASS'}`)
process.exit(fail ? 1 : 0)
