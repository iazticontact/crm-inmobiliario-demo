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
  MapPin,
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
  PROPERTY_STATUS_OPTIONS_PUBLIC,
} from '@/components/VerticalForms'
import {
  EditOpportunityDrawer,
  EditServiceCaseDrawer,
  EditPropertyDrawer,
} from '@/components/VerticalEditForms'
import { WorkspaceTemplatesPanel } from '@/components/WorkspaceTemplatesPanel'
import { cn } from '@/lib/utils'
import { DEMO_MODE_KEY, useCurrentUser } from '@/lib/current-user'
import { featureFlags } from '@/lib/feature-flags'
import { demoOpportunities, demoServiceCases, demoProperties } from '@/lib/demo/demo-real-estate'
import { clients as demoClients } from '@/lib/mock-data'
import { getClients } from '@/lib/supabase-queries'
import { coverUrlsForProperties } from '@/lib/entity-files'
import {
  VERTICALS,
  getPipelineForVertical,
  getAutomationTemplatesForVertical,
  AUTOMATION_TEMPLATES,
  type VerticalKey,
  type PipelineStage,
} from '@/lib/demo/vertical-templates'
import {
  listOpportunities,
  listServiceCases,
  listProperties,
  updateOpportunityStage,
  updateServiceCaseStatus,
  updatePropertyStatus,
  type OpportunityRow,
  type ServiceCaseRow,
  type PropertyRow,
} from '@/lib/vertical-queries'

type VerticalTab = 'all' | VerticalKey
type Subtab = 'pipeline' | 'cases' | 'properties' | 'templates' | 'automations'

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

// Cierre estimado dentro de los próximos 30 días (y no pasado). Usa `new Date()` para
// la fecha actual (patrón aceptado por el linter de purity en este repo).
function closesSoon(value: string | null): boolean {
  if (!value) return false
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return false
  const diffDays = (t - new Date().getTime()) / 86_400_000
  return diffDays >= 0 && diffDays <= 30
}

// Vencimiento (trámite) dentro de los próximos 7 días.
function dueSoon(value: string | null): boolean {
  if (!value) return false
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return false
  const diffDays = (t - new Date().getTime()) / 86_400_000
  return diffDays >= 0 && diffDays <= 7
}

// Etiquetas inmobiliarias (es-ES) con fallback al valor crudo capitalizado.
const PROPERTY_TYPE_LABEL: Record<string, string> = {
  piso: 'Piso', atico: 'Ático', duplex: 'Dúplex', chalet: 'Chalet', adosado: 'Adosado',
  casa: 'Casa', local: 'Local', oficina: 'Oficina', nave: 'Nave', terreno: 'Terreno',
  garaje: 'Garaje', trastero: 'Trastero', edificio: 'Edificio',
}
const PROPERTY_OPERATION_LABEL: Record<string, string> = {
  venta: 'Venta', alquiler: 'Alquiler', captacion: 'Captación', inversion: 'Inversión',
  traspaso: 'Traspaso', alquiler_opcion_compra: 'Alquiler con opción a compra',
}
// Estado del inmueble → etiqueta + tono de badge.
const PROPERTY_STATUS_META: Record<string, { label: string; tone: string }> = {
  prospecting:    { label: 'Captación',  tone: 'bg-gray-50 text-gray-600 border-gray-100' },
  listed:         { label: 'Publicado',  tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  available:      { label: 'Disponible', tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  under_contract: { label: 'Reservado',  tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  reserved:       { label: 'Reservado',  tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  sold:           { label: 'Vendido',    tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  rented:         { label: 'Alquilado',  tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  archived:       { label: 'Archivado',  tone: 'bg-gray-50 text-gray-400 border-gray-100' },
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
function propLabel(map: Record<string, string>, value: string | null): string {
  if (!value) return ''
  return map[value] ?? cap(value)
}
// Lee un numérico del inmueble desde columna real o, en su defecto, de metadata (datos demo).
function propNum(p: PropertyRow, col: 'bedrooms' | 'bathrooms' | 'area_m2', metaKey: string): number | null {
  const direct = p[col]
  if (typeof direct === 'number') return direct
  const meta = p.metadata?.[metaKey]
  return typeof meta === 'number' ? meta : null
}

export default function OpportunitiesPage() {
  const { currentUser, isLoading: userLoading } = useCurrentUser()

  const [vertical, setVertical] = useState<VerticalTab>('all')
  const [subtab, setSubtab] = useState<Subtab>('properties')
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  const [cases, setCases] = useState<ServiceCaseRow[]>([])
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [clientNames, setClientNames] = useState<Record<string, string>>({})
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})
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
      setLoadError('')
      setLoading(false)
      return
    }
    if (!workspaceId) {
      setOpportunities([]); setCases([]); setProperties([]); setClientNames({}); setCoverUrls({})
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

  // Vertical para elegir el pipeline cuando el filtro es "Todos": si solo hay una vertical
  // con datos (caso normal inmobiliaria) usa su pipeline; por defecto inmobiliaria — NUNCA
  // 'general', que escondería etapas reales (visita, oferta, negociación…).
  const verticalForPipeline: VerticalKey = useMemo(() => {
    if (vertical !== 'all') return vertical as VerticalKey
    const set = new Set<string>()
    for (const o of opportunities) if (o.vertical) set.add(String(o.vertical))
    return set.size === 1 ? (Array.from(set)[0] as VerticalKey) : 'real_estate'
  }, [vertical, opportunities])

  // Etapas a renderizar = pipeline canónico + cualquier etapa presente en los datos que no
  // esté en él (así NINGUNA operación queda oculta), etiquetada desde su propio pipeline.
  const renderStages = useMemo(() => {
    const base = getPipelineForVertical(verticalForPipeline)
    const known = new Set(base.map((s) => s.id))
    const extras: PipelineStage[] = []
    for (const o of visibleOpportunities) {
      if (o.stage && !known.has(o.stage)) {
        known.add(o.stage)
        const own = getPipelineForVertical((o.vertical as VerticalKey) ?? 'general').find((s) => s.id === o.stage)
        extras.push(own ?? { id: o.stage, label: o.stage, description: '', defaultProbability: 0, tone: 'bg-gray-50 text-gray-700 border-gray-100' })
      }
    }
    return [...base, ...extras]
  }, [verticalForPipeline, visibleOpportunities])

  const opportunitiesByStage = useMemo(() => {
    const out: Record<string, OpportunityRow[]> = {}
    for (const stage of renderStages) out[stage.id] = []
    for (const opp of visibleOpportunities) {
      if (!out[opp.stage]) out[opp.stage] = []
      out[opp.stage].push(opp)
    }
    return out
  }, [visibleOpportunities, renderStages])

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
  const casesDueSoon = visibleCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved' && dueSoon(c.due_date)).length
  const clientNameOf = (id: string | null) => (id ? clientNames[id] ?? '' : '')

  // Mapas para enlazar entidades (vínculos reales ya cargados, sin N+1).
  const propertiesById = useMemo(() => Object.fromEntries(properties.map((p) => [p.id, p])), [properties])
  const opportunitiesById = useMemo(() => Object.fromEntries(opportunities.map((o) => [o.id, o])), [opportunities])
  // Nº de operaciones por inmueble (vía metadata.property_id). Honesto: 0 si no hay enlace.
  const opsCountByProperty = useMemo(() => {
    const m: Record<string, number> = {}
    for (const o of opportunities) {
      const pid = o.property_id ?? (typeof o.metadata?.property_id === 'string' ? o.metadata.property_id : null)
      if (typeof pid === 'string') m[pid] = (m[pid] ?? 0) + 1
    }
    return m
  }, [opportunities])

  // KPIs de cartera (vista Inmuebles). El "valor de cartera" es la suma de precios listados
  // (no facturación ni ingresos): excluye vendidos/archivados.
  const portfolioListed = visibleProperties.filter((p) => p.status === 'listed' || p.status === 'available').length
  const portfolioReserved = visibleProperties.filter((p) => p.status === 'under_contract' || p.status === 'reserved').length
  const portfolioValue = visibleProperties
    .filter((p) => p.status !== 'sold' && p.status !== 'archived')
    .reduce((s, p) => s + (p.price ?? 0), 0)

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
    if (nextStage === opp.stage) return
    setOpportunities((prev) => prev.map((o) => (o.id === opp.id ? { ...o, stage: nextStage } : o)))
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo: cambio aplicado en pantalla (no se guarda).')
      return
    }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    const ok = await updateOpportunityStage(workspaceId, opp.id, nextStage)
    if (!ok) {
      toast.error('No se pudo cambiar la etapa.')
      void loadData()
      return
    }
    toast.success('Operación actualizada')
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

  const defaultVerticalForCreate: VerticalKey = vertical === 'all' ? 'general' : (vertical as VerticalKey)

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
              onClick={() => setSubtab(tab.key)}
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
              label="Inmuebles en cartera"
              value={String(visibleProperties.length)}
              detail={visibleProperties.length ? 'Activos gestionados' : 'Sin inmuebles aún'}
              tone="border-indigo-100 bg-indigo-50/40"
            />
            <KpiCard
              icon={<Home className="h-4 w-4 text-emerald-600" />}
              label="En comercialización"
              value={String(portfolioListed)}
              detail={portfolioListed ? 'Publicados / disponibles' : 'Ninguno publicado'}
              tone="border-emerald-100 bg-emerald-50/40"
            />
            <KpiCard
              icon={<Target className="h-4 w-4 text-amber-600" />}
              label="Reservados"
              value={String(portfolioReserved)}
              detail={portfolioReserved ? 'Reserva / bajo contrato' : 'Ninguno reservado'}
              tone="border-amber-100 bg-amber-50/40"
            />
            <KpiCard
              icon={<Sparkles className="h-4 w-4 text-sky-600" />}
              label="Valor de cartera"
              value={formatCurrency(portfolioValue)}
              detail="Suma de precios listados"
              tone="border-sky-100 bg-sky-50/40"
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
            {verticalSupportsProperties ? (
              <KpiCard
                icon={<Building2 className="h-4 w-4 text-sky-600" />}
                label="Inmuebles en cartera"
                value={String(visibleProperties.length)}
                detail={visibleProperties.length ? 'En cartera' : 'Sin inmuebles'}
                tone="border-sky-100 bg-sky-50/40"
              />
            ) : (
              <KpiCard
                icon={<FileText className="h-4 w-4 text-amber-600" />}
                label="Vencen pronto"
                value={String(casesDueSoon)}
                detail={casesDueSoon ? 'Trámites en 7 días' : 'Sin vencimientos próximos'}
                tone="border-amber-100 bg-amber-50/40"
              />
            )}
          </>
        )}
      </div>

      {/* PIPELINE */}
      {activeSubtab === 'pipeline' && (
        <SectionCard
          title="Operaciones en seguimiento"
          description="Negocio abierto por etapa: lo que tu inmobiliaria puede cerrar."
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
              {renderStages.map((stage) => {
                const items = opportunitiesByStage[stage.id] ?? []
                if (items.length === 0) return null
                const stageValue = items.reduce((s, o) => s + (o.value ?? 0), 0)
                return (
                  <div key={stage.id} className="rounded-xl border border-gray-100 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold', stage.tone)}>{stage.label}</span>
                        <span className="truncate text-[10px] text-gray-400">{stage.description}</span>
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-gray-500">
                        {items.length} {items.length !== 1 ? 'ops' : 'op'} · {formatCurrency(stageValue)}
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
                                opp.expected_close_date ? `cierre ${formatDate(opp.expected_close_date)}` : '',
                              ].filter(Boolean).join(' · ') || 'Sin cliente ni inmueble vinculado'}
                            </p>
                          </button>
                          <div className="flex shrink-0 items-center gap-2">
                            {closesSoon(opp.expected_close_date) && (
                              <span className="hidden rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 sm:inline">Cierre pronto</span>
                            )}
                            <span className="text-xs font-semibold text-gray-700">{formatCurrency(opp.value, opp.currency ?? 'EUR')}</span>
                            {typeof opp.probability === 'number' && (
                              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{opp.probability}%</span>
                            )}
                            <select
                              aria-label="Cambiar etapa"
                              className={SELECT_CLS}
                              value={opp.stage}
                              onChange={(e) => void handleOpportunityStage(opp, e.target.value)}
                            >
                              {getPipelineForVertical((opp.vertical as VerticalKey) ?? 'general').map((s) => (
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
          description="Gestiones asociadas a clientes u operaciones: documentación, contrato, tasación, financiación…"
          action={<Badge variant={visibleCases.length ? 'indigo' : 'default'} dot>{visibleCases.length} {visibleCases.length === 1 ? 'trámite' : 'trámites'}</Badge>}
        >
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
                <li key={c.id} className="rounded-xl border border-gray-100 bg-white p-3">
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
                        {SERVICE_CASE_STATUS_OPTIONS.map((s) => (
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
          description="Tu cartera de inmuebles: ventas, alquileres y captaciones."
          action={<Badge variant={visibleProperties.length ? 'indigo' : 'default'} dot>{visibleProperties.length} {visibleProperties.length === 1 ? 'inmueble' : 'inmuebles'}</Badge>}
        >
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((s) => <div key={s} className="h-56 w-full animate-pulse rounded-2xl bg-slate-100" />)}
            </div>
          ) : visibleProperties.length === 0 ? (
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
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleProperties.map((p) => {
                const st = PROPERTY_STATUS_META[p.status] ?? { label: cap(p.status), tone: 'bg-gray-50 text-gray-600 border-gray-100' }
                const beds = propNum(p, 'bedrooms', 'rooms')
                const baths = propNum(p, 'bathrooms', 'baths')
                const m2 = propNum(p, 'area_m2', 'm2')
                const specs = [beds != null ? `${beds} hab` : '', baths != null ? `${baths} baños` : '', m2 != null ? `${m2} m²` : ''].filter(Boolean).join(' · ')
                const refRaw = p.reference ?? p.metadata?.reference
                const ref = typeof refRaw === 'string' ? refRaw : ''
                const ops = opsCountByProperty[p.id] ?? 0
                const owner = clientNameOf(p.client_id) || p.owner_name || ''
                const isRent = p.operation_type === 'alquiler' || p.operation_type === 'alquiler_opcion_compra'
                return (
                  <li key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm shadow-gray-950/[0.03]">
                    <button type="button" onClick={() => setEditProp(p)} className="block text-left" title="Ver / editar inmueble">
                      {/* Portada real (Storage privado + signed URL) o placeholder elegante. */}
                      <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100">
                        {coverUrls[p.id]
                          ? <img src={coverUrls[p.id]} alt={p.title} className="absolute inset-0 h-full w-full object-cover" />
                          : <Home className="h-9 w-9 text-gray-300" />}
                        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-gray-700 shadow-sm ring-1 ring-black/[0.04]">{propLabel(PROPERTY_OPERATION_LABEL, p.operation_type) || 'Operación'}</span>
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
                        {ops > 0 && <p className="mt-1 text-[11px] font-medium text-indigo-600">{ops} {ops === 1 ? 'operación vinculada' : 'operaciones vinculadas'}</p>}
                      </div>
                    </button>
                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-gray-50 px-3 py-2">
                      <select aria-label="Cambiar estado" className={SELECT_CLS} value={p.status} onChange={(e) => void handlePropertyStatus(p, e.target.value)}>
                        {PROPERTY_STATUS_OPTIONS_PUBLIC.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      <button type="button" onClick={() => setEditProp(p)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50">
                        <Pencil className="h-3 w-3" /> Editar
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
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
        onCreated={() => void loadData()}
      />
      <NewServiceCaseDrawer
        open={openCase}
        onClose={() => setOpenCase(false)}
        workspaceId={workspaceId}
        defaultVertical={defaultVerticalForCreate === 'general' ? 'immigration' : defaultVerticalForCreate}
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
        onUpdated={(row) => setOpportunities((prev) => prev.map((o) => (o.id === row.id ? row : o)))}
      />
      <EditServiceCaseDrawer
        open={!!editCase}
        onClose={() => setEditCase(null)}
        workspaceId={workspaceId}
        serviceCase={editCase}
        onUpdated={(row) => setCases((prev) => prev.map((c) => (c.id === row.id ? row : c)))}
      />
      <EditPropertyDrawer
        open={!!editProp}
        onClose={() => setEditProp(null)}
        workspaceId={workspaceId}
        property={editProp}
        onUpdated={(row) => setProperties((prev) => prev.map((p) => (p.id === row.id ? row : p)))}
        onCoverChange={handleCoverChange}
      />
    </motion.div>
  )
}

function KpiCard(props: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) {
  return (
    <div className={cn('rounded-xl border p-4 shadow-sm shadow-gray-950/[0.02]', props.tone)}>
      <div className="flex items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-black/[0.04]">{props.icon}</div>
        <span className="text-[10px] font-semibold text-gray-500">{props.label}</span>
      </div>
      <p className="mt-2 text-xl font-bold text-gray-900">{props.value}</p>
      <p className="mt-0.5 text-[11px] text-gray-500">{props.detail}</p>
    </div>
  )
}
