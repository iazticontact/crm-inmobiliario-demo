// P70 Wave C — E2E del CATÁLOGO MULTIMÓDULO de acciones (21 supported) contra el plano P65 desplegado.
//
// Motor REAL del chat (tryLocalAnswer → prepare) + botones reales (executeUiAction → confirm/cancel) +
// invariantes vía API directa (campos prohibidos, transiciones, enums, workspace ajeno). Fixtures QA
// propios (cliente/tarea/operación/trámite/cita con sufijo Catalogqa) creados server-side y BORRADOS al
// final; los datos demo compartidos (San Pedro 66) se restauran. No imprime secretos.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p70-action-catalog-e2e.mts
//      (AGENT_ACTION_URL apunta a staging por defecto; expórtala a http://localhost:3211 para pre-push)

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
console.log(`Plano de acciones: ${BASE}`)

const { tryLocalAnswer, executeUiAction } = await import('@/lib/agents/local-answers')
const { validateAssistantUi } = await import('@/lib/assistant/ui-contract')
const supabase = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}  ${extra}`) } }

type Prep = { answer: string; actionId: string; handled: boolean }
async function askPrepare(msg: string): Promise<Prep> {
  const r = await tryLocalAnswer(supabase as never, WS, msg, {})
  const ui = r.handled ? validateAssistantUi(r.ui ?? null) : null
  return { answer: r.handled ? r.answer : '(no manejado)', actionId: String(ui?.action?.actionId ?? ''), handled: r.handled }
}
async function confirmById(actionId: string) { return executeUiAction(supabase as never, WS, 'confirm', actionId) }
async function cancelById(actionId: string) { return executeUiAction(supabase as never, WS, 'cancel', actionId) }
async function api(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${BASE}/api/agent/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': process.env.AGENT_TOOL_SECRET! }, body: JSON.stringify(body) })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const row = async (table: string, id: string) => (await supabase.from(table).select('*').eq('id', id).maybeSingle()).data as Record<string, unknown> | null

// ── CLEANUP previo (restos de runs fallidos) + FIXTURES QA ──
async function cleanup() {
  await supabase.from('tasks').delete().eq('workspace_id', WS).ilike('title', '%catalogqa%')
  await supabase.from('calendar_events').delete().eq('workspace_id', WS).ilike('client_name', '%Catalogqa%')
  await supabase.from('opportunities').delete().eq('workspace_id', WS).ilike('title', '%Catalogqa%')
  await supabase.from('service_cases').delete().eq('workspace_id', WS).ilike('title', '%Catalogqa%')
  await supabase.from('clients').delete().eq('workspace_id', WS).ilike('name', '%Catalogqa%')
  await supabase.from('assistant_actions').update({ status: 'cancelled' }).eq('workspace_id', WS).eq('status', 'prepared')
}
await cleanup()

const { data: qaClient } = await supabase.from('clients').insert({ workspace_id: WS, name: 'Roberta Catalogqa', status: 'lead', email: 'roberta.catalogqa@example.com', phone: '600 111 222' }).select('id').single()
const { data: qaOp } = await supabase.from('opportunities').insert({ workspace_id: WS, title: 'Operacion Piso Catalogqa', stage: 'new', value: 100000, client_id: qaClient!.id }).select('id').single()
const { data: qaCase } = await supabase.from('service_cases').insert({ workspace_id: WS, title: 'Tramite Nota Simple Catalogqa', status: 'open', priority: 'normal' }).select('id').single()
if (!qaClient || !qaOp || !qaCase) { console.error('No pude crear fixtures QA'); process.exit(2) }

const { data: prop } = await supabase.from('properties').select('id, title, price, notes, area, status').eq('workspace_id', WS).ilike('title', '%San Pedro 66%').is('deleted_at', null).maybeSingle()
if (!prop) { console.error('No existe el inmueble San Pedro 66 en demo'); process.exit(2) }
const PROP_ORIG = { notes: prop.notes as string | null, area: prop.area as string | null }

try {
  // ════ CLIENTES ════
  let r = await askPrepare('Cambia el teléfono de Roberta Catalogqa al 600 333 444')
  check('clients.update_phone → preview', r.actionId !== '' && /600 333 444/.test(r.answer), r.answer.slice(0, 80))
  await cancelById(r.actionId)
  check('clients.update_phone cancel no escribe', String((await row('clients', String(qaClient.id)))?.phone) === '600 111 222')

  r = await askPrepare('Cambia el email de Roberta Catalogqa a roberta.nueva@example.com')
  check('clients.update_email → preview', r.actionId !== '', r.answer.slice(0, 80))
  await cancelById(r.actionId)

  r = await askPrepare('Añade una nota al cliente Roberta Catalogqa: prefiere visitas por la tarde')
  check('clients.update_note → preview', r.actionId !== '', r.answer.slice(0, 80))
  let c = await confirmById(r.actionId)
  check('clients.update_note confirm verificado', c.handled && /aplicado y verificado/i.test(c.answer))
  check('clients.update_note en BD', String((await row('clients', String(qaClient.id)))?.notes).includes('tarde'))

  r = await askPrepare('Marca al cliente Roberta Catalogqa como inactiva')
  check('clients.update_status → preview', r.actionId !== '', r.answer.slice(0, 80))
  c = await confirmById(r.actionId)
  check('clients.update_status = inactive en BD', String((await row('clients', String(qaClient.id)))?.status) === 'inactive')

  r = await askPrepare('Cambia el nombre del cliente Roberta Catalogqa a Roberta Garcia Catalogqa')
  check('clients.update_name → preview', r.actionId !== '', r.answer.slice(0, 80))
  c = await confirmById(r.actionId)
  check('clients.update_name en BD', String((await row('clients', String(qaClient.id)))?.name) === 'Roberta Garcia Catalogqa')

  // ════ CARTERA ════
  r = await askPrepare('Añade una nota al inmueble San Pedro 66: revisar caldera Catalogqa')
  check('portfolio.update_notes → preview', r.actionId !== '', r.answer.slice(0, 80))
  c = await confirmById(r.actionId)
  check('portfolio.update_notes en BD', String((await row('properties', String(prop.id)))?.notes).includes('Catalogqa'))

  r = await askPrepare('Cambia la zona de Avenida San Pedro 66 a Deusto Catalogqa')
  check('portfolio.update_zone → preview', r.actionId !== '', r.answer.slice(0, 80))
  c = await confirmById(r.actionId)
  check('portfolio.update_zone en BD', String((await row('properties', String(prop.id)))?.area) === 'Deusto Catalogqa')

  // restaurar datos demo compartidos
  await supabase.from('properties').update({ notes: PROP_ORIG.notes, area: PROP_ORIG.area }).eq('id', prop.id)

  // ════ TAREAS (ciclo de vida completo sobre fixture propio) ════
  r = await askPrepare('Crea una tarea para llamar hoy a Roberta catalogqa')
  check('tasks.create → preview', r.actionId !== '', r.answer.slice(0, 80))
  c = await confirmById(r.actionId)
  const { data: tRows } = await supabase.from('tasks').select('id, title, status, priority, due_date').eq('workspace_id', WS).ilike('title', '%catalogqa%').limit(2)
  check('tasks.create en BD (status pending)', tRows?.length === 1 && tRows[0].status === 'pending', JSON.stringify(tRows))
  const taskId = String(tRows?.[0]?.id ?? '')

  r = await askPrepare('Cambia la prioridad de la tarea llamar hoy a Roberta catalogqa a alta')
  c = await confirmById(r.actionId)
  check('tasks.update_priority = high', String((await row('tasks', taskId))?.priority) === 'high', r.answer.slice(0, 80))

  r = await askPrepare('Cambia la fecha de la tarea llamar hoy a Roberta catalogqa a mañana')
  c = await confirmById(r.actionId)
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
  const tomorrowIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(tomorrow)
  check('tasks.update_due_date = mañana', String((await row('tasks', taskId))?.due_date) === tomorrowIso, `${(await row('tasks', taskId))?.due_date} vs ${tomorrowIso}`)

  r = await askPrepare('Renombra la tarea llamar hoy a Roberta catalogqa a enviar dossier a Roberta catalogqa')
  c = await confirmById(r.actionId)
  check('tasks.update_title en BD', String((await row('tasks', taskId))?.title).includes('dossier'), String((await row('tasks', taskId))?.title))

  r = await askPrepare('Marca como hecha la tarea de enviar dossier a Roberta catalogqa')
  c = await confirmById(r.actionId)
  check('tasks.complete → done (literal real)', String((await row('tasks', taskId))?.status) === 'done')

  r = await askPrepare('Reabre la tarea enviar dossier a Roberta catalogqa')
  check('tasks.reopen → preview', r.actionId !== '', r.answer.slice(0, 80))
  c = await confirmById(r.actionId)
  check('tasks.reopen → pending en BD', String((await row('tasks', taskId))?.status) === 'pending')

  // ════ CALENDARIO ════
  r = await askPrepare('Agenda una visita con Roberta Catalogqa mañana a las 11')
  check('calendar.create → preview con fecha/hora', r.actionId !== '' && /11/.test(r.answer), r.answer.slice(0, 100))
  c = await confirmById(r.actionId)
  const { data: evRows } = await supabase.from('calendar_events').select('id, title, type, date, start_hour, start_minute, start_at, end_at, status').eq('workspace_id', WS).ilike('client_name', '%Catalogqa%').limit(2)
  const ev = evRows?.[0]
  check('calendar.create en BD (visit, 11:00, start_at coherente)',
    evRows?.length === 1 && ev?.type === 'visit' && Number(ev?.start_hour) === 11 && !!ev?.start_at && !!ev?.end_at
    && new Date(String(ev.end_at)).getTime() - new Date(String(ev.start_at)).getTime() === 60 * 60_000, JSON.stringify(ev))

  r = await askPrepare('Reprograma la cita con Roberta Catalogqa a las 12:30')
  check('calendar.reschedule → preview', r.actionId !== '', r.answer.slice(0, 100))
  c = await confirmById(r.actionId)
  const ev2 = await row('calendar_events', String(ev?.id))
  check('calendar.reschedule en BD (12:30 + start_at recompuesto)',
    Number(ev2?.start_hour) === 12 && Number(ev2?.start_minute) === 30
    && new Date(String(ev2?.start_at)).getTime() !== new Date(String(ev?.start_at)).getTime())

  // Evento de Google (read-only): la reprogramación se rechaza en prepare.
  await supabase.from('calendar_events').update({ is_read_only: true }).eq('id', String(ev?.id))
  const ro = await api({ operation: 'prepare', workspace_id: WS, action_type: 'calendar.reschedule', entity_id: String(ev?.id), proposed_changes: { date: tomorrowIso, start_hour: 9, start_minute: 0, start_at: new Date().toISOString(), end_at: new Date(Date.now() + 3600e3).toISOString() } })
  check('calendar.reschedule sobre evento Google → rechazado', ro.status === 409, `(${ro.status} ${ro.json.error})`)
  await supabase.from('calendar_events').update({ is_read_only: false }).eq('id', String(ev?.id))

  // ════ OPERACIONES ════
  r = await askPrepare('Pasa la operación Piso Catalogqa a negociación')
  check('operations.change_stage → preview', r.actionId !== '', r.answer.slice(0, 100))
  c = await confirmById(r.actionId)
  check('operations.change_stage = negotiation en BD', String((await row('opportunities', String(qaOp.id)))?.stage) === 'negotiation')

  r = await askPrepare('Cambia el valor de la operación Piso Catalogqa a 120.000 €')
  check('operations.update_value → preview (no confunde con precio)', r.actionId !== '' && /120\.000/.test(r.answer), r.answer.slice(0, 100))
  c = await confirmById(r.actionId)
  check('operations.update_value = 120000 en BD', Number((await row('opportunities', String(qaOp.id)))?.value) === 120000)

  // Cerrada = final: ni etapa hacia atrás ni valor (comisiones).
  await supabase.from('opportunities').update({ stage: 'won' }).eq('id', String(qaOp.id))
  const wonStage = await api({ operation: 'prepare', workspace_id: WS, action_type: 'operations.change_stage', entity_id: String(qaOp.id), proposed_changes: { stage: 'new' } })
  check('won → new bloqueado (ACTION_TRANSITION_INVALID)', wonStage.status === 422 && wonStage.json.error === 'ACTION_TRANSITION_INVALID', `(${wonStage.status})`)
  const wonValue = await api({ operation: 'prepare', workspace_id: WS, action_type: 'operations.update_value', entity_id: String(qaOp.id), proposed_changes: { value: 90000 } })
  check('valor de operación cerrada bloqueado', wonValue.status === 422 && wonValue.json.error === 'ACTION_TRANSITION_INVALID', `(${wonValue.status})`)

  // ════ TRÁMITES ════
  r = await askPrepare('Marca el trámite Nota Simple Catalogqa como resuelto')
  check('cases.update_status → preview', r.actionId !== '', r.answer.slice(0, 100))
  c = await confirmById(r.actionId)
  check('cases.update_status = resolved en BD', String((await row('service_cases', String(qaCase.id)))?.status) === 'resolved')

  r = await askPrepare('Cambia la fecha del trámite Nota Simple Catalogqa a mañana')
  check('cases.update_due_date → preview', r.actionId !== '', r.answer.slice(0, 100))
  c = await confirmById(r.actionId)
  check('cases.update_due_date en BD', String((await row('service_cases', String(qaCase.id)))?.due_date) === tomorrowIso)

  // ════ INVARIANTES (API directa) ════
  const unk = await api({ operation: 'prepare', workspace_id: WS, action_type: 'invoices.create', proposed_changes: { amount: 1 } })
  check('acción desconocida/facturación → ACTION_UNKNOWN', unk.status === 422 && unk.json.error === 'ACTION_UNKNOWN')
  const deniedF = await api({ operation: 'prepare', workspace_id: WS, action_type: 'clients.update_phone', entity_id: String(qaClient.id), proposed_changes: { name: 'hack' } })
  check('campo fuera de allowedFields → ACTION_FIELD_DENIED', deniedF.status === 403 && deniedF.json.error === 'ACTION_FIELD_DENIED')
  const badDone = await api({ operation: 'prepare', workspace_id: WS, action_type: 'tasks.complete', entity_id: taskId, proposed_changes: { status: 'completed' } })
  check('tasks.complete rechaza «completed»', badDone.status === 422)
  const badEnum = await api({ operation: 'prepare', workspace_id: WS, action_type: 'clients.update_status', entity_id: String(qaClient.id), proposed_changes: { status: 'vip' } })
  check('enum de estado de cliente inválido → 422', badEnum.status === 422)
  const badHour = await api({ operation: 'prepare', workspace_id: WS, action_type: 'calendar.reschedule', entity_id: String(ev?.id), proposed_changes: { start_hour: 25 } })
  check('hora imposible → 422', badHour.status === 422)
  const wrongWs = await api({ operation: 'prepare', workspace_id: '00000000-0000-4000-8000-00000000beef', action_type: 'clients.update_phone', entity_id: String(qaClient.id), proposed_changes: { phone: '600 000 000' } })
  check('entidad de otro workspace → 404 (no fuga)', wrongWs.status === 404 && wrongWs.json.error === 'ACTION_ENTITY_MISMATCH')
  const reopenPending = await api({ operation: 'prepare', workspace_id: WS, action_type: 'tasks.reopen', entity_id: taskId, proposed_changes: { status: 'pending' } })
  check('reabrir una tarea ya pendiente → bloqueado', reopenPending.status === 422 && reopenPending.json.error === 'ACTION_TRANSITION_INVALID', `(${reopenPending.status})`)
} finally {
  await cleanup()
  await supabase.from('properties').update({ notes: PROP_ORIG.notes, area: PROP_ORIG.area }).eq('id', prop.id)
}

// Verificación del cleanup (cero fixtures residuales).
const { count: leftovers } = await supabase.from('clients').select('id', { count: 'exact', head: true }).eq('workspace_id', WS).ilike('name', '%Catalogqa%')
check('cleanup: cero fixtures residuales', (leftovers ?? 0) === 0)
const fresh = await supabase.from('properties').select('notes, area').eq('id', prop.id).maybeSingle()
check('cleanup: San Pedro 66 restaurado', String(fresh.data?.notes ?? '') === String(PROP_ORIG.notes ?? '') && String(fresh.data?.area ?? '') === String(PROP_ORIG.area ?? ''))

console.log(`\nP70 ACTION CATALOG E2E: ${pass}/${pass + fail} ${fail ? 'CON FALLOS' : 'TODO PASS'}`)
process.exit(fail ? 1 : 0)
