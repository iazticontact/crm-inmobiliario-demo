// Evals del resumen ejecutivo del ciclo económico (P44) — PURAS.
import { computeEconomicCycle } from '../economic-cycle'

export function runEconomicCycleEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  const c = computeEconomicCycle([
    { honorarios: 7500, closed: true, invoiceStatus: null },     // cerrada sin factura → pendiente de facturar
    { honorarios: 5000, closed: false, invoiceStatus: null },    // ABIERTA sin factura → NO cuenta (potencial)
    { honorarios: 3000, closed: true, invoiceStatus: 'issued' }, // facturado pendiente de cobro
    { honorarios: 1200, closed: true, invoiceStatus: 'sent' },   // facturado pendiente de cobro
    { honorarios: 2000, closed: true, invoiceStatus: 'paid' },   // cobrado
    { honorarios: 9000, closed: true, invoiceStatus: 'cancelled' }, // cancelada → NO cuenta
    { honorarios: 1000, closed: true, invoiceStatus: 'draft' },  // borrador → NO cuenta en headline
    { honorarios: null, closed: true, invoiceStatus: null },     // sin comisión → skip
  ])

  ok(c.pendingInvoice === 7500, `pendiente de facturar = 7.500 (solo cerradas sin factura) got ${c.pendingInvoice}`)
  ok(c.pendingCount === 1, `pendingCount = 1 got ${c.pendingCount}`)
  ok(c.billed === 4200, `facturado pendiente de cobro = 3.000 + 1.200 = 4.200 got ${c.billed}`)
  ok(c.billedCount === 2, `billedCount = 2 got ${c.billedCount}`)
  ok(c.collected === 2000, `cobrado = 2.000 got ${c.collected}`)
  ok(c.collectedCount === 1, `collectedCount = 1 got ${c.collectedCount}`)
  ok(c.pendingInvoice !== 5000 && c.pendingInvoice < 8000, 'la operación abierta NO cuenta como pendiente de facturar')

  // Vacío / sin nada facturable
  const z = computeEconomicCycle([{ honorarios: 0, closed: true, invoiceStatus: null }])
  ok(z.pendingInvoice === 0 && z.billed === 0 && z.collected === 0, 'sin honorarios → todo 0')

  return fail
}
