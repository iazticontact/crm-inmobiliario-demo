// Facturación — tipos de dominio (P33). Base fiscal: IVA por línea, IRPF (retención), descuentos, y
// snapshots (emisor/cliente/fiscal) para que una factura pasada no cambie si luego se edita el emisor
// o el cliente. Sin UI/PDF todavía. Los totales se calculan con calc.ts (puro/testeable).

export type InvoiceStatus = 'draft' | 'issued' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'void'

export const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled', 'void']

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Borrador', issued: 'Emitida', sent: 'Enviada', paid: 'Pagada',
  overdue: 'Vencida', cancelled: 'Cancelada', void: 'Anulada',
}

// Entradas de línea (lo que aporta el formulario/servicio). Los `*Total` los calcula calc.ts.
export type InvoiceItemInput = {
  description?: string
  quantity: number
  unitPrice: number
  taxRate?: number        // IVA % (0/4/10/21…)
  withholdingRate?: number // IRPF/retención %
  discountRate?: number    // % de descuento sobre el bruto de la línea
  sortOrder?: number
}

export type InvoiceTotals = {
  subtotal: number          // base imponible (tras descuentos)
  taxTotal: number          // IVA
  withholdingTotal: number   // IRPF/retención
  total: number             // subtotal + IVA - retención
}

export type IssuerSnapshot = {
  legalName?: string | null
  taxId?: string | null       // NIF/CIF
  address?: string | null     // calle y número (dirección fiscal)
  postalCode?: string | null  // CP
  city?: string | null
  province?: string | null
  country?: string | null
  email?: string | null
  phone?: string | null
  website?: string | null
  logoUrl?: string | null
}

export type CustomerSnapshot = {
  clientId?: string | null
  name?: string | null
  taxId?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  country?: string | null
  language?: string | null
}

export type FiscalSnapshot = {
  currency?: string
  defaultVat?: number | null
  withholding?: number | null
  regime?: string | null
  notes?: string | null
}

export type InvoiceNumberReservation = { number: number; year: number; series: string; display: string }

// Fila de factura (lectura). Alineada con la tabla `invoices` (P33).
export type Invoice = {
  id: string
  workspaceId: string
  clientId: string | null
  propertyId: string | null
  opportunityId: string | null
  series: string
  year: number
  number: number | null
  display: string | null
  status: InvoiceStatus
  issueDate: string
  dueDate: string | null
  currency: string
  subtotal: number
  taxTotal: number
  withholdingTotal: number
  total: number
  notes: string | null
  createdAt: string
  updatedAt: string
}

// Fila de línea tal cual viene de la tabla `invoice_items` (snake_case).
export type InvoiceItem = {
  id: string
  invoice_id: string
  workspace_id: string
  description: string
  quantity: number
  unit_price: number
  discount_rate: number
  tax_rate: number
  withholding_rate: number
  line_subtotal: number
  line_tax_total: number
  line_withholding_total: number
  line_total: number
  sort_order: number
}

export type InvoiceNumberSequence = {
  workspaceId: string
  series: string
  year: number
  nextNumber: number
  prefix: string
  padding: number
}
