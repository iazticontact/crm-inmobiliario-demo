#!/usr/bin/env node
// Runner for the Agent V2 CRM eval suite (docs/evals/agent-v2-crm-evals.json).
//
// Usage:
//   node docs/evals/run-agent-evals.mjs [--limit N] [--category cat] [--json]
//
// Env (server-side only — NEVER hardcode secrets here):
//   N8N_ASSISTANT_V2_WEBHOOK_URL   (or N8N_BASE_URL -> +/webhook/crm-agent-v2)
//   N8N_ASSISTANT_V2_SECRET        (sent as x-nowcrm-agent-secret)
//   EVAL_WORKSPACE_ID              (defaults to the demo workspace)
//   EVAL_USER_ID                   (defaults to "eval-user")
//
// Safety:
//   - DRY-RUN automatically when URL/secret are missing: prints the plan and
//     per-category counts, calls nothing, exits 0.
//   - Redacts DNI / email / phone from every printed reply.
//   - Never prints the secret. Failures show the matched forbidden pattern only.
//
// Pass/fail is heuristic (forbidden patterns + expect_contains). It flags
// regressions; a human still reviews borderline replies.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const suite = JSON.parse(readFileSync(join(__dirname, 'agent-v2-crm-evals.json'), 'utf8'))

const args = process.argv.slice(2)
const getArg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const limit = Number(getArg('--limit') || 0)
const onlyCat = getArg('--category')
const asJson = args.includes('--json')

const baseUrl = process.env.N8N_ASSISTANT_V2_WEBHOOK_URL?.trim()
  || (process.env.N8N_BASE_URL?.trim() ? process.env.N8N_BASE_URL.trim().replace(/\/$/, '') + '/webhook/crm-agent-v2' : '')
const secret = process.env.N8N_ASSISTANT_V2_SECRET?.trim() || ''
const workspaceId = process.env.EVAL_WORKSPACE_ID?.trim() || 'd0000000-0000-4000-8000-000000000001'
const userId = process.env.EVAL_USER_ID?.trim() || 'eval-user'
const dryRun = !baseUrl || !secret

let cases = suite.cases
if (onlyCat) cases = cases.filter((c) => c.category === onlyCat)
if (limit > 0) cases = cases.slice(0, limit)

function redact(s) {
  return String(s || '')
    .replace(/\b\d{7,8}[A-Za-z]\b/g, '<DNI>')
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, '<email>')
    .replace(/\b(?:\+?34[\s-]?)?[6-9]\d{8}\b/g, '<tel>')
}

const globalForbidden = suite.global_forbidden || []

// Built-in value checks (regex lives here, not in JSON, to avoid escaping
// pitfalls). The assistant must never reveal an internal lead-score VALUE
// (a score word followed by a number) nor an internal UUID.
const SCORE_VALUE_RE = /(lead\s*score|puntuaci\w*)[^.\n]{0,30}\d/i
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// Accent-insensitive normalization so ASCII patterns match accented Spanish
// replies (e.g. "en que" matches "en qué").
const noAccents = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function checkForbidden(reply, extra = []) {
  const flat = noAccents(reply)
  for (const pat of [...globalForbidden, ...extra]) {
    let hit = false
    try { hit = new RegExp(noAccents(pat), 'i').test(flat) } catch { hit = flat.includes(noAccents(pat)) }
    if (hit) return pat
  }
  if (SCORE_VALUE_RE.test(reply)) return 'score_value_revealed'
  if (UUID_RE.test(reply)) return 'uuid_revealed'
  return null
}

if (dryRun) {
  const byCat = {}
  for (const c of suite.cases) byCat[c.category] = (byCat[c.category] || 0) + 1
  console.log('DRY-RUN (no N8N_ASSISTANT_V2_WEBHOOK_URL / N8N_ASSISTANT_V2_SECRET set)')
  console.log(`suite: ${suite.meta?.name} · ${suite.cases.length} cases · ${Object.keys(byCat).length} categories`)
  console.log('categories:', JSON.stringify(byCat))
  console.log(`would run ${cases.length} case(s) against the n8n webhook.`)
  process.exit(0)
}

async function callAgent(prompt, threadId, activeEntity) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 60_000)
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nowcrm-agent-secret': secret },
      body: JSON.stringify({
        message: prompt, workspaceId, userId, threadId,
        activeEntity: activeEntity || null, recentMessages: [], requestId: threadId,
      }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) return { error: `http_${res.status}` }
    const data = await res.json().catch(() => ({}))
    return {
      reply: typeof data.reply === 'string' ? data.reply : (typeof data.output === 'string' ? data.output : ''),
      activeEntityUpdate: data.activeEntityUpdate || null,
    }
  } catch (e) {
    clearTimeout(t)
    return { error: e?.name === 'AbortError' ? 'timeout' : 'fetch_failed' }
  }
}

// Faithful simulation of /api/assistant/v2 working memory (per thread), so a
// multi-turn chain (Oier -> su DNI -> busca Laura -> vuelve al anterior) can be
// certified against the live agent WITHOUT the CRM being redeployed. The route
// persists activeEntityUpdate per type and recalls it next turn; we do the same.
const threadMem = {}
function buildActiveEntity(threadId, explicit) {
  if (explicit) return explicit
  const m = threadMem[threadId]
  if (!m) return null
  if (m.client) return { ...m.client, previous: m.previousClient || undefined, recent: m.recent || undefined }
  return m.recent || null
}
function updateMem(threadId, aeu) {
  if (!aeu || !aeu.id || !aeu.type) return
  const m = threadMem[threadId] || (threadMem[threadId] = { client: null, previousClient: null, recent: null })
  const ent = { type: aeu.type, id: aeu.id, label: aeu.label }
  if (aeu.type === 'client') {
    if (m.client && m.client.id !== ent.id) m.previousClient = m.client
    m.client = ent
  } else {
    m.recent = ent
  }
}

// Unique-per-run thread suffix so n8n Window Memory is FRESH each run (no
// cross-run pollution) while staying shared within a run for a given c.thread.
const RUN = Date.now().toString(36)
const results = []
let pass = 0, fail = 0
for (const c of cases) {
  const threadId = `${c.thread || `eval-${c.id}`}-${RUN}`
  const ae = buildActiveEntity(threadId, c.activeEntity)
  const r = await callAgent(c.prompt, threadId, ae)
  if (r.error) {
    fail++; results.push({ id: c.id, category: c.category, status: 'ERROR', detail: r.error })
    if (!asJson) console.log(`✗ ${c.id} [${c.category}] ERROR ${r.error}`)
    continue
  }
  updateMem(threadId, r.activeEntityUpdate) // simulate route persistence for the next turn
  const reply = r.reply || ''
  const forbiddenHit = checkForbidden(reply, c.forbidden || [])
  const missingContains = (c.expect_contains || []).filter((k) => !noAccents(reply).includes(noAccents(k)))
  // optional: assert the entity the agent resolved (the thing the route persists)
  let activeMiss = null
  if (c.expect_active) {
    const a = r.activeEntityUpdate
    if (!a) activeMiss = 'no_active'
    else if (c.expect_active.type && a.type !== c.expect_active.type) activeMiss = `type=${a.type}`
    else if (c.expect_active.labelIncludes && !String(a.label || '').toLowerCase().includes(c.expect_active.labelIncludes.toLowerCase())) activeMiss = `label=${a.label}`
  }
  if (c.expect_active_null && r.activeEntityUpdate) activeMiss = `unexpected_active=${r.activeEntityUpdate.type}`
  const ok = !forbiddenHit && missingContains.length === 0 && !activeMiss && reply.trim().length > 0
  if (ok) { pass++; if (!asJson) console.log(`✓ ${c.id} [${c.category}]`) }
  else {
    fail++
    const why = forbiddenHit ? `forbidden:${forbiddenHit}` : (missingContains.length ? `missing:${missingContains.join(',')}` : (activeMiss ? `active:${activeMiss}` : 'empty'))
    if (!asJson) console.log(`✗ ${c.id} [${c.category}] ${why} :: ${redact(reply).slice(0, 120)}`)
  }
  results.push({ id: c.id, category: c.category, status: ok ? 'PASS' : 'FAIL', reply: redact(reply).slice(0, 160) })
}

if (asJson) console.log(JSON.stringify({ pass, fail, total: cases.length, results }, null, 2))
else console.log(`\n=== ${pass}/${cases.length} passed, ${fail} failed ===`)
process.exit(fail > 0 ? 1 : 0)
