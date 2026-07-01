// Facturación — servicios base (P33). SIN UI. Operan con un SupabaseClient (navegador autenticado bajo
// RLS o admin server-side); NUNCA exponen service_role al frontend. La numeración usa la RPC atómica
// `reserve_invoice_number` (que valida membership + rol). Estos servicios son el cimiento que P34 (UI/PDF)
// consumirá; aquí solo lectura + validación + reserva de número (no se crea UI ni PDF).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { InvoiceItemInput, InvoiceNumberReservation, InvoiceStatus } from './types'
import { INVOICE_STATUSES } from './types'

export type InvoicePayload = {
  clientId?: string | null
  items: InvoiceItemInput[]
  issueDate?: string
  dueDate?: string | null
  currency?: string
  series?: string
  status?: string
}

export type ValidationResult = { ok: boolean; errors: string[] }

export function validateInvoicePayload(p: InvoicePayload): ValidationResult {
  const errors: string[] = []
  if (!p || !Array.isArray(p.items) || p.items.length === 0) {
    errors.push('La factura necesita al menos una línea.')
  }
  ;(p?.items ?? []).forEach((it, i) => {
    if (!(Number(it.quantity) > 0)) errors.push(`Línea ${i + 1}: la cantidad debe ser mayor que 0.`)
    if (!(Number(it.unitPrice) >= 0)) errors.push(`Línea ${i + 1}: el precio no puede ser negativo.`)
    if (it.taxRate != null && Number(it.taxRate) < 0) errors.push(`Línea ${i + 1}: el IVA no puede ser negativo.`)
    if (it.withholdingRate != null && Number(it.withholdingRate) < 0) errors.push(`Línea ${i + 1}: la retención no puede ser negativa.`)
    if (it.discountRate != null && (Number(it.discountRate) < 0 || Number(it.discountRate) > 100)) errors.push(`Línea ${i + 1}: el descuento debe estar entre 0 y 100.`)
  })
  if (p?.status && !INVOICE_STATUSES.includes(p.status as InvoiceStatus)) errors.push('Estado de factura no válido.')
  if (p?.issueDate && p?.dueDate && p.dueDate < p.issueDate) errors.push('El vencimiento no puede ser anterior a la emisión.')
  return { ok: errors.length === 0, errors }
}

// Reserva atómica del siguiente número (workspace + serie + año). La RPC valida membership/rol.
export async function reserveInvoiceNumber(
  supabase: SupabaseClient, workspaceId: string, series = 'A', issueDate?: string,
): Promise<InvoiceNumberReservation | { error: string }> {
  const args: Record<string, unknown> = { p_workspace_id: workspaceId, p_series: series }
  if (issueDate) args.p_issue_date = issueDate
  const { data, error } = await supabase.rpc('reserve_invoice_number', args)
  if (error) return { error: error.message }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) return { error: 'no_number' }
  return {
    number: Number(row.out_number),
    year: Number(row.out_year),
    series: String(row.out_series),
    display: String(row.out_display),
  }
}

export async function listInvoices(
  supabase: SupabaseClient, workspaceId: string, opts: { status?: string; limit?: number } = {},
) {
  let q = supabase
    .from('invoices')
    .select('id, series, year, number, invoice_number_display, status, issue_date, due_date, currency, total, client_id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
  if (opts.status) q = q.eq('status', opts.status)
  const { data, error } = await q.order('issue_date', { ascending: false }).limit(opts.limit ?? 50)
  if (error) return { error: error.message }
  return { invoices: data ?? [] }
}

export async function getInvoiceById(supabase: SupabaseClient, workspaceId: string, id: string) {
  const { data, error } = await supabase
    .from('invoices').select('*').eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
  if (error) return { error: error.message }
  return { invoice: data }
}
