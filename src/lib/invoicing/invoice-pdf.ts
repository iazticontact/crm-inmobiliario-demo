// PDF de factura (P34) — reutiliza el generador PDF SIN dependencias del proyecto (simple-pdf.ts).
// Estructura profesional por bloques (emisor, cliente, datos, conceptos, totales, notas). Determinista,
// server+browser. Campos ausentes → "No consta" (no se inventan datos).

import { generateSimplePdfBytes } from '@/lib/pdf/simple-pdf'
import { formatInvoiceCurrency } from './calc'
import type { InvoiceItem, IssuerSnapshot, CustomerSnapshot } from './types'

export type InvoicePdfInput = {
  display: string | null
  status: string
  issueDate: string
  dueDate: string | null
  currency: string
  subtotal: number
  taxTotal: number
  withholdingTotal: number
  total: number
  notes: string | null
  issuer: IssuerSnapshot
  customer: CustomerSnapshot
  propertyTitle?: string | null
  operationTitle?: string | null
}

const fmtDate = (iso: string | null) => {
  if (!iso) return 'No consta'
  try { return new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(new Date(iso)) } catch { return iso }
}
const nc = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : 'No consta')

export function buildInvoicePdfBytes(inv: InvoicePdfInput, items: InvoiceItem[]): Uint8Array {
  const cur = inv.currency || 'EUR'
  const money = (n: number) => formatInvoiceCurrency(n, cur)
  const lines: string[] = []

  lines.push('1. EMISOR')
  lines.push(nc(inv.issuer.legalName))
  if (inv.issuer.taxId) lines.push(`NIF/CIF: ${inv.issuer.taxId}`)
  if (inv.issuer.address) lines.push(inv.issuer.address)
  const issuerContact = [inv.issuer.email, inv.issuer.phone, inv.issuer.website].filter(Boolean).join('  ·  ')
  if (issuerContact) lines.push(issuerContact)
  lines.push('')

  lines.push('2. FACTURAR A')
  lines.push(nc(inv.customer.name))
  if (inv.customer.taxId) lines.push(`NIF/CIF: ${inv.customer.taxId}`)
  if (inv.customer.address) lines.push(inv.customer.address)
  const custContact = [inv.customer.email, inv.customer.phone, inv.customer.country].filter(Boolean).join('  ·  ')
  if (custContact) lines.push(custContact)
  lines.push('')

  lines.push('3. DATOS DE LA FACTURA')
  lines.push(`Numero: ${inv.display ?? 'Borrador (sin numerar)'}`)
  lines.push(`Fecha de emision: ${fmtDate(inv.issueDate)}`)
  lines.push(`Vencimiento: ${fmtDate(inv.dueDate)}`)
  if (inv.operationTitle) lines.push(`Operacion: ${inv.operationTitle}`)
  if (inv.propertyTitle) lines.push(`Inmueble: ${inv.propertyTitle}`)
  lines.push('')

  lines.push('4. CONCEPTOS')
  if (!items.length) lines.push('Sin conceptos.')
  for (const it of items) {
    lines.push(`- ${nc(it.description)}`)
    const parts = [`${it.quantity} x ${money(it.unit_price)}`]
    if (it.discount_rate) parts.push(`dto. ${it.discount_rate}%`)
    parts.push(`IVA ${it.tax_rate}%`)
    if (it.withholding_rate) parts.push(`IRPF ${it.withholding_rate}%`)
    parts.push(`= ${money(it.line_total)}`)
    lines.push(`   ${parts.join('  ·  ')}`)
  }
  lines.push('')

  lines.push('5. TOTALES')
  lines.push(`Base imponible: ${money(inv.subtotal)}`)
  lines.push(`IVA: ${money(inv.taxTotal)}`)
  if (inv.withholdingTotal) lines.push(`Retencion IRPF: -${money(inv.withholdingTotal)}`)
  lines.push(`TOTAL: ${money(inv.total)}`)

  if (inv.notes && inv.notes.trim()) {
    lines.push('')
    lines.push('6. NOTAS')
    lines.push(inv.notes.trim())
  }

  const title = inv.display ? `Factura ${inv.display}` : 'Factura (borrador)'
  return generateSimplePdfBytes({ title, subtitle: nc(inv.issuer.legalName), lines })
}
