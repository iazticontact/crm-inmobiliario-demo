'use client'

// Mini dashboard financiero/fiscal de Facturación (P36D) — ORIENTATIVO para gestión interna (NO es una
// declaración fiscal). Cálculos en invoice-summary (puro/testeable). Gráficos con CSS/SVG, sin dependencias.

import { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { formatInvoiceCurrency } from '@/lib/invoicing/calc'
import { computeInvoiceSummary, type SummaryPeriod } from '@/lib/invoicing/invoice-summary'
import type { InvoiceListRow } from '@/lib/invoicing/invoice-repo'

const PERIODS: { key: SummaryPeriod; label: string }[] = [
  { key: 'month', label: 'Este mes' }, { key: 'quarter', label: 'Trimestre' }, { key: 'year', label: 'Año' }, { key: 'all', label: 'Todo' },
]

export function InvoiceDashboard({ rows, currency }: { rows: InvoiceListRow[]; currency: string }) {
  const [period, setPeriod] = useState<SummaryPeriod>('year')
  const s = useMemo(() => computeInvoiceSummary(rows, period), [rows, period])
  const money = (n: number) => formatInvoiceCurrency(n, currency || 'EUR')

  const collectTotal = Math.max(1, s.collect.paid + s.collect.pending + s.collect.overdue)
  const monthlyMax = Math.max(1, ...s.monthly.map((m) => m.total))
  const topMax = Math.max(1, ...s.topClients.map((c) => c.total))

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Resumen fiscal y financiero</h2>
        <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${period === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-4 flex items-center gap-1 text-[11px] text-gray-400"><Info className="h-3 w-3" /> Resumen orientativo basado en tus facturas. Revísalo con tu asesor fiscal antes de presentar impuestos.</p>

      {/* KPIs de cobro */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Metric label="Facturado" value={money(s.facturado)} sub={`${s.countIssued} emitidas`} />
        <Metric label="Cobrado" value={money(s.cobrado)} tone="emerald" />
        <Metric label="Pendiente de cobro" value={money(s.pendiente)} tone="indigo" />
        <Metric label="Vencido" value={money(s.vencido)} tone={s.vencido > 0 ? 'red' : undefined} />
      </div>

      {/* KPIs fiscales */}
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Metric label="Base imponible" value={money(s.base)} small />
        <Metric label="IVA repercutido" value={money(s.iva)} small />
        <Metric label="IRPF retenido" value={money(s.irpf)} small />
        <Metric label="Neto orientativo" value={money(s.neto)} small hint="Base − IRPF" />
      </div>

      {/* Gráficos */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Cobro */}
        <div className="rounded-xl border border-gray-100 p-3.5">
          <p className="mb-2 text-xs font-semibold text-gray-700">Estado de cobro</p>
          {s.collect.paid + s.collect.pending + s.collect.overdue === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400">Sin importes en este periodo.</p>
          ) : (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
                <div className="bg-emerald-500" style={{ width: `${(s.collect.paid / collectTotal) * 100}%` }} />
                <div className="bg-indigo-500" style={{ width: `${(s.collect.pending / collectTotal) * 100}%` }} />
                <div className="bg-red-500" style={{ width: `${(s.collect.overdue / collectTotal) * 100}%` }} />
              </div>
              <div className="mt-2.5 space-y-1 text-[11px]">
                <Legend color="bg-emerald-500" label="Cobrado" value={money(s.collect.paid)} />
                <Legend color="bg-indigo-500" label="Pendiente" value={money(s.collect.pending)} />
                <Legend color="bg-red-500" label="Vencido" value={money(s.collect.overdue)} />
              </div>
            </>
          )}
        </div>

        {/* Evolución mensual */}
        <div className="rounded-xl border border-gray-100 p-3.5">
          <p className="mb-2 text-xs font-semibold text-gray-700">Facturación (últimos 6 meses)</p>
          <div className="flex h-24 items-end gap-2">
            {s.monthly.map((m) => (
              <div key={m.ym} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t bg-indigo-500/85" style={{ height: `${Math.max(2, (m.total / monthlyMax) * 100)}%` }} title={money(m.total)} />
                </div>
                <span className="text-[9px] text-gray-400">{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Por estado */}
        <div className="rounded-xl border border-gray-100 p-3.5">
          <p className="mb-2 text-xs font-semibold text-gray-700">Facturación por estado</p>
          {s.byStatus.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400">Sin facturas en este periodo.</p>
          ) : (
            <div className="space-y-2">
              {s.byStatus.map((b) => (
                <div key={b.key} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{b.label} <span className="text-gray-400">· {b.count}</span></span>
                  <span className="font-medium tabular-nums text-gray-800">{money(b.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top clientes */}
        <div className="rounded-xl border border-gray-100 p-3.5">
          <p className="mb-2 text-xs font-semibold text-gray-700">Top clientes facturados</p>
          {s.topClients.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400">Sin facturación en este periodo.</p>
          ) : (
            <div className="space-y-2">
              {s.topClients.map((c) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="truncate pr-2 text-gray-600">{c.name}</span>
                    <span className="font-medium tabular-nums text-gray-800">{money(c.total)}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-indigo-500/80" style={{ width: `${(c.total / topMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, sub, tone, small, hint }: { label: string; value: string; sub?: string; tone?: 'emerald' | 'indigo' | 'red'; small?: boolean; hint?: string }) {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'indigo' ? 'text-indigo-600' : tone === 'red' ? 'text-red-600' : 'text-gray-900'
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 px-3.5 py-3">
      <p className="text-[11px] font-medium text-gray-500">{label}{hint ? <span className="text-gray-300"> · {hint}</span> : null}</p>
      <p className={`mt-1 font-semibold tabular-nums ${small ? 'text-base' : 'text-lg'} ${color}`}>{value}</p>
      {sub ? <p className="text-[10px] text-gray-400">{sub}</p> : null}
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-gray-600"><span className={`h-2 w-2 rounded-full ${color}`} /> {label}</span>
      <span className="font-medium tabular-nums text-gray-800">{value}</span>
    </div>
  )
}
