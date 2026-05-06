'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, Plus, Mail, Phone, Filter, X, User, Pencil, Trash2, Loader2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { clients as initialClients } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { createClientLead, deleteClient, getClients, getWorkspaceContext, updateClient } from '@/lib/supabase-queries'
import type { Client, Channel, ClientStatus } from '@/lib/types'

const channelVariant: Record<Channel, 'success' | 'purple' | 'info' | 'indigo'> = {
  WhatsApp: 'success',
  Instagram: 'purple',
  Web: 'info',
  Email: 'indigo',
}

const statusConfig: Record<ClientStatus, { label: string; variant: 'success' | 'indigo' | 'default' | 'danger' }> = {
  active: { label: 'Activo', variant: 'success' },
  lead: { label: 'Lead', variant: 'indigo' },
  inactive: { label: 'Inactivo', variant: 'default' },
  churned: { label: 'Perdido', variant: 'danger' },
}

const channels: Array<Channel | 'Todos'> = ['Todos', 'WhatsApp', 'Instagram', 'Web', 'Email']
const statuses: Array<ClientStatus | 'Todos'> = ['Todos', 'active', 'lead', 'inactive', 'churned']
const statusLabels: Record<ClientStatus | 'Todos', string> = {
  Todos: 'Todos',
  active: 'Activos',
  lead: 'Leads',
  inactive: 'Inactivos',
  churned: 'Perdidos',
}

type ClientForm = {
  id?: string
  name: string
  company: string
  email: string
  phone: string
  channel: Channel
  status: ClientStatus
  leadScore: string
  notes: string
}

const emptyForm: ClientForm = {
  name: '',
  company: '',
  email: '',
  phone: '',
  channel: 'WhatsApp',
  status: 'lead',
  leadScore: '65',
  notes: '',
}

function toForm(client: Client): ClientForm {
  return {
    id: client.id,
    name: client.name,
    company: client.company === 'Sin empresa' || client.company === '-' ? '' : client.company,
    email: client.email,
    phone: client.phone === '-' ? '' : client.phone,
    channel: client.channel,
    status: client.status,
    leadScore: String(client.leadScore),
    notes: client.notes ?? '',
  }
}

function getInitials(name: string) {
  return name.trim().split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'C'
}

export default function ClientsPage() {
  const [clientList, setClientList] = useState<Client[]>(initialClients)
  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<Channel | 'Todos'>('Todos')
  const [statusFilter, setStatusFilter] = useState<ClientStatus | 'Todos'>('Todos')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<ClientForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isRealMode, setIsRealMode] = useState(false)
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null)
  const [deleting, setDeleting] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  const loadClients = useCallback(async () => {
    const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
    if (isDemoMode) {
      setClientList(initialClients)
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
        setClientList(initialClients)
        setWorkspaceId(null)
        setIsRealMode(false)
        setLoadError('No se ha encontrado workspace real. Se muestran datos demo.')
        return
      }

      const realClients = await getClients(resolvedWorkspaceId)
      setClientList(realClients)
      setWorkspaceId(resolvedWorkspaceId)
      setIsRealMode(true)
    } catch {
      setClientList(initialClients)
      setWorkspaceId(null)
      setIsRealMode(false)
      setLoadError('No se pudieron cargar clientes reales. Revisa RLS, workspace_id o columnas de clients.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadClients()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadClients])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setModalOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const filtered = clientList.filter((c) => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.company.toLowerCase().includes(search.toLowerCase()) || c.email.toLowerCase().includes(search.toLowerCase())
    const matchChannel = channelFilter === 'Todos' || c.channel === channelFilter
    const matchStatus = statusFilter === 'Todos' || c.status === statusFilter
    return matchSearch && matchChannel && matchStatus
  })

  const stats = {
    total: clientList.length,
    active: clientList.filter((c) => c.status === 'active').length,
    lead: clientList.filter((c) => c.status === 'lead').length,
    inactive: clientList.filter((c) => c.status === 'inactive').length,
  }
  const hasFilters = search || channelFilter !== 'Todos' || statusFilter !== 'Todos'

  const clearFilters = () => {
    setSearch('')
    setChannelFilter('Todos')
    setStatusFilter('Todos')
    toast.success('Filtros restablecidos')
  }

  const openCreateModal = () => {
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEditModal = (client: Client) => {
    setForm(toForm(client))
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Nombre y email son obligatorios')
      return
    }

    const payload = {
      name: form.name.trim(),
      company: form.company.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      channel: form.channel,
      status: form.status,
      leadScore: Number(form.leadScore) || 50,
      notes: form.notes.trim(),
    }

    setSaving(true)
    try {
      if (isRealMode && workspaceId) {
        if (form.id) {
          await updateClient(form.id, payload)
          toast.success(`Cliente actualizado: ${payload.name}`)
        } else {
          await createClientLead(workspaceId, payload)
          toast.success(`Cliente creado en Supabase: ${payload.name}`)
        }
        await loadClients()
      } else {
        const localClient: Client = {
          id: form.id || `c-${Date.now()}`,
          name: payload.name,
          company: payload.company || 'Sin empresa',
          email: payload.email,
          phone: payload.phone || '-',
          channel: payload.channel,
          status: payload.status,
          leadScore: payload.leadScore,
          lastInteraction: 'Ahora mismo',
          avatar: getInitials(payload.name),
          notes: payload.notes,
        }
        setClientList((prev) => form.id ? prev.map((client) => client.id === form.id ? localClient : client) : [localClient, ...prev])
        toast.success(form.id ? `Cliente actualizado: ${payload.name}` : `Cliente añadido: ${payload.name}`)
      }
      setModalOpen(false)
      setForm(emptyForm)
    } catch (error) {
      toast.error('No se pudo guardar el cliente', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!clientToDelete) return
    setDeleting(true)
    try {
      if (isRealMode) {
        await deleteClient(clientToDelete.id)
        await loadClients()
        toast.success(`Cliente eliminado: ${clientToDelete.name}`)
      } else {
        setClientList((prev) => prev.filter((item) => item.id !== clientToDelete.id))
        toast.success(`Cliente eliminado en demo: ${clientToDelete.name}`)
      }
      setClientToDelete(null)
    } catch (error) {
      toast.error('No se pudo eliminar el cliente', { description: error instanceof Error ? error.message : 'Revisa Supabase y RLS.' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Clientes"
        description={`${filtered.length} visibles de ${clientList.length} clientes`}
        action={
          <>
            <Badge variant={isRealMode ? 'success' : 'indigo'} dot>{isRealMode ? 'Datos reales' : 'Modo demo'}</Badge>
            <Button size="sm" onClick={openCreateModal}>
              <Plus className="h-3.5 w-3.5" />
              Nuevo cliente
            </Button>
          </>
        }
      />

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Total clientes', value: stats.total, color: 'text-gray-900' },
          { label: 'Activos', value: stats.active, color: 'text-emerald-600' },
          { label: 'Leads', value: stats.lead, color: 'text-indigo-600' },
          { label: 'Inactivos', value: stats.inactive, color: 'text-gray-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-gray-200/70 bg-white p-4 shadow-sm shadow-gray-950/[0.035] transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.04]">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={cn('text-2xl font-bold mt-1', color)}>{value}</p>
          </div>
        ))}
      </div>

      <SectionCard
        title="Todos los clientes"
        description={isRealMode ? 'Clientes cargados desde Supabase' : 'Pipeline comercial demo con datos mock'}
        noPadding
        action={
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                Limpiar
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => toast.info('Filtros avanzados próximamente')}>
              <Filter className="h-3.5 w-3.5" />
              Filtros
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50/50 px-5 py-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por nombre, empresa o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {channels.map((ch) => (
              <button key={ch} onClick={() => setChannelFilter(ch)} className={cn('rounded-lg px-2.5 py-1 text-xs font-medium transition-colors', channelFilter === ch ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100')}>{ch}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {statuses.map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)} className={cn('rounded-lg px-2.5 py-1 text-xs font-medium transition-colors', statusFilter === s ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-100')}>{statusLabels[s]}</button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase text-gray-400">Cliente</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-gray-400">Canal</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-gray-400">Estado</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-gray-400">Lead Score</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-gray-400">Notas</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-gray-400">Última actividad</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase text-gray-400">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-5 py-8">
                    <div className="space-y-3">
                      {[1, 2, 3].map((item) => (
                        <div key={item} className="grid grid-cols-[minmax(220px,1.4fr)_90px_90px_120px_minmax(160px,1fr)_120px_80px] items-center gap-4 rounded-xl border border-gray-100 bg-white px-3 py-3">
                          <div className="flex items-center gap-3">
                            <span className="h-8 w-8 animate-pulse rounded-full bg-indigo-50" />
                            <span className="h-3 w-36 animate-pulse rounded-full bg-gray-100" />
                          </div>
                          <span className="h-5 w-16 animate-pulse rounded-full bg-gray-100" />
                          <span className="h-5 w-14 animate-pulse rounded-full bg-gray-100" />
                          <span className="h-2 w-20 animate-pulse rounded-full bg-gray-100" />
                          <span className="h-8 w-full animate-pulse rounded-lg bg-indigo-50/70" />
                          <span className="h-3 w-20 animate-pulse rounded-full bg-gray-100" />
                          <span className="h-7 w-16 animate-pulse rounded-lg bg-gray-100" />
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                      Cargando clientes...
                    </div>
                  </td>
                </tr>
              )}
              {!loading && filtered.map((client, i) => {
                const status = statusConfig[client.status]
                const scoreColor = client.leadScore >= 80 ? 'bg-emerald-500' : client.leadScore >= 60 ? 'bg-amber-500' : 'bg-red-400'
                return (
                  <tr key={client.id} className={cn('border-b border-gray-50 transition-colors hover:bg-indigo-50/35', i === filtered.length - 1 && 'border-b-0')}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-50 to-sky-50 text-xs font-bold text-indigo-700 ring-1 ring-indigo-100">{client.avatar}</div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{client.name}</p>
                          <p className="text-[11px] text-gray-400">{client.company} · {client.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5"><Badge variant={channelVariant[client.channel]}>{client.channel}</Badge></td>
                    <td className="px-4 py-3.5"><Badge variant={status.variant} dot>{status.label}</Badge></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900 w-7">{client.leadScore}</span>
                        <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
                          <div className={cn('h-full rounded-full', scoreColor)} style={{ width: `${client.leadScore}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[220px] px-4 py-3.5">
                      <p
                        title={client.notes || 'Sin notas'}
                        className={cn(
                          'line-clamp-2 rounded-lg border px-2.5 py-1.5 text-[11px] leading-4',
                          client.notes ? 'border-indigo-100 bg-indigo-50/70 text-indigo-700' : 'border-gray-100 bg-gray-50 text-gray-400'
                        )}
                      >
                        {client.notes || 'Sin notas'}
                      </p>
                    </td>
                    <td className="px-4 py-3.5"><span className="text-xs text-gray-500">{client.lastInteraction}</span></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <button onClick={() => toast.success(`Email a ${client.name}`, { description: 'Abriendo redactor de email...' })} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><Mail className="h-3.5 w-3.5" /></button>
                        <button onClick={() => toast.success(`Llamando a ${client.name}`, { description: client.phone })} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><Phone className="h-3.5 w-3.5" /></button>
                        <button onClick={() => openEditModal(client)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setClientToDelete(client)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-14 text-center">
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                      <User className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-gray-700">{isRealMode ? 'Todavía no hay clientes reales' : 'No se encontraron clientes'}</p>
                    <p className="mt-1 text-xs text-gray-400">{isRealMode ? 'Crea el primer cliente para este workspace.' : 'Prueba con otro filtro o término de búsqueda.'}</p>
                    {isRealMode && (
                      <Button className="mt-4" size="sm" onClick={openCreateModal}>
                        <Plus className="h-3.5 w-3.5" />
                        Crear primer cliente
                      </Button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {modalOpen && (
        <div ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) setModalOpen(false) }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                  <User className="h-4 w-4 text-indigo-600" />
                </div>
                <h2 className="text-sm font-semibold text-gray-900">{form.id ? 'Editar cliente' : 'Nuevo cliente'}</h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><X className="h-4 w-4" /></button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Nombre *</label>
                  <input type="text" placeholder="Ana Rodríguez" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Empresa</label>
                  <input type="text" placeholder="Diseño Digital SL" value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Email *</label>
                <input type="email" placeholder="ana@empresa.com" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Teléfono</label>
                  <input type="tel" placeholder="+34 612 345 678" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Lead score</label>
                  <input type="number" min={0} max={100} value={form.leadScore} onChange={(e) => setForm((p) => ({ ...p, leadScore: e.target.value }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Canal</label>
                  <select value={form.channel} onChange={(e) => setForm((p) => ({ ...p, channel: e.target.value as Channel }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white">
                    {(['WhatsApp', 'Instagram', 'Web', 'Email'] as Channel[]).map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Estado</label>
                  <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as ClientStatus }))} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white">
                    <option value="lead">Lead</option>
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo</option>
                    <option value="churned">Perdido</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Notas</label>
                <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={3} placeholder="Contexto comercial, necesidad o siguiente paso..." className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button size="sm" loading={saving} onClick={handleSave}>{form.id ? 'Guardar cambios' : 'Guardar cliente'}</Button>
            </div>
          </div>
        </div>
      )}

      {clientToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl shadow-gray-950/20">
            <div className="border-b border-gray-100 px-6 py-5">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100">
                <Trash2 className="h-5 w-5" />
              </div>
              <h2 className="text-base font-bold text-gray-950">¿Seguro que quieres eliminar a {clientToDelete.name}?</h2>
              <p className="mt-1.5 text-sm leading-6 text-gray-500">
                Esta acción eliminará el cliente del workspace. No se puede deshacer.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 bg-gray-50 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={() => setClientToDelete(null)} disabled={deleting}>Cancelar</Button>
              <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>Eliminar cliente</Button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
