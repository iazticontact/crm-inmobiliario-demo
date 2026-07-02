'use client'

// Facturación PRO (P34 · P36A-E) — MÓDULO EXTRA premium y CERRADO. UI simple (5 vistas), papelera con
// restaurar y eliminación definitiva controlada (borradores: hard delete; emitidas: purga con trazabilidad),
// inclusión/exclusión del resumen financiero, dashboard financiero simple, generador texto/audio, editor con
// vista previa y PDF profesional. Sin n8n, sin emails, sin Asistente-write. Escrituras bajo RLS.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, FileDown, Loader2, FileText, Eye, Pencil, MoreVertical, Send, CheckCircle2, Ban, Trash2, RotateCcw, Sparkles, BarChart3, AlertTriangle, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceIdentity } from '@/components/WorkspaceIdentityProvider'
import { cn } from '@/lib/utils'
import { INVOICE_STATUS_LABEL, type InvoiceStatus, type IssuerSnapshot, type InvoiceItem } from '@/lib/invoicing/types'
import { formatInvoiceCurrency } from '@/lib/invoicing/calc'
import {
  listInvoices, saveDraft, emitInvoice, setInvoiceStatus, moveToTrash, restoreInvoice, permanentDelete, setAccountingExcluded,
  loadInvoice, loadClientsLite, getInvoicePdfUrl, loadIssuerSnapshot, issuerMissingCritical, regeneratePdf,
  loadOpportunityInvoicePrefill,
  type InvoiceListRow, type InvoiceFormData, type InvoiceFormItem, type ClientLite,
} from '@/lib/invoicing/invoice-repo'
import { InvoicePromptBuilder } from '@/components/invoicing/InvoicePromptBuilder'
import { InvoiceEditor, type InvoiceEditorMode } from '@/components/invoicing/InvoiceEditor'
import { InvoiceDashboard } from '@/components/invoicing/InvoiceDashboard'
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

const VIEWS: { key: string; label: string }[] = [
  { key: 'todas', label: 'Todas' }, { key: 'draft', label: 'Borradores' }, { key: 'pending', label: 'Pendientes' },
  { key: 'paid', label: 'Pagadas' }, { key: 'papelera', label: 'Papelera' },
]

const emptyItem = (): InvoiceFormItem => ({ description: '', quantity: 1, unitPrice: 0, discountRate: 0, taxRate: 21, withholdingRate: 0, sortOrder: 0 })
const emptyForm = (): InvoiceFormData => ({
  clientId: null, propertyId: null, opportunityId: null, series: 'A', issueDate: todayIso(), dueDate: null,
  currency: 'EUR', exchangeRateToEur: null, exchangeRateSource: 'Manual', exchangeRateDate: null,
  notes: '', internalNotes: '', items: [emptyItem()],
})

// Mapea una factura cargada (BD) al formulario del editor. A nivel de módulo → reutilizable y estable.
function mapInvoiceToForm(inv: Record<string, unknown>, items: InvoiceItem[]): InvoiceFormData {
  return {
    clientId: (inv.client_id as string) ?? null, propertyId: (inv.property_id as string) ?? null, opportunityId: (inv.opportunity_id as string) ?? null,
    series: String(inv.series ?? 'A'), issueDate: String(inv.issue_date), dueDate: (inv.due_date as string) ?? null,
    currency: String(inv.currency ?? 'EUR'),
    exchangeRateToEur: inv.exchange_rate_to_eur == null ? null : Number(inv.exchange_rate_to_eur),
    exchangeRateSource: String(inv.exchange_rate_source ?? 'Manual'),
    exchangeRateDate: (inv.exchange_rate_date as string) ?? null,
    notes: String(inv.notes ?? ''), internalNotes: String(inv.internal_notes ?? ''),
    items: items.length ? items.map((it, i) => ({
      id: it.id, description: it.description, quantity: it.quantity, unitPrice: it.unit_price,
      discountRate: it.discount_rate, taxRate: it.tax_rate, withholdingRate: it.withholding_rate, sortOrder: it.sort_order ?? i,
    })) : [emptyItem()],
  }
}

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

type MenuItem = { label: string; icon: React.ReactNode; onClick: () => void; tone?: 'danger' }
function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Más acciones" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100"><MoreVertical className="h-4 w-4" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-56 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
            {items.map((it, i) => (
              <button key={i} onClick={() => { setOpen(false); it.onClick() }} className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-50', it.tone === 'danger' ? 'text-red-600' : 'text-gray-700')}>
                {it.icon}{it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function FacturacionPage() {
  const { currentUser } = useWorkspaceIdentity()
  const workspaceId = currentUser.workspaceId
  const isDemo = currentUser.isDemo
  const isAdmin = currentUser.role !== 'member'

  const [everything, setEverything] = useState<InvoiceListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('todas')
  const [search, setSearch] = useState('')
  const [clients, setClients] = useState<ClientLite[]>([])
  const [issuer, setIssuer] = useState<IssuerSnapshot | null>(null)
  const [showDash, setShowDash] = useState(false)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<InvoiceEditorMode>('create')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [currentDisplay, setCurrentDisplay] = useState<string | null>(null)
  const [currentStatus, setCurrentStatus] = useState<InvoiceStatus>('draft')
  const [currentHasPdf, setCurrentHasPdf] = useState(false)
  const [currentTrashed, setCurrentTrashed] = useState(false)
  const [form, setForm] = useState<InvoiceFormData>(emptyForm())
  const [savingDraft, setSavingDraft] = useState(false)
  const [emitting, setEmitting] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [hardTarget, setHardTarget] = useState<{ id: string; display: string; status: InvoiceStatus } | null>(null)
  const [hardRetain, setHardRetain] = useState(false)
  const [hardText, setHardText] = useState('')

  const issuerMissing = useMemo(() => (issuer ? issuerMissingCritical(issuer) : []), [issuer])

  const reload = useCallback(async () => {
    if (!workspaceId) { setEverything([]); setLoading(false); return }
    setLoading(true)
    setEverything(await listInvoices(workspaceId, { scope: 'all' }))
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { queueMicrotask(() => { void reload() }) }, [reload])
  useEffect(() => {
    if (!workspaceId) return
    void loadClientsLite(workspaceId).then(setClients)
    void loadIssuerSnapshot(workspaceId).then(setIssuer)
  }, [workspaceId])

  // Prellenado desde una operación: /facturacion?fromOpportunity=<id> → factura de honorarios (base =
  // comisión, no precio del inmueble). Si ya hay factura vinculada, la abre en vez de duplicar. Se ejecuta
  // una sola vez y limpia el parámetro de la URL.
  const prefillRef = useRef(false)
  useEffect(() => {
    if (!workspaceId || prefillRef.current) return
    const oppId = new URLSearchParams(window.location.search).get('fromOpportunity')
    if (!oppId) return
    prefillRef.current = true
    window.history.replaceState(null, '', '/facturacion')
    if (isDemo) { toast.info('Modo de ejemplo', { description: 'Conecta tu cuenta para facturar operaciones reales.' }); return }
    void (async () => {
      const res = await loadOpportunityInvoicePrefill(workspaceId, oppId)
      if ('error' in res) { toast.error('No se pudo preparar la factura', { description: res.error }); return }
      if ('existing' in res) {
        toast.info('Esta operación ya tiene una factura vinculada', { description: `${res.existing.display ?? 'Borrador'} · ${INVOICE_STATUS_LABEL[res.existing.status]}. La abro para revisarla.` })
        const loaded = await loadInvoice(workspaceId, res.existing.id)
        if (!loaded) return
        const inv = loaded.invoice
        const trashed = !!inv.deleted_at
        const status = (inv.status as InvoiceStatus) ?? 'draft'
        setForm(mapInvoiceToForm(inv, loaded.items))
        setEditingId(res.existing.id); setEditorMode(status === 'draft' && !trashed ? 'edit' : 'view')
        setCurrentDisplay((inv.invoice_number_display as string) ?? null); setCurrentStatus(status)
        setCurrentHasPdf(Boolean(inv.pdf_file_id)); setCurrentTrashed(trashed); setEditorOpen(true)
        return
      }
      setForm(res.draft)
      setEditingId(null); setEditorMode('create'); setCurrentDisplay(null); setCurrentStatus('draft')
      setCurrentHasPdf(false); setCurrentTrashed(false); setEditorOpen(true)
      toast.success('Factura de honorarios preparada', { description: `Base: honorarios ${formatInvoiceCurrency(res.honorarios, 'EUR')}${res.propertyTitle ? ` · ${res.propertyTitle}` : ''}. Revisa y guarda.` })
    })()
  }, [workspaceId, isDemo])

  // Derivadas: activas (ni papelera ni purgadas) y papelera (deleted, no purgadas). Las purgadas nunca se
  // muestran en la UI; solo pueden alimentar el resumen financiero (si no están excluidas).
  const allRows = useMemo(() => everything.filter((r) => !r.deletedAt && !r.purgedAt), [everything])
  const trashRows = useMemo(() => everything.filter((r) => r.deletedAt && !r.purgedAt), [everything])

  const counts = useMemo(() => ({
    todas: allRows.length,
    draft: allRows.filter((r) => r.status === 'draft').length,
    pending: allRows.filter((r) => r.status === 'issued' || r.status === 'sent').length,
    paid: allRows.filter((r) => r.status === 'paid').length,
    papelera: trashRows.length,
  }) as Record<string, number>, [allRows, trashRows])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let base: InvoiceListRow[]
    if (view === 'papelera') base = trashRows
    else if (view === 'draft') base = allRows.filter((r) => r.status === 'draft')
    else if (view === 'pending') base = allRows.filter((r) => r.status === 'issued' || r.status === 'sent')
    else if (view === 'paid') base = allRows.filter((r) => r.status === 'paid')
    else base = allRows
    return base.filter((r) => !q || (r.display ?? '').toLowerCase().includes(q) || r.clientName.toLowerCase().includes(q))
  }, [view, allRows, trashRows, search])

  const kpis = useMemo(() => {
    const ym = todayIso().slice(0, 7)
    const sum = (p: (r: InvoiceListRow) => boolean) => allRows.filter(p).reduce((a, r) => a + (r.total ?? 0), 0)
    return {
      pending: sum((r) => (r.status === 'issued' || r.status === 'sent') && !isOverdue(r)),
      overdue: sum(isOverdue),
      billedMonth: sum((r) => r.status !== 'draft' && r.status !== 'cancelled' && r.status !== 'void' && r.issueDate.slice(0, 7) === ym),
      drafts: allRows.filter((r) => r.status === 'draft').length,
      currency: everything[0]?.currency ?? 'EUR',
    }
  }, [allRows, everything])

  const setCurrent = (id: string | null, mode: InvoiceEditorMode, display: string | null, status: InvoiceStatus, hasPdf: boolean, trashed: boolean) => {
    setEditingId(id); setEditorMode(mode); setCurrentDisplay(display); setCurrentStatus(status); setCurrentHasPdf(hasPdf); setCurrentTrashed(trashed)
  }

  const handleGenerate = (result: InvoiceParseResult) => {
    if (isDemo) { toast.info('Modo de ejemplo', { description: 'Conecta tu cuenta para crear facturas reales.' }); return }
    setForm(result.draft); setCurrent(null, 'create', null, 'draft', false, false); setEditorOpen(true)
    if (result.warnings.length) toast.warning('Propuesta lista — revísala', { description: result.warnings[0] })
    else if (result.missingFields.length) toast.info('Propuesta lista', { description: `Completa antes de guardar: ${result.missingFields.join(', ')}.` })
    else toast.success('Propuesta lista', { description: 'Revisa los datos y guarda el borrador.' })
  }

  const openCreate = () => {
    if (isDemo) { toast.info('Modo de ejemplo', { description: 'Conecta tu cuenta para emitir facturas reales.' }); return }
    setForm(emptyForm()); setCurrent(null, 'create', null, 'draft', false, false); setEditorOpen(true)
  }

  // Abre una factura por id (deriva estado/número/PDF/papelera de la propia factura → una sola fuente).
  const openInvoiceById = async (id: string) => {
    if (!workspaceId) return
    const loaded = await loadInvoice(workspaceId, id)
    if (!loaded) { toast.error('No se pudo abrir la factura.'); return }
    const inv = loaded.invoice
    const trashed = !!inv.deleted_at
    const status = (inv.status as InvoiceStatus) ?? 'draft'
    setForm(mapInvoiceToForm(inv, loaded.items))
    setCurrent(id, status === 'draft' && !trashed ? 'edit' : 'view', (inv.invoice_number_display as string) ?? null, status, Boolean(inv.pdf_file_id), trashed)
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

  const doTrash = async (id: string) => {
    if (!workspaceId) return
    const res = await moveToTrash(workspaceId, id)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('Movida a la papelera', { description: 'Puedes restaurarla cuando quieras.' })
    setEditorOpen(false); void reload()
  }
  const doRestore = async (id: string) => {
    if (!workspaceId) return
    const res = await restoreInvoice(workspaceId, id)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('Factura restaurada', { description: 'Vuelve a aparecer en el listado principal.' })
    setEditorOpen(false); void reload()
  }
  const doAccounting = async (id: string, excluded: boolean) => {
    if (!workspaceId) return
    const res = await setAccountingExcluded(workspaceId, id, excluded)
    if ('error' in res) { toast.error(res.error); return }
    toast.success(excluded ? 'Excluida del resumen financiero' : 'Incluida en el resumen financiero')
    void reload()
  }
  const askPermanentDelete = (id: string, display: string | null, status: InvoiceStatus) => {
    setHardTarget({ id, display: display ?? 'Borrador', status }); setHardRetain(false); setHardText('')
  }
  const confirmPermanentDelete = async () => {
    if (!workspaceId || !hardTarget) return
    const res = await permanentDelete(workspaceId, hardTarget.id, { accountingRetained: hardRetain })
    setHardTarget(null); setHardText('')
    if ('error' in res) { toast.error(res.error); return }
    toast.success('Eliminada definitivamente', { description: res.mode === 'purged' ? (hardRetain ? 'Se conserva en el resumen como registro histórico.' : 'Excluida del resumen financiero.') : undefined })
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

  // Acciones de listado
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
    const res = await setInvoiceStatus(workspaceId, id, status)
    if ('error' in res) { toast.error(res.error); return }
    toast.success(label); void reload()
  }
  const listDownload = async (id: string) => {
    if (!workspaceId) return
    const url = await getInvoicePdfUrl(workspaceId, id)
    if (!url) { toast.error('Esta factura no tiene PDF disponible.'); return }
    window.open(url, '_blank', 'noopener')
  }

  const rowMenuItems = (r: InvoiceListRow): MenuItem[] => {
    const items: MenuItem[] = []
    const accountingToggle = (): MenuItem => r.accountingExcluded
      ? { label: 'Incluir en el resumen', icon: <BarChart3 className="h-3.5 w-3.5" />, onClick: () => doAccounting(r.id, false) }
      : { label: 'Excluir del resumen', icon: <EyeOff className="h-3.5 w-3.5" />, onClick: () => doAccounting(r.id, true) }

    if (view === 'papelera') {
      if (r.status !== 'draft') items.push(accountingToggle())
      if (isAdmin) items.push({ label: 'Eliminar definitivamente', icon: <Trash2 className="h-3.5 w-3.5" />, tone: 'danger', onClick: () => askPermanentDelete(r.id, r.display, r.status) })
      return items
    }
    if (r.status === 'draft') {
      items.push({ label: 'Editar', icon: <Pencil className="h-3.5 w-3.5" />, onClick: () => openInvoiceById(r.id) })
      items.push({ label: 'Emitir factura', icon: <FileText className="h-3.5 w-3.5" />, onClick: () => listEmit(r.id) })
    } else {
      if (r.status === 'issued') items.push({ label: 'Marcar enviada', icon: <Send className="h-3.5 w-3.5" />, onClick: () => listStatus(r.id, 'sent', 'Factura marcada como enviada') })
      if (r.status === 'issued' || r.status === 'sent') items.push({ label: 'Marcar cobrada', icon: <CheckCircle2 className="h-3.5 w-3.5" />, onClick: () => listStatus(r.id, 'paid', 'Factura marcada como cobrada') })
      if (r.status !== 'paid' && r.status !== 'cancelled' && r.status !== 'void') items.push({ label: 'Anular factura', icon: <Ban className="h-3.5 w-3.5" />, onClick: () => listStatus(r.id, 'cancelled', 'Factura anulada') })
      items.push(accountingToggle())
    }
    items.push({ label: 'Mover a papelera', icon: <Trash2 className="h-3.5 w-3.5" />, tone: 'danger', onClick: () => doTrash(r.id) })
    return items
  }

  const filtering = !!search
  const emptyCopy: Record<string, { title: string; desc: string }> = {
    todas: { title: 'Empieza a facturar', desc: 'Describe la factura por texto o voz arriba, o créala manualmente. Numeración automática, IVA/IRPF y PDF con tu logo incluidos.' },
    draft: { title: 'No hay borradores', desc: 'Los borradores en curso aparecerán aquí hasta que los emitas.' },
    pending: { title: 'Nada pendiente de cobro', desc: 'Las facturas emitidas o enviadas sin cobrar aparecerán aquí.' },
    paid: { title: 'Aún no hay facturas cobradas', desc: 'Marca una factura como cobrada y aparecerá aquí.' },
    papelera: { title: 'La papelera está vacía', desc: 'Las facturas que muevas a la papelera aparecerán aquí y podrás restaurarlas o eliminarlas definitivamente.' },
  }

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
      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label="Pendiente de cobro" value={formatInvoiceCurrency(kpis.pending, kpis.currency)} />
        <Kpi label="Vencido" value={formatInvoiceCurrency(kpis.overdue, kpis.currency)} tone={kpis.overdue > 0 ? 'danger' : undefined} />
        <Kpi label="Facturado (mes)" value={formatInvoiceCurrency(kpis.billedMonth, kpis.currency)} />
        <Kpi label="Borradores" value={String(kpis.drafts)} />
      </div>

      <button onClick={() => setShowDash((v) => !v)} className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50">
        <BarChart3 className="h-3.5 w-3.5" /> {showDash ? 'Ocultar resumen financiero' : 'Ver resumen financiero'}
      </button>
      {showDash && <div className="mb-4"><InvoiceDashboard rows={everything} /></div>}

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

      {/* Vistas + búsqueda */}
      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                view === v.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100')}>
              {v.label}
              <span className={cn('rounded-full px-1.5 text-[10px] font-semibold tabular-nums', view === v.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500')}>{counts[v.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:max-w-[240px]">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar número o cliente…" className={searchCls} />
        </div>
      </div>

      {view === 'papelera' && trashRows.length > 0 && (
        <p className="mb-3 text-xs text-gray-500">Restaura una factura para devolverla al listado, o elimínala definitivamente (requiere confirmación). Las facturas emitidas se conservan por trazabilidad aunque las elimines.</p>
      )}

      {/* Listado */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">{view === 'papelera' ? <Trash2 className="h-6 w-6" /> : view === 'todas' && !filtering ? <Sparkles className="h-6 w-6" /> : <FileText className="h-6 w-6" />}</div>
          <h3 className="text-sm font-semibold text-gray-900">{filtering ? 'Sin resultados' : emptyCopy[view].title}</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">{filtering ? 'No hay facturas que coincidan con la búsqueda.' : emptyCopy[view].desc}</p>
          {view === 'todas' && !filtering && (
            <button onClick={openCreate} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800">
              <Plus className="h-4 w-4" /> Nueva factura
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const overdue = isOverdue(r)
            const inTrash = view === 'papelera'
            return (
              <li key={r.id} className="group flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-3.5 shadow-sm transition-colors hover:border-gray-200 sm:flex-row sm:items-center sm:justify-between">
                <button onClick={() => openInvoiceById(r.id)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{r.display ?? 'Borrador'}</span>
                    <StatusPill status={overdue && !inTrash ? 'overdue' : r.status} />
                    {r.hasPdf && <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-100"><FileDown className="h-3 w-3" /> PDF</span>}
                    {r.accountingExcluded && <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 ring-1 ring-amber-100"><EyeOff className="h-3 w-3" /> fuera del resumen</span>}
                  </div>
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {r.clientName} · {fmtDate(r.issueDate)}
                    {inTrash
                      ? <> · <span className="text-gray-400">en papelera desde {fmtDate(r.deletedAt)}</span></>
                      : r.dueDate ? <> · <span className={overdue ? 'font-medium text-red-600' : ''}>vence {fmtDate(r.dueDate)}</span></> : null}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-gray-900">{formatInvoiceCurrency(r.total, r.currency)}</span>
                  <div className="flex items-center gap-0.5">
                    {inTrash ? (
                      <button onClick={() => doRestore(r.id)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"><RotateCcw className="h-3.5 w-3.5" /> Restaurar</button>
                    ) : (
                      <>
                        <button title={r.status === 'draft' ? 'Editar' : 'Ver'} onClick={() => openInvoiceById(r.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">{r.status === 'draft' ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                        {r.status === 'draft'
                          ? <button onClick={() => listEmit(r.id)} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Emitir</button>
                          : r.hasPdf ? <button title="Descargar PDF" onClick={() => listDownload(r.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-indigo-50 hover:text-indigo-700"><FileDown className="h-4 w-4" /></button> : null}
                      </>
                    )}
                    <RowMenu items={rowMenuItems(r)} />
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
        trashed={currentTrashed}
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
        canHardDelete={isAdmin}
        onSaveDraft={handleSaveDraft}
        onEmit={handleSaveAndEmit}
        onTrash={editingId && !currentTrashed ? () => doTrash(editingId) : undefined}
        onRestore={editingId && currentTrashed ? () => doRestore(editingId) : undefined}
        onHardDelete={editingId && currentTrashed ? () => askPermanentDelete(editingId, currentDisplay, currentStatus) : undefined}
        onDownload={currentHasPdf ? handleDownloadCurrent : undefined}
        onRegenerate={!currentTrashed && currentStatus !== 'draft' ? handleRegenerate : undefined}
      />

      {/* Eliminación definitiva — doble confirmación (tratamiento contable + escribir ELIMINAR) */}
      {hardTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setHardTarget(null)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600"><AlertTriangle className="h-4.5 w-4.5" /></span>
              <h3 className="text-sm font-semibold text-gray-900">Eliminar definitivamente</h3>
            </div>
            <p className="text-xs leading-5 text-gray-600">
              Vas a eliminar <b>{hardTarget.display}</b> de forma permanente. {hardTarget.status === 'draft'
                ? 'Se borrarán sus líneas y no podrá recuperarse.'
                : 'Esta factura ya tiene numeración o impacto económico: no se reutilizará su número y desaparecerá de la gestión, pero se conserva por trazabilidad.'}
            </p>

            {hardTarget.status !== 'draft' && (
              <div className="mt-3 space-y-1.5">
                <p className="text-[11px] font-medium text-gray-600">¿Cómo tratar esta factura en el resumen financiero?</p>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs">
                  <input type="radio" name="acc" checked={!hardRetain} onChange={() => setHardRetain(false)} className="mt-0.5" />
                  <span><b>Excluir del resumen</b> — no contará en facturado/cobrado/IVA. Útil para errores o duplicados.</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs">
                  <input type="radio" name="acc" checked={hardRetain} onChange={() => setHardRetain(true)} className="mt-0.5" />
                  <span><b>Mantener como registro histórico</b> — seguirá contando en el resumen, pero no podrás editarla ni restaurarla.</span>
                </label>
              </div>
            )}

            <p className="mt-3 text-[11px] font-medium text-gray-500">Escribe <b>ELIMINAR</b> para confirmar:</p>
            <input value={hardText} onChange={(e) => setHardText(e.target.value)} className={cn(searchCls, 'mt-1.5')} placeholder="ELIMINAR" />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setHardTarget(null)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={confirmPermanentDelete} disabled={hardText.trim().toUpperCase() !== 'ELIMINAR'} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">Eliminar definitivamente</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
