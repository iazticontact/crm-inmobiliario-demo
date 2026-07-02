// Evals del cálculo de honorarios (P42) — PURAS. La FACTURA es por la comisión de la inmobiliaria, NUNCA
// por el precio del inmueble. `runHonorariosEvals()` devuelve los fallos (vacío = OK).

import { computeHonorarios } from '../honorarios'
import { calcLineTotals } from '../calc'

export function runHonorariosEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // Venta 250.000 € · 3% → base 7.500 (NO 250.000)
  const sale = computeHonorarios({ value: 250000, commissionRate: 3, propertyPrice: 250000, isRental: false })
  ok(sale === 7500, `venta 3% de 250.000 = 7.500 (got ${sale})`)
  ok(sale !== 250000, 'la base NO es el precio del inmueble')

  // Venta sin precio de inmueble → usa value
  ok(computeHonorarios({ value: 200000, commissionRate: 3, propertyPrice: null, isRental: false }) === 6000, 'venta usa value si no hay precio de inmueble')

  // Alquiler percent: base = renta ANUAL (value), no la mensualidad
  ok(computeHonorarios({ value: 12000, commissionRate: 5, propertyPrice: 1000, isRental: true }) === 600, 'alquiler % sobre renta anual')

  // Alquiler one_month: 1 mensualidad (precio del inmueble = renta mensual)
  ok(computeHonorarios({ value: 12000, commissionRate: 5, propertyPrice: 1000, isRental: true, metadata: { commission_model: 'one_month' } }) === 1000, 'alquiler 1 mensualidad')

  // Importe fijo
  ok(computeHonorarios({ value: 250000, commissionRate: 3, propertyPrice: 250000, isRental: false, metadata: { commission_model: 'fixed', commission_fixed: 5000 } }) === 5000, 'comisión fija')

  // Sin comisión → null (no permite prefill)
  ok(computeHonorarios({ value: 250000, commissionRate: null, propertyPrice: 250000, isRental: false }) === null, 'sin commission_rate → null')
  ok(computeHonorarios({ value: null, commissionRate: 3, propertyPrice: null, isRental: false }) === null, 'sin base → null')

  // La factura de honorarios: base 7.500 → IVA 21% = 1.575 → total 9.075
  const l = calcLineTotals({ quantity: 1, unitPrice: sale ?? 0, taxRate: 21 })
  ok(l.lineSubtotal === 7500 && l.lineTaxTotal === 1575 && l.lineTotal === 9075, 'factura honorarios 7.500 + IVA = 9.075')

  return fail
}
