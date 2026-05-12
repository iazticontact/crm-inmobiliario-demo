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

function buildInvoiceText(invoice: DataRow): string {
  const id = s(invoice.id)
  const number = s(invoice.invoice_number ?? invoice.number, id ? `FAC-${id.slice(0, 8).toUpperCase()}` : 'FAC-000')
  const clientName = s(invoice.client_name, 'Cliente')
  const concept = s(invoice.concept ?? invoice.plan, 'Servicio')
  const amount = n(invoice.amount)
  const currency = s(invoice.currency, 'EUR')
  const status = s(invoice.status, 'pending')
  const statusLabel = status === 'paid' ? 'Pagada' : status === 'overdue' ? 'Vencida' : 'Pendiente'
  const issueDate = s(invoice.issue_date ?? invoice.date, new Date().toISOString().slice(0, 10))
  const dueDate = s(invoice.due_date, issueDate)
  const notes = s(invoice.notes)
  const generatedAt = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })

  return [
    `FACTURA — ${number}\n`,
    `Generada: ${generatedAt}`,
    `\n1. DATOS DE FACTURA`,
    `- Número: ${number}`,
    `- Fecha de emisión: ${issueDate}`,
    `- Vencimiento: ${dueDate}`,
    `- Estado: ${statusLabel}`,
    `\n2. CLIENTE`,
    `- Nombre: ${clientName}`,
    `\n3. CONCEPTO E IMPORTE`,
    `- Concepto: ${concept}`,
    `- Importe: ${amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
    notes ? `\n4. NOTAS\n- ${notes}` : '',
    `\n---\nDocumento generado por NowCRM. Pendiente de firma electrónica real.`,
  ].filter(Boolean).join('\n')
}

export async function POST(request: Request) {
  let body: DataRow
  try {
    body = await request.json() as DataRow
  } catch {
    return NextResponse.json({ ok: false, error: 'Payload JSON inválido' }, { status: 400 })
  }

  const invoiceId = s(body.invoiceId)
  const workspaceId = s(body.workspaceId)
  if (!invoiceId || !workspaceId) {
    return NextResponse.json({ ok: false, error: 'invoiceId y workspaceId son obligatorios' }, { status: 400 })
  }

  const supabase = getClient()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase no configurado en el servidor' }, { status: 503 })
  }

  try {
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', invoiceId)
      .maybeSingle()

    if (invoiceError) throw invoiceError
    if (!invoice) return NextResponse.json({ ok: false, error: 'Factura no encontrada' }, { status: 404 })

    const inv = invoice as DataRow
    const invoiceText = buildInvoiceText(inv)
    const id = s(inv.id)
    const number = s(inv.invoice_number ?? inv.number, id ? `FAC-${id.slice(0, 8).toUpperCase()}` : 'FAC-000')
    const clientName = s(inv.client_name, 'Cliente')
    const safeNumber = number.replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const title = `Factura ${number} — ${clientName}`

    return NextResponse.json({
      ok: true,
      invoiceId,
      clientName,
      invoiceNumber: number,
      invoiceText,
      title,
      storageBucket: 'facturas-pdf',
      storagePath: `${workspaceId}/invoices/${safeNumber}-${Date.now()}.txt`,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Error desconocido')
    if (process.env.NODE_ENV === 'development') console.error('[/api/reports/invoice]', error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
