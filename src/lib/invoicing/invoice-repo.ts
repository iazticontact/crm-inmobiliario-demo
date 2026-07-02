// Facturación — capa de datos de navegador (P34). SIN service_role: usa el cliente autenticado y la RLS
// (P33) garantiza el aislamiento por workspace y rol. Reutiliza calc (P33), el generador PDF sin deps
// (invoice-pdf) y entity-files (upload + signed URLs). SIN n8n, SIN emails, SIN acciones del Asistente.

import { getSupabaseBrowserClient } from '@/lib/supabase'
import { getWorkspaceSettings } from '@/lib/workspace-settings'
import { uploadEntityFile, signedUrls } from '@/lib/entity-files'
import { calcLineTotals, calculateInvoiceTotals } from './calc'
import { reserveInvoiceNumber, validateInvoicePayload } from './invoice-service'
import { buildInvoicePdfBytes } from './invoice-pdf'
import { computeHonorarios } from './honorarios'
import { urlToJpegBytes } from '@/lib/pdf/image-to-jpeg'
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
  exchangeRateToEur: number | null   // 1 unidad de `currency` = X EUR (EUR → 1/null). Snapshot orientativo.
  exchangeRateSource: string
  exchangeRateDate: string | null
  notes: string
  internalNotes: string
  items: InvoiceFormItem[]
}

export type InvoiceListRow = {
  id: string
  display: string | null
  series: string | null
  status: InvoiceStatus
  issueDate: string
  dueDate: string | null
  currency: string
  exchangeRateToEur: number | null
  subtotal: number
  taxTotal: number
  withholdingTotal: number
  total: number
  clientName: string
  hasPdf: boolean
  updatedAt: string | null
  deletedAt: string | null
  purgedAt: string | null
  accountingExcluded: boolean
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
// P36B FIX: el email se guardaba como `contact_email` (Settings) pero se leía como `email`/`billing_email`
// → salía siempre "No consta". Ahora se leen las claves reales + los campos fiscales nuevos (NIF/dirección/
// CP/ciudad/provincia/país), que la Configuración de empresa persiste en metadata (additivo, sin migración).
export async function loadIssuerSnapshot(workspaceId: string): Promise<IssuerSnapshot> {
  const s = await getWorkspaceSettings(workspaceId).catch(() => null)
  const m = meta(s?.metadata)
  return {
    legalName: s?.business_name ?? str(m.company_name) ?? str(m.business_name),
    taxId: str(m.tax_id) ?? str(m.cif) ?? str(m.nif) ?? str(m.vat),
    address: str(m.fiscal_address) ?? str(m.address),
    postalCode: str(m.postal_code) ?? str(m.zip),
    city: str(m.city),
    province: str(m.province),
    country: str(m.country),
    email: str(m.contact_email) ?? str(m.email) ?? str(m.billing_email),
    phone: str(m.phone),
    website: str(m.website) ?? str(m.web),
    logoUrl: str(m.company_logo_url),
  }
}

// Datos MÍNIMOS para emitir una factura seria (guardrail). Devuelve las etiquetas que faltan.
export function issuerMissingCritical(issuer: IssuerSnapshot): string[] {
  const miss: string[] = []
  if (!str(issuer.legalName)) miss.push('nombre fiscal')
  if (!str(issuer.taxId)) miss.push('NIF/CIF')
  if (!str(issuer.address)) miss.push('dirección fiscal')
  return miss
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

// ── Factura de honorarios desde una operación (P42) ─────────────────────────────────────────────────
export type OpportunityInvoiceLink = { id: string; display: string | null; status: InvoiceStatus }

// Facturas ACTIVAS (no papelera/purgadas) vinculadas a operaciones. Para mostrar estado en Operaciones.
export async function loadInvoiceLinksForOpportunities(workspaceId: string, oppIds: string[]): Promise<Record<string, OpportunityInvoiceLink>> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !oppIds.length) return {}
  const { data } = await supabase.from('invoices')
    .select('id, opportunity_id, invoice_number_display, status, created_at')
    .eq('workspace_id', workspaceId).in('opportunity_id', oppIds)
    .is('deleted_at', null).is('purged_at', null)
    .order('created_at', { ascending: false })
  const out: Record<string, OpportunityInvoiceLink> = {}
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const oid = str(r.opportunity_id)
    if (!oid || out[oid]) continue // la más reciente por operación
    out[oid] = { id: String(r.id), display: str(r.invoice_number_display), status: (r.status as InvoiceStatus) ?? 'draft' }
  }
  return out
}

export type OpportunityPrefill =
  | { existing: OpportunityInvoiceLink }
  | { draft: InvoiceFormData; propertyTitle: string | null; operationTitle: string | null; honorarios: number }
  | { error: string }

// Prellenado de FACTURA DE HONORARIOS desde una operación. NO crea nada: devuelve un borrador editable, o la
// factura ya vinculada (evita duplicados), o un error humano. La base es la COMISIÓN, nunca el precio del
// inmueble (computeHonorarios, mismo modelo que la pantalla de Operaciones).
export async function loadOpportunityInvoicePrefill(workspaceId: string, oppId: string): Promise<OpportunityPrefill> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { error: 'Sin sesión.' }
  const { data: opp } = await supabase.from('opportunities')
    .select('id, client_id, property_id, title, stage, value, commission_rate, metadata')
    .eq('workspace_id', workspaceId).eq('id', oppId).is('deleted_at', null).maybeSingle()
  if (!opp) return { error: 'Operación no encontrada.' }
  const o = opp as Record<string, unknown>

  // Evitar duplicados: ¿ya hay factura vinculada activa?
  const links = await loadInvoiceLinksForOpportunities(workspaceId, [oppId])
  if (links[oppId]) return { existing: links[oppId] }

  const clientId = str(o.client_id)
  if (!clientId) return { error: 'Esta operación no tiene cliente asociado. Asígnalo antes de facturar.' }

  // Inmueble: precio (base venta / renta mensual), tipo de operación y título.
  let propertyPrice: number | null = null, propertyTitle: string | null = null, isRental = false
  const propertyId = str(o.property_id)
  if (propertyId) {
    const { data: prop } = await supabase.from('properties').select('price, operation_type, title, address').eq('id', propertyId).maybeSingle()
    if (prop) {
      const p = prop as Record<string, unknown>
      propertyPrice = p.price == null ? null : Number(p.price)
      propertyTitle = str(p.title) ?? str(p.address)
      const ot = str(p.operation_type)
      isRental = ot === 'alquiler' || ot === 'alquiler_opcion_compra'
    }
  }

  const honorarios = computeHonorarios({
    value: o.value == null ? null : Number(o.value),
    commissionRate: o.commission_rate == null ? null : Number(o.commission_rate),
    propertyPrice, isRental, metadata: meta(o.metadata),
  })
  if (!honorarios || honorarios <= 0) return { error: 'Añade honorarios/comisión a la operación para generar una factura.' }

  const concept = propertyTitle ? `Honorarios de intermediación inmobiliaria · ${propertyTitle}` : 'Honorarios de intermediación inmobiliaria'
  const draft: InvoiceFormData = {
    clientId, propertyId: propertyId ?? null, opportunityId: oppId,
    series: 'A', issueDate: new Date().toISOString().slice(0, 10), dueDate: null,
    currency: 'EUR', exchangeRateToEur: null, exchangeRateSource: 'Manual', exchangeRateDate: null,
    notes: 'IVA calculado sobre los honorarios de la inmobiliaria, no sobre el precio del inmueble.',
    internalNotes: '',
    items: [{ description: concept, quantity: 1, unitPrice: honorarios, discountRate: 0, taxRate: 21, withholdingRate: 0, sortOrder: 0 }],
  }
  return { draft, propertyTitle, operationTitle: str(o.title), honorarios }
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
  const currency = (form.currency || 'EUR').toUpperCase()
  const isEur = currency === 'EUR'
  const rate = isEur ? 1 : (form.exchangeRateToEur ?? null)
  const fiscal: FiscalSnapshot = { currency, notes: null }
  const t = totalsFor(form.items)

  const base = {
    workspace_id: workspaceId,
    client_id: form.clientId, property_id: form.propertyId, opportunity_id: form.opportunityId,
    series: form.series || 'A',
    issue_date: form.issueDate, due_date: form.dueDate, currency,
    exchange_rate_to_eur: rate,
    exchange_rate_source: isEur ? null : (form.exchangeRateSource?.trim() || 'Manual'),
    exchange_rate_date: isEur ? null : (form.exchangeRateDate || form.issueDate),
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

// scope: 'active' (ni papelera ni purgadas) · 'trashed' (papelera, no purgadas) · 'all' (todo, para el
// resumen financiero, que puede contar facturas en papelera/purgadas si no están excluidas). Las purgadas
// nunca se muestran en los listados de la UI (se filtran client-side por purgedAt).
export async function listInvoices(workspaceId: string, opts: { status?: string; search?: string; scope?: 'active' | 'trashed' | 'all' } = {}): Promise<InvoiceListRow[]> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []
  const scope = opts.scope ?? 'active'
  let q = supabase.from('invoices')
    .select('id, invoice_number_display, series, status, issue_date, due_date, currency, exchange_rate_to_eur, subtotal, tax_total, withholding_total, total, customer_snapshot, pdf_file_id, updated_at, deleted_at, purged_at, accounting_excluded')
    .eq('workspace_id', workspaceId)
  if (scope === 'active') q = q.is('deleted_at', null).is('purged_at', null)
  else if (scope === 'trashed') q = q.not('deleted_at', 'is', null).is('purged_at', null)
  if (opts.status && opts.status !== 'todas') q = q.eq('status', opts.status)
  const orderKey = scope === 'trashed' ? 'updated_at' : 'issue_date'
  const { data, error } = await q.order(orderKey, { ascending: false }).order('created_at', { ascending: false }).limit(500)
  if (error || !data) return []
  const search = (opts.search ?? '').trim().toLowerCase()
  const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
  return (data as Record<string, unknown>[])
    .map((r) => ({
      id: String(r.id),
      display: str(r.invoice_number_display),
      series: str(r.series),
      status: (r.status as InvoiceStatus) ?? 'draft',
      issueDate: String(r.issue_date),
      dueDate: str(r.due_date),
      currency: str(r.currency) ?? 'EUR',
      exchangeRateToEur: r.exchange_rate_to_eur == null ? null : Number(r.exchange_rate_to_eur),
      subtotal: n(r.subtotal),
      taxTotal: n(r.tax_total),
      withholdingTotal: n(r.withholding_total),
      total: n(r.total),
      clientName: str(meta(r.customer_snapshot).name) ?? 'Sin cliente',
      hasPdf: Boolean(r.pdf_file_id),
      updatedAt: str(r.updated_at),
      deletedAt: str(r.deleted_at),
      purgedAt: str(r.purged_at),
      accountingExcluded: Boolean(r.accounting_excluded),
    }))
    .filter((r) => !search || (r.display ?? '').toLowerCase().includes(search) || r.clientName.toLowerCase().includes(search))
}

// Construye el PDF profesional (con logo real si existe) y lo guarda en entity-files, apuntando
// invoices.pdf_file_id. Reutilizable por emisión y por "regenerar PDF". Lanza si algo va mal.
async function buildAndStorePdf(
  supabase: NonNullable<ReturnType<typeof getSupabaseBrowserClient>>,
  workspaceId: string, id: string, invoice: Record<string, unknown>, items: InvoiceItem[],
): Promise<void> {
  const issuer = (invoice.issuer_snapshot ?? {}) as IssuerSnapshot
  const customer = (invoice.customer_snapshot ?? {}) as CustomerSnapshot
  const logo = await urlToJpegBytes(issuer.logoUrl).catch(() => null)
  const currency = str(invoice.currency) ?? 'EUR'
  const rate = Number(invoice.exchange_rate_to_eur)
  const exchange = currency !== 'EUR' && rate > 0
    ? { currency, rate, date: str(invoice.exchange_rate_date), source: str(invoice.exchange_rate_source) }
    : null
  const bytes = buildInvoicePdfBytes({
    display: str(invoice.invoice_number_display), status: String(invoice.status ?? 'issued'),
    issueDate: String(invoice.issue_date), dueDate: str(invoice.due_date), currency,
    subtotal: Number(invoice.subtotal) || 0, taxTotal: Number(invoice.tax_total) || 0,
    withholdingTotal: Number(invoice.withholding_total) || 0, total: Number(invoice.total) || 0,
    notes: str(invoice.notes), issuer, customer, logo, exchange,
  }, items)
  const disp = str(invoice.invoice_number_display) ?? id
  const safeName = disp.replace(/[^\w.-]+/g, '-')
  const file = new File([bytes as BlobPart], `factura-${safeName}.pdf`, { type: 'application/pdf' })
  const ef = await uploadEntityFile({ workspaceId, entityType: 'invoice', entityId: id, file, category: 'document' })
  await supabase.from('invoices').update({ pdf_file_id: ef.id }).eq('id', id).eq('workspace_id', workspaceId)
}

// Emisión: guardrails → reserva atómica del número (RPC) → refresca emisor → status issued → PDF (logo) →
// entity-files → pdf_file_id → actividad. El número se reserva primero (recurso escaso). Si el PDF fallara
// después, la factura queda emitida y el PDF se puede regenerar (no se pierde ni se duplica el número).
export async function emitInvoice(workspaceId: string, id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { error: 'Sin sesión.' }
  const loaded = await loadInvoice(workspaceId, id)
  if (!loaded) return { error: 'Factura no encontrada.' }
  const { invoice, items } = loaded

  // Guardrails: no emitir facturas rotas.
  if (invoice.status !== 'draft') return { error: 'Solo se pueden emitir borradores.' }
  if (!items.length) return { error: 'La factura necesita al menos una línea.' }
  if (!str(invoice.client_id) || !str(meta(invoice.customer_snapshot).name)) return { error: 'Selecciona un cliente válido antes de emitir.' }
  const totalNum = Number(invoice.total)
  if (!Number.isFinite(totalNum) || totalNum < 0) return { error: 'Los importes de la factura no son coherentes.' }
  const currency = String(invoice.currency || 'EUR').toUpperCase()
  if (currency !== 'EUR' && !(Number(invoice.exchange_rate_to_eur) > 0)) {
    return { error: `Añade el tipo de cambio a EUR para facturar en ${currency}.` }
  }

  // Refresca el emisor desde Configuración (por si se completó tras crear el borrador) y valida el mínimo.
  const freshIssuer = await loadIssuerSnapshot(workspaceId)
  if (issuerMissingCritical(freshIssuer).includes('nombre fiscal')) {
    return { error: 'Configura el nombre fiscal de tu empresa en Configuración antes de emitir.' }
  }

  const series = String(invoice.series || 'A')
  const issueDate = String(invoice.issue_date)
  const res = await reserveInvoiceNumber(supabase, workspaceId, series, issueDate)
  if ('error' in res) return { error: mapError(res.error) }

  const { error: upErr } = await supabase.from('invoices').update({
    series: res.series, year: res.year, number: res.number, invoice_number_display: res.display, status: 'issued',
    issuer_snapshot: freshIssuer,
  }).eq('id', id).eq('workspace_id', workspaceId)
  if (upErr) return { error: mapError(upErr.message) }

  // PDF + almacenamiento (retryable; el número ya está reservado).
  try {
    await buildAndStorePdf(supabase, workspaceId, id, {
      ...invoice, invoice_number_display: res.display, status: 'issued', issuer_snapshot: freshIssuer,
    }, items)
  } catch {
    // Emitida sin PDF: se puede regenerar. No romper el flujo (número ya asignado).
  }

  await logInvoiceActivity(workspaceId, invoice, `Factura emitida: ${res.display}`)
  return { ok: true }
}

// Regenera el PDF de una factura ya emitida (p. ej. tras completar logo/datos fiscales del emisor).
export async function regeneratePdf(workspaceId: string, id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { error: 'Sin sesión.' }
  const loaded = await loadInvoice(workspaceId, id)
  if (!loaded) return { error: 'Factura no encontrada.' }
  const { invoice, items } = loaded
  if (invoice.status === 'draft') return { error: 'Emite la factura para generar su PDF.' }
  try {
    await buildAndStorePdf(supabase, workspaceId, id, invoice, items)
  } catch {
    return { error: 'No se pudo generar el PDF. Inténtalo de nuevo.' }
  }
  await logInvoiceActivity(workspaceId, invoice, `PDF regenerado: ${str(invoice.invoice_number_display) ?? ''}`)
  return { ok: true }
}

// Ciclo de vida — PAPELERA (P36D). Cualquier factura puede moverse a la papelera (soft delete): reversible,
// no rompe la numeración y desaparece de las vistas normales. Restaurar la devuelve tal cual. El borrado
// DEFINITIVO (hard delete) queda reservado a los BORRADORES y a administradores (la RLS lo impone también),
// para preservar la trazabilidad fiscal de las facturas ya emitidas.

// Mover a papelera: sirve para cualquier estado. Reversible.
export async function moveToTrash(workspaceId: string, id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { error: 'Sin sesión.' }
  const loaded = await loadInvoice(workspaceId, id)
  if (!loaded) return { error: 'Factura no encontrada.' }
  const { error } = await supabase.from('invoices')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id).eq('workspace_id', workspaceId)
  if (error) return { error: mapError(error.message) }
  await logInvoiceActivity(workspaceId, loaded.invoice, `Factura movida a papelera: ${str(loaded.invoice.invoice_number_display) ?? 'borrador'}`)
  return { ok: true }
}

// Restaurar desde papelera: conserva número, estado y PDF. No regenera nada.
export async function restoreInvoice(workspaceId: string, id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { error: 'Sin sesión.' }
  const { error } = await supabase.from('invoices')
    .update({ deleted_at: null })
    .eq('id', id).eq('workspace_id', workspaceId)
  if (error) return { error: mapError(error.message) }
  const loaded = await loadInvoice(workspaceId, id)
  if (loaded) await logInvoiceActivity(workspaceId, loaded.invoice, `Factura restaurada: ${str(loaded.invoice.invoice_number_display) ?? 'borrador'}`)
  return { ok: true }
}

// Incluir / excluir una factura del RESUMEN financiero (reversible). No la borra ni la mueve.
export async function setAccountingExcluded(workspaceId: string, id: string, excluded: boolean): Promise<{ ok: true } | { error: string }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { error: 'Sin sesión.' }
  const { error } = await supabase.from('invoices').update({ accounting_excluded: excluded }).eq('id', id).eq('workspace_id', workspaceId)
  if (error) return { error: mapError(error.message) }
  return { ok: true }
}

// Eliminar DEFINITIVAMENTE (desde la papelera, con doble confirmación en la UI). Estrategia segura:
//  · BORRADOR → hard delete real (RLS admin+draft): la fila y sus líneas desaparecen (cascada).
//  · EMITIDA/ENVIADA/PAGADA/CANCELADA → NO se borra la fila (trazabilidad fiscal): se PURGA (purged_at) para
//    ocultarla de toda la UI (listados y papelera) y se fija su tratamiento contable:
//      accountingRetained=true  → sigue contando en el resumen (registro histórico),
//      accountingRetained=false → se excluye del resumen.
// En ningún caso se reutiliza la numeración ya emitida.
export async function permanentDelete(workspaceId: string, id: string, opts: { accountingRetained: boolean }): Promise<{ ok: true; mode: 'deleted' | 'purged' } | { error: string }> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return { error: 'Sin sesión.' }
  const loaded = await loadInvoice(workspaceId, id)
  if (!loaded) return { error: 'Factura no encontrada.' }
  const isDraft = loaded.invoice.status === 'draft'

  if (isDraft) {
    await logInvoiceActivity(workspaceId, loaded.invoice, 'Borrador eliminado definitivamente')
    const { error } = await supabase.from('invoices').delete().eq('id', id).eq('workspace_id', workspaceId).eq('status', 'draft')
    if (error) return { error: mapError(error.message) === 'No se pudo completar la operación. Inténtalo de nuevo.' ? 'No tienes permiso para eliminar definitivamente (requiere administrador).' : mapError(error.message) }
    return { ok: true, mode: 'deleted' }
  }

  // Emitida+: purgar (conservar fila) + tratamiento contable.
  const { error } = await supabase.from('invoices')
    .update({ purged_at: new Date().toISOString(), accounting_excluded: !opts.accountingRetained })
    .eq('id', id).eq('workspace_id', workspaceId)
  if (error) return { error: mapError(error.message) }
  await logInvoiceActivity(workspaceId, loaded.invoice, `Factura eliminada definitivamente (${opts.accountingRetained ? 'mantenida en resumen' : 'excluida del resumen'}): ${str(loaded.invoice.invoice_number_display) ?? ''}`)
  return { ok: true, mode: 'purged' }
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
