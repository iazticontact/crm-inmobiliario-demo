'use client'

import { useState, useRef, useEffect } from 'react'
import { DollarSign, Clock, CheckCircle, Bot, Download, Plus, X, Check } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { invoices as initialInvoices, revenueByPlan } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import type { Invoice, InvoiceStatus } from '@/lib/types'

const statusConfig: Record<InvoiceStatus, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  paid: { label: 'Pagada', variant: 'success' },
  pending: { label: 'Pendiente', variant: 'warning' },
  overdue: { label: 'Vencida', variant: 'danger' },
}

const planColors = ['#4f46e5', '#7c3aed', '#0ea5e9', '#10b981']

const emptyForm = { clientName: '', amount: '', plan: 'Pro', dueDate: '2026-06-15' }

export default function BillingPage() {
  const [invoiceList, setInvoiceList] = useState<Invoice[]>(initialInvoices)
  const [invoiceStatuses, setInvoiceStatuses] = useState<Record<string, InvoiceStatus>>(
    Object.fromEntries(initialInvoices.map((inv) => [inv.id, inv.status]))
  )
  const [markingPaid, setMarkingPaid] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all')
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setModalOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const handleMarkPaid = async (inv: Invoice) => {
    setMarkingPaid(inv.id)
    await new Promise((r) => setTimeout(r, 700))
    setInvoiceStatuses((prev) => ({ ...prev, [inv.id]: 'paid' }))
    setMarkingPaid(null)
    toast.success(`Factura ${inv.id} marcada como pagada`, { description: `${inv.clientName} · €${inv.amount}` })
  }

  const handleSave = async () => {
    if (!form.clientName.trim() || !form.amount) {
      toast.error('Cliente e importe son obligatorios')
      return
    }
    setSaving(true)
    await new Promise((r) => setTimeout(r, 600))
    const newId = `F-2026-${String(invoiceList.length + 1).padStart(3, '0')}`
    const newInvoice: Invoice = {
      id: newId,
      clientName: form.clientName.trim(),
      amount: Number(form.amount),
      status: 'pending',
      date: '2026-05-05',
      dueDate: form.dueDate,
      plan: form.plan,
    }
    setInvoiceList((prev) => [newInvoice, ...prev])
    setInvoiceStatuses((prev) => ({ ...prev, [newId]: 'pending' }))
    setSaving(false)
    setModalOpen(false)
    setForm(emptyForm)
    toast.success(`Factura creada: ${newId}`, { description: `${newInvoice.clientName} · €${newInvoice.amount}` })
  }

  const billingMetrics = [
    { label: 'Total facturado', value: '€44.383', icon: <DollarSign className="h-5 w-5" />, color: 'bg-indigo-50 text-indigo-600' },
    { label: 'Pendiente de cobro', value: `€${invoiceList.filter((inv) => invoiceStatuses[inv.id] !== 'paid').reduce((s, inv) => s + inv.amount, 0).toLocaleString()}`, icon: <Clock className="h-5 w-5" />, color: 'bg-amber-50 text-amber-600' },
    { label: 'Cobrado este mes', value: '€42.890', icon: <CheckCircle className="h-5 w-5" />, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Automatizado por IA', value: '€32.450', icon: <Bot className="h-5 w-5" />, color: 'bg-violet-50 text-violet-600' },
  ]

  const filteredInvoices = invoiceList.filter((inv) => statusFilter === 'all' || (invoiceStatuses[inv.id] ?? inv.status) === statusFilter)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Facturación"
        description="Ingresos y estado de cobros"
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => toast.success('Exportando informe...', { description: 'Se descargará en unos segundos.' })}>
              <Download className="h-3.5 w-3.5" />
              Exportar
            </Button>
            <Button size="sm" onClick={() => setModalOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Nueva factura
            </Button>
          </div>
        }
      />

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {billingMetrics.map(({ label, value, icon, color }) => (
          <div key={label} className="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">{label}</p>
                <p className="mt-1.5 text-2xl font-bold text-gray-900">{value}</p>
              </div>
              <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', color)}>
                {icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Invoice table */}
        <SectionCard
          className="lg:col-span-2"
          title="Facturas"
          description={`${filteredInvoices.length} visibles de ${invoiceList.length} facturas`}
          noPadding
          action={
            <div className="flex items-center gap-1">
              <button
                className={cn('rounded px-2 py-0.5 text-[10px] font-medium transition-colors', statusFilter === 'all' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100')}
                onClick={() => setStatusFilter('all')}
              >
                Todas
              </button>
              {(['paid', 'pending', 'overdue'] as InvoiceStatus[]).map((s) => (
                <button
                  key={s}
                  className={cn('rounded px-2 py-0.5 text-[10px] font-medium transition-colors', statusFilter === s ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100')}
                  onClick={() => setStatusFilter(s)}
                >
                  {statusConfig[s].label}
                </button>
              ))}
            </div>
          }
        >
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                {['Factura', 'Cliente', 'Plan', 'Importe', 'Vencimiento', 'Estado', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv, i) => {
                const currentStatus = invoiceStatuses[inv.id] ?? inv.status
                const cfg = statusConfig[currentStatus]
                const isMarkingThis = markingPaid === inv.id
                return (
                  <tr key={inv.id} className={cn('border-b border-gray-50 hover:bg-gray-50 transition-colors', i === filteredInvoices.length - 1 && 'border-b-0')}>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono font-semibold text-gray-700">{inv.id}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-gray-800">{inv.clientName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-500">{inv.plan}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-bold text-gray-900">€{inv.amount}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs', currentStatus === 'overdue' ? 'text-red-500 font-semibold' : 'text-gray-500')}>
                        {inv.dueDate}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={cfg.variant} dot>{cfg.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {currentStatus !== 'paid' ? (
                        <button
                          disabled={isMarkingThis}
                          onClick={() => handleMarkPaid(inv)}
                          className="flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {isMarkingThis ? (
                            <span className="h-3 w-3 animate-spin rounded-full border border-emerald-600 border-t-transparent" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          {isMarkingThis ? 'Procesando...' : 'Marcar pagada'}
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </SectionCard>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Revenue by plan */}
          <SectionCard title="Ingresos por plan" description="Desglose mensual">
            <div className="space-y-2.5 mb-4">
              {revenueByPlan.map(({ plan, revenue, count }, i) => (
                <div key={plan}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: planColors[i] }} />
                      <span className="text-xs font-medium text-gray-700">{plan}</span>
                      <span className="text-[10px] text-gray-400">{count} clientes</span>
                    </div>
                    <span className="text-xs font-bold text-gray-900">€{revenue.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${(revenue / 15000) * 100}%`, background: planColors[i] }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={revenueByPlan} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="plan" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 11 }}
                  formatter={(value) => [`€${Number(value).toLocaleString()}`, 'Ingresos']}
                />
                <Bar dataKey="revenue" radius={[6, 6, 0, 0]} maxBarSize={36}>
                  {revenueByPlan.map((_, i) => (
                    <Cell key={i} fill={planColors[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>

          {/* AI automation stats */}
          <SectionCard title="Automatización de cobros IA">
            <div className="space-y-3">
              {[
                { label: 'Recordatorios enviados', value: '438', sub: 'este mes', color: 'text-indigo-600' },
                { label: 'Cobros recuperados', value: '€8.234', sub: 'automatizados', color: 'text-emerald-600' },
                { label: 'Tasa de éxito', value: '88,4%', sub: 'en recordatorios', color: 'text-violet-600' },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <p className="text-xs text-gray-600">{label}</p>
                  <div className="text-right">
                    <p className={cn('text-sm font-bold', color)}>{value}</p>
                    <p className="text-[10px] text-gray-400">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              className="mt-3 w-full rounded-lg bg-indigo-50 border border-indigo-100 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 transition-colors"
              onClick={() => toast.success('Recordatorios enviados', { description: 'Se han enviado recordatorios a los 3 clientes con facturas vencidas.' })}
            >
              Enviar recordatorios ahora
            </button>
          </SectionCard>
        </div>
      </div>

      {/* New invoice modal */}
      {modalOpen && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) setModalOpen(false) }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                  <DollarSign className="h-4 w-4 text-indigo-600" />
                </div>
                <h2 className="text-sm font-semibold text-gray-900">Nueva factura</h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Cliente *</label>
                <input
                  type="text"
                  placeholder="Nombre del cliente o empresa"
                  value={form.clientName}
                  onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Importe (€) *</label>
                  <input
                    type="number"
                    placeholder="299"
                    min={0}
                    value={form.amount}
                    onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Plan</label>
                  <select
                    value={form.plan}
                    onChange={(e) => setForm((p) => ({ ...p, plan: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  >
                    <option>Starter</option>
                    <option>Pro</option>
                    <option>Business</option>
                    <option>Enterprise</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Fecha de vencimiento</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button size="sm" loading={saving} onClick={handleSave}>Crear factura</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
