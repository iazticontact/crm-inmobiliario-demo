// P69 — E2E CONVERSACIONAL de automatizaciones: frases naturales por el motor real del chat contra el
// endpoint P68 DESPLEGADO. Opt-in estricto (preview → confirmación → regla real) + lista + desactivar.
// Limpieza: la regla creada queda desactivada al final. Sin secretos.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p69-automation-chat-e2e.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function envLocal(name: string): string | undefined {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined
}
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

let pass = 0, fail = 0, ctx = ''
const say = async (msg: string) => {
  const r = await tryLocalAnswer(supabase as never, WS, msg, { recentContext: ctx })
  const ans = r.handled ? r.answer : '(no manejado)'
  ctx += `\nusuario: ${msg}\nasistente: ${ans}`
  return ans
}
const check = (n: string, c: boolean, x = '') => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n} ${x}`) } }

const { count: before } = await supabase.from('assistant_automation_rules').select('id', { count: 'exact', head: true }).eq('workspace_id', WS)

// 1) Activar → PREVIEW (sin crear regla).
const a1 = await say('Activa una auditoría de calidad diaria a las 8')
check('activar → preview con horario y opt-in', /Automatización preparada/.test(a1) && /8:00/.test(a1) && /Aún no está activada/i.test(a1), a1.slice(0, 80))
const { count: mid } = await supabase.from('assistant_automation_rules').select('id', { count: 'exact', head: true }).eq('workspace_id', WS)
check('preview NO crea regla', (mid ?? 0) === (before ?? 0))

// 2) Confirmar → regla real con próxima ejecución.
const a2 = await say('sí, confirma')
check('confirmación → activada y programada', /activada y programada/i.test(a2) && /Próxima ejecución/i.test(a2), a2.slice(0, 90))
const { data: rules } = await supabase.from('assistant_automation_rules').select('id, enabled, next_run_at').eq('workspace_id', WS).order('created_at', { ascending: false }).limit(1)
check('regla en BD enabled + next_run_at', rules?.[0]?.enabled === true && !!rules?.[0]?.next_run_at)

// 3) Listar.
const a3 = await say('lista mis automatizaciones')
check('lista muestra la regla activa', /activa/.test(a3) && /próxima/i.test(a3), a3.slice(0, 90))

// 4) Desactivar (limpieza).
const a4 = await say('desactiva la automatización del resumen')
check('desactivar → confirmado', /desactivada/i.test(a4), a4.slice(0, 80))
const { data: after } = await supabase.from('assistant_automation_rules').select('enabled').eq('id', rules![0].id).maybeSingle()
check('regla desactivada en BD (limpieza)', after?.enabled === false)

// 5) «sí, confirma» sin preview de automatización pendiente → no crea nada.
ctx = ''
const a5 = await say('sí, confirma')
check('confirmación sin preview no crea regla', !/activada y programada/i.test(a5), a5.slice(0, 60))

console.log(fail === 0 ? `\nP69 AUTOMATION-CHAT E2E: ${pass}/${pass + fail} TODO PASS` : `\nP69 AUTOMATION-CHAT E2E: ${fail} FALLOS`)
process.exit(fail === 0 ? 0 : 1)
