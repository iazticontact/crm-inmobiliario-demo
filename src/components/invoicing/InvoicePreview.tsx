'use client'

// Vista previa de factura (P36C) — refleja fielmente el PDF final: cabecera con logo/emisor + título,
// banda de metadatos (número · emisión · vencimiento · estado), tarjetas EMISOR / FACTURAR A, tabla de
// conceptos con importes a la derecha, panel de totales con TOTAL destacado, notas/condiciones y footer.
// Presentacional y puro. Lo que ve el usuario ≈ lo que descarga.

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

function Party({ label, name, lines }: { label: string; name: string; lines: string[] }) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-gray-50 p-3.5 pl-4">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-indigo-500" />
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-indigo-600">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{name}</p>
      <div className="mt-0.5 space-y-0.5 text-[11px] leading-4 text-gray-500">
        {lines.map((l, i) => <p key={i}>{l}</p>)}
      </div>
    </div>
  )
}

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

  const issuerLines = [
    has(issuer?.taxId) ? `NIF/CIF: ${issuer!.taxId}` : null,
    issuer?.address ?? null, issuerCity || null, issuer?.country ?? null,
    [issuer?.email, issuer?.phone, issuer?.website].filter(has).join('  ·  ') || null,
  ].filter(has) as string[]
  const custLines = [
    has(customer?.taxId) ? `NIF/CIF: ${customer!.taxId}` : null,
    customer?.address ?? null, customer?.country ?? null,
    [customer?.email, customer?.phone].filter(has).join('  ·  ') || null,
  ].filter(has) as string[]

  const lines = items.map((it) => ({ it, t: calcLineTotals({ quantity: it.quantity, unitPrice: it.unitPrice, taxRate: it.taxRate, withholdingRate: it.withholdingRate, discountRate: it.discountRate }) }))
  const subtotal = round2(lines.reduce((a, l) => a + l.t.lineSubtotal, 0))
  const taxTotal = round2(lines.reduce((a, l) => a + l.t.lineTaxTotal, 0))
  const withholdingTotal = round2(lines.reduce((a, l) => a + l.t.lineWithholdingTotal, 0))
  const discountTotal = round2(lines.reduce((a, l) => a + (round2(l.it.quantity * l.it.unitPrice) - l.t.lineSubtotal), 0))
  const total = round2(subtotal + taxTotal - withholdingTotal)

  const meta: { label: string; value: string; pill?: boolean }[] = [
    { label: 'Número', value: displayNumber ?? 'Borrador' },
    { label: 'Emisión', value: fmtDate(issueDate) },
    { label: 'Vencimiento', value: fmtDate(dueDate) },
    { label: 'Estado', value: INVOICE_STATUS_LABEL[status], pill: true },
  ]

  return (
    <div className="mx-auto w-full max-w-[660px] rounded-xl border border-gray-200 bg-white p-6 text-gray-900 shadow-sm sm:p-9">
      {/* Cabecera */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {has(issuer?.logoUrl) ? (
            <Image src={issuer!.logoUrl!} alt={issuerName} width={168} height={58} className="h-14 w-auto max-w-[180px] object-contain" unoptimized />
          ) : (
            <p className="text-lg font-bold leading-tight text-gray-900">{issuerName}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[26px] font-bold leading-none tracking-tight text-gray-900">FACTURA</p>
          <p className="mt-1 text-xs text-gray-500">{displayNumber ? `Nº ${displayNumber}` : 'Borrador · sin numerar'}</p>
        </div>
      </div>
      <div className="mt-3 h-[2.5px] rounded bg-indigo-500" />

      {/* Banda de metadatos */}
      <div className="mt-4 grid grid-cols-2 divide-gray-200 rounded-lg bg-gray-50 sm:grid-cols-4 sm:divide-x">
        {meta.map((m) => (
          <div key={m.label} className="px-3.5 py-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">{m.label}</p>
            {m.pill ? (
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700 ring-1 ring-gray-200">
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} /> {m.value}
              </span>
            ) : (
              <p className="mt-0.5 truncate text-sm font-semibold text-gray-900">{m.value}</p>
            )}
          </div>
        ))}
      </div>

      {/* EMISOR / FACTURAR A */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Party label="Emisor" name={issuerName} lines={issuerLines} />
        <Party label="Facturar a" name={custName} lines={custLines} />
      </div>

      {/* Conceptos */}
      <div className="mt-5 overflow-hidden rounded-lg border border-gray-100">
        <div className="grid grid-cols-12 gap-2 bg-gray-900 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          <span className="col-span-6">Descripción</span>
          <span className="col-span-2 text-right">Cant.</span>
          <span className="col-span-2 text-right">Precio</span>
          <span className="col-span-2 text-right">Importe</span>
        </div>
        {lines.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-400">Sin conceptos.</p>
        ) : lines.map(({ it, t }, i) => (
          <div key={i} className={`grid grid-cols-12 gap-2 px-3 py-2.5 text-xs ${i % 2 ? 'bg-gray-50/60' : 'bg-white'}`}>
            <div className="col-span-6 min-w-0">
              <p className="truncate font-medium text-gray-800">{has(it.description) ? it.description : '(sin descripción)'}</p>
              <p className="text-[10px] text-gray-400">
                IVA {it.taxRate}%{it.discountRate ? ` · Dto. ${it.discountRate}%` : ''}{it.withholdingRate ? ` · IRPF ${it.withholdingRate}%` : ''}
              </p>
            </div>
            <span className="col-span-2 text-right tabular-nums text-gray-600">{it.quantity}</span>
            <span className="col-span-2 text-right tabular-nums text-gray-600">{money(it.unitPrice)}</span>
            <span className="col-span-2 text-right font-semibold tabular-nums text-gray-900">{money(t.lineTotal)}</span>
          </div>
        ))}
      </div>

      {/* Notas + Totales */}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {has(notes) && (
            <>
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-indigo-600">Notas y condiciones</p>
              <p className="whitespace-pre-wrap text-[11px] leading-4 text-gray-500">{notes.trim()}</p>
            </>
          )}
        </div>
        <div className="w-full space-y-1 text-xs sm:w-[260px]">
          {discountTotal > 0 && <div className="flex justify-between border-b border-gray-100 pb-1 text-gray-500"><span>Descuentos</span><span className="tabular-nums">−{money(discountTotal)}</span></div>}
          <div className="flex justify-between border-b border-gray-100 pb-1 text-gray-500"><span>Base imponible</span><span className="tabular-nums">{money(subtotal)}</span></div>
          <div className="flex justify-between border-b border-gray-100 pb-1 text-gray-500"><span>IVA</span><span className="tabular-nums">{money(taxTotal)}</span></div>
          {withholdingTotal > 0 && <div className="flex justify-between border-b border-gray-100 pb-1 text-gray-500"><span>Retención IRPF</span><span className="tabular-nums">−{money(withholdingTotal)}</span></div>}
          <div className="mt-1 flex items-center justify-between rounded-lg border-l-[3px] border-indigo-500 bg-indigo-50/70 px-3 py-2.5">
            <span className="text-sm font-bold text-gray-900">TOTAL</span>
            <span className="text-[15px] font-bold tabular-nums text-indigo-700">{money(total)}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 border-t border-gray-100 pt-2.5 text-center text-[10px] text-gray-400">
        {[issuerName, has(issuer?.taxId) ? issuer!.taxId! : null, has(issuer?.email) ? issuer!.email! : null, has(issuer?.website) ? issuer!.website! : null].filter(Boolean).join('   ·   ')}
      </div>
    </div>
  )
}
