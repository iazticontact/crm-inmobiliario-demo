// POST /api/agent/action (P65) — CONTROL PLANE de acciones del Asistente.
//
// Ciclo: prepare → confirm(execute+verify) → status/cancel. Server-to-server (mismo modelo de auth que
// /api/agent/tool: header x-nowcrm-secret + service role + scoping explícito por workspace_id en TODAS las
// queries). Reglas duras:
//   · solo acciones del REGISTRO (action-registry) — nunca tabla/campos arbitrarios ni SQL;
//   · confirm exige TOKEN DE ACCIÓN firmado (`act.…`, action-policy) con previewHash + confirmed=true —
//     un token de lectura JAMÁS sirve para escribir;
//   · idempotencia: confirmar dos veces devuelve el MISMO resultado sin segunda escritura;
//   · optimistic lock: si la entidad cambió tras el preview (updated_at distinto) → ACTION_CONFLICT,
//     nunca sobrescritura silenciosa;
//   · read-after-write SIEMPRE: no se responde «completed» sin releer y verificar el valor;
//   · Facturación prohibida por construcción (no hay acción de invoices en el registro).

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import { getActionDefinition, findDeniedField } from '@/lib/agents/action-registry'
import { signActionToken, verifyActionToken, previewHashOf, newIdempotencyKey } from '@/lib/agents/action-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function secretsOk(header: string | null, secret: string): boolean {
  if (!header) return false
  const a = Buffer.from(header), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}
function err(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: code, message }, { status })
}

export async function POST(req: Request) {
  const secret = process.env.AGENT_TOOL_SECRET
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret || !url || !serviceKey) return err(503, 'endpoint_disabled', 'Config incompleta.')
  if (!secretsOk(req.headers.get('x-nowcrm-secret'), secret)) return err(401, 'unauthorized', 'Credencial inválida.')

  let body: Row
  try { body = await req.json() } catch { return err(400, 'invalid_json', 'Body inválido.') }
  const operation = String(body.operation ?? '')
  const workspaceId = String(body.workspace_id ?? '')
  if (!UUID_RE.test(workspaceId)) return err(400, 'invalid_workspace', 'workspace_id UUID requerido.')
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  if (operation === 'prepare') return prepare(supabase, workspaceId, body, secret)
  if (operation === 'confirm') return confirm(supabase, workspaceId, body, secret)
  if (operation === 'cancel') return cancel(supabase, workspaceId, body)
  if (operation === 'status') return status(supabase, workspaceId, body)
  return err(400, 'invalid_operation', 'operation debe ser prepare|confirm|cancel|status.')
}

// ── PREPARE: leer estado actual, validar campos, persistir pending action, devolver preview + token ──
async function prepare(supabase: SupabaseClient, ws: string, body: Row, secret: string) {
  const def = getActionDefinition(String(body.action_type ?? ''))
  if (!def) return err(422, 'ACTION_UNKNOWN', 'Acción no registrada.')
  const changes = (body.proposed_changes ?? {}) as Record<string, unknown>
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) {
    return err(422, 'ACTION_VALIDATION_ERROR', 'proposed_changes requerido.')
  }
  const denied = findDeniedField(def, changes)
  if (denied) return err(403, 'ACTION_FIELD_DENIED', `Campo no permitido: ${denied}.`)

  let current: Row = {}
  let entityId: string | null = null
  if (def.requiredEntity) {
    entityId = String(body.entity_id ?? '')
    if (!UUID_RE.test(entityId)) return err(422, 'ACTION_VALIDATION_ERROR', 'entity_id UUID requerido.')
    const { data, error } = await supabase.from(def.table).select('*').eq('workspace_id', ws).eq('id', entityId).maybeSingle()
    if (error) return err(500, 'ACTION_EXECUTION_ERROR', 'No pude leer la entidad.')
    if (!data) return err(404, 'ACTION_ENTITY_MISMATCH', 'Entidad no encontrada en este workspace.')
    if ((data as Row).deleted_at) return err(409, 'ACTION_ENTITY_MISMATCH', 'La entidad está eliminada.')
    current = Object.fromEntries(def.allowedFields.map((f) => [f, (data as Row)[f] ?? null]))
    current.updated_at = (data as Row).updated_at ?? null
  }
  // Validaciones semánticas mínimas.
  if (def.id === 'portfolio.update_price') {
    const p = Number(changes.price)
    if (!Number.isFinite(p) || p <= 0) return err(422, 'ACTION_VALIDATION_ERROR', 'Precio inválido.')
  }
  // El modelo REAL de tasks solo admite 'pending' | 'done' (check constraint verificado en BD).
  if (def.id === 'tasks.complete' && changes.status !== 'done') {
    return err(422, 'ACTION_VALIDATION_ERROR', 'tasks.complete solo admite status=done.')
  }

  const previewHash = previewHashOf(current, changes)
  const idempotencyKey = String(body.idempotency_key ?? '') || newIdempotencyKey()
  const expiresAt = new Date(Date.now() + def.expiryMinutes * 60 * 1000).toISOString()
  const { data: action, error: insErr } = await supabase.from('assistant_actions').insert({
    workspace_id: ws, conversation_id: body.conversation_id ? String(body.conversation_id) : null,
    action_type: def.id, entity_type: def.table, entity_id: entityId,
    current_state_json: current, proposed_changes_json: changes,
    preview_hash: previewHash, idempotency_key: idempotencyKey,
    expected_updated_at: def.supportsOptimisticLock ? (current.updated_at as string | null) : null,
    status: 'prepared', expires_at: expiresAt,
  }).select('id').single()
  if (insErr) {
    // Idempotencia en prepare: si la key ya existe, devolver la acción existente.
    if (String(insErr.code) === '23505') {
      const { data: existing } = await supabase.from('assistant_actions').select('id, status, preview_hash')
        .eq('workspace_id', ws).eq('idempotency_key', idempotencyKey).maybeSingle()
      if (existing) return NextResponse.json({ ok: true, operation: 'prepare', action_id: existing.id, status: existing.status, duplicate: true })
    }
    return err(500, 'ACTION_EXECUTION_ERROR', 'No pude registrar la acción.')
  }
  const token = signActionToken({ actionId: String(action.id), actionType: def.id, workspaceId: ws, entityId, previewHash, idempotencyKey, confirmed: true }, secret, def.expiryMinutes * 60 * 1000)
  return NextResponse.json({
    ok: true, operation: 'prepare', action_id: action.id, status: 'prepared',
    preview: { action: def.description, entity_id: entityId, current: current, changes },
    preview_hash: previewHash, confirmation_required: true, expires_at: expiresAt, action_token: token,
  })
}

// ── CONFIRM: validar token+estado, ejecutar EXACTAMENTE el preview con lock optimista, verificar ──
async function confirm(supabase: SupabaseClient, ws: string, body: Row, secret: string) {
  const tok = verifyActionToken(String(body.action_token ?? ''), secret)
  if (!tok.ok) return err(403, 'ACTION_CONFIRMATION_INVALID', `Token de acción inválido (${tok.reason}).`)
  const c = tok.claims
  if (c.workspaceId !== ws) return err(403, 'ACTION_WORKSPACE_MISMATCH', 'Workspace distinto al de la acción.')
  if (!c.confirmed) return err(403, 'ACTION_CONFIRMATION_REQUIRED', 'La acción no está confirmada.')

  const { data: action, error } = await supabase.from('assistant_actions').select('*')
    .eq('workspace_id', ws).eq('id', c.actionId).maybeSingle()
  if (error || !action) return err(404, 'ACTION_NOT_FOUND', 'Acción no encontrada.')
  const a = action as Row
  if (a.status === 'completed') {
    // IDEMPOTENCIA: segunda confirmación → mismo resultado, sin segunda escritura.
    return NextResponse.json({ ok: true, operation: 'confirm', action_id: c.actionId, status: 'completed', duplicate: true, result: a.result_json ?? null })
  }
  if (a.status === 'cancelled') return err(409, 'ACTION_CANCELLED', 'La acción fue cancelada.')
  if (a.status === 'executing') return err(409, 'ACTION_ALREADY_EXECUTING', 'La acción ya se está ejecutando.')
  if (a.status !== 'prepared' && a.status !== 'conflict') return err(409, 'ACTION_VALIDATION_ERROR', `Estado no confirmable: ${a.status}.`)
  if (new Date(String(a.expires_at)).getTime() < Date.now()) {
    await supabase.from('assistant_actions').update({ status: 'expired' }).eq('id', c.actionId).eq('workspace_id', ws)
    return err(409, 'ACTION_EXPIRED', 'La confirmación ha caducado; hay que preparar de nuevo.')
  }
  if (a.preview_hash !== c.previewHash) return err(403, 'ACTION_PREVIEW_MISMATCH', 'El preview no coincide con el token.')
  if (String(a.action_type) !== c.actionType) return err(403, 'ACTION_ENTITY_MISMATCH', 'Tipo de acción distinto.')
  const def = getActionDefinition(String(a.action_type))
  if (!def) return err(422, 'ACTION_UNKNOWN', 'Acción no registrada.')

  // Cerrojo atómico contra dobles confirmaciones concurrentes: prepared → executing condicional.
  const { data: locked } = await supabase.from('assistant_actions')
    .update({ status: 'executing', confirmed_at: new Date().toISOString() })
    .eq('id', c.actionId).eq('workspace_id', ws).in('status', ['prepared', 'conflict'])
    .select('id')
  if (!locked || !locked.length) {
    const { data: again } = await supabase.from('assistant_actions').select('status, result_json').eq('id', c.actionId).eq('workspace_id', ws).maybeSingle()
    if (again?.status === 'completed') return NextResponse.json({ ok: true, operation: 'confirm', action_id: c.actionId, status: 'completed', duplicate: true, result: again.result_json ?? null })
    return err(409, 'ACTION_ALREADY_EXECUTING', 'Confirmación concurrente en curso.')
  }

  const changes = (a.proposed_changes_json ?? {}) as Record<string, unknown>
  const denied = findDeniedField(def, changes)
  if (denied) return err(403, 'ACTION_FIELD_DENIED', `Campo no permitido: ${denied}.`)

  // EJECUTAR exactamente el preview.
  let entityId = a.entity_id ? String(a.entity_id) : null
  if (def.kind === 'update' && entityId) {
    // Optimistic lock: el UPDATE solo aplica si updated_at sigue siendo el del preview.
    let q = supabase.from(def.table).update(changes).eq('workspace_id', ws).eq('id', entityId)
    if (def.supportsOptimisticLock && a.expected_updated_at) q = q.eq('updated_at', String(a.expected_updated_at))
    const { data: updated, error: upErr } = await q.select('id').maybeSingle()
    if (upErr) {
      await supabase.from('assistant_actions').update({ status: 'failed', safe_error_code: 'ACTION_EXECUTION_ERROR' }).eq('id', c.actionId).eq('workspace_id', ws)
      return err(500, 'ACTION_EXECUTION_ERROR', 'No pude aplicar el cambio.')
    }
    if (!updated) {
      // CONFLICTO: alguien modificó la entidad tras el preview. Nunca sobrescribir.
      await supabase.from('assistant_actions').update({ status: 'conflict', safe_error_code: 'ACTION_CONFLICT' }).eq('id', c.actionId).eq('workspace_id', ws)
      const { data: cur } = await supabase.from(def.table).select(def.allowedFields.join(',')).eq('workspace_id', ws).eq('id', entityId).maybeSingle()
      return NextResponse.json({ ok: false, error: 'ACTION_CONFLICT', message: 'La entidad fue modificada después de preparar la acción.', current: cur ?? null }, { status: 409 })
    }
  } else if (def.kind === 'insert') {
    const { data: inserted, error: insErr } = await supabase.from(def.table)
      .insert({ ...changes, workspace_id: ws, ...(def.table === 'tasks' ? { status: 'pending' } : {}) })
      .select('id').single()
    if (insErr || !inserted) {
      await supabase.from('assistant_actions').update({ status: 'failed', safe_error_code: 'ACTION_EXECUTION_ERROR' }).eq('id', c.actionId).eq('workspace_id', ws)
      return err(500, 'ACTION_EXECUTION_ERROR', 'No pude crear el registro.')
    }
    entityId = String(inserted.id)
  }

  // READ-AFTER-WRITE: releer y verificar cada campo antes de declarar completed.
  const { data: fresh } = await supabase.from(def.table).select('*').eq('workspace_id', ws).eq('id', entityId!).maybeSingle()
  const verified: Record<string, unknown> = {}
  let verifyOk = !!fresh
  for (const [k, v] of Object.entries(changes)) {
    verified[k] = fresh ? (fresh as Row)[k] ?? null : null
    if (!fresh || String((fresh as Row)[k] ?? '') !== String(v ?? '')) verifyOk = false
  }
  const result = { entity_id: entityId, verified, verify_ok: verifyOk, verified_at: new Date().toISOString() }
  await supabase.from('assistant_actions').update({
    status: verifyOk ? 'completed' : 'failed', executed_at: new Date().toISOString(),
    entity_id: entityId, result_json: result, safe_error_code: verifyOk ? null : 'ACTION_VERIFY_ERROR',
  }).eq('id', c.actionId).eq('workspace_id', ws)
  if (!verifyOk) return err(500, 'ACTION_VERIFY_ERROR', 'La escritura no se pudo verificar releyendo.')
  return NextResponse.json({ ok: true, operation: 'confirm', action_id: c.actionId, status: 'completed', result })
}

async function cancel(supabase: SupabaseClient, ws: string, body: Row) {
  const id = String(body.action_id ?? '')
  if (!UUID_RE.test(id)) return err(422, 'ACTION_VALIDATION_ERROR', 'action_id requerido.')
  const { data } = await supabase.from('assistant_actions').update({ status: 'cancelled' })
    .eq('id', id).eq('workspace_id', ws).in('status', ['prepared', 'conflict']).select('id')
  if (!data || !data.length) return err(409, 'ACTION_NOT_FOUND', 'No hay acción cancelable con ese id.')
  return NextResponse.json({ ok: true, operation: 'cancel', action_id: id, status: 'cancelled' })
}

async function status(supabase: SupabaseClient, ws: string, body: Row) {
  const id = String(body.action_id ?? '')
  if (!UUID_RE.test(id)) return err(422, 'ACTION_VALIDATION_ERROR', 'action_id requerido.')
  const { data } = await supabase.from('assistant_actions')
    .select('id, action_type, status, created_at, expires_at, confirmed_at, executed_at, result_json, safe_error_code')
    .eq('id', id).eq('workspace_id', ws).maybeSingle()
  if (!data) return err(404, 'ACTION_NOT_FOUND', 'Acción no encontrada.')
  return NextResponse.json({ ok: true, operation: 'status', action: data })
}
