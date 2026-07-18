// P71 — METAMORPHIC / PROPERTY-BASED. Para una MISMA intención, variar la superficie lingüística
// (tildes/mayúsculas/typos/sinónimos/informal/orden) NO debe cambiar el resultado semántico: misma
// capability (tool), misma entidad (entityId), mismo rango temporal. Una imprecisión puede pedir aclaración,
// pero NUNCA resolver a una entidad distinta ni subir la confianza arbitrariamente. Entidades dinámicas.
// Uso: npx tsx --tsconfig tsconfig.json scripts/p71-metamorphic.mts

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
process.env.ASSISTANT_BRAIN_TRACE = 'off'
process.env.AGENT_TOOL_SECRET = process.env.AGENT_TOOL_SECRET || envLocal('AGENT_TOOL_SECRET')
process.env.AGENT_ACTION_URL = process.env.AGENT_ACTION_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const { tryLocalAnswer } = await import('@/lib/agents/local-answers')
const { emptyState, applyStateUpdate } = await import('@/lib/agents/conversation-state')
import type { ConversationState } from '@/lib/agents/conversation-state'
const supabase = createClient(envLocal('NEXT_PUBLIC_SUPABASE_URL')!, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const { data: cli } = await supabase.from('clients').select('id, name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(1)
const C = { id: String(cli?.[0]?.id), name: String(cli?.[0]?.name ?? 'cliente') }

type Ctx = { state: ConversationState; recentContext: string }
async function run(turns: string[]): Promise<{ tool: string; entityId: string | null; tstart: string | null; tend: string | null }> {
  const ctx: Ctx = { state: emptyState(), recentContext: '' }
  let last = { handled: false } as Awaited<ReturnType<typeof tryLocalAnswer>>
  for (const t of turns) {
    last = await tryLocalAnswer(supabase as never, WS, t, { recentContext: ctx.recentContext, state: ctx.state, turnId: `mm-${Math.random()}` })
    if (last.handled && last.stateUpdate) ctx.state = applyStateUpdate(ctx.state, last.stateUpdate)
    ctx.recentContext += ` \n usuario: ${t}` + (last.handled ? ` \n asistente: ${last.answer}` : '')
  }
  const su = last.handled ? last.stateUpdate : undefined
  return {
    tool: last.handled ? String(last.usedTool) : 'UNHANDLED',
    entityId: su?.resolvedEntities?.[0]?.entityId ?? ctx.state.activeEntities[0]?.entityId ?? null,
    tstart: ctx.state.temporalScope?.start ?? null, tend: ctx.state.temporalScope?.end ?? null,
  }
}

// Familias metamórficas: [nombre, canónica, variantes que DEBEN dar el mismo resultado semántico]
type Family = { name: string; base: string[]; variants: string[][]; check: 'tool' | 'entity' | 'temporal' }
const noAcc = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const fams: Family[] = [
  {
    name: 'conteo de clientes → misma capability', check: 'tool',
    base: ['¿cuántos clientes tengo?'],
    variants: [['cuantos clientes tengo'], ['¿CUÁNTOS CLIENTES TENGO?'], ['¿cuantos clientes tengo registrados?'], ['dime el número de clientes'], ['q clientes tengo']],
  },
  {
    name: 'operaciones del cliente → mismo entityId', check: 'entity',
    base: [`busca el cliente ${C.name}`, '¿qué operaciones tiene?'],
    variants: [
      [`busca el cliente ${noAcc(C.name)}`, '¿que operaciones tiene?'],
      [`abre la ficha de ${C.name}`, '¿y sus operaciones?'],
      [`ficha de ${C.name.toLowerCase()}`, 'sus operaciones'],
      [`¿qué operaciones tiene ${C.name}?`],
      [`las operaciones de ${C.name}`],
    ],
  },
  {
    name: 'citas de esta semana → mismo rango', check: 'temporal',
    base: ['¿qué citas tengo esta semana?'],
    variants: [['que citas tengo esta semana'], ['¿CITAS DE ESTA SEMANA?'], ['muéstrame las citas de esta semana'], ['citas esta misma semana']],
  },
]

const results: Array<{ n: string; ok: boolean; d: string }> = []
for (const f of fams) {
  const ref = await run(f.base)
  for (const v of f.variants) {
    const got = await run(v)
    let ok = true, d = ''
    if (f.check === 'tool') { ok = got.tool === ref.tool || (got.tool.startsWith('local_client') && ref.tool.startsWith('local_client')); d = `${got.tool} vs ${ref.tool}` }
    if (f.check === 'entity') {
      // debe resolver a la MISMA entidad, o pedir aclaración — jamás a OTRA entidad distinta
      const clarify = got.tool === 'local_scope:clarify' || got.tool === 'local_ref:clarify'
      ok = clarify || (got.entityId === ref.entityId && got.entityId !== null); d = `entity ${got.entityId} vs ${ref.entityId} tool=${got.tool}`
    }
    if (f.check === 'temporal') { ok = got.tstart === ref.tstart && got.tend === ref.tend; d = `${got.tstart}..${got.tend} vs ${ref.tstart}..${ref.tend}` }
    results.push({ n: `${f.name} :: «${v.join(' » ').slice(0, 40)}»`, ok, d: ok ? '' : d })
  }
}

const pass = results.filter((r) => r.ok).length
console.log(`\nP71 METAMORPHIC — ${pass}/${results.length} propiedades preservadas (cliente=${C.name})\n`)
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.n}${r.ok ? '' : `  →  ${r.d}`}`)
setTimeout(() => process.exit(pass === results.length ? 0 : 1), 200)
