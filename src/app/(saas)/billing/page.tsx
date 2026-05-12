'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Check, CheckCircle, Clock, DollarSign, Download, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { invoices as initialInvoices } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { triggerN8nWebhook } from '@/lib/integrations'
import {
  createActivity,
  createInvoice,
  deleteInvoice,
  getInvoices,
  getWorkspaceContext,
  markInvoicePaid,
  updateInvoice,
} from '@/lib/supabase-queries'
import type { Invoice, InvoiceStatus } from '@/lib/types'

const statusConfig: Record<InvoiceStatus, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  paid: { label: 'Pagada', variant: 'success' },
  pending: { label: 'Pendiente', variant: 'warning' },
  overdue: { label: 'Vencida', variant: 'danger' },
}

const planColors = ['#4f46e5', '#7c3aed', '#0ea5e9', '#10b981']

type InvoiceForm = {
  id?: string
  clientName: string
  amount: string
  plan: string
  status: InvoiceStatus
  date: string
  dueDate: string
  notes: string
}

const today = new Date().toISOString().slice(0, 10)
const emptyForm: InvoiceForm = { clientName: '', amount: '', plan: 'Pro', status: 'pending', date: today, dueDate: today, notes: '' }

function toForm(invoice: Invoice): InvoiceForm {
  return {
    id: invoice.id,
    clientName: invoice.clientName,
    amount: String(invoice.amount),
    plan: invoice.plan,
    status: invoice.status,
    date: invoice.date,
    dueDate: invoice.dueDate,
    notes: invoice.notes ?? '',
  }
}

function euro(value: number) {
  return `€${Math.round(value).toLocaleString('es-ES')}`
}

export default function BillingPage() {
  const [invoiceList, setInvoiceList] = useState<Invoice[]>(initialInvoices)
  const [markingPaid, setMarkingPaid] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<InvoiceForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isRealMode, setIsRealMode] = useState(false)
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null)
  const [deleting, setDeleting] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  const loadInvoices = useCallback(async () => {
    const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
    if (isDemoMode) {
      setInvoiceList(initialInvoices)
      setWorkspaceId(null)
      setIsRealMode(false)
      setLoadError('')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError('')
    try {
      const context = await getWorkspaceContext()
      const resolvedWorkspaceId = context?.workspace?.id || context?.profile?.workspace_id
      if (!resolvedWorkspaceId) {
        setInvoiceList(initialInvoices)
        setWorkspaceId(null)
        setIsRealMode(false)
        setLoadError('No se ha encontrado workspace real. Se muestran facturas demo.')
        return
      }

      const realInvoices = await getInvoices(resolvedWorkspaceId)
      setInvoiceList(realInvoices)
      setWorkspaceId(resolvedWorkspaceId)
      setIsRealMode(true)
    } catch (error) {
      setInvoiceList(initialInvoices)
      setWorkspaceId(null)
      setIsRealMode(false)
      const message = error instanceof Error ? error.message : 'Revisa RLS o columnas de invoices.'
      setLoadError(process.env.NODE_ENV === 'development' ? `No se pudieron cargar facturas reales: ${message}` : 'No se pudieron cargar facturas reales. Revisa RLS o columnas de invoices.')
      if (process.env.NODE_ENV === 'development') console.error('[billing/loadInvoices]', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadInvoices()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadInvoices])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setModalOpen(false)
        setInvoiceToDelete(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const filteredInvoices = invoiceList.filter((inv) => statusFilter === 'all' || inv.status === statusFilter)

  const metrics = useMemo(() => {
    const total = invoiceList.reduce((sum, inv) => sum + inv.amount, 0)
    const pending = invoiceList.filter((inv) => inv.status !== 'paid').reduce((sum, inv) => sum + inv.amount, 0)
    const paid = invoiceList.filter((inv) => inv.status === 'paid').reduce((sum, inv) => sum + inv.amount, 0)
    const overdue = invoiceList.filter((inv) => inv.status === 'overdue').length
    return { total, pending, paid, overdue }
  }, [invoiceList])

  const revenueByPlan = useMemo(() => {
    const plans = ['Starter', 'Pro', 'Business', 'Enterprise']
    return plans.map((plan) => {
      const planInvoices = invoiceList.filter((inv) => inv.plan === plan)
      return {
        plan,
        count: planInvoices.length,
        revenue: planInvoices.reduce((sum, inv) => sum + inv.amount, 0),
      }
    })
  }, [invoiceList])

  const openCreateModal = () => {
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEditModal = (invoice: Invoice) => {
    setForm(toForm(invoice))
    setModalOpen(true)
  }

  const handleMarkPaid = async (inv: Invoice) => {
    setMarkingPaid(inv.id)
    try {
      if (isRealMode && workspaceId) {
        await markInvoicePaid(inv.id)
        void createActivity(workspaceId, { type: 'deal', description: `Factura marcada como pagada: ${inv.clientName}`, clientName: inv.clientName }).catch((error) => {
          if (process.env.NODE_ENV === 'development') console.warn('[billing/createActivity:paid]', error)
        })
        void triggerN8nWebhook('invoice_paid', { workspace_id: workspaceId, mode: 'real', invoice: { id: inv.id, client_name: inv.clientName, amount: inv.amount } }).catch((error) => {
          if (process.env.NODE_ENV === 'development') console.warn('[billing/n8n:paid]', error)
        })
        await loadInvoices()
      } else {
        setInvoiceList((prev) => prev.map((item) => item.id === inv.id ? { ...item, status: 'paid' } : item))
      }
      toast.success(`Factura ${inv.id} marcada como pagada`, { description: `${inv.clientName} · ${euro(inv.amount)}` })
    } catch (error) {
      toast.error('No se pudo marcar como pagada', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    } finally {
      setMarkingPaid(null)
    }
  }

  const handleSave = async () => {
    if (!form.clientName.trim() || !form.amount) {
      toast.error('Cliente e importe son obligatorios')
      return
    }

    const payload = {
      clientName: form.clientName.trim(),
      amount: Number(form.amount),
      status: form.status,
      date: form.date,
      dueDate: form.dueDate,
      plan: form.plan,
      notes: form.notes.trim(),
    }

    setSaving(true)
    try {
      if (isRealMode && workspaceId) {
        if (form.id) {
          await updateInvoice(form.id, payload)
          void createActivity(workspaceId, { type: 'note', description: `Factura actualizada: ${payload.clientName}`, clientName: payload.clientName }).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[billing/createActivity:update]', error)
          })
          toast.success(`Factura actualizada: ${payload.clientName}`)
        } else {
          await createInvoice(workspaceId, payload)
          void createActivity(workspaceId, { type: 'deal', description: `Factura creada: ${payload.clientName}`, clientName: payload.clientName }).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[billing/createActivity:create]', error)
          })
          void triggerN8nWebhook('invoice_created', { workspace_id: workspaceId, mode: 'real', invoice: payload }).catch((error) => {
            if (process.env.NODE_ENV === 'development') console.warn('[billing/n8n:create]', error)
          })
          toast.success(`Factura guardada: ${payload.clientName}`)
        }
        await loadInvoices()
      } else {
        const localInvoice: Invoice = {
          id: form.id || `F-2026-${String(invoiceList.length + 1).padStart(3, '0')}`,
          clientName: payload.clientName,
          amount: payload.amount,
          status: payload.status,
          date: payload.date,
          dueDate: payload.dueDate,
          plan: payload.plan,
          notes: payload.notes,
        }
        setInvoiceList((prev) => form.id ? prev.map((invoice) => invoice.id === form.id ? localInvoice : invoice) : [localInvoice, ...prev])
        toast.success(form.id ? `Factura actualizada: ${payload.clientName}` : `Factura creada en demo: ${payload.clientName}`)
      }
      setModalOpen(false)
      setForm(emptyForm)
    } catch (error) {
      toast.error('No se pudo guardar la factura', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!invoiceToDelete) return
    setDeleting(true)
    try {
      if (isRealMode) {
        await deleteInvoice(invoiceToDelete.id)
        await loadInvoices()
      } else {
        setInvoiceList((prev) => prev.filter((invoice) => invoice.id !== invoiceToDelete.id))
      }
      toast.success(`Factura eliminada: ${invoiceToDelete.clientName}`)
      setInvoiceToDelete(null)
    } catch (error) {
      toast.error('No se pudo eliminar la factura', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    } finally {
      setDeleting(false)
    }
  }

  const billingMetrics = [
    { label: 'Total facturado', value: euro(metrics.total), icon: <DollarSign className="h-5 w-5" />, color: 'bg-indigo-50 text-indigo-600' },
    { label: 'Pendiente de cobro', value: euro(metrics.pending), icon: <Clock className="h-5 w-5" />, color: 'bg-amber-50 text-amber-600' },
    { label: 'Cobrado este mes', value: euro(metrics.paid), icon: <CheckCircle className="h-5 w-5" />, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Facturas vencidas', value: String(metrics.overdue), icon: <AlertCircle className="h-5 w-5" />, color: 'bg-red-50 text-red-600' },
  ]

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Facturación"
        description="Ingresos, cobros y facturas persistentes del workspace"
        action={
          <div className="flex items-center gap-2">
            <Badge variant={isRealMode ? 'success' : 'indigo'} dot>{isRealMode ? 'Datos reales' : 'Modo demo'}</Badge>
            <Button variant="secondary" size="sm" onClick={() => toast.info('Exportar', { description: 'La exportación CSV estará disponible próximamente.' })}>
              <Download className="h-3.5 w-3.5" />
              Exportar
            </Button>
            <Button size="sm" onClick={openCreateModal}>
              <Plus className="h-3.5 w-3.5" />
              Nueva factura
            </Button>
          </div>
        }
      />

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {billingMetrics.map(({ label, value, icon, color }) => (
          <div key={label} className="rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm shadow-gray-950/[0.035] transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.04]">
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
        <SectionCard
          className="lg:col-span-2"
          title="Facturas"
          description={isRealMode ? 'Persistidas en Supabase' : 'Facturas demo con estado local'}
          noPadding
          action={
            <div className="flex items-center gap-1">
              {(['all', 'paid', 'pending', 'overdue'] as Array<InvoiceStatus | 'all'>).map((status) => (
                <button
                  key={status}
                  className={cn('rounded px-2 py-0.5 text-[10px] font-medium transition-colors', statusFilter === status ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100')}
                  onClick={() => setStatusFilter(status)}
                >
                  {status === 'all' ? 'Todas' : statusConfig[status].label}
                </button>
              ))}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Factura', 'Cliente', 'Plan', 'Importe', 'Vencimiento', 'Estado', 'Acciones'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8">
                      <div className="space-y-3">
                        {[1, 2, 3].map((item) => (
                          <div key={item} className="grid grid-cols-7 gap-4 rounded-xl border border-gray-100 bg-white px-3 py-3">
                            {Array.from({ length: 7 }).map((_, index) => <span key={index} className="h-4 animate-pulse rounded-full bg-gray-100" />)}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}

                {!loading && filteredInvoices.map((inv, i) => {
                  const cfg = statusConfig[inv.status]
                  const isMarkingThis = markingPaid === inv.id
                  return (
                    <tr key={inv.id} className={cn('border-b border-gray-50 transition-colors hover:bg-indigo-50/35', i === filteredInvoices.length - 1 && 'border-b-0')}>
                      <td className="px-4 py-3"><span className="text-xs font-mono font-semibold text-gray-700">{inv.id}</span></td>
                      <td className="px-4 py-3"><span className="text-sm font-medium text-gray-800">{inv.clientName}</span></td>
                      <td className="px-4 py-3"><span className="text-xs text-gray-500">{inv.plan}</span></td>
                      <td className="px-4 py-3"><span className="text-sm font-bold text-gray-900">{euro(inv.amount)}</span></td>
                      <td className="px-4 py-3"><span className={cn('text-xs', inv.status === 'overdue' ? 'font-semibold text-red-500' : 'text-gray-500')}>{inv.dueDate}</span></td>
                      <td className="px-4 py-3"><Badge variant={cfg.variant} dot>{cfg.label}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {inv.status !== 'paid' && (
                            <button disabled={isMarkingThis} onClick={() => handleMarkPaid(inv)} className="flex items-center gap-1 rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50">
                              {isMarkingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              Marcar pagada
                            </button>
                          )}
                          <button onClick={() => openEditModal(inv)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-indigo-50 hover:text-indigo-600"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setInvoiceToDelete(inv)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {!loading && filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-14 text-center">
                      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                        <DollarSign className="h-5 w-5" />
                      </div>
                      <p className="text-sm font-semibold text-gray-700">Todavía no hay facturas</p>
                      <p className="mt-1 text-xs text-gray-400">Crea la primera factura para medir cobros reales del workspace.</p>
                      <Button className="mt-4" size="sm" onClick={openCreateModal}>
                        <Plus className="h-3.5 w-3.5" />
                        Crear primera factura
                      </Button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="Ingresos por plan" description="Calculado con las facturas visibles">
            <div className="mb-4 space-y-2.5">
              {revenueByPlan.map(({ plan, revenue, count }, i) => (
                <div key={plan}>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: planColors[i] }} />
                      <span className="text-xs font-medium text-gray-700">{plan}</span>
                      <span className="text-[10px] text-gray-400">{count} facturas</span>
                    </div>
                    <span className="text-xs font-bold text-gray-900">{euro(revenue)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full transition-all" style={{ width: `${metrics.total ? Math.min((revenue / metrics.total) * 100, 100) : 0}%`, background: planColors[i] }} />
                  </div>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={revenueByPlan} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="plan" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 11 }} formatter={(value) => [euro(Number(value)), 'Ingresos']} />
                <Bar dataKey="revenue" radius={[6, 6, 0, 0]} maxBarSize={36}>
                  {revenueByPlan.map((_, i) => <Cell key={i} fill={planColors[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard title="Cobros IA" description="Preparado para automatizar con n8n">
            <div className="space-y-3">
              {[
                { label: 'Recordatorios listos', value: metrics.overdue, sub: 'facturas vencidas', color: 'text-amber-600' },
                { label: 'Cobros recuperables', value: euro(metrics.pending), sub: 'pendiente total', color: 'text-emerald-600' },
                { label: 'Automatización n8n', value: 'Pendiente', sub: 'conexión n8n no activa', color: 'text-violet-600' },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="flex items-center justify-between border-b border-gray-50 py-2 last:border-0">
                  <p className="text-xs text-gray-600">{label}</p>
                  <div className="text-right">
                    <p className={cn('text-sm font-bold', color)}>{value}</p>
                    <p className="text-[10px] text-gray-400">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="mt-3 w-full rounded-lg border border-indigo-100 bg-indigo-50 py-2 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-100" onClick={() => toast.success('Recordatorios simulados', { description: 'El flujo real se conectará desde n8n.' })}>
              Preparar recordatorios
            </button>
          </SectionCard>
        </div>
      </div>

      {modalOpen && (
        <div ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) setModalOpen(false) }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50"><DollarSign className="h-4 w-4 text-indigo-600" /></div>
                <h2 className="text-sm font-semibold text-gray-900">{form.id ? 'Editar factura' : 'Nueva factura'}</h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">Cliente *</label>
                <input type="text" placeholder="Nombre del cliente o empresa" value={form.clientName} onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Importe *</label>
                  <input type="number" placeholder="299" min={0} value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Estado</label>
                  <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as InvoiceStatus }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="pending">Pendiente</option>
                    <option value="paid">Pagada</option>
                    <option value="overdue">Vencida</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Plan / concepto</label>
                  <input value={form.plan} onChange={(e) => setForm((p) => ({ ...p, plan: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">Vencimiento</label>
                  <input type="date" value={form.dueDate} onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">Notas</label>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Detalle del cobro, condiciones o siguiente paso..." className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button size="sm" loading={saving} onClick={handleSave}>{form.id ? 'Guardar cambios' : 'Crear factura'}</Button>
            </div>
          </div>
        </div>
      )}

      {invoiceToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl shadow-gray-950/20">
            <div className="border-b border-gray-100 px-6 py-5">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100"><Trash2 className="h-5 w-5" /></div>
              <h2 className="text-base font-bold text-gray-950">¿Eliminar factura de {invoiceToDelete.clientName}?</h2>
              <p className="mt-1.5 text-sm leading-6 text-gray-500">Esta acción eliminará la factura del workspace. No se puede deshacer.</p>
            </div>
            <div className="flex items-center justify-end gap-2 bg-gray-50 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={() => setInvoiceToDelete(null)} disabled={deleting}>Cancelar</Button>
              <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>Eliminar factura</Button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
