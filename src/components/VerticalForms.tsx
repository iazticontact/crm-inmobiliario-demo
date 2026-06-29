'use client'

// Vertical Pack v1 — create drawers shared across /opportunities, /clients (360)
// and (later) /inbox CTAs. Each drawer wraps the workspace-scoped helpers in
// vertical-queries.ts so the same write path (with activity log) is used from
// every UI entry point. El Asistente IA hits the parallel helpers in
// vertical-server.ts; both paths converge on the same Supabase tables.

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { SideDrawer } from '@/components/SideDrawer'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { LocationAutocomplete } from '@/components/LocationAutocomplete'
import { searchCities, searchAreas, findCity, isKnownArea } from '@/lib/locations/location-catalog'
import { normalizeLocationText, normalizeLocationForSave } from '@/lib/locations/normalize-location'
import {
  createOpportunity,
  createServiceCase,
  createProperty,
  type OpportunityRow,
  type ServiceCaseRow,
  type PropertyRow,
} from '@/lib/vertical-queries'
import { PROPERTY_TYPE_OPTIONS, PROPERTY_OPERATION_OPTIONS, PROPERTY_TYPE_OTHER } from '@/lib/property-display'
import {
  VERTICALS,
  COMM_STATE_OPTIONS,
  stageForCommState,
  type CommState,
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

const OTRO = '__otro__'

// Tipo de operación comercial (se guarda en metadata.operation_kind; no es columna).
const OPERATION_KIND_OPTIONS = [
  { id: 'venta', label: 'Venta' },
  { id: 'alquiler', label: 'Alquiler' },
  { id: 'captacion', label: 'Captación' },
  { id: 'compra', label: 'Compra' },
  { id: 'valoracion', label: 'Valoración' },
  { id: 'inversion', label: 'Inversión' },
  { id: OTRO, label: 'Otro' },
]

// Origen del lead/operación (columna `source`).
const SOURCE_OPTIONS = [
  { id: 'web', label: 'Web' },
  { id: 'portal', label: 'Portal inmobiliario' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'llamada', label: 'Llamada' },
  { id: 'oficina', label: 'Oficina' },
  { id: 'referido', label: 'Referido' },
  { id: OTRO, label: 'Otro' },
]

// Tipos de trámite inmobiliario (se guarda el label en `case_type`, texto libre). Lista corta;
// los casos especiales van por "Otro". Tipos antiguos en datos se siguen mostrando tal cual.
export const TRAMITE_TYPE_OPTIONS = [
  'Nota simple', 'Contrato / arras', 'Reserva', 'Tasación',
  'Certificado energético', 'Financiación / hipoteca', 'Escritura / notaría', 'Documentación',
]

type RelProperty = { id: string; title: string; city?: string | null; price?: number | null }

export function formatEuro(n: number): string {
  try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n) }
  catch { return `${n} €` }
}

// Comisión estimada (orientativa, NO factura): base × rate / 100. Base = precio del inmueble
// vinculado o, si no hay, el valor potencial introducido.
export function estimateCommission(base: number | null, ratePct: number | null): number | null {
  if (!base || !ratePct) return null
  return Math.round((base * ratePct) / 100)
}
type RelOpportunity = { id: string; title: string; property_id?: string | null }

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
  defaultPropertyId?: string | null
  properties?: RelProperty[]
  showVerticalSelect?: boolean
  onCreated?: (row: OpportunityRow) => void
}

export function NewOpportunityDrawer({
  open,
  onClose,
  workspaceId,
  defaultVertical = 'real_estate',
  defaultClientId = null,
  defaultClientName = null,
  defaultSource = null,
  defaultPropertyId = null,
  properties = [],
  showVerticalSelect = false,
  onCreated,
}: NewOpportunityDrawerProps) {
  const [title, setTitle] = useState('')
  const [vertical, setVertical] = useState<VerticalKey>(defaultVertical)
  const [commState, setCommState] = useState<CommState>('new')
  const [clientName, setClientName] = useState(defaultClientName ?? '')
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? '')
  const [operationKind, setOperationKind] = useState('venta')
  const [customType, setCustomType] = useState('')
  const [value, setValue] = useState('')
  const [commissionRate, setCommissionRate] = useState('')
  const [closeDate, setCloseDate] = useState('')
  const [sourceKind, setSourceKind] = useState(defaultSource ?? '')
  const [customSource, setCustomSource] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedProperty = properties.find((p) => p.id === propertyId)
  const commissionBase = selectedProperty?.price ?? (value ? Number(value) || null : null)
  const commissionAmount = estimateCommission(commissionBase, commissionRate ? Number(commissionRate) || null : null)

  function reset() {
    setTitle('')
    setVertical(defaultVertical)
    setCommState('new')
    setClientName(defaultClientName ?? '')
    setPropertyId(defaultPropertyId ?? '')
    setOperationKind('venta')
    setCustomType('')
    setValue('')
    setCommissionRate('')
    setCloseDate('')
    setSourceKind(defaultSource ?? '')
    setCustomSource('')
    setNotes('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Necesito al menos un título.')
      return
    }
    if (operationKind === OTRO && !customType.trim()) {
      toast.error('Especifica el tipo de operación.')
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
      const meta: Record<string, unknown> = operationKind === OTRO
        ? { operation_kind: 'otro', custom_type: customType.trim(), source: 'user_custom' }
        : { operation_kind: operationKind }
      const sourceVal = sourceKind === OTRO ? (customSource.trim() || null) : (sourceKind || null)
      const row = await createOpportunity(workspaceId, {
        title: title.trim(),
        vertical,
        stage: stageForCommState(commState),
        clientId: defaultClientId,
        clientName: clientName.trim() || null,
        propertyId: propertyId || null,
        value: value ? Number(value) || null : null,
        commissionRate: commissionRate ? Number(commissionRate) || null : null,
        expectedCloseDate: closeDate || null,
        source: sourceVal,
        notes: notes.trim() || null,
        metadata: meta,
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
      description="Negocio comercial con un cliente y, si aplica, un inmueble."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" size="sm" type="submit" form="new-opportunity-form" loading={saving} disabled={saving}>Crear operación</Button>
        </div>
      }
    >
      <form id="new-opportunity-form" onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="Título de la operación"
          placeholder="Ej: Venta piso Calle Mayor 14 — Familia Soler"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
        <Input
          label="Cliente"
          placeholder="Nombre del cliente — opcional"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
        />
        {properties.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Inmueble vinculado <span className="font-normal text-gray-400">· opcional</span></label>
            <select className={SELECT_CLS} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">Sin inmueble</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.title}{p.city ? ` · ${p.city}` : ''}</option>)}
            </select>
            <p className="text-[11px] text-gray-400">Puedes crear la operación sin inmueble y vincularlo más tarde.</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Tipo de operación</label>
            <select className={SELECT_CLS} value={operationKind} onChange={(e) => setOperationKind(e.target.value)}>
              {OPERATION_KIND_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Estado</label>
            <select className={SELECT_CLS} value={commState} onChange={(e) => setCommState(e.target.value as CommState)}>
              {COMM_STATE_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
        {operationKind === OTRO && (
          <Input
            label="Especifica el tipo"
            placeholder="Ej: Gestión patrimonial, alquiler con opción a compra…"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
          />
        )}
        {showVerticalSelect && (
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Área de negocio</label>
            <select
              className={SELECT_CLS}
              value={vertical}
              onChange={(e) => setVertical(e.target.value as VerticalKey)}
            >
              {Object.values(VERTICALS).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Input label="Valor potencial (€)" type="number" min="0" placeholder="Opcional" value={value} onChange={(e) => setValue(e.target.value)} />
          <Input label="Comisión pactada (%)" type="number" min="0" max="100" step="0.1" placeholder="Opcional" value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} />
          <Input label="Cierre estimado" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-600">Comisión estimada</span>
            <span className="text-sm font-semibold text-gray-900">{commissionAmount != null ? formatEuro(commissionAmount) : '—'}</span>
          </div>
          <p className="mt-0.5 text-[10px] text-gray-400">
            {commissionAmount != null
              ? `Sobre ${selectedProperty?.price != null ? 'el precio del inmueble' : 'el valor potencial'}. Estimación orientativa; no es una factura.`
              : 'Indica valor o inmueble y la comisión pactada para estimarla. No es una factura.'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Origen <span className="font-normal text-gray-400">· opcional</span></label>
          <select className={SELECT_CLS} value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
            <option value="">Sin especificar</option>
            {SOURCE_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        {sourceKind === OTRO && (
          <Input label="Especifica el origen" placeholder="Ej: Instagram, cartel, colaboración…" value={customSource} onChange={(e) => setCustomSource(e.target.value)} />
        )}
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Notas</label>
          <textarea rows={3} className={TEXTAREA_CLS} placeholder="Contexto, requisitos, próximos pasos…" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
  opportunities?: RelOpportunity[]
  properties?: RelProperty[]
  showVerticalSelect?: boolean
  onCreated?: (row: ServiceCaseRow) => void
}

// Estados primarios (5) — formulario de creación + edición rápida.
const SERVICE_STATUS_OPTIONS = [
  { id: 'open', label: 'Abierto' },
  { id: 'in_review', label: 'En revisión' },
  { id: 'documentation_pending', label: 'Pendiente de documentación' },
  { id: 'blocked', label: 'Bloqueado' },
  { id: 'resolved', label: 'Completado' },
]

// Compatibilidad: estados antiguos que pueda haber en datos → etiqueta legible (no se ofrecen
// como opción primaria, pero se muestran bien donde aparezcan).
const SERVICE_STATUS_LEGACY_LABELS: Record<string, string> = {
  signature_pending: 'Pendiente de firma',
  submitted: 'Presentado',
  closed: 'Cerrado',
}

export function serviceCaseStatusLabel(id: string): string {
  return SERVICE_STATUS_OPTIONS.find((s) => s.id === id)?.label ?? SERVICE_STATUS_LEGACY_LABELS[id] ?? id
}

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
  defaultVertical = 'real_estate',
  defaultClientId = null,
  defaultClientName = null,
  opportunities = [],
  properties = [],
  showVerticalSelect = false,
  onCreated,
}: NewServiceCaseDrawerProps) {
  const [title, setTitle] = useState('')
  const [caseTypeSel, setCaseTypeSel] = useState(TRAMITE_TYPE_OPTIONS[0])
  const [customType, setCustomType] = useState('')
  const [vertical, setVertical] = useState<VerticalKey>(defaultVertical)
  const [status, setStatus] = useState('open')
  const [priority, setPriority] = useState('normal')
  const [clientName, setClientName] = useState(defaultClientName ?? '')
  const [opportunityId, setOpportunityId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const linkedOpp = opportunities.find((o) => o.id === opportunityId)
  const linkedProperty = linkedOpp?.property_id ? (properties.find((p) => p.id === linkedOpp.property_id) ?? null) : null

  function reset() {
    setTitle('')
    setCaseTypeSel(TRAMITE_TYPE_OPTIONS[0])
    setCustomType('')
    setVertical(defaultVertical)
    setStatus('open')
    setPriority('normal')
    setClientName(defaultClientName ?? '')
    setOpportunityId('')
    setDueDate('')
    setNotes('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error('Necesito al menos un título.'); return }
    if (caseTypeSel === OTRO && !customType.trim()) { toast.error('Especifica el tipo de trámite.'); return }
    if (isDemoMode()) {
      toast.info('Modo demo (solo lectura)', { description: 'Acción simulada: crear trámites estará disponible al conectar tu cuenta.' })
      reset(); onClose(); return
    }
    if (!workspaceId) { toast.error('Sin workspace activo. Inicia sesión real.'); return }
    setSaving(true)
    try {
      const caseType = caseTypeSel === OTRO ? customType.trim() : caseTypeSel
      const meta: Record<string, unknown> = caseTypeSel === OTRO
        ? { custom_type: customType.trim(), source: 'user_custom' }
        : {}
      const row = await createServiceCase(workspaceId, {
        title: title.trim(),
        caseType,
        vertical,
        status,
        priority,
        clientId: defaultClientId,
        clientName: clientName.trim() || null,
        opportunityId: opportunityId || null,
        dueDate: dueDate || null,
        notes: notes.trim() || null,
        metadata: meta,
      })
      if (!row) { toast.error('No se pudo crear el trámite. Revisa la sesión.'); return }
      toast.success('Trámite creado', { description: 'Puedes adjuntar documentos al editarlo.' })
      onCreated?.(row); reset(); onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Nuevo trámite"
      description="Gestión o documentación vinculada a un cliente, inmueble u operación."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" size="sm" type="submit" form="new-service-case-form" loading={saving} disabled={saving}>Crear trámite</Button>
        </div>
      }
    >
      <form id="new-service-case-form" onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="Título del trámite"
          placeholder="Ej: Nota simple — Piso Calle Mayor 14"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
        <Input
          label="Cliente"
          placeholder="Nombre del cliente — opcional"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
        />
        {opportunities.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Operación vinculada <span className="font-normal text-gray-400">· opcional</span></label>
            <select className={SELECT_CLS} value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
              <option value="">Sin operación</option>
              {opportunities.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
            {linkedProperty && <p className="text-[11px] text-gray-500">Inmueble: {linkedProperty.title}</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Tipo de trámite</label>
            <select className={SELECT_CLS} value={caseTypeSel} onChange={(e) => setCaseTypeSel(e.target.value)}>
              {TRAMITE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value={OTRO}>Otro</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Prioridad</label>
            <select className={SELECT_CLS} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITY_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        </div>
        {caseTypeSel === OTRO && (
          <Input
            label="Especifica el tipo"
            placeholder="Ej: Licencia turística, ITE, comunidad de propietarios…"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
          />
        )}
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Estado</label>
          <select className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value)}>
            {SERVICE_STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
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
        <Input label="Fecha límite" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Notas</label>
          <textarea rows={3} className={TEXTAREA_CLS} placeholder="Documentación esperada, contacto, referencia…" value={notes} onChange={(e) => setNotes(e.target.value)} />
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

// Estado inicial al registrar un inmueble: solo estados activos (vendido/alquilado/archivado se
// marcan después desde la cartera o la ficha; un inmueble nuevo entra en cartera activa).
const PROPERTY_STATUS_OPTIONS = [
  { id: 'prospecting', label: 'En preparación' },
  { id: 'listed', label: 'Publicado' },
  { id: 'under_contract', label: 'Reservado' },
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
  const [propertyType, setPropertyType] = useState('piso')
  const [customType, setCustomType] = useState('')
  const [operationType, setOperationType] = useState('venta')
  const [status, setStatus] = useState('prospecting')
  const [city, setCity] = useState('')
  const [area, setArea] = useState('')
  const areaInputRef = useRef<HTMLInputElement>(null)
  const [price, setPrice] = useState('')
  const [ownerName, setOwnerName] = useState(defaultClientName ?? '')
  const [ownerPhone, setOwnerPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setTitle('')
    setPropertyType('piso')
    setCustomType('')
    setOperationType('venta')
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
    if (propertyType === PROPERTY_TYPE_OTHER && !customType.trim()) {
      toast.error('Especifica el tipo de inmueble.')
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
        city: normalizeLocationForSave(city) || undefined,
        area: normalizeLocationForSave(area) || undefined,
        price: price ? Number(price) || null : null,
        ownerName: ownerName.trim() || undefined,
        ownerPhone: ownerPhone.trim() || undefined,
        clientId: defaultClientId,
        clientName: ownerName.trim() || null,
        notes: notes.trim() || undefined,
        metadata: propertyType === PROPERTY_TYPE_OTHER ? { custom_property_type: customType.trim() } : undefined,
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
              {PROPERTY_OPERATION_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Estado inicial</label>
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
            label="Ciudad"
            placeholder="Bilbao, Madrid, Marbella…"
            value={city}
            onChange={setCity}
            suggestions={searchCities(city)}
            onCommit={(v) => { if (v && findCity(v)) areaInputRef.current?.focus() }}
          />
          <LocationAutocomplete
            label="Zona / barrio"
            placeholder={findCity(city) ? 'Deusto, Abando…' : 'Centro, La Cala…'}
            value={area}
            onChange={setArea}
            inputRef={areaInputRef}
            suggestions={searchAreas(city, area).map((a) => ({ value: a }))}
            helperText={
              !city.trim()
                ? 'Escribe primero la ciudad para ver barrios sugeridos.'
                : area.trim() && findCity(city) && !isKnownArea(city, area)
                  ? `“${normalizeLocationText(area)}” no figura en ${normalizeLocationText(city)}; se guardará como zona personalizada.`
                  : undefined
            }
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
