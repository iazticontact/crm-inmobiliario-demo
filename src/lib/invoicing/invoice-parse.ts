// Parser de factura por TEXTO (P36A) — PURO, determinista, LOCAL (sin LLM, sin n8n, sin red). Vive en el
// MÓDULO Facturación, NO en el Asistente IA general. Adapta ideas de auto-factor/parsePrompt.ts al CRM:
// resuelve cliente contra la lista real (bajo RLS, la pasa el llamante) y devuelve un BORRADOR editable +
// confianza + avisos + campos pendientes. Nunca crea nada: el usuario revisa y confirma después.

import { round2 } from './calc'
import type { InvoiceFormData, InvoiceFormItem } from './invoice-repo'

type ClientLite = { id: string; name: string }

export type InvoiceParseResult = {
  draft: InvoiceFormData
  confidence: number
  warnings: string[]
  missingFields: string[]      // 'cliente' | 'importe' | 'concepto'
  detected: {
    clientName: string | null
    concept: string | null
    amount: number | null
    taxRate: number | null
    withholdingRate: number | null
    discountRate: number | null
    dueDate: string | null
    series: string | null
    ambiguousClients?: string[]
  }
}

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}
function toNumberEs(raw: string): number | null {
  let s = raw.replace(/\s/g, '')
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (s.includes(',')) s = s.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}
const todayIso = () => new Date().toISOString().slice(0, 10)
function addDaysIso(base: string, days: number): string {
  const d = new Date(base); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10)
}
function endOfMonthIso(base: string): string {
  const d = new Date(base); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
}

function parseAmount(text: string): number | null {
  const m = text.match(/(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(?:€|eur(?:os)?)/i)
  if (!m) {
    const m2 = text.match(/(?:importe|precio|por|de)\s+(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/i)
    return m2 ? toNumberEs(m2[1]) : null
  }
  return toNumberEs(m[1])
}
function parseTax(n: string): { rate: number; included: boolean } {
  if (/\bsin\s+iva\b/.test(n) || /\biva\s+0\s*%?/.test(n) || /\bexento\b/.test(n)) return { rate: 0, included: false }
  const m = n.match(/iva\s*(?:del?\s*)?(\d{1,2})\s*%?/) || n.match(/(\d{1,2})\s*%\s*(?:de\s*)?iva/)
  const rate = m ? Number(m[1]) : 21 // por defecto IVA general
  // ¿el importe escrito es bruto (IVA incluido) o neto (IVA aparte)?
  const excluded = /(m[aá]s\s+iva|\+\s*iva|iva\s+(?:no\s+incluido|aparte|excluido|no\s+incl)|sin\s+incluir|base\s+imponible)/.test(n)
  const included = !excluded && /(iva\s+incl(?:uido|\.)?|impuestos?\s+incluidos?|con\s+impuestos|precio\s+final|total\s+con\s+iva)/.test(n)
  return { rate, included }
}
function parseNotes(text: string): string | null {
  const m = text.match(/\b(?:nota|notas|observaciones)\s*[:\-]\s*(.+)$/i)
  const note = m ? m[1].trim() : null
  return note && note.length > 1 ? note : null
}
function parseWithholding(n: string): number {
  const m = n.match(/(?:irpf|retenci[oó]n)\s*(?:del?\s*)?(\d{1,2})\s*%?/) || n.match(/(\d{1,2})\s*%\s*(?:de\s*)?(?:irpf|retenci[oó]n)/)
  return m ? Number(m[1]) : 0
}
function parseDiscount(n: string): number {
  const m = n.match(/(?:descuento|dto\.?)\s*(?:del?\s*)?(\d{1,2})\s*%?/) || n.match(/(\d{1,2})\s*%\s*(?:de\s*)?(?:descuento|dto)/)
  return m ? Number(m[1]) : 0
}
function parseDue(n: string, issueDate: string): string | null {
  const m = n.match(/(?:vencimiento|venc\.?|pago)\s*(?:a|en|de)?\s*(\d{1,3})\s*d[ií]as/) || n.match(/\ba\s+(\d{1,3})\s+d[ií]as\b/)
  if (m) return addDaysIso(issueDate, Number(m[1]))
  if (/\b(final|fin)\s+de\s+mes\b/.test(n)) return endOfMonthIso(issueDate)
  return null
}
function parseSeries(n: string): string | null {
  const m = n.match(/\bserie\s+([a-z0-9]{1,4})\b/)
  return m ? m[1].toUpperCase() : null
}
function parseConcept(text: string): string | null {
  const m = text.match(/\b(?:por|concepto|factura de|factura por)\s+([^,.;]+?)(?:\s+(?:con|por|de|y|,|\.|;|iva|irpf|vencimiento|descuento|serie|\+|\b\d)|$)/i)
  if (m) { const c = m[1].trim().replace(/\s+/g, ' '); if (c.length > 2) return c }
  return null
}
function matchClient(text: string, clients: ClientLite[]): { id: string | null; name: string | null; ambiguous: string[] } {
  const n = fold(text)
  const hits = clients.filter((c) => { const cn = fold(c.name); return cn.length > 2 && n.includes(cn) })
  if (hits.length === 1) return { id: hits[0].id, name: hits[0].name, ambiguous: [] }
  if (hits.length > 1) return { id: null, name: null, ambiguous: hits.slice(0, 5).map((c) => c.name) }
  // "factura a/para <Nombre>" como pista aunque no exista cliente
  const m = text.match(/\bfactura\s+(?:a|para)\s+([A-ZÁÉÍÓÚÑ][^,.;0-9€]+?)(?:\s+(?:por|de|con|,|\.|;|\b\d)|$)/)
  return { id: null, name: m ? m[1].trim() : null, ambiguous: [] }
}

export function parseInvoiceText(text: string, clients: ClientLite[] = []): InvoiceParseResult {
  const raw = (text ?? '').trim()
  const n = fold(raw)
  const issueDate = todayIso()

  const amount = parseAmount(raw)
  const tax = parseTax(n)
  const withholdingRate = parseWithholding(n)
  const discountRate = parseDiscount(n)
  const dueDate = parseDue(n, issueDate)
  const series = parseSeries(n)
  const concept = parseConcept(raw)
  const notes = parseNotes(raw)
  const client = matchClient(raw, clients)

  // "IVA incluido": el importe escrito es BRUTO → calculamos la base para no facturar de más.
  let unitPrice = amount ?? 0
  const warnings: string[] = []
  if (amount != null && tax.included && tax.rate > 0) {
    unitPrice = round2(amount / (1 + tax.rate / 100))
    warnings.push(`IVA incluido: la base se ha calculado como ${unitPrice} (revísala).`)
  }
  if (client.ambiguous.length) warnings.push(`Varios clientes coinciden (${client.ambiguous.join(', ')}). Elige uno.`)

  const missingFields: string[] = []
  if (!client.id && !client.name) missingFields.push('cliente')
  if (amount == null) missingFields.push('importe')
  if (!concept) missingFields.push('concepto')

  let score = 0
  if (client.id) score += 30; else if (client.name) score += 10
  if (amount != null) score += 30
  if (concept) score += 20
  if (tax.rate != null) score += 10
  if (dueDate) score += 10

  const item: InvoiceFormItem = {
    description: concept ?? '',
    quantity: 1,
    unitPrice,
    discountRate,
    taxRate: tax.rate,
    withholdingRate,
    sortOrder: 0,
  }
  const draft: InvoiceFormData = {
    clientId: client.id,
    propertyId: null,
    opportunityId: null,
    series: series ?? 'A',
    issueDate,
    dueDate,
    currency: 'EUR',
    notes: notes ?? '',
    internalNotes: '',
    items: [item],
  }

  return {
    draft,
    confidence: Math.min(100, score),
    warnings,
    missingFields,
    detected: {
      clientName: client.name, concept, amount, taxRate: tax.rate, withholdingRate, discountRate, dueDate, series,
      ...(client.ambiguous.length ? { ambiguousClients: client.ambiguous } : {}),
    },
  }
}
