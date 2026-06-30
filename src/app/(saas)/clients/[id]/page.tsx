'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Bot,
  Building2,
  Calendar as CalendarIcon,
  Check,
  CheckSquare,
  Clock,
  Copy,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Target,
  Trash2,
  Upload,
  User as UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { PageSkeleton } from '@/components/PageSkeleton'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmailAction } from '@/components/EmailAction'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import {
  createActivity,
  createTask,
  getClientActivityFeed,
  getClientCalendarEvents,
  getClientConversations,
  getClientDetail,
  getClientInvoices,
  getWorkspaceContext,
  createCalendarEvent,
  listTasks,
  listWorkspaceProfiles,
  updateCalendarEvent,
  updateClient,
  updateTask,
  type WorkspaceMember,
} from '@/lib/supabase-queries'
import { createOpportunity, createServiceCase, getClientVerticalSummary, updateOpportunity, updateServiceCase, type OpportunityRow, type PropertyRow, type ServiceCaseRow } from '@/lib/vertical-queries'
import { getPipelineForVertical, type VerticalKey } from '@/lib/demo/vertical-templates'
import type { Activity, CalendarEvent, Client, ClientStatus, Conversation, EventType, Invoice } from '@/lib/types'
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
  { key: 'cases', label: 'Operaciones', icon: <Building2 className="h-3.5 w-3.5" /> },
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
  client_id?: string
  client_name?: string
  assigned_to?: string
}

const STATUS_BADGE: Record<ClientStatus, { label: string; variant: 'success' | 'indigo' | 'default' | 'danger' }> = {
  active: { label: 'Activo', variant: 'success' },
  lead: { label: 'En seguimiento', variant: 'indigo' },
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
const TASK_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  open: 'Pendiente',
  in_progress: 'En curso',
  done: 'Completada',
  completed: 'Completada',
  closed: 'Cerrada',
  cancelled: 'Cancelada',
}
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

const CHANNEL_LABEL: Record<string, string> = {
  web: 'Web',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  email: 'Email',
  crm: 'Alta manual',
}

// Tipos de evento de calendario → etiqueta es-ES (fallback al valor crudo).
const EVENT_TYPE_LABEL: Record<string, string> = {
  visit: 'Visita',
  meeting: 'Reunión',
  call: 'Llamada',
  demo: 'Visita',
  signing: 'Firma',
  valuation: 'Valoración',
  other: 'Otro',
  'follow-up': 'Seguimiento',
  task: 'Tarea',
  deadline: 'Vencimiento',
}

const taskInputCls =
  'h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500'

// Etapas del pipeline inmobiliario para el alta de operaciones (estático).
const REAL_ESTATE_STAGES = getPipelineForVertical('real_estate')

function isDemoMode() {
  return typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
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

// Icono por tipo de actividad (los tipos verticales se normalizan a 'note').
function activityIcon(type: string) {
  switch (type) {
    case 'email': return <Mail className="h-3.5 w-3.5" />
    case 'call': return <Phone className="h-3.5 w-3.5" />
    case 'message': return <MessageSquare className="h-3.5 w-3.5" />
    case 'deal': return <Target className="h-3.5 w-3.5" />
    default: return <FileText className="h-3.5 w-3.5" />
  }
}

// Estado de vencimiento de una tarea (no aplica si ya está cerrada).
function taskDueState(due?: string | null, status?: string): 'overdue' | 'soon' | 'none' {
  if (!due || status === 'done' || status === 'completed' || status === 'closed' || status === 'cancelled') return 'none'
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return 'none'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((d.getTime() - today.getTime()) / 86_400_000)
  if (diffDays < 0) return 'overdue'
  if (diffDays <= 3) return 'soon'
  return 'none'
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
  const [docToDelete, setDocToDelete] = useState<ClientDocument | null>(null)
  const [deletingDoc, setDeletingDoc] = useState(false)
  const [docDeleteError, setDocDeleteError] = useState<string | null>(null)
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
  const [members, setMembers] = useState<WorkspaceMember[]>([])

  // RT4 — alta/edición de tareas reales (mutaciones controladas vía RLS).
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', priority: 'normal', dueDate: '', assignedTo: '', description: '' })
  const [taskSaving, setTaskSaving] = useState(false)
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null)

  // RT4.2 — alta de operaciones / expedientes / eventos
  const [opFormOpen, setOpFormOpen] = useState(false)
  const [opForm, setOpForm] = useState({ title: '', stage: REAL_ESTATE_STAGES[0]?.id ?? 'new', value: '', probability: '', assignedTo: '', expectedCloseDate: '', notes: '' })
  const [opSaving, setOpSaving] = useState(false)
  const [caseFormOpen, setCaseFormOpen] = useState(false)
  const [caseForm, setCaseForm] = useState({ title: '', caseType: '', status: 'open', priority: 'normal', dueDate: '', assignedTo: '', notes: '' })
  const [caseSaving, setCaseSaving] = useState(false)
  const [evFormOpen, setEvFormOpen] = useState(false)
  const [evForm, setEvForm] = useState({ title: '', type: 'visit', date: '', time: '10:00', duration: '60', location: '', notes: '' })
  const [evSaving, setEvSaving] = useState(false)

  // RT4.3 — edición inline (etapas/estados/reprogramación)
  const [editOp, setEditOp] = useState<{ id: string; stage: string; value: string; probability: string; assignedTo: string; expectedCloseDate: string; notes: string } | null>(null)
  const [opEditSaving, setOpEditSaving] = useState(false)
  const [editCase, setEditCase] = useState<{ id: string; status: string; priority: string; assignedTo: string; dueDate: string; notes: string } | null>(null)
  const [caseEditSaving, setCaseEditSaving] = useState(false)
  const [editTask, setEditTask] = useState<{ id: string; priority: string; dueDate: string; assignedTo: string; description: string } | null>(null)
  const [taskEditSaving, setTaskEditSaving] = useState(false)
  const [editEvent, setEditEvent] = useState<{ id: string; title: string; type: string; date: string; time: string; duration: string; location: string; notes: string } | null>(null)
  const [eventEditSaving, setEventEditSaving] = useState(false)

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
      setMembers([])
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

      const [acts, convs, evts, invs, tasksRows, vertical, wsMembers] = await Promise.all([
        getClientActivityFeed(resolved, clientId, detail.name).catch(() => [] as Activity[]),
        getClientConversations(resolved, clientId).catch(() => [] as Conversation[]),
        getClientCalendarEvents(resolved, detail.name).catch(() => [] as CalendarEvent[]),
        getClientInvoices(resolved, detail.name).catch(() => [] as Invoice[]),
        listTasks(resolved).catch(() => [] as TaskRow[]),
        getClientVerticalSummary(resolved, clientId).catch(() => ({ opportunities: [], cases: [], properties: [] })),
        listWorkspaceProfiles(resolved).catch(() => [] as WorkspaceMember[]),
      ])

      setActivities(acts)
      // Vista cliente WhatsApp-only: ocultamos conversaciones de otros canales
      // aunque existan en DB.
      setConversations(convs.filter((c) => String(c.channel ?? '').toLowerCase() === 'whatsapp'))
      setEvents(evts)
      setInvoices(invs)
      // Tareas del cliente: por client_id (robusto) o, si falta, por nombre.
      const nameLc = detail.name.toLowerCase()
      setTasks(tasksRows.filter((t) => (t.client_id && t.client_id === clientId) || (!!t.client_name && t.client_name.toLowerCase().includes(nameLc))))
      setOpportunities(vertical.opportunities)
      setCases(vertical.cases)
      setProperties(vertical.properties)
      setMembers(wsMembers)
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

  // RT4 — crear tarea real vinculada al cliente (RLS), con actividad automática.
  const handleCreateTask = async () => {
    if (!taskForm.title.trim()) { toast.error('Falta el título de la tarea.'); return }
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo (no se guarda)', { description: 'Crear tareas estará disponible al conectar tu cuenta.' })
      return
    }
    if (!workspaceId || !client) { toast.error('Sin workspace activo.'); return }
    setTaskSaving(true)
    try {
      const created = await createTask(workspaceId, {
        clientId: client.id,
        clientName: client.name,
        title: taskForm.title.trim(),
        priority: taskForm.priority,
        status: 'pending',
        dueDate: taskForm.dueDate || undefined,
        assigned_to: taskForm.assignedTo || undefined,
        description: taskForm.description.trim() || undefined,
      })
      setTasks((prev) => [created as TaskRow, ...prev])
      const act = await createActivity(workspaceId, { type: 'note', description: `Tarea creada: ${created.title}`, clientName: client.name }).catch(() => null)
      if (act) setActivities((prev) => [act, ...prev])
      toast.success('Tarea creada')
      setTaskForm({ title: '', priority: 'normal', dueDate: '', assignedTo: '', description: '' })
      setTaskFormOpen(false)
    } catch (error) {
      toast.error('No se pudo crear la tarea', { description: error instanceof Error ? error.message : '' })
    } finally {
      setTaskSaving(false)
    }
  }

  // RT4 — marcar tarea completada / reabrir (RLS), con actividad al completar.
  const handleToggleTask = async (t: TaskRow) => {
    const closed = t.status === 'done' || t.status === 'completed' || t.status === 'closed'
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo (no se guarda)')
      return
    }
    if (!workspaceId || !client) { toast.error('Sin workspace activo.'); return }
    // La BD solo admite 'pending' | 'done' (tasks_status_check); nunca 'completed'.
    const nextStatus = closed ? 'pending' : 'done'
    setTaskBusyId(t.id)
    try {
      const updated = await updateTask(workspaceId, t.id, { status: nextStatus })
      if (!updated) { toast.error('No se pudo actualizar la tarea'); return }
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: nextStatus } : x)))
      if (!closed) {
        const act = await createActivity(workspaceId, { type: 'note', description: `Tarea completada: ${t.title}`, clientName: client.name }).catch(() => null)
        if (act) setActivities((prev) => [act, ...prev])
      }
      toast.success(closed ? 'Tarea reabierta' : 'Tarea completada')
    } catch (error) {
      toast.error('No se pudo actualizar la tarea', { description: error instanceof Error ? error.message : '' })
    } finally {
      setTaskBusyId(null)
    }
  }

  // Refresca el feed de actividad real tras una mutación que loggea internamente.
  const reloadActivityFeed = async () => {
    if (!workspaceId || !client) return
    const acts = await getClientActivityFeed(workspaceId, client.id, client.name).catch(() => null)
    if (acts) setActivities(acts)
  }

  // RT4.2 — crear operación real vinculada al cliente (RLS; activity interna).
  const handleCreateOperation = async () => {
    if (!opForm.title.trim()) { toast.error('Falta el título de la operación.'); return }
    if (isDemoMode()) { toast.info('Modo demo (no se guarda)', { description: 'Crear operaciones estará disponible al conectar tu cuenta.' }); return }
    if (!workspaceId || !client) { toast.error('Sin workspace activo.'); return }
    setOpSaving(true)
    try {
      const created = await createOpportunity(workspaceId, {
        title: opForm.title.trim(),
        vertical: 'real_estate',
        pipeline: 'real_estate',
        stage: opForm.stage,
        clientId: client.id,
        clientName: client.name,
        value: opForm.value ? Number(opForm.value) : null,
        probability: opForm.probability ? Number(opForm.probability) : null,
        assignedTo: opForm.assignedTo || null,
        expectedCloseDate: opForm.expectedCloseDate || null,
        notes: opForm.notes.trim() || null,
      })
      if (!created) { toast.error('No se pudo crear la operación'); return }
      setOpportunities((prev) => [created, ...prev])
      await reloadActivityFeed()
      toast.success('Operación creada')
      setOpForm({ title: '', stage: REAL_ESTATE_STAGES[0]?.id ?? 'new', value: '', probability: '', assignedTo: '', expectedCloseDate: '', notes: '' })
      setOpFormOpen(false)
    } catch (error) {
      toast.error('No se pudo crear la operación', { description: error instanceof Error ? error.message : '' })
    } finally {
      setOpSaving(false)
    }
  }

  // RT4.2 — crear expediente real vinculado al cliente (RLS; activity interna).
  const handleCreateCase = async () => {
    if (!caseForm.title.trim()) { toast.error('Falta el título del trámite.'); return }
    if (isDemoMode()) { toast.info('Modo demo (no se guarda)', { description: 'Crear trámites estará disponible al conectar tu cuenta.' }); return }
    if (!workspaceId || !client) { toast.error('Sin workspace activo.'); return }
    setCaseSaving(true)
    try {
      const created = await createServiceCase(workspaceId, {
        title: caseForm.title.trim(),
        caseType: caseForm.caseType.trim() || 'general',
        vertical: 'real_estate',
        clientId: client.id,
        clientName: client.name,
        status: caseForm.status,
        priority: caseForm.priority,
        assignedTo: caseForm.assignedTo || null,
        dueDate: caseForm.dueDate || null,
        notes: caseForm.notes.trim() || null,
      })
      if (!created) { toast.error('No se pudo crear el trámite'); return }
      setCases((prev) => [created, ...prev])
      await reloadActivityFeed()
      toast.success('Trámite creado')
      setCaseForm({ title: '', caseType: '', status: 'open', priority: 'normal', dueDate: '', assignedTo: '', notes: '' })
      setCaseFormOpen(false)
    } catch (error) {
      toast.error('No se pudo crear el trámite', { description: error instanceof Error ? error.message : '' })
    } finally {
      setCaseSaving(false)
    }
  }

  // RT4.2 — crear evento básico (sin Google). Activity manual (no loggea solo).
  const handleCreateEvent = async () => {
    if (!evForm.title.trim()) { toast.error('Falta el título del evento.'); return }
    if (!evForm.date) { toast.error('Falta la fecha del evento.'); return }
    if (isDemoMode()) { toast.info('Modo demo (no se guarda)', { description: 'Crear eventos estará disponible al conectar tu cuenta.' }); return }
    if (!workspaceId || !client) { toast.error('Sin workspace activo.'); return }
    const [hh, mm] = (evForm.time || '10:00').split(':').map((n) => Number(n))
    setEvSaving(true)
    try {
      const created = await createCalendarEvent(workspaceId, {
        title: evForm.title.trim(),
        type: evForm.type as EventType,
        date: evForm.date,
        time: evForm.time || '10:00',
        startHour: Number.isFinite(hh) ? hh : 10,
        startMinute: Number.isFinite(mm) ? mm : 0,
        duration: Number(evForm.duration) || 60,
        clientId: client.id,
        clientName: client.name,
        location: evForm.location.trim() || undefined,
        notes: evForm.notes.trim() || undefined,
        description: evForm.notes.trim() || undefined,
      })
      setEvents((prev) => [created, ...prev])
      const act = await createActivity(workspaceId, { type: 'note', description: `Evento creado: ${created.title}`, clientName: client.name }).catch(() => null)
      if (act) setActivities((prev) => [act, ...prev])
      toast.success('Evento creado')
      setEvForm({ title: '', type: 'visit', date: '', time: '10:00', duration: '60', location: '', notes: '' })
      setEvFormOpen(false)
    } catch (error) {
      toast.error('No se pudo crear el evento', { description: error instanceof Error ? error.message : '' })
    } finally {
      setEvSaving(false)
    }
  }

  // RT4.3 — guardar edición de operación (etapa/valor/probabilidad/responsable/cierre/notas).
  const handleSaveOp = async () => {
    if (!editOp) return
    if (isDemoMode()) { toast.info('Modo demo (no se guarda)'); return }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    setOpEditSaving(true)
    try {
      const updated = await updateOpportunity(workspaceId, editOp.id, {
        stage: editOp.stage,
        value: editOp.value ? Number(editOp.value) : null,
        probability: editOp.probability ? Number(editOp.probability) : null,
        assignedTo: editOp.assignedTo || null,
        expectedCloseDate: editOp.expectedCloseDate || null,
        notes: editOp.notes.trim() || null,
      })
      if (!updated) { toast.error('No se pudo actualizar la operación'); return }
      setOpportunities((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
      await reloadActivityFeed()
      toast.success('Operación actualizada')
      setEditOp(null)
    } catch (error) {
      toast.error('No se pudo actualizar la operación', { description: error instanceof Error ? error.message : '' })
    } finally {
      setOpEditSaving(false)
    }
  }

  // RT4.3 — guardar edición de expediente (estado/prioridad/responsable/vencimiento/notas).
  const handleSaveCase = async () => {
    if (!editCase) return
    if (isDemoMode()) { toast.info('Modo demo (no se guarda)'); return }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    setCaseEditSaving(true)
    try {
      const updated = await updateServiceCase(workspaceId, editCase.id, {
        status: editCase.status,
        priority: editCase.priority,
        assignedTo: editCase.assignedTo || null,
        dueDate: editCase.dueDate || null,
        notes: editCase.notes.trim() || null,
      })
      if (!updated) { toast.error('No se pudo actualizar el trámite'); return }
      setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      await reloadActivityFeed()
      toast.success('Trámite actualizado')
      setEditCase(null)
    } catch (error) {
      toast.error('No se pudo actualizar el trámite', { description: error instanceof Error ? error.message : '' })
    } finally {
      setCaseEditSaving(false)
    }
  }

  // RT4.3 — guardar edición de tarea (prioridad/fecha/responsable/descripción).
  const handleSaveTask = async () => {
    if (!editTask) return
    if (isDemoMode()) { toast.info('Modo demo (no se guarda)'); return }
    if (!workspaceId || !client) { toast.error('Sin workspace activo.'); return }
    setTaskEditSaving(true)
    try {
      const updated = await updateTask(workspaceId, editTask.id, {
        priority: editTask.priority,
        dueDate: editTask.dueDate || null,
        assignedTo: editTask.assignedTo || null,
        description: editTask.description.trim() || null,
      })
      if (!updated) { toast.error('No se pudo actualizar la tarea'); return }
      setTasks((prev) => prev.map((t) => (t.id === editTask.id ? { ...t, priority: editTask.priority, due_date: editTask.dueDate || undefined, assigned_to: editTask.assignedTo || undefined, description: editTask.description } : t)))
      const act = await createActivity(workspaceId, { type: 'note', description: `Tarea actualizada: ${updated.title}`, clientName: client.name }).catch(() => null)
      if (act) setActivities((prev) => [act, ...prev])
      toast.success('Tarea actualizada')
      setEditTask(null)
    } catch (error) {
      toast.error('No se pudo actualizar la tarea', { description: error instanceof Error ? error.message : '' })
    } finally {
      setTaskEditSaving(false)
    }
  }

  // RT4.3 — reprogramar / editar evento (sin Google).
  const handleSaveEvent = async () => {
    if (!editEvent) return
    if (!editEvent.title.trim()) { toast.error('Falta el título del evento.'); return }
    if (!editEvent.date) { toast.error('Falta la fecha del evento.'); return }
    if (isDemoMode()) { toast.info('Modo demo (no se guarda)'); return }
    if (!workspaceId || !client) { toast.error('Sin workspace activo.'); return }
    const [hh, mm] = (editEvent.time || '10:00').split(':').map((n) => Number(n))
    setEventEditSaving(true)
    try {
      const updated = await updateCalendarEvent(editEvent.id, workspaceId, {
        title: editEvent.title.trim(),
        type: editEvent.type as EventType,
        date: editEvent.date,
        time: editEvent.time || '10:00',
        startHour: Number.isFinite(hh) ? hh : 10,
        startMinute: Number.isFinite(mm) ? mm : 0,
        duration: Number(editEvent.duration) || 60,
        location: editEvent.location.trim() || undefined,
        notes: editEvent.notes.trim() || undefined,
        description: editEvent.notes.trim() || undefined,
      })
      setEvents((prev) => prev.map((ev) => (ev.id === updated.id ? updated : ev)))
      const act = await createActivity(workspaceId, { type: 'note', description: `Evento actualizado: ${updated.title}`, clientName: client.name }).catch(() => null)
      if (act) setActivities((prev) => [act, ...prev])
      toast.success('Evento actualizado')
      setEditEvent(null)
    } catch (error) {
      toast.error('No se pudo actualizar el evento', { description: error instanceof Error ? error.message : '' })
    } finally {
      setEventEditSaving(false)
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

  const handleDeleteDocument = (doc: ClientDocument) => {
    setDocDeleteError(null)
    setDocToDelete(doc)
  }

  const confirmDeleteDocument = async () => {
    if (!docToDelete) return
    setDeletingDoc(true)
    setDocDeleteError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/documents/${docToDelete.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `Error ${res.status}`)
      setDocToDelete(null)
      toast.success('Documento eliminado')
      await loadDocuments()
    } catch (error) {
      setDocDeleteError(error instanceof Error ? error.message : 'No se pudo eliminar el documento.')
    } finally {
      setDeletingDoc(false)
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

  // Resumen ejecutivo: próxima cita y operación abierta del cliente.
  const nextEvent = useMemo(() => {
    const nowMs = new Date().getTime()
    return [...events]
      .map((e) => ({ e, t: Date.parse((e.startAt ?? e.date) ?? '') }))
      .filter((x) => !Number.isNaN(x.t) && x.t >= nowMs)
      .sort((a, b) => a.t - b.t)[0]?.e ?? null
  }, [events])
  const activeOpp = useMemo(
    () => opportunities.find((o) => !['won', 'lost', 'closed'].includes(o.stage)) ?? null,
    [opportunities],
  )

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

  // Tareas ordenadas: vencidas primero, luego "vence pronto", luego el resto y
  // las cerradas al final; dentro de cada grupo, por fecha de vencimiento.
  const sortedTasks = useMemo(() => {
    const rank = (t: TaskRow) => {
      const closed = t.status === 'done' || t.status === 'completed' || t.status === 'closed' || t.status === 'cancelled'
      if (closed) return 3
      const due = taskDueState(t.due_date, t.status)
      return due === 'overdue' ? 0 : due === 'soon' ? 1 : 2
    }
    return [...tasks].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      const da = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY
      const db = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY
      return da - db
    })
  }, [tasks])

  // Mapa id→nombre de miembros del workspace (para mostrar responsables, nunca UUID).
  const memberNameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of members) map[m.id] = m.name
    return map
  }, [members])

  if (loading) {
    // Premium detail skeleton (matches the route loading.tsx) instead of a bare
    // centred spinner, so opening a client's profile never shows "Cargando…".
    return <PageSkeleton variant="detail" />
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
      <ConfirmDialog
        open={Boolean(docToDelete)}
        title="Eliminar documento"
        description={docToDelete ? `Vas a eliminar el documento "${docToDelete.title}". Esta acción no se puede deshacer.` : ''}
        confirmLabel="Eliminar documento"
        loadingLabel="Eliminando…"
        destructive
        loading={deletingDoc}
        error={docDeleteError}
        onConfirm={confirmDeleteDocument}
        onCancel={() => { if (!deletingDoc) { setDocToDelete(null); setDocDeleteError(null) } }}
      />
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
              {client.channel && (
                <Badge variant="default">Origen · {CHANNEL_LABEL[client.channel] ?? client.channel}</Badge>
              )}
              {process.env.NEXT_PUBLIC_NOWLABS_INTERNAL === 'true' && client.leadScore > 0 && (
                <Badge variant="default">Score {client.leadScore}</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {client.company === 'No consta' || !client.company ? 'Sin empresa registrada' : client.company}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600">
              {cleanEmail && <EmailAction email={cleanEmail} variant="link" />}
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
            {cleanEmail && <EmailAction email={cleanEmail} variant="button" label="Email" />}
            <Button variant="secondary" size="sm" onClick={() => router.push(`/clients?edit=${client.id}`)}>
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
            {featureFlags.assistant && (
              <Button
                size="sm"
                onClick={() => router.push('/assistant')}
                title={`Abre el Asistente IA para preguntar sobre ${client.name}`}
              >
                <Bot className="h-3.5 w-3.5" /> Asistente IA
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Tabs — los módulos sin backend real (Documentos/Storage, Conversaciones,
          Facturación) se ocultan al cliente; solo visibles con NOWLABS_INTERNAL.
          El contenido/código de esas pestañas se mantiene intacto. */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-gray-200/70 bg-white p-1 shadow-sm">
        {TABS.filter((t) => process.env.NEXT_PUBLIC_NOWLABS_INTERNAL === 'true' || !['documents', 'conversations', 'invoices'].includes(t.key)).map((tab) => {
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
            <SectionCard title="Resumen ejecutivo" description="Lo esencial de este cliente de un vistazo" bodyClassName="p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { icon: <UserIcon className="h-4 w-4" />, label: 'Perfil', value: (CLIENT_TYPE_LABEL[meta.clientType] ?? '') || (client.company && client.company !== 'No consta' && client.company !== '-' ? client.company : '') || '—' },
                  { icon: <Target className="h-4 w-4" />, label: 'Interés', value: (SERVICE_INTEREST_LABEL[meta.serviceInterest] ?? MAIN_AREA_LABEL[meta.mainArea] ?? '') || meta.interestZone || meta.cityArea || '—' },
                  { icon: <Building2 className="h-4 w-4" />, label: 'Operación activa', value: activeOpp ? activeOpp.title : 'Sin operaciones abiertas' },
                  { icon: <CalendarIcon className="h-4 w-4" />, label: 'Próxima cita', value: nextEvent ? formatDate(nextEvent.startAt ?? nextEvent.date, true) : 'Sin citas próximas' },
                  { icon: <CheckSquare className="h-4 w-4" />, label: 'Tarea pendiente', value: (sortedTasks.find((t) => t.status !== 'done' && t.status !== 'completed' && t.status !== 'closed')?.title) || 'Sin tareas pendientes' },
                  { icon: <FileText className="h-4 w-4" />, label: 'Trámite abierto', value: (cases[0]?.title) || 'Sin trámites abiertos' },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-indigo-100">{item.icon}</span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{item.label}</p>
                      <p className="truncate text-sm font-semibold text-gray-900" title={item.value}>{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

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
                <DetailItem label="Email">{cleanEmail ? <EmailAction email={cleanEmail} variant="link" /> : null}</DetailItem>
                <DetailItem label="Teléfono" value={client.phone !== 'No consta' && client.phone !== '-' ? client.phone : ''} />
                <DetailItem label="Teléfono secundario" value={meta.secondaryPhone} />
                <DetailItem label="Ciudad / zona" value={meta.cityArea} />
                <DetailItem label="Dirección" value={meta.address} className="sm:col-span-2" />
              </dl>
            </SectionCard>

            <SectionCard title="Interés y servicio" description="Qué busca o qué le ofrecemos">
              {(MAIN_AREA_LABEL[meta.mainArea] || SERVICE_INTEREST_LABEL[meta.serviceInterest] || meta.budgetRange || meta.interestZone || meta.cityArea) ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  <DetailItem label="Área principal" value={MAIN_AREA_LABEL[meta.mainArea] ?? ''} />
                  <DetailItem label="Servicio / interés" value={SERVICE_INTEREST_LABEL[meta.serviceInterest] ?? ''} />
                  <DetailItem label="Presupuesto" value={meta.budgetRange} />
                  <DetailItem label="Zona de interés" value={meta.interestZone || meta.cityArea} />
                </dl>
              ) : (
                <p className="text-sm text-gray-500">Añade preferencias (zona, presupuesto o tipo de inmueble) para afinar el seguimiento comercial.</p>
              )}
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
                <StatPill label="Operaciones" value={opportunities.length} hint="Del cliente" />
                <StatPill label="Trámites" value={cases.length} hint="Gestiones abiertas" />
                <StatPill label="Citas" value={events.length} hint="Programadas" />
                <StatPill label="Tareas" value={tasks.length} hint="Asignadas" />
              </div>
            </SectionCard>

            <SectionCard title="Documentos y recursos" bodyClassName="p-4">
              <div className="flex items-start gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-400 ring-1 ring-gray-200">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-700">Documentación del cliente</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-gray-500">Centraliza aquí la documentación vinculada: identificación, contratos, nota simple, reservas y justificantes.</p>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Actividad reciente" description="Acciones registradas">
              {activities.length === 0 ? (
                <p className="text-sm text-gray-500">No hay actividad registrada todavía.</p>
              ) : (
                <ul className="space-y-2">
                  {activities.map((a) => (
                    <li key={a.id} className="flex gap-2.5 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-indigo-600 ring-1 ring-gray-100">
                        {activityIcon(a.type)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs leading-5 text-gray-700">{a.description}</p>
                        <p className="mt-0.5 text-[10px] text-gray-400">{a.timestamp}</p>
                      </div>
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
          description="PDFs, contratos, documentación y adjuntos. Privados al workspace."
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

      {/* Operaciones · trámites · propiedades del cliente. Orden por CSS:
          operaciones primero (lo más comercial), luego trámites y propiedades. */}
      {activeTab === 'cases' && (
        <div className="flex flex-col gap-4">
          <SectionCard
            className="order-2"
            title="Trámites y documentación"
            description="Gestiones asociadas: documentación, contrato, tasación, financiación…"
            action={
              <div className="flex items-center gap-2">
                <Button size="sm" variant={caseFormOpen ? 'secondary' : 'primary'} onClick={() => setCaseFormOpen((v) => !v)}>
                  <Plus className="h-3.5 w-3.5" /> {caseFormOpen ? 'Cerrar' : 'Nuevo trámite'}
                </Button>
                <Link href="/opportunities" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Ir a Gestión</Link>
              </div>
            }
          >
            {caseFormOpen && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] font-medium text-gray-600">Título *</span><input value={caseForm.title} onChange={(e) => setCaseForm((p) => ({ ...p, title: e.target.value }))} placeholder="Ej. Contrato de arras" className={taskInputCls} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Tipo</span><input value={caseForm.caseType} onChange={(e) => setCaseForm((p) => ({ ...p, caseType: e.target.value }))} placeholder="Contrato, tasación, financiación…" className={taskInputCls} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Estado</span><select value={caseForm.status} onChange={(e) => setCaseForm((p) => ({ ...p, status: e.target.value }))} className={taskInputCls}>{Object.entries(CASE_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Prioridad</span><select value={caseForm.priority} onChange={(e) => setCaseForm((p) => ({ ...p, priority: e.target.value }))} className={taskInputCls}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option></select></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Vencimiento</span><input type="date" value={caseForm.dueDate} onChange={(e) => setCaseForm((p) => ({ ...p, dueDate: e.target.value }))} className={taskInputCls} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Responsable</span><select value={caseForm.assignedTo} onChange={(e) => setCaseForm((p) => ({ ...p, assignedTo: e.target.value }))} className={taskInputCls}><option value="">Sin asignar</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                  <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] font-medium text-gray-600">Notas</span><input value={caseForm.notes} onChange={(e) => setCaseForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Opcional" className={taskInputCls} /></label>
                </div>
                <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setCaseFormOpen(false)}>Cancelar</Button><Button size="sm" loading={caseSaving} onClick={handleCreateCase}>Crear trámite</Button></div>
              </div>
            )}
            {cases.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-4 text-center">
                <p className="text-sm font-medium text-gray-700">Sin trámites abiertos</p>
                <p className="mt-0.5 text-xs text-gray-500">Aquí aparecerán gestiones como documentación, contrato, tasación o financiación.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {cases.map((c) => (
                  <li key={c.id} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{c.title}</p>
                        <p className="text-[11px] text-gray-500">
                          {[c.case_type, labelOr(CASE_STATUS_LABEL, c.status), c.priority && c.priority !== 'normal' ? `prioridad ${labelOr(TASK_PRIORITY_LABEL, c.priority)}` : null, c.due_date ? `vence ${formatDate(c.due_date)}` : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={c.status === 'documentation_pending' ? 'warning' : c.status === 'resolved' || c.status === 'closed' ? 'default' : 'purple'}>
                          {labelOr(CASE_STATUS_LABEL, c.status)}
                        </Badge>
                        <button type="button" onClick={() => setEditCase(editCase?.id === c.id ? null : { id: c.id, status: c.status, priority: c.priority || 'normal', assignedTo: c.assigned_to ?? '', dueDate: c.due_date ?? '', notes: c.notes ?? '' })} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50">Editar</button>
                      </div>
                    </div>
                    {editCase?.id === c.id && (
                      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Estado</span><select value={editCase.status} onChange={(e) => setEditCase((p) => p && { ...p, status: e.target.value })} className={taskInputCls}>{Object.entries(CASE_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Prioridad</span><select value={editCase.priority} onChange={(e) => setEditCase((p) => p && { ...p, priority: e.target.value })} className={taskInputCls}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option></select></label>
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Responsable</span><select value={editCase.assignedTo} onChange={(e) => setEditCase((p) => p && { ...p, assignedTo: e.target.value })} className={taskInputCls}><option value="">Sin asignar</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Vencimiento</span><input type="date" value={editCase.dueDate} onChange={(e) => setEditCase((p) => p && { ...p, dueDate: e.target.value })} className={taskInputCls} /></label>
                          <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] font-medium text-gray-600">Notas</span><input value={editCase.notes} onChange={(e) => setEditCase((p) => p && { ...p, notes: e.target.value })} className={taskInputCls} /></label>
                        </div>
                        <div className="mt-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEditCase(null)}>Cancelar</Button><Button size="sm" loading={caseEditSaving} onClick={handleSaveCase}>Guardar</Button></div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard className="order-3" title="Propiedades vinculadas" description="Captaciones y propiedades de interés">
            {properties.length === 0 ? (
              <p className="text-sm text-gray-500">Sin propiedades vinculadas.</p>
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

          <SectionCard
            className="order-1"
            title="Operaciones del cliente"
            description="Compraventas y alquileres en seguimiento"
            action={
              <Button size="sm" variant={opFormOpen ? 'secondary' : 'primary'} onClick={() => setOpFormOpen((v) => !v)}>
                <Plus className="h-3.5 w-3.5" /> {opFormOpen ? 'Cerrar' : 'Nueva operación'}
              </Button>
            }
          >
            {opFormOpen && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] font-medium text-gray-600">Título *</span><input value={opForm.title} onChange={(e) => setOpForm((p) => ({ ...p, title: e.target.value }))} placeholder="Ej. Compra piso Centro" className={taskInputCls} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Etapa</span><select value={opForm.stage} onChange={(e) => setOpForm((p) => ({ ...p, stage: e.target.value }))} className={taskInputCls}>{REAL_ESTATE_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Responsable</span><select value={opForm.assignedTo} onChange={(e) => setOpForm((p) => ({ ...p, assignedTo: e.target.value }))} className={taskInputCls}><option value="">Sin asignar</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Valor (€)</span><input type="number" value={opForm.value} onChange={(e) => setOpForm((p) => ({ ...p, value: e.target.value }))} placeholder="Opcional" className={taskInputCls} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Probabilidad (%)</span><input type="number" value={opForm.probability} onChange={(e) => setOpForm((p) => ({ ...p, probability: e.target.value }))} placeholder="Opcional" className={taskInputCls} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Cierre estimado</span><input type="date" value={opForm.expectedCloseDate} onChange={(e) => setOpForm((p) => ({ ...p, expectedCloseDate: e.target.value }))} className={taskInputCls} /></label>
                  <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] font-medium text-gray-600">Notas</span><input value={opForm.notes} onChange={(e) => setOpForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Opcional" className={taskInputCls} /></label>
                </div>
                <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setOpFormOpen(false)}>Cancelar</Button><Button size="sm" loading={opSaving} onClick={handleCreateOperation}>Crear operación</Button></div>
              </div>
            )}
            {opportunities.length === 0 ? (
              <p className="text-sm text-gray-500">Aún no hay operaciones abiertas con este cliente. Crea una para empezar el seguimiento comercial.</p>
            ) : (
              <ul className="space-y-2.5">
                {opportunities.map((o) => (
                  <li key={o.id} className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm shadow-gray-950/[0.02]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{o.title}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                          {o.value != null && o.value > 0 && <span className="font-semibold text-gray-700">{formatEuro(o.value, o.currency ?? 'EUR')}</span>}
                          {o.probability != null && <span>{o.probability}% prob.</span>}
                          {o.expected_close_date && <span>cierre {formatDate(o.expected_close_date)}</span>}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={o.stage === 'won' ? 'success' : o.stage === 'lost' ? 'danger' : 'indigo'}>
                          <Target className="h-3 w-3" /> {stageLabel(o.vertical, o.stage)}
                        </Badge>
                        <button type="button" onClick={() => setEditOp(editOp?.id === o.id ? null : { id: o.id, stage: o.stage, value: o.value != null ? String(o.value) : '', probability: o.probability != null ? String(o.probability) : '', assignedTo: o.assigned_to ?? '', expectedCloseDate: o.expected_close_date ?? '', notes: o.notes ?? '' })} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50">Editar</button>
                      </div>
                    </div>
                    {editOp?.id === o.id && (
                      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Etapa</span><select value={editOp.stage} onChange={(e) => setEditOp((p) => p && { ...p, stage: e.target.value })} className={taskInputCls}>{REAL_ESTATE_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Responsable</span><select value={editOp.assignedTo} onChange={(e) => setEditOp((p) => p && { ...p, assignedTo: e.target.value })} className={taskInputCls}><option value="">Sin asignar</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Valor (€)</span><input type="number" value={editOp.value} onChange={(e) => setEditOp((p) => p && { ...p, value: e.target.value })} className={taskInputCls} /></label>
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Probabilidad (%)</span><input type="number" value={editOp.probability} onChange={(e) => setEditOp((p) => p && { ...p, probability: e.target.value })} className={taskInputCls} /></label>
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Cierre estimado</span><input type="date" value={editOp.expectedCloseDate} onChange={(e) => setEditOp((p) => p && { ...p, expectedCloseDate: e.target.value })} className={taskInputCls} /></label>
                          <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] font-medium text-gray-600">Notas</span><input value={editOp.notes} onChange={(e) => setEditOp((p) => p && { ...p, notes: e.target.value })} className={taskInputCls} /></label>
                        </div>
                        <div className="mt-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEditOp(null)}>Cancelar</Button><Button size="sm" loading={opEditSaving} onClick={handleSaveOp}>Guardar</Button></div>
                      </div>
                    )}
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
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" variant={evFormOpen ? 'secondary' : 'primary'} onClick={() => setEvFormOpen((v) => !v)}>
                <Plus className="h-3.5 w-3.5" /> {evFormOpen ? 'Cerrar' : 'Nuevo evento'}
              </Button>
              <Link href="/calendar" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Abrir calendario</Link>
            </div>
          }
        >
          {evFormOpen && (
            <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] font-medium text-gray-600">Título *</span><input value={evForm.title} onChange={(e) => setEvForm((p) => ({ ...p, title: e.target.value }))} placeholder="Ej. Visita al piso" className={taskInputCls} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Tipo</span><select value={evForm.type} onChange={(e) => setEvForm((p) => ({ ...p, type: e.target.value }))} className={taskInputCls}><option value="visit">Visita</option><option value="call">Llamada</option><option value="meeting">Reunión</option><option value="follow-up">Seguimiento</option><option value="signing">Firma</option><option value="valuation">Valoración</option><option value="other">Otro</option></select></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Duración (min)</span><input type="number" value={evForm.duration} onChange={(e) => setEvForm((p) => ({ ...p, duration: e.target.value }))} className={taskInputCls} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Fecha *</span><input type="date" value={evForm.date} onChange={(e) => setEvForm((p) => ({ ...p, date: e.target.value }))} className={taskInputCls} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Hora</span><input type="time" value={evForm.time} onChange={(e) => setEvForm((p) => ({ ...p, time: e.target.value }))} className={taskInputCls} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Ubicación</span><input value={evForm.location} onChange={(e) => setEvForm((p) => ({ ...p, location: e.target.value }))} placeholder="Opcional" className={taskInputCls} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Notas</span><input value={evForm.notes} onChange={(e) => setEvForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Opcional" className={taskInputCls} /></label>
              </div>
              <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEvFormOpen(false)}>Cancelar</Button><Button size="sm" loading={evSaving} onClick={handleCreateEvent}>Crear evento</Button></div>
            </div>
          )}
          {events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center">
              <CalendarIcon className="mx-auto mb-2 h-6 w-6 text-gray-400" />
              <p className="text-sm font-medium text-gray-700">Sin citas programadas</p>
              <p className="mt-1 text-xs text-gray-500">Aquí aparecerán visitas, llamadas o reuniones vinculadas a este cliente.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {events.map((event) => (
                <li key={event.id} className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm shadow-gray-950/[0.02]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{event.title}</p>
                      <p className="text-[11px] text-gray-500">
                        {[formatDate(event.startAt ?? event.date, true), event.location, labelOr(EVENT_TYPE_LABEL, event.type)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="indigo">{labelOr(EVENT_TYPE_LABEL, event.type)}</Badge>
                      <button type="button" onClick={() => setEditEvent(editEvent?.id === event.id ? null : { id: event.id, title: event.title, type: event.type, date: event.date, time: `${String(event.startHour).padStart(2, '0')}:${String(event.startMinute ?? 0).padStart(2, '0')}`, duration: event.duration != null ? String(event.duration) : '60', location: event.location ?? '', notes: event.notes ?? '' })} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50">Editar</button>
                    </div>
                  </div>
                  {editEvent?.id === event.id && (
                    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] font-medium text-gray-600">Título *</span><input value={editEvent.title} onChange={(e) => setEditEvent((p) => p && { ...p, title: e.target.value })} className={taskInputCls} /></label>
                        <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Tipo</span><select value={editEvent.type} onChange={(e) => setEditEvent((p) => p && { ...p, type: e.target.value })} className={taskInputCls}><option value="visit">Visita</option><option value="call">Llamada</option><option value="meeting">Reunión</option><option value="follow-up">Seguimiento</option><option value="signing">Firma</option><option value="valuation">Valoración</option><option value="other">Otro</option></select></label>
                        <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Duración (min)</span><input type="number" value={editEvent.duration} onChange={(e) => setEditEvent((p) => p && { ...p, duration: e.target.value })} className={taskInputCls} /></label>
                        <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Fecha *</span><input type="date" value={editEvent.date} onChange={(e) => setEditEvent((p) => p && { ...p, date: e.target.value })} className={taskInputCls} /></label>
                        <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Hora</span><input type="time" value={editEvent.time} onChange={(e) => setEditEvent((p) => p && { ...p, time: e.target.value })} className={taskInputCls} /></label>
                        <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Ubicación</span><input value={editEvent.location} onChange={(e) => setEditEvent((p) => p && { ...p, location: e.target.value })} className={taskInputCls} /></label>
                        <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Notas</span><input value={editEvent.notes} onChange={(e) => setEditEvent((p) => p && { ...p, notes: e.target.value })} className={taskInputCls} /></label>
                      </div>
                      <div className="mt-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEditEvent(null)}>Cancelar</Button><Button size="sm" loading={eventEditSaving} onClick={handleSaveEvent}>Guardar</Button></div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {activeTab === 'tasks' && (
        <SectionCard
          title="Tareas"
          description="Tareas vinculadas a este cliente"
          action={
            <Button size="sm" variant={taskFormOpen ? 'secondary' : 'primary'} onClick={() => setTaskFormOpen((v) => !v)}>
              <Plus className="h-3.5 w-3.5" /> {taskFormOpen ? 'Cerrar' : 'Nueva tarea'}
            </Button>
          }
        >
          {taskFormOpen && (
            <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600">Título *</span>
                  <input value={taskForm.title} onChange={(e) => setTaskForm((p) => ({ ...p, title: e.target.value }))} placeholder="Ej. Llamar para confirmar visita" className={taskInputCls} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600">Prioridad</span>
                  <select value={taskForm.priority} onChange={(e) => setTaskForm((p) => ({ ...p, priority: e.target.value }))} className={taskInputCls}>
                    <option value="low">Baja</option>
                    <option value="normal">Normal</option>
                    <option value="high">Alta</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600">Vencimiento</span>
                  <input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm((p) => ({ ...p, dueDate: e.target.value }))} className={taskInputCls} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600">Responsable</span>
                  <select value={taskForm.assignedTo} onChange={(e) => setTaskForm((p) => ({ ...p, assignedTo: e.target.value }))} className={taskInputCls}>
                    <option value="">Sin asignar</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600">Descripción</span>
                  <input value={taskForm.description} onChange={(e) => setTaskForm((p) => ({ ...p, description: e.target.value }))} placeholder="Opcional" className={taskInputCls} />
                </label>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setTaskFormOpen(false)}>Cancelar</Button>
                <Button size="sm" loading={taskSaving} onClick={handleCreateTask}>Crear tarea</Button>
              </div>
            </div>
          )}
          {sortedTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center">
              <CheckSquare className="mx-auto mb-2 h-6 w-6 text-gray-400" />
              <p className="text-sm font-medium text-gray-700">Sin tareas pendientes</p>
              <p className="mt-1 text-xs text-gray-500">Aquí aparecerán seguimientos, llamadas y acciones comerciales del cliente.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {sortedTasks.map((t) => {
                const due = taskDueState(t.due_date, t.status)
                const closed = t.status === 'done' || t.status === 'completed' || t.status === 'closed' || t.status === 'cancelled'
                return (
                  <li key={t.id} className={cn('rounded-xl border bg-white p-3 shadow-sm shadow-gray-950/[0.02]', due === 'overdue' && !closed ? 'border-red-200' : 'border-gray-100')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={cn('truncate text-sm font-semibold', closed ? 'text-gray-400 line-through' : 'text-gray-900')}>{t.title}</p>
                        {t.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">{t.description}</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                          <Badge variant={t.priority === 'high' ? 'danger' : t.priority === 'low' ? 'default' : 'indigo'}>{labelOr(TASK_PRIORITY_LABEL, t.priority)}</Badge>
                          {t.due_date && (
                            <span className={cn('inline-flex items-center gap-1', due === 'overdue' ? 'font-semibold text-red-600' : due === 'soon' ? 'font-medium text-amber-600' : 'text-gray-500')}>
                              <Clock className="h-3 w-3" />
                              {due === 'overdue' ? 'Vencida · ' : due === 'soon' ? 'Vence pronto · ' : 'Vence '}{formatDate(t.due_date)}
                            </span>
                          )}
                          <span className="text-gray-400">· {t.assigned_to ? (memberNameById[t.assigned_to] ?? 'Responsable') : 'Sin asignar'}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={closed ? 'success' : 'indigo'}>{labelOr(TASK_STATUS_LABEL, t.status)}</Badge>
                        <button type="button" onClick={() => setEditTask(editTask?.id === t.id ? null : { id: t.id, priority: t.priority, dueDate: t.due_date ?? '', assignedTo: t.assigned_to ?? '', description: t.description ?? '' })} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50">Editar</button>
                        <button
                          type="button"
                          onClick={() => handleToggleTask(t)}
                          disabled={taskBusyId === t.id}
                          title={closed ? 'Reabrir tarea' : 'Marcar completada'}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {taskBusyId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          {closed ? 'Reabrir' : 'Completar'}
                        </button>
                      </div>
                    </div>
                    {editTask?.id === t.id && (
                      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Prioridad</span><select value={editTask.priority} onChange={(e) => setEditTask((p) => p && { ...p, priority: e.target.value })} className={taskInputCls}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option></select></label>
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Vencimiento</span><input type="date" value={editTask.dueDate} onChange={(e) => setEditTask((p) => p && { ...p, dueDate: e.target.value })} className={taskInputCls} /></label>
                          <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Responsable</span><select value={editTask.assignedTo} onChange={(e) => setEditTask((p) => p && { ...p, assignedTo: e.target.value })} className={taskInputCls}><option value="">Sin asignar</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                          <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] font-medium text-gray-600">Descripción</span><input value={editTask.description} onChange={(e) => setEditTask((p) => p && { ...p, description: e.target.value })} className={taskInputCls} /></label>
                        </div>
                        <div className="mt-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEditTask(null)}>Cancelar</Button><Button size="sm" loading={taskEditSaving} onClick={handleSaveTask}>Guardar</Button></div>
                      </div>
                    )}
                  </li>
                )
              })}
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

function DetailItem({ label, value, children, className }: { label: string; value?: string; children?: React.ReactNode; className?: string }) {
  const present = children != null || (value && value.trim().length > 0)
  // Los campos vacíos pierden la caja (borde/fondo) para que no compitan con los
  // datos reales: el dato relleno destaca, el vacío recede con un "—" discreto.
  // `children` permite renderizar un valor accionable (p. ej. <EmailAction/>).
  return (
    <div className={cn('rounded-lg px-3 py-2.5', present ? 'border border-gray-100 bg-gray-50/40' : 'border border-transparent', className)}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={cn('mt-0.5 text-sm', present ? 'text-gray-900' : 'text-gray-300')}>
        {children ?? (present ? value : '—')}
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
