// Evals de facturación (P33) — EJECUTABLE y determinista (puro, sin I/O). Valida el cálculo fiscal
// (IVA/IRPF/descuento/redondeo), los totales de factura, la validación de payload y el set de estados.
// `runInvoicingEvals()` devuelve la lista de fallos (vacía = OK).

import { calcLineTotals, calculateInvoiceTotals, round2 } from '../calc'
import { validateInvoicePayload } from '../invoice-service'
import { INVOICE_STATUSES } from '../types'

export function runInvoicingEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // Línea simple: 2 × 100 = 200 base; IVA 21% = 42; total 242
  let l = calcLineTotals({ quantity: 2, unitPrice: 100, taxRate: 21 })
  ok(l.lineSubtotal === 200 && l.lineTaxTotal === 42 && l.lineTotal === 242, 'línea 2×100 IVA21')

  // Descuento 10%: bruto 200 → base 180; IVA 21% = 37.8; total 217.8
  l = calcLineTotals({ quantity: 2, unitPrice: 100, taxRate: 21, discountRate: 10 })
  ok(l.lineSubtotal === 180 && l.lineTaxTotal === 37.8 && l.lineTotal === 217.8, 'descuento 10%')

  // IRPF 15% sobre base 1000: IVA 21% = 210; retención 150; total 1000 + 210 − 150 = 1060
  l = calcLineTotals({ quantity: 1, unitPrice: 1000, taxRate: 21, withholdingRate: 15 })
  ok(l.lineSubtotal === 1000 && l.lineTaxTotal === 210 && l.lineWithholdingTotal === 150 && l.lineTotal === 1060, 'IRPF 15%')

  // Redondeo a 2 decimales: 3 × 33.33 = 99.99; IVA 21% = 21.00; total 120.99
  l = calcLineTotals({ quantity: 3, unitPrice: 33.33, taxRate: 21 })
  ok(l.lineSubtotal === 99.99 && l.lineTaxTotal === 21 && l.lineTotal === 120.99, 'redondeo 2 dec')

  // Honorarios inmobiliarios (P41): la factura es por la COMISIÓN, no por el precio de la vivienda.
  // Vivienda 250.000 € · honorarios 3% = 7.500 € · IVA 21% = 1.575 € · total factura = 9.075 €.
  const HOUSE_PRICE = 250000
  const fee = round2(HOUSE_PRICE * 0.03) // 7500
  l = calcLineTotals({ quantity: 1, unitPrice: fee, taxRate: 21 })
  ok(fee === 7500, 'honorarios 3% de 250.000 = 7.500')
  ok(l.lineSubtotal === 7500 && l.lineTaxTotal === 1575 && l.lineTotal === 9075, 'IVA sobre honorarios → factura 9.075 €')
  ok(l.lineTaxTotal !== round2(HOUSE_PRICE * 0.21), 'el IVA NO se calcula sobre el precio del inmueble')

  // Totales de factura (dos líneas, una con retención)
  const t = calculateInvoiceTotals([
    { quantity: 1, unitPrice: 1000, taxRate: 21 },                    // base 1000, IVA 210
    { quantity: 1, unitPrice: 500, taxRate: 10, withholdingRate: 15 }, // base 500, IVA 50, ret 75
  ])
  ok(t.subtotal === 1500 && t.taxTotal === 260 && t.withholdingTotal === 75 && t.total === 1685, 'totales factura')

  ok(round2(20.9979) === 21 && round2(0.005) === 0.01, 'round2')

  // Validación de payload
  ok(validateInvoicePayload({ items: [] }).ok === false, 'sin líneas inválida')
  ok(validateInvoicePayload({ items: [{ quantity: 0, unitPrice: 10 }] }).ok === false, 'cantidad 0 inválida')
  ok(validateInvoicePayload({ items: [{ quantity: 1, unitPrice: 10 }], issueDate: '2026-01-10', dueDate: '2026-01-01' }).ok === false, 'due < issue inválida')
  ok(validateInvoicePayload({ items: [{ quantity: 1, unitPrice: 10, taxRate: 21 }] }).ok === true, 'payload válido')
  ok(validateInvoicePayload({ items: [{ quantity: 1, unitPrice: 10 }], status: 'foo' }).ok === false, 'status inválido')

  // Estados controlados (mismo set que el CHECK de la tabla)
  ok(INVOICE_STATUSES.length === 7 && INVOICE_STATUSES.includes('draft') && INVOICE_STATUSES.includes('void'), 'estados')

  return fail
}
