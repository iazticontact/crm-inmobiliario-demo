// PROTOTIPO AISLADO (general-semantic-planner) — SAFE GENERAL CRM QUERY LAYER (FASE 2-13).
// UNA capa READ-ONLY, componible y ALLOWLIST-driven. El planner emite un CRM QUERY PLAN estructurado; ESTA
// capa lo VALIDA y lo compila a consultas Supabase seguras. NUNCA hay SQL libre, ni tabla/campo/relación
// arbitrarios, ni service_role ni workspace decididos por el LLM. Reutiliza la policy de `crmReadQuery`
// (single source of truth de entidades/campos/filtros) para NO duplicar seguridad. Sin mutaciones: las
// escrituras siguen el action plane P65.

import type { SupabaseClient } from '@supabase/supabase-js'
import { crmReadQuery, isReaderError, madridDateRange, CRM_QUERY_ENTITIES, EXPAND_SPECS } from '@/lib/agent-tool-readers'
import { resolveEntity } from './entity-resolver'
import type { DiscourseRef } from './entity-resolver'
import type { EntityType } from './capability-ontology'

export type QueryOperation = 'list' | 'search' | 'detail' | 'count' | 'filter' | 'relation' | 'aggregate'
export type QuerySelection = 'all' | 'one' | 'first' | 'last' | 'random' | 'top' | 'bottom' | 'n' | 'matching'

export type CrmQueryPlan = {
  entity: string
  operation: QueryOperation
  entityRef?: string | null
  relation?: string | null
  search?: string | null
  filters?: Record<string, string | number>
  temporal?: { field?: string | null; range: string } | null
  aggregate?: { fn: 'count' | 'sum' | 'avg' | 'min' | 'max'; field?: string | null } | null
  selection?: QuerySelection | null
  selectionCount?: number | null
  ordering?: { field: string; dir: 'asc' | 'desc' } | null
  limit?: number | null
}

export type QueryStatus = 'SUCCESS' | 'EMPTY' | 'PARTIAL' | 'NOT_FOUND' | 'AMBIGUOUS' | 'FORBIDDEN' | 'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_PLAN' | 'INTERNAL_ERROR'
export type CrmQueryEvidence = {
  queryId: string
  entity: string
  operation: QueryOperation
  scope: { workspacePinned: true; relation?: string | null; resolvedEntity?: { type: string; id: string; label: string } | null }
  rows: Array<Record<string, unknown>>
  count: number
  aggregate?: { fn: string; field?: string | null; value: number } | null
  status: QueryStatus
  warnings: string[]
}

// Entidad semántica del CRM → clave allowlist de CRM_QUERY_ENTITIES (jamás nombre de tabla arbitrario).
const SEMANTIC_ENTITY: Record<string, string> = {
  clients: 'clients', client: 'clients', clientes: 'clients',
  properties: 'properties', property: 'properties', portfolio: 'properties', cartera: 'properties', inmuebles: 'properties', pisos: 'properties',
  operations: 'opportunities', opportunities: 'opportunities', opportunity: 'opportunities', operaciones: 'opportunities', oportunidades: 'opportunities',
  tasks: 'tasks', task: 'tasks', tareas: 'tasks',
  calendar: 'calendar_events', calendar_events: 'calendar_events', events: 'calendar_events', citas: 'calendar_events', agenda: 'calendar_events',
  cases: 'service_cases', service_cases: 'service_cases', tramites: 'service_cases', expedientes: 'service_cases',
  activities: 'activities', activity: 'activities', actividad: 'activities',
}
// Campos agregables (numéricos) por entidad allowlist. COUNT no requiere campo.
const AGGREGATABLE: Record<string, string[]> = {
  opportunities: ['value', 'probability', 'commission_paid_amount'],
  properties: ['price', 'area_m2', 'bedrooms', 'bathrooms'],
}
const ENTITY_TYPE: Record<string, EntityType> = {
  clients: 'client', properties: 'property', opportunities: 'opportunity', tasks: 'task', calendar_events: 'calendar_event', service_cases: 'service_case', activities: 'none',
}
const INJECTION_RE = /(--|;|\/\*|\*\/|\bunion\b|\bselect\b|\bdrop\b|\bdelete\b|\binsert\b|\bwhere\b\s+\d+=\d+)/i

export type Validation = { ok: true; entityKey: string } | { ok: false; reason: string }

// FASE 3-11 · Validación estricta contra allowlists. Devuelve reason exacto (trazable) si algo no encaja.
export function validateQueryPlan(plan: CrmQueryPlan): Validation {
  const key = SEMANTIC_ENTITY[String(plan.entity ?? '').toLowerCase()]
  if (!key) return { ok: false, reason: `unknown_entity:${plan.entity}` }
  const cfg = CRM_QUERY_ENTITIES[key]
  if (!cfg) return { ok: false, reason: `entity_not_allowlisted:${key}` }
  const ops: QueryOperation[] = ['list', 'search', 'detail', 'count', 'filter', 'relation', 'aggregate']
  if (!ops.includes(plan.operation)) return { ok: false, reason: `bad_operation:${plan.operation}` }

  const allowedCols = new Set(cfg.cols.split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean))
  // filtros: solo los declarados como filtrables por la entidad.
  for (const [k, v] of Object.entries(plan.filters ?? {})) {
    if (!cfg.filters.includes(k)) return { ok: false, reason: `field_not_filterable:${k}` }
    if (typeof v === 'string' && INJECTION_RE.test(v)) return { ok: false, reason: `injection_in_filter:${k}` }
  }
  // temporal: solo la columna de fecha declarada.
  if (plan.temporal?.field && plan.temporal.field !== cfg.dateCol) return { ok: false, reason: `bad_temporal_field:${plan.temporal.field}` }
  // ordering/projection: solo columnas conocidas.
  if (plan.ordering && !allowedCols.has(plan.ordering.field)) return { ok: false, reason: `bad_order_field:${plan.ordering.field}` }
  // relación: solo relaciones registradas para la entidad base.
  if (plan.operation === 'relation') {
    const specs = EXPAND_SPECS[cfg.table]
    if (!plan.relation || !specs || !specs[plan.relation]) return { ok: false, reason: `unknown_relation:${plan.relation}` }
  }
  // aggregate: fn válida y campo agregable (o count sin campo).
  if (plan.operation === 'aggregate' && plan.aggregate) {
    const { fn, field } = plan.aggregate
    if (!['count', 'sum', 'avg', 'min', 'max'].includes(fn)) return { ok: false, reason: `bad_aggregate_fn:${fn}` }
    if (fn !== 'count') {
      if (!field) return { ok: false, reason: 'aggregate_field_required' }
      if (!(AGGREGATABLE[key] ?? []).includes(field)) return { ok: false, reason: `field_not_aggregatable:${field}` }
    }
  }
  return { ok: true, entityKey: key }
}

function seededPick(len: number, seed: number | null): number {
  if (len <= 0) return 0
  if (seed == null) return Math.floor(Math.random() * len)
  return Math.floor(((Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0) / 4294967296) * len)
}
function applySelection(rows: Array<Record<string, unknown>>, sel: QuerySelection | null | undefined, count: number | null | undefined, seed: number | null): Array<Record<string, unknown>> {
  if (!sel || sel === 'all' || sel === 'matching' || rows.length === 0) return rows
  switch (sel) {
    case 'one': case 'first': return [rows[0]]
    case 'last': return [rows[rows.length - 1]]
    case 'random': return [rows[seededPick(rows.length, seed)]]
    case 'top': return rows.slice(0, count ?? 3)
    case 'bottom': return rows.slice(-(count ?? 3))
    case 'n': return rows.slice(0, count ?? 1)
    default: return rows
  }
}
function num(v: unknown): number { return typeof v === 'number' && Number.isFinite(v) ? v : 0 }
function aggregate(rows: Array<Record<string, unknown>>, fn: string, field?: string | null): number {
  if (fn === 'count') return rows.length
  const vals = rows.map((r) => num(r[field!]))
  if (!vals.length) return 0
  switch (fn) {
    case 'sum': return Math.round(vals.reduce((a, b) => a + b, 0))
    case 'avg': return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
    case 'min': return Math.min(...vals)
    case 'max': return Math.max(...vals)
    default: return 0
  }
}

// FASE 7 · Compilador: plan validado → consultas Supabase seguras (vía crmReadQuery + relación registrada).
export async function executeQueryPlan(
  supabase: SupabaseClient, workspaceId: string, plan: CrmQueryPlan, discourse: DiscourseRef, opts: { selectionSeed?: number | null } = {},
): Promise<CrmQueryEvidence> {
  const queryId = `q-${Math.random().toString(36).slice(2, 9)}`
  const v = validateQueryPlan(plan)
  const base: CrmQueryEvidence = { queryId, entity: plan.entity, operation: plan.operation, scope: { workspacePinned: true }, rows: [], count: 0, status: 'SUCCESS', warnings: [] }
  if (!v.ok) return { ...base, status: 'INVALID_PLAN', warnings: [v.reason] }
  const key = v.entityKey
  const cfg = CRM_QUERY_ENTITIES[key]
  const range = plan.temporal?.range ?? null
  const seed = opts.selectionSeed ?? null

  try {
    // DETAIL / RELATION requieren resolver la entidad base contra datos reales (nunca id del modelo).
    let baseEntity: { type: string; id: string; label: string } | null = null
    if (plan.operation === 'detail' || plan.operation === 'relation') {
      const res = await resolveEntity({ supabase, workspaceId, ref: plan.entityRef ?? null, expectedTypes: [ENTITY_TYPE[key]], discourse })
      if (res.status === 'AMBIGUOUS') return { ...base, status: 'AMBIGUOUS', warnings: ['multiple_matches'], rows: res.candidates.map((c) => ({ label: c.label })) }
      if (res.status !== 'RESOLVED') return { ...base, status: 'NOT_FOUND', warnings: [`base_entity_${res.status.toLowerCase()}`] }
      baseEntity = { type: res.type, id: res.id, label: res.label }
    }

    if (plan.operation === 'detail') {
      const res = await crmReadQuery(supabase, workspaceId, { entity: key, limit: 1 })
      // Devolvemos la entidad resuelta (fila base). El detalle 360 lo compone el executor de capabilities.
      void res
      return { ...base, rows: [{ id: baseEntity!.id, label: baseEntity!.label }], count: 1, scope: { workspacePinned: true, resolvedEntity: baseEntity }, status: 'SUCCESS' }
    }

    if (plan.operation === 'relation') {
      const specs = EXPAND_SPECS[cfg.table]!
      const spec = specs[plan.relation!]!
      const relCfg = Object.values(CRM_QUERY_ENTITIES).find((c) => c.table === spec.table)
      // Consulta segura de la relación: tabla allowlisted, cols allowlisted, workspace-pinned, fk registrado.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from(spec.table).select(relCfg?.cols ?? spec.cols).eq('workspace_id', workspaceId).eq(spec.fk, baseEntity!.id)
      if (relCfg?.soft) q = q.is('deleted_at', null)
      for (const [k, val] of Object.entries(plan.filters ?? {})) if (relCfg?.filters.includes(k)) q = q.eq(k, val)
      q = q.order(relCfg?.orderCol ?? spec.order, { ascending: false, nullsFirst: false }).limit(Math.min(plan.limit ?? 20, 50))
      const { data, error } = await q
      if (error) return { ...base, status: 'INTERNAL_ERROR', warnings: ['relation_query_failed'], scope: { workspacePinned: true, relation: plan.relation, resolvedEntity: baseEntity } }
      let rows = ((data ?? []) as Array<Record<string, unknown>>)
      if (range && relCfg?.dateCol) { const r = madridDateRange(range, new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })); if (r) rows = rows.filter((x) => { const d = String(x[relCfg.dateCol!] ?? '').slice(0, 10); return d >= r.from && d <= r.to }) }
      rows = applySelection(rows, plan.selection, plan.selectionCount, seed)
      const agg = plan.aggregate ? { fn: plan.aggregate.fn, field: plan.aggregate.field, value: aggregate(rows, plan.aggregate.fn, plan.aggregate.field) } : null
      return { ...base, rows, count: rows.length, aggregate: agg, scope: { workspacePinned: true, relation: plan.relation, resolvedEntity: baseEntity }, status: rows.length ? 'SUCCESS' : 'EMPTY' }
    }

    // LIST / SEARCH / COUNT / FILTER / AGGREGATE → crmReadQuery (reutiliza toda la policy de lectura).
    const input: Record<string, unknown> = { entity: key, filters: plan.filters ?? {}, limit: Math.min(plan.limit ?? 20, 20) }
    if (plan.search) input.searchText = plan.search
    if (range) input.range = range
    if (plan.ordering) { input.orderBy = plan.ordering.field; input.orderDirection = plan.ordering.dir }
    const res = await crmReadQuery(supabase, workspaceId, input)
    if (isReaderError(res)) return { ...base, status: res.error === 'invalid_input' ? 'INVALID_PLAN' : 'INTERNAL_ERROR', warnings: [res.error] }
    let rows = res.rows as Array<Record<string, unknown>>
    rows = applySelection(rows, plan.selection, plan.selectionCount, seed)
    if (plan.operation === 'count') return { ...base, rows: [], count: rows.length, aggregate: { fn: 'count', value: rows.length }, status: rows.length ? 'SUCCESS' : 'EMPTY' }
    if (plan.operation === 'aggregate' && plan.aggregate) {
      const value = aggregate(rows, plan.aggregate.fn, plan.aggregate.field)
      return { ...base, rows: [], count: rows.length, aggregate: { fn: plan.aggregate.fn, field: plan.aggregate.field, value }, status: rows.length ? 'SUCCESS' : 'EMPTY' }
    }
    return { ...base, rows, count: rows.length, status: rows.length ? 'SUCCESS' : 'EMPTY' }
  } catch (e) {
    return { ...base, status: 'INTERNAL_ERROR', warnings: [(e as Error).message.slice(0, 80)] }
  }
}
