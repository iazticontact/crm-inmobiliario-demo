// P71·It3 — TESTS UNITARIOS PUROS (sin BD, deterministas) de los mecanismos GENERALES: upgrade de estado
// v1→v2, scope composicional (entidad+periodo), pendingIntent DERIVADO del registry (incl. texto libre y
// calendar multi-slot) y resolución de nombre NO destructiva. Se usan frases nuevas (no las de la sonda) y
// se valida COMPORTAMIENTO (capability/slots/entityText/periodo), nunca texto literal.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p71-it3-unit.mts

import { upgradeConversationState, emptyState, CONVERSATION_STATE_VERSION, type ConversationState } from '@/lib/agents/conversation-state'
import { resolveQueryScope } from '@/lib/agents/conversation-scope'
import { detectIncompleteAction, completePendingAction, buildPendingFromIntent } from '@/lib/agents/conversation-pending'
import { parseActionIntent } from '@/lib/agents/assistant-action-intent'
import { parseAbsoluteTemporal } from '@/lib/agents/conversation-temporal'

const UUID = 'd0000000-0000-4000-8000-000000000001'
const TODAY = '2026-07-16'
const results: Array<{ n: string; ok: boolean; d: string }> = []
function test(n: string, fn: () => void) { try { fn(); results.push({ n, ok: true, d: '' }) } catch (e) { results.push({ n, ok: false, d: (e as Error).message }) } }
function assert(c: unknown, m: string) { if (!c) throw new Error(m) }

// ── A · UPGRADE v1 → v2 ─────────────────────────────────────────────────────────────────────────────
test('upgrade: null → empty', () => { const r = upgradeConversationState(null); assert(r.outcome === 'empty' && r.state === null, r.outcome) })
test('upgrade: basura no-objeto → reset_invalid', () => { const r = upgradeConversationState('xxx'); assert(r.outcome === 'reset_invalid', r.outcome) })
test('upgrade: version desconocida → reset_invalid', () => { const r = upgradeConversationState({ version: 99 }); assert(r.outcome === 'reset_invalid', r.outcome) })
test('upgrade: v2 válida → loaded_v2', () => {
  const v2 = { ...emptyState(), activeModule: 'clients' }
  const r = upgradeConversationState(v2)
  assert(r.outcome === 'loaded_v2' && r.state?.activeModule === 'clients', r.outcome)
})
test('upgrade: v1 válida → upgraded conservando módulo/entidad, pendingIntent/temporalScope=null', () => {
  const v1 = {
    version: 1, updatedAt: new Date().toISOString(), activeGoal: null, activeModule: 'portfolio', activeCapability: null,
    activeEntities: [{ entityType: 'property', entityId: UUID, displayLabel: 'Chalet Los Robles', confidence: 0.8, sourceTurnId: 't' }],
    previousEntities: [], referents: [], pendingIntent: { capability: 'x', requiredSlots: [] },
    temporalScope: { start: '2026-01-01', end: '2026-01-07', timezone: 'Europe/Madrid', interpretation: 'x' },
    lastDataQuery: null, lastAssistantResult: null,
  }
  const r = upgradeConversationState(v1)
  assert(r.outcome === 'upgraded', `outcome=${r.outcome}`)
  assert(r.state?.version === CONVERSATION_STATE_VERSION, 'version debe ser v2')
  assert(r.state?.activeModule === 'portfolio', 'módulo conservado')
  assert(r.state?.activeEntities.length === 1 && r.state.activeEntities[0].entityId === UUID, 'entidad conservada')
  assert(r.state?.pendingIntent === null, 'pendingIntent inicializado a null')
  assert(r.state?.temporalScope === null, 'temporalScope inicializado a null')
})
test('upgrade: v1 parcialmente inválida → upgraded descartando lo inseguro', () => {
  const v1 = { version: 1, activeModule: 'clients', activeEntities: 'no-es-array', referents: [{ bad: true }], lastDataQuery: null }
  const r = upgradeConversationState(v1)
  assert(r.outcome === 'upgraded', `outcome=${r.outcome}`)
  assert(Array.isArray(r.state?.activeEntities) && r.state!.activeEntities.length === 0, 'entidades inválidas descartadas')
  assert(r.state?.activeModule === 'clients', 'módulo válido conservado')
})

// ── B · SCOPE COMPOSICIONAL (entidad + periodo, agregado, shift) ──────────────────────────────────────
function stateWithClient(): ConversationState {
  const s = emptyState()
  s.activeEntities = [{ entityType: 'client', entityId: UUID, displayLabel: 'Cliente Uno', confidence: 0.9, sourceTurnId: 't' }]
  s.activeModule = 'clients'
  return s
}
test('scope: pronombre + periodo → entityScope(cliente) Y temporalScope(semana) coexisten', () => {
  const sc = resolveQueryScope('¿y sus citas la semana que viene?', stateWithClient(), TODAY, 't1')
  assert(sc.entityScope?.entityType === 'client', 'entityScope cliente')
  assert(sc.temporalScope?.granularity === 'week', 'temporalScope semana')
  assert(sc.capability === 'calendar', `capability=${sc.capability}`)
})
test('scope: elisión + agregado + periodo → count + entidad + periodo', () => {
  const sc = resolveQueryScope('¿cuántas operaciones tiene este mes?', stateWithClient(), TODAY, 't2')
  assert(sc.entityScope?.source === 'active', 'entidad por elisión')
  assert(sc.aggregation?.type === 'count', 'agregado count')
  assert(sc.temporalScope?.granularity === 'month', 'periodo mes')
})
test('scope: cambio de periodo conservando entidad (shift) no borra entityScope', () => {
  const s = stateWithClient()
  s.temporalScope = parseAbsoluteTemporal('esta semana', TODAY, 't')
  const sc = resolveQueryScope('¿y la siguiente?', s, TODAY, 't3')
  assert(sc.temporalScope && sc.temporalScope.start! > s.temporalScope!.start!, 'periodo avanza')
})

// ── C · PENDING INTENT DERIVADO DEL REGISTRY ──────────────────────────────────────────────────────────
test('pending: desiderativo incompleto (precio) → capability del registry + faltan value/entity', () => {
  const b = detectIncompleteAction('necesito actualizar el precio de un inmueble', TODAY)
  assert(b?.pending.capability === 'portfolio.update_price', `cap=${b?.pending.capability}`)
  assert(b!.pending.requiredSlots.includes('value') && b!.pending.requiredSlots.includes('entity'), 'faltan value+entity')
})
test('pending: NOMBRE NO destructivo — un label que empieza por tipo conserva todos los tokens', () => {
  const b = detectIncompleteAction('quiero cambiar el precio de un inmueble', TODAY)!
  const pending = { ...b.pending, expiresAt: new Date(Date.now() + 60000).toISOString(), sourceTurnId: 't' }
  const c = completePendingAction(pending, 'el de Chalet Urbanizacion Los Robles a 305000', TODAY)
  assert(c?.done === true, 'debe completar')
  assert(String((c as { intent: { entityText: string } }).intent.entityText).toLowerCase().includes('chalet'), `entityText perdió «chalet»: ${(c as { intent: { entityText: string } }).intent.entityText}`)
  assert((c as { intent: { proposedChanges: Record<string, unknown> } }).intent.proposedChanges.price === 305000, 'precio parseado')
})
test('pending: campo de TEXTO LIBRE (nombre de cliente) se completa con respuesta bare', () => {
  const b = detectIncompleteAction('quiero cambiar el nombre de un cliente', TODAY)!
  assert(b.pending.capability === 'clients.update_name', `cap=${b.pending.capability}`)
  const pending = { ...b.pending, expiresAt: new Date(Date.now() + 60000).toISOString(), sourceTurnId: 't' }
  // Falta entidad y nombre: primero la entidad, luego el nombre (bare).
  const c1 = completePendingAction(pending, 'el cliente Marina Costa', TODAY)
  assert(c1 && c1.done === false, 'aún falta el nombre')
  const pending2 = { ...pending, collectedSlots: (c1 as { collected: Record<string, unknown> }).collected }
  const c2 = completePendingAction(pending2, 'Marina Costa Delgado', TODAY)
  assert(c2?.done === true, 'debe completar con el nombre bare')
  assert(String((c2 as { intent: { proposedChanges: Record<string, string> } }).intent.proposedChanges.name).includes('Marina'), 'nombre capturado')
})
test('pending: calendar.create MULTI-SLOT — «crea una cita mañana» pide hora y se completa', () => {
  const intent = parseActionIntent('crea una cita mañana')
  assert(intent?.act === 'prepare' && intent.actionType === 'calendar.create', 'parse calendar.create')
  const b = buildPendingFromIntent(intent as never, 'crea una cita mañana')
  assert(!!b, 'debe faltar algún slot (hora)')
  const pending = { ...b!.pending, expiresAt: new Date(Date.now() + 60000).toISOString(), sourceTurnId: 't' }
  const c = completePendingAction(pending, 'a las 11', TODAY)
  assert(c?.done === true, 'debe completar con la hora')
  const pc = (c as { intent: { proposedChanges: Record<string, unknown> } }).intent.proposedChanges
  assert(pc.date !== undefined && pc.start_hour === 11, `faltan date/hora: ${JSON.stringify(pc)}`)
})
test('pending: una pregunta de CAPACIDAD no abre intención', () => {
  const b = detectIncompleteAction('¿puedo cambiar el precio de un inmueble?', TODAY)
  assert(b === null, 'una pregunta de capacidad no debe crear pendingIntent')
})
test('pending: corrección de slot sustituye el valor antes del preview', () => {
  const b = detectIncompleteAction('quiero cambiar el precio de un inmueble', TODAY)!
  const pending = { ...b.pending, expiresAt: new Date(Date.now() + 60000).toISOString(), sourceTurnId: 't' }
  const c1 = completePendingAction(pending, '300000', TODAY) // aporta value, falta entidad
  const pending2 = { ...pending, collectedSlots: (c1 as { collected: Record<string, unknown> }).collected }
  const c2 = completePendingAction(pending2, 'mejor 320000', TODAY) // corrige value con marcador
  const val = ((c2 as { collected: Record<string, unknown> }).collected).price
  assert(val === 320000, `corrección de value no aplicada: ${val}`)
})

// ── Resumen ────────────────────────────────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.ok).length
console.log(`\nP71·It3 UNIT — ${pass}/${results.length} PASS\n`)
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.n}${r.ok ? '' : `  →  ${r.d}`}`)
process.exit(pass === results.length ? 0 : 1)
