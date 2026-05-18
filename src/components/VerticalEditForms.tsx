'use client'

// Edit drawers for the Vertical Pack v1 entities (opportunities, service cases
// and properties). They reuse the same SideDrawer shell and visual language as
// the create drawers in VerticalForms.tsx, but bind to existing rows and call
// the update* helpers from vertical-queries.ts.
//
// Pattern: each exported drawer is a thin wrapper that returns null when there
// is no entity, and otherwise mounts an inner component keyed by the entity id.
// The inner component initialises form state with `useState(() => init)` so we
// satisfy `react-hooks/set-state-in-effect` — switching to a different entity
// remounts the inner form via the parent's `key` prop and resets cleanly.

import { useState } from 'react'
import { toast } from 'sonner'
import { Archive } from 'lucide-react'
import { SideDrawer } from '@/components/SideDrawer'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { ClientPicker } from '@/components/ClientPicker'
import {
  updateOpportunity,
  updateServiceCase,
  updateProperty,
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

// -----------------------------------------------------------------------------
// Edit Opportunity
// -----------------------------------------------------------------------------

type EditOpportunityDrawerProps = {
  open: boolean
  onClose: () => void
  workspaceId: string | null
  opportunity: OpportunityRow | null
  onUpdated?: (row: OpportunityRow) => void
}

export function EditOpportunityDrawer({ open, onClose, workspaceId, opportunity, onUpdated }: EditOpportunityDrawerProps) {
  if (!opportunity) return null
  return (
    <EditOpportunityInner
      key={opportunity.id}
      open={open}
      onClose={onClose}
      workspaceId={workspaceId}
      opportunity={opportunity}
      onUpdated={onUpdated}
    />
  )
}

type EditOpportunityInnerProps = Omit<EditOpportunityDrawerProps, 'opportunity'> & { opportunity: OpportunityRow }

function EditOpportunityInner({
  open,
  onClose,
  workspaceId,
  opportunity,
  onUpdated,
}: EditOpportunityInnerProps) {
  const [title, setTitle] = useState(() => opportunity.title || '')
  const [vertical, setVertical] = useState<VerticalKey>(() => (opportunity.vertical as VerticalKey) || 'general')
  const [stage, setStage] = useState(() => opportunity.stage || 'new')
  const [clientId, setClientId] = useState<string | null>(() => opportunity.client_id ?? null)
  const [value, setValue] = useState(() => (opportunity.value != null ? String(opportunity.value) : ''))
  const [probability, setProbability] = useState(() => (opportunity.probability != null ? String(opportunity.probability) : ''))
  const [source, setSource] = useState(() => opportunity.source ?? '')
  const [expectedClose, setExpectedClose] = useState(() => opportunity.expected_close_date ?? '')
  const [notes, setNotes] = useState(() => opportunity.notes ?? '')
  const [saving, setSaving] = useState(false)

  const stages = pipelineForVertical(vertical)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error('Necesito al menos un título.'); return }
    if (!workspaceId) { toast.error('Sin workspace activo. Inicia sesión real.'); return }
    setSaving(true)
    try {
      const row = await updateOpportunity(workspaceId, opportunity.id, {
        title: title.trim(),
        vertical,
        stage,
        clientId,
        value: value === '' ? null : Number(value) || null,
        probability: probability === '' ? null : Number(probability) || null,
        source: source.trim() || null,
        expectedCloseDate: expectedClose.trim() || null,
        notes: notes.trim() || null,
      })
      if (!row) { toast.error('No se pudo actualizar la oportunidad.'); return }
      toast.success(`Oportunidad actualizada: ${row.title}`)
      onUpdated?.(row)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Editar oportunidad"
      description="Cambia datos del pipeline. Cada edición deja un registro en la actividad."
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setStage('lost')}
            title="Marcar como perdida (sin DELETE)."
            disabled={saving || stage === 'lost' || stage === 'closed'}
          >
            <Archive className="h-3.5 w-3.5" /> Marcar perdida
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button variant="primary" size="sm" type="submit" form="edit-opportunity-form" loading={saving} disabled={saving}>Guardar cambios</Button>
          </div>
        </div>
      }
    >
      <form id="edit-opportunity-form" onSubmit={handleSubmit} className="space-y-3">
        <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Vertical</label>
            <select
              className={SELECT_CLS}
              value={vertical}
              onChange={(e) => {
                const v = e.target.value as VerticalKey
                setVertical(v)
                if (!pipelineForVertical(v).some((s) => s.id === stage)) {
                  setStage(pipelineForVertical(v)[0]?.id ?? 'new')
                }
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
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Cliente vinculado</label>
          <ClientPicker workspaceId={workspaceId ?? null} value={clientId} onChange={(id) => setClientId(id)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Valor (€)" type="number" min="0" placeholder="Opcional" value={value} onChange={(e) => setValue(e.target.value)} />
          <Input label="Probabilidad (%)" type="number" min="0" max="100" placeholder="Opcional" value={probability} onChange={(e) => setProbability(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Origen" placeholder="whatsapp, instagram, web…" value={source} onChange={(e) => setSource(e.target.value)} />
          <Input label="Cierre estimado" type="date" value={expectedClose} onChange={(e) => setExpectedClose(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Notas</label>
          <textarea rows={3} className={TEXTAREA_CLS} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
    </SideDrawer>
  )
}

// -----------------------------------------------------------------------------
// Edit Service Case
// -----------------------------------------------------------------------------

type EditServiceCaseDrawerProps = {
  open: boolean
  onClose: () => void
  workspaceId: string | null
  serviceCase: ServiceCaseRow | null
  onUpdated?: (row: ServiceCaseRow) => void
}

export function EditServiceCaseDrawer({ open, onClose, workspaceId, serviceCase, onUpdated }: EditServiceCaseDrawerProps) {
  if (!serviceCase) return null
  return (
    <EditServiceCaseInner
      key={serviceCase.id}
      open={open}
      onClose={onClose}
      workspaceId={workspaceId}
      serviceCase={serviceCase}
      onUpdated={onUpdated}
    />
  )
}

type EditServiceCaseInnerProps = Omit<EditServiceCaseDrawerProps, 'serviceCase'> & { serviceCase: ServiceCaseRow }

function EditServiceCaseInner({
  open,
  onClose,
  workspaceId,
  serviceCase,
  onUpdated,
}: EditServiceCaseInnerProps) {
  const [title, setTitle] = useState(() => serviceCase.title || '')
  const [caseType, setCaseType] = useState(() => serviceCase.case_type || '')
  const [vertical, setVertical] = useState<VerticalKey>(() => (serviceCase.vertical as VerticalKey) || 'immigration')
  const [status, setStatus] = useState(() => serviceCase.status || 'open')
  const [priority, setPriority] = useState(() => serviceCase.priority || 'normal')
  const [clientId, setClientId] = useState<string | null>(() => serviceCase.client_id ?? null)
  const [dueDate, setDueDate] = useState(() => serviceCase.due_date ?? '')
  const [notes, setNotes] = useState(() => serviceCase.notes ?? '')
  const [saving, setSaving] = useState(false)

  const availableCaseTypes = CASE_TYPES.filter((t) => t.vertical === vertical || vertical === 'general')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error('Necesito al menos un título.'); return }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    setSaving(true)
    try {
      const row = await updateServiceCase(workspaceId, serviceCase.id, {
        title: title.trim(),
        caseType: caseType.trim() || serviceCase.case_type,
        vertical,
        status,
        priority,
        clientId,
        dueDate: dueDate.trim() || null,
        notes: notes.trim() || null,
      })
      if (!row) { toast.error('No se pudo actualizar el expediente.'); return }
      toast.success(`Expediente actualizado: ${row.title}`)
      onUpdated?.(row)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Editar expediente"
      description="Actualiza estado, prioridad o documentación esperada."
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setStatus('closed')}
            title="Cerrar expediente (sin DELETE)."
            disabled={saving || status === 'closed'}
          >
            <Archive className="h-3.5 w-3.5" /> Cerrar expediente
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button variant="primary" size="sm" type="submit" form="edit-service-case-form" loading={saving} disabled={saving}>Guardar cambios</Button>
          </div>
        </div>
      }
    >
      <form id="edit-service-case-form" onSubmit={handleSubmit} className="space-y-3">
        <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Vertical</label>
            <select className={SELECT_CLS} value={vertical} onChange={(e) => setVertical(e.target.value as VerticalKey)}>
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
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Cliente vinculado</label>
          <ClientPicker workspaceId={workspaceId ?? null} value={clientId} onChange={(id) => setClientId(id)} />
        </div>
        <Input label="Fecha límite" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Notas</label>
          <textarea rows={3} className={TEXTAREA_CLS} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
    </SideDrawer>
  )
}

// -----------------------------------------------------------------------------
// Edit Property
// -----------------------------------------------------------------------------

type EditPropertyDrawerProps = {
  open: boolean
  onClose: () => void
  workspaceId: string | null
  property: PropertyRow | null
  onUpdated?: (row: PropertyRow) => void
}

export function EditPropertyDrawer({ open, onClose, workspaceId, property, onUpdated }: EditPropertyDrawerProps) {
  if (!property) return null
  return (
    <EditPropertyInner
      key={property.id}
      open={open}
      onClose={onClose}
      workspaceId={workspaceId}
      property={property}
      onUpdated={onUpdated}
    />
  )
}

type EditPropertyInnerProps = Omit<EditPropertyDrawerProps, 'property'> & { property: PropertyRow }

function EditPropertyInner({
  open,
  onClose,
  workspaceId,
  property,
  onUpdated,
}: EditPropertyInnerProps) {
  const [title, setTitle] = useState(() => property.title || '')
  const [propertyType, setPropertyType] = useState(() => property.property_type || 'apartment')
  const [operationType, setOperationType] = useState(() => property.operation_type || 'sale')
  const [status, setStatus] = useState(() => property.status || 'prospecting')
  const [city, setCity] = useState(() => property.city ?? '')
  const [area, setArea] = useState(() => property.area ?? '')
  const [price, setPrice] = useState(() => (property.price != null ? String(property.price) : ''))
  const [ownerName, setOwnerName] = useState(() => property.owner_name ?? '')
  const [ownerPhone, setOwnerPhone] = useState(() => property.owner_phone ?? '')
  const [clientId, setClientId] = useState<string | null>(() => property.client_id ?? null)
  const [notes, setNotes] = useState(() => property.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error('Necesito al menos un título.'); return }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    setSaving(true)
    try {
      const row = await updateProperty(workspaceId, property.id, {
        title: title.trim(),
        propertyType,
        operationType,
        status,
        city: city.trim() || null,
        area: area.trim() || null,
        price: price === '' ? null : Number(price) || null,
        ownerName: ownerName.trim() || null,
        ownerPhone: ownerPhone.trim() || null,
        clientId,
        notes: notes.trim() || null,
      })
      if (!row) { toast.error('No se pudo actualizar la propiedad.'); return }
      toast.success(`Propiedad actualizada: ${row.title}`)
      onUpdated?.(row)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Editar propiedad"
      description="Actualiza precio, estado o datos del propietario."
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setStatus('archived')}
            title="Archivar propiedad (sin DELETE)."
            disabled={saving || status === 'archived'}
          >
            <Archive className="h-3.5 w-3.5" /> Archivar
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button variant="primary" size="sm" type="submit" form="edit-property-form" loading={saving} disabled={saving}>Guardar cambios</Button>
          </div>
        </div>
      }
    >
      <form id="edit-property-form" onSubmit={handleSubmit} className="space-y-3">
        <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
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
          <Input label="Ciudad" value={city} onChange={(e) => setCity(e.target.value)} />
          <Input label="Zona / barrio" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>
        <Input label="Precio (€)" type="number" min="0" placeholder="Opcional" value={price} onChange={(e) => setPrice(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Propietario / contacto" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          <Input label="Teléfono" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Cliente vinculado</label>
          <ClientPicker workspaceId={workspaceId ?? null} value={clientId} onChange={(id) => setClientId(id)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Notas</label>
          <textarea rows={3} className={TEXTAREA_CLS} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
    </SideDrawer>
  )
}
