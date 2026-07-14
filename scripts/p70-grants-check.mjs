#!/usr/bin/env node
// P70 Wave C — CHECK PERMANENTE de grants efectivos con sesión `authenticated` REAL.
//
// Origen: bug real cazado por Playwright en Wave B — las policies RLS existían pero faltaba el
// GRANT SELECT de tabla, y el select fallaba en silencio. Este check inicia sesión con el usuario QA
// (anon key + password de .auth/, NUNCA service role) y prueba un SELECT real sobre cada tabla que la
// UI o executeUiAction leen con la sesión del usuario. Si un grant desaparece, esto falla en rojo.
// Uso: node scripts/p70-grants-check.mjs

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function envLocal(name) {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined
}
const URL = envLocal('NEXT_PUBLIC_SUPABASE_URL')
const ANON = envLocal('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? envLocal('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
if (!URL || !ANON) { console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / ANON KEY en .env.local'); process.exit(2) }
if (!existsSync('.auth/qa-credentials.json')) { console.error('Falta .auth/qa-credentials.json — ejecuta: node scripts/p70-create-qa-session.mjs'); process.exit(2) }
const creds = JSON.parse(readFileSync('.auth/qa-credentials.json', 'utf8'))

const client = createClient(URL, ANON, { auth: { persistSession: false } })
const { data: session, error: signErr } = await client.auth.signInWithPassword({ email: creds.email, password: creds.password })
if (signErr || !session?.session) { console.error('No pude iniciar sesión QA:', String(signErr?.message ?? '').slice(0, 60)); process.exit(1) }
const asUser = createClient(URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${session.session.access_token}` } } })

// Tablas que se LEEN con la sesión del usuario (UI, executeUiAction, findings center, threads).
const TABLES = [
  'clients', 'properties', 'tasks', 'calendar_events', 'opportunities', 'service_cases',
  'assistant_threads', 'assistant_messages',
  'assistant_actions', 'assistant_findings', 'assistant_automation_rules', 'assistant_automation_runs',
]

let pass = 0, fail = 0
for (const t of TABLES) {
  const { error } = await asUser.from(t).select('id', { head: true, count: 'exact' }).limit(1)
  if (error) { fail++; console.log(`FAIL  SELECT authenticated en ${t}: ${String(error.message).slice(0, 80)}`) }
  else { pass++; console.log(`PASS  SELECT authenticated en ${t}`) }
}

// Facturación: el asistente NO la toca; si la tabla existe, este check solo documenta el aislamiento
// (no exige grant ni su ausencia — el aislamiento se impone en el motor, no en el grant de la UI).

console.log(`\nP70 GRANTS CHECK: ${pass}/${pass + fail} ${fail ? 'CON FALLOS' : 'TODO PASS'}`)
process.exit(fail ? 1 : 0)
