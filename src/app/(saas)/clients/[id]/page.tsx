'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Building2,
  Calendar as CalendarIcon,
  CheckSquare,
  Copy,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Target,
  Trash2,
  Upload,
  User as UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { cn } from '@/lib/utils'
import {
  getClientActivities,
  getClientCalendarEvents,
  getClientConversations,
  getClientDetail,
  getClientInvoices,
  getWorkspaceContext,
  listTasks,
  updateClient,
} from '@/lib/supabase-queries'
import { getClientVerticalSummary, type OpportunityRow, type PropertyRow, type ServiceCaseRow } from '@/lib/vertical-queries'
import { getPipelineForVertical, type VerticalKey } from '@/lib/demo/vertical-templates'
import type { Activity, CalendarEvent, Client, ClientStatus, Conversation, Invoice } from '@/lib/types'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import {
  clients as demoClientsList,
  conversations as demoConversationsList,
  calendarEvents as demoCalendarList,
  invoices as demoInvoicesList,
  recentActivity as demoActivityList,
} from '@/lib/mock-data'
import { demoOpportunities, demoServiceCases, demoProperties } from '@/lib/demo/demo-real-estate'

type TabKey = 'summary' | 'documents' | 'cases' | 'calendar' | 'tasks' | 'conversations' | 'invoices'

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'summary', label: 'Resumen', icon: <UserIcon className="h-3.5 w-3.5" /> },
  { key: 'documents', label: 'Documentos', icon: <FileText className="h-3.5 w-3.5" /> },
  { key: 'cases', label: 'Expedientes', icon: <Building2 className="h-3.5 w-3.5" /> },
  { key: 'calendar', label: 'Visitas y citas', icon: <CalendarIcon className="h-3.5 w-3.5" /> },
  { key: 'tasks', label: 'Tareas', icon: <CheckSquare className="h-3.5 w-3.5" /> },
  { key: 'conversations', label: 'Conversaciones', icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { key: 'invoices', label: 'Facturación', icon: <CreditCard className="h-3.5 w-3.5" /> },
]

type ClientDocument = {
  id: string
  title: string
  type: string
  storage_path: string
  storage_bucket: string
  mime_type?: string | null
  size?: number | null
  created_at: string
  metadata?: Record<string, unknown> | null
}

type TaskRow = {
  id: string
  title: string
  description: string
  status: string
  priority: string
  due_date?: string
  created_at: string
  client_name?: string
}

const STATUS_BADGE: Record<ClientStatus, { label: string; variant: 'success' | 'indigo' | 'default' | 'danger' }> = {
  active: { label: 'Activo', variant: 'success' },
  lead: { label: 'Lead', variant: 'indigo' },
  inactive: { label: 'Inactivo', variant: 'default' },
  churned: { label: 'Perdido', variant: 'danger' },
}

const CLIENT_TYPE_LABEL: Record<string, string> = {
  particular: 'Particular',
  empresa: 'Empresa',
  propietario: 'Propietario',
  comprador: 'Comprador',
  inquilino: 'Inquilino',
  gestoria: 'Cliente gestoría',
  otro: 'Otro',
}

const MAIN_AREA_LABEL: Record<string, string> = {
  inmobiliaria: 'Inmobiliaria',
  gestoria: 'Gestoría / Extranjería',
  ambas: 'Inmobiliaria + Gestoría',
}

const SERVICE_INTEREST_LABEL: Record<string, string> = {
  compra: 'Comprar vivienda',
  venta: 'Vender vivienda',
  alquiler: 'Alquilar',
  gestion_documental: 'Gestión documental',
  nie_extranjeria: 'NIE / extranjería',
  fiscalidad: 'Fiscalidad / gestoría',
  otro: 'Otro',
}

// Mapeos DB → etiqueta visible (es-ES). Fallback al valor crudo si el
// vocabulario no está contemplado (permite verticalización sin romper UI).
const TASK_PRIORITY_LABEL: Record<string, string> = { low: 'Baja', normal: 'Normal', high: 'Alta' }
const TASK_STATUS_LABEL: Record<string, string> = { pending: 'Pendiente', done: 'Hecha', completed: 'Hecha', closed: 'Cerrada' }
const CASE_STATUS_LABEL: Record<string, string> = {
  open: 'Abierto',
  documentation_pending: 'Documentación pendiente',
  in_review: 'En revisión',
  in_follow_up: 'En seguimiento',
  submitted: 'Presentado',
  resolved: 'Resuelto',
  closed: 'Cerrado',
}
const PROPERTY_STATUS_LABEL: Record<string, string> = {
  prospecting: 'Captación',
  listed: 'Publicado',
  under_contract: 'Reservado',
  reserved: 'Reservado',
  available: 'Disponible',
  sold: 'Vendido',
  archived: 'Archivado',
}

function labelOr(map: Record<string, string>, value?: string | null): string {
  if (!value) return ''
  return map[value] ?? value
}

// Etiqueta visible de la etapa de la operación según el pipeline del vertical.
function stageLabel(vertical: string | null | undefined, stage: string): string {
  const pipeline = getPipelineForVertical((vertical as VerticalKey) || 'general')
  return pipeline.find((s) => s.id === stage)?.label ?? stage
}

function readMeta(client: Client | null, key: string): string {
  const m = client?.metadata
  if (!m) return ''
  const value = m[key]
  return typeof value === 'string' ? value : ''
}

function formatBytes(bytes?: number | null) {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-ES', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatEuro(amount: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const clientId = params?.id

  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [client, setClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('summary')

  const [documents, setDocuments] = useState<ClientDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [activities, setActivities] = useState<Activity[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  const [cases, setCases] = useState<ServiceCaseRow[]>([])
  const [properties, setProperties] = useState<PropertyRow[]>([])

  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const loadDocuments = useCallback(async () => {
    if (!clientId) return
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      setDocuments([])
      return
    }
    setDocumentsLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/documents`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Error ${res.status}`)
      }
      const data = await res.json() as { documents: ClientDocument[] }
      setDocuments(data.documents)
    } catch (error) {
      toast.error('No se pudieron cargar los documentos', { description: error instanceof Error ? error.message : '' })
    } finally {
      setDocumentsLoading(false)
    }
  }, [clientId])

  const loadEverything = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    setLoadError('')
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      const c = demoClientsList.find((x) => x.id === clientId) ?? null
      if (!c) {
        setClient(null)
        setLoadError('Cliente de demo no encontrado.')
        setLoading(false)
        return
      }
      setWorkspaceId(null)
      setClient(c)
      setNotesDraft(c.notes && c.notes !== 'No consta' ? c.notes : '')
      setOpportunities(demoOpportunities.filter((o) => o.client_id === clientId))
      setCases(demoServiceCases.filter((s) => s.client_id === clientId))
      setProperties(demoProperties.filter((p) => p.client_id === clientId))
      setActivities(demoActivityList.filter((a) => a.clientName === c.name).slice(0, 12))
      setConversations(demoConversationsList.filter((cv) => cv.clientName === c.name && String(cv.channel ?? '').toLowerCase() === 'whatsapp'))
      setEvents(demoCalendarList.filter((e) => e.clientName === c.name))
      setInvoices(demoInvoicesList.filter((i) => i.clientName === c.name))
      setTasks([])
      setDocuments([])
      setLoading(false)
      return
    }
    try {
      const context = await getWorkspaceContext()
      const resolved = context?.workspace?.id || context?.profile?.workspace_id
      if (!resolved) {
        setLoadError('Tu cuenta aún no tiene workspace asignado.')
        return
      }
      setWorkspaceId(resolved)

      const detail = await getClientDetail(resolved, clientId)
      if (!detail) {
        setLoadError('Cliente no encontrado en este workspace.')
        setClient(null)
        return
      }
      setClient(detail)
      setNotesDraft(detail.notes && detail.notes !== 'No consta' ? detail.notes : '')

      const [acts, convs, evts, invs, tasksRows, vertical] = await Promise.all([
        getClientActivities(resolved, detail.name).catch(() => [] as Activity[]),
        getClientConversations(resolved, clientId).catch(() => [] as Conversation[]),
        getClientCalendarEvents(resolved, detail.name).catch(() => [] as CalendarEvent[]),
        getClientInvoices(resolved, detail.name).catch(() => [] as Invoice[]),
        listTasks(resolved).catch(() => [] as TaskRow[]),
        getClientVerticalSummary(resolved, clientId).catch(() => ({ opportunities: [], cases: [], properties: [] })),
      ])

      setActivities(acts.slice(0, 12))
      // Vista cliente WhatsApp-only: ocultamos conversaciones de otros canales
      // aunque existan en DB.
      setConversations(convs.filter((c) => String(c.channel ?? '').toLowerCase() === 'whatsapp'))
      setEvents(evts)
      setInvoices(invs)
      setTasks(tasksRows.filter((t) => t.client_name?.toLowerCase().includes(detail.name.toLowerCase())))
      setOpportunities(vertical.opportunities)
      setCases(vertical.cases)
      setProperties(vertical.properties)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo cargar la ficha del cliente.')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadEverything() }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadEverything])

  useEffect(() => {
    if (activeTab !== 'documents') return
    const timeout = window.setTimeout(() => { void loadDocuments() }, 0)
    return () => window.clearTimeout(timeout)
  }, [activeTab, loadDocuments])

  const handleFileSelect = async (file: File | null) => {
    if (!file || !clientId) return
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo (solo lectura)', { description: 'Subir documentos estará disponible al conectar tu cuenta.' })
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', file.name)
      const res = await fetch(`/api/clients/${clientId}/documents`, {
        method: 'POST',
        body: formData,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `Error ${res.status}`)
      toast.success('Documento subido', { description: file.name })
      await loadDocuments()
    } catch (error) {
      toast.error('Error al subir documento', { description: error instanceof Error ? error.message : '' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDownload = async (doc: ClientDocument) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/documents/${doc.id}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `Error ${res.status}`)
      window.open(body.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast.error('No se pudo abrir el documento', { description: error instanceof Error ? error.message : '' })
    }
  }

  const handleDeleteDocument = async (doc: ClientDocument) => {
    if (!confirm(`¿Eliminar el documento "${doc.title}"?`)) return
    try {
      const res = await fetch(`/api/clients/${clientId}/documents/${doc.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `Error ${res.status}`)
      toast.success('Documento eliminado')
      await loadDocuments()
    } catch (error) {
      toast.error('No se pudo eliminar el documento', { description: error instanceof Error ? error.message : '' })
    }
  }

  const handleSaveNotes = async () => {
    if (!client) return
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo (solo lectura)', { description: 'Guardar notas estará disponible al conectar tu cuenta.' })
      setEditingNotes(false)
      return
    }
    if (!workspaceId) return
    setSavingNotes(true)
    try {
      await updateClient(client.id, {
        name: client.name,
        company: client.company === 'No consta' ? '' : client.company,
        email: client.email === 'No consta' ? '' : client.email,
        phone: client.phone === '-' || client.phone === 'No consta' ? '' : client.phone,
        channel: client.channel,
        status: client.status,
        leadScore: client.leadScore,
        notes: notesDraft.trim(),
        metadata: client.metadata,
      })
      toast.success('Notas actualizadas')
      setEditingNotes(false)
      await loadEverything()
    } catch (error) {
      toast.error('No se pudieron guardar las notas', { description: error instanceof Error ? error.message : '' })
    } finally {
      setSavingNotes(false)
    }
  }

  const copyToClipboard = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copiado al portapapeles`)
    } catch {
      toast.error(`No se pudo copiar ${label.toLowerCase()}`)
    }
  }, [])

  const status = client ? STATUS_BADGE[client.status] : null
  const safeNotes = client?.notes && client.notes !== 'No consta' ? client.notes : ''
  const cleanEmail = client?.email && client.email !== 'No consta' ? client.email : ''
  const cleanPhone = client?.phone && client.phone !== '-' && client.phone !== 'No consta' ? client.phone : ''

  // Datos derivados del metadata para mostrar profesionalmente.
  const meta = useMemo(() => ({
    documentId: readMeta(client, 'document_id'),
    clientType: readMeta(client, 'client_type'),
    preferredLanguage: readMeta(client, 'preferred_language'),
    nationality: readMeta(client, 'nationality'),
    secondaryPhone: readMeta(client, 'secondary_phone'),
    address: readMeta(client, 'address'),
    cityArea: readMeta(client, 'city_area'),
    mainArea: readMeta(client, 'main_area'),
    serviceInterest: readMeta(client, 'service_interest'),
    budgetRange: readMeta(client, 'budget_range'),
    interestZone: readMeta(client, 'interest_zone'),
    nextAction: readMeta(client, 'next_action'),
    assignedTo: readMeta(client, 'assigned_to'),
  }), [client])

  const tabCount = useMemo(() => ({
    documents: documents.length,
    cases: cases.length + opportunities.length + properties.length,
    calendar: events.length,
    tasks: tasks.length,
    conversations: conversations.length,
    invoices: invoices.length,
  }), [documents.length, cases.length, opportunities.length, properties.length, events.length, tasks.length, conversations.length, invoices.length])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Cargando ficha del cliente…
      </div>
    )
  }

  if (loadError || !client) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push('/clients')} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a clientes
        </button>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
          {loadError || 'Cliente no encontrado.'}
        </div>
      </div>
    )
  }

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <button onClick={() => router.push('/clients')} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
        <ArrowLeft className="h-3.5 w-3.5" /> Volver a clientes
      </button>

      {/* Header del cliente */}
      <SectionCard>
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-sky-50 text-base font-semibold text-indigo-700 ring-1 ring-indigo-100">
            {client.avatar || client.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-950">{client.name}</h1>
              {status && <Badge variant={status.variant} dot>{status.label}</Badge>}
              {meta.clientType && CLIENT_TYPE_LABEL[meta.clientType] && (
                <Badge variant="indigo">{CLIENT_TYPE_LABEL[meta.clientType]}</Badge>
              )}
              {meta.mainArea && MAIN_AREA_LABEL[meta.mainArea] && (
                <Badge variant="purple">{MAIN_AREA_LABEL[meta.mainArea]}</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {client.company === 'No consta' || !client.company ? 'Sin empresa registrada' : client.company}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600">
              {cleanEmail && (
                <span className="inline-flex items-center gap-1">
                  <a href={`mailto:${cleanEmail}`} className="inline-flex items-center gap-1.5 hover:text-indigo-600">
                    <Mail className="h-3.5 w-3.5" /> {cleanEmail}
                  </a>
                  <button type="button" onClick={() => copyToClipboard(cleanEmail, 'Email')} title="Copiar email" className="text-gray-300 transition-colors hover:text-indigo-600">
                    <Copy className="h-3 w-3" />
                  </button>
                </span>
              )}
              {cleanPhone && (
                <span className="inline-flex items-center gap-1">
                  <a href={`tel:${cleanPhone}`} className="inline-flex items-center gap-1.5 hover:text-indigo-600">
                    <Phone className="h-3.5 w-3.5" /> {cleanPhone}
                  </a>
                  <button type="button" onClick={() => copyToClipboard(cleanPhone, 'Teléfono')} title="Copiar teléfono" className="text-gray-300 transition-colors hover:text-indigo-600">
                    <Copy className="h-3 w-3" />
                  </button>
                </span>
              )}
              {meta.secondaryPhone && (
                <a href={`tel:${meta.secondaryPhone}`} className="inline-flex items-center gap-1.5 text-gray-500 hover:text-indigo-600">
                  <Phone className="h-3 w-3" /> {meta.secondaryPhone}
                </a>
              )}
              {client.createdAt && (
                <span className="inline-flex items-center gap-1.5 text-gray-500">
                  Alta · {formatDate(client.createdAt)}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {cleanPhone && (
              <a href={`tel:${cleanPhone}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900">
                <Phone className="h-3.5 w-3.5" /> Llamar
              </a>
            )}
            {cleanEmail && (
              <a href={`mailto:${cleanEmail}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900">
                <Mail className="h-3.5 w-3.5" /> Email
              </a>
            )}
            <Button variant="secondary" size="sm" onClick={() => router.push(`/clients?edit=${client.id}`)}>
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-gray-200/70 bg-white p-1 shadow-sm">
        {TABS.map((tab) => {
          const count = tab.key in tabCount ? tabCount[tab.key as keyof typeof tabCount] : null
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              {tab.icon}
              {tab.label}
              {count !== null && count !== undefined && count > 0 && (
                <span className={cn('ml-0.5 rounded-full px-1.5 text-[10px]', isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500')}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Resumen */}
      {activeTab === 'summary' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
          <div className="space-y-4">
            <SectionCard title="Datos personales / fiscales" description="Identificación del cliente">
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailItem label="Nombre" value={client.name} />
                <DetailItem label="Empresa" value={client.company !== 'No consta' ? client.company : ''} />
                <DetailItem label="DNI / NIE / CIF" value={meta.documentId} />
                <DetailItem label="Tipo de cliente" value={CLIENT_TYPE_LABEL[meta.clientType] ?? ''} />
                <DetailItem label="Nacionalidad" value={meta.nationality} />
                <DetailItem label="Idioma preferente" value={meta.preferredLanguage} />
              </dl>
            </SectionCard>

            <SectionCard title="Contacto" description="Email, teléfonos y dirección">
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailItem label="Email" value={client.email !== 'No consta' ? client.email : ''} />
                <DetailItem label="Teléfono" value={client.phone !== 'No consta' && client.phone !== '-' ? client.phone : ''} />
                <DetailItem label="Teléfono secundario" value={meta.secondaryPhone} />
                <DetailItem label="Ciudad / zona" value={meta.cityArea} />
                <DetailItem label="Dirección" value={meta.address} className="sm:col-span-2" />
              </dl>
            </SectionCard>

            <SectionCard title="Interés y servicio" description="Qué busca o qué le ofrecemos">
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailItem label="Área principal" value={MAIN_AREA_LABEL[meta.mainArea] ?? ''} />
                <DetailItem label="Servicio / interés" value={SERVICE_INTEREST_LABEL[meta.serviceInterest] ?? ''} />
                <DetailItem label="Presupuesto" value={meta.budgetRange} />
                <DetailItem label="Zona de interés" value={meta.interestZone} />
              </dl>
            </SectionCard>

            <SectionCard
              title="Notas internas"
              description="Contexto, próxima acción y responsable"
              action={
                editingNotes ? (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setEditingNotes(false); setNotesDraft(safeNotes) }}>Cancelar</Button>
                    <Button size="sm" loading={savingNotes} onClick={handleSaveNotes}>Guardar</Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setEditingNotes(true)}>
                    <Pencil className="h-3.5 w-3.5" /> Editar notas
                  </Button>
                )
              }
            >
              <div className="space-y-3">
                {editingNotes ? (
                  <textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    rows={5}
                    placeholder="Contexto, antecedentes, preferencias…"
                    className="w-full resize-y rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : safeNotes ? (
                  <p className="whitespace-pre-line text-sm leading-6 text-gray-700">{safeNotes}</p>
                ) : (
                  <p className="text-sm text-gray-500">Sin notas registradas todavía.</p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailItem label="Próxima acción" value={meta.nextAction} />
                  <DetailItem label="Responsable" value={meta.assignedTo} />
                </div>
              </div>
            </SectionCard>
          </div>

          <div className="space-y-4">
            <SectionCard title="Resumen operativo">
              <div className="grid grid-cols-2 gap-3 text-center">
                <StatPill label="Documentos" value={documents.length} hint="Privados al workspace" />
                <StatPill label="Expedientes" value={cases.length} hint="Trámites abiertos" />
                <StatPill label="Citas" value={events.length} hint="Programadas" />
                <StatPill label="Tareas" value={tasks.length} hint="Asignadas" />
              </div>
            </SectionCard>

            <SectionCard title="Actividad reciente" description="Acciones registradas">
              {activities.length === 0 ? (
                <p className="text-sm text-gray-500">Sin actividad registrada todavía.</p>
              ) : (
                <ul className="space-y-2">
                  {activities.map((a) => (
                    <li key={a.id} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                      <p className="text-xs leading-5 text-gray-700">{a.description}</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">{a.timestamp}</p>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>
      )}

      {/* Documentos */}
      {activeTab === 'documents' && (
        <SectionCard
          title="Documentos del cliente"
          description="PDFs, contratos, expedientes y adjuntos. Privados al workspace."
          action={
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv"
              />
              <Button size="sm" loading={uploading} onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Subir documento
              </Button>
            </div>
          }
        >
          {documentsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando documentos…
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 p-8 text-center">
              <FileText className="mx-auto mb-3 h-7 w-7 text-gray-400" />
              <p className="text-sm font-semibold text-gray-700">Sin documentos todavía</p>
              <p className="mt-1 text-xs text-gray-500">PDF, imágenes y documentos de Office hasta 50 MB. Almacenamiento privado del workspace.</p>
              <Button size="sm" className="mt-4" loading={uploading} onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Subir primer documento
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-100">
              <table className="w-full">
                <thead className="bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Documento</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Tipo</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Tamaño</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Fecha</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-indigo-50/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                            <FileText className="h-4 w-4" />
                          </div>
                          <span className="truncate text-sm font-semibold text-gray-900">{doc.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{doc.mime_type ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatBytes(doc.size)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(doc.created_at, true)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleDownload(doc)} title="Abrir / descargar" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600">
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDeleteDocument(doc)} title="Eliminar" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Expedientes / propiedades / pipeline */}
      {activeTab === 'cases' && (
        <div className="space-y-4">
          <SectionCard
            title="Expedientes"
            description="Trámites de gestoría y extranjería"
            action={<Link href="/opportunities" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ir a Gestión</Link>}
          >
            {cases.length === 0 ? (
              <p className="text-sm text-gray-500">Sin expedientes abiertos para este cliente.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {cases.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{c.title}</p>
                      <p className="text-[11px] text-gray-500">
                        {[c.case_type, labelOr(CASE_STATUS_LABEL, c.status), c.due_date ? `vence ${formatDate(c.due_date)}` : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Badge variant={c.status === 'documentation_pending' ? 'warning' : c.status === 'resolved' || c.status === 'closed' ? 'default' : 'purple'}>
                      {labelOr(CASE_STATUS_LABEL, c.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Propiedades vinculadas" description="Captaciones y propiedades de interés">
            {properties.length === 0 ? (
              <p className="text-sm text-gray-500">Sin propiedades vinculadas a este cliente.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {properties.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{p.title}</p>
                      <p className="text-[11px] text-gray-500">
                        {[p.property_type, p.operation_type, p.city, p.price ? formatEuro(p.price, p.currency ?? 'EUR') : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Badge variant={p.status === 'sold' ? 'success' : 'info'}>{labelOr(PROPERTY_STATUS_LABEL, p.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Pipeline comercial" description="Operaciones vinculadas">
            {opportunities.length === 0 ? (
              <p className="text-sm text-gray-500">Sin operaciones activas.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {opportunities.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{o.title}</p>
                      <p className="text-[11px] text-gray-500">
                        {[stageLabel(o.vertical, o.stage), o.value ? formatEuro(o.value, o.currency ?? 'EUR') : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Badge variant={o.stage === 'won' ? 'success' : o.stage === 'lost' ? 'danger' : 'indigo'}>
                      <Target className="h-3 w-3" /> {stageLabel(o.vertical, o.stage)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      )}

      {/* Calendar */}
      {activeTab === 'calendar' && (
        <SectionCard
          title="Visitas y citas"
          description="Eventos del calendario asociados al cliente"
          action={<Link href="/calendar" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Abrir calendario</Link>}
        >
          {events.length === 0 ? (
            <p className="text-sm text-gray-500">Sin citas programadas para este cliente.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {events.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{event.title}</p>
                    <p className="text-[11px] text-gray-500">
                      {[formatDate(event.startAt ?? event.date, true), event.location, event.type].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Badge variant="indigo">{event.type}</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {activeTab === 'tasks' && (
        <SectionCard title="Tareas" description="Pendientes asignadas para este cliente">
          {tasks.length === 0 ? (
            <p className="text-sm text-gray-500">Sin tareas pendientes.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{t.title}</p>
                    <p className="text-[11px] text-gray-500">
                      {[labelOr(TASK_PRIORITY_LABEL, t.priority), t.due_date ? `vence ${formatDate(t.due_date)}` : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Badge variant={t.status === 'done' ? 'success' : 'indigo'}>{labelOr(TASK_STATUS_LABEL, t.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {activeTab === 'conversations' && (
        <SectionCard title="Conversaciones" description="Mensajes registrados con este cliente">
          {conversations.length === 0 ? (
            <p className="text-sm text-gray-500">Sin conversaciones registradas para este cliente.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {conversations.map((c) => (
                <li key={c.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-gray-900">{c.lastMessage}</p>
                    <Badge variant={c.sentiment === 'positive' ? 'success' : c.sentiment === 'negative' ? 'danger' : 'default'}>
                      {c.channel === 'whatsapp' ? 'WhatsApp' : c.channel || 'Conversación'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {[c.intent, c.timestamp, c.status].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {activeTab === 'invoices' && (
        <SectionCard title="Facturación" description="Facturas y cobros asociados">
          {invoices.length === 0 ? (
            <p className="text-sm text-gray-500">Sin facturas registradas para este cliente.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {inv.invoiceNumber || inv.number || 'Factura'} · {formatEuro(inv.amount, inv.currency ?? 'EUR')}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {[inv.plan, inv.dueDate ? `vence ${formatDate(inv.dueDate)}` : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Badge variant={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'warning'}>{inv.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
    </motion.div>
  )
}

function DetailItem({ label, value, className }: { label: string; value?: string; className?: string }) {
  const present = value && value.trim().length > 0
  return (
    <div className={cn('rounded-lg border border-gray-100 bg-gray-50/40 px-3 py-2.5', className)}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={cn('mt-0.5 text-sm', present ? 'text-gray-900' : 'italic text-gray-400')}>
        {present ? value : 'Sin completar'}
      </dd>
    </div>
  )
}

function StatPill({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-3 shadow-sm">
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="mt-0.5 text-[11px] font-medium text-gray-700">{label}</p>
      <p className="text-[10px] text-gray-400">{hint}</p>
    </div>
  )
}
