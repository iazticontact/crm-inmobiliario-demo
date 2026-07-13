// POST /api/agent/automation (P67) — inteligencia proactiva. Server-to-server (x-nowcrm-secret, mismo
// modelo que /api/agent/tool). Operaciones: run_data_quality (detecta + persiste con dedupe por
// fingerprint), list_findings, resolve_finding. NUNCA modifica datos de negocio; solo findings.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import { detectFindings, persistFindings } from '@/lib/agents/findings-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function err(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: code, message }, { status })
}

export async function POST(req: Request) {
  const secret = process.env.AGENT_TOOL_SECRET
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret || !url || !serviceKey) return err(503, 'endpoint_disabled', 'Config incompleta.')
  const header = req.headers.get('x-nowcrm-secret')
  if (!header || Buffer.from(header).length !== Buffer.from(secret).length || !timingSafeEqual(Buffer.from(header), Buffer.from(secret))) {
    return err(401, 'unauthorized', 'Credencial inválida.')
  }
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err(400, 'invalid_json', 'Body inválido.') }
  const ws = String(body.workspace_id ?? '')
  if (!UUID_RE.test(ws)) return err(400, 'invalid_workspace', 'workspace_id requerido.')
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
  const op = String(body.operation ?? '')

  if (op === 'run_data_quality') {
    const findings = await detectFindings(supabase, ws)
    const { created, duplicates } = await persistFindings(supabase, ws, findings)
    const { data: open } = await supabase.from('assistant_findings')
      .select('finding_type, title, summary, severity, status, detected_at')
      .eq('workspace_id', ws).eq('status', 'open').order('severity').order('detected_at', { ascending: false }).limit(20)
    return NextResponse.json({ ok: true, operation: op, detected: findings.length, created, duplicates, open_findings: open ?? [] })
  }
  if (op === 'list_findings') {
    const { data } = await supabase.from('assistant_findings')
      .select('id, finding_type, title, summary, severity, status, detected_at')
      .eq('workspace_id', ws).eq('status', 'open').order('severity').order('detected_at', { ascending: false }).limit(50)
    return NextResponse.json({ ok: true, operation: op, findings: data ?? [] })
  }
  if (op === 'resolve_finding') {
    const id = String(body.finding_id ?? '')
    if (!UUID_RE.test(id)) return err(422, 'invalid_input', 'finding_id requerido.')
    const { data } = await supabase.from('assistant_findings')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id).eq('workspace_id', ws).in('status', ['open', 'acknowledged']).select('id')
    if (!data?.length) return err(404, 'finding_not_found', 'No hay finding abierto con ese id.')
    return NextResponse.json({ ok: true, operation: op, finding_id: id, status: 'resolved' })
  }
  return err(400, 'invalid_operation', 'operation debe ser run_data_quality|list_findings|resolve_finding.')
}
