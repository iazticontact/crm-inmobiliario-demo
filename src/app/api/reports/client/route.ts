import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type DataRow = Record<string, unknown>

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function s(v: unknown, fb = '') { return typeof v === 'string' && v.trim() ? v.trim() : fb }
function n(v: unknown, fb = 0) { const p = Number(v); return Number.isFinite(p) ? p : fb }

function buildReportText(
  client: DataRow,
  invoices: DataRow[],
  events: DataRow[],
  conversations: DataRow[],
  activities: DataRow[]
): string {
  const name = s(client.name, 'CLIENTE')
  const createdAt = s(client.created_at)
  const fechaRegistro = createdAt
    ? (() => { try { return new Date(createdAt).toLocaleDateString('es-ES') } catch { return 'No consta' } })()
    : 'No consta'
  const generatedAt = new Date().toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return [
    `INFORME DE CLIENTE — ${name.toUpperCase()}\n`,
    `Generado: ${generatedAt}`,
    `\n1. DATOS BÁSICOS`,
    `- Nombre: ${s(client.name, 'No consta')}`,
    `- Empresa: ${s(client.company, 'No consta')}`,
    `- Email: ${s(client.email, 'No consta')}`,
    `- Teléfono: ${s(client.phone, 'No consta')}`,
    `- Canal: ${s(client.channel, 'No consta')}`,
    `- Fecha de registro: ${fechaRegistro}`,
    `\n2. ESTADO COMERCIAL`,
    `- Estado: ${s(client.status, 'No consta')}`,
    `- Lead Score: ${n(client.lead_score) || 'No consta'}`,
    `- Notas: ${s(client.notes, 'No consta')}`,
    `\n3. FACTURAS`,
    invoices.length
      ? invoices.map((i) => `- ${s(i.concept ?? i.plan, 'Concepto')}: ${n(i.amount)}€ (${s(i.status)}) vence ${s(i.due_date)}`).join('\n')
      : '- No hay facturas registradas',
    `\n4. CITAS Y CALENDARIO`,
    events.length
      ? events.map((e) => `- ${s(e.title, 'Evento')} el ${s(e.date)} a las ${String(n(e.start_hour, 10)).padStart(2, '0')}:${String(n(e.start_minute, 0)).padStart(2, '0')} (${n(e.duration, 60)} min)`).join('\n')
      : '- No hay citas registradas',
    `\n5. CONVERSACIONES`,
    conversations.length
      ? conversations.map((c) => `- ${s(c.ai_summary ?? c.last_message, 'Sin mensaje')} (${s(c.sentiment, 'neutral')})`).join('\n')
      : '- No hay conversaciones registradas',
    `\n6. ACTIVIDAD RECIENTE`,
    activities.length
      ? activities.slice(0, 5).map((a) => `- [${s(a.type)}] ${s(a.description)}`).join('\n')
      : '- No hay actividades registradas',
    `\n7. PRÓXIMA ACCIÓN RECOMENDADA`,
    s(client.status) === 'lead'
      ? '→ Contactar para convertir en cliente activo'
      : s(client.status) === 'active'
        ? '→ Revisar facturas pendientes y próximas citas'
        : '→ Sin acción inmediata recomendada',
  ].filter(Boolean).join('\n')
}

export async function POST(request: Request) {
  let body: DataRow
  try {
    body = await request.json() as DataRow
  } catch {
    return NextResponse.json({ ok: false, error: 'Payload JSON inválido' }, { status: 400 })
  }

  const clientId = s(body.clientId)
  const workspaceId = s(body.workspaceId)
  if (!clientId || !workspaceId) {
    return NextResponse.json({ ok: false, error: 'clientId y workspaceId son obligatorios' }, { status: 400 })
  }

  const supabase = getClient()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase no configurado en el servidor' }, { status: 503 })
  }

  try {
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', clientId)
      .maybeSingle()

    if (clientError) throw clientError
    if (!client) return NextResponse.json({ ok: false, error: 'Cliente no encontrado' }, { status: 404 })

    const clientName = s((client as DataRow).name, 'Cliente')

    const [invoicesRes, eventsRes, convRes, activitiesRes] = await Promise.all([
      supabase.from('invoices').select('*').eq('workspace_id', workspaceId)
        .or(`client_id.eq.${clientId},client_name.eq.${clientName}`).limit(20),
      supabase.from('calendar_events').select('*').eq('workspace_id', workspaceId)
        .or(`client_id.eq.${clientId},client_name.eq.${clientName}`).limit(20),
      supabase.from('conversations').select('*').eq('workspace_id', workspaceId)
        .eq('client_id', clientId).limit(20),
      supabase.from('activities').select('*').eq('workspace_id', workspaceId)
        .eq('client_name', clientName).limit(10),
    ])

    const reportText = buildReportText(
      client as DataRow,
      (invoicesRes.data ?? []) as DataRow[],
      (eventsRes.data ?? []) as DataRow[],
      (convRes.data ?? []) as DataRow[],
      (activitiesRes.data ?? []) as DataRow[]
    )

    const title = `Informe de ${clientName}`
    return NextResponse.json({
      ok: true,
      clientId,
      clientName,
      reportText,
      title,
      storageBucket: 'informes-pdf',
      storagePath: `${workspaceId}/reports/${clientId}-${Date.now()}.txt`,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Error desconocido')
    if (process.env.NODE_ENV === 'development') console.error('[/api/reports/client]', error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
