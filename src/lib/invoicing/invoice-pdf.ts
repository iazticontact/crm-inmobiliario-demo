// PDF de factura PREMIUM (P36C) — reescrito sobre el motor vectorial sin dependencias (pdf-doc.ts).
// Diseño propio, sobrio y profesional que aprovecha bien la hoja A4: cabecera con logo + título, banda de
// metadatos (número · emisión · vencimiento · estado), tarjetas EMISOR / CLIENTE, tabla de conceptos con
// importes alineados, panel de totales con TOTAL destacado, bloque de notas/condiciones y footer fijado al
// pie. Acentos correctos (WinAnsi). Degrada con elegancia (si falta un dato, no se pinta la línea).

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
const INK: RGB = [0.12, 0.14, 0.19]
const SUBINK: RGB = [0.28, 0.31, 0.38]
const MUTED: RGB = [0.47, 0.50, 0.56]
const HAIR: RGB = [0.87, 0.89, 0.92]
const BRAND: RGB = [0.31, 0.29, 0.78]
const BRAND_SOFT: RGB = [0.937, 0.937, 0.988]
const SLATE: RGB = [0.15, 0.17, 0.24]
const CARD: RGB = [0.968, 0.973, 0.984]
const ZEBRA: RGB = [0.975, 0.978, 0.988]
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
  const ML = 46, MR = doc.W - 46, CW = MR - ML
  const status = (inv.status as InvoiceStatus) in INVOICE_STATUS_LABEL ? (inv.status as InvoiceStatus) : 'draft'
  const issuerName = has(inv.issuer.legalName) ? inv.issuer.legalName! : 'Tu empresa'

  // ── Cabecera ────────────────────────────────────────────────────────────
  if (inv.logo) doc.image(inv.logo.jpeg, inv.logo.width, inv.logo.height, ML, 42, 168, 58)
  else doc.text(issuerName, ML, 66, { size: 17, bold: true, color: INK, maxWidth: 300 })

  doc.text('FACTURA', MR, 60, { size: 26, bold: true, color: INK, align: 'right' })
  doc.text(inv.display ? `Nº ${inv.display}` : 'Borrador · sin numerar', MR, 80, { size: 10.5, color: MUTED, align: 'right' })
  // Regla de acento
  doc.rect(ML, 112, CW, 2.4, { fill: BRAND })

  // ── Banda de metadatos ──────────────────────────────────────────────────
  const bandY = 124, bandH = 50
  doc.rect(ML, bandY, CW, bandH, { fill: CARD })
  const metaCols: { label: string; value: string; pill?: boolean }[] = [
    { label: 'NÚMERO', value: inv.display ?? 'Borrador' },
    { label: 'FECHA DE EMISIÓN', value: fmtDate(inv.issueDate) },
    { label: 'VENCIMIENTO', value: fmtDate(inv.dueDate) },
    { label: 'ESTADO', value: INVOICE_STATUS_LABEL[status], pill: true },
  ]
  const colW = CW / metaCols.length
  metaCols.forEach((c, i) => {
    const cx = ML + i * colW + 12
    doc.text(c.label, cx, bandY + 18, { size: 7.5, bold: true, color: MUTED })
    if (c.pill) {
      const label = c.value.toUpperCase()
      const pw = Math.max(48, 12 + label.length * 5.2)
      doc.rect(cx, bandY + 26, pw, 14, { fill: STATUS_RGB[status] })
      doc.text(label, cx + pw / 2, bandY + 36, { size: 7.5, bold: true, color: WHITE, align: 'center' })
    } else {
      doc.text(c.value, cx, bandY + 37, { size: 11, bold: true, color: INK, maxWidth: colW - 20 })
    }
    if (i > 0) doc.line(ML + i * colW, bandY + 10, ML + i * colW, bandY + bandH - 10, { color: HAIR })
  })

  // ── Tarjetas EMISOR / CLIENTE ───────────────────────────────────────────
  const issuerLines: { t: string; bold?: boolean }[] = [{ t: issuerName, bold: true }]
  if (has(inv.issuer.taxId)) issuerLines.push({ t: `NIF/CIF: ${inv.issuer.taxId}` })
  if (has(inv.issuer.address)) issuerLines.push({ t: inv.issuer.address! })
  const issuerCity = [inv.issuer.postalCode, inv.issuer.city, inv.issuer.province].filter(has).join(' ')
  if (issuerCity) issuerLines.push({ t: issuerCity })
  if (has(inv.issuer.country)) issuerLines.push({ t: inv.issuer.country! })
  const issuerContact = [inv.issuer.email, inv.issuer.phone, inv.issuer.website].filter(has).join('  ·  ')
  if (issuerContact) issuerLines.push({ t: issuerContact })

  const custName = has(inv.customer.name) ? inv.customer.name! : 'Cliente sin especificar'
  const custLines: { t: string; bold?: boolean }[] = [{ t: custName, bold: true }]
  if (has(inv.customer.taxId)) custLines.push({ t: `NIF/CIF: ${inv.customer.taxId}` })
  if (has(inv.customer.address)) custLines.push({ t: inv.customer.address! })
  if (has(inv.customer.country)) custLines.push({ t: inv.customer.country! })
  const custContact = [inv.customer.email, inv.customer.phone].filter(has).join('  ·  ')
  if (custContact) custLines.push({ t: custContact })

  const cardTop = bandY + bandH + 20
  const cardGap = 14
  const cardW = (CW - cardGap) / 2
  const cardH = Math.max(104, 32 + Math.max(issuerLines.length, custLines.length) * 12.5)

  const drawCard = (x: number, label: string, lines: { t: string; bold?: boolean }[]) => {
    doc.rect(x, cardTop, cardW, cardH, { fill: CARD })
    doc.rect(x, cardTop, 3, cardH, { fill: BRAND })
    doc.text(label, x + 14, cardTop + 17, { size: 8, bold: true, color: BRAND })
    let ly = cardTop + 33
    for (const ln of lines) { doc.text(ln.t, x + 14, ly, { size: ln.bold ? 10.5 : 9, bold: ln.bold, color: ln.bold ? INK : SUBINK, maxWidth: cardW - 26 }); ly += ln.bold ? 14 : 12 }
  }
  drawCard(ML, 'EMISOR', issuerLines)
  drawCard(ML + cardW + cardGap, 'FACTURAR A', custLines)

  // Referencias opcionales (operación / inmueble)
  let y = cardTop + cardH + 14
  const refs = [inv.operationTitle && `Operación: ${inv.operationTitle}`, inv.propertyTitle && `Inmueble: ${inv.propertyTitle}`].filter(Boolean) as string[]
  if (refs.length) { doc.text(refs.join('     '), ML, y + 4, { size: 8.5, color: MUTED, maxWidth: CW }); y += 16 }

  // ── Tabla de conceptos ─────────────────────────────────────────────────
  const cDescX = ML + 10
  const cImporteR = MR - 10, cIvaR = MR - 96, cPrecioR = MR - 158, cCantR = MR - 232
  const descMaxW = cCantR - cDescX - 16
  const pageBottom = doc.H - 96
  const HEADH = 26, ROWPAD = 8, LINEH = 12.5

  const drawTableHeader = (yy: number): number => {
    doc.rect(ML, yy, CW, HEADH, { fill: SLATE })
    const ty = yy + 17
    doc.text('DESCRIPCIÓN', cDescX, ty, { size: 8.5, bold: true, color: WHITE })
    doc.text('CANT.', cCantR, ty, { size: 8.5, bold: true, color: WHITE, align: 'right' })
    doc.text('PRECIO', cPrecioR, ty, { size: 8.5, bold: true, color: WHITE, align: 'right' })
    doc.text('IVA', cIvaR, ty, { size: 8.5, bold: true, color: WHITE, align: 'right' })
    doc.text('IMPORTE', cImporteR, ty, { size: 8.5, bold: true, color: WHITE, align: 'right' })
    return yy + HEADH
  }

  y += 6
  y = drawTableHeader(y)
  let zebra = false
  for (const it of items) {
    const descLines = doc.wrap(has(it.description) ? it.description : '(sin descripción)', 9.5, descMaxW)
    const gross = round2(it.quantity * it.unit_price)
    const discount = round2(gross - it.line_subtotal)
    const extra: string[] = []
    if (it.discount_rate) extra.push(`Descuento ${it.discount_rate}% (−${money(discount)})`)
    if (it.withholding_rate) extra.push(`IRPF ${it.withholding_rate}%`)
    const bodyLines = descLines.length + (extra.length ? 1 : 0)
    const rowH = Math.max(30, ROWPAD * 2 + bodyLines * LINEH)

    if (y + rowH > pageBottom) { doc.addPage(); y = 60; y = drawTableHeader(y) }
    if (zebra) doc.rect(ML, y, CW, rowH, { fill: ZEBRA })
    zebra = !zebra

    let ly = y + ROWPAD + 9
    for (const dl of descLines) { doc.text(dl, cDescX, ly, { size: 9.5, color: INK }); ly += LINEH }
    if (extra.length) { doc.text(extra.join('    ·    '), cDescX, ly, { size: 8, color: MUTED }); ly += LINEH }

    const midY = y + ROWPAD + 9
    doc.text(String(it.quantity), cCantR, midY, { size: 9.5, color: SUBINK, align: 'right' })
    doc.text(money(it.unit_price), cPrecioR, midY, { size: 9.5, color: SUBINK, align: 'right' })
    doc.text(`${it.tax_rate}%`, cIvaR, midY, { size: 9.5, color: SUBINK, align: 'right' })
    doc.text(money(it.line_total), cImporteR, midY, { size: 9.5, bold: true, color: INK, align: 'right' })

    y += rowH
    doc.line(ML, y, MR, y, { color: HAIR })
  }
  if (!items.length) { doc.text('Sin conceptos.', cDescX, y + 17, { size: 9.5, color: MUTED }); y += 28; doc.line(ML, y, MR, y, { color: HAIR }) }

  // ── Totales (panel derecho) + notas (izquierda) ──────────────────────────
  const discountTotal = round2(items.reduce((a, it) => a + round2(round2(it.quantity * it.unit_price) - it.line_subtotal), 0))
  const tRows: { label: string; value: string }[] = []
  if (discountTotal > 0) tRows.push({ label: 'Descuentos', value: `−${money(discountTotal)}` })
  tRows.push({ label: 'Base imponible', value: money(inv.subtotal) })
  tRows.push({ label: 'IVA', value: money(inv.taxTotal) })
  if (inv.withholdingTotal) tRows.push({ label: 'Retención IRPF', value: `−${money(inv.withholdingTotal)}` })

  const boxW = 250, boxX = MR - boxW
  const totalsH = 16 + tRows.length * 17 + 40
  if (y + totalsH > doc.H - 90) { doc.addPage(); y = 60 }
  let ty = y + 18
  for (const r of tRows) {
    doc.text(r.label, boxX, ty + 10, { size: 10, color: MUTED })
    doc.text(r.value, MR, ty + 10, { size: 10, color: SUBINK, align: 'right' })
    ty += 17
    doc.line(boxX, ty + 1, MR, ty + 1, { color: HAIR })
  }
  ty += 8
  doc.rect(boxX, ty, boxW, 38, { fill: BRAND_SOFT })
  doc.rect(boxX, ty, 3.5, 38, { fill: BRAND })
  doc.text('TOTAL', boxX + 14, ty + 24, { size: 13, bold: true, color: INK })
  doc.text(money(inv.total), MR - 12, ty + 24.5, { size: 15, bold: true, color: BRAND, align: 'right' })

  // Notas / condiciones (izquierda, alineado con el panel de totales)
  const notesX = ML, notesMaxW = boxX - ML - 20
  let ny = y + 18
  if (has(inv.notes)) {
    doc.text('NOTAS Y CONDICIONES', notesX, ny + 8, { size: 8, bold: true, color: BRAND })
    ny += 22
    for (const nl of doc.wrap(inv.notes!.trim(), 9, notesMaxW)) { if (ny > doc.H - 96) break; doc.text(nl, notesX, ny, { size: 9, color: SUBINK }); ny += 12.5 }
  } else if (issuerContact) {
    doc.text('¿DUDAS CON ESTA FACTURA?', notesX, ny + 8, { size: 8, bold: true, color: BRAND })
    doc.text([inv.issuer.email, inv.issuer.phone].filter(has).join('  ·  '), notesX, ny + 24, { size: 9, color: SUBINK, maxWidth: notesMaxW })
  }

  // ── Footer fijado al pie ────────────────────────────────────────────────
  const footY = doc.H - 46
  doc.line(ML, footY - 10, MR, footY - 10, { color: HAIR })
  const footBits = [issuerName, has(inv.issuer.taxId) ? inv.issuer.taxId! : null, has(inv.issuer.email) ? inv.issuer.email! : null, has(inv.issuer.website) ? inv.issuer.website! : null].filter(Boolean) as string[]
  doc.text(footBits.join('    ·    '), ML + CW / 2, footY, { size: 8, color: MUTED, align: 'center', maxWidth: CW })

  return doc.bytes()
}
