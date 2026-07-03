// Evals de la matriz de estados Comisiones ↔ Facturación (P45) — PURAS.
// Verifican que cada combinación (cerrada?, cobrada interna?, factura vinculada + estado, gating, cliente)
// produzca el CHIP y la ACCIÓN correctos, y en particular que:
//   - «Facturar honorarios» NO aparezca si ya hay factura, ni tras registrar cobro (texto distinto),
//   - el gating del extra Facturación se respete,
//   - el estado oficial de la factura mande sobre el cobro interno (collectedByInvoice).

import { resolveCommissionState, type CommissionCtaInput } from '../commission-cta'

const base: CommissionCtaInput = {
  closed: true, commissionPaid: false, hasInvoiceLink: false, invoiceStatus: null, invoicingEnabled: true, hasClient: true,
}

export function runCommissionCtaEvals(): string[] {
  const fail: string[] = []
  const check = (partial: Partial<CommissionCtaInput>, expect: { kind: string; label?: string; chip?: string; collected?: boolean }, msg: string) => {
    const s = resolveCommissionState({ ...base, ...partial })
    if (s.action.kind !== expect.kind) fail.push(`${msg}: kind esperado ${expect.kind}, obtenido ${s.action.kind}`)
    if (expect.label !== undefined && s.action.label !== expect.label) fail.push(`${msg}: label esperado "${expect.label}", obtenido "${s.action.label}"`)
    if (expect.chip !== undefined && s.chip.label !== expect.chip) fail.push(`${msg}: chip esperado "${expect.chip}", obtenido "${s.chip.label}"`)
    if (expect.collected !== undefined && s.collectedByInvoice !== expect.collected) fail.push(`${msg}: collectedByInvoice esperado ${expect.collected}, obtenido ${s.collectedByInvoice}`)
  }

  // CASO 1 — cerrada, pendiente, sin factura → Facturar honorarios
  check({}, { kind: 'create', label: 'Facturar honorarios', chip: 'Pendiente', collected: false }, 'CASO1 pendiente sin factura')

  // CASO 2 — cobrada internamente sin factura → texto distinto (no «Facturar honorarios»)
  check({ commissionPaid: true }, { kind: 'create_after_collect', label: 'Crear factura del cobro', chip: 'Cobrada · sin factura' }, 'CASO2 cobrada sin factura')

  // CASO 3 — borrador de factura → abrir borrador (no facturar de nuevo)
  check({ hasInvoiceLink: true, invoiceStatus: 'draft' }, { kind: 'open_invoice', label: 'Abrir borrador', chip: 'Borrador de factura' }, 'CASO3 borrador')

  // CASO 4 — emitida / enviada → facturado pendiente de cobro
  check({ hasInvoiceLink: true, invoiceStatus: 'issued' }, { kind: 'open_invoice', label: 'Abrir factura', chip: 'Facturado · pendiente de cobro', collected: false }, 'CASO4 emitida')
  check({ hasInvoiceLink: true, invoiceStatus: 'sent' }, { kind: 'open_invoice', chip: 'Facturado · pendiente de cobro' }, 'CASO4 enviada')

  // CASO 5 — pagada → cobrado con factura, y el estado oficial manda (oculta cobro interno)
  check({ hasInvoiceLink: true, invoiceStatus: 'paid' }, { kind: 'open_invoice', label: 'Abrir factura', chip: 'Cobrado con factura', collected: true }, 'CASO5 pagada')
  // aunque la comisión interna siguiera 'pendiente', la factura pagada manda
  check({ commissionPaid: false, hasInvoiceLink: true, invoiceStatus: 'paid' }, { kind: 'open_invoice', chip: 'Cobrado con factura', collected: true }, 'CASO5 pagada manda sobre interno')

  // CASO 6 — cancelada / anulada → factura cancelada
  check({ hasInvoiceLink: true, invoiceStatus: 'cancelled' }, { kind: 'open_invoice', chip: 'Factura cancelada' }, 'CASO6 cancelada')
  check({ hasInvoiceLink: true, invoiceStatus: 'void' }, { kind: 'open_invoice', chip: 'Factura cancelada' }, 'CASO6 void')

  // CASO 7 — operación abierta (potencial) → sin CTA de factura
  check({ closed: false }, { kind: 'none', chip: 'Potencial' }, 'CASO7 potencial')
  check({ closed: false, commissionPaid: true }, { kind: 'none', chip: 'Potencial' }, 'CASO7 potencial aunque marcada')

  // GATING — Facturación no disponible → requires_pro (sin navegar), solo si haría falta facturar
  check({ invoicingEnabled: false }, { kind: 'requires_pro', label: 'Requiere Facturación PRO' }, 'gating pendiente sin extra')
  check({ commissionPaid: true, invoicingEnabled: false }, { kind: 'requires_pro' }, 'gating cobrada sin extra')
  // con factura ya existente, abrir sigue disponible aunque el flag esté off (no rompe navegación)
  check({ hasInvoiceLink: true, invoiceStatus: 'issued', invoicingEnabled: false }, { kind: 'open_invoice' }, 'gating no bloquea abrir factura existente')

  // SIN CLIENTE — no se puede facturar → sin CTA (solo control interno)
  check({ hasClient: false }, { kind: 'none' }, 'sin cliente no ofrece factura')
  check({ hasClient: false, commissionPaid: true }, { kind: 'none' }, 'sin cliente cobrada no ofrece factura')

  // hasInvoiceLink manda sobre commissionPaid (no duplicar): borrador vinculado aunque cobrada interna
  check({ commissionPaid: true, hasInvoiceLink: true, invoiceStatus: 'draft' }, { kind: 'open_invoice', label: 'Abrir borrador' }, 'link manda sobre cobro interno')

  return fail
}
