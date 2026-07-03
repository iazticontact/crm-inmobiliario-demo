// Matriz de estados Comisiones ↔ Facturación (P45) — PURO. Una sola fuente de verdad para decidir, por
// operación, qué CHIP económico y qué ACCIÓN de factura mostrar. Distingue con claridad el control INTERNO
// de la comisión (cobrada/pendiente) del estado de la FACTURA oficial (borrador/emitida/cobrada/cancelada),
// respeta el gating del módulo extra Facturación y evita mostrar «Facturar honorarios» cuando no procede.
//
// Reglas clave:
//   - Si ya hay factura vinculada → nunca «Facturar honorarios»; se abre la existente (anti-duplicados).
//   - Comisión cobrada internamente SIN factura → acción distinta: «Crear factura del cobro» (+ ayuda).
//   - Operación abierta o sin cliente → sin CTA de factura (potencial / solo control interno).
//   - Módulo Facturación no disponible → «Requiere Facturación PRO», sin navegación.

import { billingStateFromInvoice, type BillingState } from './billing-state'

export type CommissionCtaInput = {
  closed: boolean            // operación cerrada (stage === 'won')
  commissionPaid: boolean    // cobro INTERNO registrado (commission_status === 'cobrada')
  hasInvoiceLink: boolean    // existe factura activa vinculada a la operación
  invoiceStatus?: string | null // estado de esa factura (si la hay)
  invoicingEnabled: boolean  // módulo extra Facturación PRO activo en el workspace
  hasClient: boolean         // la operación tiene cliente (imprescindible para facturar)
}

export type ChipTone = 'amber' | 'emerald' | 'indigo' | 'gray'
export type CommissionChip = { label: string; tone: ChipTone }

// Tipos de acción de factura que la UI debe renderizar.
export type CommissionActionKind =
  | 'none'                  // sin CTA de factura (potencial / sin cliente)
  | 'create'               // pendiente sin factura → «Facturar honorarios»
  | 'create_after_collect' // cobrada internamente sin factura → «Crear factura del cobro»
  | 'open_invoice'         // ya hay factura → abrir borrador/factura existente
  | 'requires_pro'         // Facturación no disponible → mensaje PRO, sin navegar

export type CommissionAction = {
  kind: CommissionActionKind
  label: string
  helper: string | null
  billing?: BillingState   // solo en open_invoice: para tono/estado de la factura
}

export type CommissionState = {
  chip: CommissionChip
  action: CommissionAction
  // true cuando el estado oficial de la factura manda sobre el control interno
  // (evita mostrar «Registrar cobro» interno si ya está cobrada con factura).
  collectedByInvoice: boolean
}

const NONE: CommissionAction = { kind: 'none', label: '', helper: null }

export function resolveCommissionState(i: CommissionCtaInput): CommissionState {
  // 1) Con factura vinculada: manda el estado OFICIAL. Nunca «Facturar honorarios» de nuevo.
  if (i.hasInvoiceLink) {
    const bs = billingStateFromInvoice(i.invoiceStatus)
    const chip = billingChip(bs)
    const collectedByInvoice = bs === 'collected'
    if (bs === 'draft') {
      return { chip, collectedByInvoice, action: { kind: 'open_invoice', billing: bs, label: 'Abrir borrador', helper: 'Hay un borrador de factura vinculado.' } }
    }
    if (bs === 'cancelled') {
      return { chip, collectedByInvoice, action: { kind: 'open_invoice', billing: bs, label: 'Abrir factura', helper: 'Factura anulada. Si procede, crea una nueva desde Facturación.' } }
    }
    if (bs === 'collected') {
      return { chip, collectedByInvoice, action: { kind: 'open_invoice', billing: bs, label: 'Abrir factura', helper: null } }
    }
    // billed / pending_invoice (emitida, enviada, vencida)
    return { chip, collectedByInvoice, action: { kind: 'open_invoice', billing: bs, label: 'Abrir factura', helper: 'Factura emitida pendiente de cobro.' } }
  }

  // 2) Sin factura y operación abierta → potencial (todavía no es ingreso).
  if (!i.closed) {
    return { chip: { label: 'Potencial', tone: 'gray' }, collectedByInvoice: false, action: NONE }
  }

  // 3) Cerrada sin factura: el chip refleja el control INTERNO de la comisión.
  const chip: CommissionChip = i.commissionPaid
    ? { label: 'Cobrada · sin factura', tone: 'emerald' }
    : { label: 'Pendiente', tone: 'amber' }

  // 3a) Sin cliente → no se puede emitir factura; solo control interno.
  if (!i.hasClient) return { chip, collectedByInvoice: false, action: NONE }

  // 3b) Módulo Facturación no disponible → mensaje PRO, sin navegación rota.
  if (!i.invoicingEnabled) {
    return { chip, collectedByInvoice: false, action: { kind: 'requires_pro', label: 'Requiere Facturación PRO', helper: 'Para emitir facturas necesitas el módulo Facturación.' } }
  }

  // 3c) Cobrada internamente sin factura → regularizar (texto distinto + ayuda).
  if (i.commissionPaid) {
    return { chip, collectedByInvoice: false, action: { kind: 'create_after_collect', label: 'Crear factura del cobro', helper: 'El cobro está registrado, pero todavía no hay factura oficial vinculada.' } }
  }

  // 3d) Pendiente sin factura → facturar honorarios.
  return { chip, collectedByInvoice: false, action: { kind: 'create', label: 'Facturar honorarios', helper: 'Aún no hay factura vinculada.' } }
}

// Chip para el estado de la FACTURA (contexto comisiones: «Cobrado con factura» para distinguir del
// cobro interno sin factura).
function billingChip(bs: BillingState): CommissionChip {
  switch (bs) {
    case 'draft':     return { label: 'Borrador de factura', tone: 'gray' }
    case 'billed':    return { label: 'Facturado · pendiente de cobro', tone: 'indigo' }
    case 'collected': return { label: 'Cobrado con factura', tone: 'emerald' }
    case 'cancelled': return { label: 'Factura cancelada', tone: 'amber' }
    default:          return { label: 'Pendiente de facturar', tone: 'amber' }
  }
}
