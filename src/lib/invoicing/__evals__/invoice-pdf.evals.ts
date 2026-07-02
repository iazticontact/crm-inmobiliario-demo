// Evals del PDF de factura (P36B) — EJECUTABLE, sin I/O de red. Verifica que el PDF vectorial es válido
// (%PDF…%%EOF, streams), que los acentos y el € salen bien (WinAnsi), que NO hay glifos rotos ("???") y
// que degrada con elegancia cuando faltan datos del emisor/cliente (sin "No consta" por todas partes).
// `runInvoicePdfEvals()` devuelve los fallos (vacío = OK).

import { buildInvoicePdfBytes } from '../invoice-pdf'
import type { InvoiceItem } from '../types'

const item = (over: Partial<InvoiceItem> = {}): InvoiceItem => ({
  id: '1', invoice_id: 'x', workspace_id: 'w', description: 'Comisión de gestión inmobiliaria (Peña & Muñoz)',
  quantity: 1, unit_price: 1000, discount_rate: 0, tax_rate: 21, withholding_rate: 0,
  line_subtotal: 1000, line_tax_total: 210, line_withholding_total: 0, line_total: 1210, sort_order: 0, ...over,
})

export function runInvoicePdfEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

  const bytes = buildInvoicePdfBytes({
    display: 'FAC-A/2026/0001', status: 'issued', issueDate: '2026-07-02', dueDate: '2026-07-17', currency: 'EUR',
    subtotal: 1000, taxTotal: 210, withholdingTotal: 0, total: 1210,
    notes: 'Símbolos á é í ó ú ñ « » € — acentos correctos.',
    issuer: { legalName: 'Inmobiliaria Peña S.L.', taxId: 'B12345678', address: 'Calle Mayor 1', postalCode: '48001', city: 'Bilbao', province: 'Bizkaia', country: 'España', email: 'hola@pena.es', phone: '+34 944 000 000', website: 'www.pena.es' },
    customer: { name: 'José María Gómez', taxId: '12345678Z', email: 'jose@example.com', country: 'España' },
  }, [item(), item({ id: '2', description: 'Tramitación', quantity: 2, unit_price: 150, line_subtotal: 300, line_tax_total: 63, line_total: 363 })])
  const s = dec(bytes)
  ok(s.startsWith('%PDF-1.4'), 'header %PDF-1.4')
  ok(s.trimEnd().endsWith('%%EOF'), 'termina en %%EOF')
  ok(s.includes('endstream'), 'contiene stream')
  ok(bytes.includes(0xf3), 'byte acento ó (0xF3)')
  ok(bytes.includes(0x80), 'byte € (0x80)')
  ok(!s.includes('???'), 'sin glifos rotos ???')
  ok(bytes.length > 1500, `tamaño razonable (${bytes.length})`)

  // Emisor/cliente vacíos → PDF válido y SIN "No consta"
  const empty = buildInvoicePdfBytes({
    display: null, status: 'draft', issueDate: '2026-07-02', dueDate: null, currency: 'EUR',
    subtotal: 1000, taxTotal: 210, withholdingTotal: 0, total: 1210, notes: null,
    issuer: {}, customer: {},
  }, [item()])
  const es = dec(empty)
  ok(es.startsWith('%PDF-1.4') && es.trimEnd().endsWith('%%EOF'), 'PDF vacío válido')
  ok(!es.includes('No consta'), 'sin "No consta"')

  // Divisa extranjera con nota de tipo de cambio
  const usd = buildInvoicePdfBytes({
    display: 'FAC-A/2026/0002', status: 'issued', issueDate: '2026-07-02', dueDate: null, currency: 'USD',
    subtotal: 1000, taxTotal: 0, withholdingTotal: 0, total: 1000, notes: null,
    issuer: { legalName: 'X S.L.', taxId: 'B1', email: 'x@x.es' }, customer: { name: 'Client Inc.' },
    exchange: { currency: 'USD', rate: 0.92, date: '2026-07-02', source: 'Manual' },
  }, [item({ tax_rate: 0, line_tax_total: 0, line_total: 1000 })])
  const us = dec(usd)
  ok(us.startsWith('%PDF-1.4') && us.trimEnd().endsWith('%%EOF'), 'PDF USD válido')
  ok(us.includes('Tipo de cambio de referencia') && us.includes('USD'), 'nota de tipo de cambio')
  ok(!us.includes('???'), 'USD sin glifos rotos')

  return fail
}
