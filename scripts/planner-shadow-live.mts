// SHADOW LIVE (FASE 37 black-box) — batería determinista contra el /api/assistant/v2 DESPLEGADO, con
// sesión QA real (cookie SSR). Dos usos:
//   1) node …/tsx scripts/planner-shadow-live.mts capture <label>   → guarda docs/shadow-live/<label>.json
//   2) node …/tsx scripts/planner-shadow-live.mts compare <a> <b>   → paridad estructural baseline vs shadow
// Invariante que demuestra: SHADOW NO altera el comportamiento visible (mismo debugSource/mode/toolCalls/
// errorCode por mensaje), jamás responde el planner (debugSource≠general_planner, sin assistantArchitecture).
// Solo LECTURAS: la batería no prepara ni confirma acciones. QA workspace sintético; sin secretos en salida.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }

const MODE = process.argv[2]
const BASE = process.env.SHADOW_BASE || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'
const WS = 'd0000000-0000-4000-8000-000000000001'
const OUTDIR = 'docs/shadow-live'

type TurnRecord = {
  message: string
  status: number
  ok: boolean
  errorCode: string | null
  debugSource: string | null
  mode: string | null
  toolCalls: string[] | null
  hasPreparedAction: boolean
  assistantArchitecture: string | null
  featureFlagState: string | null
  answerLen: number
  answerDigest: string
}

if (MODE === 'compare') {
  const a = JSON.parse(readFileSync(process.argv[3]!, 'utf8')) as { label: string; diag: Record<string, unknown>; turns: TurnRecord[] }
  const b = JSON.parse(readFileSync(process.argv[4]!, 'utf8')) as { label: string; diag: Record<string, unknown>; turns: TurnRecord[] }
  console.log(`\nPARIDAD ${a.label} (${a.diag.toolVersion}/${a.diag.generalSemanticPlanner ?? 'sin marcador'}) vs ${b.label} (${b.diag.toolVersion}/${b.diag.generalSemanticPlanner ?? 'sin marcador'})\n`)
  let same = 0, diff = 0, plannerLeaks = 0
  for (const ta of a.turns) {
    const tb = b.turns.find((x) => x.message === ta.message)
    if (!tb) { diff++; console.log(`  ✗ (solo en ${a.label}) «${ta.message.slice(0, 50)}»`); continue }
    if (tb.debugSource === 'general_planner' || tb.assistantArchitecture) plannerLeaks++
    const structEq = ta.errorCode === tb.errorCode && ta.debugSource === tb.debugSource && ta.mode === tb.mode
      && JSON.stringify(ta.toolCalls) === JSON.stringify(tb.toolCalls) && ta.hasPreparedAction === tb.hasPreparedAction
    if (structEq) { same++; console.log(`  ✓ «${ta.message.slice(0, 50)}» → ${tb.debugSource}/${tb.mode} tools=${(tb.toolCalls ?? []).join(',') || '-'}`) }
    else { diff++; console.log(`  ✗ «${ta.message.slice(0, 50)}»\n      ${a.label}: src=${ta.debugSource} mode=${ta.mode} tools=${(ta.toolCalls ?? []).join(',')} err=${ta.errorCode}\n      ${b.label}: src=${tb.debugSource} mode=${tb.mode} tools=${(tb.toolCalls ?? []).join(',')} err=${tb.errorCode}`) }
  }
  console.log(`\nPARIDAD ESTRUCTURAL: ${same}/${same + diff} · respuestas del planner filtradas al usuario: ${plannerLeaks}`)
  console.log(plannerLeaks === 0 && diff === 0 ? 'SHADOW NO ALTERA COMPORTAMIENTO VISIBLE ✓' : 'REVISAR DIFERENCIAS ✗')
  process.exit(plannerLeaks === 0 && diff === 0 ? 0 : 1)
}

if (MODE !== 'capture') { console.error('Uso: capture <label> | compare <a.json> <b.json>'); process.exit(2) }
const LABEL = process.argv[3] || 'run'

// ── Sesión QA real → cookie SSR (sb-<ref>-auth-token, base64url, chunked) ─────────────────────────────
const URL0 = envLocal('NEXT_PUBLIC_SUPABASE_URL')!
const ANON = envLocal('NEXT_PUBLIC_SUPABASE_ANON_KEY')!
const ref = new URL(URL0).host.split('.')[0]
if (!existsSync('.auth/qa-credentials.json')) { console.error('Falta .auth/qa-credentials.json → ejecuta node scripts/p70-create-qa-session.mjs'); process.exit(2) }
const creds = JSON.parse(readFileSync('.auth/qa-credentials.json', 'utf8')) as { email: string; password: string }
const authClient = createClient(URL0, ANON, { auth: { persistSession: false } })
const { data: signed, error: signErr } = await authClient.auth.signInWithPassword({ email: creds.email, password: creds.password })
if (signErr || !signed.session) { console.error('signIn QA falló:', String(signErr?.message ?? '').slice(0, 60)); process.exit(1) }
const sessionJson = JSON.stringify(signed.session)
const encoded = 'base64-' + Buffer.from(sessionJson, 'utf8').toString('base64url')
const CHUNK = 3000
const cookies: string[] = []
if (encoded.length <= CHUNK) cookies.push(`sb-${ref}-auth-token=${encoded}`)
else for (let i = 0; i * CHUNK < encoded.length; i++) cookies.push(`sb-${ref}-auth-token.${i}=${encoded.slice(i * CHUNK, (i + 1) * CHUNK)}`)
const COOKIE = cookies.join('; ')

// ── Diag del backend (atribución del build que respondió) ─────────────────────────────────────────────
const diag = await (await fetch(`${BASE}/api/agent/diag`, { signal: AbortSignal.timeout(15_000) })).json() as Record<string, unknown>
console.log(`\nCAPTURA «${LABEL}» · ${BASE}\n  build: toolVersion=${diag.toolVersion} generalSemanticPlanner=${diag.generalSemanticPlanner ?? '(AUSENTE = V1/P71)'}\n`)

// ── Batería determinista (solo LECTURAS; nombres QA dinámicos) ────────────────────────────────────────
const svc = createClient(URL0, envLocal('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const { data: cli } = await svc.from('clients').select('name').eq('workspace_id', WS).is('deleted_at', null).order('lead_score', { ascending: false }).limit(1)
const C = String(cli?.[0]?.name ?? 'cliente')
const BATTERY = [
  'hola, buenos días',
  '¿cuántos clientes tengo?',
  `dame la ficha completa de ${C}`,
  '¿qué citas tengo esta semana?',
  '¿cuántos inmuebles hay en la cartera?',
  '¿qué tareas tengo pendientes?',
  '¿qué puedes hacer por mí?',
  '¿cuánto llevo generado en comisiones este mes?',
  'enséñame las operaciones ganadas',
  '¿se pueden cambiar los precios de los pisos desde aquí?',
]

const turns: TurnRecord[] = []
for (const message of BATTERY) {
  // Ritmo bajo el rate limit del asistente (10/min por usuario): 7s entre turnos → nunca guard_rate_limited.
  if (turns.length > 0) await new Promise((r) => setTimeout(r, 7000))
  const r = await fetch(`${BASE}/api/assistant/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(60_000),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ _err: String(e?.message ?? e) }) }) as unknown as Response)
  const j = await r.json().catch(() => ({})) as Record<string, unknown>
  const answer = String(j.answer ?? '')
  const rec: TurnRecord = {
    message,
    status: r.status,
    ok: Boolean(j.ok),
    errorCode: (j.errorCode as string | null) ?? null,
    debugSource: (j.debugSource as string | null) ?? null,
    mode: (j.mode as string | null) ?? null,
    toolCalls: Array.isArray(j.toolCalls) ? (j.toolCalls as string[]) : null,
    hasPreparedAction: j.preparedAction != null,
    assistantArchitecture: (j.assistantArchitecture as string | null) ?? null,
    featureFlagState: (j.featureFlagState as string | null) ?? null,
    answerLen: answer.length,
    answerDigest: answer.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80),
  }
  turns.push(rec)
  console.log(`  [${rec.status}] «${message.slice(0, 44).padEnd(44)}» → ${rec.debugSource}/${rec.mode} tools=${(rec.toolCalls ?? []).join(',') || '-'}${rec.assistantArchitecture ? ` ⚠ arch=${rec.assistantArchitecture}` : ''}`)
}

mkdirSync(OUTDIR, { recursive: true })
const out = `${OUTDIR}/${LABEL}.json`
writeFileSync(out, JSON.stringify({ label: LABEL, base: BASE, capturedAt: new Date().toISOString(), diag: { toolVersion: diag.toolVersion, generalSemanticPlanner: diag.generalSemanticPlanner ?? null, commit: diag.commit }, turns }, null, 1))
console.log(`\nGuardado: ${out} · turnos=${turns.length} · planner visible al usuario: ${turns.filter((t) => t.debugSource === 'general_planner' || t.assistantArchitecture).length} (debe ser 0 salvo ON)`)
process.exit(0)
