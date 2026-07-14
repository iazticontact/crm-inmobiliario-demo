// POST /api/agent/automation (P67) — inteligencia proactiva. Server-to-server (x-nowcrm-secret, mismo
// modelo que /api/agent/tool). Operaciones: run_data_quality (detecta + persiste con dedupe por
// fingerprint), list_findings, resolve_finding. NUNCA modifica datos de negocio; solo findings.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import { detectFindings, persistFindings } from '@/lib/agents/findings-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function err(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: code, message }, { status })
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
  let body: Record<string, unknown>
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
  // ── P68 · SCHEDULER real (reglas opt-in + runs con idempotencia por ventana) ──
  if (op === 'create_rule') {
    const type = String(body.type ?? '')
    if (!['data_quality_watch', 'daily_executive_brief', 'overdue_tasks_watch'].includes(type)) return err(422, 'AUTOMATION_INVALID_TYPE', 'Tipo no soportado.')
    if (body.confirmed !== true) return err(403, 'AUTOMATION_CONFIRMATION_REQUIRED', 'La activación requiere confirmación explícita (confirmed=true).')
    const hour = Number((body.schedule as Record<string, unknown> | undefined)?.hour ?? 8)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return err(422, 'AUTOMATION_INVALID_SCHEDULE', 'Hora inválida.')
    const next = nextRunAtMadrid(hour)
    const { data, error } = await supabase.from('assistant_automation_rules').insert({
      workspace_id: ws, type, name: String(body.name ?? type).slice(0, 120), enabled: true,
      schedule_json: { frequency: 'daily', hour }, timezone: 'Europe/Madrid', next_run_at: next,
    }).select('id, next_run_at').single()
    if (error || !data) return err(500, 'AUTOMATION_EXECUTION_ERROR', 'No pude crear la regla.')
    return NextResponse.json({ ok: true, operation: op, rule_id: data.id, enabled: true, next_run_at: data.next_run_at })
  }
  if (op === 'set_rule_enabled') {
    const id = String(body.rule_id ?? '')
    if (!UUID_RE.test(id)) return err(422, 'invalid_input', 'rule_id requerido.')
    const { data } = await supabase.from('assistant_automation_rules')
      .update({ enabled: body.enabled === true, updated_at: new Date().toISOString() })
      .eq('id', id).eq('workspace_id', ws).select('id, enabled')
    if (!data?.length) return err(404, 'AUTOMATION_RULE_NOT_FOUND', 'Regla no encontrada.')
    return NextResponse.json({ ok: true, operation: op, rule_id: id, enabled: data[0].enabled })
  }
  if (op === 'list_rules') {
    const { data } = await supabase.from('assistant_automation_rules')
      .select('id, type, name, enabled, schedule_json, timezone, last_run_at, next_run_at')
      .eq('workspace_id', ws).order('created_at', { ascending: false }).limit(50)
    return NextResponse.json({ ok: true, operation: op, rules: data ?? [] })
  }
  // Dispatcher: ejecuta las reglas VENCIDAS (enabled + next_run_at <= now). Llamado por el cron de n8n.
  // Idempotencia: unique (rule_id, scheduled_for) — una ventana solo se ejecuta una vez.
  if (op === 'run_due') {
    const nowIso = new Date().toISOString()
    const { data: due } = await supabase.from('assistant_automation_rules')
      .select('*').eq('enabled', true).lte('next_run_at', nowIso).limit(10)
    const results: Array<Record<string, unknown>> = []
    for (const rule of (due ?? []) as Array<Record<string, unknown>>) {
      const ruleWs = String(rule.workspace_id)
      const scheduledFor = String(rule.next_run_at)
      const { data: run, error: runErr } = await supabase.from('assistant_automation_runs')
        .insert({ rule_id: rule.id, workspace_id: ruleWs, scheduled_for: scheduledFor }).select('id').single()
      if (runErr) { results.push({ rule_id: rule.id, status: 'skipped_duplicate' }); continue }
      let status = 'success', count = 0
      try {
        const findings = await detectFindings(supabase, ruleWs)
        const { created } = await persistFindings(supabase, ruleWs, findings)
        count = created
      } catch { status = 'error' }
      const hour = Number((rule.schedule_json as Record<string, unknown>)?.hour ?? 8)
      await supabase.from('assistant_automation_runs').update({ status, finished_at: new Date().toISOString(), result_count: count }).eq('id', run.id)
      await supabase.from('assistant_automation_rules').update({ last_run_at: nowIso, next_run_at: nextRunAtMadrid(hour), updated_at: nowIso }).eq('id', rule.id)
      results.push({ rule_id: rule.id, status, new_findings: count })
    }
    return NextResponse.json({ ok: true, operation: op, executed: results.length, results })
  }
  return err(400, 'invalid_operation', 'operation inválida.')
}

// Próxima ejecución a la hora indicada en Europe/Madrid (hoy si aún no pasó; si no, mañana).
function nextRunAtMadrid(hour: number): string {
  const now = new Date()
  const todayMadrid = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now)
  const offsetGuess = new Date(`${todayMadrid}T${String(hour).padStart(2, '0')}:00:00+02:00`)
  const target = offsetGuess.getTime() > now.getTime() ? offsetGuess : new Date(offsetGuess.getTime() + 24 * 3600 * 1000)
  return target.toISOString()
}
