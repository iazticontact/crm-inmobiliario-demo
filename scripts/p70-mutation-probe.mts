// P70 Wave F — PROBE de invariantes para el mutation harness. Comprueba UN invariante y sale 0 si se
// CUMPLE (la mutación sería MISSED) o 1 si está ROTO (DETECTED). Se ejecuta en un proceso tsx fresco, de
// modo que importa la versión ACTUAL (posiblemente mutada) de los módulos lib, sin necesidad de build.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p70-mutation-probe.mts <invariante>

import { readFileSync } from 'node:fs'
function envLocal(n: string) { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const WS_FOREIGN = 'facadeb0-0000-4000-8000-0000c4a05000'
const inv = process.argv[2]
// Diferir el exit ~300ms evita el assert de libuv (UV_HANDLE_CLOSING) cuando un socket keep-alive de
// supabase/undici sigue cerrándose en el momento del process.exit().
const ok = (holds: boolean) => { process.exitCode = holds ? 0 : 1; setTimeout(() => process.exit(process.exitCode), 300) }

if (inv === 'tasks-done-not-completed') {
  // Invariante: tasks.complete propone status='done' (nunca 'completed').
  const { parseActionIntent } = await import('@/lib/agents/assistant-action-intent')
  const i = parseActionIntent('marca como hecha la tarea de llamar a David')
  ok(!!i && i.act === 'prepare' && (i.proposedChanges as Record<string, unknown>).status === 'done')
} else if (inv === 'todo-not-hijacked-by-tasks') {
  // Invariante P63: «lístame TODO lo que tengo en inmuebles» se clasifica como properties, no tasks.
  const { classifyIntent } = await import('@/lib/agents/intent')
  const e = classifyIntent('lístame TODO lo que tengo en inmuebles').entity
  ok(e === 'properties')
} else if (inv === 'invoice-not-in-registry') {
  // Invariante: no existe ninguna acción de facturación en el registro.
  const reg = await import('@/lib/agents/action-registry')
  const defs = Object.values(reg.ASSISTANT_ACTIONS)
  ok(defs.every((d) => !/invoice|factur/i.test(d.id) && !/invoice/i.test(d.table)))
} else if (inv === 'past-event-not-upcoming') {
  // Invariante temporal: una cita pasada NUNCA es próxima.
  const { isUpcoming, isPast } = await import('@/lib/assistant-temporal')
  ok(isUpcoming('2020-01-01') === false && isPast('2020-01-01') === true)
} else if (inv === 'findings-dedupe') {
  // Invariante: persistFindings deduplica por fingerprint (segundo insert → duplicate, no created).
  const { persistFindings } = await import('@/lib/agents/findings-engine')
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const fp = `mutqa:${Date.now()}`
  const f = [{ finding_type: 'mutqa', entity_type: null, entity_id: null, fingerprint: fp, title: 'mutqa', summary: 'mutqa', severity: 'info' as const }]
  try {
    const a = await persistFindings(sb as never, WS, f)
    const b = await persistFindings(sb as never, WS, f) // mismo fingerprint
    ok(a.created === 1 && b.created === 0 && b.duplicates === 1)
  } finally {
    await sb.from('assistant_findings').delete().eq('workspace_id', WS).eq('fingerprint', fp)
  }
} else if (inv === 'confirm-without-pending-no-write') {
  // Invariante: «sí, confirma» sin acción preparada NO ejecuta ninguna escritura.
  const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  await sb.from('assistant_actions').update({ status: 'cancelled' }).eq('workspace_id', WS).eq('status', 'prepared')
  const r = await tryLocalAnswer(sb as never, WS, 'sí, confirma', {})
  const executed = r.handled && /aplicado y verificado/i.test(r.answer)
  ok(!executed)
} else if (inv === 'workspace-scoped-reads') {
  // Invariante: una lectura local con un workspace VACÍO no devuelve datos de otro workspace.
  const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const r = await tryLocalAnswer(sb as never, WS_FOREIGN, '¿Qué clientes tengo?', {})
  // El ws sintético no tiene clientes: la respuesta NO debe listar clientes del ws demo.
  const leaked = r.handled && /David|Laura|Marta|Iglesias/i.test(r.answer)
  ok(r.handled && !leaked)
} else {
  console.error(`invariante desconocido: ${inv}`)
  process.exit(2)
}
