// Facturación — capa de datos de navegador (P34). SIN service_role: usa el cliente autenticado y la RLS
// (P33) garantiza el aislamiento por workspace y rol. Reutiliza calc (P33), el generador PDF sin deps
// (invoice-pdf) y entity-files (upload + signed URLs). SIN n8n, SIN emails, SIN acciones del Asistente.

import { getSupabaseBrowserClient } from '@/lib/supabase'
import { getWorkspaceSettings } from '@/lib/workspace-settings'
import { uploadEntityFile, signedUrls } from '@/lib/entity-files'
import { calcLineTotals, calculateInvoiceTotals } from './calc'
import { reserveInvoiceNumber, validateInvoicePayload } from './invoice-service'
import { buildInvoicePdfBytes } from './invoice-pdf'
import type { CustomerSnapshot, FiscalSnapshot, InvoiceItem, IssuerSnapshot, InvoiceStatus } from './types'

export type InvoiceFormItem = {
  id?: string
  description: string
  quantity: number
  unitPrice: number
  discountRate: number
  taxRate: number
  withholdingRate: number
  sortOrder: number
}

export type InvoiceFormData = {
  clientId: string | null
  propertyId: string | null
  opportunityId: string | null
  series: string
  issueDate: string
  dueDate: string | null
  currency: string
  notes: string
  internalNotes: string
  items: InvoiceFormItem[]
}

export type InvoiceListRow = {
  id: string
  display: string | null
  status: InvoiceStatus
  issueDate: string
  dueDate: string | null
  currency: string
  total: number
  clientName: string
  hasPdf: boolean
}

export type ClientLite = { id: string; name: string; snapshot: CustomerSnapshot }

function meta(m: unknown): Record<string, unknown> {
  return m && typeof m === 'object' ? (m as Record<string, unknown>) : {}
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

function mapError(code: string): string {
  if (code.includes('not_authorized_to_invoice')) return 'No tienes permiso para emitir facturas en esta cuenta.'
  if (code.includes('not_a_member')) return 'No perteneces a esta cuenta.'
  if (code.includes('not_authenticated')) return 'Sesión no válida. Vuelve a iniciar sesión.'
  return 'No se pudo completar la operación. Inténtalo de nuevo.'
}

// Datos del emisor desde la Configuración de empresa (workspace_settings). Sin inventar: null = No consta.
export async function loadIssuerSnapshot(workspaceId: string): Promise<IssuerSnapshot> {
  const s = await getWorkspaceSettings(workspaceId).catch(() => null)
  const m = meta(s?.metadata)
  return {
    legalName: s?.business_name ?? str(m.company_name) ?? str(m.business_name),
    taxId: str(m.tax_id) ?? str(m.cif) ?? str(m.nif),
    address: str(m.address),
    email: str(m.email) ?? str(m.billing_email),
    phone: str(m.phone),
    website: str(m.website) ?? str(m.web),
    logoUrl: str(m.company_logo_url),
  }
}

export async function loadClientsLite(workspaceId: string): Promise<ClientLite[]> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, email, phone, metadata')
    .eq('workspace_id', workspaceId).is('deleted_at', null)
    .order('name', { ascending: true }).limit(500)
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((c) => {
    const m = meta(c.metadata)
    return {
      id: String(c.id),
      name: str(c.name) ?? 'Cliente',
      snapshot: {
        clientId: String(c.id),
        name: str(c.name),
        taxId: str(m.document_id) ?? str(m.tax_id) ?? str(m.nif),
        email: str(c.email),
        phone: str(c.phone),
        address: str(m.address),
        country: str(m.nationality) ?? str(m.country),
        language: str(m.preferred_language),
      },
    }
  })
}

function totalsFor(items: InvoiceFormItem[]) {
  return calculateInvoiceTotals(items.map((i) => ({
    quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, withholdingRate: i.withholdingRate, discountRate: i.discountRate,
  })))
}

async function persistItems(workspaceId: string, invoiceId: string, items: InvoiceFormItem[]) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('sin sesión')
  await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId).eq('workspace_id', workspaceId)
  if (!items.length) return
  const rows = items.map((i, idx) => {
    const l = calcLineTotals({ quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, withholdingRate: i.withholdingRate, discountRate: i.discountRate })
    return {
      invoice_id: invoiceId, workspace_id: workspaceId, description: i.description ?? '',
      quantity: i.quantity, unit_price: i.unitPrice, discount_rate: i.discountRate, tax_rate: i.taxRate, withholding_rate: i.withholdingRate,
      line_subtotal: l.lineSubtotal, line_tax_total: l.lineTaxTotal, line_withholding_total: l.lineWithholdingTotal, line_total: l.lineTotal,
      sort_order: i.sortOrder ?? idx,
    }
  })
  const { error } = await supabase.from('invoice_items').insert(rows)
  if (error) throw new Error(error.message)
}

export async function saveDraft(workspaceId: string, form: InvoiceFormData, existingId?: string): Promise<{ id: string } | { error: string }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { error: 'Sin sesión.' }
  const v = validateInvoicePayload({ items: form.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, withholdingRate: i.withholdingRate, discountRate: i.discountRate })), issueDate: form.issueDate, dueDate: form.dueDate })
  if (!v.ok) return { error: v.errors[0] }

  const clients = form.clientId ? await loadClientsLite(workspaceId) : []
  const customer: CustomerSnapshot = clients.find((c) => c.id === form.clientId)?.snapshot ?? { clientId: form.clientId }
  const issuer = await loadIssuerSnapshot(workspaceId)
  const fiscal: FiscalSnapshot = { currency: form.currency || 'EUR', notes: null }
  const t = totalsFor(form.items)

  const base = {
    workspace_id: workspaceId,
    client_id: form.clientId, property_id: form.propertyId, opportunity_id: form.opportunityId,
    series: form.series || 'A',
    issue_date: form.issueDate, due_date: form.dueDate, currency: form.currency || 'EUR',
    subtotal: t.subtotal, tax_total: t.taxTotal, withholding_total: t.withholdingTotal, total: t.total,
    issuer_snapshot: issuer, customer_snapshot: customer, fiscal_snapshot: fiscal,
    notes: form.notes || null, internal_notes: form.internalNotes || null,
  }
  try {
    let id = existingId
    if (id) {
      const { error } = await supabase.from('invoices').update(base).eq('id', id).eq('workspace_id', workspaceId)
      if (error) return { error: mapError(error.message) }
    } else {
      const { data, error } = await supabase.from('invoices').insert({ ...base, status: 'draft' }).select('id').single()
      if (error || !data) return { error: mapError(error?.message ?? 'insert') }
      id = String((data as { id: string }).id)
    }
    await persistItems(workspaceId, id!, form.items)
    return { id: id! }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Error al guardar el borrador.' }
  }
}

export async function loadInvoice(workspaceId: string, id: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null
  const { data: inv } = await supabase.from('invoices').select('*').eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
  if (!inv) return null
  const { data: items } = await supabase.from('invoice_items').select('*').eq('workspace_id', workspaceId).eq('invoice_id', id).order('sort_order', { ascending: true })
  return { invoice: inv as Record<string, unknown>, items: (items ?? []) as unknown as InvoiceItem[] }
}

export async function listInvoices(workspaceId: string, opts: { status?: string; search?: string } = {}): Promise<InvoiceListRow[]> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []
  let q = supabase.from('invoices')
    .select('id, invoice_number_display, status, issue_date, due_date, currency, total, customer_snapshot, pdf_file_id')
    .eq('workspace_id', workspaceId).is('deleted_at', null)
  if (opts.status && opts.status !== 'todas') q = q.eq('status', opts.status)
  const { data, error } = await q.order('issue_date', { ascending: false }).order('created_at', { ascending: false }).limit(200)
  if (error || !data) return []
  const search = (opts.search ?? '').trim().toLowerCase()
  return (data as Record<string, unknown>[])
    .map((r) => ({
      id: String(r.id),
      display: str(r.invoice_number_display),
      status: (r.status as InvoiceStatus) ?? 'draft',
      issueDate: String(r.issue_date),
      dueDate: str(r.due_date),
      currency: str(r.currency) ?? 'EUR',
      total: typeof r.total === 'number' ? r.total : Number(r.total) || 0,
      clientName: str(meta(r.customer_snapshot).name) ?? 'Sin cliente',
      hasPdf: Boolean(r.pdf_file_id),
    }))
    .filter((r) => !search || (r.display ?? '').toLowerCase().includes(search) || r.clientName.toLowerCase().includes(search))
}

// Emisión: reserva atómica del número (RPC) → status issued → PDF → entity-files → pdf_file_id → actividad.
// El número se reserva primero (recurso escaso). Si el PDF fallara después, la factura queda emitida y el
// PDF se puede regenerar (no se pierde ni se duplica el número).
export async function emitInvoice(workspaceId: string, id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { error: 'Sin sesión.' }
  const loaded = await loadInvoice(workspaceId, id)
  if (!loaded) return { error: 'Factura no encontrada.' }
  const { invoice, items } = loaded
  if (invoice.status !== 'draft') return { error: 'Solo se pueden emitir borradores.' }
  if (!items.length) return { error: 'La factura necesita al menos una línea.' }

  const series = String(invoice.series || 'A')
  const issueDate = String(invoice.issue_date)
  const res = await reserveInvoiceNumber(supabase, workspaceId, series, issueDate)
  if ('error' in res) return { error: mapError(res.error) }

  const { error: upErr } = await supabase.from('invoices').update({
    series: res.series, year: res.year, number: res.number, invoice_number_display: res.display, status: 'issued',
  }).eq('id', id).eq('workspace_id', workspaceId)
  if (upErr) return { error: mapError(upErr.message) }

  // PDF + almacenamiento (retryable; el número ya está reservado).
  try {
    const issuer = (invoice.issuer_snapshot ?? {}) as IssuerSnapshot
    const customer = (invoice.customer_snapshot ?? {}) as CustomerSnapshot
    const bytes = buildInvoicePdfBytes({
      display: res.display, status: 'issued', issueDate, dueDate: str(invoice.due_date), currency: str(invoice.currency) ?? 'EUR',
      subtotal: Number(invoice.subtotal) || 0, taxTotal: Number(invoice.tax_total) || 0, withholdingTotal: Number(invoice.withholding_total) || 0, total: Number(invoice.total) || 0,
      notes: str(invoice.notes), issuer, customer,
    }, items)
    const safeName = res.display.replace(/[^\w.-]+/g, '-')
    const file = new File([bytes as BlobPart], `factura-${safeName}.pdf`, { type: 'application/pdf' })
    const ef = await uploadEntityFile({ workspaceId, entityType: 'invoice', entityId: id, file, category: 'document' })
    await supabase.from('invoices').update({ pdf_file_id: ef.id }).eq('id', id).eq('workspace_id', workspaceId)
  } catch {
    // Emitida sin PDF: se puede regenerar. No romper el flujo (número ya asignado).
  }

  await logInvoiceActivity(workspaceId, invoice, `Factura emitida: ${res.display}`)
  return { ok: true }
}

export async function setInvoiceStatus(workspaceId: string, id: string, status: InvoiceStatus): Promise<{ ok: true } | { error: string }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { error: 'Sin sesión.' }
  const { error } = await supabase.from('invoices').update({ status }).eq('id', id).eq('workspace_id', workspaceId)
  if (error) return { error: mapError(error.message) }
  const loaded = await loadInvoice(workspaceId, id)
  if (loaded) await logInvoiceActivity(workspaceId, loaded.invoice, `Factura → ${status}`)
  return { ok: true }
}

export async function getInvoicePdfUrl(workspaceId: string, id: string): Promise<string | null> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null
  const { data } = await supabase.from('invoices').select('pdf_file_id').eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
  const pdfId = (data as { pdf_file_id?: string } | null)?.pdf_file_id
  if (!pdfId) return null
  const { data: ef } = await supabase.from('entity_files').select('path').eq('id', pdfId).maybeSingle()
  const path = (ef as { path?: string } | null)?.path
  if (!path) return null
  const urls = await signedUrls([path], 600)
  return urls[path] ?? null
}

async function logInvoiceActivity(workspaceId: string, invoice: Record<string, unknown>, title: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return
  const { data: userData } = await supabase.auth.getUser()
  await supabase.from('activities').insert({
    workspace_id: workspaceId,
    type: 'invoice',
    title,
    client_id: str(invoice.client_id),
    client_name: str(meta(invoice.customer_snapshot).name),
    entity_type: 'invoice',
    entity_id: str(invoice.id),
    created_by: userData?.user?.id ?? null,
    metadata: { invoice_id: str(invoice.id) },
  }).then(() => {}, () => {})
}
