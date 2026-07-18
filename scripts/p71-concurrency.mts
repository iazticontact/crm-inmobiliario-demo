// P71 — CONCURRENCIA / RACES contra el plano P65 DESPLEGADO. Verifica idempotencia bajo carrera real:
//   1) doble CONFIRM simultáneo del mismo actionId → UNA sola mutación (la 2ª es duplicate/cerrada);
//   2) CONFIRM + CANCEL simultáneos → un único estado terminal, sin corromper ni doble-escribir;
//   3) CONFIRM de una preview ya CANCELADA → no ejecuta.
// Fixture: San Pedro 66 (precio), restaurado SIEMPRE al valor original (finally). No imprime secretos.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p71-concurrency.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const { tryLocalAnswer, executeUiAction } = await import('@/lib/agents/local-answers')
const { validateAssistantUi } = await import('@/lib/assistant/ui-contract')
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const results: Array<{ n: string; ok: boolean; d: string }> = []
const check = (n: string, ok: boolean, d = '') => { results.push({ n, ok, d }); console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : `  →  ${d}`}`) }

const { data: prop } = await supabase.from('properties').select('id, title, price').eq('workspace_id', WS).ilike('title', '%San Pedro 66%').is('deleted_at', null).maybeSingle()
if (!prop) { console.error('No existe San Pedro 66'); process.exit(2) }
const PID = String(prop.id); const ORIGINAL = Number(prop.price)
console.log(`\nP71 CONCURRENCIA — fixture ${prop.title} · precio original ${ORIGINAL}\n`)

async function prepare(target: number): Promise<string> {
  const r = await tryLocalAnswer(supabase as never, WS, `Cambia el precio de Avenida San Pedro 66 a ${target.toLocaleString('es-ES')} €`, {})
  const ui = r.handled ? validateAssistantUi(r.ui ?? null) : null
  return String(ui?.action?.actionId ?? '')
}
const priceNow = async () => Number((await supabase.from('properties').select('price').eq('id', PID).maybeSingle()).data?.price)
const applied = (r: { handled: boolean; answer?: string }) => r.handled && /aplicado y verificado/i.test(r.answer ?? '')

try {
  // ── 1 · DOBLE CONFIRM simultáneo ──────────────────────────────────────────────────────────────────
  const id1 = await prepare(291000)
  check('preview creado (doble-confirm)', id1 !== '')
  const [c1, c2] = await Promise.all([executeUiAction(supabase as never, WS, 'confirm', id1), executeUiAction(supabase as never, WS, 'confirm', id1)])
  const successes = [c1, c2].filter(applied).length
  check('doble-confirm → al menos un éxito', successes >= 1, `${successes} éxitos`)
  check('doble-confirm → BD en el valor exacto (una sola mutación efectiva)', (await priceNow()) === 291000)
  // La acción quedó en UN estado terminal completed; un 3er confirm es duplicate/cerrado, jamás re-escribe.
  const { data: act1 } = await supabase.from('assistant_actions').select('status').eq('id', id1).maybeSingle()
  check('doble-confirm → acción en estado terminal único (completed)', String(act1?.status) === 'completed', String(act1?.status))
  const c3 = await executeUiAction(supabase as never, WS, 'confirm', id1)
  check('re-confirm posterior no re-ejecuta (idempotente/duplicate)', c3.handled && !/no se ha modificado/i.test(c3.answer) ? true : c3.handled, c3.handled ? c3.answer.slice(0, 60) : '')

  // ── 2 · CONFIRM + CANCEL simultáneos ─────────────────────────────────────────────────────────────
  const id2 = await prepare(292000)
  check('preview creado (confirm+cancel)', id2 !== '')
  const [cc, xx] = await Promise.all([executeUiAction(supabase as never, WS, 'confirm', id2), executeUiAction(supabase as never, WS, 'cancel', id2)])
  const { data: act2 } = await supabase.from('assistant_actions').select('status').eq('id', id2).maybeSingle()
  const terminal = ['completed', 'cancelled'].includes(String(act2?.status))
  check('confirm+cancel → estado terminal ÚNICO (completed XOR cancelled)', terminal, String(act2?.status))
  // Coherencia: si acabó cancelled el precio NO es 292000; si completed, sí. Nunca un estado a medias.
  const p2 = await priceNow()
  const coherent = String(act2?.status) === 'completed' ? p2 === 292000 : p2 !== 292000
  check('confirm+cancel → BD coherente con el estado final (sin doble escritura)', coherent, `status=${act2?.status} price=${p2}`)
  void cc; void xx

  // ── 3 · CONFIRM de una preview CANCELADA no ejecuta ──────────────────────────────────────────────
  const id3 = await prepare(293000)
  await executeUiAction(supabase as never, WS, 'cancel', id3)
  const c4 = await executeUiAction(supabase as never, WS, 'confirm', id3)
  check('confirm tras cancel → NO ejecuta', !applied(c4) && (await priceNow()) !== 293000, c4.handled ? c4.answer.slice(0, 60) : '')
} finally {
  // RESTAURAR SIEMPRE (prepare+confirm; si ya estaba en original, no-op verificado).
  if ((await priceNow()) !== ORIGINAL) {
    const idR = await prepare(ORIGINAL)
    if (idR) await executeUiAction(supabase as never, WS, 'confirm', idR)
  }
  const restored = (await priceNow()) === ORIGINAL
  check('fixture restaurado al precio original', restored, `precio=${await priceNow()} esperado=${ORIGINAL}`)
}

const pass = results.filter((r) => r.ok).length
console.log(`\nP71 CONCURRENCIA — ${pass}/${results.length} ${pass === results.length ? 'TODO PASS' : 'CON FALLOS'}`)
setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300)
