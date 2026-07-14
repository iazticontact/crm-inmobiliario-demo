// P70 Wave B — fixtures QA y cleanup para los E2E de UI. Service role SOLO aquí (proceso de test
// local, mismo modelo que scripts/p66-chat-action-e2e.mts); nunca en el navegador. No imprime secretos.

import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const QA_WORKSPACE = 'd0000000-0000-4000-8000-000000000001'
export const QA_PROPERTY_TITLE = '%San Pedro 66%'

export function envLocal(name: string): string | undefined {
  try {
    for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && m[1] === name) {
        let v = m[2]
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        return v
      }
    }
  } catch { /* noop */ }
  return undefined
}

let client: SupabaseClient | null = null
export function serviceClient(): SupabaseClient {
  if (!client) {
    const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
    const key = envLocal('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local')
    client = createClient(url, key, { auth: { persistSession: false } })
  }
  return client
}

export async function getQaProperty(): Promise<{ id: string; title: string; price: number }> {
  const { data } = await serviceClient().from('properties')
    .select('id, title, price')
    .eq('workspace_id', QA_WORKSPACE).ilike('title', QA_PROPERTY_TITLE).is('deleted_at', null).maybeSingle()
  if (!data) throw new Error('No existe el inmueble QA (San Pedro 66) en el workspace demo')
  return { id: String(data.id), title: String(data.title), price: Number(data.price) }
}

export async function getPropertyPrice(id: string): Promise<number> {
  const { data } = await serviceClient().from('properties').select('price').eq('id', id).maybeSingle()
  return Number(data?.price)
}

export async function restorePropertyPrice(id: string, price: number): Promise<void> {
  await serviceClient().from('properties').update({ price }).eq('id', id).eq('workspace_id', QA_WORKSPACE)
}

/** Cancela (server-side) las pending actions del workspace QA para que un test no herede previews de otro.
 * Nota: assistant_actions NO tiene columna updated_at (verificado); solo se toca status. */
export async function expirePendingActions(): Promise<void> {
  const { error } = await serviceClient().from('assistant_actions')
    .update({ status: 'cancelled' })
    .eq('workspace_id', QA_WORKSPACE).eq('status', 'prepared')
  if (error) throw new Error(`expirePendingActions falló: ${error.message}`)
}

/** Borra reglas de automatización creadas por el test (y sus runs), identificadas por fecha de inicio. */
export async function cleanupAutomationRules(createdAfterIso: string): Promise<void> {
  const supabase = serviceClient()
  const { data: rules } = await supabase.from('assistant_automation_rules')
    .select('id').eq('workspace_id', QA_WORKSPACE).gte('created_at', createdAfterIso)
  for (const r of rules ?? []) {
    await supabase.from('assistant_automation_runs').delete().eq('rule_id', r.id)
    await supabase.from('assistant_automation_rules').delete().eq('id', r.id)
  }
}

/** Borra los hilos QA creados durante el test (título por defecto o generado), por fecha de inicio. */
export async function cleanupQaThreads(createdAfterIso: string, qaUserId?: string): Promise<void> {
  const supabase = serviceClient()
  let q = supabase.from('assistant_threads').select('id').eq('workspace_id', QA_WORKSPACE).gte('created_at', createdAfterIso)
  if (qaUserId) q = q.eq('user_id', qaUserId)
  const { data: threads } = await q
  for (const t of threads ?? []) {
    await supabase.from('assistant_threads').delete().eq('id', t.id)
  }
}

export function qaUserId(): string | undefined {
  try { return String(JSON.parse(readFileSync('.auth/qa-session.json', 'utf8')).user_id) } catch { return undefined }
}
