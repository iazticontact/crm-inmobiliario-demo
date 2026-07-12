// Evals de SEGURIDAD del plano de acciones (P65) — PURAS. Token de acción (firma/expiración/manipulación/
// separación lectura-escritura), hash de preview e invariantes del registro (confirmación obligatoria,
// campos prohibidos, Facturación inexistente por construcción).

import { signActionToken, verifyActionToken, previewHashOf } from '@/lib/agents/action-policy'
import { ASSISTANT_ACTIONS, getActionDefinition, findDeniedField } from '@/lib/agents/action-registry'
import { signTurnPolicy } from '@/lib/agents/turn-policy'

export function runActionSecurityEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const S = 'test-secret-for-evals-only-0123456789'
  const base = { actionId: 'a-1', actionType: 'tasks.create', workspaceId: 'w-1', entityId: null, previewHash: 'h1', idempotencyKey: 'k1', confirmed: true }

  // A) Token de acción: firma válida, expiración, manipulación, secreto distinto.
  const t = signActionToken(base, S)
  ok(t.startsWith('act.'), 'prefijo act.')
  const v = verifyActionToken(t, S)
  ok(v.ok && v.claims.actionType === 'tasks.create' && v.claims.confirmed === true, 'verifica claims')
  ok(!verifyActionToken(t, 'otro-secreto-distinto-9876543210').ok, 'secreto distinto → rechazo')
  ok(verifyActionToken(t.slice(0, -3) + 'abc', S).ok === false, 'firma manipulada → rechazo')
  const expired = signActionToken(base, S, -1000)
  const ev = verifyActionToken(expired, S)
  ok(!ev.ok && ev.reason === 'expired', 'expirado → rechazo')
  // Payload manipulado (cambiar confirmed a true tras firmar con confirmed false).
  const unconfirmed = signActionToken({ ...base, confirmed: false }, S)
  const uv = verifyActionToken(unconfirmed, S)
  ok(uv.ok && uv.claims.confirmed === false, 'confirmed=false viaja firmado (el endpoint lo rechaza)')

  // B) SEPARACIÓN lectura/escritura: un token de LECTURA (turn-policy) JAMÁS pasa como token de acción.
  const readToken = signTurnPolicy({ cid: 'c', tid: 't', domain: 'tasks', read: true, write: false, tools: ['tasks.read'] }, S)
  const rv = verifyActionToken(readToken, S)
  ok(!rv.ok && (rv.reason === 'not_action_token' || rv.reason === 'malformed'), 'token de lectura ≠ token de acción')

  // C) previewHash: sensible a cambios de estado y de propuesta.
  const h1 = previewHashOf({ price: 295000 }, { price: 280000 })
  ok(h1 !== previewHashOf({ price: 290000 }, { price: 280000 }), 'cambio de estado actual → hash distinto')
  ok(h1 !== previewHashOf({ price: 295000 }, { price: 285000 }), 'cambio de propuesta → hash distinto')
  ok(h1 === previewHashOf({ price: 295000 }, { price: 280000 }), 'hash estable')

  // D) Registro: toda acción exige confirmación, es idempotente y no toca campos prohibidos.
  for (const def of Object.values(ASSISTANT_ACTIONS)) {
    ok(def.confirmationRequired === true, `${def.id}: confirmación obligatoria`)
    ok(def.idempotent === true, `${def.id}: idempotente`)
    ok(def.forbiddenFields.includes('workspace_id'), `${def.id}: workspace_id prohibido`)
    ok(def.expiryMinutes > 0 && def.expiryMinutes <= 30, `${def.id}: expiración acotada`)
  }
  ok(getActionDefinition('invoices.update') === null && getActionDefinition('invoices.create') === null, 'Facturación inexistente por construcción')
  ok(getActionDefinition('clients.delete') === null, 'delete inexistente')
  // Campos: intentar colar un campo no permitido.
  const def = ASSISTANT_ACTIONS['portfolio.update_price']
  ok(findDeniedField(def, { price: 1000, status: 'sold' }) === 'status', 'campo extra denegado')
  ok(findDeniedField(def, { price: 1000 }) === null, 'campo permitido pasa')
  ok(findDeniedField(def, { workspace_id: 'x' }) === 'workspace_id', 'workspace_id denegado')

  return fail
}
