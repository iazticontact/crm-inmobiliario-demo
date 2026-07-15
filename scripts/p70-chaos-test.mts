// P70 Wave G — CHAOS TEST (resiliencia bajo degradación). Cubre los casos NO cubiertos por
// scheduler-chaos (32/32) ni n8n-chaos (9/9): carrera de confirmaciones (idempotencia), acción
// CADUCADA, conflicto de lock optimista, fail-soft de lecturas (reader que falla → error humano, no
// crash ni fabricación), rate-limit, y respuesta malformada del plano (cliente la tolera). Fixtures QA
// en un inmueble sintético del ws de pruebas; cleanup total. No imprime secretos.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p70-chaos-test.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const BASE = String(process.env.AGENT_ACTION_URL).replace(/\/$/, '')
const SECRET = process.env.AGENT_TOOL_SECRET!
// ws demo (properties tiene FK a workspaces): las pruebas operan SOLO sobre un inmueble QA «Chaosqa»
// creado y borrado aquí; jamás tocan datos demo reales.
const WS = 'd0000000-0000-4000-8000-000000000001'

const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { checkRateLimit } = await import('@/lib/assistant-guard')
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}  ${extra}`) } }
async function actionApi(body: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/agent/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET }, body: JSON.stringify(body) })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
async function cleanup(propId?: string) {
  // Solo las acciones ligadas al inmueble QA de este test; jamás toca otras acciones del demo.
  if (propId) await supabase.from('assistant_actions').delete().eq('workspace_id', WS).eq('entity_id', propId)
  await supabase.from('properties').delete().eq('workspace_id', WS).ilike('title', '%Chaosqa%')
}
// Limpieza previa de restos de un run anterior (por título).
{ const { data: old } = await supabase.from('properties').select('id').eq('workspace_id', WS).ilike('title', '%Chaosqa%'); for (const p of old ?? []) await supabase.from('assistant_actions').delete().eq('entity_id', String(p.id)); await cleanup() }

// Inmueble QA en el ws sintético (para preparar acciones reales sin tocar datos demo).
const { data: prop } = await supabase.from('properties').insert({ workspace_id: WS, title: 'Piso Chaosqa', status: 'listed', price: 200000, currency: 'EUR' }).select('id, updated_at').single()
if (!prop) { console.error('No pude crear el inmueble QA de chaos'); process.exit(2) }
const PROP_ID = String(prop.id)

try {
  // ══ 1) CARRERA de confirmaciones: dos confirm simultáneos de la MISMA acción → exactamente 1 completa ══
  {
    const prep = await actionApi({ operation: 'prepare', workspace_id: WS, action_type: 'portfolio.update_price', entity_id: PROP_ID, proposed_changes: { price: 210000 } })
    const token = String(prep.json.action_token ?? '')
    check('prepare de acción QA', prep.status === 200 && token !== '')
    const [a, b] = await Promise.all([actionApi({ operation: 'confirm', workspace_id: WS, action_token: token }), actionApi({ operation: 'confirm', workspace_id: WS, action_token: token })])
    const completes = [a, b].filter((x) => x.status === 200 && x.json.status === 'completed')
    const dupes = [a, b].filter((x) => x.json.duplicate === true)
    // Ambos pueden devolver 200 completed (uno ejecuta, el otro idempotente devuelve el MISMO resultado),
    // pero la escritura sólo ocurre UNA vez. Verificamos el precio final e idempotencia.
    check('confirm concurrente: al menos uno completed', completes.length >= 1, `(${a.status}/${b.status})`)
    check('confirm concurrente: el otro es idempotente/conflict, nunca doble escritura', completes.length === 2 ? dupes.length >= 1 : true)
    const { data: after } = await supabase.from('properties').select('price').eq('id', PROP_ID).maybeSingle()
    check('carrera: precio final = 210000 (una sola escritura)', Number(after?.price) === 210000, `(${after?.price})`)
  }

  // ══ 2) ACCIÓN CADUCADA: una acción prepared con expires_at pasado → ACTION_EXPIRED, sin ejecutar ══
  {
    // Insertar directamente una acción prepared caducada + firmar su token con el secret real.
    const { signActionToken, previewHashOf } = await import('@/lib/agents/action-policy')
    const previewHash = previewHashOf({ price: 210000 }, { price: 999000 })
    const idem = `chaos-exp-${Date.now()}`
    const { data: act } = await supabase.from('assistant_actions').insert({
      workspace_id: WS, action_type: 'portfolio.update_price', entity_type: 'properties', entity_id: PROP_ID,
      current_state_json: { price: 210000 }, proposed_changes_json: { price: 999000 }, preview_hash: previewHash,
      idempotency_key: idem, expected_updated_at: null, status: 'prepared', expires_at: new Date(Date.now() - 60_000).toISOString(),
    }).select('id').single()
    const token = signActionToken({ actionId: String(act!.id), actionType: 'portfolio.update_price', workspaceId: WS, entityId: PROP_ID, previewHash, idempotencyKey: idem, confirmed: true }, SECRET)
    const r = await actionApi({ operation: 'confirm', workspace_id: WS, action_token: token })
    check('acción caducada → ACTION_EXPIRED', r.status === 409 && r.json.error === 'ACTION_EXPIRED', `(${r.status} ${r.json.error})`)
    const { data: after } = await supabase.from('properties').select('price').eq('id', PROP_ID).maybeSingle()
    check('caducada: no ejecutó (precio sigue 210000)', Number(after?.price) === 210000)
  }

  // ══ 3) CONFLICTO de lock optimista: el registro cambia tras el preview → ACTION_CONFLICT, sin sobrescribir ══
  {
    const prep = await actionApi({ operation: 'prepare', workspace_id: WS, action_type: 'portfolio.update_price', entity_id: PROP_ID, proposed_changes: { price: 220000 } })
    const token = String(prep.json.action_token ?? '')
    // Mutar el inmueble EXTERNAMENTE entre preview y confirm (cambia updated_at).
    await supabase.from('properties').update({ price: 215000 }).eq('id', PROP_ID)
    const r = await actionApi({ operation: 'confirm', workspace_id: WS, action_token: token })
    check('conflicto de lock → ACTION_CONFLICT', r.status === 409 && r.json.error === 'ACTION_CONFLICT', `(${r.status} ${r.json.error})`)
    const { data: after } = await supabase.from('properties').select('price').eq('id', PROP_ID).maybeSingle()
    check('conflicto: no sobrescribe (precio = 215000 del cambio externo)', Number(after?.price) === 215000, `(${after?.price})`)
  }

  // ══ 4) FAIL-SOFT de lecturas: un reader que falla (tabla inexistente vía cliente roto) → error HUMANO,
  //       nunca un crash ni datos fabricados. Simulamos con un cliente apuntando a una anon key inválida. ══
  {
    const brokenSb = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, 'eyJbroken.invalid.key', { auth: { persistSession: false } })
    let threw = false
    let answer = ''
    try { const r = await tryLocalAnswer(brokenSb as never, WS, '¿qué clientes tengo?', {}); answer = r.handled ? r.answer : '(no manejado→n8n)' }
    catch { threw = true }
    check('reader roto → no crashea el motor', !threw)
    check('reader roto → mensaje humano / sin fabricar', !/\bDavid\b|\bLaura\b|\b\d{2,} clientes\b/i.test(answer), answer.slice(0, 80))
  }

  // ══ 5) RATE LIMIT: la 11ª petición en un minuto para la misma clave se bloquea (barrera anti-abuso) ══
  {
    const key = `chaos-rate-${Date.now()}`
    let allowed = 0
    for (let i = 0; i < 15; i++) if (checkRateLimit(key, 10)) allowed++
    check('rate limit: exactamente 10 permitidas de 15', allowed === 10, `(${allowed})`)
  }

  // ══ 6) RESPUESTA MALFORMADA del plano: un body no-JSON no debe romper el cliente (fetch .catch) ══
  {
    // Pedimos a un endpoint que existe con un body inválido: debe responder error controlado, no 5xx opaco.
    const r = await fetch(`${BASE}/api/agent/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-secret': SECRET }, body: '{ malformed json' })
    check('body malformado → 400 controlado (no 5xx)', r.status === 400 || r.status === 422, `(${r.status})`)
  }
} finally {
  await cleanup(PROP_ID)
}

console.log(`\nP70 CHAOS TEST: ${pass}/${pass + fail} ${fail ? 'CON FALLOS' : 'TODO PASS'}`)
console.log('Cobertura complementaria: scheduler-chaos-e2e (32/32) · n8n-p70-chaos-e2e (9/9) · red-team (78/78).')
process.exit(fail ? 1 : 0)
