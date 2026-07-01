// Cálculo de factura — PURO y testeable (P33). Sin I/O. Redondeo consistente a 2 decimales (céntimos)
// por línea y luego suma, para que los totales persistidos sean reproducibles y validables.
//
// Modelo por línea: bruto = cantidad × precio; base = bruto − descuento; IVA = base × tax%;
// retención(IRPF) = base × withholding%; total línea = base + IVA − retención.
// Factura: subtotal = Σ base; IVA = Σ IVA; retención = Σ retención; total = subtotal + IVA − retención.

import type { InvoiceItemInput, InvoiceTotals } from './types'

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const pct = (base: number, rate: number | undefined) => round2(base * ((rate ?? 0) / 100))

export type LineTotals = {
  lineSubtotal: number
  lineTaxTotal: number
  lineWithholdingTotal: number
  lineTotal: number
}

export function calcLineTotals(item: InvoiceItemInput): LineTotals {
  const qty = Number.isFinite(item.quantity) ? item.quantity : 0
  const unit = Number.isFinite(item.unitPrice) ? item.unitPrice : 0
  const gross = round2(qty * unit)
  const discount = pct(gross, item.discountRate)
  const base = round2(gross - discount)
  const tax = pct(base, item.taxRate)
  const withholding = pct(base, item.withholdingRate)
  const total = round2(base + tax - withholding)
  return { lineSubtotal: base, lineTaxTotal: tax, lineWithholdingTotal: withholding, lineTotal: total }
}

export function calculateInvoiceTotals(items: InvoiceItemInput[]): InvoiceTotals {
  let subtotal = 0
  let taxTotal = 0
  let withholdingTotal = 0
  for (const it of items ?? []) {
    const l = calcLineTotals(it)
    subtotal = round2(subtotal + l.lineSubtotal)
    taxTotal = round2(taxTotal + l.lineTaxTotal)
    withholdingTotal = round2(withholdingTotal + l.lineWithholdingTotal)
  }
  const total = round2(subtotal + taxTotal - withholdingTotal)
  return { subtotal, taxTotal, withholdingTotal, total }
}

export function formatInvoiceCurrency(value: number, currency = 'EUR'): string {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(Number.isFinite(value) ? value : 0)
  } catch {
    return `${round2(value)} ${currency}`
  }
}
