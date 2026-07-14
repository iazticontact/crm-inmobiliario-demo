// P70 Wave A — E2E del CONTRATO UI + botones por actionId: el motor real del chat (tryLocalAnswer)
// emite bloques `ui` válidos; executeUiAction (botones Confirmar/Cancelar) resuelve TODO server-side
// desde assistant_actions contra el plano P65 desplegado. Verifica también la neutralización del
// preview de automatización ([AUTO:cancelled]/[AUTO:done]) y la idempotencia (doble confirm no re-aplica).
// Restaura el precio original al final. No imprime secretos.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p70-ui-contract-e2e.mts

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

const { tryLocalAnswer, executeUiAction } = await import('@/lib/agents/local-answers')
const { validateAssistantUi } = await import('@/lib/assistant/ui-contract')
const supabase = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}  ${extra}`) } }
const say = async (msg: string, recentContext = '') => tryLocalAnswer(supabase as never, WS, msg, { recentContext })

const { data: prop } = await supabase.from('properties').select('id, title, price').eq('workspace_id', WS).ilike('title', '%San Pedro 66%').is('deleted_at', null).maybeSingle()
if (!prop) { console.error('No existe el inmueble San Pedro 66 en demo'); process.exit(2) }
const ORIGINAL = Number(prop.price)
console.log(`Inmueble QA: ${prop.title} · precio original: ${ORIGINAL}`)

// 1) PREVIEW estructurado: frase → ui action_preview con actionId + campos + allowedUiActions.
const r1 = await say('Cambia el precio de Avenida San Pedro 66 a 280.000 €')
const ui1 = r1.handled ? validateAssistantUi(r1.ui ?? null) : null
check('preview emite ui action_preview válido', ui1?.kind === 'action_preview' && !!ui1.action?.actionId, JSON.stringify(ui1?.kind))
check('preview trae campos actual→propuesto y acciones confirm/cancel/modify',
  (ui1?.action?.fields.some((f) => f.key === 'price' && /280\.000/.test(String(f.proposedValue))) ?? false)
  && ['confirm', 'cancel', 'modify'].every((a) => ui1?.action?.allowedUiActions.includes(a as never)))
const actionId1 = String(ui1?.action?.actionId ?? '')

// 2) BOTÓN Cancelar (solo actionId): descarta sin ejecutar.
const r2 = await executeUiAction(supabase as never, WS, 'cancel', actionId1)
const ui2 = r2.handled ? validateAssistantUi(r2.ui ?? null) : null
check('cancel por actionId → cancelled sin aplicar', r2.handled && /descartado/i.test(r2.answer) && ui2?.action?.status === 'cancelled', r2.handled ? r2.answer.slice(0, 80) : '(no manejado)')
const { data: afterCancel } = await supabase.from('properties').select('price').eq('id', prop.id).maybeSingle()
check('BD intacta tras cancelar', Number(afterCancel?.price) === ORIGINAL)

// 3) BOTÓN Confirmar (solo actionId): ejecuta + verifica; ui action_result.
const r3 = await say('Cambia el precio de Avenida San Pedro 66 a 280.000 €')
const actionId2 = String((r3.handled ? validateAssistantUi(r3.ui ?? null) : null)?.action?.actionId ?? '')
const r4 = await executeUiAction(supabase as never, WS, 'confirm', actionId2)
const ui4 = r4.handled ? validateAssistantUi(r4.ui ?? null) : null
check('confirm por actionId → completed verificado', r4.handled && ui4?.kind === 'action_result' && ui4.action?.status === 'completed' && ui4.action.verified === true, r4.handled ? r4.answer.slice(0, 80) : '(no manejado)')
const { data: afterConfirm } = await supabase.from('properties').select('price').eq('id', prop.id).maybeSingle()
check('BD real actualizada a 280000', Number(afterConfirm?.price) === 280000)

// 4) RESTAURAR con el mismo plano (preview + confirm por actionId).
const r5 = await say(`Cambia el precio de Avenida San Pedro 66 a ${ORIGINAL.toLocaleString('es-ES')} €`)
const actionId3 = String((r5.handled ? validateAssistantUi(r5.ui ?? null) : null)?.action?.actionId ?? '')
await executeUiAction(supabase as never, WS, 'confirm', actionId3)
const { data: restored } = await supabase.from('properties').select('price').eq('id', prop.id).maybeSingle()
check('precio original restaurado', Number(restored?.price) === ORIGINAL, `(${restored?.price})`)

// 5) MULTITAB/doble clic: re-confirmar una acción ya cerrada NUNCA re-aplica el cambio.
const r6 = await executeUiAction(supabase as never, WS, 'confirm', actionId2)
const { data: afterDup } = await supabase.from('properties').select('price').eq('id', prop.id).maybeSingle()
check('doble confirm no re-aplica (idempotencia)', r6.handled && Number(afterDup?.price) === ORIGINAL, `(${afterDup?.price})`)

// 6) actionId desconocido → mensaje seguro, sin fuga.
const r7 = await executeUiAction(supabase as never, WS, 'confirm', '00000000-0000-4000-8000-00000000dead')
check('actionId desconocido → «no encuentro ese cambio»', r7.handled && /no encuentro/i.test(r7.answer), r7.handled ? r7.answer.slice(0, 80) : '(no manejado)')

// 7) AUTOMATIZACIÓN: preview estructurado; cancelar neutraliza; confirmar tras cancelar NO crea regla.
const { count: rulesBefore } = await supabase.from('assistant_automation_rules').select('id', { count: 'exact', head: true }).eq('workspace_id', WS)
const r8 = await say('activa un resumen diario a las 8')
const ui8 = r8.handled ? validateAssistantUi(r8.ui ?? null) : null
check('automatización → ui automation_preview (opt-in)', ui8?.kind === 'automation_preview' && ui8.automation?.status === 'awaiting_confirmation' && (ui8.automation?.allowedUiActions.includes('confirm') ?? false))
const previewAnswer = r8.handled ? r8.answer : ''
const r9 = await say('Mejor no, descártala', previewAnswer)
check('descartar preview → cancelado con marcador neutralizador', r9.handled && r9.usedTool === 'local_automation:cancel' && /\[AUTO:cancelled\]/.test(r9.answer), r9.handled ? `${r9.usedTool} · ${r9.answer.slice(0, 60)}` : '(no manejado)')
const r10 = await say('sí, confirma', `${previewAnswer} \n ${r9.handled ? r9.answer : ''}`)
const activated = r10.handled && /activada y programada/i.test(r10.answer)
const { count: rulesAfter } = await supabase.from('assistant_automation_rules').select('id', { count: 'exact', head: true }).eq('workspace_id', WS)
check('confirmar tras cancelar NO crea regla', !activated && (rulesAfter ?? 0) === (rulesBefore ?? 0), `(rules ${rulesBefore}→${rulesAfter})`)

// 8) FINDINGS: bloque estructurado para la card y el centro.
const r11 = await say('¿qué incidencias hay?')
const ui11 = r11.handled ? validateAssistantUi(r11.ui ?? null) : null
check('findings → ui kind finding con array', ui11?.kind === 'finding' && Array.isArray(ui11.findings), r11.handled ? r11.answer.slice(0, 60) : '(no manejado)')

// 9) VALIDADOR: basura o fuga de token → null (la UI cae a texto, nunca rompe).
check('validador rechaza basura', validateAssistantUi({ kind: 'nope' }) === null && validateAssistantUi('x') === null)
check('validador rechaza fuga token/secret', validateAssistantUi({ kind: 'action_status', action: { actionId: 'a', actionType: 't', status: 'prepared', title: 'x', fields: [{ key: 'k', label: 'action_token', proposedValue: 'abc' }], verified: false, allowedUiActions: [] } }) === null)

console.log(`\nP70 UI-CONTRACT E2E: ${pass}/${pass + fail} ${fail ? 'CON FALLOS' : 'TODO PASS'}`)
process.exit(fail ? 1 : 0)
