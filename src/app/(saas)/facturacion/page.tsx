'use client'

// Facturación (P34) — listado + crear/editar borrador + emisión con numeración atómica + PDF + descarga.
// Sin n8n, sin emails, sin Asistente-write. Escrituras bajo RLS (P33). Mobile: inputs ≥16px (P28C).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Trash2, FileDown, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceIdentity } from '@/components/WorkspaceIdentityProvider'
import { SideDrawer } from '@/components/SideDrawer'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'
import { INVOICE_STATUS_LABEL, type InvoiceStatus } from '@/lib/invoicing/types'
import { calculateInvoiceTotals, formatInvoiceCurrency } from '@/lib/invoicing/calc'
import {
  listInvoices, saveDraft, emitInvoice, setInvoiceStatus, loadInvoice, loadClientsLite, getInvoicePdfUrl,
  type InvoiceListRow, type InvoiceFormData, type InvoiceFormItem, type ClientLite,
} from '@/lib/invoicing/invoice-repo'

const STATUS_PILL: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  issued: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  sent: 'bg-sky-50 text-sky-700 border-sky-100',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  overdue: 'bg-red-50 text-red-700 border-red-100',
  cancelled: 'bg-amber-50 text-amber-700 border-amber-100',
  void: 'bg-gray-100 text-gray-400 border-gray-200',
}

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'todas', label: 'Todas' }, { key: 'draft', label: 'Borradores' }, { key: 'issued', label: 'Emitidas' },
  { key: 'sent', label: 'Enviadas' }, { key: 'paid', label: 'Pagadas' }, { key: 'cancelled', label: 'Canceladas' },
]

const todayIso = () => new Date().toISOString().slice(0, 10)
const emptyItem = (): InvoiceFormItem => ({ description: '', quantity: 1, unitPrice: 0, discountRate: 0, taxRate: 21, withholdingRate: 0, sortOrder: 0 })
const emptyForm = (): InvoiceFormData => ({
  clientId: null, propertyId: null, opportunityId: null, series: 'A', issueDate: todayIso(), dueDate: null,
  currency: 'EUR', notes: '', internalNotes: '', items: [emptyItem()],
})

const inputCls = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500'
const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

function StatusPill({ status }: { status: InvoiceStatus }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_PILL[status])}>{INVOICE_STATUS_LABEL[status]}</span>
}

export default function FacturacionPage() {
  const { currentUser } = useWorkspaceIdentity()
  const workspaceId = currentUser.workspaceId
  const isDemo = currentUser.isDemo

  const [rows, setRows] = useState<InvoiceListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('todas')
  const [search, setSearch] = useState('')
  const [clients, setClients] = useState<ClientLite[]>([])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [form, setForm] = useState<InvoiceFormData>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!workspaceId) { setRows([]); setLoading(false); return }
    setLoading(true)
    setRows(await listInvoices(workspaceId, { status: statusFilter, search }))
    setLoading(false)
  }, [workspaceId, statusFilter, search])

  useEffect(() => { queueMicrotask(() => { void reload() }) }, [reload])
  useEffect(() => { if (workspaceId) void loadClientsLite(workspaceId).then(setClients) }, [workspaceId])

  const totals = useMemo(() => calculateInvoiceTotals(form.items.map((i) => ({
    quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, withholdingRate: i.withholdingRate, discountRate: i.discountRate,
  }))), [form.items])

  const openCreate = () => {
    if (isDemo) { toast.info('Modo demo', { description: 'Conecta tu cuenta real para emitir facturas.' }); return }
    setEditingId(null); setReadOnly(false); setForm(emptyForm()); setDrawerOpen(true)
  }

  const openEdit = async (id: string, status: InvoiceStatus) => {
    if (!workspaceId) return
    const loaded = await loadInvoice(workspaceId, id)
    if (!loaded) { toast.error('No se pudo cargar la factura.'); return }
    const inv = loaded.invoice
    setForm({
      clientId: (inv.client_id as string) ?? null, propertyId: (inv.property_id as string) ?? null, opportunityId: (inv.opportunity_id as string) ?? null,
      series: String(inv.series ?? 'A'), issueDate: String(inv.issue_date), dueDate: (inv.due_date as string) ?? null,
      currency: String(inv.currency ?? 'EUR'), notes: String(inv.notes ?? ''), internalNotes: String(inv.internal_notes ?? ''),
      items: loaded.items.length ? loaded.items.map((it, i) => ({
        id: it.id, description: it.description, quantity: it.quantity, unitPrice: it.unit_price,
        discountRate: it.discount_rate, taxRate: it.tax_rate, withholdingRate: it.withholding_rate, sortOrder: it.sort_order ?? i,
      })) : [emptyItem()],
    })
    setEditingId(id); setReadOnly(status !== 'draft'); setDrawerOpen(true)
  }

  const updateItem = (idx: number, patch: Partial<InvoiceFormItem>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }))
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { ...emptyItem(), sortOrder: f.items.length }] }))
  const removeItem = (idx: number) => setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items }))

  const handleSave = async () => {
    if (!workspaceId || readOnly) return
    setSaving(true)
    const res = await saveDraft(workspaceId, form, editingId ?? undefined)
    setSaving(false)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('Borrador guardado')
    setDrawerOpen(false); void reload()
  }

  const handleEmit = async (id: string) => {
    if (!workspaceId) return
    setBusyId(id)
    const res = await emitInvoice(workspaceId, id)
    setBusyId(null)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('Factura emitida', { description: 'Número asignado y PDF generado.' })
    setDrawerOpen(false); void reload()
  }

  const handleStatus = async (id: string, status: InvoiceStatus, label: string) => {
    if (!workspaceId) return
    setBusyId(id)
    const res = await setInvoiceStatus(workspaceId, id, status)
    setBusyId(null)
    if ('error' in res) { toast.error(res.error); return }
    toast.success(label); void reload()
  }

  const handleDownload = async (id: string) => {
    if (!workspaceId) return
    setBusyId(id)
    const url = await getInvoicePdfUrl(workspaceId, id)
    setBusyId(null)
    if (!url) { toast.error('Esta factura aún no tiene PDF.'); return }
    window.open(url, '_blank', 'noopener')
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-950">Facturación</h1>
          <p className="text-xs text-gray-500">Crea, emite y descarga facturas de tu inmobiliaria.</p>
        </div>
        <Button variant="primary" size="sm" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> Crear factura</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                statusFilter === f.key ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50')}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[180px] flex-1">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por número o cliente…" className={inputCls} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="Todavía no hay facturas" description="Crea tu primera factura: cliente, conceptos, IVA/IRPF y emisión con numeración automática."
          action={<Button variant="primary" size="sm" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> Crear factura</Button>} />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{r.display ?? 'Borrador'}</span>
                  <StatusPill status={r.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500">{r.clientName} · emitida {r.issueDate}{r.dueDate ? ` · vence ${r.dueDate}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{formatInvoiceCurrency(r.total, r.currency)}</span>
                <div className="flex items-center gap-1">
                  {r.status === 'draft' && (
                    <>
                      <button title="Editar" onClick={() => openEdit(r.id, r.status)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"><Pencil className="h-4 w-4" /></button>
                      <Button variant="primary" size="sm" onClick={() => handleEmit(r.id)} loading={busyId === r.id} disabled={busyId === r.id}>Emitir</Button>
                    </>
                  )}
                  {r.hasPdf && (
                    <button title="Descargar PDF" onClick={() => handleDownload(r.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-indigo-50 hover:text-indigo-700"><FileDown className="h-4 w-4" /></button>
                  )}
                  {(r.status === 'issued' || r.status === 'sent' || r.status === 'overdue') && (
                    <Button variant="secondary" size="sm" onClick={() => handleStatus(r.id, 'paid', 'Marcada como pagada')} disabled={busyId === r.id}>Pagada</Button>
                  )}
                  {r.status !== 'draft' && r.status !== 'cancelled' && r.status !== 'void' && r.status !== 'paid' && (
                    <button title="Anular" onClick={() => handleStatus(r.id, 'cancelled', 'Factura cancelada')} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button>
                  )}
                  {r.status === 'draft' && !r.hasPdf && (
                    <button title="Editar" onClick={() => openEdit(r.id, r.status)} className="hidden" aria-hidden />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? (readOnly ? 'Factura' : 'Editar borrador') : 'Nueva factura'}
        description={readOnly ? 'Factura emitida (solo lectura). Descárgala en PDF desde el listado.' : 'Borrador editable: cliente, conceptos e impuestos. Se numera al emitir.'}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setDrawerOpen(false)}>Cerrar</Button>
            {!readOnly && <Button variant="primary" size="sm" type="button" onClick={handleSave} loading={saving} disabled={saving}>Guardar borrador</Button>}
            {editingId && !readOnly && <Button variant="primary" size="sm" type="button" onClick={() => handleEmit(editingId)} loading={busyId === editingId} disabled={busyId === editingId}>Guardar y emitir</Button>}
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-gray-600">Cliente</span>
              <select className={inputCls} value={form.clientId ?? ''} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value || null }))}>
                <option value="">Sin cliente</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Serie" value={form.series} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, series: e.target.value }))} />
              <Input label="Moneda" value={form.currency} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
            </div>
            <Input label="Fecha de emisión" type="date" value={form.issueDate} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))} />
            <Input label="Vencimiento" type="date" value={form.dueDate ?? ''} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value || null }))} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Conceptos</span>
              {!readOnly && <Button variant="secondary" size="sm" type="button" onClick={addItem}><Plus className="h-3.5 w-3.5" /> Añadir línea</Button>}
            </div>
            <div className="space-y-3">
              {form.items.map((it, idx) => (
                <div key={idx} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                  <div className="mb-2 flex items-start gap-2">
                    <input className={inputCls} placeholder="Descripción del concepto" value={it.description} disabled={readOnly} onChange={(e) => updateItem(idx, { description: e.target.value })} />
                    {!readOnly && <button title="Eliminar línea" onClick={() => removeItem(idx)} className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-500">Cantidad</span><input type="number" min="0" className={inputCls} value={it.quantity} disabled={readOnly} onChange={(e) => updateItem(idx, { quantity: num(e.target.value) })} /></label>
                    <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-500">Precio (€)</span><input type="number" min="0" className={inputCls} value={it.unitPrice} disabled={readOnly} onChange={(e) => updateItem(idx, { unitPrice: num(e.target.value) })} /></label>
                    <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-500">Dto. %</span><input type="number" min="0" max="100" className={inputCls} value={it.discountRate} disabled={readOnly} onChange={(e) => updateItem(idx, { discountRate: num(e.target.value) })} /></label>
                    <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-500">IVA %</span><input type="number" min="0" className={inputCls} value={it.taxRate} disabled={readOnly} onChange={(e) => updateItem(idx, { taxRate: num(e.target.value) })} /></label>
                    <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-500">IRPF %</span><input type="number" min="0" className={inputCls} value={it.withholdingRate} disabled={readOnly} onChange={(e) => updateItem(idx, { withholdingRate: num(e.target.value) })} /></label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-3 text-sm">
            <div className="flex justify-between text-gray-600"><span>Base imponible</span><span>{formatInvoiceCurrency(totals.subtotal, form.currency)}</span></div>
            <div className="flex justify-between text-gray-600"><span>IVA</span><span>{formatInvoiceCurrency(totals.taxTotal, form.currency)}</span></div>
            {totals.withholdingTotal > 0 && <div className="flex justify-between text-gray-600"><span>Retención IRPF</span><span>-{formatInvoiceCurrency(totals.withholdingTotal, form.currency)}</span></div>}
            <div className="mt-1.5 flex justify-between border-t border-gray-100 pt-1.5 text-base font-semibold text-gray-900"><span>Total</span><span>{formatInvoiceCurrency(totals.total, form.currency)}</span></div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-gray-600">Notas (visibles en la factura)</span>
              <textarea rows={2} className={cn(inputCls, 'h-auto py-2')} value={form.notes} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-gray-600">Notas internas (no salen en el PDF)</span>
              <textarea rows={2} className={cn(inputCls, 'h-auto py-2')} value={form.internalNotes} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, internalNotes: e.target.value }))} /></label>
          </div>
        </div>
      </SideDrawer>
    </div>
  )
}
