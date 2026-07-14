// POST /api/agent/automation (P67 → P70 Wave D) — inteligencia proactiva y SCHEDULER endurecido.
// Server-to-server (x-nowcrm-secret, mismo modelo que /api/agent/tool).
//
// Operaciones: run_data_quality, list_findings, resolve_finding (P67) · create_rule, set_rule_enabled,
// list_rules, run_due (P68) · P70 Wave D: prepare_update_rule/confirm_update_rule (preview + hash,
// nunca escritura directa desde texto), run_rule_now (idempotente por minuto), list_runs, y run_due con
// claim atómico por ventana (unique rule_id+scheduled_for), despacho por RUNNER real del registry,
// recuperación de runs colgados y política de catch-up (máx 1 ventana recuperada; las omitidas quedan
// auditadas en UN run 'skipped'). NUNCA modifica datos de negocio; solo findings/reglas/runs.

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual, createHash } from 'node:crypto'
import {
  detectFindings, persistFindings, runAutomationRule,
  getAutomationRuleDefinition, AUTOMATION_RULE_TYPE_LIST,
} from '@/lib/agents/findings-engine'
import { computeNextRunMadrid, parseSchedule, scheduleLabelOf, type ScheduleJson } from '@/lib/agents/automation-schedule'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function err(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: code, message }, { status })
}
// Hash del preview de edición: liga la confirmación al estado leído (regla + cambio propuesto).
function updateHashOf(rule: Row, after: ScheduleJson): string {
  return createHash('sha256').update(JSON.stringify({ id: rule.id, cur: rule.schedule_json, en: rule.enabled, after })).digest('hex').slice(0, 16)
}

async function loadRule(supabase: SupabaseClient, ws: string, ruleId: string): Promise<Row | null> {
  if (!UUID_RE.test(ruleId)) return null
  const { data } = await supabase.from('assistant_automation_rules').select('*').eq('workspace_id', ws).eq('id', ruleId).maybeSingle()
  return (data as Row) ?? null
}

// Ejecuta el runner de una regla y persiste run + findings. `scheduledFor` es la ventana reclamada.
async function executeRuleRun(supabase: SupabaseClient, rule: Row, scheduledFor: string): Promise<{ runId: string | null; status: string; created: number; duplicates: number; summary: string; sourceStatus: Row } | { skipped: true }> {
  const { data: run, error: runErr } = await supabase.from('assistant_automation_runs')
    .insert({ rule_id: rule.id, workspace_id: rule.workspace_id, scheduled_for: scheduledFor }).select('id').single()
  if (runErr) return { skipped: true } // 23505 → ventana ya reclamada (idempotencia)
  let status = 'success', created = 0, duplicates = 0, summary = '', sourceStatus: Row = {}
  try {
    const out = await runAutomationRule(supabase, String(rule.workspace_id), String(rule.type))
    const persisted = out.findings.length ? await persistFindings(supabase, String(rule.workspace_id), out.findings) : { created: 0, duplicates: 0, createdIds: [] }
    created = persisted.created; duplicates = persisted.duplicates
    summary = out.summary; sourceStatus = out.sourceStatus as Row
    status = out.status === 'completed' ? 'success' : out.status === 'partial' ? 'partial' : 'error'
  } catch { status = 'error'; summary = 'El runner falló de forma inesperada.' }
  await supabase.from('assistant_automation_runs').update({
    status, finished_at: new Date().toISOString(), result_count: created,
    safe_error_code: status === 'error' ? 'AUTOMATION_EXECUTION_ERROR' : null,
  }).eq('id', run.id)
  return { runId: String(run.id), status, created, duplicates, summary, sourceStatus }
}

export async function POST(req: Request) {
  const secret = process.env.AGENT_TOOL_SECRET
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret || !url || !serviceKey) return err(503, 'endpoint_disabled', 'Config incompleta.')
  const header = req.headers.get('x-nowcrm-secret')
  if (!header || Buffer.from(header).length !== Buffer.from(secret).length || !timingSafeEqual(Buffer.from(header), Buffer.from(secret))) {
    return err(401, 'unauthorized', 'Credencial inválida.')
  }
  let body: Row
  try { body = await req.json() } catch { return err(400, 'invalid_json', 'Body inválido.') }
  const ws = String(body.workspace_id ?? '')
  if (!UUID_RE.test(ws)) return err(400, 'invalid_workspace', 'workspace_id requerido.')
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
  const op = String(body.operation ?? '')

  if (op === 'run_data_quality') {
    const findings = await detectFindings(supabase, ws)
    const { created, duplicates } = await persistFindings(supabase, ws, findings)
    const { data: open } = await supabase.from('assistant_findings')
      .select('id, finding_type, entity_type, title, summary, severity, status, detected_at')
      .eq('workspace_id', ws).eq('status', 'open').order('severity').order('detected_at', { ascending: false }).limit(20)
    return NextResponse.json({ ok: true, operation: op, detected: findings.length, created, duplicates, open_findings: open ?? [] })
  }
  if (op === 'list_findings') {
    const { data } = await supabase.from('assistant_findings')
      .select('id, finding_type, title, summary, severity, status, detected_at')
      .eq('workspace_id', ws).eq('status', 'open').order('severity').order('detected_at', { ascending: false }).limit(50)
    return NextResponse.json({ ok: true, operation: op, findings: data ?? [] })
  }
  if (op === 'resolve_finding') {
    const id = String(body.finding_id ?? '')
    if (!UUID_RE.test(id)) return err(422, 'invalid_input', 'finding_id requerido.')
    const { data } = await supabase.from('assistant_findings')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id).eq('workspace_id', ws).in('status', ['open', 'acknowledged']).select('id')
    if (!data?.length) return err(404, 'finding_not_found', 'No hay finding abierto con ese id.')
    return NextResponse.json({ ok: true, operation: op, finding_id: id, status: 'resolved' })
  }

  // ── Reglas (P68 + Wave D) ──
  if (op === 'create_rule') {
    const type = String(body.type ?? '')
    const def = getAutomationRuleDefinition(type)
    if (!def) return err(422, 'AUTOMATION_INVALID_TYPE', `Tipo no soportado. Válidos: ${AUTOMATION_RULE_TYPE_LIST.join(', ')}.`)
    if (body.confirmed !== true) return err(403, 'AUTOMATION_CONFIRMATION_REQUIRED', 'La activación requiere confirmación explícita (confirmed=true).')
    const schedule = parseSchedule(body.schedule, { frequency: 'daily', hour: def.defaultHour })
    if (!schedule) return err(422, 'AUTOMATION_INVALID_SCHEDULE', 'Horario inválido.')
    if (!def.allowedFrequencies.includes(schedule.frequency)) return err(422, 'AUTOMATION_INVALID_SCHEDULE', `Frecuencia no permitida para este tipo. Válidas: ${def.allowedFrequencies.join(', ')}.`)
    const next = computeNextRunMadrid(schedule)
    const { data, error } = await supabase.from('assistant_automation_rules').insert({
      workspace_id: ws, type, name: String(body.name ?? def.label).slice(0, 120), enabled: true,
      schedule_json: schedule, timezone: 'Europe/Madrid', next_run_at: next,
    }).select('id, next_run_at').single()
    if (error || !data) return err(500, 'AUTOMATION_EXECUTION_ERROR', 'No pude crear la regla.')
    return NextResponse.json({ ok: true, operation: op, rule_id: data.id, enabled: true, next_run_at: data.next_run_at, schedule, schedule_label: scheduleLabelOf(schedule) })
  }

  // P70 Wave D — EDICIÓN con preview + confirmación (nunca escritura directa desde texto).
  if (op === 'prepare_update_rule') {
    const rule = await loadRule(supabase, ws, String(body.rule_id ?? ''))
    if (!rule) return err(404, 'AUTOMATION_RULE_NOT_FOUND', 'Regla no encontrada.')
    const def = getAutomationRuleDefinition(String(rule.type))
    const before = parseSchedule(rule.schedule_json)
    const after = parseSchedule(body.schedule, before ?? undefined)
    if (!before || !after) return err(422, 'AUTOMATION_INVALID_SCHEDULE', 'Horario inválido.')
    if (def && !def.allowedFrequencies.includes(after.frequency)) return err(422, 'AUTOMATION_INVALID_SCHEDULE', `Frecuencia no permitida para este tipo. Válidas: ${def.allowedFrequencies.join(', ')}.`)
    const nextPreview = computeNextRunMadrid(after)
    return NextResponse.json({
      ok: true, operation: op, rule_id: rule.id, name: rule.name, type: rule.type, enabled: rule.enabled,
      before: { schedule: before, label: scheduleLabelOf(before) },
      after: { schedule: after, label: scheduleLabelOf(after), next_run_at: nextPreview },
      update_hash: updateHashOf(rule, after), confirmation_required: true,
    })
  }
  if (op === 'confirm_update_rule') {
    if (body.confirmed !== true) return err(403, 'AUTOMATION_CONFIRMATION_REQUIRED', 'La edición requiere confirmación explícita.')
    const rule = await loadRule(supabase, ws, String(body.rule_id ?? ''))
    if (!rule) return err(404, 'AUTOMATION_RULE_NOT_FOUND', 'Regla no encontrada.')
    const after = parseSchedule(body.schedule, parseSchedule(rule.schedule_json) ?? undefined)
    if (!after) return err(422, 'AUTOMATION_INVALID_SCHEDULE', 'Horario inválido.')
    // El hash liga la confirmación al estado leído en el preview: si la regla cambió → conflicto.
    if (String(body.update_hash ?? '') !== updateHashOf(rule, after)) {
      return err(409, 'AUTOMATION_UPDATE_CONFLICT', 'La regla cambió después del preview; vuelve a pedir el cambio.')
    }
    const next = computeNextRunMadrid(after)
    const { data } = await supabase.from('assistant_automation_rules')
      .update({ schedule_json: after, next_run_at: next, updated_at: new Date().toISOString() })
      .eq('id', rule.id).eq('workspace_id', ws).select('id, schedule_json, next_run_at, enabled, name, type').maybeSingle()
    if (!data) return err(500, 'AUTOMATION_EXECUTION_ERROR', 'No pude aplicar el cambio.')
    // read-after-write: lo devuelto ES la relectura del UPDATE.
    return NextResponse.json({ ok: true, operation: op, rule_id: data.id, schedule: data.schedule_json, schedule_label: scheduleLabelOf(after), next_run_at: data.next_run_at, enabled: data.enabled, name: data.name, type: data.type })
  }

  if (op === 'set_rule_enabled') {
    const rule = await loadRule(supabase, ws, String(body.rule_id ?? ''))
    if (!rule) return err(404, 'AUTOMATION_RULE_NOT_FOUND', 'Regla no encontrada.')
    const enable = body.enabled === true
    // Al REACTIVAR se recalcula next_run_at (jamás se ejecuta una ventana rancia de cuando estaba pausada).
    const schedule = parseSchedule(rule.schedule_json) ?? { frequency: 'daily' as const, hour: 8 }
    const patch: Row = { enabled: enable, updated_at: new Date().toISOString() }
    if (enable) patch.next_run_at = computeNextRunMadrid(schedule)
    const { data } = await supabase.from('assistant_automation_rules').update(patch)
      .eq('id', rule.id).eq('workspace_id', ws).select('id, enabled, next_run_at, name, type, schedule_json').maybeSingle()
    if (!data) return err(500, 'AUTOMATION_EXECUTION_ERROR', 'No pude cambiar el estado.')
    return NextResponse.json({ ok: true, operation: op, rule_id: data.id, enabled: data.enabled, next_run_at: data.next_run_at, name: data.name, type: data.type, schedule_label: scheduleLabelOf(schedule) })
  }

  if (op === 'list_rules') {
    const { data } = await supabase.from('assistant_automation_rules')
      .select('id, type, name, enabled, schedule_json, timezone, last_run_at, next_run_at')
      .eq('workspace_id', ws).order('created_at', { ascending: false }).limit(50)
    const rules = ((data ?? []) as Row[]).map((r) => ({ ...r, schedule_label: scheduleLabelOf(parseSchedule(r.schedule_json) ?? { frequency: 'daily', hour: 8 }) }))
    return NextResponse.json({ ok: true, operation: op, rules })
  }

  // P70 Wave D — ejecución manual («ejecuta ahora» / botón). Idempotente por MINUTO (doble clic → skipped).
  if (op === 'run_rule_now') {
    const rule = await loadRule(supabase, ws, String(body.rule_id ?? ''))
    if (!rule) return err(404, 'AUTOMATION_RULE_NOT_FOUND', 'Regla no encontrada.')
    if (rule.enabled !== true) return err(409, 'AUTOMATION_DISABLED', 'La regla está pausada; reactívala para ejecutarla.')
    const minute = new Date(); minute.setSeconds(0, 0)
    const res = await executeRuleRun(supabase, rule, minute.toISOString())
    if ('skipped' in res) return NextResponse.json({ ok: true, operation: op, rule_id: rule.id, status: 'skipped_duplicate', message: 'Ya hay una ejecución en este minuto.' })
    await supabase.from('assistant_automation_rules').update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', rule.id)
    return NextResponse.json({ ok: true, operation: op, rule_id: rule.id, run_id: res.runId, status: res.status, new_findings: res.created, duplicates: res.duplicates, summary: res.summary, source_status: res.sourceStatus })
  }

  // P70 Wave D — historial de ejecuciones (paginado razonable; sin UUIDs crudos en el chat, eso lo cuida el caller).
  if (op === 'list_runs') {
    const rule = await loadRule(supabase, ws, String(body.rule_id ?? ''))
    if (!rule) return err(404, 'AUTOMATION_RULE_NOT_FOUND', 'Regla no encontrada.')
    const limit = Math.min(Math.max(Number(body.limit ?? 5), 1), 20)
    const { data } = await supabase.from('assistant_automation_runs')
      .select('id, status, scheduled_for, started_at, finished_at, result_count, safe_error_code')
      .eq('rule_id', rule.id).eq('workspace_id', ws).order('started_at', { ascending: false }).limit(limit)
    return NextResponse.json({ ok: true, operation: op, rule_id: rule.id, name: rule.name, type: rule.type, runs: data ?? [] })
  }

  // Dispatcher del cron (n8n): ejecuta las reglas VENCIDAS. Claim ATÓMICO por ventana (unique
  // rule_id+scheduled_for): dos disparos simultáneos → un solo run, el otro skipped_duplicate.
  if (op === 'run_due') {
    const now = new Date()
    const nowIso = now.toISOString()
    // Recuperación de runs colgados: 'running' con started_at > 15 min → error (libera ventanas futuras).
    await supabase.from('assistant_automation_runs')
      .update({ status: 'error', finished_at: nowIso, safe_error_code: 'AUTOMATION_TIMEOUT' })
      .eq('status', 'running').lt('started_at', new Date(now.getTime() - 15 * 60_000).toISOString())
    const { data: due } = await supabase.from('assistant_automation_rules')
      .select('*').eq('enabled', true).lte('next_run_at', nowIso).limit(10)
    const results: Row[] = []
    for (const rule of (due ?? []) as Row[]) {
      try {
        const schedule = parseSchedule(rule.schedule_json) ?? { frequency: 'daily' as const, hour: 8 }
        const scheduledFor = String(rule.next_run_at)
        // CATCH-UP: se recupera SOLO la ventana reclamada; las intermedias perdidas se auditan en un
        // único run 'skipped' (result_count = nº ventanas omitidas). Anti-tormenta tras downtime.
        let skippedWindows = 0
        let cursor = new Date(computeNextRunMadrid(schedule, new Date(scheduledFor)))
        const skippedTimes: string[] = []
        while (cursor.getTime() <= now.getTime() && skippedWindows < 60) {
          skippedTimes.push(cursor.toISOString())
          skippedWindows++
          cursor = new Date(computeNextRunMadrid(schedule, cursor))
        }
        const res = await executeRuleRun(supabase, rule, scheduledFor)
        if ('skipped' in res) { results.push({ rule_id: rule.id, status: 'skipped_duplicate' }); continue }
        if (skippedWindows > 0) {
          await supabase.from('assistant_automation_runs').insert({
            rule_id: rule.id, workspace_id: rule.workspace_id, scheduled_for: skippedTimes[skippedTimes.length - 1],
            status: 'skipped', finished_at: nowIso, result_count: skippedWindows, safe_error_code: 'AUTOMATION_CATCHUP_SKIPPED',
          })
        }
        await supabase.from('assistant_automation_rules').update({
          last_run_at: nowIso, next_run_at: computeNextRunMadrid(schedule, now), updated_at: nowIso,
        }).eq('id', rule.id)
        results.push({ rule_id: rule.id, status: res.status, new_findings: res.created, skipped_windows: skippedWindows })
      } catch {
        results.push({ rule_id: rule.id, status: 'error' })
      }
    }
    return NextResponse.json({ ok: true, operation: op, executed: results.length, results })
  }

  return err(400, 'invalid_operation', 'operation inválida.')
}
