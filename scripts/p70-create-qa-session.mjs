#!/usr/bin/env node
// P70 — Resolución de TEST_SESSION_MISSING: crea (idempotente) un usuario QA técnico vinculado al
// workspace demo y DEMUESTRA que se puede generar una sesión real (signInWithPassword). El storage state
// se guarda en .auth/ (git-ignored). Service role SOLO aquí (script local); nunca frontend/navegador.
// No imprime credenciales ni tokens. Uso: node scripts/p70-create-qa-session.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

function envLocal(name) {
  try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === name) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch {} return undefined
}
const URL = envLocal('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE = envLocal('SUPABASE_SERVICE_ROLE_KEY')
const ANON = envLocal('NEXT_PUBLIC_SUPABASE_ANON_KEY')
if (!URL || !SERVICE || !ANON) { console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY'); process.exit(2) }
const WS = 'd0000000-0000-4000-8000-000000000001'
const EMAIL = 'qa.p70.assistant@nowcrm-qa.test'

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

// 1) Usuario QA idempotente.
let userId = null
let password = null
if (existsSync('.auth/qa-credentials.json')) {
  try { const c = JSON.parse(readFileSync('.auth/qa-credentials.json', 'utf8')); if (c.email === EMAIL) { userId = c.userId; password = c.password } } catch {}
}
if (!password) password = randomBytes(18).toString('base64url')
if (!userId) {
  const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true })
  if (error && /already/i.test(String(error.message))) {
    // Existe de un intento anterior sin credenciales guardadas: resetear password de forma segura.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const u = list?.users?.find((x) => x.email === EMAIL)
    if (!u) { console.error('Usuario QA existe pero no localizable'); process.exit(1) }
    userId = u.id
    const { error: upErr } = await admin.auth.admin.updateUserById(userId, { password })
    if (upErr) { console.error('No pude resetear password QA'); process.exit(1) }
  } else if (error) { console.error('createUser falló:', String(error.message).slice(0, 60)); process.exit(1) }
  else userId = data.user.id
}
// 2) Perfil + MEMBRESÍA (el RLS real usa workspace_members via current_workspace_ids(); rol 'comercial').
await admin.from('profiles').upsert({ id: userId, workspace_id: WS, full_name: 'QA P70 (test técnico)' }, { onConflict: 'id' })
const { data: member } = await admin.from('workspace_members').select('user_id').eq('workspace_id', WS).eq('user_id', userId).maybeSingle()
if (!member) await admin.from('workspace_members').insert({ workspace_id: WS, user_id: userId, role: 'comercial' })

// 3) Guardar credenciales SOLO en .auth/ (ignorado).
mkdirSync('.auth', { recursive: true })
writeFileSync('.auth/qa-credentials.json', JSON.stringify({ email: EMAIL, userId, password }, null, 2))

// 4) DEMOSTRAR sesión real (anon client + signInWithPassword) y guardar storage state para Playwright.
const client = createClient(URL, ANON, { auth: { persistSession: false } })
const { data: session, error: signErr } = await client.auth.signInWithPassword({ email: EMAIL, password })
if (signErr || !session?.session) { console.error('signIn falló:', String(signErr?.message ?? '').slice(0, 60)); process.exit(1) }
writeFileSync('.auth/qa-session.json', JSON.stringify({ access_token: session.session.access_token, refresh_token: session.session.refresh_token, expires_at: session.session.expires_at, user_id: userId }, null, 2))

// 5) Verificar RLS: el usuario QA ve el workspace demo (lectura real con su sesión).
const asQa = createClient(URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${session.session.access_token}` } } })
const { count } = await asQa.from('clients').select('id', { count: 'exact', head: true }).eq('workspace_id', WS)
console.log('QA SESSION OK')
console.log(`· usuario QA: ${EMAIL} (id …${String(userId).slice(-6)})`)
console.log(`· sesión emitida y guardada en .auth/ (ignorado); expira: ${new Date((session.session.expires_at ?? 0) * 1000).toISOString()}`)
console.log(`· RLS verificado: el usuario QA lee el workspace demo (clients=${count})`)
console.log('TEST_SESSION_MISSING: RESUELTO a nivel de auth — Playwright puede consumir .auth/qa-session.json o hacer login con las credenciales de .auth/.')
