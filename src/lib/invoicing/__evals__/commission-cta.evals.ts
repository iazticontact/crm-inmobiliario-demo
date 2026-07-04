// Evals de la matriz de estados Comisiones ↔ Facturación (P45 · ampliada P46) — PURAS.
// Verifican, por combinación (cerrada?, cobrada interna?, factura + estado, gating, cliente):
//   - BUCKET visual + CHIP + ACCIÓN principal correctos,
//   - que «Facturar honorarios» NO aparezca con factura, ni tras cobro interno (texto distinto),
//   - gating del extra, «collectedByInvoice» y «canUndoInternalCollect» (deshacer solo secundario),
//   - agrupación por filtro (Por hacer / Facturadas / Cobradas / Potenciales / Todas),
//   - resumen/KPIs (deltas al emitir/cobrar; el precio del inmueble nunca suma),
//   - guía por estado (descripción + paso) y «cerrado económicamente» solo si factura pagada.

import {
  resolveCommissionState, summarizeCommissions, bucketInFilter, isEconomicallyClosed,
  COMMISSION_BUCKET_DESCRIPTION, COMMISSION_BUCKET_STEP,
  type CommissionCtaInput, type CommissionBucket, type CommissionSummaryRow,
} from '../commission-cta'

const base: CommissionCtaInput = {
  closed: true, commissionPaid: false, hasInvoiceLink: false, invoiceStatus: null, invoicingEnabled: true, hasClient: true,
}

export function runCommissionCtaEvals(): string[] {
  const fail: string[] = []
  const check = (partial: Partial<CommissionCtaInput>, expect: { kind: string; label?: string; chip?: string; bucket?: CommissionBucket; collected?: boolean; undo?: boolean }, msg: string) => {
    const s = resolveCommissionState({ ...base, ...partial })
    if (s.action.kind !== expect.kind) fail.push(`${msg}: kind esperado ${expect.kind}, obtenido ${s.action.kind}`)
    if (expect.label !== undefined && s.action.label !== expect.label) fail.push(`${msg}: label esperado "${expect.label}", obtenido "${s.action.label}"`)
    if (expect.chip !== undefined && s.chip.label !== expect.chip) fail.push(`${msg}: chip esperado "${expect.chip}", obtenido "${s.chip.label}"`)
    if (expect.bucket !== undefined && s.bucket !== expect.bucket) fail.push(`${msg}: bucket esperado ${expect.bucket}, obtenido ${s.bucket}`)
    if (expect.collected !== undefined && s.collectedByInvoice !== expect.collected) fail.push(`${msg}: collectedByInvoice esperado ${expect.collected}, obtenido ${s.collectedByInvoice}`)
    if (expect.undo !== undefined && s.canUndoInternalCollect !== expect.undo) fail.push(`${msg}: canUndoInternalCollect esperado ${expect.undo}, obtenido ${s.canUndoInternalCollect}`)
  }

  // ── Matriz de estados (bucket + acción principal única) ──
  check({}, { kind: 'create', label: 'Crear factura', chip: 'Pendiente de facturar', bucket: 'pending_invoice', undo: false }, 'CASO1 pendiente')
  check({ commissionPaid: true }, { kind: 'create_after_collect', label: 'Crear factura del cobro', chip: 'Cobrada sin factura', bucket: 'collected_no_invoice', undo: true }, 'CASO2 cobrada sin factura')
  check({ hasInvoiceLink: true, invoiceStatus: 'draft' }, { kind: 'open_invoice', label: 'Abrir borrador', chip: 'Borrador de factura', bucket: 'draft' }, 'CASO3 borrador')
  check({ hasInvoiceLink: true, invoiceStatus: 'issued' }, { kind: 'open_invoice', label: 'Abrir factura', chip: 'Facturado · pendiente de cobro', bucket: 'billed', collected: false }, 'CASO4 emitida')
  check({ hasInvoiceLink: true, invoiceStatus: 'sent' }, { kind: 'open_invoice', bucket: 'billed' }, 'CASO4 enviada')
  check({ hasInvoiceLink: true, invoiceStatus: 'paid' }, { kind: 'open_invoice', label: 'Ver factura', chip: 'Cobrado con factura', bucket: 'collected', collected: true, undo: false }, 'CASO5 pagada → Ver factura')
  check({ commissionPaid: true, hasInvoiceLink: true, invoiceStatus: 'paid' }, { kind: 'open_invoice', bucket: 'collected', collected: true, undo: false }, 'CASO5 pagada manda sobre interno (sin deshacer)')
  check({ hasInvoiceLink: true, invoiceStatus: 'cancelled' }, { kind: 'open_invoice', chip: 'Factura cancelada', bucket: 'cancelled' }, 'CASO6 cancelada')
  check({ hasInvoiceLink: true, invoiceStatus: 'void' }, { kind: 'open_invoice', bucket: 'cancelled' }, 'CASO6 void')
  check({ closed: false }, { kind: 'none', chip: 'Potencial', bucket: 'potential' }, 'CASO7 potencial')
  check({ closed: false, commissionPaid: true }, { kind: 'none', bucket: 'potential' }, 'CASO7 potencial aunque marcada')

  // ── Gating ──
  check({ invoicingEnabled: false }, { kind: 'requires_pro', label: 'Requiere Facturación PRO', bucket: 'pending_invoice' }, 'gating pendiente sin extra')
  check({ commissionPaid: true, invoicingEnabled: false }, { kind: 'requires_pro', bucket: 'collected_no_invoice' }, 'gating cobrada sin extra')
  check({ hasInvoiceLink: true, invoiceStatus: 'issued', invoicingEnabled: false }, { kind: 'open_invoice', bucket: 'billed' }, 'gating no bloquea abrir factura existente')

  // ── Sin cliente ──
  check({ hasClient: false }, { kind: 'none', bucket: 'pending_invoice' }, 'sin cliente no ofrece factura')
  check({ hasClient: false, commissionPaid: true }, { kind: 'none', bucket: 'collected_no_invoice', undo: true }, 'sin cliente cobrada: sin CTA pero deshacer posible')

  // ── link manda sobre cobro interno (no duplicar) ──
  check({ commissionPaid: true, hasInvoiceLink: true, invoiceStatus: 'draft' }, { kind: 'open_invoice', label: 'Abrir borrador', bucket: 'draft' }, 'link manda sobre cobro interno')

  // ── «Marcar pendiente» nunca principal: ninguna acción principal es de deshacer ──
  const kinds = ['create', 'create_after_collect', 'open_invoice', 'requires_pro', 'none']
  for (const st of ['issued', 'sent', 'paid', 'draft', 'cancelled', null] as (string | null)[]) {
    const s = resolveCommissionState({ ...base, hasInvoiceLink: st !== null, invoiceStatus: st, commissionPaid: true })
    if (!kinds.includes(s.action.kind)) fail.push(`acción principal no debe ser de deshacer (status ${st}): ${s.action.kind}`)
  }

  // ── Filtros / agrupación ──
  const inTodo = (b: CommissionBucket) => bucketInFilter(b, 'todo')
  if (!inTodo('pending_invoice') || !inTodo('collected_no_invoice') || !inTodo('billed') || !inTodo('draft')) fail.push('«Por hacer» debe incluir pendiente, cobrada-sin-factura, facturada y borrador')
  if (inTodo('collected') || inTodo('potential')) fail.push('«Por hacer» no debe incluir cobradas ni potenciales')
  if (!bucketInFilter('collected', 'cobradas') || bucketInFilter('billed', 'cobradas')) fail.push('«Cobradas» solo cobradas con factura')
  if (!bucketInFilter('potential', 'potenciales') || bucketInFilter('pending_invoice', 'potenciales')) fail.push('«Potenciales» solo abiertas')
  if (!bucketInFilter('billed', 'facturadas') || !bucketInFilter('draft', 'facturadas')) fail.push('«Facturadas» debe incluir emitidas y borradores')
  for (const b of ['pending_invoice', 'collected_no_invoice', 'draft', 'billed', 'cancelled', 'collected', 'potential'] as CommissionBucket[]) {
    if (!bucketInFilter(b, 'todas')) fail.push(`«Todas» debe incluir ${b}`)
  }

  // ── Resumen / KPIs (deltas y no-doble-conteo) ──
  const rows: CommissionSummaryRow[] = [
    { honorarios: 3000, bucket: 'pending_invoice' },
    { honorarios: 2000, bucket: 'collected_no_invoice' }, // cuenta como cobrado, NO como pendiente
    { honorarios: 1500, bucket: 'billed' },
    { honorarios: 4000, bucket: 'collected' },
    { honorarios: 9000, bucket: 'potential' },
    { honorarios: 5000, bucket: 'draft' },       // no suma a KPIs de cabecera
    { honorarios: 7000, bucket: 'cancelled' },    // no suma
    { honorarios: null, bucket: 'pending_invoice' }, // sin honorarios: no rompe
  ]
  const sum = summarizeCommissions(rows)
  if (sum.pendingInvoice !== 3000) fail.push(`pendingInvoice=3000 (solo pending, sin cobrada-sin-factura) got ${sum.pendingInvoice}`)
  if (sum.billed !== 1500) fail.push(`billed=1500 got ${sum.billed}`)
  if (sum.collected !== 6000) fail.push(`collected=6000 (4000 factura + 2000 cobro interno) got ${sum.collected}`)
  if (sum.potential !== 9000) fail.push(`potential=9000 got ${sum.potential}`)
  if (sum.todoCount !== 6) fail.push(`todoCount=6 (pending×2 + cobrada-sin-factura + billed + draft + cancelled) got ${sum.todoCount}`)
  if (sum.collectedNoInvoiceCount !== 1) fail.push(`collectedNoInvoiceCount=1 got ${sum.collectedNoInvoiceCount}`)

  // delta: al emitir factura, una pendiente pasa de pendingInvoice→billed
  const before = summarizeCommissions([{ honorarios: 1000, bucket: 'pending_invoice' }])
  const after = summarizeCommissions([{ honorarios: 1000, bucket: 'billed' }])
  if (!(before.pendingInvoice === 1000 && after.pendingInvoice === 0 && after.billed === 1000)) fail.push('emitir factura debe bajar pendiente y subir facturado')
  const paidS = summarizeCommissions([{ honorarios: 1000, bucket: 'collected' }])
  if (paidS.collected !== 1000) fail.push('pagar factura debe subir cobrado')

  // ── Guía por estado (descripción + paso) ──
  if (!COMMISSION_BUCKET_DESCRIPTION.billed.includes('emitida')) fail.push('descripción billed debe hablar de factura emitida / falta cobro')
  if (!COMMISSION_BUCKET_DESCRIPTION.collected_no_invoice.includes('falta la factura oficial')) fail.push('descripción cobrada-sin-factura debe decir «falta la factura oficial»')
  if (!COMMISSION_BUCKET_DESCRIPTION.collected.includes('pagada')) fail.push('descripción collected debe decir factura pagada')
  if (COMMISSION_BUCKET_STEP.billed !== 'Paso 2 de 3 · falta cobrar') fail.push('paso billed = 2 de 3')
  if (COMMISSION_BUCKET_STEP.collected !== 'Paso 3 de 3 · cerrado') fail.push('paso collected = 3 de 3')
  if (COMMISSION_BUCKET_STEP.potential !== null) fail.push('potencial no tiene paso de ciclo')

  // «Cerrado económicamente» SOLO cuando factura pagada
  for (const b of ['pending_invoice', 'collected_no_invoice', 'draft', 'billed', 'cancelled', 'potential'] as CommissionBucket[]) {
    if (isEconomicallyClosed(b)) fail.push(`bucket ${b} NO debe considerarse cerrado económicamente`)
  }
  if (!isEconomicallyClosed('collected')) fail.push('collected (factura pagada) debe ser cerrado económicamente')

  return fail
}
