'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, Plus, MoreHorizontal, Mail, Phone, Eye, Filter, X, User } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { clients as initialClients } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
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

const emptyForm = { name: '', company: '', email: '', phone: '', channel: 'WhatsApp' as Channel, status: 'lead' as ClientStatus }

export default function ClientsPage() {
  const [clientList, setClientList] = useState<Client[]>(initialClients)
  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<Channel | 'Todos'>('Todos')
  const [statusFilter, setStatusFilter] = useState<ClientStatus | 'Todos'>('Todos')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

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

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Nombre y email son obligatorios')
      return
    }
    setSaving(true)
    await new Promise((r) => setTimeout(r, 600))
    const initials = form.name.trim().split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    const newClient: Client = {
      id: `c-${Date.now()}`,
      name: form.name.trim(),
      company: form.company.trim() || '—',
      email: form.email.trim(),
      phone: form.phone.trim() || '—',
      channel: form.channel,
      status: form.status,
      leadScore: Math.floor(Math.random() * 30) + 50,
      lastInteraction: 'Ahora mismo',
      avatar: initials,
    }
    setClientList((prev) => [newClient, ...prev])
    setSaving(false)
    setModalOpen(false)
    setForm(emptyForm)
    toast.success(`Cliente añadido: ${newClient.name}`, { description: `${newClient.company} · ${newClient.channel}` })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clientes"
        description={`${clientList.length} clientes en total`}
        action={
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nuevo cliente
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total clientes', value: stats.total, color: 'text-gray-900' },
          { label: 'Activos', value: stats.active, color: 'text-emerald-600' },
          { label: 'Leads', value: stats.lead, color: 'text-indigo-600' },
          { label: 'Inactivos', value: stats.inactive, color: 'text-gray-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={cn('text-2xl font-bold mt-1', color)}>{value}</p>
          </div>
        ))}
      </div>

      <SectionCard
        title="Todos los clientes"
        noPadding
        action={
          <Button variant="ghost" size="sm" onClick={() => toast.info('Filtros avanzados próximamente')}>
            <Filter className="h-3.5 w-3.5" />
            Filtros
          </Button>
        }
      >
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por nombre, empresa o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-1">
            {channels.map((ch) => (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  channelFilter === ch ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                {ch}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  statusFilter === s ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-100'
                )}
              >
                {statusLabels[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Cliente</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Canal</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Estado</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Lead Score</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Última actividad</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-400">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client, i) => {
                const status = statusConfig[client.status]
                const scoreColor = client.leadScore >= 80 ? 'bg-emerald-500' : client.leadScore >= 60 ? 'bg-amber-500' : 'bg-red-400'
                return (
                  <tr key={client.id} className={cn('border-b border-gray-50 hover:bg-gray-50 transition-colors', i === filtered.length - 1 && 'border-b-0')}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">
                          {client.avatar}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{client.name}</p>
                          <p className="text-[11px] text-gray-400">{client.company} · {client.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant={channelVariant[client.channel]}>{client.channel}</Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant={status.variant} dot>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900 w-7">{client.leadScore}</span>
                        <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
                          <div className={cn('h-full rounded-full', scoreColor)} style={{ width: `${client.leadScore}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-gray-500">{client.lastInteraction}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => toast.success(`Email a ${client.name}`, { description: 'Abriendo redactor de email...' })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => toast.success(`Llamando a ${client.name}`, { description: client.phone })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        >
                          <Phone className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => toast.info(`Perfil de ${client.name}`, { description: 'Vista detallada próximamente.' })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => toast.info('Más opciones', { description: 'Menú contextual próximamente.' })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <p className="text-sm font-medium text-gray-500">No se encontraron clientes</p>
                    <p className="text-xs text-gray-400 mt-1">Prueba con otro filtro o término de búsqueda</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* New client modal */}
      {modalOpen && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) setModalOpen(false) }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                  <User className="h-4 w-4 text-indigo-600" />
                </div>
                <h2 className="text-sm font-semibold text-gray-900">Nuevo cliente</h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Nombre *</label>
                  <input
                    type="text"
                    placeholder="Ana Rodríguez"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Empresa</label>
                  <input
                    type="text"
                    placeholder="Diseño Digital SL"
                    value={form.company}
                    onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Email *</label>
                <input
                  type="email"
                  placeholder="ana@empresa.com"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Teléfono</label>
                <input
                  type="tel"
                  placeholder="+34 612 345 678"
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Canal</label>
                  <select
                    value={form.channel}
                    onChange={(e) => setForm((p) => ({ ...p, channel: e.target.value as Channel }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  >
                    {(['WhatsApp', 'Instagram', 'Web', 'Email'] as Channel[]).map((ch) => (
                      <option key={ch} value={ch}>{ch}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Estado</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as ClientStatus }))}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white"
                  >
                    <option value="lead">Lead</option>
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button size="sm" loading={saving} onClick={handleSave}>Guardar cliente</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
