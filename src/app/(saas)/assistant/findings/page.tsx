'use client'

// P70 Wave A — Centro de incidencias del Asistente (findings P67/P68).
//
// Lee assistant_findings DIRECTAMENTE con la sesión del usuario (cliente browser, RLS por workspace:
// policy assistant_findings_select verificada). Solo lectura: la detección/resolución vive en el plano
// server-to-server (/api/agent/automation) y en el chat («¿qué requiere atención?»). Nunca muestra IDs,
// JSON ni fingerprints; el criterio objetivo de cada regla se muestra en claro.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Bot, CheckCircle, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'
import { useWorkspaceIdentity } from '@/components/WorkspaceIdentityProvider'
import { getSupabaseBrowserClient } from '@/lib/supabase'

type FindingRow = {
  id: string
  finding_type: string
  entity_type: string | null
  title: string
  summary: string
  severity: string
  status: string
  detected_at: string
  resolved_at: string | null
}

const SEVERITY_META: Record<string, { label: string; variant: 'danger' | 'warning' | 'info' }> = {
  critical: { label: 'Crítico', variant: 'danger' },
  warning: { label: 'Aviso', variant: 'warning' },
  info: { label: 'Info', variant: 'info' },
}

const STATUS_META: Record<string, { label: string; variant: 'warning' | 'success' | 'default' | 'indigo' }> = {
  open: { label: 'Abierta', variant: 'warning' },
  acknowledged: { label: 'Vista', variant: 'indigo' },
  resolved: { label: 'Resuelta', variant: 'success' },
  dismissed: { label: 'Descartada', variant: 'default' },
}

const ENTITY_LABEL: Record<string, string> = {
  property: 'Inmueble',
  opportunity: 'Operación',
  task: 'Tarea',
  client: 'Cliente',
}

// «… Criterio: status=sold sin …» → separa el resumen humano del criterio objetivo de la regla.
function splitCriterion(summary: string): { summary: string; criterion: string | null } {
  const [head, tail] = summary.split(/\s*Criterio:\s*/)
  return { summary: (head ?? '').trim(), criterion: tail ? tail.trim() : null }
}

function formatMadridDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

type SeverityFilter = 'all' | 'critical' | 'warning' | 'info'
type StatusFilter = 'open' | 'resolved' | 'all'

export default function AssistantFindingsPage() {
  const { workspaceId, isLoading: identityLoading } = useWorkspaceIdentity()
  const [rows, setRows] = useState<FindingRow[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (identityLoading) return
    let cancelled = false
    const load = async () => {
      const supabase = getSupabaseBrowserClient()
      if (!supabase || !workspaceId) {
        if (!cancelled) setRows([])
        return
      }
      const { data, error } = await supabase
        .from('assistant_findings')
        .select('id, finding_type, entity_type, title, summary, severity, status, detected_at, resolved_at')
        .eq('workspace_id', workspaceId)
        .order('detected_at', { ascending: false })
        .limit(200)
      if (cancelled) return
      if (error) {
        setLoadError('No se han podido cargar las incidencias ahora mismo.')
        setRows([])
        return
      }
      setLoadError('')
      setRows((data ?? []) as FindingRow[])
    }
    void load()
    return () => { cancelled = true }
  }, [identityLoading, workspaceId, refreshTick])

  const openRows = useMemo(() => (rows ?? []).filter((r) => r.status === 'open' || r.status === 'acknowledged'), [rows])
  const counts = useMemo(() => ({
    critical: openRows.filter((r) => r.severity === 'critical').length,
    warning: openRows.filter((r) => r.severity === 'warning').length,
    info: openRows.filter((r) => r.severity === 'info').length,
    resolved: (rows ?? []).filter((r) => r.status === 'resolved' || r.status === 'dismissed').length,
  }), [rows, openRows])

  const filtered = useMemo(() => (rows ?? []).filter((r) => {
    if (severityFilter !== 'all' && r.severity !== severityFilter) return false
    if (statusFilter === 'open') return r.status === 'open' || r.status === 'acknowledged'
    if (statusFilter === 'resolved') return r.status === 'resolved' || r.status === 'dismissed'
    return true
  }), [rows, severityFilter, statusFilter])

  const loading = identityLoading || rows === null

  const tiles = [
    { key: 'critical', label: 'Críticas abiertas', value: counts.critical, tone: 'text-red-600 bg-red-50' },
    { key: 'warning', label: 'Avisos abiertos', value: counts.warning, tone: 'text-amber-600 bg-amber-50' },
    { key: 'info', label: 'Info abiertas', value: counts.info, tone: 'text-blue-600 bg-blue-50' },
    { key: 'resolved', label: 'Cerradas', value: counts.resolved, tone: 'text-emerald-600 bg-emerald-50' },
  ]

  const severityChips: Array<{ key: SeverityFilter; label: string }> = [
    { key: 'all', label: 'Todas' },
    { key: 'critical', label: 'Críticas' },
    { key: 'warning', label: 'Avisos' },
    { key: 'info', label: 'Info' },
  ]
  const statusChips: Array<{ key: StatusFilter; label: string }> = [
    { key: 'open', label: 'Abiertas' },
    { key: 'resolved', label: 'Cerradas' },
    { key: 'all', label: 'Todas' },
  ]

  return (
    <div className="space-y-5 pb-2">
      <PageHeader
        title="Centro de incidencias"
        description="Hallazgos objetivos del Asistente sobre la calidad de tus datos (auditorías manuales y automatizaciones programadas)."
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRefreshTick((t) => t + 1)} aria-label="Recargar incidencias">
              <RefreshCw className="h-3.5 w-3.5" />
              Recargar
            </Button>
            <Link href="/assistant" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700">
              <Bot className="h-3.5 w-3.5" />
              Pedir auditoría al Asistente
            </Link>
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.key} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className={cn('mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg', tile.tone)}>
              {tile.key === 'resolved' ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </div>
            <p className="text-2xl font-bold tabular-nums text-gray-900">{tile.value}</p>
            <p className="text-xs text-gray-500">{tile.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por estado">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Estado</span>
          {statusChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-pressed={statusFilter === chip.key}
              onClick={() => setStatusFilter(chip.key)}
              className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors', statusFilter === chip.key ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por severidad">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Severidad</span>
          {severityChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-pressed={severityFilter === chip.key}
              onClick={() => setSeverityFilter(chip.key)}
              className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors', severityFilter === chip.key ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <div key={n} className="h-20 animate-pulse rounded-xl bg-gray-100" />)}
        </div>
      )}

      {!loading && loadError && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>
      )}

      {!loading && !loadError && filtered.length === 0 && (
        <EmptyState
          className="rounded-xl border border-gray-100 bg-white px-6 shadow-sm"
          icon={<CheckCircle className="h-6 w-6 text-emerald-500" />}
          title={statusFilter === 'open' ? 'No hay incidencias abiertas con este filtro.' : 'No hay incidencias con este filtro.'}
          description="Pide al Asistente «¿qué requiere atención?» para lanzar una auditoría en vivo, o activa una automatización diaria desde el chat."
          action={(
            <Link href="/assistant" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
              Ir al Asistente <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        />
      )}

      {!loading && !loadError && filtered.length > 0 && (
        <ul className="space-y-3">
          {filtered.map((row) => {
            const sev = SEVERITY_META[row.severity] ?? SEVERITY_META.info
            const st = STATUS_META[row.status] ?? STATUS_META.open
            const { summary, criterion } = splitCriterion(row.summary)
            return (
              <li key={row.id} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant={sev.variant}>{sev.label}</Badge>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    {row.entity_type && <Badge variant="default">{ENTITY_LABEL[row.entity_type] ?? row.entity_type}</Badge>}
                  </div>
                  <span className="text-[11px] tabular-nums text-gray-400">{formatMadridDate(row.detected_at)}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-gray-900">{row.title}</p>
                {summary && <p className="mt-1 text-xs leading-5 text-gray-600">{summary}</p>}
                {criterion && (
                  <p className="mt-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-[11px] leading-5 text-gray-500">
                    <span className="font-semibold text-gray-600">Criterio:</span> {criterion}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
