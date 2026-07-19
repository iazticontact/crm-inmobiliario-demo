// FASE 35 — VERIFICADOR DE DEPLOY del General Planner. Comprueba por HTTP (sin secretos, sin auth) que un
// backend desplegado es la RAMA general-semantic-planner en el modo esperado, y opcionalmente que otro
// backend (producción) sigue siendo V1/P71 (el campo `generalSemanticPlanner` NO existe en V1).
//
// Uso:
//   node scripts/verify-general-planner-deploy.mjs --url https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host --expect shadow
//   node scripts/verify-general-planner-deploy.mjs --url <staging> --expect on --legacy <produccion>
//   node scripts/verify-general-planner-deploy.mjs --url <produccion> --expect absent   # producción sigue V1
//
// --expect: off | shadow | on  → el diag DEBE traer generalSemanticPlanner con ese valor exacto.
//           absent             → el diag NO debe traer el campo (backend V1/P71 legacy).
// --legacy <base>: además verifica que ESA base es V1/P71 (campo ausente) — guardia anti-confusión
//                  staging/producción. Falla si la URL legacy trae el marcador.
// Salida: exit 0 = todo verificado; exit 1 = fallo (con motivo). Nunca imprime secretos (el diag no los da).

const args = process.argv.slice(2)
function argOf(flag) { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : null }
const base = argOf('--url')
const expect = (argOf('--expect') ?? '').toLowerCase()
const legacyBase = argOf('--legacy')

if (!base || !['off', 'shadow', 'on', 'absent'].includes(expect)) {
  console.error('Uso: node scripts/verify-general-planner-deploy.mjs --url <base> --expect off|shadow|on|absent [--legacy <base>]')
  process.exit(1)
}

let failures = 0
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`) }
const ok = (msg) => console.log(`  ✓ ${msg}`)

async function fetchDiag(b) {
  const url = `${b.replace(/\/+$/, '')}/api/agent/diag`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch((e) => ({ ok: false, status: 0, _err: e.message }))
  if (!res.ok) return { url, ok: false, status: res.status ?? 0, err: res._err ?? `http_${res.status}` }
  const j = await res.json().catch(() => null)
  if (!j || typeof j !== 'object') return { url, ok: false, status: res.status, err: 'invalid_json' }
  return { url, ok: true, status: res.status, diag: j }
}

console.log(`\nVERIFICACIÓN DE DEPLOY · target=${base} · expect=${expect}\n`)
const t = await fetchDiag(base)
if (!t.ok) {
  fail(`diag no accesible (${t.err}) en ${t.url}`)
} else {
  ok(`diag accesible (HTTP ${t.status})`)
  const d = t.diag
  console.log(`    service=${d.service} supabaseRef=${d.supabaseRef} commit=${d.commit} toolVersion=${d.toolVersion} generalSemanticPlanner=${d.generalSemanticPlanner ?? '(AUSENTE)'}`)
  if (d.service !== 'agent-tool-backend') fail(`service inesperado: ${d.service}`)
  if (expect === 'absent') {
    if ('generalSemanticPlanner' in d) fail(`se esperaba backend V1/P71 (campo AUSENTE) pero trae generalSemanticPlanner=${d.generalSemanticPlanner}`)
    else ok('backend V1/P71 confirmado (sin marcador de rama)')
  } else {
    if (!('generalSemanticPlanner' in d)) fail('el diag NO trae generalSemanticPlanner → el deploy no cogió la rama general-semantic-planner')
    else if (d.generalSemanticPlanner !== expect) fail(`modo inesperado: generalSemanticPlanner=${d.generalSemanticPlanner} (se esperaba ${expect})`)
    else ok(`marcador de rama presente y en modo esperado: ${expect}`)
  }
  // Nunca debe haber secretos en el diag (defensa: solo booleanos de config y ref público).
  const raw = JSON.stringify(d)
  if (/(sk-[A-Za-z0-9]|service_role[^"]*":\s*"e?y)/.test(raw)) fail('el diag parece exponer material sensible — REVISAR')
  else ok('sin secretos en la respuesta del diag')
}

if (legacyBase) {
  console.log(`\nGUARDIA LEGACY · ${legacyBase} debe seguir siendo V1/P71\n`)
  const l = await fetchDiag(legacyBase)
  if (!l.ok) fail(`diag legacy no accesible (${l.err})`)
  else if ('generalSemanticPlanner' in l.diag) fail(`¡la URL legacy trae generalSemanticPlanner=${l.diag.generalSemanticPlanner}! — atribución de deploy INCORRECTA`)
  else ok(`legacy confirmado V1/P71 (toolVersion=${l.diag.toolVersion}, sin marcador)`)
}

console.log(`\n${failures === 0 ? 'VERIFICACIÓN OK ✓' : `FALLOS: ${failures} ✗`}`)
process.exit(failures === 0 ? 0 : 1)
