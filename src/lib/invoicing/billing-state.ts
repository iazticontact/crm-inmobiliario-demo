// Estado del CICLO económico de una operación (P43) — PURO. Deriva del estado de la factura vinculada, sin
// mutar la operación (evita sincronizaciones frágiles):
//   sin factura → "Pendiente de facturar" · borrador → "Borrador de factura" ·
//   emitida/enviada/vencida → "Facturado · pendiente de cobro" · pagada → "Cobrado" ·
//   cancelada/anulada → "Factura cancelada".

export type BillingState = 'pending_invoice' | 'draft' | 'billed' | 'collected' | 'cancelled'

export function billingStateFromInvoice(status: string | null | undefined): BillingState {
  switch (status) {
    case 'draft': return 'draft'
    case 'paid': return 'collected'
    case 'cancelled':
    case 'void': return 'cancelled'
    case 'issued':
    case 'sent':
    case 'overdue': return 'billed'
    default: return 'pending_invoice' // sin factura vinculada
  }
}

export const BILLING_STATE_LABEL: Record<BillingState, string> = {
  pending_invoice: 'Pendiente de facturar',
  draft: 'Borrador de factura',
  billed: 'Facturado · pendiente de cobro',
  collected: 'Cobrado',
  cancelled: 'Factura cancelada',
}
