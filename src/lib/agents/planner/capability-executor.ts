// PROTOTIPO AISLADO (general-semantic-planner) — EXECUTOR GENERAL (FASE 2/3/6/8/10/11).
// NO interpreta lenguaje. Recibe un PLAN VALIDADO y ejecuta capabilities REGISTRADAS contra los readers
// reales (agent-tool-readers), workspace-pinned. Responsabilidades: validar capability, resolver entidad,
// construir el scope, llamar al reader, mapear a un objeto EVIDENCE con estado de la taxonomía única.
// Las acciones son SIEMPRE dry-run (PREVIEW), nunca se ejecutan aquí. El workspace lo fija el llamante
// (nunca el modelo). El executor no conoce la frase original salvo como metadata de traza.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  crmReadQuery, searchClients, getClient360, getClientOpportunities, getCalendarSummary,
  getPendingTasks, getCrmOverview, searchProperties, madridDateRange, isReaderError,
} from '@/lib/agent-tool-readers'
import { getCapability, introspectCapabilities, CLOSED_STAGES, type CapabilitySpec, type EntityType } from './capability-ontology'
import { getActionDefinition, findDeniedField } from '../action-registry'
import { resolveModuleFromText, explainModule, onboardingAnswer, ALL_MODULE_IDS, type CrmModuleId } from '../crm-module-catalog'
import { resolveEntity, type DiscourseRef, type Resolution } from './entity-resolver'
import { executeQueryPlan, type CrmQueryPlan, type QueryStatus } from './crm-query-layer'
import { mapReaderError, type GoalStatus, type ValidatedGoal, type ValidatedPlan } from './plan-contract'

export type Evidence = {
  goalId: string
  capability: string
  status: GoalStatus
  data: unknown                 // hechos crudos (solo desde readers) para que el synthesizer no invente
  count?: number
  resolvedEntity?: { type: string; id: string; label: string } | null
  actionPreview?: ActionPreview | null
  message?: string              // copia segura para estados de error/aclaración
}
export type ActionPreview = {
  actionId: string
  entity: { type: string; id: string; label: string } | null
  changes: Record<string, string | number>
  missingSlots: string[]
  ready: boolean                // ¿tiene entidad + campos para ofrecer confirmación? (NUNCA ejecuta)
  note: string
}

function todayMadrid(): string { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }) }

// Traduce la frase temporal literal del plan a un rango que los readers entienden (keyword es-ES/en).
function temporalToRange(temporal: string | null): string | null {
  if (!temporal) return null
  return madridDateRange(temporal, todayMadrid()) ? temporal : temporal // el reader revalida; pasa tal cual
}
function inRange(dateIso: string | null | undefined, temporal: string | null): boolean {
  if (!temporal) return true
  if (!dateIso) return false
  const r = madridDateRange(temporal, todayMadrid())
  if (!r) return true
  const d = dateIso.slice(0, 10)
  return d >= r.from && d <= r.to
}

async function needEntity(
  supabase: SupabaseClient, workspaceId: string, g: ValidatedGoal, spec: CapabilitySpec, discourse: DiscourseRef,
): Promise<{ ok: true; res: Extract<Resolution, { status: 'RESOLVED' }> } | { ok: false; ev: Partial<Evidence> }> {
  const res = await resolveEntity({ supabase, workspaceId, ref: g.entityRef, expectedTypes: spec.entityTypes, discourse })
  if (res.status === 'RESOLVED') return { ok: true, res }
  if (res.status === 'AMBIGUOUS') return { ok: false, ev: { status: 'AMBIGUOUS', data: res.candidates.map((c) => ({ id: c.id, label: c.label })), message: `Hay varias coincidencias (${res.candidates.map((c) => c.label).join(', ')}). ¿Cuál?` } }
  if (res.status === 'STALE') return { ok: false, ev: { status: 'CONFLICT', data: null, message: `«${res.label}» ya no aparece en el workspace; puede que se haya eliminado o cambiado.` } }
  // Distingue "no hay antecedente para el pronombre/elipsis" (referencia vacía o pronominal, sin entidad
  // activa) de "no existe esa entidad nombrada". El primero se ACLARA (¿de qué entidad?), no se responde
  // con datos vacíos de otra: eso evita el falso negativo "no tiene citas" cuando en realidad perdimos el
  // referente. General, sin frases: depende de si el modelo dio un nombre o una referencia deíctica.
  const deictic = !g.entityRef || /^(él|ella|ellos|ellas|ese|esa|este|esta|eso|le|lo|la|su|sus|mismo|dicho|aquel|aquella|el mismo|la misma|ordinal:\d+)$/i.test(g.entityRef.trim())
  if (deictic) return { ok: false, ev: { status: 'AMBIGUOUS', data: null, message: '¿A qué cliente/entidad te refieres? He perdido la referencia anterior.' } }
  return { ok: false, ev: { status: 'NOT_FOUND', data: null, message: 'No encontré esa entidad en el workspace consultado.' } }
}

function statusFor(count: number): GoalStatus { return count > 0 ? 'SUCCESS' : 'EMPTY' }

async function executeGoal(
  supabase: SupabaseClient, workspaceId: string, g: ValidatedGoal, discourse: DiscourseRef,
): Promise<Evidence> {
  const spec = getCapability(g.capability)
  if (!spec) return { goalId: g.goalId, capability: g.capability, status: 'POLICY_BLOCK', data: null, message: 'Capacidad no registrada.' }
  const base: Evidence = { goalId: g.goalId, capability: g.capability, status: 'SUCCESS', data: null }
  const range = temporalToRange(g.temporal)

  try {
    switch (g.capability) {
      // ── Explicaciones / guía (no leen datos) ──
      case 'explain.module': {
        const modText = String(g.filters.module ?? g.entityRef ?? '')
        // El planner habla en ids CANÓNICOS de módulo (los ve así en la ontología): acéptalos directamente.
        // El resolver de aliases queda para texto natural. General: id exacto primero, alias después.
        const id = (ALL_MODULE_IDS as readonly string[]).includes(modText) ? (modText as CrmModuleId) : resolveModuleFromText(modText)
        if (!id) return { ...base, status: 'INVALID_INPUT', message: 'No identifiqué de qué módulo hablar.' }
        return { ...base, data: { module: id, explanation: explainModule(id) } }
      }
      case 'onboarding.tour':
        return { ...base, data: { onboarding: onboardingAnswer() } }

      // INTROSPECCIÓN de capacidades DERIVADA del registro (clase 2/8). El módulo/entidad salen del goal o
      // del foco de discurso; nunca de texto manual. No ejecuta ni prepara nada; solo describe qué se puede.
      case 'capabilities.introspect': {
        const modText = String(g.filters.module ?? '')
        const modId = modText ? (resolveModuleFromText(modText) ?? modText) : null
        const activeType = discourse.activeEntities[0]?.type as EntityType | undefined
        const intro = introspectCapabilities({ module: modId ?? undefined, entityType: activeType, about: g.filters.about ? String(g.filters.about) : null })
        return { ...base, data: intro }
      }

      // ── Clientes ──
      case 'clients.list':
      case 'clients.count': {
        const filters: Record<string, unknown> = {}
        if (typeof g.filters.status === 'string') filters.status = g.filters.status
        const res = await crmReadQuery(supabase, workspaceId, { entity: 'clients', filters, searchText: g.filters.query, limit: 20 })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        return { ...base, status: statusFor(res.count), data: res.rows, count: res.count }
      }
      case 'clients.search': {
        const res = await searchClients(supabase, workspaceId, { query: g.entityRef ?? g.filters.query ?? '' })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        return { ...base, status: statusFor(res.results.length), data: res.results, count: res.results.length }
      }
      case 'clients.detail': {
        const e = await needEntity(supabase, workspaceId, g, spec, discourse)
        if (!e.ok) return { ...base, ...e.ev } as Evidence
        const res = await getClient360(supabase, workspaceId, { clientId: e.res.id })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message, resolvedEntity: { type: e.res.type, id: e.res.id, label: e.res.label } }
        return { ...base, data: res, resolvedEntity: { type: e.res.type, id: e.res.id, label: e.res.label } }
      }
      case 'clients.relation.operations': {
        const e = await needEntity(supabase, workspaceId, g, spec, discourse)
        if (!e.ok) return { ...base, ...e.ev } as Evidence
        const res = await getClientOpportunities(supabase, workspaceId, { clientId: e.res.id })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        const rows = res.opportunities.filter((o) => inRange(o.expected_close_date, g.temporal))
        return { ...base, status: statusFor(rows.length), data: rows, count: rows.length, resolvedEntity: { type: e.res.type, id: e.res.id, label: e.res.label } }
      }
      case 'clients.relation.tasks': {
        const e = await needEntity(supabase, workspaceId, g, spec, discourse)
        if (!e.ok) return { ...base, ...e.ev } as Evidence
        const res = await crmReadQuery(supabase, workspaceId, { entity: 'tasks', clientRef: e.res.id, range, limit: 20 })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        return { ...base, status: statusFor(res.count), data: res.rows, count: res.count, resolvedEntity: { type: e.res.type, id: e.res.id, label: e.res.label } }
      }
      case 'clients.relation.events': {
        const e = await needEntity(supabase, workspaceId, g, spec, discourse)
        if (!e.ok) return { ...base, ...e.ev } as Evidence
        const res = await getCalendarSummary(supabase, workspaceId, { clientId: e.res.id, range })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        return { ...base, status: statusFor(res.events.length), data: res.events, count: res.events.length, resolvedEntity: { type: e.res.type, id: e.res.id, label: e.res.label } }
      }
      case 'clients.relation.properties': {
        const e = await needEntity(supabase, workspaceId, g, spec, discourse)
        if (!e.ok) return { ...base, ...e.ev } as Evidence
        const res = await crmReadQuery(supabase, workspaceId, { entity: 'properties', clientRef: e.res.id, limit: 20 })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        return { ...base, status: statusFor(res.count), data: res.rows, count: res.count, resolvedEntity: { type: e.res.type, id: e.res.id, label: e.res.label } }
      }

      // ── Cartera ──
      case 'portfolio.list':
      case 'portfolio.summary': {
        const res = await searchProperties(supabase, workspaceId, { query: g.filters.query ?? '', type: g.filters.type, operation: g.filters.operation, minPrice: g.filters.minPrice, maxPrice: g.filters.maxPrice, availabilityMode: 'all' })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        if (g.capability === 'portfolio.summary') {
          const byStatus = new Map<string, number>()
          for (const p of res.properties) byStatus.set(p.status ?? 'sin estado', (byStatus.get(p.status ?? 'sin estado') ?? 0) + 1)
          return { ...base, status: statusFor(res.count), data: { total: res.count, byStatus: [...byStatus.entries()] }, count: res.count }
        }
        return { ...base, status: statusFor(res.count), data: res.properties, count: res.count }
      }
      case 'portfolio.detail': {
        const e = await needEntity(supabase, workspaceId, g, spec, discourse)
        if (!e.ok) return { ...base, ...e.ev } as Evidence
        return { ...base, data: e.res.label ? { property: e.res } : null, resolvedEntity: { type: e.res.type, id: e.res.id, label: e.res.label } }
      }

      // ── Operaciones / economía ──
      case 'operations.list': {
        const stageF = typeof g.filters.stage === 'string' ? g.filters.stage : null
        const filters: Record<string, unknown> = {}
        // META-VALORES de pipeline declarados en la ontología: open = etapa no terminal; closed = won|lost.
        // Se interpretan AQUÍ (server-side, derivado de CLOSED_STAGES), nunca con sinónimos del usuario.
        if (stageF && stageF !== 'open' && stageF !== 'closed') filters.stage = stageF
        const res = await crmReadQuery(supabase, workspaceId, { entity: 'opportunities', filters, range, limit: 20 })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        const rows = stageF === 'open' ? res.rows.filter((r) => !CLOSED_STAGES.includes(String((r as Record<string, unknown>).stage)))
          : stageF === 'closed' ? res.rows.filter((r) => CLOSED_STAGES.includes(String((r as Record<string, unknown>).stage)))
          : res.rows
        return { ...base, status: statusFor(rows.length), data: rows, count: rows.length }
      }
      case 'operations.aggregate.value': {
        const stageF = typeof g.filters.stage === 'string' ? g.filters.stage : null
        const filters: Record<string, unknown> = {}
        if (stageF && stageF !== 'open' && stageF !== 'closed') filters.stage = stageF
        const res = await crmReadQuery(supabase, workspaceId, { entity: 'opportunities', filters, range, limit: 20 })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        const rows = stageF === 'open' ? res.rows.filter((r) => !CLOSED_STAGES.includes(String((r as Record<string, unknown>).stage)))
          : stageF === 'closed' ? res.rows.filter((r) => CLOSED_STAGES.includes(String((r as Record<string, unknown>).stage)))
          : res.rows
        const total = rows.reduce((s, r) => s + (typeof (r as Record<string, unknown>).value === 'number' ? (r as Record<string, number>).value : 0), 0)
        return { ...base, status: rows.length > 0 ? 'SUCCESS' : 'EMPTY', data: { total, count: rows.length, currency: 'EUR' }, count: rows.length }
      }
      case 'commissions.aggregate': {
        // Comisiones = métrica COMERCIAL de las operaciones (NO Facturación). generado ≈ Σ value·rate/100
        // (sobre ganadas), cobrado = Σ commission_paid_amount, pendiente = generado − cobrado.
        const res = await crmReadQuery(supabase, workspaceId, { entity: 'opportunities', filters: { stage: 'won' }, range, limit: 20 })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        let generated = 0, collected = 0
        for (const r0 of res.rows) {
          const r = r0 as Record<string, unknown>
          const value = typeof r.value === 'number' ? r.value : 0
          const rate = typeof r.commission_rate === 'number' ? r.commission_rate : 0
          generated += value * (rate / 100)
          collected += typeof r.commission_paid_amount === 'number' ? r.commission_paid_amount : 0
        }
        return { ...base, status: res.count > 0 ? 'SUCCESS' : 'EMPTY', data: { generated: Math.round(generated), collected: Math.round(collected), pending: Math.round(generated - collected), basis: 'operaciones ganadas', note: 'comisión comercial, no facturación' }, count: res.count }
      }

      // ── Tareas / agenda / trámites ──
      case 'tasks.list': {
        const res = await getPendingTasks(supabase, workspaceId, {})
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        const rows = res.tasks.filter((t) => inRange(t.due_date, g.temporal))
        return { ...base, status: statusFor(rows.length), data: rows, count: rows.length }
      }
      case 'calendar.list': {
        const res = await getCalendarSummary(supabase, workspaceId, { range: range ?? 'esta semana' })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        return { ...base, status: statusFor(res.events.length), data: res.events, count: res.events.length }
      }
      case 'cases.list': {
        const filters: Record<string, unknown> = {}
        if (typeof g.filters.status === 'string') filters.status = g.filters.status
        const res = await crmReadQuery(supabase, workspaceId, { entity: 'service_cases', filters, range, limit: 20 })
        if (isReaderError(res)) return { ...base, status: mapReaderError(res.error), message: res.message }
        return { ...base, status: statusFor(res.count), data: res.rows, count: res.count }
      }
      case 'crm.summary': {
        const res = await getCrmOverview(supabase, workspaceId)
        return { ...base, data: res }
      }
      case 'findings.list':
        // Requiere ejecutar la automatización de calidad de datos; en el prototipo no se dispara.
        return { ...base, status: 'UNAVAILABLE', message: 'Las incidencias de calidad requieren ejecutar la automatización de datos.' }

      // PRIMITIVA GENERAL COMPONIBLE. El planner emitió un plan estructurado en g.query; se construye el
      // CRM Query Plan (reutilizando entityRef/filters/temporal/selection del goal) y la SAFE QUERY LAYER lo
      // valida contra allowlists y ejecuta. El modelo no controla tabla/campo/relación/workspace ni SQL.
      case 'crm.query': {
        const q = g.query
        if (!q || !q.entity || !q.operation) return { ...base, status: 'INVALID_INPUT', message: 'Consulta componible incompleta.' }
        const qp: CrmQueryPlan = {
          entity: q.entity,
          operation: q.operation,
          entityRef: g.entityRef,
          relation: q.relation ?? null,
          search: typeof g.filters.query === 'string' ? String(g.filters.query) : null,
          filters: Object.fromEntries(Object.entries(g.filters).filter(([k]) => k !== 'query')),
          temporal: g.temporal ? { field: null, range: g.temporal } : null,
          aggregate: q.aggregateFn ? { fn: q.aggregateFn, field: q.aggregateField ?? null } : null,
          selection: g.selection,
          selectionCount: g.selectionCount,
          ordering: q.orderingField ? { field: q.orderingField, dir: q.orderingDir ?? 'desc' } : null,
          limit: null,
        }
        const qe = await executeQueryPlan(supabase, workspaceId, qp, discourse, {})
        const map: Record<QueryStatus, GoalStatus> = { SUCCESS: 'SUCCESS', EMPTY: 'EMPTY', PARTIAL: 'PARTIAL', NOT_FOUND: 'NOT_FOUND', AMBIGUOUS: 'AMBIGUOUS', FORBIDDEN: 'FORBIDDEN', TIMEOUT: 'TIMEOUT', UNAVAILABLE: 'UNAVAILABLE', INVALID_PLAN: 'INVALID_INPUT', INTERNAL_ERROR: 'INTERNAL_ERROR' }
        return {
          ...base,
          status: map[qe.status],
          data: qe.aggregate ? { rows: qe.rows, aggregate: qe.aggregate } : qe.rows,
          count: qe.count,
          resolvedEntity: qe.scope.resolvedEntity ?? null,
          message: qe.status === 'AMBIGUOUS' ? 'Hay varias coincidencias; ¿cuál?' : qe.status === 'INVALID_PLAN' ? `Consulta no permitida (${qe.warnings.join(',')})` : undefined,
        }
      }

      default:
        break
    }

    // ── Acciones (mutación) → SIEMPRE dry-run PREVIEW, jamás ejecución ──
    if (spec.mutation) return await previewAction(supabase, workspaceId, g, spec, discourse)

    return { ...base, status: 'INTERNAL_ERROR', message: `Capacidad sin ejecutor: ${g.capability}` }
  } catch (err) {
    return { ...base, status: 'INTERNAL_ERROR', message: (err as Error).message.slice(0, 120) }
  }
}

// FASE 8 — Acción en DRY-RUN. Valida capability, resuelve entidad, comprueba campos permitidos y produce
// un PREVIEW CANDIDATE. NUNCA escribe. La confirmación real es responsabilidad del plano de acción P65.
async function previewAction(
  supabase: SupabaseClient, workspaceId: string, g: ValidatedGoal, spec: CapabilitySpec, discourse: DiscourseRef,
): Promise<Evidence> {
  const def = getActionDefinition(g.capability)
  if (!def) return { goalId: g.goalId, capability: g.capability, status: 'POLICY_BLOCK', data: null, message: 'Acción no registrada.' }

  // Campos propuestos = filtros del goal que además sean allowedFields de la acción. Un campo prohibido
  // hace fallar la preview entera (defensa de campos, igual que el plano P65 real).
  const changes: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(g.filters)) if (def.allowedFields.includes(k)) changes[k] = v
  const denied = findDeniedField(def, Object.fromEntries(Object.entries(g.filters).filter(([k]) => !def.allowedFields.includes(k) || def.forbiddenFields.includes(k))))
  if (denied && def.forbiddenFields.includes(denied)) {
    return { goalId: g.goalId, capability: g.capability, status: 'POLICY_BLOCK', data: null, message: `Campo no permitido para esta acción: ${denied}.` }
  }

  let entity: ActionPreview['entity'] = null
  if (def.requiredEntity) {
    const e = await needEntity(supabase, workspaceId, g, spec, discourse)
    if (!e.ok) return { goalId: g.goalId, capability: g.capability, status: e.ev.status ?? 'NOT_FOUND', data: e.ev.data ?? null, message: e.ev.message, actionPreview: null }
    entity = { type: e.res.type, id: e.res.id, label: e.res.label }
  }
  const missingSlots = (def.requiredEntity && !entity ? ['entity'] : []).concat(Object.keys(changes).length ? [] : ['fields'])
  const preview: ActionPreview = {
    actionId: def.id, entity, changes, missingSlots,
    ready: (!def.requiredEntity || !!entity) && Object.keys(changes).length > 0,
    note: 'DRY-RUN: preview de acción. No se ha ejecutado ninguna escritura.',
  }
  return { goalId: g.goalId, capability: g.capability, status: preview.ready ? 'SUCCESS' : 'PARTIAL', data: null, actionPreview: preview, message: preview.ready ? undefined : 'Falta información para preparar la acción.' }
}

// ── SELECCIÓN/CARDINALIDAD (clase 1) — se aplica DESPUÉS de obtener el conjunto autorizado ─────────────
// Un pedido de UNA instancia (one/random/first/last) NO devuelve la lista entera: se reduce aquí. RANDOM
// es seedable para tests. General: opera sobre cualquier dataset de un goal de lista, sin conocer la frase.
function seededPick(len: number, seed: number | null): number {
  if (len <= 0) return 0
  if (seed == null) return Math.floor(Math.random() * len)
  const t = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0) / 4294967296
  return Math.floor(t * len)
}
const LIST_PRODUCING = new Set(['clients.list', 'clients.search', 'portfolio.list', 'operations.list', 'tasks.list', 'calendar.list', 'cases.list', 'clients.relation.operations', 'clients.relation.tasks', 'clients.relation.events', 'clients.relation.properties'])
function applySelection(ev: Evidence, g: ValidatedGoal, seed: number | null): Evidence {
  const sel = g.selection
  if (!sel || sel === 'all' || sel === 'matching') return ev
  if (!Array.isArray(ev.data) || ev.data.length === 0) return ev
  if (!LIST_PRODUCING.has(ev.capability)) return ev
  const rows = ev.data as Array<Record<string, unknown>>
  let chosen: Array<Record<string, unknown>>
  switch (sel) {
    case 'one': chosen = [rows[0]]; break
    case 'first': chosen = [rows[0]]; break
    case 'last': chosen = [rows[rows.length - 1]]; break
    case 'random': chosen = [rows[seededPick(rows.length, seed)]]; break
    case 'top': chosen = rows.slice(0, g.selectionCount ?? 3); break
    case 'bottom': chosen = rows.slice(-(g.selectionCount ?? 3)); break
    case 'n': chosen = rows.slice(0, g.selectionCount ?? 1); break
    default: chosen = rows
  }
  const single = chosen.length === 1
  return { ...ev, data: chosen, count: chosen.length, message: ev.message ?? (single ? `selección: ${sel}${g.selectionCount ? `(${g.selectionCount})` : ''} de ${rows.length}` : undefined) }
}

export type ExecutionResult = { evidences: Evidence[]; ms: number }

// FASE 6 — Ejecuta el plan multi-goal. Goals independientes en paralelo (lecturas seguras). Un fallo
// parcial NO invalida los demás (cada goal lleva su propio estado). Se preserva el orden semántico.
export async function executePlan(
  supabase: SupabaseClient, workspaceId: string, plan: ValidatedPlan, discourse: DiscourseRef, opts: { selectionSeed?: number | null } = {},
): Promise<ExecutionResult> {
  const t0 = Date.now()
  if (plan.needsClarification && plan.goals.length === 0) {
    return { evidences: [{ goalId: 'clarify', capability: '(clarification)', status: 'AMBIGUOUS', data: null, message: plan.clarificationQuestion ?? 'Necesito una aclaración.' }], ms: Date.now() - t0 }
  }
  // Normalización GENERAL de contexto intra-plan: si un goal necesita módulo (explain.module) y el modelo
  // no rellenó el slot, se usa el foco que el PROPIO plan propone (proposedStateUpdates.activeModule). Es la
  // semántica del mismo turno emitida por el planner — no se adivina de frases ni de estado viejo.
  const goals = plan.goals.map((g) =>
    g.capability === 'explain.module' && !g.filters.module && plan.proposedStateUpdates?.activeModule
      ? { ...g, filters: { ...g.filters, module: plan.proposedStateUpdates.activeModule } }
      : g,
  )
  const raw = await Promise.all(goals.map((g) => executeGoal(supabase, workspaceId, g, discourse)))
  // Aplica selección/cardinalidad a cada evidence según su goal (un pedido de UNA instancia no devuelve todo).
  const evidences = raw.map((ev) => { const g = goals.find((x) => x.goalId === ev.goalId); return g ? applySelection(ev, g, opts.selectionSeed ?? null) : ev })
  return { evidences, ms: Date.now() - t0 }
}
