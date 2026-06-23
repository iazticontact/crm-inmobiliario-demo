'use client'

// /opportunities — Cartera inmobiliaria (centro del CRM).
//
// Vista por defecto: Inmuebles (la cartera). Tabs visibles al cliente:
// Inmuebles · Operaciones · Trámites. "Plantillas" y "Automatizaciones" son superficie
// de operador (solo NEXT_PUBLIC_NOWLABS_INTERNAL). La ruta sigue siendo /opportunities
// (sidebar "Cartera") para no romper enlaces.
//
// Lenguaje de producto: Inmueble (tabla properties) = activo gestionado; Operación = negocio
// comercial; Trámite (tabla service_cases) = gestión/documentación. "Expediente" y "Pipeline"
// no aparecen en la UI visible. Fotos/documentos de inmueble: pendiente (sin Storage) → ver
// docs/REAL_ESTATE_MEDIA_AND_DOCUMENTS_ROADMAP.md (placeholder, sin upload falso).
//
// Lecturas: helpers workspace-scoped en vertical-queries.ts (RLS al fondo).
// Escrituras: drawers laterales en src/components/VerticalForms.tsx — usan los
// mismos helpers que crean (con activity log) las mismas entidades que crea
// el Asistente IA desde el chat. Inline status/stage edit reescribe vía
// updateOpportunityStage / updateServiceCaseStatus / updatePropertyStatus.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Target,
  Building2,
  Home,
  FileText,
  RefreshCcw,
  Sparkles,
  Plus,
  PlayCircle,
  Pencil,
  Trash2,
  MapPin,
  Coins,
  Check,
  X,
  Archive,
  ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { EmptyState } from '@/components/EmptyState'
import {
  NewOpportunityDrawer,
  NewServiceCaseDrawer,
  NewPropertyDrawer,
  SERVICE_CASE_STATUS_OPTIONS,
  serviceCaseStatusLabel,
} from '@/components/VerticalForms'
import {
  EditOpportunityDrawer,
  EditServiceCaseDrawer,
  EditPropertyDrawer,
} from '@/components/VerticalEditForms'
import { WorkspaceTemplatesPanel } from '@/components/WorkspaceTemplatesPanel'
import { EntityDocumentsManager } from '@/components/EntityDocumentsManager'
import {
  PROPERTY_TYPE_LABEL,
  PROPERTY_OPERATION_LABEL,
  PROPERTY_STATUS_META,
  propLabel,
  propNum,
  isRentalProperty,
  sortPropertiesByStatus,
  ACTIVE_STATUS_RANK,
  HISTORY_STATUS_RANK,
} from '@/lib/property-display'
import { cn } from '@/lib/utils'
import { DEMO_MODE_KEY, useCurrentUser } from '@/lib/current-user'
import { featureFlags } from '@/lib/feature-flags'
import { demoOpportunities, demoServiceCases, demoProperties } from '@/lib/demo/demo-real-estate'
import { clients as demoClients } from '@/lib/mock-data'
import { getClients } from '@/lib/supabase-queries'
import { coverUrlsForProperties, documentCountsForEntities, deleteEntityFilesFor } from '@/lib/entity-files'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  VERTICALS,
  COMM_STATE_ORDER,
  COMM_STATE_OPTIONS,
  COMM_STATE_TONE,
  commStateOf,
  wonLabel,
  stageForCommState,
  getAutomationTemplatesForVertical,
  AUTOMATION_TEMPLATES,
  type CommState,
  type VerticalKey,
} from '@/lib/demo/vertical-templates'
import {
  listOpportunities,
  listServiceCases,
  listProperties,
  updateOpportunityStage,
  updateServiceCaseStatus,
  updatePropertyStatus,
  updateOpportunity,
  deleteOpportunity,
  deleteServiceCase,
  type OpportunityRow,
  type ServiceCaseRow,
  type PropertyRow,
} from '@/lib/vertical-queries'

type VerticalTab = 'all' | VerticalKey
type Subtab = 'pipeline' | 'cases' | 'properties' | 'commissions' | 'templates' | 'automations'

const VERTICAL_TABS: Array<{ key: VerticalTab; label: string; description: string }> = [
  { key: 'all',                    label: 'Todos',         description: 'Operativa completa del workspace.' },
  { key: 'real_estate',            label: 'Inmobiliaria',  description: 'Captaciones, visitas y operaciones inmobiliarias.' },
  { key: 'immigration',            label: 'Extranjería',   description: 'Trámites y gestiones de extranjería.' },
  { key: 'professional_services',  label: 'Servicios',     description: 'Asesorías y servicios profesionales recurrentes.' },
]

// Orden comercial: Operaciones (negocio abierto) primero, luego Trámites (gestiones)
// y Propiedades (cartera). "Plantillas" y "Automatizaciones" son superficie de operador:
// se ocultan al cliente y solo aparecen con NEXT_PUBLIC_NOWLABS_INTERNAL=true (no aportan
// al pack básico y confunden el módulo comercial).
const ALL_SUBTABS: Array<{ key: Subtab; label: string; icon: React.ComponentType<{ className?: string }>; internal?: boolean }> = [
  { key: 'properties',   label: 'Inmuebles',        icon: Building2 },
  { key: 'pipeline',     label: 'Operaciones',      icon: Target },
  { key: 'cases',        label: 'Trámites',         icon: FileText },
  { key: 'commissions',  label: 'Comisiones',       icon: Coins },
  { key: 'templates',    label: 'Plantillas',       icon: Sparkles, internal: true },
  { key: 'automations',  label: 'Automatizaciones', icon: PlayCircle, internal: true },
]

const SUBTABS = ALL_SUBTABS.filter((tab) => !tab.internal || featureFlags.nowlabsInternal)

// Etapas terminales (cerradas): no cuentan como "operación abierta" ni suman valor potencial.
const TERMINAL_STAGES = new Set(['won', 'lost', 'resolved', 'closed'])

const SELECT_CLS =
  'h-7 rounded-lg border border-gray-200 bg-white px-2 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500'

function formatCurrency(value: number | null, currency = 'EUR') {
  if (value == null || !Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${value} ${currency}`
  }
}

function formatDate(value: string | null) {
  if (!value) return null
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  } catch { return null }
}

// Etiquetas/estados/orden de inmuebles → módulo compartido con la ficha (property-display).
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export default function OpportunitiesPage() {
  const { currentUser, isLoading: userLoading } = useCurrentUser()

  const [vertical, setVertical] = useState<VerticalTab>('all')
  const [subtab, setSubtab] = useState<Subtab>('properties')
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  const [cases, setCases] = useState<ServiceCaseRow[]>([])
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [clientNames, setClientNames] = useState<Record<string, string>>({})
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})
  const [docCountByCase, setDocCountByCase] = useState<Record<string, number>>({})
  // Borrado seguro (P6.8)
  const [deleteOppTarget, setDeleteOppTarget] = useState<OpportunityRow | null>(null)
  const [deleteCaseTarget, setDeleteCaseTarget] = useState<ServiceCaseRow | null>(null)
  // Documentos de un trámite gestionables directamente desde la fila (sin abrir el drawer de edición).
  const [docsCase, setDocsCase] = useState<ServiceCaseRow | null>(null)
  const [blockedOppTarget, setBlockedOppTarget] = useState<OpportunityRow | null>(null)
  const [highlightOpId, setHighlightOpId] = useState<string | null>(null)
  const [closeOpp, setCloseOpp] = useState<OpportunityRow | null>(null)
  // Inmuebles: vista de cartera (activos / histórico / todos). Por defecto, solo activos.
  const [propView, setPropView] = useState<'active' | 'history' | 'all'>('active')
  // Cambio de estado de un inmueble que lo pasa a histórico (vendido/alquilado/archivado) → confirma.
  const [propStatusChange, setPropStatusChange] = useState<{ property: PropertyRow; nextStatus: string } | null>(null)
  // Comisiones: por defecto solo operaciones cerradas (vendidas/alquiladas) con comisión.
  const [showOpenCommissions, setShowOpenCommissions] = useState(false)
  // Registrar cobro de comisión (fecha + importe real opcional + nota opcional).
  const [collectOpp, setCollectOpp] = useState<OpportunityRow | null>(null)
  const [collectDate, setCollectDate] = useState('')
  const [collectAmount, setCollectAmount] = useState('')
  const [collectNote, setCollectNote] = useState('')
  const [collectBusy, setCollectBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Create drawers
  const [openOpp, setOpenOpp] = useState(false)
  const [openCase, setOpenCase] = useState(false)
  const [openProp, setOpenProp] = useState(false)

  // Edit drawers — only one open at a time.
  const [editOpp, setEditOpp] = useState<OpportunityRow | null>(null)
  const [editCase, setEditCase] = useState<ServiceCaseRow | null>(null)
  const [editProp, setEditProp] = useState<PropertyRow | null>(null)

  const workspaceId = currentUser?.workspaceId ?? null

  const loadData = useCallback(async () => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      setOpportunities(demoOpportunities)
      setCases(demoServiceCases)
      setProperties(demoProperties)
      setClientNames(Object.fromEntries(demoClients.map((c) => [c.id, c.name])))
      setCoverUrls({}) // modo demo offline no tiene Storage real
      setDocCountByCase({})
      setLoadError('')
      setLoading(false)
      return
    }
    if (!workspaceId) {
      setOpportunities([]); setCases([]); setProperties([]); setClientNames({}); setCoverUrls({}); setDocCountByCase({})
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      // Una lectura agregada de clientes (no N+1) para resolver el nombre del cliente
      // por operación/trámite. El resto son los listados workspace-scoped (RLS).
      const [opps, srv, props, clientList] = await Promise.all([
        listOpportunities(workspaceId).catch(() => []),
        listServiceCases(workspaceId).catch(() => []),
        listProperties(workspaceId).catch(() => []),
        getClients(workspaceId).catch(() => []),
      ])
      setOpportunities(opps)
      setCases(srv)
      setProperties(props)
      setClientNames(Object.fromEntries((clientList as { id: string; name: string }[]).map((c) => [c.id, c.name])))
      // Portadas reales (Storage privado + signed URLs); no bloquea el render.
      coverUrlsForProperties(workspaceId, props.map((p) => p.id)).then(setCoverUrls).catch(() => setCoverUrls({}))
      // Nº de documentos por trámite (una lectura agregada, sin N+1).
      documentCountsForEntities(workspaceId, 'service_case', srv.map((c) => c.id)).then(setDocCountByCase).catch(() => setDocCountByCase({}))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error cargando datos.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (userLoading) return
    queueMicrotask(() => { void loadData() })
  }, [userLoading, loadData])

  const visibleOpportunities = useMemo(() => {
    if (vertical === 'all') return opportunities
    return opportunities.filter((o) => o.vertical === vertical)
  }, [opportunities, vertical])

  const visibleCases = useMemo(() => {
    if (vertical === 'all') return cases
    return cases.filter((c) => c.vertical === vertical)
  }, [cases, vertical])

  const visibleProperties = useMemo(() => {
    if (vertical === 'all') return properties
    if (vertical === 'real_estate') return properties
    return [] // Properties only apply to real_estate today.
  }, [properties, vertical])

  // Vertical para la etiqueta del empty state cuando se filtra por una vertical concreta.
  const verticalForPipeline: VerticalKey = useMemo(() => {
    if (vertical !== 'all') return vertical as VerticalKey
    const set = new Set<string>()
    for (const o of opportunities) if (o.vertical) set.add(String(o.vertical))
    return set.size === 1 ? (Array.from(set)[0] as VerticalKey) : 'real_estate'
  }, [vertical, opportunities])

  // El tablero agrupa por ESTADO COMERCIAL (5 buckets), no por etapa interna: simple y claro.
  const opportunitiesByCommState = useMemo(() => {
    const out: Record<CommState, OpportunityRow[]> = { new: [], managing: [], reserved: [], won: [], lost: [] }
    for (const opp of visibleOpportunities) out[commStateOf(opp.stage)].push(opp)
    return out
  }, [visibleOpportunities])

  const automationTemplates = useMemo(() => {
    if (vertical === 'all') return AUTOMATION_TEMPLATES
    return getAutomationTemplatesForVertical(vertical as VerticalKey)
  }, [vertical])

  const openOpportunities = useMemo(
    () => visibleOpportunities.filter((o) => !TERMINAL_STAGES.has(o.stage)),
    [visibleOpportunities],
  )
  const openValue = openOpportunities.reduce((sum, o) => sum + (o.value ?? 0), 0)
  const activeCases = visibleCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved').length
  const clientNameOf = (id: string | null) => (id ? clientNames[id] ?? '' : '')

  // Mapas para enlazar entidades (vínculos reales ya cargados, sin N+1).
  const propertiesById = useMemo(() => Object.fromEntries(properties.map((p) => [p.id, p])), [properties])
  const opportunitiesById = useMemo(() => Object.fromEntries(opportunities.map((o) => [o.id, o])), [opportunities])
  // ¿La operación es un alquiler (a efectos de comisión)? Lo es si el inmueble es de alquiler o si
  // la operación lo declara en metadata.operation_kind.
  const isRentalOpp = (opp: OpportunityRow): boolean => {
    const kind = typeof opp.metadata?.operation_kind === 'string' ? opp.metadata.operation_kind : ''
    if (kind === 'alquiler') return true
    const p = opp.property_id ? propertiesById[opp.property_id] : undefined
    return p?.operation_type === 'alquiler' || p?.operation_type === 'alquiler_opcion_compra'
  }
  // Comisión prevista (orientativa, control interno). Soporta 3 modelos vía
  // metadata.commission_model: 'percent' (def.) · 'one_month' (1 mensualidad de alquiler) ·
  // 'fixed' (importe en metadata.commission_fixed). Clave en alquiler %: la base es la renta ANUAL
  // (valor potencial), no la mensualidad, para no producir cifras absurdas (3% de 1 mes).
  const commissionOf = (opp: OpportunityRow): number | null => {
    const meta = opp.metadata ?? {}
    const model = typeof meta.commission_model === 'string' ? meta.commission_model : 'percent'
    const rental = isRentalOpp(opp)
    const monthly = rental && opp.property_id ? (propertiesById[opp.property_id]?.price ?? null) : null
    if (model === 'fixed') {
      const f = Number(meta.commission_fixed)
      return Number.isFinite(f) && f > 0 ? Math.round(f) : null
    }
    if (model === 'one_month') {
      return monthly ? Math.round(monthly) : null
    }
    // percent (por defecto): venta → base = precio del inmueble o valor; alquiler → renta anual.
    const base = rental ? opp.value : ((opp.property_id ? propertiesById[opp.property_id]?.price : null) ?? opp.value)
    return base && opp.commission_rate ? Math.round((base * opp.commission_rate) / 100) : null
  }
  // Criterio de comisión, para la lista de Comisiones: "3%", "1 mensualidad" o "importe fijo".
  const commissionBasisLabel = (opp: OpportunityRow): string => {
    const model = typeof opp.metadata?.commission_model === 'string' ? opp.metadata.commission_model : 'percent'
    if (model === 'one_month') return '1 mensualidad'
    if (model === 'fixed') return 'importe fijo'
    return opp.commission_rate ? `${opp.commission_rate}%` : ''
  }
  // Nº de operaciones por inmueble (vía metadata.property_id). Honesto: 0 si no hay enlace.
  const opsCountByProperty = useMemo(() => {
    const m: Record<string, number> = {}
    for (const o of opportunities) {
      const pid = o.property_id ?? (typeof o.metadata?.property_id === 'string' ? o.metadata.property_id : null)
      if (typeof pid === 'string') m[pid] = (m[pid] ?? 0) + 1
    }
    return m
  }, [opportunities])

  // Inmuebles cerrados (vendidos/alquilados/archivados) → histórico (no se borran). "Activos" = todo
  // lo que sigue en cartera. Orden: reservados → publicados → captación (activos); vendidos →
  // alquilados → archivados (histórico), con updated_at como desempate.
  const isClosedProperty = (status: string | null) => status === 'sold' || status === 'rented' || status === 'archived'
  const activeProperties = visibleProperties.filter((p) => !isClosedProperty(p.status))
  const historyProperties = visibleProperties.filter((p) => isClosedProperty(p.status))
  const soldArchivedCount = historyProperties.length
  const activeSorted = sortPropertiesByStatus(activeProperties, ACTIVE_STATUS_RANK)
  const historySorted = sortPropertiesByStatus(historyProperties, HISTORY_STATUS_RANK)
  const shownProperties = propView === 'history' ? historySorted : propView === 'all' ? [...activeSorted, ...historySorted] : activeSorted

  // KPIs de cartera (vista Inmuebles). "Valor de cartera activa" = suma de precios de los inmuebles
  // activos (excluye el histórico vendido/alquilado): no es facturación ni ingresos.
  const portfolioListed = activeProperties.filter((p) => p.status === 'listed' || p.status === 'available').length
  const portfolioActiveValue = activeProperties.reduce((s, p) => s + (p.price ?? 0), 0)

  // Módulo Comisiones: operaciones con comisión prevista calculable (control interno de cobros).
  // Por defecto solo las cerradas (vendidas/alquiladas); el toggle suma también las abiertas.
  const allCommissionRows = visibleOpportunities.filter((o) => commissionOf(o) != null)
  const closedCommissionRows = allCommissionRows.filter((o) => commStateOf(o.stage) === 'won')
  const commissionRows = showOpenCommissions ? allCommissionRows : closedCommissionRows
  const openCommissionCount = allCommissionRows.length - closedCommissionRows.length
  const commissionTotals = (() => {
    let estimated = 0
    let collected = 0
    for (const o of commissionRows) {
      const est = commissionOf(o) ?? 0
      estimated += est
      if (o.commission_status === 'cobrada') collected += o.commission_paid_amount ?? est
    }
    return { estimated, collected, pending: Math.max(0, estimated - collected) }
  })()

  // Verticales realmente presentes en los datos del workspace. Una inmobiliaria normal
  // solo tiene `real_estate` → no se muestra el selector de verticales (UI mínima). El
  // selector solo aparece cuando hay datos en más de una vertical (workspace mixto), y
  // únicamente con las verticales presentes (sin "Extranjería"/"Servicios" vacíos).
  const presentVerticals = useMemo(() => {
    const s = new Set<string>()
    for (const o of opportunities) if (o.vertical) s.add(String(o.vertical))
    for (const c of cases) if (c.vertical) s.add(String(c.vertical))
    if (properties.length) s.add('real_estate')
    return s
  }, [opportunities, cases, properties])

  const showVerticalBar = presentVerticals.size > 1
  const visibleVerticalTabs = useMemo(
    () => VERTICAL_TABS.filter((t) => t.key === 'all' || presentVerticals.has(t.key)),
    [presentVerticals],
  )

  // Las propiedades solo aplican a inmobiliaria. En verticales sin inmuebles se oculta la
  // pestaña (y el KPI) para no mostrar "0 propiedades" sin contexto.
  const verticalSupportsProperties = vertical === 'all' || vertical === 'real_estate'
  const visibleSubtabs = useMemo(
    () => SUBTABS.filter((t) => t.key !== 'properties' || verticalSupportsProperties),
    [verticalSupportsProperties],
  )
  // Subtab efectivo: si el activo deja de ser visible (cambio de vertical), cae a Operaciones
  // sin tocar estado en efecto (evita el lint set-state-in-effect).
  const activeSubtab: Subtab = visibleSubtabs.some((t) => t.key === subtab) ? subtab : 'pipeline'

  // Inline stage / status edits — optimistic + persisted.
  async function handleOpportunityStage(opp: OpportunityRow, nextStage: string) {
    // El selector trabaja por estado comercial: si el bucket no cambia (p. ej. una etapa
    // legacy que ya mapea a «En gestión»), no reescribimos la etapa ni avisamos.
    if (commStateOf(nextStage) === commStateOf(opp.stage)) return
    // Cerrar con inmueble vinculado → confirmación guiada (también marca el inmueble como
    // vendido/alquilado, sin eliminar nada).
    if (nextStage === 'won' && opp.property_id && propertiesById[opp.property_id]) {
      setCloseOpp(opp)
      return
    }
    await applyOpportunityStage(opp, nextStage)
  }

  async function applyOpportunityStage(opp: OpportunityRow, nextStage: string) {
    setOpportunities((prev) => prev.map((o) => (o.id === opp.id ? { ...o, stage: nextStage } : o)))
    if (isDemo()) {
      toast.info('Modo demo: cambio aplicado en pantalla (no se guarda).')
      return
    }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    const ok = await updateOpportunityStage(workspaceId, opp.id, nextStage)
    if (!ok) {
      toast.error('No se pudo cambiar el estado.')
      void loadData()
      return
    }
    toast.success('Operación actualizada')
  }

  // Confirmar cierre: marca la operación como Cerrada y el inmueble como Vendido (venta/compra/
  // captación/inversión/valoración) o Alquilado (alquiler). No elimina nada.
  async function confirmCloseOpp() {
    const opp = closeOpp
    if (!opp || !opp.property_id) { setCloseOpp(null); return }
    const kind = typeof opp.metadata?.operation_kind === 'string' ? opp.metadata.operation_kind : ''
    const propStatus = kind === 'alquiler' ? 'rented' : 'sold'
    const pid = opp.property_id
    setCloseOpp(null)
    setProperties((prev) => prev.map((p) => (p.id === pid ? { ...p, status: propStatus } : p)))
    await applyOpportunityStage(opp, 'won')
    if (!isDemo() && workspaceId) {
      await updatePropertyStatus(workspaceId, pid, propStatus).catch(() => {})
    }
  }

  async function handleCaseStatus(row: ServiceCaseRow, nextStatus: string) {
    if (nextStatus === row.status) return
    setCases((prev) => prev.map((c) => (c.id === row.id ? { ...c, status: nextStatus } : c)))
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo: cambio aplicado en pantalla (no se guarda).')
      return
    }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    const ok = await updateServiceCaseStatus(workspaceId, row.id, nextStatus)
    if (!ok) {
      toast.error('No se pudo cambiar el estado del trámite.')
      void loadData()
      return
    }
    toast.success('Trámite actualizado')
  }

  // Pasar a histórico (vendido/alquilado/archivado) pide confirmación; el resto se aplica directo.
  function requestPropertyStatus(row: PropertyRow, nextStatus: string) {
    if (nextStatus === row.status) return
    if (isClosedProperty(nextStatus)) { setPropStatusChange({ property: row, nextStatus }); return }
    void handlePropertyStatus(row, nextStatus)
  }

  async function handlePropertyStatus(row: PropertyRow, nextStatus: string) {
    if (nextStatus === row.status) return
    setProperties((prev) => prev.map((p) => (p.id === row.id ? { ...p, status: nextStatus } : p)))
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo: cambio aplicado en pantalla (no se guarda).')
      return
    }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    const ok = await updatePropertyStatus(workspaceId, row.id, nextStatus)
    if (!ok) {
      toast.error('No se pudo cambiar el estado del inmueble.')
      void loadData()
      return
    }
    toast.success('Inmueble actualizado')
  }

  // Portada de un inmueble cambiada desde el gestor de fotos → actualiza la card SIN recargar.
  // Memoizado (estable) para no recrear el efecto de carga del PropertyPhotosManager.
  const handleCoverChange = useCallback((pid: string, url: string | null) => {
    setCoverUrls((prev) => {
      if (url) return { ...prev, [pid]: url }
      if (!(pid in prev)) return prev
      const next = { ...prev }
      delete next[pid]
      return next
    })
  }, [])

  // Nº de documentos de un trámite cambiado desde su drawer → actualiza el indicador sin recargar.
  const handleDocCountChange = useCallback((caseId: string, count: number) => {
    setDocCountByCase((prev) => ({ ...prev, [caseId]: count }))
  }, [])

  // Control interno de comisiones: revertir a pendiente (borra importe y fecha de cobro).
  async function markCommissionPending(opp: OpportunityRow) {
    setOpportunities((prev) => prev.map((o) => (o.id === opp.id
      ? { ...o, commission_status: 'pendiente', commission_paid_at: null, commission_paid_amount: null }
      : o)))
    if (isDemo()) { toast.info('Modo demo: cambio en pantalla (no se guarda).'); return }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    const ok = await updateOpportunity(workspaceId, opp.id, { commissionStatus: 'pendiente', commissionPaidAt: null, commissionPaidAmount: null })
    if (!ok) { toast.error('No se pudo actualizar la comisión.'); void loadData(); return }
    toast.success('Comisión marcada como pendiente')
  }

  // Abre el modal "Registrar cobro" con la comisión prevista y la fecha de hoy por defecto.
  function openCollect(opp: OpportunityRow) {
    setCollectOpp(opp)
    setCollectDate(new Date().toISOString().slice(0, 10))
    setCollectAmount(String(commissionOf(opp) ?? ''))
    setCollectNote(typeof opp.metadata?.commission_note === 'string' ? opp.metadata.commission_note : '')
  }

  // Confirma el cobro: marca cobrada + fecha + importe real (opcional) + nota (opcional).
  // El importe real y la nota se guardan como dato interno (NO es factura ni contabilidad).
  async function submitCommissionCollection() {
    const opp = collectOpp
    if (!opp) return
    const parsed = Number(collectAmount.replace(',', '.'))
    const amount = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : (commissionOf(opp) ?? 0)
    const note = collectNote.trim()
    const nextMeta: Record<string, unknown> = { ...(opp.metadata ?? {}) }
    if (note) nextMeta.commission_note = note
    else delete nextMeta.commission_note
    // Fecha elegida (a mediodía local para evitar desfase de zona horaria) o ahora si quedó vacía.
    const nowIso = collectDate ? new Date(`${collectDate}T12:00:00`).toISOString() : new Date().toISOString()
    setCollectBusy(true)
    setOpportunities((prev) => prev.map((o) => (o.id === opp.id
      ? { ...o, commission_status: 'cobrada', commission_paid_at: nowIso, commission_paid_amount: amount, metadata: nextMeta }
      : o)))
    if (isDemo()) { toast.info('Modo demo: cambio en pantalla (no se guarda).'); setCollectBusy(false); setCollectOpp(null); return }
    if (!workspaceId) { toast.error('Sin workspace activo.'); setCollectBusy(false); return }
    const ok = await updateOpportunity(workspaceId, opp.id, {
      commissionStatus: 'cobrada', commissionPaidAt: nowIso, commissionPaidAmount: amount, metadata: nextMeta,
    })
    setCollectBusy(false)
    if (!ok) { toast.error('No se pudo registrar el cobro.'); void loadData(); return }
    setCollectOpp(null)
    toast.success('Cobro de comisión registrado')
  }

  function isDemo() {
    return typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
  }

  // Operación: si tiene trámites vinculados, se BLOQUEA (la FK es SET NULL → borrar la
  // desvincularía sin avisar). Si no, confirmación y borrado. No toca cliente ni inmueble.
  function requestDeleteOpp(opp: OpportunityRow) {
    const linked = cases.filter((c) => c.opportunity_id === opp.id).length
    if (linked > 0) {
      // No se borra: se guía al usuario a resolver los trámites primero (la FK es SET NULL,
      // borrar la operación los desvincularía en silencio).
      setBlockedOppTarget(opp)
      return
    }
    setDeleteError(null)
    setDeleteOppTarget(opp)
  }

  // "Ver trámites" desde el modal de bloqueo → va a Trámites y resalta los vinculados.
  function viewLinkedTramites() {
    const opp = blockedOppTarget
    if (!opp) return
    setHighlightOpId(opp.id)
    setSubtab('cases')
    setBlockedOppTarget(null)
    toast.info('Revisa los trámites vinculados antes de eliminar la operación.')
  }
  async function confirmDeleteOpp() {
    const target = deleteOppTarget
    if (!target) return
    if (isDemo()) {
      setOpportunities((prev) => prev.filter((o) => o.id !== target.id))
      toast.info('Modo demo: eliminado en pantalla (no se guarda).')
      setDeleteOppTarget(null)
      return
    }
    if (!workspaceId) { setDeleteError('Sin workspace activo.'); return }
    setDeleteBusy(true); setDeleteError(null)
    const ok = await deleteOpportunity(workspaceId, target.id)
    setDeleteBusy(false)
    if (!ok) { setDeleteError('No se pudo eliminar. Comprueba que tienes permisos de administrador.'); return }
    setOpportunities((prev) => prev.filter((o) => o.id !== target.id))
    toast.success('Operación eliminada')
    setDeleteOppTarget(null)
  }

  // Trámite: confirmación (avisa de los documentos), borra primero sus documentos
  // (Storage + metadata, sin huérfanos) y luego el trámite. No toca operación/cliente/inmueble.
  function requestDeleteCase(c: ServiceCaseRow) {
    setDeleteError(null)
    setDeleteCaseTarget(c)
  }
  async function confirmDeleteCase() {
    const target = deleteCaseTarget
    if (!target) return
    if (isDemo()) {
      setCases((prev) => prev.filter((c) => c.id !== target.id))
      toast.info('Modo demo: eliminado en pantalla (no se guarda).')
      setDeleteCaseTarget(null)
      return
    }
    if (!workspaceId) { setDeleteError('Sin workspace activo.'); return }
    setDeleteBusy(true); setDeleteError(null)
    try {
      await deleteEntityFilesFor(workspaceId, 'service_case', target.id)
      const ok = await deleteServiceCase(workspaceId, target.id)
      if (!ok) { setDeleteError('No se pudo eliminar el trámite. Comprueba permisos de administrador.'); setDeleteBusy(false); return }
      setCases((prev) => prev.filter((c) => c.id !== target.id))
      setDocCountByCase((prev) => { const n = { ...prev }; delete n[target.id]; return n })
      toast.success('Trámite eliminado')
      setDeleteCaseTarget(null)
    } catch {
      setDeleteError('No se pudo eliminar el trámite.')
    }
    setDeleteBusy(false)
  }

  // Por defecto inmobiliaria (no 'general'): una inmobiliaria crea operaciones/trámites de
  // real_estate salvo que esté filtrando explícitamente por otra vertical (workspace mixto).
  const defaultVerticalForCreate: VerticalKey = vertical === 'all' ? 'real_estate' : (vertical as VerticalKey)

  // Card de inmueble (premium). Acción principal: abrir la ficha; editar es secundario. Las cards
  // del histórico (vendido/alquilado/archivado) llevan un estilo más apagado y un sello "Histórico".
  const renderPropertyCard = (p: PropertyRow) => {
    const st = PROPERTY_STATUS_META[p.status] ?? { label: cap(p.status), tone: 'bg-gray-50 text-gray-600 border-gray-100' }
    const beds = propNum(p, 'bedrooms', 'rooms')
    const baths = propNum(p, 'bathrooms', 'baths')
    const m2 = propNum(p, 'area_m2', 'm2')
    const specs = [beds != null ? `${beds} hab` : '', baths != null ? `${baths} baños` : '', m2 != null ? `${m2} m²` : ''].filter(Boolean).join(' · ')
    const refRaw = p.reference ?? p.metadata?.reference
    const ref = typeof refRaw === 'string' ? refRaw : ''
    const ops = opsCountByProperty[p.id] ?? 0
    const owner = clientNameOf(p.client_id) || p.owner_name || ''
    const isRent = isRentalProperty(p.operation_type)
    const historical = isClosedProperty(p.status)
    const fichaHref = `/opportunities/properties/${p.id}`
    const statusOpts: { id: string; label: string }[] = [
      { id: 'prospecting', label: 'En preparación' },
      { id: 'listed', label: 'Publicado' },
      { id: 'under_contract', label: 'Reservado' },
      { id: isRent ? 'rented' : 'sold', label: isRent ? 'Alquilado' : 'Vendido' },
      { id: 'archived', label: 'Archivado' },
    ]
    if (!statusOpts.some((o) => o.id === p.status)) {
      statusOpts.unshift({ id: p.status, label: PROPERTY_STATUS_META[p.status]?.label ?? cap(p.status) })
    }
    return (
      <li key={p.id} className={cn(
        'flex flex-col overflow-hidden rounded-2xl border',
        historical
          ? 'border-gray-100 bg-gray-50/50'
          : 'border-gray-100 bg-white shadow-sm shadow-gray-950/[0.03] transition-shadow hover:shadow-md hover:shadow-gray-950/[0.06]',
      )}>
        <Link href={fichaHref} className="block text-left" title="Ver ficha del inmueble">
          {/* Portada real (Storage privado + signed URL) o placeholder elegante. */}
          <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100">
            {coverUrls[p.id]
              ? <img src={coverUrls[p.id]} alt={p.title} className={cn('absolute inset-0 h-full w-full object-cover', historical && 'opacity-90')} />
              : <Home className="h-9 w-9 text-gray-300" />}
            <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
              <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-gray-700 shadow-sm ring-1 ring-black/[0.04]">{propLabel(PROPERTY_OPERATION_LABEL, p.operation_type) || 'Operación'}</span>
              {historical && <span className="rounded-full bg-gray-900/75 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">Histórico</span>}
            </div>
            <span className={cn('absolute right-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold', st.tone)}>{st.label}</span>
          </div>
          <div className="p-3">
            <p className="truncate text-sm font-semibold text-gray-900">{p.title}</p>
            <p className="mt-0.5 truncate text-[11px] text-gray-400">{[ref ? `Ref. ${ref}` : '', propLabel(PROPERTY_TYPE_LABEL, p.property_type)].filter(Boolean).join(' · ') || '—'}</p>
            {specs && <p className="mt-1 truncate text-[11px] text-gray-500">{specs}</p>}
            <p className="mt-1.5 text-base font-bold text-gray-900">{p.price ? `${formatCurrency(p.price, p.currency ?? 'EUR')}${isRent ? '/mes' : ''}` : '—'}</p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-gray-500">
              <MapPin className="h-3 w-3 shrink-0 text-gray-400" />
              {[[p.city, p.area].filter(Boolean).join(', '), owner].filter(Boolean).join(' · ') || 'Sin ubicación'}
            </p>
            {ops > 0
              ? <p className="mt-1.5 text-[11px] font-medium text-indigo-600">{ops} {ops === 1 ? 'operación vinculada' : 'operaciones vinculadas'}</p>
              : <p className="mt-1.5 text-[11px] text-gray-300">Sin operaciones vinculadas</p>}
          </div>
        </Link>
        <div className="mt-auto flex items-center gap-2 border-t border-gray-50 px-3 py-2">
          <select aria-label="Cambiar estado" className={cn(SELECT_CLS, 'flex-1')} value={p.status} onChange={(e) => requestPropertyStatus(p, e.target.value)}>
            {statusOpts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <Link href={fichaHref} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700">
            Ver ficha<ChevronRight className="h-3.5 w-3.5" />
          </Link>
          <button type="button" onClick={() => setEditProp(p)} title="Editar inmueble" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      </li>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Cartera inmobiliaria"
        description="Tus inmuebles, las operaciones comerciales y la documentación asociada."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void loadData()} disabled={loading} title="Refrescar" aria-label="Refrescar" className="px-2">
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
            {(() => {
              // CTA por pestaña: el PRIMARIO es el "crear" de la vista activa; los otros van
              // como secundarios discretos (a la izquierda). "Nuevo inmueble" solo protagoniza
              // en Inmuebles, nunca en Operaciones/Trámites.
              const actions = [
                { key: 'properties', label: 'Nuevo inmueble', onClick: () => setOpenProp(true), show: verticalSupportsProperties },
                { key: 'pipeline', label: 'Nueva operación', onClick: () => setOpenOpp(true), show: true },
                { key: 'cases', label: 'Nuevo trámite', onClick: () => setOpenCase(true), show: true },
              ].filter((a) => a.show)
              const primaryKey = actions.some((a) => a.key === activeSubtab) ? activeSubtab : 'pipeline'
              const ordered = [...actions.filter((a) => a.key !== primaryKey), ...actions.filter((a) => a.key === primaryKey)]
              return ordered.map((a) => (
                <Button key={a.key} variant={a.key === primaryKey ? 'primary' : 'secondary'} size="sm" onClick={a.onClick}>
                  <Plus className="h-3.5 w-3.5" /> {a.label}
                </Button>
              ))
            })()}
          </div>
        }
      />

      {/* Selector de vertical — solo en workspaces mixtos (datos en >1 vertical). Una
          inmobiliaria normal no lo ve: experiencia mínima y sin "Extranjería"/"Servicios". */}
      {showVerticalBar && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-gray-400">Área de negocio:</span>
          <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-gray-100 bg-white p-1 shadow-sm">
            {visibleVerticalTabs.map((tab) => {
              const active = vertical === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setVertical(tab.key)}
                  title={tab.description}
                  className={cn(
                    'rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors',
                    active
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                      : 'text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Subtabs — Operaciones · Trámites · Propiedades (Propiedades se oculta en verticales
          sin inmuebles). Plantillas/Automatizaciones solo en superficie de operador. */}
      <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-gray-100 bg-white p-1 shadow-sm">
        {visibleSubtabs.map((tab) => {
          const Icon = tab.icon
          const active = activeSubtab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => { setSubtab(tab.key); setHighlightOpId(null) }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors',
                active
                  ? 'bg-gray-900 text-white shadow-sm shadow-gray-900/20'
                  : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {loadError && (
        <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {loadError}
        </div>
      )}

      {/* KPI strip — contextual: cartera en la vista Inmuebles; comercial en el resto. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {activeSubtab === 'properties' ? (
          <>
            <KpiCard
              icon={<Building2 className="h-4 w-4 text-indigo-600" />}
              label="Inmuebles activos"
              value={String(activeProperties.length)}
              detail={soldArchivedCount > 0 ? `${visibleProperties.length} gestionados en total` : (activeProperties.length ? 'Disponibles o en gestión' : 'Sin inmuebles aún')}
              title={soldArchivedCount > 0 ? `Total gestionado: ${visibleProperties.length} (${activeProperties.length} activos + ${soldArchivedCount} en histórico)` : undefined}
              tone="border-indigo-100 bg-indigo-50/40"
            />
            <KpiCard
              icon={<Home className="h-4 w-4 text-emerald-600" />}
              label="En comercialización"
              value={String(portfolioListed)}
              detail={portfolioListed ? 'Publicados' : 'Ninguno publicado'}
              tone="border-emerald-100 bg-emerald-50/40"
            />
            <KpiCard
              icon={<Archive className="h-4 w-4 text-gray-500" />}
              label="Histórico"
              value={String(soldArchivedCount)}
              detail={soldArchivedCount ? 'Vendidos / alquilados' : 'Nada cerrado aún'}
              tone="border-gray-200 bg-gray-50/60"
            />
            <KpiCard
              icon={<Sparkles className="h-4 w-4 text-sky-600" />}
              label="Valor de cartera activa"
              value={formatCurrency(portfolioActiveValue)}
              detail="Precio listado activo"
              tone="border-sky-100 bg-sky-50/40"
            />
          </>
        ) : activeSubtab === 'commissions' ? (
          <>
            <KpiCard
              icon={<Coins className="h-4 w-4 text-teal-600" />}
              label="Comisión prevista"
              value={commissionTotals.estimated > 0 ? formatCurrency(commissionTotals.estimated) : '—'}
              detail="Estimación comercial"
              tone="border-teal-100 bg-teal-50/40"
            />
            <KpiCard
              icon={<Target className="h-4 w-4 text-amber-600" />}
              label="Pendiente de cobro"
              value={commissionTotals.pending > 0 ? formatCurrency(commissionTotals.pending) : '—'}
              detail="Por registrar"
              tone="border-amber-100 bg-amber-50/40"
            />
            <KpiCard
              icon={<Check className="h-4 w-4 text-emerald-600" />}
              label="Cobrada"
              value={commissionTotals.collected > 0 ? formatCurrency(commissionTotals.collected) : '—'}
              detail="Registrada"
              tone="border-emerald-100 bg-emerald-50/40"
            />
            <KpiCard
              icon={<FileText className="h-4 w-4 text-indigo-600" />}
              label="Operaciones cerradas"
              value={String(closedCommissionRows.length)}
              detail="Con comisión pactada"
              tone="border-indigo-100 bg-indigo-50/40"
            />
          </>
        ) : (
          <>
            <KpiCard
              icon={<Target className="h-4 w-4 text-indigo-600" />}
              label="Operaciones abiertas"
              value={String(openOpportunities.length)}
              detail={visibleOpportunities.length ? `${visibleOpportunities.length} en total` : 'Sin operaciones aún'}
              tone="border-indigo-100 bg-indigo-50/40"
            />
            <KpiCard
              icon={<Sparkles className="h-4 w-4 text-emerald-600" />}
              label="Valor potencial"
              value={formatCurrency(openValue)}
              detail={openOpportunities.length ? 'En operaciones abiertas' : 'Sin valor en seguimiento'}
              tone="border-emerald-100 bg-emerald-50/40"
            />
            <KpiCard
              icon={<FileText className="h-4 w-4 text-violet-600" />}
              label="Trámites abiertos"
              value={String(activeCases)}
              detail={cases.length ? `${cases.length} en total` : 'Sin trámites'}
              tone="border-violet-100 bg-violet-50/40"
            />
            <KpiCard
              icon={<Building2 className="h-4 w-4 text-sky-600" />}
              label="Inmuebles activos"
              value={String(activeProperties.length)}
              detail={soldArchivedCount ? `${soldArchivedCount} en histórico` : (activeProperties.length ? 'En cartera' : 'Sin inmuebles aún')}
              tone="border-sky-100 bg-sky-50/40"
            />
          </>
        )}
      </div>

      {/* PIPELINE */}
      {activeSubtab === 'pipeline' && (
        <SectionCard
          title="Operaciones en seguimiento"
          description="Agrupadas por estado comercial."
          action={<Badge variant={visibleOpportunities.length ? 'indigo' : 'default'} dot>{visibleOpportunities.length} operaciones</Badge>}
        >
          {loading ? (
            <div className="space-y-2.5 py-2">
              {[0, 1, 2, 3].map((skeleton) => (
                <div key={skeleton} className="h-12 w-full animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : visibleOpportunities.length === 0 ? (
            <EmptyState
              icon={<Target className="h-6 w-6 text-gray-300" />}
              title={vertical === 'all' ? 'Todavía no hay operaciones' : `Sin operaciones en ${VERTICALS[verticalForPipeline].label.toLowerCase()}`}
              description={vertical === 'all'
                ? 'Cuando un cliente esté interesado en un inmueble, crea una operación para hacer el seguimiento comercial hasta el cierre.'
                : 'No hay operaciones en este filtro. Vuelve a «Todos» o crea una nueva.'}
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => setOpenOpp(true)}>
                    <Plus className="h-3.5 w-3.5" /> Nueva operación
                  </Button>
                  {vertical === 'all' ? (
                    <Link
                      href="/clients"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
                    >
                      Crear cliente
                    </Link>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => setVertical('all')}>Ver todas</Button>
                  )}
                </div>
              }
            />
          ) : (
            <div className="space-y-2">
              {COMM_STATE_ORDER.map((state) => {
                const items = opportunitiesByCommState[state]
                if (items.length === 0) return null
                const stateValue = items.reduce((s, o) => s + (o.value ?? 0), 0)
                const stateLabel = COMM_STATE_OPTIONS.find((o) => o.id === state)?.label ?? state
                return (
                  <div key={state} className="rounded-xl border border-gray-100 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold', COMM_STATE_TONE[state])}>{stateLabel}</span>
                      <span className="shrink-0 text-[10px] font-medium text-gray-500">
                        {items.length} {items.length !== 1 ? 'ops' : 'op'} · {formatCurrency(stateValue)}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {items.map((opp) => (
                        <li key={opp.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50">
                          <button
                            type="button"
                            onClick={() => setEditOpp(opp)}
                            className="min-w-0 flex-1 text-left"
                            title="Abrir detalle / editar"
                          >
                            <p className="truncate text-sm font-medium text-gray-900">{opp.title}</p>
                            <p className="truncate text-[11px] text-gray-500">
                              {[
                                clientNameOf(opp.client_id),
                                propertiesById[opp.property_id ?? String(opp.metadata?.property_id ?? '')]?.title || '',
                              ].filter(Boolean).join(' · ') || 'Sin cliente ni inmueble vinculado'}
                            </p>
                          </button>
                          <div className="flex shrink-0 items-center gap-2">
                            {state === 'won' ? (
                              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">{wonLabel(typeof opp.metadata?.operation_kind === 'string' ? opp.metadata.operation_kind : null)}</span>
                            ) : isRentalOpp(opp) ? (
                              <span className="hidden rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 sm:inline">Alquiler</span>
                            ) : null}
                            <span className="text-xs font-semibold text-gray-700">{formatCurrency(opp.value, opp.currency ?? 'EUR')}</span>
                            <select
                              aria-label="Cambiar estado"
                              className={SELECT_CLS}
                              value={commStateOf(opp.stage)}
                              onChange={(e) => void handleOpportunityStage(opp, stageForCommState(e.target.value as CommState))}
                            >
                              {COMM_STATE_OPTIONS.map((s) => (
                                <option key={s.id} value={s.id}>{s.label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setEditOpp(opp)}
                              title="Editar operación"
                              className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-indigo-50 hover:text-indigo-600"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteOpp(opp)}
                              title="Eliminar operación"
                              className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>
      )}

      {/* CASES */}
      {activeSubtab === 'cases' && (
        <SectionCard
          title="Trámites"
          description="Gestiones y documentación asociadas a clientes, inmuebles u operaciones."
          action={<Badge variant={visibleCases.length ? 'indigo' : 'default'} dot>{visibleCases.length} {visibleCases.length === 1 ? 'trámite' : 'trámites'}</Badge>}
        >
          {highlightOpId && (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-800">
              <span className="truncate">Trámites vinculados a «{opportunitiesById[highlightOpId]?.title ?? 'la operación'}».</span>
              <button type="button" onClick={() => setHighlightOpId(null)} className="shrink-0 font-medium text-indigo-600 hover:text-indigo-700">Ver todos</button>
            </div>
          )}
          {loading ? (
            <div className="space-y-2.5 py-2">
              {[0, 1, 2, 3].map((skeleton) => (
                <div key={skeleton} className="h-12 w-full animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : visibleCases.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-6 w-6 text-gray-300" />}
              title="Sin trámites abiertos"
              description={vertical === 'all'
                ? 'Aquí aparecerán gestiones como documentación, contrato, tasación o financiación.'
                : 'No hay trámites en este filtro. Vuelve a «Todos» o crea uno nuevo.'}
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => setOpenCase(true)}>
                    <Plus className="h-3.5 w-3.5" /> Nuevo trámite
                  </Button>
                  {vertical !== 'all' && (
                    <Button variant="secondary" size="sm" onClick={() => setVertical('all')}>Ver todos</Button>
                  )}
                </div>
              }
            />
          ) : (
            <ul className="space-y-2">
              {visibleCases.map((c) => (
                <li key={c.id} className={cn('rounded-xl border bg-white p-3 transition-shadow', highlightOpId && c.opportunity_id === highlightOpId ? 'border-indigo-300 ring-2 ring-indigo-200' : 'border-gray-100')}>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setEditCase(c)}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium text-gray-900 hover:text-indigo-700"
                      title="Editar trámite"
                    >
                      {c.title}
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        aria-label="Cambiar estado"
                        className={SELECT_CLS}
                        value={c.status}
                        onChange={(e) => void handleCaseStatus(c, e.target.value)}
                      >
                        {(SERVICE_CASE_STATUS_OPTIONS.some((s) => s.id === c.status)
                          ? SERVICE_CASE_STATUS_OPTIONS
                          : [...SERVICE_CASE_STATUS_OPTIONS, { id: c.status, label: serviceCaseStatusLabel(c.status) }]
                        ).map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setEditCase(c)}
                        title="Editar trámite"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDeleteCase(c)}
                        title="Eliminar trámite"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    {[
                      clientNameOf(c.client_id),
                      (c.opportunity_id ? opportunitiesById[c.opportunity_id]?.title : '') || '',
                      c.case_type,
                      c.priority !== 'normal' ? `prioridad ${c.priority}` : '',
                      c.due_date ? `vence ${formatDate(c.due_date)}` : '',
                    ].filter(Boolean).join(' · ')}
                  </p>
                  <div className="mt-1.5">
                    {(docCountByCase[c.id] ?? 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => setDocsCase(c)}
                        title="Ver y gestionar documentos del trámite"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                      >
                        <FileText className="h-3.5 w-3.5" /> Ver documentos ({docCountByCase[c.id]})
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDocsCase(c)}
                        title="Añadir un documento al trámite"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50/40 hover:text-indigo-600"
                      >
                        <Plus className="h-3.5 w-3.5" /> Añadir documento
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {/* INMUEBLES — vista principal de la cartera (cards premium) */}
      {activeSubtab === 'properties' && (
        <SectionCard
          title="Inmuebles"
          description={propView === 'history'
            ? 'Histórico: vendidos, alquilados o archivados.'
            : propView === 'all'
              ? 'Cartera activa e histórico.'
              : 'Cartera activa: inmuebles disponibles o en gestión.'}
          action={
            <div className="flex items-center gap-2">
              {soldArchivedCount > 0 && (
                <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-[11px] font-medium">
                  {([
                    ['active', 'Activos'],
                    ['history', `Histórico (${soldArchivedCount})`],
                    ['all', 'Todos'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPropView(key)}
                      className={cn('rounded-md px-2.5 py-1 transition-colors', propView === key ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-black/[0.04]' : 'text-gray-500 hover:text-gray-700')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <Badge variant={shownProperties.length ? 'indigo' : 'default'} dot>{shownProperties.length} {shownProperties.length === 1 ? 'inmueble' : 'inmuebles'}</Badge>
            </div>
          }
        >
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((s) => <div key={s} className="h-56 w-full animate-pulse rounded-2xl bg-slate-100" />)}
            </div>
          ) : shownProperties.length === 0 ? (
            visibleProperties.length > 0 ? (
              <EmptyState
                icon={<Building2 className="h-6 w-6 text-gray-300" />}
                title={propView === 'history' ? 'Sin inmuebles en histórico' : 'No hay inmuebles activos'}
                description={propView === 'history'
                  ? 'Aquí aparecerán los inmuebles vendidos o alquilados. Todavía no has cerrado ninguno.'
                  : 'Toda tu cartera está cerrada. Cambia a «Histórico» para ver los vendidos y alquilados, o registra un inmueble nuevo.'}
                action={<Button variant="primary" size="sm" onClick={() => setOpenProp(true)}><Plus className="h-3.5 w-3.5" /> Nuevo inmueble</Button>}
              />
            ) : (
              <EmptyState
                icon={<Building2 className="h-6 w-6 text-gray-300" />}
                title="Todavía no tienes inmuebles en cartera"
                description="Empieza registrando una vivienda, local o terreno. Después podrás vincular clientes, visitas, operaciones y documentación."
                action={
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button variant="primary" size="sm" onClick={() => setOpenProp(true)}>
                      <Plus className="h-3.5 w-3.5" /> Nuevo inmueble
                    </Button>
                    <Link href="/clients" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
                      Crear cliente
                    </Link>
                  </div>
                }
              />
            )
          ) : propView === 'all' ? (
            <div className="space-y-5">
              {activeSorted.length > 0 && (
                <section>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Cartera activa · {activeSorted.length}</p>
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{activeSorted.map(renderPropertyCard)}</ul>
                </section>
              )}
              {historySorted.length > 0 && (
                <section>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Histórico · {historySorted.length}</p>
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{historySorted.map(renderPropertyCard)}</ul>
                </section>
              )}
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shownProperties.map(renderPropertyCard)}
            </ul>
          )}
        </SectionCard>
      )}

      {/* COMISIONES — control interno (no facturación fiscal) */}
      {activeSubtab === 'commissions' && (
        <SectionCard
          title="Comisiones"
          description="Control interno de comisiones comerciales."
          action={
            <div className="flex items-center gap-3">
              {(openCommissionCount > 0 || showOpenCommissions) && (
                <button type="button" onClick={() => setShowOpenCommissions((v) => !v)} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700">
                  {showOpenCommissions ? 'Ver solo cerradas' : `Incluir abiertas (${openCommissionCount})`}
                </button>
              )}
              <Badge variant={commissionRows.length ? 'indigo' : 'default'} dot>{commissionRows.length} {commissionRows.length === 1 ? 'operación' : 'operaciones'}</Badge>
            </div>
          }
        >
          {loading ? (
            <div className="space-y-2.5 py-2">{[0, 1, 2].map((s) => <div key={s} className="h-12 w-full animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : commissionRows.length === 0 ? (
            <EmptyState
              icon={<Coins className="h-6 w-6 text-gray-300" />}
              title={showOpenCommissions ? 'Sin comisiones que controlar' : 'Aún no hay operaciones cerradas con comisión'}
              description={
                showOpenCommissions
                  ? 'Añade una «comisión pactada (%)» a tus operaciones para ver aquí la comisión prevista y su estado de cobro.'
                  : 'Cuando marques una operación como Vendida o Alquilada con comisión pactada, aparecerá aquí para registrar el cobro. Usa «Incluir abiertas» para anticipar las que siguen en gestión.'
              }
            />
          ) : (
            <ul className="space-y-2">
              {commissionRows.map((o) => {
                const est = commissionOf(o) ?? 0
                const paid = o.commission_status === 'cobrada'
                const propTitle = o.property_id ? propertiesById[o.property_id]?.title : ''
                const kind = typeof o.metadata?.operation_kind === 'string' ? o.metadata.operation_kind : ''
                const kindLabel = kind ? (PROPERTY_OPERATION_LABEL[kind] ?? cap(kind)) : ''
                const isClosed = commStateOf(o.stage) === 'won'
                const realAmount = paid ? (o.commission_paid_amount ?? est) : null
                const note = typeof o.metadata?.commission_note === 'string' ? o.metadata.commission_note : ''
                return (
                  <li key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-3">
                    <button type="button" onClick={() => setEditOpp(o)} className="min-w-0 flex-1 text-left" title="Abrir operación">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="truncate text-sm font-medium text-gray-900">{o.title}</p>
                        {!isClosed && <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-600">En gestión</span>}
                      </div>
                      <p className="truncate text-[11px] text-gray-500">{[clientNameOf(o.client_id), propTitle, kindLabel, commissionBasisLabel(o)].filter(Boolean).join(' · ')}</p>
                      {paid && note && <p className="truncate text-[10px] text-gray-400">Nota: {note}</p>}
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">{formatCurrency(paid ? (realAmount ?? est) : est)}</p>
                        <p className="text-[10px] text-gray-400">{paid ? (realAmount != null && realAmount !== est ? `Prevista ${formatCurrency(est)}` : 'Comisión cobrada') : 'Comisión prevista'}</p>
                      </div>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', paid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{paid ? 'Cobrada' : 'Pendiente'}</span>
                      {paid ? (
                        <button type="button" onClick={() => void markCommissionPending(o)} title="Volver a marcar la comisión como pendiente" className="inline-flex h-7 items-center rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50">Marcar pendiente</button>
                      ) : (
                        <button type="button" onClick={() => openCollect(o)} title="Registrar el cobro de la comisión" className="inline-flex h-7 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100">Registrar cobro</button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-snug text-gray-400">
            Las comisiones son un control interno. La facturación fiscal, gastos e impuestos se gestionarán en el módulo económico.
          </p>
        </SectionCard>
      )}

      {/* TEMPLATES */}
      {activeSubtab === 'templates' && (
        <WorkspaceTemplatesPanel workspaceId={workspaceId} vertical={vertical === 'all' ? 'all' : (vertical as VerticalKey)} />
      )}

      {/* AUTOMATIONS — only when the operator surface is on */}
      {activeSubtab === 'automations' && featureFlags.nowlabsInternal && (
        <SectionCard
          title="Automatizaciones preparadas"
          description="Catálogo listo. Se ejecutarán cuando conectes n8n + WhatsApp/Instagram real."
          action={<Badge variant="warning" dot>requiere n8n</Badge>}
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {automationTemplates.map((auto) => (
              <li key={auto.id} className="rounded-xl border border-gray-100 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{auto.name}</p>
                  <span className="rounded-full border border-amber-100 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Preparada</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-500">{auto.description}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {auto.requires.map((req) => (
                    <span key={req} className="rounded-full border border-gray-100 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">{req}</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Create drawers */}
      <NewOpportunityDrawer
        open={openOpp}
        onClose={() => setOpenOpp(false)}
        workspaceId={workspaceId}
        defaultVertical={defaultVerticalForCreate}
        properties={properties}
        showVerticalSelect={showVerticalBar}
        onCreated={() => void loadData()}
      />
      <NewServiceCaseDrawer
        open={openCase}
        onClose={() => setOpenCase(false)}
        workspaceId={workspaceId}
        defaultVertical={defaultVerticalForCreate}
        opportunities={opportunities}
        properties={properties}
        showVerticalSelect={showVerticalBar}
        onCreated={() => void loadData()}
      />
      <NewPropertyDrawer
        open={openProp}
        onClose={() => setOpenProp(false)}
        workspaceId={workspaceId}
        onCreated={() => void loadData()}
      />

      {/* Edit drawers — keyed remount per entity from inside the wrappers. */}
      <EditOpportunityDrawer
        open={!!editOpp}
        onClose={() => setEditOpp(null)}
        workspaceId={workspaceId}
        opportunity={editOpp}
        showVerticalSelect={showVerticalBar}
        properties={properties}
        onUpdated={(row) => setOpportunities((prev) => prev.map((o) => (o.id === row.id ? row : o)))}
      />
      <EditServiceCaseDrawer
        open={!!editCase}
        onClose={() => setEditCase(null)}
        workspaceId={workspaceId}
        serviceCase={editCase}
        showVerticalSelect={showVerticalBar}
        onUpdated={(row) => setCases((prev) => prev.map((c) => (c.id === row.id ? row : c)))}
        onDocCountChange={handleDocCountChange}
      />
      <EditPropertyDrawer
        open={!!editProp}
        onClose={() => setEditProp(null)}
        workspaceId={workspaceId}
        property={editProp}
        onUpdated={(row) => setProperties((prev) => prev.map((p) => (p.id === row.id ? row : p)))}
        onCoverChange={handleCoverChange}
      />

      {/* Cierre comercial (P6.11) — marca inmueble vendido/alquilado, sin borrar */}
      <ConfirmDialog
        open={!!closeOpp}
        title={closeOpp && (typeof closeOpp.metadata?.operation_kind === 'string' ? closeOpp.metadata.operation_kind : '') === 'alquiler'
          ? '¿Marcar la operación como alquilada?'
          : '¿Marcar la operación como vendida?'}
        description={closeOpp
          ? (() => {
              const kind = typeof closeOpp.metadata?.operation_kind === 'string' ? closeOpp.metadata.operation_kind : ''
              const opLabel = kind === 'alquiler' ? 'alquilada' : 'vendida'
              const propAction = kind === 'alquiler' ? 'alquilado' : 'vendido'
              const prop = closeOpp.property_id ? propertiesById[closeOpp.property_id]?.title : ''
              return `La operación quedará registrada como ${opLabel} y el inmueble${prop ? ` «${prop}»` : ''} se marcará como ${propAction} y saldrá de la cartera activa. No se elimina nada: queda en el histórico (comisión, documentos y trámites se conservan).`
            })()
          : ''}
        confirmLabel={closeOpp && (typeof closeOpp.metadata?.operation_kind === 'string' ? closeOpp.metadata.operation_kind : '') === 'alquiler'
          ? 'Marcar alquilada'
          : 'Marcar vendida'}
        cancelLabel="Cancelar"
        onConfirm={() => void confirmCloseOpp()}
        onCancel={() => setCloseOpp(null)}
      />

      {/* Inmueble → histórico (vendido/alquilado/archivado) desde la card: confirma, no borra nada */}
      <ConfirmDialog
        open={!!propStatusChange}
        title={propStatusChange?.nextStatus === 'archived'
          ? '¿Archivar inmueble?'
          : propStatusChange?.nextStatus === 'rented'
            ? '¿Marcar el inmueble como alquilado?'
            : '¿Marcar el inmueble como vendido?'}
        description={propStatusChange
          ? `«${propStatusChange.property.title}» saldrá de la cartera activa y quedará en el histórico. No se elimina nada: se conservan fotos, documentos, operaciones y trámites.`
          : ''}
        confirmLabel={propStatusChange?.nextStatus === 'archived' ? 'Archivar' : propStatusChange?.nextStatus === 'rented' ? 'Marcar alquilado' : 'Marcar vendido'}
        cancelLabel="Cancelar"
        onConfirm={() => { if (propStatusChange) { void handlePropertyStatus(propStatusChange.property, propStatusChange.nextStatus); setPropStatusChange(null) } }}
        onCancel={() => setPropStatusChange(null)}
      />

      {/* Borrado seguro (P6.8/P6.9) */}
      <ConfirmDialog
        open={!!blockedOppTarget}
        title="Esta operación tiene trámites vinculados"
        description={blockedOppTarget
          ? (() => {
              const linked = cases.filter((c) => c.opportunity_id === blockedOppTarget.id)
              const names = linked.slice(0, 3).map((c) => c.title).join(', ')
              const more = linked.length > 3 ? ` y ${linked.length - 3} más` : ''
              return `Para no perder documentación ni dejar gestiones sueltas, elimina o reasigna sus ${linked.length} trámite${linked.length === 1 ? '' : 's'} antes de borrar «${blockedOppTarget.title}». Vinculados: ${names}${more}.`
            })()
          : ''}
        confirmLabel="Ver trámites"
        cancelLabel="Cancelar"
        onConfirm={viewLinkedTramites}
        onCancel={() => setBlockedOppTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteOppTarget}
        title="Eliminar operación"
        description={deleteOppTarget ? `¿Eliminar «${deleteOppTarget.title}»? El cliente y el inmueble vinculados no se eliminan. Esta acción no se puede deshacer.` : ''}
        confirmLabel="Eliminar"
        loadingLabel="Eliminando…"
        destructive
        loading={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDeleteOpp()}
        onCancel={() => { if (!deleteBusy) { setDeleteOppTarget(null); setDeleteError(null) } }}
      />
      <ConfirmDialog
        open={!!deleteCaseTarget}
        title="Eliminar trámite"
        description={deleteCaseTarget
          ? `¿Eliminar «${deleteCaseTarget.title}»?${(docCountByCase[deleteCaseTarget.id] ?? 0) > 0 ? ` Se eliminarán también sus ${docCountByCase[deleteCaseTarget.id]} documento${docCountByCase[deleteCaseTarget.id] === 1 ? '' : 's'}.` : ''} Esta acción no se puede deshacer.`
          : ''}
        confirmLabel="Eliminar"
        loadingLabel="Eliminando…"
        destructive
        loading={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDeleteCase()}
        onCancel={() => { if (!deleteBusy) { setDeleteCaseTarget(null); setDeleteError(null) } }}
      />

      {/* Documentos del trámite — acceso directo desde la fila (sin abrir el drawer de edición).
          Reutiliza EntityDocumentsManager (Storage + RLS, sin service_role); el contador de la
          fila se actualiza al instante vía handleDocCountChange. */}
      {docsCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-gray-950/40 backdrop-blur-[1px]" onClick={() => setDocsCase(null)} />
          <div className="relative w-full max-w-lg rounded-2xl border border-gray-100 bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-gray-900">{docsCase.title}</h3>
                <p className="truncate text-[12px] text-gray-500">Documentos del trámite</p>
              </div>
              <button type="button" onClick={() => setDocsCase(null)} aria-label="Cerrar" className="shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"><X className="h-4 w-4" /></button>
            </div>
            <EntityDocumentsManager
              workspaceId={workspaceId}
              entityType="service_case"
              entityId={docsCase.id}
              onCountChange={handleDocCountChange}
              title="Documentos del trámite"
              description="Sube contratos, nota simple, tasaciones o justificantes vinculados a este trámite."
            />
          </div>
        </div>
      )}

      {/* Registrar cobro de comisión — importe real opcional + nota opcional (control interno) */}
      {collectOpp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-gray-950/40 backdrop-blur-[1px]" onClick={() => { if (!collectBusy) setCollectOpp(null) }} />
          <div className="relative w-full max-w-md rounded-2xl border border-gray-100 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Registrar cobro de comisión</h3>
            <p className="mt-0.5 text-[12px] text-gray-500">Guarda el cobro interno de esta comisión. No genera factura.</p>
            <div className="mt-3 truncate rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
              <span className="font-medium text-gray-800">{collectOpp.title}</span> · comisión prevista {formatCurrency(commissionOf(collectOpp) ?? 0)}
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-gray-600">Fecha de cobro</label>
                <input
                  type="date"
                  className={SELECT_CLS}
                  value={collectDate}
                  onChange={(e) => setCollectDate(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-gray-600">Importe cobrado (€) <span className="font-normal text-gray-400">· opcional</span></label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  className={SELECT_CLS}
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  placeholder={String(commissionOf(collectOpp) ?? 0)}
                />
                <p className="mt-1 text-[10px] text-gray-400">Déjalo como está para usar la comisión prevista, o ajústalo al importe real cobrado.</p>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-gray-600">Nota <span className="font-normal text-gray-400">· opcional</span></label>
                <textarea
                  rows={2}
                  className={cn(SELECT_CLS, 'h-auto resize-none py-2')}
                  value={collectNote}
                  onChange={(e) => setCollectNote(e.target.value)}
                  placeholder="Ej.: cobrado por transferencia."
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={collectBusy} onClick={() => setCollectOpp(null)} className="inline-flex h-9 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" disabled={collectBusy} onClick={() => void submitCommissionCollection()} className="inline-flex h-9 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"><Check className="h-4 w-4" /> {collectBusy ? 'Guardando…' : 'Registrar cobro'}</button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

function KpiCard(props: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string; title?: string }) {
  return (
    <div title={props.title} className={cn('rounded-xl border p-4 shadow-sm shadow-gray-950/[0.02]', props.tone)}>
      <div className="flex items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-black/[0.04]">{props.icon}</div>
        <span className="text-[10px] font-semibold text-gray-500">{props.label}</span>
      </div>
      <p className="mt-2 text-xl font-bold text-gray-900">{props.value}</p>
      <p className="mt-0.5 text-[11px] text-gray-500">{props.detail}</p>
    </div>
  )
}
