'use client'

// /opportunities — Vertical Pack v1.
//
// Single page that hosts three lanes: Oportunidades, Expedientes y Propiedades.
// Reusable across verticals via the tab selector at the top (Todos /
// Inmobiliaria / Extranjería / Servicios). The lanes are simple lists, not
// drag-and-drop kanban: the goal is "premium readable", not "fancy".
//
// All reads come from the workspace-scoped helpers in vertical-queries.ts,
// which enforce RLS at the Supabase layer. Writes are wired (create dialogs
// for opportunity / case / property) but skipped from this iteration to keep
// the surface small. Drafts of the message/automation catalogs read from the
// static templates in lib/demo/vertical-templates.ts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Target,
  Building2,
  FileText,
  Loader2,
  RefreshCcw,
  ArrowRight,
  Briefcase,
  PlugZap,
  Sparkles,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/current-user'
import {
  VERTICALS,
  getPipelineForVertical,
  getMessageTemplatesForVertical,
  getAutomationTemplatesForVertical,
  AUTOMATION_TEMPLATES,
  CASE_TYPES,
  type VerticalKey,
} from '@/lib/demo/vertical-templates'
import {
  listOpportunities,
  listServiceCases,
  listProperties,
  type OpportunityRow,
  type ServiceCaseRow,
  type PropertyRow,
} from '@/lib/vertical-queries'

type VerticalTab = 'all' | VerticalKey

const VERTICAL_TABS: Array<{ key: VerticalTab; label: string; description: string }> = [
  { key: 'all',                    label: 'Todos',         description: 'Pipeline completo del workspace.' },
  { key: 'real_estate',            label: 'Inmobiliaria',  description: 'Captaciones, visitas y operaciones inmobiliarias.' },
  { key: 'immigration',            label: 'Extranjería',   description: 'Expedientes y trámites de extranjería.' },
  { key: 'professional_services',  label: 'Servicios',     description: 'Asesorías y servicios profesionales recurrentes.' },
]

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
  const isDemo = currentUser?.isDemo ?? true

  const [vertical, setVertical] = useState<VerticalTab>('all')
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  const [cases, setCases] = useState<ServiceCaseRow[]>([])
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const workspaceId = currentUser?.workspaceId ?? null

  const loadData = useCallback(async () => {
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

  const messageTemplates = useMemo(() => {
    if (vertical === 'all') return getMessageTemplatesForVertical('general').slice(0, 6)
    return getMessageTemplatesForVertical(vertical as VerticalKey).slice(0, 6)
  }, [vertical])

  const automationTemplates = useMemo(() => {
    if (vertical === 'all') return AUTOMATION_TEMPLATES.slice(0, 6)
    return getAutomationTemplatesForVertical(vertical as VerticalKey).slice(0, 6)
  }, [vertical])

  const totalPipelineValue = visibleOpportunities.reduce((sum, o) => sum + (o.value ?? 0), 0)
  const activeCases = visibleCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved').length

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-5 pb-2"
    >
      <PageHeader
        title="Oportunidades & Expedientes"
        description="Pipeline comercial, expedientes de servicio y captación de propiedades — todo workspace-scoped."
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void loadData()} disabled={loading}>
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refrescar
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

      {isDemo && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Modo demo: las oportunidades, expedientes y propiedades requieren sesión real. Al iniciar sesión, este workspace operará sobre tablas reales con RLS.
        </div>
      )}

      {loadError && (
        <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {loadError}
        </div>
      )}

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          icon={<Target className="h-4 w-4 text-indigo-600" />}
          label="Oportunidades"
          value={String(visibleOpportunities.length)}
          detail={visibleOpportunities.length ? `${formatCurrency(totalPipelineValue)} en pipeline` : 'Sin oportunidades aún'}
          tone="border-indigo-100 bg-indigo-50/40"
        />
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
      </div>

      {/* Pipeline */}
      <SectionCard
        title="Pipeline"
        description={`Etapas del flujo ${VERTICALS[verticalForPipeline].label.toLowerCase()}.`}
        action={<Badge variant={visibleOpportunities.length ? 'indigo' : 'default'} dot>{visibleOpportunities.length} oportunidades</Badge>}
      >
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : visibleOpportunities.length === 0 ? (
          <EmptyState
            icon={<Target className="h-6 w-6 text-gray-300" />}
            title="Sin oportunidades todavía"
            description={
              vertical === 'all'
                ? 'Cuando entren leads desde WhatsApp/Instagram/Web o crees una oportunidad manualmente, aparecerán aquí organizadas por etapa.'
                : `Sin oportunidades en ${VERTICALS[verticalForPipeline].label.toLowerCase()}. Crea una desde el Asistente IA o desde el botón "Nueva oportunidad" (próximamente).`
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
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">{opp.title}</p>
                          <p className="truncate text-[11px] text-gray-500">
                            {opp.vertical !== 'general' ? VERTICALS[(opp.vertical as VerticalKey) ?? 'general']?.shortLabel ?? opp.vertical : ''}
                            {opp.expected_close_date ? ` · cierre ${formatDate(opp.expected_close_date)}` : ''}
                            {opp.source ? ` · ${opp.source}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs font-semibold text-gray-700">{formatCurrency(opp.value, opp.currency ?? 'EUR')}</span>
                          {typeof opp.probability === 'number' && (
                            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{opp.probability}%</span>
                          )}
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

      {/* Cases + Properties side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Expedientes"
          description={vertical === 'immigration' ? 'Trámites de extranjería abiertos.' : 'Casos abiertos del workspace.'}
          action={<Badge variant={visibleCases.length ? 'indigo' : 'default'} dot>{visibleCases.length} expedientes</Badge>}
        >
          {visibleCases.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-6 w-6 text-gray-300" />}
              title="Sin expedientes activos"
              description={
                vertical === 'immigration'
                  ? 'Crea un expediente de extranjería al recibir documentación de un cliente. Aparecerá aquí con su checklist.'
                  : 'Los expedientes de servicio aparecerán aquí. Tipos preparados: renovación NIE, arraigo, reagrupación familiar y más.'
              }
            />
          ) : (
            <ul className="space-y-2">
              {visibleCases.slice(0, 8).map((c) => (
                <li key={c.id} className="rounded-xl border border-gray-100 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">{c.title}</p>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">{c.status}</span>
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
                {CASE_TYPES.filter((t) => t.vertical === 'immigration' || vertical === 'all').slice(0, 5).map((t) => (
                  <span key={t.id} className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700" title={t.description}>
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Propiedades"
          description={vertical === 'immigration' ? 'No aplica al vertical de extranjería.' : 'Captaciones, ventas y alquileres.'}
          action={<Badge variant={visibleProperties.length ? 'indigo' : 'default'} dot>{visibleProperties.length} propiedades</Badge>}
        >
          {vertical === 'immigration' ? (
            <EmptyState
              icon={<Building2 className="h-6 w-6 text-gray-300" />}
              title="Sin propiedades en este vertical"
              description="Las propiedades son parte del vertical Inmobiliaria. Cambia el tab arriba para verlas."
            />
          ) : visibleProperties.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-6 w-6 text-gray-300" />}
              title="Sin propiedades en cartera"
              description="Las captaciones, propiedades en venta y alquileres aparecerán aquí. Crea una al firmar la hoja de encargo o al recibir una nueva captación."
            />
          ) : (
            <ul className="space-y-2">
              {visibleProperties.slice(0, 8).map((p) => (
                <li key={p.id} className="rounded-xl border border-gray-100 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">{p.title}</p>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">{p.status}</span>
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
      </div>

      {/* Templates + Automations */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Plantillas IA preparadas"
          description="Mensajes y propuestas listas para usar desde Inbox o Asistente."
          action={<Badge variant="indigo" dot>{messageTemplates.length}</Badge>}
        >
          <ul className="space-y-2">
            {messageTemplates.map((tmpl) => (
              <li key={tmpl.id} className="rounded-xl border border-gray-100 bg-white p-3 hover:bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{tmpl.title}</p>
                  <span className="rounded-full border border-gray-100 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                    {tmpl.channel}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-500">{tmpl.body}</p>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="Automatizaciones preparadas"
          description="Catálogo listo. Se ejecutarán cuando conectes n8n + WhatsApp/Instagram real."
          action={<Badge variant="warning" dot>requiere n8n</Badge>}
        >
          <ul className="space-y-2">
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
      </div>

      {/* Footer hint */}
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 ring-1 ring-indigo-100">
            <Briefcase className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">Vertical Pack v1 listo en código</p>
            <p className="mt-0.5 text-xs leading-5 text-gray-600">
              NowCRM ya tiene las tablas <code className="rounded bg-white px-1 text-[10px]">opportunities</code>, <code className="rounded bg-white px-1 text-[10px]">service_cases</code> y <code className="rounded bg-white px-1 text-[10px]">properties</code> con RLS por workspace.
              Los catálogos de plantillas IA y automatizaciones están en estático para que cada workspace los vea sin necesidad de seed.
              Los workflows reales se conectarán cuando esté listo el VPS con n8n y las claves Meta.
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-emerald-700"><Sparkles className="h-3 w-3" /> Listo en código</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-amber-700"><PlugZap className="h-3 w-3" /> Falta n8n / claves Meta</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-indigo-700"><ArrowRight className="h-3 w-3" /> Próximo: tools del agente</span>
            </div>
          </div>
        </div>
      </div>
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

