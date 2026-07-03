// Resumen ejecutivo del CICLO económico (P44) — PURO. Agrega honorarios/comisión de operaciones por su
// estado de facturación (derivado de la factura vinculada, no sincronizado):
//   · Pendiente de facturar: operaciones CERRADAS con honorarios y SIN factura activa.
//   · Facturado pendiente de cobro: con factura emitida/enviada/vencida.
//   · Cobrado: con factura pagada.
// Los borradores y las canceladas NO suman en los importes principales (son estados intermedios/nulos).
// La base es SIEMPRE la comisión/honorarios, nunca el precio del inmueble.

import { billingStateFromInvoice } from './billing-state'

export type CycleRow = { honorarios: number | null; closed: boolean; invoiceStatus?: string | null }
export type EconomicCycle = {
  pendingInvoice: number; billed: number; collected: number
  pendingCount: number; billedCount: number; collectedCount: number
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function computeEconomicCycle(rows: CycleRow[]): EconomicCycle {
  let pi = 0, bi = 0, co = 0, pic = 0, bic = 0, coc = 0
  for (const row of rows) {
    const h = row.honorarios
    if (!(typeof h === 'number' && h > 0)) continue
    const st = billingStateFromInvoice(row.invoiceStatus)
    if (st === 'pending_invoice') { if (row.closed) { pi += h; pic++ } }
    else if (st === 'billed') { bi += h; bic++ }
    else if (st === 'collected') { co += h; coc++ }
    // 'draft' y 'cancelled' no suman en el resumen ejecutivo
  }
  return { pendingInvoice: r2(pi), billed: r2(bi), collected: r2(co), pendingCount: pic, billedCount: bic, collectedCount: coc }
}
