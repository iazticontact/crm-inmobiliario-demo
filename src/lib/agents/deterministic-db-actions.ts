// RT5.1b-2 — Resolución determinista CON acceso a Supabase para acciones de
// edición que necesitan el ID real de la entidad (mover etapa de operación,
// actualizar estado/prioridad de tarea o expediente).
//
// Vive aparte del fallback de solo-texto (deterministic-fallback.ts) porque
// aquí SÍ consultamos Supabase (cliente cookie-bound del route v2, RLS). Nunca
// inventa: si no encuentra cliente/entidad lo dice; si hay varias, lista
// opciones reales y NO prepara acción. Se invoca desde /api/assistant/v2 solo
// cuando ni el agente OpenAI ni el fallback de texto produjeron una acción.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PreparedActionDraft } from '@/lib/agents/nowlabs-main-agent'

export type DbActionOutcome = { answer: string; preparedAction?: PreparedActionDraft }

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const NAME_STOP = /^(la|las|el|los|un|una|esta|este|esa|ese|negociacion|oferta|alta|baja|normal|urgente|completada|completado|pendiente|resuelto|resuelta|cerrado|cerrada)$/

// Extracción conservadora del nombre de cliente (empieza en mayúscula). Igual
// criterio que el fallback de texto: preferimos no encontrar a inventar.
function extractClientName(message: string): string | undefined {
  const m = message.match(/\b(?:al\s+cliente|del?\s+cliente|cliente|de|del|para)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ'-]+){0,2})\b/)
  if (!m) return undefined
  const candidate = m[1].trim()
  if (NAME_STOP.test(normalize(candidate).split(/\s+/)[0])) return undefined
  return candidate
}

const STAGE_LABEL: Record<string, string> = {
  new: 'Nuevo', contacted: 'Contactado', qualified: 'Cualificado',
  visit_scheduled: 'Visita programada', offer: 'Oferta', negotiation: 'Negociación',
  won: 'Ganada', lost: 'Perdida',
}

function detectStage(t: string): string | undefined {
  if (/\bvisita\s+programada\b/.test(t)) return 'visit_scheduled'
  if (/\bnegociaci(o|ó)n\b/.test(t)) return 'negotiation'
  if (/\boferta\b/.test(t)) return 'offer'
  if (/\bcualificad[oa]\b/.test(t)) return 'qualified'
  if (/\bcontactad[oa]\b/.test(t)) return 'contacted'
  if (/\bganad[oa]\b/.test(t)) return 'won'
  if (/\bperdid[oa]\b/.test(t)) return 'lost'
  if (/\bnuev[oa]\b/.test(t)) return 'new'
  if (/\bvisita\b/.test(t)) return 'visit_scheduled'
  return undefined
}

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente', in_progress: 'En curso', completed: 'Completada',
  done: 'Completada', closed: 'Cerrada', cancelled: 'Cancelada', open: 'Pendiente',
}
function detectTaskStatus(t: string): string | undefined {
  if (/\b(completad[oa]|hecha|hecho|terminad[oa]|finalizad[oa])\b/.test(t)) return 'completed'
  if (/\b(en\s+curso|en\s+progreso|empezad[oa])\b/.test(t)) return 'in_progress'
  if (/\bcancelad[oa]\b/.test(t)) return 'cancelled'
  if (/\b(pendiente|reabr|reabrir)\b/.test(t)) return 'pending'
  return undefined
}

const CASE_STATUS_LABEL: Record<string, string> = {
  open: 'Abierto', documentation_pending: 'Documentación pendiente', in_review: 'En revisión',
  in_follow_up: 'En seguimiento', submitted: 'Presentado', resolved: 'Resuelto', closed: 'Cerrado',
}
function detectCaseStatus(t: string): string | undefined {
  if (/\bresuelt[oa]\b/.test(t)) return 'resolved'
  if (/\bcerrad[oa]\b/.test(t)) return 'closed'
  if (/\b(en\s+revision)\b/.test(t)) return 'in_review'
  if (/\b(en\s+seguimiento)\b/.test(t)) return 'in_follow_up'
  if (/\b(documentacion\s+pendiente)\b/.test(t)) return 'documentation_pending'
  if (/\bpresentad[oa]\b/.test(t)) return 'submitted'
  if (/\b(en\s+progreso)\b/.test(t)) return 'in_review'
  if (/\babiert[oa]\b/.test(t)) return 'open'
  return undefined
}

const PRIORITY_LABEL: Record<string, string> = { high: 'Alta', normal: 'Normal', low: 'Baja' }
function detectPriority(t: string): string | undefined {
  if (/\b(alta|urgente)\b/.test(t)) return 'high'
  if (/\bbaja\b/.test(t)) return 'low'
  if (/\bprioridad\s+normal\b/.test(t)) return 'normal'
  return undefined
}

type ClientLite = { id: string; name: string }
type ClientResolution =
  | { kind: 'none' }
  | { kind: 'one'; client: ClientLite }
  | { kind: 'many'; candidates: ClientLite[] }

async function resolveClient(supabase: SupabaseClient, workspaceId: string, name?: string): Promise<ClientResolution> {
  if (!name) return { kind: 'none' }
  const term = name.replace(/[\\%_,()]/g, '').trim()
  if (!term) return { kind: 'none' }
  const { data, error } = await supabase
    .from('clients')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .or(`name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%`)
    .limit(6)
  if (error) return { kind: 'none' }
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id ?? ''), name: String(r.name ?? '') }))
  if (rows.length === 0) return { kind: 'none' }
  if (rows.length > 1) return { kind: 'many', candidates: rows.slice(0, 5) }
  return { kind: 'one', client: rows[0] }
}

function namesAnswer(candidates: ClientLite[]): string {
  const list = candidates.map((c) => c.name).filter(Boolean).join(', ')
  return `Hay varios clientes con ese nombre${list ? `: ${list}` : ''}. Dime cuál exactamente para poder seguir.`
}

const MOVE_VERB = /\b(mueve|mover|pasa|pasar|cambia|cambiar|marca|marcar|pon|poner|actualiza|actualizar)\b/
const UPDATE_VERB = /\b(marca|marcar|pon|poner|cambia|cambiar|actualiza|actualizar|reabr)\b/

export async function resolveDbAction(
  supabase: SupabaseClient,
  workspaceId: string,
  message: string,
): Promise<DbActionOutcome | null> {
  if (!message || typeof message !== 'string' || !workspaceId) return null
  const raw = message.trim()
  const t = normalize(raw)

  // -------------------- MOVE OPERATION STAGE --------------------
  if (/\b(operaci(o|ó)n|pipeline)\b/.test(t) && MOVE_VERB.test(t)) {
    const stage = detectStage(t)
    if (!stage) {
      return { answer: 'No tengo clara la etapa. Dime a qué etapa muevo la operación: nuevo, contactado, cualificado, visita programada, oferta, negociación, ganada o perdida.' }
    }
    const clientName = extractClientName(raw)
    const client = await resolveClient(supabase, workspaceId, clientName)
    if (client.kind === 'none') {
      return { answer: clientName ? `No encuentro a "${clientName}" en datos reales.` : 'Dime de qué cliente es la operación que quieres mover.' }
    }
    if (client.kind === 'many') return { answer: namesAnswer(client.candidates) }
    const { data } = await supabase
      .from('opportunities')
      .select('id, title, stage')
      .eq('workspace_id', workspaceId)
      .eq('client_id', client.client.id)
      .not('stage', 'in', '("won","lost")')
      .order('updated_at', { ascending: false })
      .limit(10)
    const ops = ((data ?? []) as Array<Record<string, unknown>>).map((o) => ({ id: String(o.id ?? ''), title: String(o.title ?? ''), stage: String(o.stage ?? '') }))
    if (ops.length === 0) return { answer: `No encuentro operaciones abiertas para ${client.client.name} en datos reales.` }
    if (ops.length > 1) {
      return { answer: `${client.client.name} tiene varias operaciones abiertas: ${ops.map((o) => `"${o.title}"`).join(', ')}. ¿Cuál muevo? Dime el título.` }
    }
    const op = ops[0]
    if (op.stage === stage) return { answer: `La operación "${op.title}" ya está en ${STAGE_LABEL[stage] ?? stage}.` }
    const action: PreparedActionDraft = {
      type: 'move_operation_stage',
      opportunityId: op.id,
      clientName: client.client.name,
      title: op.title,
      stage,
      currentStageLabel: STAGE_LABEL[op.stage] ?? op.stage,
      missingFields: [],
    }
    return {
      answer: `Voy a mover "${op.title}" de ${STAGE_LABEL[op.stage] ?? op.stage} a ${STAGE_LABEL[stage] ?? stage} (cliente ${client.client.name}). Revísalo y pulsa Confirmar.`,
      preparedAction: action,
    }
  }

  // -------------------- UPDATE SERVICE CASE (estado/prioridad) --------------------
  if (/\b(expediente|caso)\b/.test(t) && UPDATE_VERB.test(t)) {
    const status = detectCaseStatus(t)
    const priority = detectPriority(t)
    if (!status && !priority) {
      return { answer: 'Dime qué cambio en el expediente: estado (resuelto, cerrado, en revisión, en seguimiento…) o prioridad (alta, normal, baja).' }
    }
    const clientName = extractClientName(raw)
    const client = await resolveClient(supabase, workspaceId, clientName)
    if (client.kind === 'none') {
      return { answer: clientName ? `No encuentro a "${clientName}" en datos reales.` : 'Dime de qué cliente es el expediente.' }
    }
    if (client.kind === 'many') return { answer: namesAnswer(client.candidates) }
    const { data } = await supabase
      .from('service_cases')
      .select('id, title, status, priority')
      .eq('workspace_id', workspaceId)
      .eq('client_id', client.client.id)
      .not('status', 'in', '("resolved","closed")')
      .order('updated_at', { ascending: false })
      .limit(10)
    const cases = ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({ id: String(c.id ?? ''), title: String(c.title ?? ''), status: String(c.status ?? ''), priority: String(c.priority ?? '') }))
    if (cases.length === 0) return { answer: `No encuentro expedientes abiertos para ${client.client.name} en datos reales.` }
    if (cases.length > 1) {
      return { answer: `${client.client.name} tiene varios expedientes: ${cases.map((c) => `"${c.title}"`).join(', ')}. ¿Cuál actualizo? Dime el título.` }
    }
    const c = cases[0]
    const changes = [status ? `estado ${CASE_STATUS_LABEL[status] ?? status}` : null, priority ? `prioridad ${PRIORITY_LABEL[priority] ?? priority}` : null].filter(Boolean).join(' · ')
    const action: PreparedActionDraft = {
      type: 'update_service_case',
      caseId: c.id,
      clientName: client.client.name,
      title: c.title,
      status,
      priority,
      missingFields: [],
    }
    return { answer: `Voy a actualizar el expediente "${c.title}" (${changes}) de ${client.client.name}. Revísalo y pulsa Confirmar.`, preparedAction: action }
  }

  // -------------------- UPDATE TASK (estado/prioridad) --------------------
  if (/\btarea\b/.test(t) && UPDATE_VERB.test(t)) {
    const status = detectTaskStatus(t)
    const priority = detectPriority(t)
    if (!status && !priority) {
      return { answer: 'Dime qué cambio en la tarea: estado (completada, pendiente, en curso, cancelada) o prioridad (alta, normal, baja).' }
    }
    const clientName = extractClientName(raw)
    const client = clientName ? await resolveClient(supabase, workspaceId, clientName) : null
    if (client && client.kind === 'none') {
      return { answer: `No encuentro a "${clientName}" en datos reales.` }
    }
    if (client && client.kind === 'many') return { answer: namesAnswer(client.candidates) }
    let query = supabase
      .from('tasks')
      .select('id, title, status, priority, client_name')
      .eq('workspace_id', workspaceId)
    if (client && client.kind === 'one') query = query.eq('client_id', client.client.id)
    const { data } = await query.order('created_at', { ascending: false }).limit(10)
    const tasks = ((data ?? []) as Array<Record<string, unknown>>).map((x) => ({ id: String(x.id ?? ''), title: String(x.title ?? ''), client_name: x.client_name ? String(x.client_name) : undefined }))
    if (tasks.length === 0) return { answer: clientName ? `No encuentro tareas reales de ${clientName}.` : 'No encuentro tareas reales en este workspace.' }
    if (tasks.length > 1) {
      return { answer: `Hay varias tareas${clientName ? ` de ${clientName}` : ''}: ${tasks.slice(0, 6).map((x) => `"${x.title}"`).join(', ')}. ¿Cuál actualizo? Dime el título.` }
    }
    const task = tasks[0]
    const changes = [status ? `estado ${TASK_STATUS_LABEL[status] ?? status}` : null, priority ? `prioridad ${PRIORITY_LABEL[priority] ?? priority}` : null].filter(Boolean).join(' · ')
    const action: PreparedActionDraft = {
      type: 'update_task',
      taskId: task.id,
      clientName: task.client_name,
      title: task.title,
      status,
      priority,
      missingFields: [],
    }
    return { answer: `Voy a actualizar la tarea "${task.title}" (${changes}). Revísala y pulsa Confirmar.`, preparedAction: action }
  }

  return null
}
