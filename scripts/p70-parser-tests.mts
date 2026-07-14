// P70 Wave C — Tests PUROS de los parsers de intención de acción (sin BD, sin red).
// Cubre: cada acción nueva del catálogo, los invariantes de vocabulario (done, nunca completed),
// el orden anticolisión (operations antes que precio; reopen antes que complete) y, sobre todo,
// que una LECTURA jamás se convierte en acción.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p70-parser-tests.mts

const { parseActionIntent } = await import('@/lib/agents/assistant-action-intent')
const { isValidOperationTransition, isValidPortfolioTransition, ASSISTANT_ACTIONS } = await import('@/lib/agents/action-registry')

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}  ${extra}`) } }
const intentOf = (msg: string) => parseActionIntent(msg)
const prepared = (msg: string) => { const i = intentOf(msg); return i && i.act === 'prepare' ? i : null }

// ── Positivos: cada acción del catálogo se reconoce con sus campos ──
let p = prepared('Cambia el precio de Avenida San Pedro 66 a 280.000 €')
check('portfolio.update_price', p?.actionType === 'portfolio.update_price' && p?.proposedChanges.price === 280000, JSON.stringify(p))
p = prepared('Marca San Pedro 66 como reservado')
check('portfolio.update_status', p?.actionType === 'portfolio.update_status' && p?.proposedChanges.status === 'under_contract')
p = prepared('Cambia la zona de San Pedro 66 a Deusto')
check('portfolio.update_zone', p?.actionType === 'portfolio.update_zone' && p?.proposedChanges.area === 'Deusto', JSON.stringify(p))
p = prepared('Añade una nota al inmueble San Pedro 66: revisar la caldera antes de la visita')
check('portfolio.update_notes', p?.actionType === 'portfolio.update_notes' && String(p?.proposedChanges.notes).includes('caldera'), JSON.stringify(p))

p = prepared('Cambia el teléfono de David Iglesias al 600 555 111')
check('clients.update_phone', p?.actionType === 'clients.update_phone' && p?.proposedChanges.phone === '600 555 111')
p = prepared('Cambia el email de David Iglesias a david@example.com')
check('clients.update_email', p?.actionType === 'clients.update_email' && p?.proposedChanges.email === 'david@example.com')
p = prepared('Cambia el nombre del cliente David Iglesias a David Iglesias García')
check('clients.update_name', p?.actionType === 'clients.update_name' && p?.proposedChanges.name === 'David Iglesias García', JSON.stringify(p))
p = prepared('Añade una nota al cliente David Iglesias: prefiere visitas por la tarde')
check('clients.update_note', p?.actionType === 'clients.update_note' && String(p?.proposedChanges.notes).includes('tarde'), JSON.stringify(p))
p = prepared('Marca al cliente David Iglesias como inactivo')
check('clients.update_status', p?.actionType === 'clients.update_status' && p?.proposedChanges.status === 'inactive', JSON.stringify(p))

p = prepared('Crea una tarea para llamar mañana a David')
check('tasks.create', p?.actionType === 'tasks.create' && String(p?.proposedChanges.title).length > 3)
p = prepared('Marca como hecha la tarea de llamar a David')
check('tasks.complete → done (nunca completed)', p?.actionType === 'tasks.complete' && p?.proposedChanges.status === 'done')
p = prepared('Reabre la tarea de llamar a David')
check('tasks.reopen', p?.actionType === 'tasks.reopen' && p?.proposedChanges.status === 'pending', JSON.stringify(p))
p = prepared('Marca la tarea de llamar a David como pendiente')
check('tasks.reopen gana a complete con «pendiente»', p?.actionType === 'tasks.reopen' && p?.proposedChanges.status === 'pending', JSON.stringify(p))
p = prepared('Cambia la prioridad de la tarea llamar a David a alta')
check('tasks.update_priority', p?.actionType === 'tasks.update_priority' && p?.proposedChanges.priority === 'high', JSON.stringify(p))
p = prepared('Renombra la tarea llamar a David a llamar a David y enviarle el dossier')
check('tasks.update_title', p?.actionType === 'tasks.update_title' && String(p?.proposedChanges.title).includes('dossier'), JSON.stringify(p))
p = prepared('Cambia la fecha de la tarea llamar a David a mañana')
check('tasks.update_due_date', p?.actionType === 'tasks.update_due_date' && /^\d{4}-\d{2}-\d{2}$/.test(String(p?.proposedChanges.due_date)))

p = prepared('Agenda una visita con Laura mañana a las 10:30')
check('calendar.create (visita + hora)', p?.actionType === 'calendar.create' && p?.proposedChanges.type === 'visit' && p?.proposedChanges.start_hour === 10 && p?.proposedChanges.start_minute === 30 && p?.proposedChanges.client_name === 'Laura', JSON.stringify(p))
p = prepared('Crea una reunión el viernes a las 9')
check('calendar.create (reunión)', p?.actionType === 'calendar.create' && p?.proposedChanges.type === 'meeting' && p?.proposedChanges.start_hour === 9, JSON.stringify(p))
p = prepared('Agenda una llamada con Marta')
check('calendar.create sin fecha/hora → missing fields', p?.actionType === 'calendar.create' && p!.missingFields.includes('fecha') && p!.missingFields.includes('hora'))
p = prepared('Reprograma la cita con Laura a las 12')
check('calendar.reschedule (solo hora)', p?.actionType === 'calendar.reschedule' && p?.proposedChanges.start_hour === 12 && !('date' in (p?.proposedChanges ?? {})), JSON.stringify(p))
p = prepared('Mueve la visita de Laura a mañana a las 9')
check('calendar.reschedule (fecha y hora)', p?.actionType === 'calendar.reschedule' && p?.proposedChanges.start_hour === 9 && /^\d{4}-\d{2}-\d{2}$/.test(String(p?.proposedChanges.date)), JSON.stringify(p))

p = prepared('Pasa la operación Piso Deusto a negociación')
check('operations.change_stage', p?.actionType === 'operations.change_stage' && p?.proposedChanges.stage === 'negotiation', JSON.stringify(p))
p = prepared('Marca la operación de David como ganada')
check('operations.change_stage (ganada)', p?.actionType === 'operations.change_stage' && p?.proposedChanges.stage === 'won', JSON.stringify(p))
p = prepared('Cambia el valor de la operación Piso Deusto a 350.000 €')
check('operations.update_value (no es precio de inmueble)', p?.actionType === 'operations.update_value' && p?.proposedChanges.value === 350000, JSON.stringify(p))

p = prepared('Marca el trámite Nota simple como resuelto')
check('cases.update_status', p?.actionType === 'cases.update_status' && p?.proposedChanges.status === 'resolved', JSON.stringify(p))
p = prepared('Cambia la fecha del trámite Nota simple a mañana')
check('cases.update_due_date', p?.actionType === 'cases.update_due_date' && /^\d{4}-\d{2}-\d{2}$/.test(String(p?.proposedChanges.due_date)), JSON.stringify(p))

// ── Invariante central: una LECTURA jamás se convierte en acción ──
const READS = [
  '¿Qué citas tengo mañana?', 'Muéstrame la agenda', 'Lista mis tareas pendientes',
  '¿Cuántos clientes tengo?', '¿Qué operaciones hay abiertas?', '¿Tengo alguna visita el viernes?',
  'mi agenda de mañana', '¿Qué trámites están pendientes?', 'Enséñame los inmuebles en venta',
  '¿Cuál es el precio del piso de San Pedro 66?', 'la reunión de ayer fue bien',
  '¿puedo cambiar el precio de un inmueble?', 'explícame cómo funciona el calendario',
]
for (const r of READS) {
  const i = intentOf(r)
  check(`lectura no se convierte en acción: «${r.slice(0, 42)}»`, i === null || i.act !== 'prepare', i ? `→ ${JSON.stringify(i).slice(0, 80)}` : '')
}

// ── Transiciones ──
check('operación: won es final', !isValidOperationTransition('won', 'new') && !isValidOperationTransition('won', 'lost'))
check('operación: lost reactivable', isValidOperationTransition('lost', 'new'))
check('operación: reserved → won', isValidOperationTransition('reserved', 'won'))
check('cartera: sold → listed prohibida', !isValidPortfolioTransition('sold', 'listed'))

// ── Registro: tamaño y módulos cubiertos ──
const defs = Object.values(ASSISTANT_ACTIONS)
check('catálogo ≥ 15 acciones', defs.length >= 15, `(${defs.length})`)
const modules = new Set(defs.map((d) => d.module))
check('6 módulos editables', ['clients', 'portfolio', 'tasks', 'calendar', 'operations', 'cases'].every((m) => modules.has(m as never)), [...modules].join(','))
check('ninguna acción sin confirmación/idempotencia', defs.every((d) => d.confirmationRequired && d.idempotent))
check('updates con optimistic lock', defs.filter((d) => d.kind === 'update').every((d) => d.supportsOptimisticLock))
check('Facturación fuera del registro', defs.every((d) => !/invoice|factur/i.test(d.id) && !/invoice/i.test(d.table)))

console.log(`\nP70 PARSER TESTS: ${pass}/${pass + fail} ${fail ? 'CON FALLOS' : 'TODO PASS'}`)
process.exit(fail ? 1 : 0)
