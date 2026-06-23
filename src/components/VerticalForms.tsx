'use client'

// Vertical Pack v1 — create drawers shared across /opportunities, /clients (360)
// and (later) /inbox CTAs. Each drawer wraps the workspace-scoped helpers in
// vertical-queries.ts so the same write path (with activity log) is used from
// every UI entry point. El Asistente IA hits the parallel helpers in
// vertical-server.ts; both paths converge on the same Supabase tables.

import { useState } from 'react'
import { toast } from 'sonner'
import { SideDrawer } from '@/components/SideDrawer'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import {
  createOpportunity,
  createServiceCase,
  createProperty,
  type OpportunityRow,
  type ServiceCaseRow,
  type PropertyRow,
} from '@/lib/vertical-queries'
import {
  VERTICALS,
  CASE_TYPES,
  REAL_ESTATE_PIPELINE,
  IMMIGRATION_PIPELINE,
  GENERAL_PIPELINE,
  type VerticalKey,
} from '@/lib/demo/vertical-templates'
import { DEMO_MODE_KEY } from '@/lib/current-user'

// En modo demo offline no hay workspace real: las acciones de escritura se
// simulan y avisamos con un toast amable en vez de un error técnico de sesión.
function isDemoMode() {
  return typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
}

const SELECT_CLS =
  'h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors'

const TEXTAREA_CLS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors'

const FIELD_LABEL_CLS = 'text-sm font-medium text-gray-700'

function pipelineForVertical(vertical: VerticalKey) {
  if (vertical === 'real_estate') return REAL_ESTATE_PIPELINE
  if (vertical === 'immigration') return IMMIGRATION_PIPELINE
  return GENERAL_PIPELINE
}

// -----------------------------------------------------------------------------
// New Opportunity
// -----------------------------------------------------------------------------

type NewOpportunityDrawerProps = {
  open: boolean
  onClose: () => void
  workspaceId: string | null
  defaultVertical?: VerticalKey
  defaultClientId?: string | null
  defaultClientName?: string | null
  defaultSource?: string | null
  onCreated?: (row: OpportunityRow) => void
}

export function NewOpportunityDrawer({
  open,
  onClose,
  workspaceId,
  defaultVertical = 'general',
  defaultClientId = null,
  defaultClientName = null,
  defaultSource = null,
  onCreated,
}: NewOpportunityDrawerProps) {
  const [title, setTitle] = useState('')
  const [vertical, setVertical] = useState<VerticalKey>(defaultVertical)
  const [stage, setStage] = useState('new')
  const [clientName, setClientName] = useState(defaultClientName ?? '')
  const [value, setValue] = useState('')
  const [probability, setProbability] = useState('')
  const [source, setSource] = useState(defaultSource ?? '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const stages = pipelineForVertical(vertical)

  function reset() {
    setTitle('')
    setVertical(defaultVertical)
    setStage('new')
    setClientName(defaultClientName ?? '')
    setValue('')
    setProbability('')
    setSource(defaultSource ?? '')
    setNotes('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Necesito al menos un título.')
      return
    }
    if (isDemoMode()) {
      toast.info('Modo demo (solo lectura)', { description: 'Acción simulada: crear operaciones estará disponible al conectar tu cuenta.' })
      reset()
      onClose()
      return
    }
    if (!workspaceId) {
      toast.error('Sin workspace activo. Inicia sesión real.')
      return
    }
    setSaving(true)
    try {
      const row = await createOpportunity(workspaceId, {
        title: title.trim(),
        vertical,
        stage,
        clientId: defaultClientId,
        clientName: clientName.trim() || null,
        value: value ? Number(value) || null : null,
        probability: probability ? Number(probability) || null : null,
        source: source.trim() || null,
        notes: notes.trim() || null,
      })
      if (!row) {
        toast.error('No se pudo crear la operación. Revisa la sesión y vuelve a intentarlo.')
        return
      }
      toast.success(`Operación creada: ${row.title}`)
      onCreated?.(row)
      reset()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Nueva operación"
      description="Negocio comercial en seguimiento. Se registra como actividad y respeta tu vertical activo."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" size="sm" type="submit" form="new-opportunity-form" loading={saving} disabled={saving}>Crear operación</Button>
        </div>
      }
    >
      <form id="new-opportunity-form" onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="Título"
          placeholder='Ej: "Venta piso 3 hab en Málaga centro — Ana Pérez"'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Vertical</label>
            <select
              className={SELECT_CLS}
              value={vertical}
              onChange={(e) => {
                const v = e.target.value as VerticalKey
                setVertical(v)
                // Reset stage to first stage of new pipeline.
                setStage(pipelineForVertical(v)[0]?.id ?? 'new')
              }}
            >
              {Object.values(VERTICALS).map((v) => (
                <option key={v.key} value={v.key}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Etapa</label>
            <select className={SELECT_CLS} value={stage} onChange={(e) => setStage(e.target.value)}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
        <Input
          label="Cliente"
          placeholder="Nombre visible — opcional"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Valor (€)"
            type="number"
            min="0"
            placeholder="Opcional"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Input
            label="Probabilidad (%)"
            type="number"
            min="0"
            max="100"
            placeholder="Opcional"
            value={probability}
            onChange={(e) => setProbability(e.target.value)}
          />
        </div>
        <Input
          label="Origen"
          placeholder="whatsapp, instagram, web, referencia…"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Notas</label>
          <textarea
            rows={3}
            className={TEXTAREA_CLS}
            placeholder="Contexto extra, requisitos, deal-breakers…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </form>
    </SideDrawer>
  )
}

// -----------------------------------------------------------------------------
// New Service Case
// -----------------------------------------------------------------------------

type NewServiceCaseDrawerProps = {
  open: boolean
  onClose: () => void
  workspaceId: string | null
  defaultVertical?: VerticalKey
  defaultClientId?: string | null
  defaultClientName?: string | null
  onCreated?: (row: ServiceCaseRow) => void
}

const SERVICE_STATUS_OPTIONS = [
  { id: 'open', label: 'Abierto' },
  { id: 'documentation_pending', label: 'Documentación pendiente' },
  { id: 'in_review', label: 'En revisión' },
  { id: 'submitted', label: 'Presentado' },
  { id: 'resolved', label: 'Resuelto' },
  { id: 'closed', label: 'Cerrado' },
]

const PRIORITY_OPTIONS = [
  { id: 'low', label: 'Baja' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'Alta' },
  { id: 'urgent', label: 'Urgente' },
]

export function NewServiceCaseDrawer({
  open,
  onClose,
  workspaceId,
  defaultVertical = 'immigration',
  defaultClientId = null,
  defaultClientName = null,
  onCreated,
}: NewServiceCaseDrawerProps) {
  const [title, setTitle] = useState('')
  const [caseType, setCaseType] = useState(CASE_TYPES[0]?.id ?? 'nie_renewal')
  const [vertical, setVertical] = useState<VerticalKey>(defaultVertical)
  const [status, setStatus] = useState('open')
  const [priority, setPriority] = useState('normal')
  const [clientName, setClientName] = useState(defaultClientName ?? '')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const availableCaseTypes = CASE_TYPES.filter((t) => t.vertical === vertical || vertical === 'general')

  function reset() {
    setTitle('')
    setCaseType(CASE_TYPES[0]?.id ?? 'nie_renewal')
    setVertical(defaultVertical)
    setStatus('open')
    setPriority('normal')
    setClientName(defaultClientName ?? '')
    setDueDate('')
    setNotes('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Necesito al menos un título.')
      return
    }
    if (!caseType.trim()) {
      toast.error('Selecciona un tipo de expediente.')
      return
    }
    if (isDemoMode()) {
      toast.info('Modo demo (solo lectura)', { description: 'Acción simulada: abrir expedientes estará disponible al conectar tu cuenta.' })
      reset()
      onClose()
      return
    }
    if (!workspaceId) {
      toast.error('Sin workspace activo. Inicia sesión real.')
      return
    }
    setSaving(true)
    try {
      const row = await createServiceCase(workspaceId, {
        title: title.trim(),
        caseType: caseType.trim(),
        vertical,
        status,
        priority,
        clientId: defaultClientId,
        clientName: clientName.trim() || null,
        dueDate: dueDate.trim() || null,
        notes: notes.trim() || null,
      })
      if (!row) {
        toast.error('No se pudo abrir el expediente. Revisa la sesión.')
        return
      }
      toast.success(`Expediente abierto: ${row.title}`)
      onCreated?.(row)
      reset()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Nuevo expediente"
      description="Trámite o servicio operativo. Asocia un cliente y un tipo de expediente."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" size="sm" type="submit" form="new-service-case-form" loading={saving} disabled={saving}>Abrir expediente</Button>
        </div>
      }
    >
      <form id="new-service-case-form" onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="Título"
          placeholder='Ej: "Renovación NIE — Ana Pérez"'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Vertical</label>
            <select
              className={SELECT_CLS}
              value={vertical}
              onChange={(e) => setVertical(e.target.value as VerticalKey)}
            >
              {Object.values(VERTICALS).map((v) => (
                <option key={v.key} value={v.key}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Tipo</label>
            <select className={SELECT_CLS} value={caseType} onChange={(e) => setCaseType(e.target.value)}>
              {availableCaseTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
              <option value="custom">Otro / personalizado</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Estado</label>
            <select className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value)}>
              {SERVICE_STATUS_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Prioridad</label>
            <select className={SELECT_CLS} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
        <Input
          label="Cliente"
          placeholder="Nombre visible — opcional"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
        />
        <Input
          label="Fecha límite"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Notas</label>
          <textarea
            rows={3}
            className={TEXTAREA_CLS}
            placeholder="Documentación esperada, número de expediente, contacto en administración…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </form>
    </SideDrawer>
  )
}

// -----------------------------------------------------------------------------
// New Property
// -----------------------------------------------------------------------------

type NewPropertyDrawerProps = {
  open: boolean
  onClose: () => void
  workspaceId: string | null
  defaultClientId?: string | null
  defaultClientName?: string | null
  onCreated?: (row: PropertyRow) => void
}

const PROPERTY_TYPE_OPTIONS = [
  { id: 'apartment', label: 'Piso' },
  { id: 'house', label: 'Casa' },
  { id: 'villa', label: 'Villa / chalet' },
  { id: 'commercial', label: 'Local comercial' },
  { id: 'office', label: 'Oficina' },
  { id: 'land', label: 'Terreno' },
]

const OPERATION_OPTIONS = [
  { id: 'sale', label: 'Venta' },
  { id: 'rent', label: 'Alquiler' },
]

const PROPERTY_STATUS_OPTIONS = [
  { id: 'prospecting', label: 'Captación' },
  { id: 'listed', label: 'Publicada' },
  { id: 'under_contract', label: 'Bajo contrato' },
  { id: 'sold', label: 'Vendida / alquilada' },
  { id: 'archived', label: 'Archivada' },
]

export function NewPropertyDrawer({
  open,
  onClose,
  workspaceId,
  defaultClientId = null,
  defaultClientName = null,
  onCreated,
}: NewPropertyDrawerProps) {
  const [title, setTitle] = useState('')
  const [propertyType, setPropertyType] = useState('apartment')
  const [operationType, setOperationType] = useState('sale')
  const [status, setStatus] = useState('prospecting')
  const [city, setCity] = useState('')
  const [area, setArea] = useState('')
  const [price, setPrice] = useState('')
  const [ownerName, setOwnerName] = useState(defaultClientName ?? '')
  const [ownerPhone, setOwnerPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setTitle('')
    setPropertyType('apartment')
    setOperationType('sale')
    setStatus('prospecting')
    setCity('')
    setArea('')
    setPrice('')
    setOwnerName(defaultClientName ?? '')
    setOwnerPhone('')
    setNotes('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Necesito al menos un título.')
      return
    }
    if (isDemoMode()) {
      toast.info('Modo demo (solo lectura)', { description: 'Acción simulada: registrar propiedades estará disponible al conectar tu cuenta.' })
      reset()
      onClose()
      return
    }
    if (!workspaceId) {
      toast.error('Sin workspace activo. Inicia sesión real.')
      return
    }
    setSaving(true)
    try {
      const row = await createProperty(workspaceId, {
        title: title.trim(),
        propertyType,
        operationType,
        status,
        city: city.trim() || undefined,
        area: area.trim() || undefined,
        price: price ? Number(price) || null : null,
        ownerName: ownerName.trim() || undefined,
        ownerPhone: ownerPhone.trim() || undefined,
        clientId: defaultClientId,
        clientName: ownerName.trim() || null,
        notes: notes.trim() || undefined,
      })
      if (!row) {
        toast.error('No se pudo registrar la propiedad. Revisa la sesión.')
        return
      }
      toast.success(`Propiedad registrada: ${row.title}`)
      onCreated?.(row)
      reset()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Nueva propiedad"
      description="Captación o publicación inmobiliaria. Asocia un cliente/propietario opcional."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" size="sm" type="submit" form="new-property-form" loading={saving} disabled={saving}>Registrar propiedad</Button>
        </div>
      }
    >
      <form id="new-property-form" onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="Título"
          placeholder='Ej: "Piso 3 hab — Marbella Centro"'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Tipo</label>
            <select className={SELECT_CLS} value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
              {PROPERTY_TYPE_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Operación</label>
            <select className={SELECT_CLS} value={operationType} onChange={(e) => setOperationType(e.target.value)}>
              {OPERATION_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Estado</label>
            <select className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value)}>
              {PROPERTY_STATUS_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Ciudad"
            placeholder="Málaga, Marbella, Madrid…"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <Input
            label="Zona / barrio"
            placeholder="Centro, La Cala…"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          />
        </div>
        <Input
          label="Precio (€)"
          type="number"
          min="0"
          placeholder="Opcional"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Propietario / contacto"
            placeholder="Nombre"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
          <Input
            label="Teléfono"
            placeholder="+34 600 000 000"
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Notas</label>
          <textarea
            rows={3}
            className={TEXTAREA_CLS}
            placeholder="Llaves, accesos, requisitos del propietario…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </form>
    </SideDrawer>
  )
}

// -----------------------------------------------------------------------------
// Status options shared with consumers (e.g. inline status edit in lists).
// Kept here so the dropdown labels match the create drawers.
// -----------------------------------------------------------------------------

export const SERVICE_CASE_STATUS_OPTIONS = SERVICE_STATUS_OPTIONS
export const PROPERTY_STATUS_OPTIONS_PUBLIC = PROPERTY_STATUS_OPTIONS
