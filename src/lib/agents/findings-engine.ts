// Motor de FINDINGS y RUNNERS de automatización (P67 → P70 Wave D).
//
// P67: reglas objetivas de calidad de datos con criterio explícito y dedupe por fingerprint.
// P70 Wave D: REGISTRY único de automatizaciones (11 tipos) + un runner REAL por tipo con contrato
// cerrado (fuentes reales, partial handling, resultado estructurado). NUNCA modifica datos de negocio:
// detecta y registra. Server-side only. Los fingerprints son COMPARTIDOS entre runners solapados
// (p. ej. data_quality_watch orquesta las mismas reglas que los watchers específicos) → cero duplicados.

import type { SupabaseClient } from '@supabase/supabase-js'
import { todayMadridIso, isOverdueTask } from '@/lib/assistant-temporal'

type Row = Record<string, unknown>
export type Finding = {
  finding_type: string
  entity_type: string | null
  entity_id: string | null
  fingerprint: string
  title: string
  summary: string
  severity: 'info' | 'warning' | 'critical'
}

// ── P70 Wave D · REGISTRY ÚNICO de automatizaciones ──────────────────────────────────────────────────
// La BD (CHECK de assistant_automation_rules.type), el endpoint, el parser, la UI y n8n validan contra
// ESTE registro. data_quality_watch es la auditoría GLOBAL canónica: orquesta las reglas de calidad y
// reutiliza los fingerprints de los watchers específicos (no existe un data_quality_audit separado).

export type AutomationRuleType =
  | 'data_quality_watch' | 'daily_executive_brief' | 'overdue_tasks_watch'
  | 'morning_agenda_brief' | 'upcoming_appointments_watch' | 'case_deadline_watch'
  | 'portfolio_data_quality_watch' | 'won_operation_reconciliation_watch' | 'action_failure_watch'
  | 'stale_operations_watch' | 'inactive_client_followup_watch'

export type AutomationFrequency = 'daily' | 'weekdays' | 'weekly'

export type AutomationRuleDefinition = {
  type: AutomationRuleType
  label: string
  description: string
  criterion: string
  defaultHour: number
  allowedFrequencies: AutomationFrequency[]
  timezone: 'Europe/Madrid'
  sources: string[]            // fuentes REALES que consulta el runner
  createsFindings: boolean
  dedupe: string               // estrategia de fingerprint (documentada, estable)
  config: Record<string, number> // parámetros con default sensato (N días, ventanas…)
  chatExamples: string[]
}

export const AUTOMATION_RULES: Record<AutomationRuleType, AutomationRuleDefinition> = {
  data_quality_watch: {
    type: 'data_quality_watch', label: 'auditoría de calidad de datos',
    description: 'Auditoría global de coherencia de datos del CRM',
    criterion: 'Orquesta todas las reglas objetivas de calidad (cartera, operaciones, tareas); mismos fingerprints que los watchers específicos.',
    defaultHour: 8, allowedFrequencies: ['daily', 'weekdays', 'weekly'], timezone: 'Europe/Madrid',
    sources: ['properties', 'opportunities', 'tasks', 'clients'], createsFindings: true,
    dedupe: 'fingerprint por regla+entidad (spwwo/wowsp/ownp/owc/pmp/porph/tov)', config: {},
    chatExamples: ['activa una auditoría de calidad diaria a las 8'],
  },
  daily_executive_brief: {
    type: 'daily_executive_brief', label: 'resumen ejecutivo diario',
    description: 'Resumen ejecutivo diario multi-fuente',
    criterion: 'Un resumen informativo por día (conteos y prioridades de cartera, operaciones, agenda, tareas y trámites); no crea incidencias por cifra.',
    defaultHour: 8, allowedFrequencies: ['daily', 'weekdays'], timezone: 'Europe/Madrid',
    sources: ['properties', 'opportunities', 'calendar_events', 'tasks', 'service_cases', 'assistant_findings'],
    createsFindings: true, dedupe: 'brief:<fecha Madrid> (uno por día)', config: {},
    chatExamples: ['activa un resumen diario a las 8'],
  },
  morning_agenda_brief: {
    type: 'morning_agenda_brief', label: 'agenda de la mañana',
    description: 'Brief matinal de agenda: citas y tareas de hoy',
    criterion: 'Citas de HOY (no pasadas de otros días), tareas que vencen hoy y vencidas; verdad temporal Europe/Madrid.',
    defaultHour: 7, allowedFrequencies: ['daily', 'weekdays'], timezone: 'Europe/Madrid',
    sources: ['calendar_events', 'tasks', 'service_cases'], createsFindings: true,
    dedupe: 'agenda:<fecha Madrid> (uno por día)', config: {},
    chatExamples: ['activa la agenda de la mañana a las 7'],
  },
  overdue_tasks_watch: {
    type: 'overdue_tasks_watch', label: 'aviso de tareas vencidas',
    description: 'Vigila tareas pendientes con fecha vencida',
    criterion: 'status=pending + due_date < hoy (Europe/Madrid).',
    defaultHour: 8, allowedFrequencies: ['daily', 'weekdays'], timezone: 'Europe/Madrid',
    sources: ['tasks'], createsFindings: true, dedupe: 'tov:<taskId>:<due_date>', config: {},
    chatExamples: ['activa un aviso de tareas vencidas a las 8'],
  },
  upcoming_appointments_watch: {
    type: 'upcoming_appointments_watch', label: 'aviso de citas próximas',
    description: 'Avisa de citas en las próximas 24 horas',
    criterion: 'start_at en [ahora, ahora+24h], no cancelada. Una cita pasada NUNCA es próxima.',
    defaultHour: 7, allowedFrequencies: ['daily', 'weekdays'], timezone: 'Europe/Madrid',
    sources: ['calendar_events'], createsFindings: true, dedupe: 'appt:<eventId>:<fecha del evento>',
    config: { windowHours: 24 },
    chatExamples: ['activa un aviso de citas próximas a las 7'],
  },
  case_deadline_watch: {
    type: 'case_deadline_watch', label: 'vencimientos de trámites',
    description: 'Vigila trámites vencidos o a punto de vencer',
    criterion: 'Trámite no resuelto/cerrado con due_date vencida (aviso) o que vence en ≤3 días (info).',
    defaultHour: 8, allowedFrequencies: ['daily', 'weekdays'], timezone: 'Europe/Madrid',
    sources: ['service_cases'], createsFindings: true, dedupe: 'casedl:<caseId>:<due_date>',
    config: { soonDays: 3 },
    chatExamples: ['activa los vencimientos de trámites a las 8'],
  },
  portfolio_data_quality_watch: {
    type: 'portfolio_data_quality_watch', label: 'calidad de datos de cartera',
    description: 'Vigila coherencia de la cartera de inmuebles',
    criterion: 'Publicado sin precio (crítico); vendido sin operación ganada; propietario/cliente vinculado eliminado.',
    defaultHour: 8, allowedFrequencies: ['daily', 'weekdays', 'weekly'], timezone: 'Europe/Madrid',
    sources: ['properties', 'opportunities', 'clients'], createsFindings: true,
    dedupe: 'pmp/spwwo/porph:<propertyId> (compartidos con la auditoría global)', config: {},
    chatExamples: ['activa la calidad de datos de cartera'],
  },
  won_operation_reconciliation_watch: {
    type: 'won_operation_reconciliation_watch', label: 'reconciliación de operaciones ganadas',
    description: 'Reconcilia operaciones ganadas con el estado de sus inmuebles',
    criterion: 'Ganada con inmueble no cerrado; ganada sin inmueble vinculado; vendido sin operación ganada compatible. Detecta, NUNCA corrige.',
    defaultHour: 8, allowedFrequencies: ['daily', 'weekdays', 'weekly'], timezone: 'Europe/Madrid',
    sources: ['opportunities', 'properties'], createsFindings: true,
    dedupe: 'wowsp/ownp/spwwo:<id> (compartidos con la auditoría global)', config: {},
    chatExamples: ['activa la reconciliación de operaciones ganadas'],
  },
  action_failure_watch: {
    type: 'action_failure_watch', label: 'vigilancia de acciones fallidas',
    description: 'Vigila acciones del Asistente fallidas, en conflicto o atascadas',
    criterion: 'assistant_actions failed/conflict en 24h o executing atascada >15 min; los fixtures QA se filtran.',
    defaultHour: 9, allowedFrequencies: ['daily', 'weekdays'], timezone: 'Europe/Madrid',
    sources: ['assistant_actions'], createsFindings: true,
    dedupe: 'actfail/actstuck:<actionId>', config: { lookbackHours: 24, stuckMinutes: 15 },
    chatExamples: ['activa la vigilancia de acciones fallidas'],
  },
  stale_operations_watch: {
    type: 'stale_operations_watch', label: 'operaciones sin movimiento',
    description: 'Detecta operaciones abiertas paradas',
    criterion: 'Operación abierta sin actualización en ≥30 días, sin tarea pendiente futura ni cita futura vinculadas. Sugerencia, no incumplimiento.',
    defaultHour: 9, allowedFrequencies: ['daily', 'weekdays', 'weekly'], timezone: 'Europe/Madrid',
    sources: ['opportunities', 'tasks', 'calendar_events'], createsFindings: true,
    dedupe: 'staleop:<opportunityId>', config: { staleDays: 30 },
    chatExamples: ['activa el aviso de operaciones sin movimiento'],
  },
  inactive_client_followup_watch: {
    type: 'inactive_client_followup_watch', label: 'seguimiento de clientes inactivos',
    description: 'Sugiere seguimiento de clientes con operación abierta e inactividad',
    criterion: 'Cliente activo/lead con operación abierta, sin actualización en ≥60 días, sin tarea pendiente ni cita futura. Sugerencia, no incumplimiento.',
    defaultHour: 9, allowedFrequencies: ['daily', 'weekdays', 'weekly'], timezone: 'Europe/Madrid',
    sources: ['clients', 'opportunities', 'tasks', 'calendar_events'], createsFindings: true,
    dedupe: 'inactcli:<clientId>', config: { inactiveDays: 60 },
    chatExamples: ['activa el seguimiento de clientes inactivos'],
  },
}

export function getAutomationRuleDefinition(type: string): AutomationRuleDefinition | null {
  return (AUTOMATION_RULES as Record<string, AutomationRuleDefinition>)[type] ?? null
}
export const AUTOMATION_RULE_TYPE_LIST = Object.keys(AUTOMATION_RULES) as AutomationRuleType[]

// ── Contrato cerrado del runner ───────────────────────────────────────────────────────────────────────
export type SourceStatus = 'success' | 'empty' | 'partial' | 'failed'
export type AutomationRunOutcome = {
  status: 'completed' | 'partial' | 'failed'
  summary: string
  findings: Finding[]
  sourceStatus: Record<string, SourceStatus>
}

// Fixtures QA: jamás se convierten en incidencias de negocio.
const QA_NEEDLE = /(catalogqa|uiqa|autoqa|qa p66|qa p70)/i
const isQaText = (v: unknown) => QA_NEEDLE.test(String(v ?? ''))

// ── Reglas de calidad COMPARTIDAS (fingerprints estables; reutilizadas entre runners) ─────────────────
function ruleSoldWithoutWon(props: Row[], ops: Row[]): Finding[] {
  const wonPropIds = new Set(ops.filter((o) => o.stage === 'won' && o.property_id).map((o) => String(o.property_id)))
  return props.filter((p) => p.status === 'sold' && !wonPropIds.has(String(p.id)) && !isQaText(p.title)).map((p) => ({
    finding_type: 'sold_property_without_won_operation', entity_type: 'property', entity_id: String(p.id),
    fingerprint: `spwwo:${p.id}`, title: `Inmueble vendido sin operación ganada: ${p.title}`,
    summary: 'El inmueble está en estado Vendido pero ninguna operación ganada lo tiene vinculado. Criterio: status=sold sin opportunity stage=won con property_id.',
    severity: 'warning' as const,
  }))
}
function ruleWonWithoutClosedProperty(props: Row[], ops: Row[]): Finding[] {
  const propById = new Map(props.map((p) => [String(p.id), p]))
  const out: Finding[] = []
  for (const o of ops.filter((o) => o.stage === 'won' && !isQaText(o.title))) {
    const p = o.property_id ? propById.get(String(o.property_id)) : null
    if (o.property_id && p && p.status !== 'sold' && p.status !== 'rented') {
      out.push({ finding_type: 'won_operation_without_sold_property', entity_type: 'opportunity', entity_id: String(o.id), fingerprint: `wowsp:${o.id}`, title: `Operación ganada con inmueble no cerrado: ${o.title}`, summary: `La operación está ganada pero su inmueble (${p.title}) está en estado ${p.status}. Criterio: stage=won con property.status ∉ {sold, rented}.`, severity: 'warning' })
    }
    if (!o.property_id) {
      out.push({ finding_type: 'won_operation_without_property', entity_type: 'opportunity', entity_id: String(o.id), fingerprint: `ownp:${o.id}`, title: `Operación ganada sin inmueble vinculado: ${o.title}`, summary: 'La operación está ganada pero no tiene inmueble vinculado. Criterio: stage=won con property_id nulo.', severity: 'info' })
    }
  }
  return out
}
function ruleOperationWithoutClient(ops: Row[]): Finding[] {
  return ops.filter((o) => o.stage === 'won' && !o.client_id && !isQaText(o.title)).map((o) => ({
    finding_type: 'operation_without_client', entity_type: 'opportunity', entity_id: String(o.id),
    fingerprint: `owc:${o.id}`, title: `Operación sin cliente: ${o.title}`,
    summary: 'La operación no tiene cliente vinculado. Criterio: client_id nulo.', severity: 'info' as const,
  }))
}
function rulePublishedNoPrice(props: Row[]): Finding[] {
  return props.filter((p) => (p.status === 'listed' || p.status === 'available') && !(Number(p.price) > 0) && !isQaText(p.title)).map((p) => ({
    finding_type: 'property_missing_price', entity_type: 'property', entity_id: String(p.id),
    fingerprint: `pmp:${p.id}`, title: `Publicado sin precio: ${p.title}`,
    summary: 'El inmueble está publicado pero no tiene precio. Criterio: status publicado con price nulo o 0.', severity: 'critical' as const,
  }))
}
function ruleOrphanPropertyClient(props: Row[], liveClientIds: Set<string>): Finding[] {
  return props.filter((p) => p.client_id && !liveClientIds.has(String(p.client_id)) && !isQaText(p.title)).map((p) => ({
    finding_type: 'property_orphan_client', entity_type: 'property', entity_id: String(p.id),
    fingerprint: `porph:${p.id}`, title: `Inmueble con cliente eliminado: ${p.title}`,
    summary: 'El inmueble apunta a un cliente que ya no existe (eliminado). Criterio: client_id sin fila viva en clients.', severity: 'warning' as const,
  }))
}
function ruleOverdueTasks(tasks: Row[], today: string): Finding[] {
  return tasks.filter((t) => isOverdueTask(t.due_date as string | null, t.status as string | null, today) && !isQaText(t.title)).map((t) => ({
    finding_type: 'task_overdue', entity_type: 'task', entity_id: String(t.id),
    fingerprint: `tov:${t.id}:${t.due_date}`, title: `Tarea vencida: ${t.title}`,
    summary: `Pendiente con fecha límite ${t.due_date} anterior a hoy. Criterio: status=pending + due_date < hoy (Europe/Madrid).`, severity: 'warning' as const,
  }))
}

// ── Lectores con partial handling (una fuente caída no tumba el run) ──────────────────────────────────
type SourceRead = { rows: Row[]; status: SourceStatus }
async function readSource(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<SourceRead> {
  try {
    const { data, error } = await q
    if (error) return { rows: [], status: 'failed' }
    const rows = (data ?? []) as Row[]
    return { rows, status: rows.length ? 'success' : 'empty' }
  } catch { return { rows: [], status: 'failed' } }
}
function outcomeStatus(sourceStatus: Record<string, SourceStatus>): 'completed' | 'partial' | 'failed' {
  const st = Object.values(sourceStatus)
  if (st.length && st.every((s) => s === 'failed')) return 'failed'
  if (st.some((s) => s === 'failed')) return 'partial'
  return 'completed'
}

// ── RUNNERS reales ────────────────────────────────────────────────────────────────────────────────────
async function runDataQuality(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const today = todayMadridIso()
  const [propsR, opsR, tasksR, clientsR] = await Promise.all([
    readSource(supabase.from('properties').select('id, title, status, price, client_id').eq('workspace_id', ws).is('deleted_at', null)),
    readSource(supabase.from('opportunities').select('id, title, stage, client_id, property_id').eq('workspace_id', ws).is('deleted_at', null)),
    readSource(supabase.from('tasks').select('id, title, status, due_date').eq('workspace_id', ws)),
    readSource(supabase.from('clients').select('id').eq('workspace_id', ws).is('deleted_at', null)),
  ])
  const sourceStatus = { properties: propsR.status, opportunities: opsR.status, tasks: tasksR.status, clients: clientsR.status }
  const liveClients = new Set(clientsR.rows.map((c) => String(c.id)))
  const findings = [
    ...ruleSoldWithoutWon(propsR.rows, opsR.rows),
    ...ruleWonWithoutClosedProperty(propsR.rows, opsR.rows),
    ...ruleOperationWithoutClient(opsR.rows),
    ...rulePublishedNoPrice(propsR.rows),
    ...(clientsR.status !== 'failed' ? ruleOrphanPropertyClient(propsR.rows, liveClients) : []),
    ...ruleOverdueTasks(tasksR.rows, today),
  ]
  return { status: outcomeStatus(sourceStatus), summary: `Auditoría global: ${findings.length} incidencia(s) detectada(s).`, findings, sourceStatus }
}

async function runDailyExecutiveBrief(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const today = todayMadridIso()
  const nowIso = new Date().toISOString()
  const [propsR, opsR, calR, tasksR, casesR, findR] = await Promise.all([
    readSource(supabase.from('properties').select('id, status').eq('workspace_id', ws).is('deleted_at', null)),
    readSource(supabase.from('opportunities').select('id, stage').eq('workspace_id', ws).is('deleted_at', null)),
    readSource(supabase.from('calendar_events').select('id').eq('workspace_id', ws).neq('status', 'cancelled').gte('start_at', nowIso).lte('start_at', new Date(Date.now() + 7 * 24 * 3600e3).toISOString())),
    readSource(supabase.from('tasks').select('id, status, due_date').eq('workspace_id', ws).eq('status', 'pending')),
    readSource(supabase.from('service_cases').select('id, status').eq('workspace_id', ws).is('deleted_at', null)),
    readSource(supabase.from('assistant_findings').select('id, severity').eq('workspace_id', ws).eq('status', 'open')),
  ])
  const sourceStatus = { properties: propsR.status, opportunities: opsR.status, calendar_events: calR.status, tasks: tasksR.status, service_cases: casesR.status, assistant_findings: findR.status }
  const won = opsR.rows.filter((o) => o.stage === 'won').length
  const lost = opsR.rows.filter((o) => o.stage === 'lost').length
  const openOps = opsR.rows.length - won - lost
  const overdue = tasksR.rows.filter((t) => isOverdueTask(t.due_date as string | null, 'pending', today)).length
  const openCases = casesR.rows.filter((c) => !['resolved', 'closed'].includes(String(c.status))).length
  const critical = findR.rows.filter((f) => f.severity === 'critical').length
  const parts = [
    `Cartera: ${propsR.status === 'failed' ? 'no disponible' : `${propsR.rows.length} inmuebles`}`,
    `Operaciones: ${opsR.status === 'failed' ? 'no disponibles' : `${openOps} abiertas, ${won} ganadas, ${lost} perdidas`}`,
    `Citas próximas (7 días): ${calR.status === 'failed' ? 'no disponibles' : calR.rows.length}`,
    `Tareas pendientes: ${tasksR.status === 'failed' ? 'no disponibles' : `${tasksR.rows.length}${overdue ? ` (${overdue} vencidas)` : ''}`}`,
    `Trámites abiertos: ${casesR.status === 'failed' ? 'no disponibles' : openCases}`,
    `Incidencias abiertas: ${findR.status === 'failed' ? 'no disponibles' : `${findR.rows.length}${critical ? ` (${critical} críticas)` : ''}`}`,
  ]
  const prios: string[] = []
  if (overdue) prios.push(`revisar ${overdue} tarea(s) vencida(s)`)
  if (critical) prios.push(`atender ${critical} incidencia(s) crítica(s)`)
  const summary = `${parts.join(' · ')}${prios.length ? ` · Prioridades: ${prios.join(' y ')}.` : ''}`
  const findings: Finding[] = [{
    finding_type: 'daily_executive_brief', entity_type: null, entity_id: null,
    fingerprint: `brief:${today}`, title: `Resumen ejecutivo ${today}`,
    summary: `${summary} Criterio: resumen programado diario (informativo, un único registro por día).`, severity: 'info',
  }]
  return { status: outcomeStatus(sourceStatus), summary, findings, sourceStatus }
}

async function runMorningAgendaBrief(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const today = todayMadridIso()
  const [calR, tasksR, casesR] = await Promise.all([
    readSource(supabase.from('calendar_events').select('id, title, date, start_at, status').eq('workspace_id', ws).neq('status', 'cancelled').eq('date', today)),
    readSource(supabase.from('tasks').select('id, title, status, due_date').eq('workspace_id', ws).eq('status', 'pending')),
    readSource(supabase.from('service_cases').select('id, title, status, due_date').eq('workspace_id', ws).is('deleted_at', null)),
  ])
  const sourceStatus = { calendar_events: calR.status, tasks: tasksR.status, service_cases: casesR.status }
  // Verdad temporal: solo eventos de HOY todavía no pasados (start_at >= ahora) + los de hoy sin hora.
  const nowMs = Date.now()
  const todaysEvents = calR.rows.filter((e) => !e.start_at || new Date(String(e.start_at)).getTime() >= nowMs - 15 * 60_000)
  const dueToday = tasksR.rows.filter((t) => String(t.due_date ?? '') === today)
  const overdue = tasksR.rows.filter((t) => isOverdueTask(t.due_date as string | null, 'pending', today))
  const soonLimit = new Date(new Date(`${today}T00:00:00Z`).getTime() + 3 * 24 * 3600e3).toISOString().slice(0, 10)
  const casesSoon = casesR.rows.filter((c) => !['resolved', 'closed'].includes(String(c.status)) && c.due_date && String(c.due_date) <= soonLimit)
  const summary = `Hoy: ${todaysEvents.length} cita(s) · ${dueToday.length} tarea(s) que vencen hoy · ${overdue.length} vencida(s) · ${casesSoon.length} trámite(s) próximos a vencer.`
  const findings: Finding[] = [{
    finding_type: 'morning_agenda_brief', entity_type: null, entity_id: null,
    fingerprint: `agenda:${today}`, title: `Agenda de la mañana ${today}`,
    summary: `${summary} Criterio: brief matinal (citas de hoy no pasadas + tareas de hoy/vencidas + trámites ≤3 días), Europe/Madrid.`, severity: 'info',
  }]
  return { status: outcomeStatus(sourceStatus), summary, findings, sourceStatus }
}

async function runOverdueTasksWatch(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const today = todayMadridIso()
  const tasksR = await readSource(supabase.from('tasks').select('id, title, status, due_date').eq('workspace_id', ws).eq('status', 'pending'))
  const findings = ruleOverdueTasks(tasksR.rows, today)
  return { status: outcomeStatus({ tasks: tasksR.status }), summary: `${findings.length} tarea(s) vencida(s).`, findings, sourceStatus: { tasks: tasksR.status } }
}

async function runUpcomingAppointmentsWatch(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const windowHours = AUTOMATION_RULES.upcoming_appointments_watch.config.windowHours ?? 24
  const nowIso = new Date().toISOString()
  const untilIso = new Date(Date.now() + windowHours * 3600e3).toISOString()
  const calR = await readSource(supabase.from('calendar_events').select('id, title, client_name, date, start_at, status').eq('workspace_id', ws).neq('status', 'cancelled').gte('start_at', nowIso).lte('start_at', untilIso))
  const findings: Finding[] = calR.rows.filter((e) => !isQaText(e.client_name) && !isQaText(e.title)).map((e) => {
    const when = new Date(String(e.start_at)).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    return {
      finding_type: 'upcoming_appointment', entity_type: 'calendar_event', entity_id: String(e.id),
      fingerprint: `appt:${e.id}:${String(e.date ?? String(e.start_at).slice(0, 10))}`,
      title: `Cita próxima: ${e.title}`,
      summary: `Programada para el ${when}${e.client_name ? ` con ${e.client_name}` : ''}. Criterio: start_at en las próximas ${windowHours}h, no cancelada.`,
      severity: 'info' as const,
    }
  })
  return { status: outcomeStatus({ calendar_events: calR.status }), summary: `${findings.length} cita(s) en las próximas ${windowHours}h.`, findings, sourceStatus: { calendar_events: calR.status } }
}

async function runCaseDeadlineWatch(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const soonDays = AUTOMATION_RULES.case_deadline_watch.config.soonDays ?? 3
  const today = todayMadridIso()
  const casesR = await readSource(supabase.from('service_cases').select('id, title, status, due_date').eq('workspace_id', ws).is('deleted_at', null).not('due_date', 'is', null))
  const soonLimit = new Date(new Date(`${today}T00:00:00Z`).getTime() + soonDays * 24 * 3600e3).toISOString().slice(0, 10)
  const findings: Finding[] = []
  for (const c of casesR.rows) {
    if (['resolved', 'closed'].includes(String(c.status)) || isQaText(c.title)) continue
    const due = String(c.due_date)
    if (due < today) {
      findings.push({ finding_type: 'case_deadline_overdue', entity_type: 'service_case', entity_id: String(c.id), fingerprint: `casedl:${c.id}:${due}`, title: `Trámite vencido: ${c.title}`, summary: `Fecha límite ${due} anterior a hoy y sigue abierto. Criterio: due_date < hoy con status ∉ {resolved, closed}.`, severity: 'warning' })
    } else if (due <= soonLimit) {
      findings.push({ finding_type: 'case_deadline_soon', entity_type: 'service_case', entity_id: String(c.id), fingerprint: `casedl:${c.id}:${due}`, title: `Trámite a punto de vencer: ${c.title}`, summary: `Vence el ${due} (≤${soonDays} días). Criterio: due_date en los próximos ${soonDays} días con status ∉ {resolved, closed}.`, severity: 'info' })
    }
  }
  return { status: outcomeStatus({ service_cases: casesR.status }), summary: `${findings.length} trámite(s) vencidos o próximos a vencer.`, findings, sourceStatus: { service_cases: casesR.status } }
}

async function runPortfolioDataQualityWatch(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const [propsR, opsR, clientsR] = await Promise.all([
    readSource(supabase.from('properties').select('id, title, status, price, client_id').eq('workspace_id', ws).is('deleted_at', null)),
    readSource(supabase.from('opportunities').select('id, stage, property_id').eq('workspace_id', ws).is('deleted_at', null)),
    readSource(supabase.from('clients').select('id').eq('workspace_id', ws).is('deleted_at', null)),
  ])
  const sourceStatus = { properties: propsR.status, opportunities: opsR.status, clients: clientsR.status }
  const liveClients = new Set(clientsR.rows.map((c) => String(c.id)))
  const findings = [
    ...rulePublishedNoPrice(propsR.rows),
    ...ruleSoldWithoutWon(propsR.rows, opsR.rows),
    ...(clientsR.status !== 'failed' ? ruleOrphanPropertyClient(propsR.rows, liveClients) : []),
  ]
  return { status: outcomeStatus(sourceStatus), summary: `${findings.length} incidencia(s) de cartera.`, findings, sourceStatus }
}

async function runWonOperationReconciliationWatch(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const [propsR, opsR] = await Promise.all([
    readSource(supabase.from('properties').select('id, title, status').eq('workspace_id', ws).is('deleted_at', null)),
    readSource(supabase.from('opportunities').select('id, title, stage, client_id, property_id').eq('workspace_id', ws).is('deleted_at', null)),
  ])
  const sourceStatus = { properties: propsR.status, opportunities: opsR.status }
  const findings = [
    ...ruleWonWithoutClosedProperty(propsR.rows, opsR.rows),
    ...ruleSoldWithoutWon(propsR.rows, opsR.rows),
    ...ruleOperationWithoutClient(opsR.rows),
  ]
  return { status: outcomeStatus(sourceStatus), summary: `${findings.length} descuadre(s) entre operaciones ganadas e inmuebles.`, findings, sourceStatus }
}

async function runActionFailureWatch(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const cfg = AUTOMATION_RULES.action_failure_watch.config
  const sinceIso = new Date(Date.now() - (cfg.lookbackHours ?? 24) * 3600e3).toISOString()
  const stuckIso = new Date(Date.now() - (cfg.stuckMinutes ?? 15) * 60_000).toISOString()
  const actsR = await readSource(supabase.from('assistant_actions')
    .select('id, action_type, status, safe_error_code, created_at, confirmed_at, proposed_changes_json, current_state_json')
    .eq('workspace_id', ws).gte('created_at', sinceIso).in('status', ['failed', 'conflict', 'executing']))
  const findings: Finding[] = []
  for (const a of actsR.rows) {
    // Los fixtures QA no son incidencias de negocio.
    if (isQaText(JSON.stringify(a.proposed_changes_json ?? {})) || isQaText(JSON.stringify(a.current_state_json ?? {}))) continue
    const shortType = String(a.action_type)
    if (a.status === 'failed') {
      findings.push({ finding_type: 'assistant_action_failed', entity_type: 'assistant_action', entity_id: String(a.id), fingerprint: `actfail:${a.id}`, title: `Acción del Asistente fallida: ${shortType}`, summary: `La acción terminó en fallo (${String(a.safe_error_code ?? 'error')}). Criterio: assistant_actions.status=failed en las últimas ${cfg.lookbackHours ?? 24}h.`, severity: 'warning' })
    } else if (a.status === 'conflict') {
      findings.push({ finding_type: 'assistant_action_conflict', entity_type: 'assistant_action', entity_id: String(a.id), fingerprint: `actfail:${a.id}`, title: `Acción del Asistente en conflicto: ${shortType}`, summary: 'El registro cambió después del preview y el cambio no se aplicó. Criterio: status=conflict (lock optimista).', severity: 'info' })
    } else if (a.status === 'executing' && a.confirmed_at && String(a.confirmed_at) < stuckIso) {
      findings.push({ finding_type: 'assistant_action_stuck', entity_type: 'assistant_action', entity_id: String(a.id), fingerprint: `actstuck:${a.id}`, title: `Acción del Asistente atascada: ${shortType}`, summary: `Lleva en ejecución más de ${cfg.stuckMinutes ?? 15} minutos sin terminar. Criterio: status=executing con confirmed_at antiguo.`, severity: 'warning' })
    }
  }
  return { status: outcomeStatus({ assistant_actions: actsR.status }), summary: `${findings.length} acción(es) con problemas en las últimas ${cfg.lookbackHours ?? 24}h.`, findings, sourceStatus: { assistant_actions: actsR.status } }
}

async function runStaleOperationsWatch(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const staleDays = AUTOMATION_RULES.stale_operations_watch.config.staleDays ?? 30
  const cutIso = new Date(Date.now() - staleDays * 24 * 3600e3).toISOString()
  const nowIso = new Date().toISOString()
  const today = todayMadridIso()
  const [opsR, tasksR, calR] = await Promise.all([
    readSource(supabase.from('opportunities').select('id, title, stage, updated_at').eq('workspace_id', ws).is('deleted_at', null).not('stage', 'in', '("won","lost")').lt('updated_at', cutIso)),
    readSource(supabase.from('tasks').select('id, opportunity_id, status, due_date').eq('workspace_id', ws).eq('status', 'pending').not('opportunity_id', 'is', null)),
    readSource(supabase.from('calendar_events').select('id, opportunity_id, start_at').eq('workspace_id', ws).neq('status', 'cancelled').gte('start_at', nowIso).not('opportunity_id', 'is', null)),
  ])
  const sourceStatus = { opportunities: opsR.status, tasks: tasksR.status, calendar_events: calR.status }
  const opsWithFutureTask = new Set(tasksR.rows.filter((t) => !t.due_date || String(t.due_date) >= today).map((t) => String(t.opportunity_id)))
  const opsWithFutureEvent = new Set(calR.rows.map((e) => String(e.opportunity_id)))
  const findings: Finding[] = opsR.rows
    .filter((o) => !opsWithFutureTask.has(String(o.id)) && !opsWithFutureEvent.has(String(o.id)) && !isQaText(o.title))
    .map((o) => ({
      finding_type: 'stale_operation', entity_type: 'opportunity', entity_id: String(o.id),
      fingerprint: `staleop:${o.id}`, title: `Operación sin movimiento: ${o.title}`,
      summary: `Abierta y sin actualización en ≥${staleDays} días, sin tarea pendiente futura ni cita futura vinculadas. Criterio: sugerencia de seguimiento, no incumplimiento.`, severity: 'info' as const,
    }))
  return { status: outcomeStatus(sourceStatus), summary: `${findings.length} operación(es) sin movimiento (≥${staleDays} días).`, findings, sourceStatus }
}

async function runInactiveClientFollowupWatch(supabase: SupabaseClient, ws: string): Promise<AutomationRunOutcome> {
  const inactiveDays = AUTOMATION_RULES.inactive_client_followup_watch.config.inactiveDays ?? 60
  const cutIso = new Date(Date.now() - inactiveDays * 24 * 3600e3).toISOString()
  const nowIso = new Date().toISOString()
  const today = todayMadridIso()
  const [clientsR, opsR, tasksR, calR] = await Promise.all([
    readSource(supabase.from('clients').select('id, name, status, updated_at').eq('workspace_id', ws).is('deleted_at', null).in('status', ['active', 'lead']).lt('updated_at', cutIso)),
    readSource(supabase.from('opportunities').select('id, client_id, stage').eq('workspace_id', ws).is('deleted_at', null).not('stage', 'in', '("won","lost")').not('client_id', 'is', null)),
    readSource(supabase.from('tasks').select('id, client_id, status, due_date').eq('workspace_id', ws).eq('status', 'pending').not('client_id', 'is', null)),
    readSource(supabase.from('calendar_events').select('id, client_id, start_at').eq('workspace_id', ws).neq('status', 'cancelled').gte('start_at', nowIso).not('client_id', 'is', null)),
  ])
  const sourceStatus = { clients: clientsR.status, opportunities: opsR.status, tasks: tasksR.status, calendar_events: calR.status }
  const withOpenOp = new Set(opsR.rows.map((o) => String(o.client_id)))
  const withPendingTask = new Set(tasksR.rows.filter((t) => !t.due_date || String(t.due_date) >= today).map((t) => String(t.client_id)))
  const withFutureEvent = new Set(calR.rows.map((e) => String(e.client_id)))
  const findings: Finding[] = clientsR.rows
    .filter((c) => withOpenOp.has(String(c.id)) && !withPendingTask.has(String(c.id)) && !withFutureEvent.has(String(c.id)) && !isQaText(c.name))
    .map((c) => ({
      finding_type: 'inactive_client_followup', entity_type: 'client', entity_id: String(c.id),
      fingerprint: `inactcli:${c.id}`, title: `Sugerencia de seguimiento: ${c.name}`,
      summary: `Cliente con operación abierta y sin actividad en ≥${inactiveDays} días (sin tarea pendiente ni cita futura). Criterio: sugerencia, no incumplimiento.`, severity: 'info' as const,
    }))
  return { status: outcomeStatus(sourceStatus), summary: `${findings.length} cliente(s) con seguimiento sugerido.`, findings, sourceStatus }
}

// ── Dispatcher por tipo (contrato único; el endpoint persiste run + findings) ─────────────────────────
export async function runAutomationRule(supabase: SupabaseClient, ws: string, type: string): Promise<AutomationRunOutcome> {
  switch (type as AutomationRuleType) {
    case 'data_quality_watch': return runDataQuality(supabase, ws)
    case 'daily_executive_brief': return runDailyExecutiveBrief(supabase, ws)
    case 'morning_agenda_brief': return runMorningAgendaBrief(supabase, ws)
    case 'overdue_tasks_watch': return runOverdueTasksWatch(supabase, ws)
    case 'upcoming_appointments_watch': return runUpcomingAppointmentsWatch(supabase, ws)
    case 'case_deadline_watch': return runCaseDeadlineWatch(supabase, ws)
    case 'portfolio_data_quality_watch': return runPortfolioDataQualityWatch(supabase, ws)
    case 'won_operation_reconciliation_watch': return runWonOperationReconciliationWatch(supabase, ws)
    case 'action_failure_watch': return runActionFailureWatch(supabase, ws)
    case 'stale_operations_watch': return runStaleOperationsWatch(supabase, ws)
    case 'inactive_client_followup_watch': return runInactiveClientFollowupWatch(supabase, ws)
    default: return { status: 'failed', summary: 'Tipo de automatización no registrado.', findings: [], sourceStatus: {} }
  }
}

// ── Compat P67 (auditoría directa desde el chat) ──────────────────────────────────────────────────────
export async function detectFindings(supabase: SupabaseClient, ws: string): Promise<Finding[]> {
  const out = await runDataQuality(supabase, ws)
  return out.findings
}

// Persiste con DEDUPE por fingerprint (unique workspace_id+fingerprint). Devuelve nuevos vs existentes.
// LIFECYCLE: resolved/dismissed NO reaparecen por el mismo fingerprint (el insert choca y se ignora);
// una condición nueva (p. ej. otra fecha límite) produce OTRO fingerprint y por tanto nueva incidencia.
export async function persistFindings(supabase: SupabaseClient, ws: string, findings: Finding[]): Promise<{ created: number; duplicates: number; createdIds: string[] }> {
  let created = 0, duplicates = 0
  const createdIds: string[] = []
  for (const f of findings) {
    const { data, error } = await supabase.from('assistant_findings').insert({ workspace_id: ws, ...f }).select('id').single()
    if (!error && data) { created++; createdIds.push(String(data.id)) }
    else if (String((error as { code?: string } | null)?.code) === '23505') duplicates++
  }
  return { created, duplicates, createdIds }
}
