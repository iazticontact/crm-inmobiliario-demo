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

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Archive } from 'lucide-react'
import { SideDrawer } from '@/components/SideDrawer'
import { PropertyPhotosManager } from '@/components/PropertyPhotosManager'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { LocationAutocomplete } from '@/components/LocationAutocomplete'
import { normalizeLocationForSave } from '@/lib/locations/normalize-location'
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
  COMM_STATE_OPTIONS,
  commStateOf,
  stageForCommState,
  type CommState,
  type VerticalKey,
} from '@/lib/demo/vertical-templates'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { SERVICE_CASE_STATUS_OPTIONS, serviceCaseStatusLabel, TRAMITE_TYPE_OPTIONS, estimateCommission, formatEuro } from '@/components/VerticalForms'
import { EntityDocumentsManager } from '@/components/EntityDocumentsManager'
import { PROPERTY_TYPE_OPTIONS, PROPERTY_OPERATION_OPTIONS, PROPERTY_TYPE_OTHER, PROPERTY_TYPE_LABEL, propLabel } from '@/lib/property-display'

// En modo demo offline no hay workspace real: las ediciones se simulan y
// avisamos con un toast amable en vez de un error técnico de sesión.
function isDemoMode() {
  return typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
}

const SELECT_CLS =
  'h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors'

const TEXTAREA_CLS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors'

const FIELD_LABEL_CLS = 'text-sm font-medium text-gray-700'

const PRIORITY_OPTIONS = [
  { id: 'low', label: 'Baja' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'Alta' },
  { id: 'urgent', label: 'Urgente' },
]


const PROPERTY_STATUS_OPTIONS = [
  { id: 'prospecting', label: 'En preparación' },
  { id: 'listed', label: 'Publicado' },
  { id: 'under_contract', label: 'Reservado' },
  { id: 'sold', label: 'Vendido' },
  { id: 'rented', label: 'Alquilado' },
  { id: 'archived', label: 'Archivado' },
]

// -----------------------------------------------------------------------------
// Edit Opportunity
// -----------------------------------------------------------------------------

type EditOpportunityDrawerProps = {
  open: boolean
  onClose: () => void
  workspaceId: string | null
  opportunity: OpportunityRow | null
  showVerticalSelect?: boolean
  properties?: Array<{ id: string; title: string; price?: number | null }>
  onUpdated?: (row: OpportunityRow) => void
}

export function EditOpportunityDrawer({ open, onClose, workspaceId, opportunity, showVerticalSelect, properties, onUpdated }: EditOpportunityDrawerProps) {
  if (!opportunity) return null
  return (
    <EditOpportunityInner
      key={opportunity.id}
      open={open}
      onClose={onClose}
      workspaceId={workspaceId}
      opportunity={opportunity}
      showVerticalSelect={showVerticalSelect}
      properties={properties}
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
  showVerticalSelect = false,
  properties = [],
  onUpdated,
}: EditOpportunityInnerProps) {
  const [title, setTitle] = useState(() => opportunity.title || '')
  const [vertical, setVertical] = useState<VerticalKey>(() => (opportunity.vertical as VerticalKey) || 'real_estate')
  const [stage, setStage] = useState(() => opportunity.stage || 'new')
  const [clientId, setClientId] = useState<string | null>(() => opportunity.client_id ?? null)
  const [value, setValue] = useState(() => (opportunity.value != null ? String(opportunity.value) : ''))
  const [commissionRate, setCommissionRate] = useState(() => (opportunity.commission_rate != null ? String(opportunity.commission_rate) : ''))
  const [source, setSource] = useState(() => opportunity.source ?? '')
  const [expectedClose, setExpectedClose] = useState(() => opportunity.expected_close_date ?? '')
  const [notes, setNotes] = useState(() => opportunity.notes ?? '')
  const [saving, setSaving] = useState(false)

  const linkedProperty = opportunity.property_id ? properties.find((p) => p.id === opportunity.property_id) : undefined
  const commissionBase = linkedProperty?.price ?? (value ? Number(value) || null : null)
  const commissionAmount = estimateCommission(commissionBase, commissionRate ? Number(commissionRate) || null : null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error('Necesito al menos un título.'); return }
    if (isDemoMode()) {
      toast.info('Modo demo (solo lectura)', { description: 'Acción simulada: editar operaciones estará disponible al conectar tu cuenta.' })
      onClose()
      return
    }
    if (!workspaceId) { toast.error('Sin workspace activo. Inicia sesión real.'); return }
    setSaving(true)
    try {
      const row = await updateOpportunity(workspaceId, opportunity.id, {
        title: title.trim(),
        vertical,
        stage,
        clientId,
        value: value === '' ? null : Number(value) || null,
        commissionRate: commissionRate === '' ? null : Number(commissionRate) || null,
        source: source.trim() || null,
        expectedCloseDate: expectedClose.trim() || null,
        notes: notes.trim() || null,
      })
      if (!row) { toast.error('No se pudo actualizar la operación.'); return }
      toast.success(`Operación actualizada: ${row.title}`)
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
      title="Editar operación"
      description="Cambia los datos de la operación. Cada edición deja registro en la actividad."
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
        {showVerticalSelect && (
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Área de negocio</label>
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
        )}
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Estado</label>
          <select className={SELECT_CLS} value={commStateOf(stage)} onChange={(e) => setStage(stageForCommState(e.target.value as CommState))}>
            {COMM_STATE_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Cliente relacionado</label>
          <ClientPicker workspaceId={workspaceId ?? null} value={clientId} onChange={(id) => setClientId(id)} />
        </div>
        {linkedProperty && (
          <p className="text-[11px] text-gray-500">Inmueble vinculado: <span className="font-medium text-gray-700">{linkedProperty.title}</span>{linkedProperty.price != null ? ` · ${formatEuro(linkedProperty.price)}` : ''}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Valor potencial (€)" type="number" min="0" placeholder="Opcional" value={value} onChange={(e) => setValue(e.target.value)} />
          <Input label="Comisión pactada (%)" type="number" min="0" max="100" step="0.1" placeholder="Opcional" value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} />
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-600">Comisión estimada</span>
            <span className="text-sm font-semibold text-gray-900">{commissionAmount != null ? formatEuro(commissionAmount) : '—'}</span>
          </div>
          <p className="mt-0.5 text-[10px] text-gray-400">Estimación orientativa; no es una factura.</p>
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
  showVerticalSelect?: boolean
  onUpdated?: (row: ServiceCaseRow) => void
  onDocCountChange?: (entityId: string, count: number) => void
}

export function EditServiceCaseDrawer({ open, onClose, workspaceId, serviceCase, showVerticalSelect, onUpdated, onDocCountChange }: EditServiceCaseDrawerProps) {
  if (!serviceCase) return null
  return (
    <EditServiceCaseInner
      key={serviceCase.id}
      open={open}
      onClose={onClose}
      workspaceId={workspaceId}
      serviceCase={serviceCase}
      showVerticalSelect={showVerticalSelect}
      onUpdated={onUpdated}
      onDocCountChange={onDocCountChange}
    />
  )
}

type EditServiceCaseInnerProps = Omit<EditServiceCaseDrawerProps, 'serviceCase'> & { serviceCase: ServiceCaseRow }

function EditServiceCaseInner({
  open,
  onClose,
  workspaceId,
  serviceCase,
  showVerticalSelect = false,
  onUpdated,
  onDocCountChange,
}: EditServiceCaseInnerProps) {
  const [title, setTitle] = useState(() => serviceCase.title || '')
  const [caseType, setCaseType] = useState(() => serviceCase.case_type || '')
  const [vertical, setVertical] = useState<VerticalKey>(() => (serviceCase.vertical as VerticalKey) || 'real_estate')
  const [status, setStatus] = useState(() => serviceCase.status || 'open')
  const [priority, setPriority] = useState(() => serviceCase.priority || 'normal')
  const [clientId, setClientId] = useState<string | null>(() => serviceCase.client_id ?? null)
  const [dueDate, setDueDate] = useState(() => serviceCase.due_date ?? '')
  const [notes, setNotes] = useState(() => serviceCase.notes ?? '')
  const [saving, setSaving] = useState(false)

  // Tipo y estado: lista corta + el valor actual si fuese antiguo (no se pierde ni se ve vacío).
  const typeOptions = caseType && !TRAMITE_TYPE_OPTIONS.includes(caseType) ? [caseType, ...TRAMITE_TYPE_OPTIONS] : TRAMITE_TYPE_OPTIONS
  const statusOptions = SERVICE_CASE_STATUS_OPTIONS.some((s) => s.id === status)
    ? SERVICE_CASE_STATUS_OPTIONS
    : [...SERVICE_CASE_STATUS_OPTIONS, { id: status, label: serviceCaseStatusLabel(status) }]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error('Necesito al menos un título.'); return }
    if (isDemoMode()) {
      toast.info('Modo demo (solo lectura)', { description: 'Acción simulada: editar trámites estará disponible al conectar tu cuenta.' })
      onClose()
      return
    }
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
      if (!row) { toast.error('No se pudo actualizar el trámite.'); return }
      toast.success(`Trámite actualizado: ${row.title}`)
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
      title="Editar trámite"
      description="Estado, prioridad, fechas y documentos de la gestión."
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setStatus('resolved')}
            title="Marcar el trámite como completado."
            disabled={saving || status === 'resolved'}
          >
            <Archive className="h-3.5 w-3.5" /> Marcar completado
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
            <label className={FIELD_LABEL_CLS}>Tipo de trámite</label>
            <select className={SELECT_CLS} value={caseType} onChange={(e) => setCaseType(e.target.value)}>
              {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Prioridad</label>
            <select className={SELECT_CLS} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITY_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Estado</label>
          <select className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value)}>
            {statusOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        {showVerticalSelect && (
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Área de negocio</label>
            <select className={SELECT_CLS} value={vertical} onChange={(e) => setVertical(e.target.value as VerticalKey)}>
              {Object.values(VERTICALS).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Cliente relacionado</label>
          <ClientPicker workspaceId={workspaceId ?? null} value={clientId} onChange={(id) => setClientId(id)} />
        </div>
        <Input label="Fecha límite" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Notas</label>
          <textarea rows={3} className={TEXTAREA_CLS} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
      <div className="mt-4 border-t border-gray-100 pt-4">
        <EntityDocumentsManager workspaceId={workspaceId} entityType="service_case" entityId={serviceCase.id} onCountChange={onDocCountChange} />
      </div>
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
  onCoverChange?: (propertyId: string, coverUrl: string | null) => void
}

export function EditPropertyDrawer({ open, onClose, workspaceId, property, onUpdated, onCoverChange }: EditPropertyDrawerProps) {
  if (!property) return null
  return (
    <EditPropertyInner
      key={property.id}
      open={open}
      onClose={onClose}
      workspaceId={workspaceId}
      property={property}
      onUpdated={onUpdated}
      onCoverChange={onCoverChange}
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
  onCoverChange,
}: EditPropertyInnerProps) {
  const [title, setTitle] = useState(() => property.title || '')
  const [propertyType, setPropertyType] = useState(() => property.property_type || 'piso')
  const [customType, setCustomType] = useState(() => (typeof property.metadata?.custom_property_type === 'string' ? property.metadata.custom_property_type : ''))
  const [operationType, setOperationType] = useState(() => property.operation_type || 'venta')
  const [status, setStatus] = useState(() => property.status || 'prospecting')
  // Opciones de tipo: catálogo + el tipo actual si fuese uno antiguo no catalogado (no se pierde).
  const typeOptions = PROPERTY_TYPE_OPTIONS.some((t) => t.id === property.property_type) || property.property_type === PROPERTY_TYPE_OTHER || !property.property_type
    ? PROPERTY_TYPE_OPTIONS
    : [{ id: property.property_type, label: propLabel(PROPERTY_TYPE_LABEL, property.property_type) }, ...PROPERTY_TYPE_OPTIONS]
  const [city, setCity] = useState(() => property.city ?? '')
  const [area, setArea] = useState(() => property.area ?? '')
  const areaInputRef = useRef<HTMLInputElement>(null)
  const [price, setPrice] = useState(() => (property.price != null ? String(property.price) : ''))
  const [ownerName, setOwnerName] = useState(() => property.owner_name ?? '')
  const [ownerPhone, setOwnerPhone] = useState(() => property.owner_phone ?? '')
  const [clientId, setClientId] = useState<string | null>(() => property.client_id ?? null)
  const [notes, setNotes] = useState(() => property.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error('Necesito al menos un título.'); return }
    if (propertyType === PROPERTY_TYPE_OTHER && !customType.trim()) { toast.error('Especifica el tipo de inmueble.'); return }
    if (isDemoMode()) {
      toast.info('Modo demo (solo lectura)', { description: 'Acción simulada: editar propiedades estará disponible al conectar tu cuenta.' })
      onClose()
      return
    }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    setSaving(true)
    try {
      const nextMeta: Record<string, unknown> = { ...(property.metadata ?? {}) }
      if (propertyType === PROPERTY_TYPE_OTHER && customType.trim()) nextMeta.custom_property_type = customType.trim()
      else delete nextMeta.custom_property_type
      const row = await updateProperty(workspaceId, property.id, {
        title: title.trim(),
        propertyType,
        operationType,
        status,
        city: normalizeLocationForSave(city) || null,
        area: normalizeLocationForSave(area) || null,
        price: price === '' ? null : Number(price) || null,
        ownerName: ownerName.trim() || null,
        ownerPhone: ownerPhone.trim() || null,
        clientId,
        notes: notes.trim() || null,
        metadata: nextMeta,
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
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Operación</label>
            <select className={SELECT_CLS} value={operationType} onChange={(e) => setOperationType(e.target.value)}>
              {PROPERTY_OPERATION_OPTIONS.map((o) => (
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
        {propertyType === PROPERTY_TYPE_OTHER && (
          <Input
            label="Especifica el tipo"
            placeholder="Ej.: trastero, garaje, nave, terreno…"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <LocationAutocomplete
            label="Localidad / municipio"
            placeholder="Bilbao, Getxo, Madrid…"
            value={city}
            onChange={setCity}
            type="locality"
            onCommit={(v) => { if (v) areaInputRef.current?.focus() }}
          />
          <LocationAutocomplete
            label="Zona / barrio"
            placeholder="Deusto, Abando, Centro…"
            value={area}
            onChange={setArea}
            type="area"
            locality={city}
            inputRef={areaInputRef}
            helperText={!city.trim() ? 'Escribe primero la localidad para ver barrios sugeridos.' : undefined}
          />
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
      <div className="mt-4 border-t border-gray-100 pt-4">
        <PropertyPhotosManager workspaceId={workspaceId} propertyId={property.id} onCoverChange={onCoverChange} />
      </div>
    </SideDrawer>
  )
}
