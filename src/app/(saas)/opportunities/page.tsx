'use client'

// /opportunities — Gestión.
//
// Expedientes · Propiedades · Seguimiento (pipeline) · Plantillas.
// La ruta sigue siendo /opportunities para no romper enlaces; el label visual
// pasó a "Gestión" porque la página opera todo lo operativo del workspace.
//
// Lecturas: helpers workspace-scoped en vertical-queries.ts (RLS al fondo).
// Escrituras: drawers laterales en src/components/VerticalForms.tsx — usan los
// mismos helpers que crean (con activity log) las mismas entidades que crea
// el Asistente IA desde el chat. Inline status/stage edit reescribe vía
// updateOpportunityStage / updateServiceCaseStatus / updatePropertyStatus.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Target,
  Building2,
  FileText,
  Loader2,
  RefreshCcw,
  Sparkles,
  Plus,
  PlayCircle,
  Pencil,
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
import {
  VERTICALS,
  getPipelineForVertical,
  getAutomationTemplatesForVertical,
  AUTOMATION_TEMPLATES,
  CASE_TYPES,
  type VerticalKey,
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
  { key: 'immigration',            label: 'Extranjería',   description: 'Expedientes y trámites de extranjería.' },
  { key: 'professional_services',  label: 'Servicios',     description: 'Asesorías y servicios profesionales recurrentes.' },
]

// The "Automatizaciones" subtab is operator-only — it shows the catalog of
// n8n/Meta workflows. Hide from clients by default and only surface when
// NEXT_PUBLIC_NOWLABS_INTERNAL=true.
//
// Orden visible para asesoría/inmobiliaria: Expedientes y Propiedades primero,
// luego Seguimiento (pipeline comercial) y Plantillas.
const ALL_SUBTABS: Array<{ key: Subtab; label: string; icon: React.ComponentType<{ className?: string }>; internal?: boolean }> = [
  { key: 'cases',        label: 'Expedientes',      icon: FileText },
  { key: 'properties',   label: 'Propiedades',      icon: Building2 },
  { key: 'pipeline',     label: 'Seguimiento',      icon: Target },
  { key: 'templates',    label: 'Plantillas',       icon: Sparkles },
  { key: 'automations',  label: 'Automatizaciones', icon: PlayCircle, internal: true },
]

const SUBTABS = ALL_SUBTABS.filter((tab) => !tab.internal || featureFlags.nowlabsInternal)

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

export default function OpportunitiesPage() {
  const { currentUser, isLoading: userLoading } = useCurrentUser()

  const [vertical, setVertical] = useState<VerticalTab>('all')
  const [subtab, setSubtab] = useState<Subtab>('cases')
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  const [cases, setCases] = useState<ServiceCaseRow[]>([])
  const [properties, setProperties] = useState<PropertyRow[]>([])
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
      setLoadError('')
      setLoading(false)
      return
    }
    if (!workspaceId) {
      setOpportunities([]); setCases([]); setProperties([])
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const [opps, srv, props] = await Promise.all([
        listOpportunities(workspaceId).catch(() => []),
        listServiceCases(workspaceId).catch(() => []),
        listProperties(workspaceId).catch(() => []),
      ])
      setOpportunities(opps)
      setCases(srv)
      setProperties(props)
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

  const verticalForPipeline: VerticalKey = vertical === 'all' ? 'general' : (vertical as VerticalKey)
  const pipeline = getPipelineForVertical(verticalForPipeline)

  const opportunitiesByStage = useMemo(() => {
    const out: Record<string, OpportunityRow[]> = {}
    for (const stage of pipeline) out[stage.id] = []
    for (const opp of visibleOpportunities) {
      if (!out[opp.stage]) out[opp.stage] = []
      out[opp.stage].push(opp)
    }
    return out
  }, [visibleOpportunities, pipeline])

  const automationTemplates = useMemo(() => {
    if (vertical === 'all') return AUTOMATION_TEMPLATES
    return getAutomationTemplatesForVertical(vertical as VerticalKey)
  }, [vertical])

  const totalPipelineValue = visibleOpportunities.reduce((sum, o) => sum + (o.value ?? 0), 0)
  const activeCases = visibleCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved').length

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
    toast.success(`Seguimiento → ${nextStage}`)
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
      toast.error('No se pudo cambiar el estado del expediente.')
      void loadData()
      return
    }
    toast.success(`Expediente → ${nextStatus}`)
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
      toast.error('No se pudo cambiar el estado de la propiedad.')
      void loadData()
      return
    }
    toast.success(`Propiedad → ${nextStatus}`)
  }

  const defaultVerticalForCreate: VerticalKey = vertical === 'all' ? 'general' : (vertical as VerticalKey)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Gestión"
        description="Expedientes, propiedades, visitas y seguimiento operativo."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void loadData()} disabled={loading}>
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refrescar
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpenProp(true)}>
              <Plus className="h-3.5 w-3.5" /> Nueva propiedad
            </Button>
            <Button variant="primary" size="sm" onClick={() => setOpenCase(true)}>
              <Plus className="h-3.5 w-3.5" /> Nuevo expediente
            </Button>
          </div>
        }
      />

      {/* Vertical tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-gray-100 bg-white p-1 shadow-sm">
        {VERTICAL_TABS.map((tab) => {
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

      {/* Subtabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-gray-100 bg-white p-1 shadow-sm">
        {SUBTABS.map((tab) => {
          const Icon = tab.icon
          const active = subtab === tab.key
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

      {/* KPI strip (always visible) */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          icon={<FileText className="h-4 w-4 text-violet-600" />}
          label="Expedientes activos"
          value={String(activeCases)}
          detail={cases.length ? `${cases.length} en total` : 'Sin expedientes'}
          tone="border-violet-100 bg-violet-50/40"
        />
        <KpiCard
          icon={<Building2 className="h-4 w-4 text-sky-600" />}
          label="Propiedades"
          value={String(visibleProperties.length)}
          detail={visibleProperties.length ? 'En cartera' : (vertical !== 'all' && vertical !== 'real_estate' ? 'Solo en Inmobiliaria' : 'Sin propiedades')}
          tone="border-sky-100 bg-sky-50/40"
        />
        <KpiCard
          icon={<Target className="h-4 w-4 text-indigo-600" />}
          label="Seguimientos"
          value={String(visibleOpportunities.length)}
          detail={visibleOpportunities.length ? `${formatCurrency(totalPipelineValue)} en seguimiento` : 'Sin seguimientos aún'}
          tone="border-indigo-100 bg-indigo-50/40"
        />
      </div>

      {/* PIPELINE */}
      {subtab === 'pipeline' && (
        <SectionCard
          title="Seguimiento comercial"
          description={`Etapas operativas del flujo ${VERTICALS[verticalForPipeline].label.toLowerCase()}.`}
          action={<Badge variant={visibleOpportunities.length ? 'indigo' : 'default'} dot>{visibleOpportunities.length} seguimientos</Badge>}
        >
          {loading ? (
            <div className="flex items-center justify-center py-8 text-xs text-gray-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : visibleOpportunities.length === 0 ? (
            <EmptyState
              icon={<Target className="h-6 w-6 text-gray-300" />}
              title="Sin seguimientos abiertos"
              description={
                vertical === 'all'
                  ? 'Crea un seguimiento comercial para vincular un cliente con una operación o trámite.'
                  : `Sin seguimientos en ${VERTICALS[verticalForPipeline].label.toLowerCase()}.`
              }
              action={
                <Button variant="primary" size="sm" onClick={() => setOpenOpp(true)}>
                  <Plus className="h-3.5 w-3.5" /> Nuevo seguimiento
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {pipeline.map((stage) => {
                const items = opportunitiesByStage[stage.id] ?? []
                if (items.length === 0) return null
                return (
                  <div key={stage.id} className="rounded-xl border border-gray-100 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', stage.tone)}>{stage.label}</span>
                        <span className="text-[10px] text-gray-400">{stage.description}</span>
                      </div>
                      <span className="text-[10px] text-gray-400">{items.length} oportunidad{items.length !== 1 ? 'es' : ''}</span>
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
                              {opp.vertical !== 'general' ? VERTICALS[(opp.vertical as VerticalKey) ?? 'general']?.shortLabel ?? opp.vertical : ''}
                              {opp.expected_close_date ? ` · cierre ${formatDate(opp.expected_close_date)}` : ''}
                              {opp.source ? ` · ${opp.source}` : ''}
                            </p>
                          </button>
                          <div className="flex shrink-0 items-center gap-2">
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
                              title="Editar oportunidad"
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
      {subtab === 'cases' && (
        <SectionCard
          title="Expedientes"
          description={vertical === 'immigration' ? 'Trámites de extranjería abiertos.' : 'Casos abiertos del workspace.'}
          action={<Badge variant={visibleCases.length ? 'indigo' : 'default'} dot>{visibleCases.length} expedientes</Badge>}
        >
          {loading ? (
            <div className="flex items-center justify-center py-8 text-xs text-gray-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : visibleCases.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-6 w-6 text-gray-300" />}
              title="Sin expedientes abiertos"
              description="Crea un expediente para empezar a organizar la operación o trámite del cliente."
              action={
                <Button variant="primary" size="sm" onClick={() => setOpenCase(true)}>
                  <Plus className="h-3.5 w-3.5" /> Nuevo expediente
                </Button>
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
                      title="Editar expediente"
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
                        title="Editar expediente"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    {c.case_type}
                    {c.priority !== 'normal' ? ` · prioridad ${c.priority}` : ''}
                    {c.due_date ? ` · vence ${formatDate(c.due_date)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {(vertical === 'immigration' || vertical === 'all') && (
            <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tipos de expediente preparados</p>
              <div className="flex flex-wrap gap-1.5">
                {CASE_TYPES.filter((t) => t.vertical === 'immigration' || vertical === 'all').slice(0, 6).map((t) => (
                  <span key={t.id} className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700" title={t.description}>
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* PROPERTIES */}
      {subtab === 'properties' && (
        <SectionCard
          title="Propiedades"
          description={vertical === 'immigration' ? 'No aplica al vertical de extranjería.' : 'Captaciones, ventas y alquileres.'}
          action={<Badge variant={visibleProperties.length ? 'indigo' : 'default'} dot>{visibleProperties.length} propiedades</Badge>}
        >
          {loading ? (
            <div className="flex items-center justify-center py-8 text-xs text-gray-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : vertical === 'immigration' ? (
            <EmptyState
              icon={<Building2 className="h-6 w-6 text-gray-300" />}
              title="Sin propiedades en este vertical"
              description="Las propiedades son parte del vertical Inmobiliaria. Cambia el tab arriba para verlas."
            />
          ) : visibleProperties.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-6 w-6 text-gray-300" />}
              title="Sin propiedades en cartera"
              description="Registra una propiedad para empezar a gestionarla."
              action={
                <Button variant="primary" size="sm" onClick={() => setOpenProp(true)}>
                  <Plus className="h-3.5 w-3.5" /> Nueva propiedad
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {visibleProperties.map((p) => (
                <li key={p.id} className="rounded-xl border border-gray-100 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setEditProp(p)}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium text-gray-900 hover:text-indigo-700"
                      title="Editar propiedad"
                    >
                      {p.title}
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        aria-label="Cambiar estado"
                        className={SELECT_CLS}
                        value={p.status}
                        onChange={(e) => void handlePropertyStatus(p, e.target.value)}
                      >
                        {PROPERTY_STATUS_OPTIONS_PUBLIC.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setEditProp(p)}
                        title="Editar propiedad"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    {p.property_type}
                    {p.operation_type ? ` · ${p.operation_type}` : ''}
                    {p.city ? ` · ${p.city}` : ''}
                    {p.area ? ` · ${p.area}` : ''}
                    {p.price ? ` · ${formatCurrency(p.price, p.currency ?? 'EUR')}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {/* TEMPLATES */}
      {subtab === 'templates' && (
        <WorkspaceTemplatesPanel workspaceId={workspaceId} vertical={vertical === 'all' ? 'all' : (vertical as VerticalKey)} />
      )}

      {/* AUTOMATIONS — only when the operator surface is on */}
      {subtab === 'automations' && featureFlags.nowlabsInternal && (
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
