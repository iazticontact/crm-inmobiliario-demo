'use client'

// Facturación PRO (P34 · P36A · P36B · P36C) — MÓDULO EXTRA premium. Cabecera sobria + KPIs claros +
// generador texto/audio + navegación por estados con recuentos + editor a pantalla completa con vista
// previa + PDF profesional (logo real). Ciclo de vida definido: borradores editables/eliminables; emitidas
// se envían/cobran/anulan (no se borran). Sin n8n, sin emails, sin Asistente-write. Escrituras bajo RLS.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, FileDown, Loader2, FileText, Eye, Pencil, CheckCircle2, Ban, Trash2, Send, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceIdentity } from '@/components/WorkspaceIdentityProvider'
import { cn } from '@/lib/utils'
import { INVOICE_STATUS_LABEL, type InvoiceStatus, type IssuerSnapshot } from '@/lib/invoicing/types'
import { formatInvoiceCurrency } from '@/lib/invoicing/calc'
import {
  listInvoices, saveDraft, emitInvoice, setInvoiceStatus, deleteDraft, loadInvoice, loadClientsLite, getInvoicePdfUrl,
  loadIssuerSnapshot, issuerMissingCritical, regeneratePdf,
  type InvoiceListRow, type InvoiceFormData, type InvoiceFormItem, type ClientLite,
} from '@/lib/invoicing/invoice-repo'
import { InvoicePromptBuilder } from '@/components/invoicing/InvoicePromptBuilder'
import { InvoiceEditor, type InvoiceEditorMode } from '@/components/invoicing/InvoiceEditor'
import type { InvoiceParseResult } from '@/lib/invoicing/invoice-parse'

const STATUS_PILL: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-100 text-gray-600 ring-gray-200',
  issued: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  sent: 'bg-sky-50 text-sky-700 ring-sky-100',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  overdue: 'bg-red-50 text-red-700 ring-red-100',
  cancelled: 'bg-amber-50 text-amber-700 ring-amber-100',
  void: 'bg-gray-100 text-gray-400 ring-gray-200',
}

const todayIso = () => new Date().toISOString().slice(0, 10)
const fmtDate = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
const isOverdue = (r: InvoiceListRow) => (r.status === 'issued' || r.status === 'sent') && !!r.dueDate && r.dueDate < todayIso()

// Navegación por estados (sin solapamientos: una factura cae en una sola pestaña).
const TABS: { key: string; label: string; match: (r: InvoiceListRow, ov: boolean) => boolean }[] = [
  { key: 'todas', label: 'Todas', match: () => true },
  { key: 'draft', label: 'Borradores', match: (r) => r.status === 'draft' },
  { key: 'issued', label: 'Emitidas', match: (r, ov) => r.status === 'issued' && !ov },
  { key: 'sent', label: 'Enviadas', match: (r, ov) => r.status === 'sent' && !ov },
  { key: 'overdue', label: 'Vencidas', match: (_r, ov) => ov },
  { key: 'paid', label: 'Pagadas', match: (r) => r.status === 'paid' },
  { key: 'cancelled', label: 'Canceladas', match: (r) => r.status === 'cancelled' || r.status === 'void' },
]

const emptyItem = (): InvoiceFormItem => ({ description: '', quantity: 1, unitPrice: 0, discountRate: 0, taxRate: 21, withholdingRate: 0, sortOrder: 0 })
const emptyForm = (): InvoiceFormData => ({
  clientId: null, propertyId: null, opportunityId: null, series: 'A', issueDate: todayIso(), dueDate: null,
  currency: 'EUR', notes: '', internalNotes: '', items: [emptyItem()],
})

const searchCls = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-base sm:text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500'

function StatusPill({ status }: { status: InvoiceStatus }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', STATUS_PILL[status])}>{INVOICE_STATUS_LABEL[status]}</span>
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', tone === 'danger' ? 'text-red-600' : 'text-gray-900')}>{value}</p>
    </div>
  )
}

function IconBtn({ title, onClick, children, tone }: { title: string; onClick: () => void; children: React.ReactNode; tone?: 'default' | 'success' | 'danger' | 'indigo' }) {
  const tones = {
    default: 'text-gray-500 hover:bg-gray-100',
    success: 'text-gray-500 hover:bg-emerald-50 hover:text-emerald-700',
    danger: 'text-gray-400 hover:bg-red-50 hover:text-red-600',
    indigo: 'text-gray-500 hover:bg-indigo-50 hover:text-indigo-700',
  }[tone ?? 'default']
  return <button title={title} onClick={onClick} className={cn('flex h-8 w-8 items-center justify-center rounded-lg transition-colors', tones)}>{children}</button>
}

export default function FacturacionPage() {
  const { currentUser } = useWorkspaceIdentity()
  const workspaceId = currentUser.workspaceId
  const isDemo = currentUser.isDemo

  const [allRows, setAllRows] = useState<InvoiceListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('todas')
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
    if (!workspaceId) { setAllRows([]); setLoading(false); return }
    setLoading(true)
    setAllRows(await listInvoices(workspaceId, {}))
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { queueMicrotask(() => { void reload() }) }, [reload])
  useEffect(() => {
    if (!workspaceId) return
    void loadClientsLite(workspaceId).then(setClients)
    void loadIssuerSnapshot(workspaceId).then(setIssuer)
  }, [workspaceId])

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, allRows.filter((r) => t.match(r, isOverdue(r))).length])), [allRows])

  const rows = useMemo(() => {
    const t = TABS.find((x) => x.key === tab) ?? TABS[0]
    const q = search.trim().toLowerCase()
    return allRows.filter((r) => t.match(r, isOverdue(r)) && (!q || (r.display ?? '').toLowerCase().includes(q) || r.clientName.toLowerCase().includes(q)))
  }, [allRows, tab, search])

  const kpis = useMemo(() => {
    const ym = todayIso().slice(0, 7)
    const sum = (pred: (r: InvoiceListRow) => boolean) => allRows.filter(pred).reduce((a, r) => a + (r.total ?? 0), 0)
    const currency = allRows[0]?.currency ?? 'EUR'
    const isBilled = (r: InvoiceListRow) => r.status !== 'draft' && r.status !== 'cancelled' && r.status !== 'void'
    return {
      drafts: allRows.filter((r) => r.status === 'draft').length,
      pending: sum((r) => r.status === 'issued' || r.status === 'sent'),
      overdue: sum(isOverdue),
      paid: sum((r) => r.status === 'paid'),
      billedMonth: sum((r) => isBilled(r) && r.issueDate.slice(0, 7) === ym),
      currency,
    }
  }, [allRows])

  const setCurrent = (id: string | null, mode: InvoiceEditorMode, display: string | null, status: InvoiceStatus, hasPdf: boolean) => {
    setEditingId(id); setEditorMode(mode); setCurrentDisplay(display); setCurrentStatus(status); setCurrentHasPdf(hasPdf)
  }

  const handleGenerate = (result: InvoiceParseResult) => {
    if (isDemo) { toast.info('Modo de ejemplo', { description: 'Conecta tu cuenta para crear facturas reales.' }); return }
    setForm(result.draft); setCurrent(null, 'create', null, 'draft', false); setEditorOpen(true)
    if (result.warnings.length) toast.warning('Propuesta lista — revísala', { description: result.warnings[0] })
    else if (result.missingFields.length) toast.info('Propuesta lista', { description: `Completa antes de guardar: ${result.missingFields.join(', ')}.` })
    else toast.success('Propuesta lista', { description: 'Revisa los datos y guarda el borrador.' })
  }

  const openCreate = () => {
    if (isDemo) { toast.info('Modo de ejemplo', { description: 'Conecta tu cuenta para emitir facturas reales.' }); return }
    setForm(emptyForm()); setCurrent(null, 'create', null, 'draft', false); setEditorOpen(true)
  }

  const openInvoice = async (r: InvoiceListRow) => {
    if (!workspaceId) return
    const loaded = await loadInvoice(workspaceId, r.id)
    if (!loaded) { toast.error('No se pudo abrir la factura.'); return }
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
    setCurrent(r.id, r.status === 'draft' ? 'edit' : 'view', r.display, r.status, r.hasPdf)
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

  const handleDeleteFromEditor = async () => {
    if (!workspaceId || !editingId) return
    if (!window.confirm('¿Eliminar este borrador? Esta acción no se puede deshacer.')) return
    const res = await deleteDraft(workspaceId, editingId)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('Borrador eliminado')
    setEditorOpen(false); void reload()
  }

  const handleRegenerate = async () => {
    if (!workspaceId || !editingId) return
    setRegenerating(true)
    const res = await regeneratePdf(workspaceId, editingId)
    setRegenerating(false)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('PDF actualizado', { description: 'Regenerado con los datos actuales del emisor.' })
    setCurrentHasPdf(true); void reload()
  }

  const handleDownloadCurrent = async () => {
    if (!workspaceId || !editingId) return
    const url = await getInvoicePdfUrl(workspaceId, editingId)
    if (!url) { toast.error('Aún no hay PDF. Pulsa «Regenerar PDF».'); return }
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
  const listCancel = async (id: string) => {
    if (!window.confirm('¿Anular esta factura? Quedará registrada como cancelada.')) return
    await listStatus(id, 'cancelled', 'Factura anulada')
  }
  const listDelete = async (id: string) => {
    if (!workspaceId) return
    if (!window.confirm('¿Eliminar este borrador? Esta acción no se puede deshacer.')) return
    setBusyId(id)
    const res = await deleteDraft(workspaceId, id)
    setBusyId(null)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('Borrador eliminado'); void reload()
  }
  const listDownload = async (id: string) => {
    if (!workspaceId) return
    setBusyId(id)
    const url = await getInvoicePdfUrl(workspaceId, id)
    setBusyId(null)
    if (!url) { toast.error('Esta factura no tiene PDF disponible.'); return }
    window.open(url, '_blank', 'noopener')
  }

  const filtering = tab !== 'todas' || !!search

  return (
    <div className="mx-auto max-w-6xl">
      {/* Cabecera sobria — MÓDULO EXTRA. Aislado del Asistente IA general. */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white"><FileText className="h-4 w-4" /></span>
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-indigo-100">Módulo extra · PRO</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-950 sm:text-2xl">Facturación</h1>
          <p className="mt-0.5 max-w-lg text-sm text-gray-500">Crea, emite y cobra facturas profesionales para tu inmobiliaria: numeración automática, IVA/IRPF, PDF con tu logo y creación por texto o voz.</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-800">
          <Plus className="h-4 w-4" /> Nueva factura
        </button>
      </div>

      {/* KPIs claros */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Borradores" value={String(kpis.drafts)} />
        <Kpi label="Pendiente de cobro" value={formatInvoiceCurrency(kpis.pending, kpis.currency)} />
        <Kpi label="Vencido" value={formatInvoiceCurrency(kpis.overdue, kpis.currency)} tone={kpis.overdue > 0 ? 'danger' : undefined} />
        <Kpi label="Cobrado" value={formatInvoiceCurrency(kpis.paid, kpis.currency)} />
        <Kpi label="Facturado (mes)" value={formatInvoiceCurrency(kpis.billedMonth, kpis.currency)} />
      </div>

      {/* Aviso de datos fiscales del emisor incompletos */}
      {!isDemo && issuer && issuerMissing.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>Completa los datos fiscales de tu empresa ({issuerMissing.join(', ')}) para emitir facturas profesionales.</span>
          <a href="/settings" className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">Ir a Configuración</a>
        </div>
      )}

      {/* Generador por texto/audio — dentro del módulo, NUNCA en el Asistente IA general. */}
      <div className="mb-5">
        <InvoicePromptBuilder clients={clients} onGenerate={handleGenerate} />
      </div>

      {/* Navegación por estados + búsqueda */}
      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                tab === t.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100')}>
              {t.label}
              <span className={cn('rounded-full px-1.5 text-[10px] font-semibold tabular-nums', tab === t.key ? 'bg-white/20 text-white' : t.key === 'overdue' && counts[t.key] ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500')}>{counts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:max-w-[240px]">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar número o cliente…" className={searchCls} />
        </div>
      </div>

      {/* Listado */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">{filtering ? <FileText className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}</div>
          <h3 className="text-sm font-semibold text-gray-900">{filtering ? 'Sin resultados' : 'Empieza a facturar'}</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
            {filtering ? 'No hay facturas en esta vista. Cambia de pestaña o ajusta la búsqueda.' : 'Describe la factura por texto o voz arriba, o créala manualmente. Numeración automática, IVA/IRPF y PDF con tu logo incluidos.'}
          </p>
          {!filtering && (
            <button onClick={openCreate} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800">
              <Plus className="h-4 w-4" /> Nueva factura
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const overdue = isOverdue(r)
            const canPay = r.status === 'issued' || r.status === 'sent'
            const canCancel = r.status !== 'draft' && r.status !== 'cancelled' && r.status !== 'void' && r.status !== 'paid'
            return (
              <li key={r.id} className="group flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-3.5 shadow-sm transition-colors hover:border-gray-200 sm:flex-row sm:items-center sm:justify-between">
                <button onClick={() => openInvoice(r)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{r.display ?? 'Borrador'}</span>
                    <StatusPill status={overdue ? 'overdue' : r.status} />
                    {r.hasPdf && <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-100"><FileDown className="h-3 w-3" /> PDF</span>}
                  </div>
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {r.clientName} · {fmtDate(r.issueDate)}
                    {r.dueDate ? <> · <span className={overdue ? 'font-medium text-red-600' : ''}>vence {fmtDate(r.dueDate)}</span></> : null}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-gray-900">{formatInvoiceCurrency(r.total, r.currency)}</span>
                  <div className="flex items-center gap-0.5">
                    {r.status === 'draft' ? (
                      <>
                        <IconBtn title="Editar" onClick={() => openInvoice(r)}><Pencil className="h-4 w-4" /></IconBtn>
                        <IconBtn title="Eliminar borrador" onClick={() => listDelete(r.id)} tone="danger"><Trash2 className="h-4 w-4" /></IconBtn>
                        <button onClick={() => listEmit(r.id)} disabled={busyId === r.id} className="ml-0.5 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                          {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Emitir
                        </button>
                      </>
                    ) : (
                      <>
                        <IconBtn title="Ver" onClick={() => openInvoice(r)}><Eye className="h-4 w-4" /></IconBtn>
                        {r.hasPdf && <IconBtn title="Descargar PDF" onClick={() => listDownload(r.id)} tone="indigo"><FileDown className="h-4 w-4" /></IconBtn>}
                        {r.status === 'issued' && <IconBtn title="Marcar enviada" onClick={() => listStatus(r.id, 'sent', 'Factura marcada como enviada')} tone="indigo"><Send className="h-4 w-4" /></IconBtn>}
                        {canPay && <IconBtn title="Marcar pagada" onClick={() => listStatus(r.id, 'paid', 'Factura marcada como cobrada')} tone="success"><CheckCircle2 className="h-4 w-4" /></IconBtn>}
                        {canCancel && <IconBtn title="Anular" onClick={() => listCancel(r.id)} tone="danger"><Ban className="h-4 w-4" /></IconBtn>}
                      </>
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
        onDelete={editorMode === 'edit' ? handleDeleteFromEditor : undefined}
        onDownload={currentHasPdf ? handleDownloadCurrent : undefined}
        onRegenerate={handleRegenerate}
      />
    </div>
  )
}
