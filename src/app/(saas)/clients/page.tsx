'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Search,
  Plus,
  Mail,
  Phone,
  X,
  User,
  Pencil,
  Trash2,
  AlertCircle,
  FolderOpen,
  ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { cn } from '@/lib/utils'
import {
  createActivity,
  createClientLead,
  getClients,
  getWorkspaceContext,
  updateClient,
} from '@/lib/supabase-queries'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { DeleteClientDialog } from '@/components/DeleteClientDialog'
import { clients as demoClients } from '@/lib/mock-data'
import type { Client, ClientStatus } from '@/lib/types'

// Status filter — sólo Activos/Inactivos/Archivados como protagonistas.
// `lead` se mantiene como estado interno seleccionable en el formulario
// (compatibilidad con datos previos), pero no como filtro principal.
type StatusFilter = 'todos' | 'active' | 'inactive' | 'churned'
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'active', label: 'Activos' },
  { key: 'inactive', label: 'Inactivos' },
  { key: 'churned', label: 'Archivados' },
]

const STATUS_BADGE: Record<ClientStatus, { label: string; variant: 'success' | 'indigo' | 'default' | 'danger' }> = {
  active: { label: 'Activo', variant: 'success' },
  lead: { label: 'En seguimiento', variant: 'indigo' },
  inactive: { label: 'Inactivo', variant: 'default' },
  churned: { label: 'Archivado', variant: 'default' },
}

// ---------- Form types (mapped to clients table; extra fields go to metadata) ----------

type ClientType =
  | 'particular'
  | 'empresa'
  | 'propietario'
  | 'comprador'
  | 'inquilino'
  | 'gestoria'
  | 'otro'

const CLIENT_TYPE_OPTIONS: { value: ClientType; label: string }[] = [
  { value: 'particular', label: 'Particular' },
  { value: 'empresa', label: 'Empresa' },
  { value: 'propietario', label: 'Propietario' },
  { value: 'comprador', label: 'Comprador' },
  { value: 'inquilino', label: 'Inquilino' },
  { value: 'gestoria', label: 'Cliente gestoría' },
  { value: 'otro', label: 'Otro' },
]

type MainArea = 'inmobiliaria' | 'gestoria' | 'ambas' | ''
const MAIN_AREA_OPTIONS: { value: Exclude<MainArea, ''>; label: string }[] = [
  { value: 'inmobiliaria', label: 'Inmobiliaria' },
  { value: 'gestoria', label: 'Gestoría / Extranjería' },
  { value: 'ambas', label: 'Ambas' },
]

const SERVICE_INTEREST_OPTIONS: { value: string; label: string }[] = [
  { value: 'compra', label: 'Comprar vivienda' },
  { value: 'venta', label: 'Vender vivienda' },
  { value: 'alquiler', label: 'Alquilar' },
  { value: 'gestion_documental', label: 'Gestión documental' },
  { value: 'nie_extranjeria', label: 'NIE / extranjería' },
  { value: 'fiscalidad', label: 'Fiscalidad / gestoría' },
  { value: 'otro', label: 'Otro' },
]

const STATUS_FORM_OPTIONS: { value: ClientStatus; label: string }[] = [
  { value: 'active', label: 'Activo' },
  { value: 'lead', label: 'En seguimiento' },
  { value: 'inactive', label: 'Inactivo' },
  { value: 'churned', label: 'Archivado' },
]

type ClientForm = {
  id?: string
  // Sección 1 — datos
  name: string
  company: string
  documentId: string
  clientType: ClientType
  preferredLanguage: string
  nationality: string
  // Sección 2 — contacto
  email: string
  phone: string
  secondaryPhone: string
  address: string
  cityArea: string
  // Sección 3 — interés
  mainArea: MainArea
  serviceInterest: string
  budgetRange: string
  interestZone: string
  // Sección 4 — internas
  notes: string
  nextAction: string
  assignedTo: string
  status: ClientStatus
}

const emptyForm: ClientForm = {
  name: '',
  company: '',
  documentId: '',
  clientType: 'particular',
  preferredLanguage: '',
  nationality: '',
  email: '',
  phone: '',
  secondaryPhone: '',
  address: '',
  cityArea: '',
  mainArea: '',
  serviceInterest: '',
  budgetRange: '',
  interestZone: '',
  notes: '',
  nextAction: '',
  assignedTo: '',
  status: 'active',
}

function readMeta(client: Client, key: string, fallback = ''): string {
  const m = client.metadata
  if (!m) return fallback
  const value = m[key]
  return typeof value === 'string' ? value : fallback
}

function toForm(client: Client): ClientForm {
  const company = client.company === 'Sin empresa' || client.company === '-' || client.company === 'No consta' ? '' : client.company
  const phone = client.phone === '-' || client.phone === 'No consta' ? '' : client.phone
  const ct = readMeta(client, 'client_type', 'particular')
  const validCT = (CLIENT_TYPE_OPTIONS.some((c) => c.value === ct) ? ct : 'particular') as ClientType
  const ma = readMeta(client, 'main_area', '')
  const validMA: MainArea = ma === 'inmobiliaria' || ma === 'gestoria' || ma === 'ambas' ? ma : ''
  return {
    id: client.id,
    name: client.name === 'No consta' ? '' : client.name,
    company,
    documentId: readMeta(client, 'document_id'),
    clientType: validCT,
    preferredLanguage: readMeta(client, 'preferred_language'),
    nationality: readMeta(client, 'nationality'),
    email: client.email === 'No consta' ? '' : client.email,
    phone,
    secondaryPhone: readMeta(client, 'secondary_phone'),
    address: readMeta(client, 'address'),
    cityArea: readMeta(client, 'city_area'),
    mainArea: validMA,
    serviceInterest: readMeta(client, 'service_interest'),
    budgetRange: readMeta(client, 'budget_range'),
    interestZone: readMeta(client, 'interest_zone'),
    notes: client.notes && client.notes !== 'No consta' ? client.notes : '',
    nextAction: readMeta(client, 'next_action'),
    assignedTo: readMeta(client, 'assigned_to'),
    status: client.status,
  }
}

function describeArea(client: Client): { label: string; tone: 'indigo' | 'info' | 'purple' | 'default' } | null {
  const area = readMeta(client, 'main_area')
  const service = readMeta(client, 'service_interest')
  const labelArea =
    area === 'inmobiliaria' ? 'Inmobiliaria' :
    area === 'gestoria' ? 'Gestoría' :
    area === 'ambas' ? 'Inmobiliaria + Gestoría' :
    ''
  const labelService = SERVICE_INTEREST_OPTIONS.find((o) => o.value === service)?.label ?? ''
  const combined = [labelArea, labelService].filter(Boolean).join(' · ')
  if (!combined) return null
  const tone: 'indigo' | 'info' | 'purple' = area === 'gestoria' ? 'purple' : area === 'inmobiliaria' ? 'info' : 'indigo'
  return { label: combined, tone }
}

function buildMetadata(form: ClientForm, existing?: Record<string, unknown>) {
  const meta: Record<string, unknown> = { ...(existing ?? {}) }
  const setOrDel = (key: string, value: string) => {
    if (value && value.trim()) meta[key] = value.trim()
    else delete meta[key]
  }
  setOrDel('document_id', form.documentId)
  setOrDel('client_type', form.clientType)
  setOrDel('preferred_language', form.preferredLanguage)
  setOrDel('nationality', form.nationality)
  setOrDel('secondary_phone', form.secondaryPhone)
  setOrDel('address', form.address)
  setOrDel('city_area', form.cityArea)
  setOrDel('main_area', form.mainArea)
  setOrDel('service_interest', form.serviceInterest)
  setOrDel('budget_range', form.budgetRange)
  setOrDel('interest_zone', form.interestZone)
  setOrDel('next_action', form.nextAction)
  setOrDel('assigned_to', form.assignedTo)
  return meta
}

export default function ClientsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editParam = searchParams?.get('edit') ?? null
  const [clientList, setClientList] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<ClientForm>(emptyForm)
  const [editingExistingMeta, setEditingExistingMeta] = useState<Record<string, unknown> | undefined>(undefined)
  // Conservamos valores "internos" del cliente (channel, leadScore) al editar
  // para no pisar lo que ya había con defaults del formulario nuevo.
  const [editingOriginal, setEditingOriginal] = useState<{ channel: Client['channel']; leadScore: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const loadClients = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      setClientList(demoClients)
      setWorkspaceId(null)
      setLoadError('')
      setLoading(false)
      return
    }
    try {
      const context = await getWorkspaceContext()
      const resolved = context?.workspace?.id || context?.profile?.workspace_id
      if (!resolved) {
        setClientList([])
        setWorkspaceId(null)
        setLoadError('Tu cuenta aún no tiene workspace asignado. Contacta con el responsable interno.')
        return
      }
      const realClients = await getClients(resolved)
      setClientList(realClients)
      setWorkspaceId(resolved)
    } catch {
      setClientList([])
      setWorkspaceId(null)
      setLoadError('No se pudieron cargar los clientes. Vuelve a intentarlo o contacta con soporte.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadClients() }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadClients])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setModalOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Auto-open edit modal cuando llegamos con ?edit=<clientId> (p.ej. desde la
  // ficha del cliente). Sólo cuando la lista ya está cargada y existe el cliente.
  useEffect(() => {
    if (!editParam) return
    if (loading) return
    const target = clientList.find((c) => c.id === editParam)
    if (!target) return
    const timeout = window.setTimeout(() => {
      setForm(toForm(target))
      setEditingExistingMeta(target.metadata)
      setEditingOriginal({ channel: target.channel, leadScore: target.leadScore })
      setModalOpen(true)
      // Limpiamos el query param para que no se reabra al refrescar.
      router.replace('/clients')
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [editParam, loading, clientList, router])

  const filtered = useMemo(() => clientList.filter((c) => {
    const term = search.trim().toLowerCase()
    if (term) {
      const haystack = [c.name, c.company, c.email, c.phone, readMeta(c, 'secondary_phone'), readMeta(c, 'document_id')]
        .map((v) => v?.toLowerCase() ?? '')
        .join(' ')
      if (!haystack.includes(term)) return false
    }
    if (statusFilter !== 'todos' && c.status !== statusFilter) return false
    return true
  }), [clientList, search, statusFilter])

  const counts = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    return {
      total: clientList.length,
      active: clientList.filter((c) => c.status === 'active').length,
      lead: clientList.filter((c) => c.status === 'lead').length,
      inactive: clientList.filter((c) => c.status === 'inactive').length,
      newThisMonth: clientList.filter((c) => {
        const t = c.createdAt ? Date.parse(c.createdAt) : NaN
        return !Number.isNaN(t) && t >= monthStart
      }).length,
    }
  }, [clientList])

  const openCreateModal = () => {
    setForm(emptyForm)
    setEditingExistingMeta(undefined)
    setEditingOriginal(null)
    setModalOpen(true)
  }

  const openEditModal = (client: Client) => {
    setForm(toForm(client))
    setEditingExistingMeta(client.metadata)
    setEditingOriginal({ channel: client.channel, leadScore: client.leadScore })
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Falta el nombre del cliente.')
      return
    }
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo (solo lectura)', { description: 'Crear y editar clientes estará disponible al conectar tu cuenta.' })
      return
    }
    if (!workspaceId) {
      toast.error('No se ha encontrado workspace activo.')
      return
    }

    const metadata = buildMetadata(form, editingExistingMeta)
    // En CREATE usamos defaults internos (channel='crm', leadScore=0).
    // En UPDATE preservamos los valores previos del cliente para no pisar
    // datos legítimos creados por otros flujos (Inbox WhatsApp, etc.).
    const isUpdate = Boolean(form.id)
    const preservedChannel: Client['channel'] = isUpdate && editingOriginal ? editingOriginal.channel : 'crm'
    const preservedLeadScore = isUpdate && editingOriginal ? editingOriginal.leadScore : 0
    const payload = {
      name: form.name.trim(),
      company: form.company.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      channel: preservedChannel,
      status: form.status,
      leadScore: preservedLeadScore,
      notes: form.notes.trim(),
      metadata,
    }

    setSaving(true)
    try {
      let createdId: string | null = null
      if (form.id) {
        await updateClient(form.id, payload)
        await createActivity(workspaceId, { type: 'note', description: `Cliente actualizado: ${payload.name}`, clientName: payload.name })
        toast.success(`Cliente actualizado: ${payload.name}`)
      } else {
        const created = await createClientLead(workspaceId, payload)
        createdId = created.id
        await createActivity(workspaceId, { type: 'deal', description: `Nuevo cliente creado: ${payload.name}`, clientName: payload.name })
        toast.success(`Cliente creado: ${payload.name}`)
      }
      await loadClients()
      setModalOpen(false)
      setForm(emptyForm)
      setEditingExistingMeta(undefined)
      setEditingOriginal(null)
      if (createdId) {
        // Abre la ficha del cliente recién creado para continuar el alta.
        router.push(`/clients/${createdId}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      toast.error(`No se pudo guardar el cliente: ${message}`)
    } finally {
      setSaving(false)
    }
  }

  // El borrado real (preview + doble confirmación + cascada) lo gestiona
  // DeleteClientDialog contra /api/clients/[id]/delete. En modo demo es solo
  // lectura, así que abrir el diálogo se bloquea desde el botón de la papelera.
  const requestDeleteClient = (client: Client) => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo (solo lectura)', { description: 'Eliminar clientes estará disponible al conectar tu cuenta.' })
      return
    }
    setClientToDelete(client)
  }

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Clientes"
        description={counts.total === 0
          ? 'Compradores, propietarios, inquilinos y clientes de gestoría.'
          : `${filtered.length} visibles de ${counts.total} clientes — ${counts.active} activos · ${counts.inactive} inactivos`}
        action={
          <Button size="sm" onClick={openCreateModal}>
            <Plus className="h-3.5 w-3.5" />
            Nuevo cliente
          </Button>
        }
      />

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      {!loading && counts.total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total clientes', value: counts.total, tone: 'text-gray-900', bar: 'from-gray-300 to-gray-400' },
            { label: 'Activos', value: counts.active, tone: 'text-emerald-700', bar: 'from-emerald-400 to-teal-400' },
            { label: 'En seguimiento', value: counts.lead, tone: 'text-indigo-700', bar: 'from-indigo-400 to-violet-400' },
            { label: 'Nuevos este mes', value: counts.newThisMonth, tone: 'text-sky-700', bar: 'from-sky-400 to-indigo-400' },
          ].map((s) => (
            <div key={s.label} className="relative overflow-hidden rounded-2xl border border-gray-200/70 bg-white px-4 py-3 shadow-sm">
              <span className={cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-80', s.bar)} aria-hidden />
              <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-400">{s.label}</p>
              <p className={cn('mt-1 text-2xl font-bold leading-none tabular-nums', s.tone)}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <SectionCard
        title="Base de clientes"
        description="Listado completo del workspace"
        noPadding
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50/50 px-5 py-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por nombre, email, teléfono, empresa o DNI…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  statusFilter === s.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400">
                <th className="px-5 py-3 text-left font-semibold">Cliente</th>
                <th className="px-4 py-3 text-left font-semibold">Contacto</th>
                <th className="px-4 py-3 text-left font-semibold">Área / servicio</th>
                <th className="px-4 py-3 text-left font-semibold">Estado</th>
                <th className="px-4 py-3 text-left font-semibold">Alta</th>
                <th className="px-4 py-3 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && [0, 1, 2, 3, 4].map((i) => (
                <tr key={`client-skeleton-${i}`} className="border-t border-gray-50">
                  <td colSpan={6} className="px-4 py-3.5">
                    <div className="h-5 w-full animate-pulse rounded-md bg-slate-100" />
                  </td>
                </tr>
              ))}

              {!loading && filtered.map((client, i) => {
                const area = describeArea(client)
                const status = STATUS_BADGE[client.status]
                const created = client.createdAt ? new Date(client.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
                const email = client.email && client.email !== 'No consta' ? client.email : ''
                const phone = client.phone && client.phone !== 'No consta' && client.phone !== '-' ? client.phone : ''
                return (
                  <tr key={client.id} className={cn('border-b border-gray-50 transition-colors hover:bg-indigo-50/30', i === filtered.length - 1 && 'border-b-0')}>
                    <td className="px-5 py-3.5">
                      <button type="button" onClick={() => router.push(`/clients/${client.id}`)} className="flex items-center gap-3 text-left">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-50 to-sky-50 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
                          {client.avatar}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900 group-hover:text-indigo-700">{client.name}</p>
                          <p className="truncate text-[11px] text-gray-500">{client.company !== 'No consta' && client.company !== '-' ? client.company : 'Sin empresa'}</p>
                        </div>
                      </button>
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="space-y-0.5">
                        {email ? (
                          <a href={`mailto:${email}`} className="block truncate text-xs text-gray-700 hover:text-indigo-600">{email}</a>
                        ) : (
                          <span className="block text-xs text-gray-400">Sin email</span>
                        )}
                        {phone ? (
                          <a href={`tel:${phone}`} className="block truncate text-xs text-gray-700 hover:text-indigo-600">{phone}</a>
                        ) : (
                          <span className="block text-xs text-gray-400">Sin teléfono</span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      {area ? (
                        <Badge variant={area.tone}>{area.label}</Badge>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={status.variant} dot>{status.label}</Badge>
                        {process.env.NEXT_PUBLIC_NOWLABS_INTERNAL === 'true' && client.leadScore > 0 && (
                          <span className="text-[10px] font-medium text-gray-400">Score {client.leadScore}</span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="text-xs text-gray-500">{created}</span>
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => router.push(`/clients/${client.id}`)} title="Abrir la ficha 360 del cliente" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-gray-800"><FolderOpen className="h-3.5 w-3.5" /> Ver ficha</button>
                        <div className="inline-flex items-center overflow-hidden rounded-lg border border-gray-200">
                          <button onClick={() => openEditModal(client)} title="Editar cliente" className="flex h-8 w-8 items-center justify-center border-r border-gray-200 text-gray-400 transition-colors hover:bg-gray-50 hover:text-indigo-600"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => requestDeleteClient(client)} title="Eliminar cliente" className="flex h-8 w-8 items-center justify-center text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                      <User className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-gray-800">
                      {counts.total === 0 ? 'Todavía no hay clientes.' : 'Ningún cliente con esos filtros.'}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {counts.total === 0
                        ? 'Crea el primer cliente para empezar a organizar sus datos, documentos y seguimiento.'
                        : 'Prueba con otro término de búsqueda o quita los filtros.'}
                    </p>
                    {counts.total === 0 ? (
                      <Button className="mt-4" size="sm" onClick={openCreateModal}>
                        <Plus className="h-3.5 w-3.5" />
                        Crear primer cliente
                      </Button>
                    ) : (
                      <Button className="mt-4" size="sm" variant="secondary" onClick={() => { setSearch(''); setStatusFilter('todos') }}>
                        Limpiar filtros
                      </Button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Móvil: tarjetas por cliente (sin scroll horizontal tipo Excel) */}
        <div className="divide-y divide-gray-100 md:hidden">
          {loading && [0, 1, 2].map((i) => (
            <div key={`m-skel-${i}`} className="px-4 py-3"><div className="h-14 w-full animate-pulse rounded-xl bg-slate-100" /></div>
          ))}
          {!loading && filtered.map((client) => {
            const area = describeArea(client)
            const status = STATUS_BADGE[client.status]
            const email = client.email && client.email !== 'No consta' ? client.email : ''
            const phone = client.phone && client.phone !== 'No consta' && client.phone !== '-' ? client.phone : ''
            const subtitle = client.company !== 'No consta' && client.company !== '-' ? client.company : (area?.label ?? '')
            return (
              <div key={client.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => router.push(`/clients/${client.id}`)} className="flex min-w-0 items-center gap-3 text-left">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-50 to-sky-50 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">{client.avatar}</div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{client.name}</p>
                      <p className="truncate text-[11px] text-gray-500">{subtitle || 'Sin empresa'}</p>
                    </div>
                  </button>
                  <Badge variant={status.variant} dot>{status.label}</Badge>
                </div>
                {(email || phone) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                    {email && <a href={`mailto:${email}`} className="inline-flex min-w-0 items-center gap-1 hover:text-indigo-600"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{email}</span></a>}
                    {phone && <a href={`tel:${phone}`} className="inline-flex items-center gap-1 hover:text-indigo-600"><Phone className="h-3 w-3" />{phone}</a>}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={() => router.push(`/clients/${client.id}`)} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-900 text-xs font-semibold text-white transition-colors hover:bg-gray-800"><FolderOpen className="h-3.5 w-3.5" /> Ver ficha</button>
                  <button onClick={() => openEditModal(client)} title="Editar" className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-indigo-600"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => requestDeleteClient(client)} title="Eliminar" className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )
          })}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100"><User className="h-5 w-5" /></div>
              <p className="text-sm font-semibold text-gray-800">{counts.total === 0 ? 'Todavía no hay clientes.' : 'Ningún cliente con esos filtros.'}</p>
              <p className="mt-1 text-xs text-gray-500">{counts.total === 0 ? 'Crea el primer cliente para empezar.' : 'Prueba con otro término o quita los filtros.'}</p>
              {counts.total === 0 ? (
                <Button className="mt-4" size="sm" onClick={openCreateModal}><Plus className="h-3.5 w-3.5" /> Crear primer cliente</Button>
              ) : (
                <Button className="mt-4" size="sm" variant="secondary" onClick={() => { setSearch(''); setStatusFilter('todos') }}>Limpiar filtros</Button>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Modal — Ficha de cliente profesional (asesoría / inmobiliaria) */}
      {modalOpen && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) setModalOpen(false) }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <div className="flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-950">{form.id ? 'Editar ficha de cliente' : 'Nueva ficha de cliente'}</h2>
                  <p className="text-[11px] text-gray-500">Datos personales, contacto, interés y notas internas.</p>
                </div>
              </div>
              <button onClick={() => setModalOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"><X className="h-4 w-4" /></button>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              {/* Sección 1 — Datos del cliente */}
              <FormSection title="Datos del cliente" description="Identificación y tipo de cliente.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nombre completo / Razón social" required>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Nombre y apellidos"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="DNI / NIE / Pasaporte / CIF">
                    <input
                      type="text"
                      value={form.documentId}
                      onChange={(e) => setForm((p) => ({ ...p, documentId: e.target.value }))}
                      placeholder="Opcional"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Empresa">
                    <input
                      type="text"
                      value={form.company}
                      onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))}
                      placeholder="Opcional"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Tipo de cliente">
                    <select
                      value={form.clientType}
                      onChange={(e) => setForm((p) => ({ ...p, clientType: e.target.value as ClientType }))}
                      className={inputCls}
                    >
                      {CLIENT_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Idioma preferente">
                    <input
                      type="text"
                      value={form.preferredLanguage}
                      onChange={(e) => setForm((p) => ({ ...p, preferredLanguage: e.target.value }))}
                      placeholder="Español, English, Français…"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Nacionalidad">
                    <input
                      type="text"
                      value={form.nationality}
                      onChange={(e) => setForm((p) => ({ ...p, nationality: e.target.value }))}
                      placeholder="Opcional"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </FormSection>

              {/* Sección 2 — Contacto */}
              <FormSection title="Contacto" description="Email, teléfonos y dirección.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Email">
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                      placeholder="cliente@dominio.com"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Teléfono">
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                      placeholder="+34 612 345 678"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Teléfono secundario">
                    <input
                      type="tel"
                      value={form.secondaryPhone}
                      onChange={(e) => setForm((p) => ({ ...p, secondaryPhone: e.target.value }))}
                      placeholder="Opcional"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Ciudad / zona">
                    <input
                      type="text"
                      value={form.cityArea}
                      onChange={(e) => setForm((p) => ({ ...p, cityArea: e.target.value }))}
                      placeholder="Marbella, Estepona…"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Dirección" className="sm:col-span-2">
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                      placeholder="Opcional"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </FormSection>

              {/* Sección 3 — Interés / servicio */}
              <FormSection title="Interés o servicio" description="Qué busca el cliente o qué servicio prestamos.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Área principal">
                    <select
                      value={form.mainArea}
                      onChange={(e) => setForm((p) => ({ ...p, mainArea: e.target.value as MainArea }))}
                      className={inputCls}
                    >
                      <option value="">Sin definir</option>
                      {MAIN_AREA_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Servicio / interés">
                    <select
                      value={form.serviceInterest}
                      onChange={(e) => setForm((p) => ({ ...p, serviceInterest: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">Sin definir</option>
                      {SERVICE_INTEREST_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Presupuesto aproximado">
                    <input
                      type="text"
                      value={form.budgetRange}
                      onChange={(e) => setForm((p) => ({ ...p, budgetRange: e.target.value }))}
                      placeholder="Ej. 200k–350k €"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Zona de interés">
                    <input
                      type="text"
                      value={form.interestZone}
                      onChange={(e) => setForm((p) => ({ ...p, interestZone: e.target.value }))}
                      placeholder="Marbella centro, Nueva Andalucía…"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </FormSection>

              {/* Sección 4 — Notas internas */}
              <FormSection title="Notas internas" description="Contexto, próxima acción y responsable.">
                <div className="space-y-3">
                  <Field label="Notas">
                    <textarea
                      value={form.notes}
                      onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                      rows={3}
                      placeholder="Contexto comercial, preferencias, antecedentes…"
                      className={cn(inputCls, 'min-h-[90px] resize-y py-2')}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Próxima acción">
                      <input
                        type="text"
                        value={form.nextAction}
                        onChange={(e) => setForm((p) => ({ ...p, nextAction: e.target.value }))}
                        placeholder="Llamar el lunes, enviar contrato…"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Responsable">
                      <input
                        type="text"
                        value={form.assignedTo}
                        onChange={(e) => setForm((p) => ({ ...p, assignedTo: e.target.value }))}
                        placeholder="Nombre del responsable interno"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Estado interno" className="sm:col-span-2">
                      <select
                        value={form.status}
                        onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as ClientStatus }))}
                        className={inputCls}
                      >
                        {STATUS_FORM_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
              </FormSection>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50/60 px-6 py-3.5">
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button size="sm" loading={saving} onClick={handleSave}>
                {form.id ? 'Guardar cambios' : 'Crear cliente'}
                {!form.id && <ArrowRight className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      )}

      <DeleteClientDialog
        client={clientToDelete ? { id: clientToDelete.id, name: clientToDelete.name } : null}
        onClose={() => setClientToDelete(null)}
        onDeleted={(name) => {
          setClientToDelete(null)
          void loadClients()
          toast.success(`Cliente eliminado: ${name}`, { description: 'También se ha eliminado su información relacionada.' })
        }}
      />
    </motion.div>
  )
}

const inputCls =
  'h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'

function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {description && <p className="mt-0.5 text-[11px] text-gray-500">{description}</p>}
      </header>
      {children}
    </section>
  )
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-[11px] font-medium text-gray-600">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}
