// Evals del ciclo económico (P43) — PURAS. Estado derivado de la factura vinculada a la operación.

import { billingStateFromInvoice, BILLING_STATE_LABEL } from '../billing-state'

export function runBillingStateEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // Sin factura → pendiente de facturar
  ok(billingStateFromInvoice(null) === 'pending_invoice', 'sin factura → pendiente de facturar')
  ok(billingStateFromInvoice(undefined) === 'pending_invoice', 'undefined → pendiente de facturar')

  // Borrador
  ok(billingStateFromInvoice('draft') === 'draft', 'borrador')

  // Emitida/enviada/vencida → facturado (pendiente de cobro)
  ok(billingStateFromInvoice('issued') === 'billed', 'emitida → facturado')
  ok(billingStateFromInvoice('sent') === 'billed', 'enviada → facturado')
  ok(billingStateFromInvoice('overdue') === 'billed', 'vencida → facturado')

  // Pagada → cobrado
  ok(billingStateFromInvoice('paid') === 'collected', 'pagada → cobrado')

  // Cancelada/anulada → cancelada (no cuenta como cobrada)
  ok(billingStateFromInvoice('cancelled') === 'cancelled', 'cancelada')
  ok(billingStateFromInvoice('void') === 'cancelled', 'anulada')
  ok(billingStateFromInvoice('cancelled') !== 'collected', 'cancelada NO es cobrada')

  // Etiquetas
  ok(BILLING_STATE_LABEL.collected === 'Cobrado', 'label cobrado')
  ok(BILLING_STATE_LABEL.billed === 'Facturado · pendiente de cobro', 'label facturado')
  ok(BILLING_STATE_LABEL.pending_invoice === 'Pendiente de facturar', 'label pendiente')

  return fail
}
