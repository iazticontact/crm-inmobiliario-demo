import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { generateInvoicePdfBytes } from '@/lib/pdf/simple-pdf'

export const runtime = 'nodejs'

type DataRow = Record<string, unknown>

async function buildSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { /* static */ }
      },
    },
  })
}

function s(v: unknown, fb = '') { return typeof v === 'string' && v.trim() ? v.trim() : fb }
function n(v: unknown, fb = 0) { const p = Number(v); return Number.isFinite(p) ? p : fb }
function money(v: unknown) { return n(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

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
    `- Numero: ${number}`,
    `- Fecha de emision: ${issueDate}`,
    `- Vencimiento: ${dueDate}`,
    `- Estado: ${statusLabel}`,
    `\n2. CLIENTE`,
    `- Nombre: ${clientName}`,
    `\n3. CONCEPTO E IMPORTE`,
    `- Concepto: ${concept}`,
    `- Importe: ${money(amount)} ${currency}`,
    notes ? `\n4. NOTAS\n- ${notes}` : '',
    `\n---\nDocumento generado por NowCRM. Pendiente de firma electronica real.`,
  ].filter(Boolean).join('\n')
}

export async function POST(request: Request) {
  let body: DataRow
  try {
    body = await request.json() as DataRow
  } catch {
    return NextResponse.json({ ok: false, error: 'Payload JSON invalido' }, { status: 400 })
  }

  const invoiceId = s(body.invoiceId)
  const format = s(body.format, 'text') === 'pdf' ? 'pdf' : 'text'

  if (!invoiceId) {
    return NextResponse.json({ ok: false, error: 'invoiceId es obligatorio' }, { status: 400 })
  }

  const supabase = await buildSupabase()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase no configurado en el servidor' }, { status: 503 })
  }

  // Workspace is derived from the authenticated session — never trusted from
  // the caller. Any workspaceId in the body is ignored.
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }
  // Profile query is the workspace-isolation gate: a query error here (RLS
  // blocked, table missing, transient DB failure) must NOT silently fall
  // through to 403 "no workspace" — it has to surface as a controlled 500 so
  // support can tell "user has no workspace" apart from "lookup failed".
  // The error message is never propagated to the client.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) {
    if (process.env.NODE_ENV === 'development') console.error('[/api/reports/invoice] profile lookup failed', profileError)
    return NextResponse.json({ ok: false, error: 'No se pudo resolver el workspace' }, { status: 500 })
  }
  const workspaceId = (profile as { workspace_id?: string | null } | null)?.workspace_id
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: 'Sin workspace asignado' }, { status: 403 })
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
    const filename = `factura-${safeNumber}-${Date.now()}.pdf`

    if (format === 'pdf') {
      const pdfBytes = generateInvoicePdfBytes(title, invoiceText)
      return new Response(pdfBytes.buffer as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(pdfBytes.length),
        },
      })
    }

    return NextResponse.json({
      ok: true,
      invoiceId,
      clientName,
      invoiceNumber: number,
      invoiceText,
      title,
      storageBucket: 'facturas-pdf',
      storagePath: `${workspaceId}/invoices/${filename}`,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (process.env.NODE_ENV === 'development') console.error('[/api/reports/invoice]', error)
    // Never leak DB error messages to the client — they can contain table
    // names, column hints or RLS internals.
    return NextResponse.json({ ok: false, error: 'No se pudo generar la factura' }, { status: 500 })
  }
}
