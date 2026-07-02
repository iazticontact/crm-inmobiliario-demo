'use client'

// Facturación PRO (P34 · P36A · P36B) — MÓDULO EXTRA premium: hero + KPIs útiles + generador texto/audio +
// editor a pantalla completa con vista previa en vivo + emisión con numeración atómica + PDF profesional
// (logo real) + estados. Sin n8n, sin emails, sin Asistente-write. Escrituras bajo RLS (P33).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, FileDown, Loader2, FileText, Eye, Pencil, CheckCircle2, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceIdentity } from '@/components/WorkspaceIdentityProvider'
import { cn } from '@/lib/utils'
import { INVOICE_STATUS_LABEL, type InvoiceStatus, type IssuerSnapshot } from '@/lib/invoicing/types'
import { formatInvoiceCurrency } from '@/lib/invoicing/calc'
import {
  listInvoices, saveDraft, emitInvoice, setInvoiceStatus, loadInvoice, loadClientsLite, getInvoicePdfUrl,
  loadIssuerSnapshot, issuerMissingCritical, regeneratePdf,
  type InvoiceListRow, type InvoiceFormData, type InvoiceFormItem, type ClientLite,
} from '@/lib/invoicing/invoice-repo'
import { InvoicePromptBuilder } from '@/components/invoicing/InvoicePromptBuilder'
import { InvoiceEditor, type InvoiceEditorMode } from '@/components/invoicing/InvoiceEditor'
import type { InvoiceParseResult } from '@/lib/invoicing/invoice-parse'

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
const fmtDate = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
const isOverdue = (r: InvoiceListRow) => (r.status === 'issued' || r.status === 'sent' || r.status === 'overdue') && !!r.dueDate && r.dueDate < todayIso()

const emptyItem = (): InvoiceFormItem => ({ description: '', quantity: 1, unitPrice: 0, discountRate: 0, taxRate: 21, withholdingRate: 0, sortOrder: 0 })
const emptyForm = (): InvoiceFormData => ({
  clientId: null, propertyId: null, opportunityId: null, series: 'A', issueDate: todayIso(), dueDate: null,
  currency: 'EUR', notes: '', internalNotes: '', items: [emptyItem()],
})

const inputCls = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-base sm:text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500'

function StatusPill({ status }: { status: InvoiceStatus }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_PILL[status])}>{INVOICE_STATUS_LABEL[status]}</span>
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
      <p className="text-[11px] font-medium text-white/50">{label}</p>
      <p className={cn('mt-0.5 text-base font-semibold tabular-nums', tone === 'danger' ? 'text-red-300' : 'text-white')}>{value}</p>
    </div>
  )
}

export default function FacturacionPage() {
  const { currentUser } = useWorkspaceIdentity()
  const workspaceId = currentUser.workspaceId
  const isDemo = currentUser.isDemo

  const [rows, setRows] = useState<InvoiceListRow[]>([])
  const [allRows, setAllRows] = useState<InvoiceListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('todas')
  const [search, setSearch] = useState('')
  const [clients, setClients] = useState<ClientLite[]>([])
  const [issuer, setIssuer] = useState<IssuerSnapshot | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<InvoiceEditorMode>('create')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [currentDisplay, setCurrentDisplay] = useState<string | null>(null)
  const [currentStatus, setCurrentStatus] = useState<InvoiceStatus>('draft')
  const [currentHasPdf, setCurrentHasPdf] = useState(false)
  const [form, setForm] = useState<InvoiceFormData>(emptyForm())
  const [savingDraft, setSavingDraft] = useState(false)
  const [emitting, setEmitting] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const issuerMissing = useMemo(() => (issuer ? issuerMissingCritical(issuer) : []), [issuer])

  const reload = useCallback(async () => {
    if (!workspaceId) { setRows([]); setAllRows([]); setLoading(false); return }
    setLoading(true)
    const [filtered, all] = await Promise.all([
      listInvoices(workspaceId, { status: statusFilter, search }),
      listInvoices(workspaceId, {}),
    ])
    setRows(filtered); setAllRows(all)
    setLoading(false)
  }, [workspaceId, statusFilter, search])

  useEffect(() => { queueMicrotask(() => { void reload() }) }, [reload])
  useEffect(() => {
    if (!workspaceId) return
    void loadClientsLite(workspaceId).then(setClients)
    void loadIssuerSnapshot(workspaceId).then(setIssuer)
  }, [workspaceId])

  // KPIs útiles — sobre TODAS las facturas (no sobre el filtro visible).
  const kpis = useMemo(() => {
    const ym = todayIso().slice(0, 7)
    const sum = (pred: (r: InvoiceListRow) => boolean) => allRows.filter(pred).reduce((a, r) => a + (r.total ?? 0), 0)
    const currency = allRows[0]?.currency ?? 'EUR'
    const isBilled = (r: InvoiceListRow) => r.status !== 'draft' && r.status !== 'cancelled' && r.status !== 'void'
    return {
      drafts: allRows.filter((r) => r.status === 'draft').length,
      issued: allRows.filter((r) => r.status === 'issued' || r.status === 'sent').length,
      paid: allRows.filter((r) => r.status === 'paid').length,
      overdue: allRows.filter(isOverdue).length,
      pending: sum((r) => r.status === 'issued' || r.status === 'sent' || r.status === 'overdue'),
      billedMonth: sum((r) => isBilled(r) && r.issueDate.slice(0, 7) === ym),
      currency,
    }
  }, [allRows])

  const resetCurrent = (id: string | null, mode: InvoiceEditorMode, display: string | null, status: InvoiceStatus, hasPdf: boolean) => {
    setEditingId(id); setEditorMode(mode); setCurrentDisplay(display); setCurrentStatus(status); setCurrentHasPdf(hasPdf)
  }

  const handleGenerate = (result: InvoiceParseResult) => {
    if (isDemo) { toast.info('Modo demo', { description: 'Conecta tu cuenta real para crear facturas.' }); return }
    setForm(result.draft); resetCurrent(null, 'create', null, 'draft', false); setEditorOpen(true)
    if (result.warnings.length) toast.warning('Propuesta generada — revísala', { description: result.warnings[0] })
    else if (result.missingFields.length) toast.info('Propuesta generada', { description: `Completa antes de guardar: ${result.missingFields.join(', ')}.` })
    else toast.success('Propuesta generada', { description: 'Revisa los datos y guarda el borrador.' })
  }

  const openCreate = () => {
    if (isDemo) { toast.info('Modo demo', { description: 'Conecta tu cuenta real para emitir facturas.' }); return }
    setForm(emptyForm()); resetCurrent(null, 'create', null, 'draft', false); setEditorOpen(true)
  }

  const openInvoice = async (r: InvoiceListRow) => {
    if (!workspaceId) return
    const loaded = await loadInvoice(workspaceId, r.id)
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
    resetCurrent(r.id, r.status === 'draft' ? 'edit' : 'view', r.display, r.status, r.hasPdf)
    setEditorOpen(true)
  }

  const handleSaveDraft = async () => {
    if (!workspaceId) return
    setSavingDraft(true)
    const res = await saveDraft(workspaceId, form, editingId ?? undefined)
    setSavingDraft(false)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('Borrador guardado')
    setEditorOpen(false); void reload()
  }

  const handleSaveAndEmit = async () => {
    if (!workspaceId) return
    setEmitting(true)
    const saved = await saveDraft(workspaceId, form, editingId ?? undefined)
    if ('error' in saved) { setEmitting(false); toast.error(saved.error); return }
    const res = await emitInvoice(workspaceId, saved.id)
    setEmitting(false)
    if ('error' in res) { toast.error(res.error); setEditingId(saved.id); setEditorMode('edit'); void reload(); return }
    toast.success('Factura emitida', { description: 'Número asignado y PDF profesional generado.' })
    setEditorOpen(false); void reload()
  }

  const handleRegenerate = async () => {
    if (!workspaceId || !editingId) return
    setRegenerating(true)
    const res = await regeneratePdf(workspaceId, editingId)
    setRegenerating(false)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('PDF regenerado', { description: 'Se ha actualizado con los datos actuales del emisor.' })
    setCurrentHasPdf(true); void reload()
  }

  const handleDownloadCurrent = async () => {
    if (!workspaceId || !editingId) return
    const url = await getInvoicePdfUrl(workspaceId, editingId)
    if (!url) { toast.error('Esta factura aún no tiene PDF. Pulsa "Regenerar PDF".'); return }
    window.open(url, '_blank', 'noopener')
  }

  // Acciones desde el listado
  const listEmit = async (id: string) => {
    if (!workspaceId) return
    setBusyId(id)
    const res = await emitInvoice(workspaceId, id)
    setBusyId(null)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('Factura emitida', { description: 'Número asignado y PDF generado.' })
    void reload()
  }
  const listStatus = async (id: string, status: InvoiceStatus, label: string) => {
    if (!workspaceId) return
    setBusyId(id)
    const res = await setInvoiceStatus(workspaceId, id, status)
    setBusyId(null)
    if ('error' in res) { toast.error(res.error); return }
    toast.success(label); void reload()
  }
  const listDownload = async (id: string) => {
    if (!workspaceId) return
    setBusyId(id)
    const url = await getInvoicePdfUrl(workspaceId, id)
    setBusyId(null)
    if (!url) { toast.error('Esta factura aún no tiene PDF.'); return }
    window.open(url, '_blank', 'noopener')
  }

  const emptyFiltered = statusFilter !== 'todas' || !!search

  return (
    <div className="mx-auto max-w-6xl">
      {/* Hero premium — MÓDULO EXTRA. Aislado del Asistente IA general (P35). */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-800 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-200 ring-1 ring-white/15">Módulo extra · PRO</span>
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Facturación profesional</h1>
            <p className="mt-1 max-w-lg text-sm text-white/70">Crea, revisa y emite facturas para tu inmobiliaria: numeración automática, IVA/IRPF, PDF con tu logo y generación por texto o voz.</p>
          </div>
          <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-100">
            <Plus className="h-4 w-4" /> Crear factura
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Borradores" value={String(kpis.drafts)} />
          <Kpi label="Emitidas" value={String(kpis.issued)} />
          <Kpi label="Pagadas" value={String(kpis.paid)} />
          <Kpi label="Vencidas" value={String(kpis.overdue)} tone={kpis.overdue > 0 ? 'danger' : undefined} />
          <Kpi label="Pendiente de cobro" value={formatInvoiceCurrency(kpis.pending, kpis.currency)} />
          <Kpi label="Facturado (mes)" value={formatInvoiceCurrency(kpis.billedMonth, kpis.currency)} />
        </div>
      </div>

      {/* Aviso de datos fiscales del emisor incompletos */}
      {!isDemo && issuer && issuerMissing.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>Completa los datos fiscales de tu empresa ({issuerMissing.join(', ')}) para emitir facturas serias.</span>
          <a href="/settings" className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">Ir a Configuración</a>
        </div>
      )}

      {/* Generador por texto/audio — dentro del módulo, NUNCA en el Asistente IA general (P35/P36A). */}
      <div className="mb-4">
        <InvoicePromptBuilder clients={clients} onGenerate={handleGenerate} />
      </div>

      {/* Filtros + búsqueda */}
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

      {/* Listado */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><FileText className="h-6 w-6" /></div>
          <h3 className="text-sm font-semibold text-gray-900">{emptyFiltered ? 'Sin resultados' : 'Todavía no hay facturas'}</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
            {emptyFiltered ? 'Prueba a cambiar el filtro o el término de búsqueda.' : 'Empieza describiendo la factura arriba (texto o voz) o créala manualmente. Numeración automática, IVA/IRPF y PDF con tu logo incluidos.'}
          </p>
          {!emptyFiltered && (
            <button onClick={openCreate} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800">
              <Plus className="h-4 w-4" /> Crear factura manual
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const overdue = isOverdue(r)
            return (
              <li key={r.id} className="group flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-3.5 shadow-sm transition-colors hover:border-gray-200 sm:flex-row sm:items-center sm:justify-between">
                <button onClick={() => openInvoice(r)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{r.display ?? 'Borrador'}</span>
                    <StatusPill status={overdue ? 'overdue' : r.status} />
                    {r.hasPdf && <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500"><FileDown className="h-3 w-3" /> PDF</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {r.clientName} · {fmtDate(r.issueDate)}
                    {r.dueDate ? <> · <span className={overdue ? 'font-medium text-red-600' : ''}>vence {fmtDate(r.dueDate)}</span></> : null}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-gray-900">{formatInvoiceCurrency(r.total, r.currency)}</span>
                  <div className="flex items-center gap-1">
                    {r.status === 'draft' ? (
                      <>
                        <button title="Editar" onClick={() => openInvoice(r)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => listEmit(r.id)} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                          {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Emitir
                        </button>
                      </>
                    ) : (
                      <button title="Ver" onClick={() => openInvoice(r)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"><Eye className="h-4 w-4" /></button>
                    )}
                    {r.hasPdf && (
                      <button title="Descargar PDF" onClick={() => listDownload(r.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-indigo-50 hover:text-indigo-700"><FileDown className="h-4 w-4" /></button>
                    )}
                    {(r.status === 'issued' || r.status === 'sent' || r.status === 'overdue') && (
                      <button title="Marcar pagada" onClick={() => listStatus(r.id, 'paid', 'Marcada como pagada')} disabled={busyId === r.id} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-emerald-50 hover:text-emerald-700"><CheckCircle2 className="h-4 w-4" /></button>
                    )}
                    {r.status !== 'draft' && r.status !== 'cancelled' && r.status !== 'void' && r.status !== 'paid' && (
                      <button title="Anular" onClick={() => listStatus(r.id, 'cancelled', 'Factura cancelada')} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><Ban className="h-4 w-4" /></button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <InvoiceEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        mode={editorMode}
        form={form}
        onChange={setForm}
        clients={clients}
        issuer={issuer}
        issuerMissing={issuerMissing}
        displayNumber={currentDisplay}
        status={currentStatus}
        saving={savingDraft}
        emitting={emitting}
        regenerating={regenerating}
        onSaveDraft={handleSaveDraft}
        onEmit={handleSaveAndEmit}
        onDownload={currentHasPdf ? handleDownloadCurrent : undefined}
        onRegenerate={handleRegenerate}
      />
    </div>
  )
}
