// P71 — HANDOFF local-first ↔ n8n (SIN mocks): llama al WEBHOOK VIVO del cerebro con el body real del
// contrato (incl. `conversationState` reducido) y valida SEMÁNTICA: continuidad de entidad, herencia de
// periodo, no-ejecución, no-datos-desde-memoria y fallo limpio. Complementa a las suites locales: aquí el
// que interpreta es el LLM del workflow parcheado ([P71 ADAPTIVE CONVERSATIONAL INTELLIGENCE]).
// Uso: npx tsx --tsconfig tsconfig.json scripts/p71-n8n-handoff-e2e.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
const WS = 'd0000000-0000-4000-8000-000000000001'
const WEBHOOK = (envLocal('N8N_ASSISTANT_V2_WEBHOOK_URL') ?? (envLocal('N8N_BASE_URL') ? String(envLocal('N8N_BASE_URL')).replace(/\/$/, '') + '/webhook/crm-agent-v2' : '')).trim()
const SECRET = (envLocal('N8N_ASSISTANT_V2_SECRET') ?? envLocal('N8N_WEBHOOK_SECRET') ?? '').trim()
const TOOL_SECRET = envLocal('AGENT_TOOL_SECRET') ?? ''
// Contrato P51 REAL: sin turnPolicyToken firmado, las tools se rechazan (strict) y el agente queda mudo.
const { decideTurn } = await import('@/lib/agents/assistant-turn')
const { allowedToolsForTurn } = await import('@/lib/agents/assistant-tool-permissions')
const { signTurnPolicy } = await import('@/lib/agents/turn-policy')
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const { data: cli } = await supabase.from('clients').select('id, name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(2)
const A = { id: String(cli?.[0]?.id), name: String(cli?.[0]?.name ?? 'cliente') }

type Body = Record<string, unknown>
async function callBrain(message: string, conversationState: unknown, extra: Body = {}, turnCtx: Parameters<typeof decideTurn>[1] = {}): Promise<{ ok: boolean; reply: string; usedTools: string[] }> {
  const threadId = `p71-handoff-${Date.now()}`
  const requestId = `hf-${Date.now()}`
  // Token firmado EXACTAMENTE como la route (P51): sin él, el endpoint de tools rechaza (strict ON).
  // turnCtx refleja lo que la route derivaría del ConversationState (priorModule/hasLastResult).
  const turnDecision = decideTurn(message, turnCtx)
  const allowedTools = allowedToolsForTurn(turnDecision)
  const turnPolicyToken = signTurnPolicy({ cid: threadId, tid: requestId, domain: turnDecision.domain, read: turnDecision.shouldReadData, write: turnDecision.shouldWriteData, tools: allowedTools }, TOOL_SECRET)
  const body: Body = {
    message, workspaceId: WS, userId: 'p71-handoff-qa', threadId,
    activeEntity: null, recentMessages: [], requestId,
    turn: { turnType: turnDecision.turnType, domain: turnDecision.domain, shouldReadData: turnDecision.shouldReadData, allowedTools },
    turnPolicyToken, conversationState, ...extra,
  }
  const controller = new AbortController(); const t = setTimeout(() => controller.abort(), 60_000)
  try {
    const r = await fetch(WEBHOOK!, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-agent-secret': SECRET }, body: JSON.stringify(body), signal: controller.signal })
    clearTimeout(t)
    if (!r.ok) return { ok: false, reply: `http_${r.status}`, usedTools: [] }
    const j = await r.json().catch(() => ({})) as Record<string, unknown>
    const reply = String(j.reply ?? j.output ?? '')
    return { ok: !!reply, reply, usedTools: Array.isArray(j.usedTools) ? j.usedTools.map(String) : [] }
  } catch (e) { clearTimeout(t); return { ok: false, reply: String((e as Error).message).slice(0, 80), usedTools: [] } }
}

const results: Array<{ name: string; ok: boolean; detail: string }> = []
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  →  ${detail}`}`) }

const stateWithClient = {
  activeModule: 'clients', activeCapability: null,
  activeEntities: [{ type: 'client', id: A.id, label: A.name }],
  temporal: null, pendingIntent: null, lastQuery: { module: 'clients', entityType: 'client' },
}

console.log(`\nP71 N8N HANDOFF E2E — webhook vivo · cliente=${A.name}\n`)

const contCtx = { priorEntity: 'clients' as const, priorModule: 'clients' as const, hasLastResult: true }
// activeEntity derivado del estado — EXACTAMENTE lo que la route envía tras el fix de frontera P71
// (una entidad resuelta por local-first llega a n8n también por el campo legacy).
const entityFromState = { type: 'client', id: A.id, label: A.name }
// A · local→n8n: continuidad de ENTIDAD (pregunta compleja que local-first no intercepta)
{
  const r = await callBrain('¿qué sabes de su situación general y qué me recomiendas revisar primero?', stateWithClient, { activeEntity: entityFromState }, contCtx)
  const scoped = r.ok && fold(r.reply).includes(fold(A.name.split(' ')[0]))
  const usedTool = r.usedTools.length > 0
  check('A· n8n conserva la ENTIDAD del estado y usa tools reales', scoped && usedTool, `scoped=${scoped} tools=${r.usedTools.join(',') || 'ninguna'} reply=${r.reply.slice(0, 80)}`)
}
// D · temporal compartido: el periodo del estado acota la lectura
{
  const state = { ...stateWithClient, activeModule: 'calendar', temporal: { start: '2026-07-20', end: '2026-07-26', interpretation: 'la semana que viene' }, lastQuery: { module: 'calendar', entityType: 'calendar_event' } }
  const r = await callBrain('¿y qué citas hay?', state, {}, { priorEntity: 'calendar', priorModule: 'calendar', hasLastResult: true })
  const usedCalendarTool = r.usedTools.some((t) => /calendar|agenda|query/i.test(t))
  check('D· n8n hereda el PERIODO y consulta calendario con tool', r.ok && usedCalendarTool, `tools=${r.usedTools.join(',')} reply=${r.reply.slice(0, 80)}`)
}
// 2 · no-datos-desde-memoria: pregunta de dato con estado pero SIN dato en el estado → debe usar tool
{
  const r = await callBrain('¿cuántas operaciones tiene ahora mismo?', stateWithClient, {}, contCtx)
  const usedTool = r.usedTools.length > 0
  check('2· dato actual ⇒ tool SIEMPRE (jamás desde el estado)', r.ok && usedTool, `tools=${r.usedTools.join(',') || 'NINGUNA'} `)
}
// 4 · pendingIntent jamás se ejecuta desde n8n
{
  const state = { ...stateWithClient, pendingIntent: { capability: 'portfolio.update_price', missingSlots: ['value'] } }
  const r = await callBrain('sí, hazlo ya', state, {}, contCtx)
  const executed = /aplicad[oa] y verificad|cambio aplicado/i.test(fold(r.reply))
  check('4· pendingIntent + «hazlo» NO ejecuta (pide el slot o el flujo bifásico)', r.ok && !executed, r.reply.slice(0, 100))
}
// E · fallo limpio: secreto inválido → rechazo sin contaminar nada
{
  const r = await fetch(WEBHOOK!, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowcrm-agent-secret': 'invalid-secret' }, body: JSON.stringify({ message: 'hola', workspaceId: WS }) })
  check('E· secreto inválido → rechazo limpio (4xx/sin reply)', r.status >= 400 || !(await r.json().catch(() => ({}) as Record<string, unknown>)).reply, `http=${r.status}`)
}
// Compat · sin conversationState (cliente P70) → sigue funcionando
{
  const r = await callBrain('¿cuántos clientes tengo?', null)
  check('C· compat P70: sin conversationState responde con tool', r.ok && r.usedTools.length > 0, `tools=${r.usedTools.join(',')}`)
}

const pass = results.filter((r) => r.ok).length
console.log(`\nP71 N8N HANDOFF: ${pass}/${results.length} ${pass === results.length ? 'TODO PASS' : 'CON FALLOS'}`)
setTimeout(() => process.exit(pass === results.length ? 0 : 1), 200)
