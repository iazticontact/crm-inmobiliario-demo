'use client'

// Vista previa de factura (P36B) — refleja fielmente el PDF final (misma estructura y jerarquía): cabecera
// con logo/emisor, título FACTURA + número + estado + fechas, bloques DE / FACTURAR A, tabla de conceptos
// con importes a la derecha, caja de totales destacada, notas y footer. Presentacional y puro. Se usa como
// preview en el editor; lo que ve el usuario ≈ lo que descarga.

import Image from 'next/image'
import { calcLineTotals, formatInvoiceCurrency, round2 } from '@/lib/invoicing/calc'
import { INVOICE_STATUS_LABEL, type InvoiceStatus, type IssuerSnapshot, type CustomerSnapshot } from '@/lib/invoicing/types'
import type { InvoiceFormItem } from '@/lib/invoicing/invoice-repo'

const STATUS_DOT: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-400', issued: 'bg-indigo-500', sent: 'bg-sky-500', paid: 'bg-emerald-500',
  overdue: 'bg-red-500', cancelled: 'bg-amber-500', void: 'bg-gray-400',
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
const has = (v: string | null | undefined): v is string => !!(v && String(v).trim())

export function InvoicePreview({ issuer, customer, displayNumber, status, issueDate, dueDate, currency, notes, items }: {
  issuer: IssuerSnapshot | null
  customer: CustomerSnapshot | null
  displayNumber: string | null
  status: InvoiceStatus
  issueDate: string
  dueDate: string | null
  currency: string
  notes: string
  items: InvoiceFormItem[]
}) {
  const money = (n: number) => formatInvoiceCurrency(n, currency || 'EUR')
  const issuerName = has(issuer?.legalName) ? issuer!.legalName! : 'Tu empresa'
  const custName = has(customer?.name) ? customer!.name! : 'Cliente sin especificar'
  const issuerCity = [issuer?.postalCode, issuer?.city, issuer?.province].filter(has).join(' ')

  const lines = items.map((it) => ({ it, t: calcLineTotals({ quantity: it.quantity, unitPrice: it.unitPrice, taxRate: it.taxRate, withholdingRate: it.withholdingRate, discountRate: it.discountRate }) }))
  const subtotal = round2(lines.reduce((a, l) => a + l.t.lineSubtotal, 0))
  const taxTotal = round2(lines.reduce((a, l) => a + l.t.lineTaxTotal, 0))
  const withholdingTotal = round2(lines.reduce((a, l) => a + l.t.lineWithholdingTotal, 0))
  const discountTotal = round2(lines.reduce((a, l) => a + (round2(l.it.quantity * l.it.unitPrice) - l.t.lineSubtotal), 0))
  const total = round2(subtotal + taxTotal - withholdingTotal)

  return (
    <div className="mx-auto w-full max-w-[640px] rounded-xl border border-gray-200 bg-white p-6 text-gray-900 shadow-sm sm:p-8">
      {/* Cabecera */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {has(issuer?.logoUrl) ? (
            <Image src={issuer!.logoUrl!} alt={issuerName} width={150} height={52} className="h-12 w-auto max-w-[160px] object-contain" unoptimized />
          ) : (
            <p className="text-base font-bold leading-tight text-gray-900">{issuerName}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tracking-tight text-gray-900">FACTURA</p>
          <p className="mt-0.5 text-xs text-gray-500">{displayNumber ? `Nº ${displayNumber}` : 'Borrador (sin numerar)'}</p>
          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} /> {INVOICE_STATUS_LABEL[status]}
          </span>
          <p className="mt-2 text-[11px] text-gray-600">Emisión: <span className="font-medium">{fmtDate(issueDate)}</span></p>
          {has(dueDate) && <p className="text-[11px] text-gray-600">Vencimiento: <span className="font-medium">{fmtDate(dueDate)}</span></p>}
        </div>
      </div>

      <div className="my-4 h-px bg-gray-100" />

      {/* DE / FACTURAR A */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">De</p>
          <p className="text-sm font-semibold text-gray-900">{issuerName}</p>
          <div className="mt-0.5 space-y-0.5 text-[11px] leading-4 text-gray-500">
            {has(issuer?.taxId) && <p>NIF/CIF: {issuer!.taxId}</p>}
            {has(issuer?.address) && <p>{issuer!.address}</p>}
            {issuerCity && <p>{issuerCity}</p>}
            {has(issuer?.country) && <p>{issuer!.country}</p>}
            {has(issuer?.email) && <p>{issuer!.email}</p>}
            {has(issuer?.phone) && <p>{issuer!.phone}</p>}
            {has(issuer?.website) && <p>{issuer!.website}</p>}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">Facturar a</p>
          <p className="text-sm font-semibold text-gray-900">{custName}</p>
          <div className="mt-0.5 space-y-0.5 text-[11px] leading-4 text-gray-500">
            {has(customer?.taxId) && <p>NIF/CIF: {customer!.taxId}</p>}
            {has(customer?.address) && <p>{customer!.address}</p>}
            {has(customer?.country) && <p>{customer!.country}</p>}
            {has(customer?.email) && <p>{customer!.email}</p>}
            {has(customer?.phone) && <p>{customer!.phone}</p>}
          </div>
        </div>
      </div>

      {/* Conceptos */}
      <div className="mt-5 overflow-hidden rounded-lg border border-gray-100">
        <div className="grid grid-cols-12 gap-2 bg-gray-900 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-white">
          <span className="col-span-6">Descripción</span>
          <span className="col-span-2 text-right">Cant.</span>
          <span className="col-span-2 text-right">Precio</span>
          <span className="col-span-2 text-right">Importe</span>
        </div>
        {lines.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-400">Sin conceptos.</p>
        ) : lines.map(({ it, t }, i) => (
          <div key={i} className={`grid grid-cols-12 gap-2 px-3 py-2 text-xs ${i % 2 ? 'bg-gray-50/60' : 'bg-white'}`}>
            <div className="col-span-6 min-w-0">
              <p className="truncate font-medium text-gray-800">{has(it.description) ? it.description : '(sin descripción)'}</p>
              <p className="text-[10px] text-gray-400">
                IVA {it.taxRate}%{it.discountRate ? ` · Dto. ${it.discountRate}%` : ''}{it.withholdingRate ? ` · IRPF ${it.withholdingRate}%` : ''}
              </p>
            </div>
            <span className="col-span-2 text-right tabular-nums text-gray-700">{it.quantity}</span>
            <span className="col-span-2 text-right tabular-nums text-gray-700">{money(it.unitPrice)}</span>
            <span className="col-span-2 text-right font-semibold tabular-nums text-gray-900">{money(t.lineTotal)}</span>
          </div>
        ))}
      </div>

      {/* Totales */}
      <div className="mt-4 flex justify-end">
        <div className="w-full max-w-[260px] space-y-1 text-xs">
          {discountTotal > 0 && <div className="flex justify-between text-gray-500"><span>Descuentos</span><span className="tabular-nums">−{money(discountTotal)}</span></div>}
          <div className="flex justify-between text-gray-500"><span>Base imponible</span><span className="tabular-nums">{money(subtotal)}</span></div>
          <div className="flex justify-between text-gray-500"><span>IVA</span><span className="tabular-nums">{money(taxTotal)}</span></div>
          {withholdingTotal > 0 && <div className="flex justify-between text-gray-500"><span>Retención IRPF</span><span className="tabular-nums">−{money(withholdingTotal)}</span></div>}
          <div className="mt-1 flex items-center justify-between rounded-lg border-l-2 border-indigo-500 bg-indigo-50/60 px-3 py-2">
            <span className="text-sm font-bold text-gray-900">TOTAL</span>
            <span className="text-sm font-bold tabular-nums text-indigo-700">{money(total)}</span>
          </div>
        </div>
      </div>

      {has(notes) && (
        <div className="mt-5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">Notas</p>
          <p className="whitespace-pre-wrap text-[11px] leading-4 text-gray-500">{notes.trim()}</p>
        </div>
      )}

      <div className="mt-5 border-t border-gray-100 pt-2 text-[10px] text-gray-400">
        {[issuerName, has(issuer?.taxId) ? issuer!.taxId! : null, has(issuer?.email) ? issuer!.email! : null].filter(Boolean).join('  ·  ')}
      </div>
    </div>
  )
}
