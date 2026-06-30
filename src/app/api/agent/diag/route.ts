// /api/agent/diag (P23) — autodiagnóstico SEGURO del backend del Asistente. Sirve para verificar, de
// forma trazable, que el backend DESPLEGADO (al que apunta el `CRM_BASE_URL` de las tools de n8n) es el
// correcto: mismo proyecto Supabase que la UI, commit actual y configuración presente. Y, con el secreto
// del agente, cuántos registros REALES ve ese backend para un workspace concreto — así se distingue
// "no hay datos" de "el backend apunta a otra base / otro workspace".
//
// NUNCA devuelve secretos/keys/URLs completas: solo el ref público del proyecto Supabase, booleanos de
// configuración y conteos. El sondeo por workspace exige el header `x-nowcrm-secret` (= AGENT_TOOL_SECRET).

import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase-admin'
import { TOOL_CONTRACT_VERSION } from '@/lib/agent-tool-readers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Entidades del sondeo: tabla + columna de nombre + columna de fecha (para "última actualización").
const PROBE_ENTITIES: Array<{ key: string; table: string; nameCol: string; dateCol: string }> = [
  { key: 'clients', table: 'clients', nameCol: 'name', dateCol: 'updated_at' },
  { key: 'events', table: 'calendar_events', nameCol: 'title', dateCol: 'updated_at' },
  { key: 'properties', table: 'properties', nameCol: 'title', dateCol: 'updated_at' },
  { key: 'opportunities', table: 'opportunities', nameCol: 'title', dateCol: 'updated_at' },
  { key: 'service_cases', table: 'service_cases', nameCol: 'title', dateCol: 'updated_at' },
  { key: 'tasks', table: 'tasks', nameCol: 'title', dateCol: 'updated_at' },
  { key: 'documents', table: 'documents', nameCol: 'title', dateCol: 'created_at' },
  { key: 'activities', table: 'activities', nameCol: 'title', dateCol: 'created_at' },
]

function clampName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
}

function supabaseRef(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) return null
  try { return new URL(url).host.split('.')[0] || null } catch { return null }
}

function constantTimeMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function GET(req: NextRequest) {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.SOURCE_COMMIT?.trim() ||
    process.env.NEXT_PUBLIC_COMMIT_SHA?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    'unknown'

  const base = {
    ok: true,
    service: 'agent-tool-backend',
    supabaseRef: supabaseRef(),
    commit: commit.slice(0, 12),
    toolVersion: TOOL_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    // Lectura del asistente SIEMPRE fresca: /api/agent/tool y /api/agent/diag son force-dynamic.
    freshness: { agentToolDynamic: true, diagDynamic: true },
    config: {
      agentToolSecret: Boolean(process.env.AGENT_TOOL_SECRET?.trim()),
      serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
      n8nWebhook: Boolean(process.env.N8N_ASSISTANT_V2_WEBHOOK_URL?.trim() || process.env.N8N_BASE_URL?.trim()),
      n8nSecret: Boolean(process.env.N8N_ASSISTANT_V2_SECRET?.trim()),
    },
  }

  // Sondeo por workspace (qué ve REALMENTE el backend) — sólo con el secreto del agente.
  const wsParam = req.nextUrl.searchParams.get('workspace_id')?.trim()
  const provided = req.headers.get('x-nowcrm-secret')?.trim() ?? ''
  const expected = process.env.AGENT_TOOL_SECRET?.trim() ?? ''
  if (wsParam) {
    if (!expected || !provided || !constantTimeMatch(provided, expected)) {
      return NextResponse.json({ ...base, workspaceProbe: { error: 'unauthorized' } }, { status: 401 })
    }
    const admin = getSupabaseAdminClient()
    if (!admin) return NextResponse.json({ ...base, workspaceProbe: { error: 'service_unavailable' } }, { status: 503 })
    // Por entidad: count exacto + última actualización + muestra sanitizada de nombres/títulos (sin
    // UUIDs, sin datos sensibles largos). Permite comparar "lo que ve el backend" con la UI.
    const probe = async (e: (typeof PROBE_ENTITIES)[number]) => {
      const { count } = await admin.from(e.table).select('id', { count: 'exact', head: true }).eq('workspace_id', wsParam)
      const { data } = await admin.from(e.table).select(`${e.nameCol}, ${e.dateCol}`).eq('workspace_id', wsParam).order(e.dateCol, { ascending: false, nullsFirst: false }).limit(3)
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
      return {
        count: count ?? 0,
        lastUpdated: rows[0]?.[e.dateCol] ?? null,
        sample: rows.map((r) => clampName(r[e.nameCol])).filter(Boolean),
      }
    }
    const results = await Promise.all(PROBE_ENTITIES.map(async (e) => [e.key, await probe(e)] as const))
    return NextResponse.json({ ...base, workspaceProbe: { workspace_id: wsParam, entities: Object.fromEntries(results) } })
  }

  return NextResponse.json(base)
}
