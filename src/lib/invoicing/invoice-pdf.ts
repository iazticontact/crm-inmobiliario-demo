// PDF de factura PROFESIONAL (P36B) — reescrito sobre el motor vectorial sin dependencias (pdf-doc.ts).
// Estructura real de factura A4: cabecera con logo, título FACTURA + número + estado + fechas, bloques
// EMISOR / FACTURAR A, tabla de conceptos con importes alineados a la derecha, caja de totales destacada,
// notas y footer. Acentos correctos (WinAnsi). Degrada con elegancia: si falta un dato, no se pinta la
// línea (sin "No consta" por todas partes). Determinista; el logo (bytes JPEG) se pasa ya resuelto.

import { PdfDoc, type RGB } from '@/lib/pdf/pdf-doc'
import { formatInvoiceCurrency, round2 } from './calc'
import { INVOICE_STATUS_LABEL, type InvoiceItem, type IssuerSnapshot, type CustomerSnapshot, type InvoiceStatus } from './types'

export type InvoicePdfLogo = { jpeg: Uint8Array; width: number; height: number }

export type InvoicePdfInput = {
  display: string | null
  status: string
  issueDate: string
  dueDate: string | null
  currency: string
  subtotal: number
  taxTotal: number
  withholdingTotal: number
  total: number
  notes: string | null
  issuer: IssuerSnapshot
  customer: CustomerSnapshot
  propertyTitle?: string | null
  operationTitle?: string | null
  logo?: InvoicePdfLogo | null
}

// Paleta sobria/profesional (0..1)
const INK: RGB = [0.11, 0.13, 0.18]
const MUTED: RGB = [0.45, 0.48, 0.54]
const HAIR: RGB = [0.85, 0.87, 0.91]
const BRAND: RGB = [0.31, 0.29, 0.78]
const HEADBG: RGB = [0.14, 0.16, 0.23]
const ZEBRA: RGB = [0.968, 0.972, 0.984]
const TOTALBG: RGB = [0.949, 0.949, 0.988]
const WHITE: RGB = [1, 1, 1]

const STATUS_RGB: Record<InvoiceStatus, RGB> = {
  draft: [0.42, 0.45, 0.5], issued: [0.31, 0.29, 0.78], sent: [0.14, 0.5, 0.74],
  paid: [0.12, 0.55, 0.35], overdue: [0.78, 0.22, 0.24], cancelled: [0.72, 0.5, 0.12], void: [0.5, 0.5, 0.55],
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
const has = (v: string | null | undefined): v is string => !!(v && String(v).trim())

export function buildInvoicePdfBytes(inv: InvoicePdfInput, items: InvoiceItem[]): Uint8Array {
  const doc = new PdfDoc()
  const cur = inv.currency || 'EUR'
  const money = (n: number) => formatInvoiceCurrency(n, cur)
  const ML = 42, MR = doc.W - 42, RIGHT = MR
  const status = (inv.status as InvoiceStatus) in INVOICE_STATUS_LABEL ? (inv.status as InvoiceStatus) : 'draft'

  // ── Cabecera ────────────────────────────────────────────────────────────
  const issuerName = has(inv.issuer.legalName) ? inv.issuer.legalName! : 'Tu empresa'
  if (inv.logo) {
    doc.image(inv.logo.jpeg, inv.logo.width, inv.logo.height, ML, 40, 150, 52)
  } else {
    doc.text(issuerName, ML, 58, { size: 16, bold: true, color: INK, maxWidth: 260 })
    if (has(inv.issuer.taxId)) doc.text(`NIF/CIF: ${inv.issuer.taxId}`, ML, 74, { size: 9, color: MUTED })
  }

  doc.text('FACTURA', RIGHT, 62, { size: 24, bold: true, color: INK, align: 'right' })
  doc.text(inv.display ? `Nº ${inv.display}` : 'Borrador (sin numerar)', RIGHT, 80, { size: 10.5, color: MUTED, align: 'right' })

  // Pill de estado
  const label = INVOICE_STATUS_LABEL[status].toUpperCase()
  const pw = Math.max(46, 10 + label.length * 5.2)
  doc.rect(RIGHT - pw, 88, pw, 15, { fill: STATUS_RGB[status] })
  doc.text(label, RIGHT - pw / 2, 99, { size: 8, bold: true, color: WHITE, align: 'center' })

  doc.text(`Emisión: ${fmtDate(inv.issueDate)}`, RIGHT, 118, { size: 9.5, color: INK, align: 'right' })
  if (has(inv.dueDate)) doc.text(`Vencimiento: ${fmtDate(inv.dueDate)}`, RIGHT, 132, { size: 9.5, color: INK, align: 'right' })

  // ── Bloques EMISOR / FACTURAR A ────────────────────────────────────────
  const blockTop = 158
  doc.line(ML, 146, MR, 146, { color: HAIR })

  const colL = ML, colR = 312, blockW = 235
  doc.text('DE', colL, blockTop, { size: 8.5, bold: true, color: BRAND })
  doc.text('FACTURAR A', colR, blockTop, { size: 8.5, bold: true, color: BRAND })

  const issuerLines: { t: string; bold?: boolean }[] = [{ t: issuerName, bold: true }]
  if (has(inv.issuer.taxId)) issuerLines.push({ t: `NIF/CIF: ${inv.issuer.taxId}` })
  if (has(inv.issuer.address)) issuerLines.push({ t: inv.issuer.address! })
  const issuerCityLine = [inv.issuer.postalCode, inv.issuer.city, inv.issuer.province].filter(has).join(' ')
  if (issuerCityLine) issuerLines.push({ t: issuerCityLine })
  if (has(inv.issuer.country)) issuerLines.push({ t: inv.issuer.country! })
  if (has(inv.issuer.email)) issuerLines.push({ t: inv.issuer.email! })
  if (has(inv.issuer.phone)) issuerLines.push({ t: inv.issuer.phone! })
  if (has(inv.issuer.website)) issuerLines.push({ t: inv.issuer.website! })

  const custName = has(inv.customer.name) ? inv.customer.name! : 'Cliente sin especificar'
  const custLines: { t: string; bold?: boolean }[] = [{ t: custName, bold: true }]
  if (has(inv.customer.taxId)) custLines.push({ t: `NIF/CIF: ${inv.customer.taxId}` })
  if (has(inv.customer.address)) custLines.push({ t: inv.customer.address! })
  if (has(inv.customer.country)) custLines.push({ t: inv.customer.country! })
  if (has(inv.customer.email)) custLines.push({ t: inv.customer.email! })
  if (has(inv.customer.phone)) custLines.push({ t: inv.customer.phone! })

  let yl = blockTop + 15
  for (const ln of issuerLines) { doc.text(ln.t, colL, yl, { size: 9.5, bold: ln.bold, color: ln.bold ? INK : MUTED, maxWidth: blockW }); yl += 13 }
  let yr = blockTop + 15
  for (const ln of custLines) { doc.text(ln.t, colR, yr, { size: 9.5, bold: ln.bold, color: ln.bold ? INK : MUTED, maxWidth: blockW }); yr += 13 }

  // Referencias opcionales (operación / inmueble)
  let refY = Math.max(yl, yr) + 4
  const refs = [inv.operationTitle && `Operación: ${inv.operationTitle}`, inv.propertyTitle && `Inmueble: ${inv.propertyTitle}`].filter(Boolean) as string[]
  for (const r of refs) { doc.text(r, colL, refY, { size: 9, color: MUTED, maxWidth: doc.W - 84 }); refY += 12 }

  // ── Tabla de conceptos ─────────────────────────────────────────────────
  // Columnas: DESCRIPCIÓN (izq) | CANT | PRECIO | IVA | IMPORTE (der)
  const cDescX = ML + 6
  const cQtyR = 350, cPriceR = 432, cVatR = 476, cAmtR = RIGHT - 6
  const descMaxW = 232
  const pageBottom = doc.H - 70
  const ROWPAD = 7, LINEH = 12

  const drawTableHeader = (y: number): number => {
    doc.rect(ML, y, MR - ML, 22, { fill: HEADBG })
    const ty = y + 14.5
    doc.text('DESCRIPCIÓN', cDescX, ty, { size: 8.5, bold: true, color: WHITE })
    doc.text('CANT.', cQtyR, ty, { size: 8.5, bold: true, color: WHITE, align: 'right' })
    doc.text('PRECIO', cPriceR, ty, { size: 8.5, bold: true, color: WHITE, align: 'right' })
    doc.text('IVA', cVatR, ty, { size: 8.5, bold: true, color: WHITE, align: 'right' })
    doc.text('IMPORTE', cAmtR, ty, { size: 8.5, bold: true, color: WHITE, align: 'right' })
    return y + 22
  }

  let y = Math.max(refY + 10, 300)
  y = drawTableHeader(y)

  let zebra = false
  const rowsToRender = items.length ? items : []
  for (const it of rowsToRender) {
    const descLines = doc.wrap(has(it.description) ? it.description : '(sin descripción)', 9.5, descMaxW)
    const gross = round2(it.quantity * it.unit_price)
    const discount = round2(gross - it.line_subtotal)
    const extra: string[] = []
    if (it.discount_rate) extra.push(`Descuento ${it.discount_rate}%  (−${money(discount)})`)
    if (it.withholding_rate) extra.push(`IRPF ${it.withholding_rate}%`)
    const bodyLines = descLines.length + (extra.length ? 1 : 0)
    const rowH = ROWPAD * 2 + bodyLines * LINEH - (bodyLines > 1 ? 2 : 0)

    if (y + rowH > pageBottom) { doc.addPage(); y = 50; y = drawTableHeader(y) }
    if (zebra) doc.rect(ML, y, MR - ML, rowH, { fill: ZEBRA })
    zebra = !zebra

    let ly = y + ROWPAD + 9
    for (const dl of descLines) { doc.text(dl, cDescX, ly, { size: 9.5, color: INK }); ly += LINEH }
    if (extra.length) { doc.text(extra.join('   ·   '), cDescX, ly, { size: 8, color: MUTED }); ly += LINEH }

    const midY = y + ROWPAD + 9
    doc.text(String(it.quantity), cQtyR, midY, { size: 9.5, color: INK, align: 'right' })
    doc.text(money(it.unit_price), cPriceR, midY, { size: 9.5, color: INK, align: 'right' })
    doc.text(`${it.tax_rate}%`, cVatR, midY, { size: 9.5, color: INK, align: 'right' })
    doc.text(money(it.line_total), cAmtR, midY, { size: 9.5, bold: true, color: INK, align: 'right' })

    y += rowH
    doc.line(ML, y, MR, y, { color: HAIR })
  }
  if (!rowsToRender.length) {
    doc.text('Sin conceptos.', cDescX, y + 16, { size: 9.5, color: MUTED })
    y += 26
    doc.line(ML, y, MR, y, { color: HAIR })
  }

  // ── Caja de totales (derecha) ──────────────────────────────────────────
  const discountTotal = items.reduce((a, it) => a + round2(round2(it.quantity * it.unit_price) - it.line_subtotal), 0)
  const rows: { label: string; value: string; strong?: boolean }[] = []
  if (discountTotal > 0) rows.push({ label: 'Descuentos', value: `−${money(round2(discountTotal))}` })
  rows.push({ label: 'Base imponible', value: money(inv.subtotal) })
  rows.push({ label: 'IVA', value: money(inv.taxTotal) })
  if (inv.withholdingTotal) rows.push({ label: 'Retención IRPF', value: `−${money(inv.withholdingTotal)}` })

  const boxW = 250, boxX = MR - boxW
  let ty = y + 16
  if (ty + rows.length * 16 + 34 > doc.H - 60) { doc.addPage(); ty = 60 }
  for (const r of rows) {
    doc.text(r.label, boxX + 8, ty + 10, { size: 9.5, color: MUTED })
    doc.text(r.value, MR - 8, ty + 10, { size: 9.5, color: INK, align: 'right' })
    ty += 16
  }
  // Total destacado
  doc.rect(boxX, ty + 4, boxW, 30, { fill: TOTALBG })
  doc.rect(boxX, ty + 4, 3, 30, { fill: BRAND })
  doc.text('TOTAL', boxX + 12, ty + 23, { size: 12, bold: true, color: INK })
  doc.text(money(inv.total), MR - 10, ty + 23, { size: 13, bold: true, color: BRAND, align: 'right' })
  let afterTotals = ty + 44

  // ── Notas ───────────────────────────────────────────────────────────────
  if (has(inv.notes)) {
    if (afterTotals + 40 > doc.H - 60) { doc.addPage(); afterTotals = 60 }
    doc.text('NOTAS', ML, afterTotals + 6, { size: 8.5, bold: true, color: BRAND })
    let ny = afterTotals + 20
    for (const nl of doc.wrap(inv.notes!.trim(), 9, MR - ML - 4)) { doc.text(nl, ML, ny, { size: 9, color: MUTED }); ny += 12 }
  }

  // ── Footer ────────────────────────────────────────────────────────────
  const footY = doc.H - 34
  doc.line(ML, footY - 8, MR, footY - 8, { color: HAIR })
  const footBits = [issuerName, has(inv.issuer.taxId) ? inv.issuer.taxId! : null, has(inv.issuer.email) ? inv.issuer.email! : null].filter(Boolean) as string[]
  doc.text(footBits.join('   ·   '), ML, footY, { size: 8, color: MUTED, maxWidth: 380 })
  doc.text('Documento generado por el CRM', MR, footY, { size: 8, color: MUTED, align: 'right' })

  return doc.bytes()
}
