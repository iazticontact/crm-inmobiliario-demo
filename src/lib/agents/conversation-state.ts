// P71 — ESTADO CONVERSACIONAL ÚNICO por hilo. Fuente de verdad compartida por route, router, local-first
// y (a futuro) n8n. Representa lo que el asistente ENTIENDE del hilo (objetivo, módulo/capability activos,
// entidades y referentes resueltos, intención pendiente con slots, alcance temporal, última consulta y
// último resultado). REGLA DURA: el estado AYUDA A ENTENDER, NUNCA sustituye la consulta real de datos —
// solo guarda REFERENCIAS (tipo+id+label) e identificadores, jamás datos de negocio completos, secretos,
// tokens ni respuestas como verdad.
//
// Persistencia: se reutiliza `assistant_agent_memory` (memory_type='conversation_state', JSON en
// `metadata`, TTL en `expires_at`) — sin tabla nueva ni migración. RLS por workspace+user ya existente.
// Toda escritura es FAIL-SOFT y trazada: un fallo de memoria nunca rompe la respuesta.

import type { SupabaseClient } from '@supabase/supabase-js'

export const CONVERSATION_STATE_VERSION = 2
const STATE_TTL_MS = 24 * 60 * 60 * 1000 // 24 h: un hilo inactivo no arrastra estado rancio
// P71·It2 — vida de una intención pendiente: caduca sola si el usuario no la completa (nunca un «sí»
// tardío confirma nada). Corta a propósito (minutos), no horas: una intención vieja es ruido.
export const PENDING_INTENT_TTL_MS = 6 * 60 * 1000 // 6 min
const MAX_ENTITIES = 8
const MAX_REFERENTS = 12
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Tipos de entidad del CRM (alineados con AgentEntityType de la memoria previa).
export type ConvEntityType =
  | 'client' | 'opportunity' | 'service_case' | 'task' | 'calendar_event' | 'property' | 'document'
export const CONV_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'client', 'opportunity', 'service_case', 'task', 'calendar_event', 'property', 'document',
])

export type EntityRef = {
  entityType: ConvEntityType
  entityId: string
  displayLabel: string
  confidence: number
  sourceTurnId: string
}

export type Referent = {
  expression: string        // la expresión que se resolvió ("el primero", "sus", "ese piso")
  resolvedType: ConvEntityType
  resolvedId?: string
  sourceTurnId: string
  confidence: number
}

// P71·It2 — TIPOS DE SLOT generales (nunca campos del incidente): describen QUÉ falta, no una frase.
export type PendingSlot =
  | 'entity' | 'field' | 'value' | 'date' | 'period' | 'filter' | 'status' | 'ordering' | 'limit'
export const PENDING_SLOTS: ReadonlySet<string> = new Set([
  'entity', 'field', 'value', 'date', 'period', 'filter', 'status', 'ordering', 'limit',
])
export type PendingIntentKind = 'read' | 'action'
export type PendingIntentStatus = 'awaiting_slot' | 'ready' | 'completed' | 'cancelled' | 'expired'

export type PendingIntent = {
  kind: PendingIntentKind    // 'action' → SIEMPRE preview (prepare→confirm→execute→verify); nunca ejecuta
  capability: string         // p. ej. 'portfolio.update_price', 'read:tasks', 'calendar.create'
  module: string | null
  requiredSlots: string[]    // slots que AÚN faltan (subconjunto de PendingSlot)
  collectedSlots: Record<string, unknown> // slot → valor ya conocido (se acumula turno a turno)
  originalRequest: string
  sourceTurnId: string
  expiresAt: string
  confidence: number
  status: PendingIntentStatus
}

export type TemporalGranularity = 'day' | 'week' | 'month' | 'relative_days' | 'range'
export type TemporalScope = {
  start: string | null            // ISO yyyy-mm-dd (día completo en la zona), inclusivo
  end: string | null              // ISO yyyy-mm-dd, inclusivo
  timezone: string                // Europe/Madrid (verdad)
  granularity: TemporalGranularity | null
  interpretation: string | null   // "esta semana", "la semana que viene", "hoy"… (etiqueta, no dato)
  sourceTurnId: string
  confidence: number
}

// Referencias LIGERAS del último listado (ids+labels ordenados), para resolver ordinales/extremos.
// NO son datos de negocio: solo id + etiqueta + campo de orden opcional para re-consultar la fuente.
export type LastDataQuery = {
  module: string
  capability: string
  entityType: ConvEntityType | null
  resultRefs: Array<{ entityId: string; label: string; sortValue?: number }>
  executedAt: string
}

export type LastAssistantResult = {
  type: 'explanation' | 'read' | 'action' | 'automation'
  module: string | null
  capability: string | null
  entityIds: string[]
  turnId: string
}

export type ConversationState = {
  version: number
  updatedAt: string
  activeGoal: string | null
  activeModule: string | null
  activeCapability: string | null
  activeEntities: EntityRef[]
  previousEntities: EntityRef[]
  referents: Referent[]
  pendingIntent: PendingIntent | null
  temporalScope: TemporalScope | null
  lastDataQuery: LastDataQuery | null
  lastAssistantResult: LastAssistantResult | null
}

export function emptyState(): ConversationState {
  return {
    version: CONVERSATION_STATE_VERSION, updatedAt: new Date().toISOString(),
    activeGoal: null, activeModule: null, activeCapability: null,
    activeEntities: [], previousEntities: [], referents: [],
    pendingIntent: null, temporalScope: null, lastDataQuery: null, lastAssistantResult: null,
  }
}

// ── Validación runtime (defensa en profundidad; un estado corrupto NUNCA rompe el turno) ──────────────
function validEntityRef(v: unknown): EntityRef | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!CONV_ENTITY_TYPES.has(String(o.entityType))) return null
  if (typeof o.entityId !== 'string' || !UUID_RE.test(o.entityId)) return null
  return {
    entityType: o.entityType as ConvEntityType, entityId: o.entityId,
    displayLabel: typeof o.displayLabel === 'string' ? o.displayLabel.slice(0, 160) : '',
    confidence: typeof o.confidence === 'number' ? o.confidence : 0.5,
    sourceTurnId: typeof o.sourceTurnId === 'string' ? o.sourceTurnId : '',
  }
}

export function validateConversationState(v: unknown): ConversationState | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.version !== CONVERSATION_STATE_VERSION) return null // versión distinta → descartar (no migrar a ciegas)
  const arr = <T>(x: unknown, f: (e: unknown) => T | null, cap: number): T[] =>
    Array.isArray(x) ? x.map(f).filter((e): e is T => e !== null).slice(0, cap) : []
  const pending = o.pendingIntent
  let pendingIntent: PendingIntent | null = null
  if (pending && typeof pending === 'object') {
    const p = pending as Record<string, unknown>
    if (typeof p.capability === 'string' && Array.isArray(p.requiredSlots)) {
      const st = String(p.status)
      pendingIntent = {
        kind: p.kind === 'read' ? 'read' : 'action',
        capability: p.capability, module: typeof p.module === 'string' ? p.module : null,
        requiredSlots: (p.requiredSlots as unknown[]).map(String).filter((s) => PENDING_SLOTS.has(s)),
        collectedSlots: (p.collectedSlots && typeof p.collectedSlots === 'object') ? p.collectedSlots as Record<string, unknown> : {},
        originalRequest: typeof p.originalRequest === 'string' ? p.originalRequest.slice(0, 400) : '',
        sourceTurnId: typeof p.sourceTurnId === 'string' ? p.sourceTurnId : '',
        expiresAt: typeof p.expiresAt === 'string' ? p.expiresAt : new Date(Date.now() + PENDING_INTENT_TTL_MS).toISOString(),
        confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
        status: (['awaiting_slot', 'ready', 'completed', 'cancelled', 'expired'] as string[]).includes(st) ? st as PendingIntentStatus : 'awaiting_slot',
      }
    }
  }
  // Intención pendiente caducada o ya cerrada → se descarta (un "sí" antiguo jamás confirma nada).
  if (pendingIntent && (Date.parse(pendingIntent.expiresAt) < Date.now() || pendingIntent.status === 'completed' || pendingIntent.status === 'cancelled' || pendingIntent.status === 'expired')) pendingIntent = null
  return {
    version: CONVERSATION_STATE_VERSION,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
    activeGoal: typeof o.activeGoal === 'string' ? o.activeGoal : null,
    activeModule: typeof o.activeModule === 'string' ? o.activeModule : null,
    activeCapability: typeof o.activeCapability === 'string' ? o.activeCapability : null,
    activeEntities: arr(o.activeEntities, validEntityRef, MAX_ENTITIES),
    previousEntities: arr(o.previousEntities, validEntityRef, MAX_ENTITIES),
    referents: arr(o.referents, (e) => {
      if (!e || typeof e !== 'object') return null
      const r = e as Record<string, unknown>
      if (typeof r.expression !== 'string' || !CONV_ENTITY_TYPES.has(String(r.resolvedType))) return null
      return { expression: r.expression.slice(0, 80), resolvedType: r.resolvedType as ConvEntityType, resolvedId: typeof r.resolvedId === 'string' ? r.resolvedId : undefined, sourceTurnId: typeof r.sourceTurnId === 'string' ? r.sourceTurnId : '', confidence: typeof r.confidence === 'number' ? r.confidence : 0.5 }
    }, MAX_REFERENTS),
    pendingIntent,
    temporalScope: (o.temporalScope && typeof o.temporalScope === 'object') ? (() => {
      const t = o.temporalScope as Record<string, unknown>
      const g = String(t.granularity)
      return {
        start: typeof t.start === 'string' ? t.start : null, end: typeof t.end === 'string' ? t.end : null,
        timezone: typeof t.timezone === 'string' ? t.timezone : 'Europe/Madrid',
        granularity: (['day', 'week', 'month', 'relative_days', 'range'] as string[]).includes(g) ? g as TemporalGranularity : null,
        interpretation: typeof t.interpretation === 'string' ? t.interpretation : null,
        sourceTurnId: typeof t.sourceTurnId === 'string' ? t.sourceTurnId : '',
        confidence: typeof t.confidence === 'number' ? t.confidence : 0.5,
      }
    })() : null,
    lastDataQuery: (o.lastDataQuery && typeof o.lastDataQuery === 'object') ? (() => {
      const q = o.lastDataQuery as Record<string, unknown>
      if (typeof q.module !== 'string') return null
      const refs: Array<{ entityId: string; label: string; sortValue?: number }> = []
      if (Array.isArray(q.resultRefs)) {
        for (const x of q.resultRefs.slice(0, 25)) {
          const rr = x as Record<string, unknown>
          if (rr && typeof rr.entityId === 'string' && UUID_RE.test(rr.entityId)) {
            refs.push({ entityId: rr.entityId, label: typeof rr.label === 'string' ? rr.label.slice(0, 160) : '', ...(typeof rr.sortValue === 'number' ? { sortValue: rr.sortValue } : {}) })
          }
        }
      }
      const ldq: LastDataQuery = {
        module: q.module, capability: typeof q.capability === 'string' ? q.capability : '',
        entityType: CONV_ENTITY_TYPES.has(String(q.entityType)) ? q.entityType as ConvEntityType : null,
        resultRefs: refs, executedAt: typeof q.executedAt === 'string' ? q.executedAt : new Date().toISOString(),
      }
      return ldq
    })() : null,
    lastAssistantResult: (o.lastAssistantResult && typeof o.lastAssistantResult === 'object') ? (() => {
      const l = o.lastAssistantResult as Record<string, unknown>
      const t = String(l.type)
      if (!['explanation', 'read', 'action', 'automation'].includes(t)) return null
      return { type: t as LastAssistantResult['type'], module: typeof l.module === 'string' ? l.module : null, capability: typeof l.capability === 'string' ? l.capability : null, entityIds: Array.isArray(l.entityIds) ? l.entityIds.filter((x) => typeof x === 'string' && UUID_RE.test(x)).slice(0, 25) : [], turnId: typeof l.turnId === 'string' ? l.turnId : '' }
    })() : null,
  }
}

// ── Actualización estructurada (PURA): merge de un update parcial que emite local-first ───────────────
export type StateUpdate = {
  resolvedModule?: string | null
  resolvedCapability?: string | null
  resolvedGoal?: string | null
  resolvedEntities?: EntityRef[]          // entidades resueltas este turno (se promueven a activas por tipo)
  referentsCreated?: Referent[]
  pendingIntentUpdate?: PendingIntent | null // null explícito = limpiar
  clearPendingIntent?: boolean
  temporalScopeUpdate?: TemporalScope | null
  lastDataQueryUpdate?: LastDataQuery | null
  lastAssistantResultUpdate?: LastAssistantResult | null
}

export function applyStateUpdate(prev: ConversationState, u: StateUpdate): ConversationState {
  const next: ConversationState = { ...prev, version: CONVERSATION_STATE_VERSION, updatedAt: new Date().toISOString() }
  if (u.resolvedModule !== undefined) next.activeModule = u.resolvedModule
  if (u.resolvedCapability !== undefined) next.activeCapability = u.resolvedCapability
  if (u.resolvedGoal !== undefined) next.activeGoal = u.resolvedGoal
  if (u.resolvedEntities && u.resolvedEntities.length) {
    // Promover por TIPO: la nueva activa de un tipo demota la anterior a previous (nunca pisa otro tipo).
    let active = [...prev.activeEntities]
    let previous = [...prev.previousEntities]
    for (const e of u.resolvedEntities) {
      const old = active.find((a) => a.entityType === e.entityType)
      if (old && old.entityId !== e.entityId) {
        previous = [old, ...previous.filter((p) => p.entityType !== e.entityType)]
      }
      active = [e, ...active.filter((a) => a.entityType !== e.entityType)]
    }
    next.activeEntities = active.slice(0, MAX_ENTITIES)
    next.previousEntities = previous.slice(0, MAX_ENTITIES)
  }
  if (u.referentsCreated && u.referentsCreated.length) {
    next.referents = [...u.referentsCreated, ...prev.referents].slice(0, MAX_REFERENTS)
  }
  if (u.clearPendingIntent) next.pendingIntent = null
  else if (u.pendingIntentUpdate !== undefined) next.pendingIntent = u.pendingIntentUpdate
  if (u.temporalScopeUpdate !== undefined) next.temporalScope = u.temporalScopeUpdate
  if (u.lastDataQueryUpdate !== undefined) next.lastDataQuery = u.lastDataQueryUpdate
  if (u.lastAssistantResultUpdate !== undefined) next.lastAssistantResult = u.lastAssistantResultUpdate
  return next
}

// ── Compatibilidad de versiones (v1 → v2) ─────────────────────────────────────────────────────────────
// P71·It3 — un estado v1 VÁLIDO no se tira: se ADAPTA. Se conservan activeModule/capability/goal, las
// entidades y referentes seguros, la última consulta y el último resultado; pendingIntent y temporalScope
// (formas nuevas de v2) se inicializan a null (no se arrastran formas antiguas). Solo se descarta lo que no
// es recuperable con seguridad. No hay migración de BD: el JSON versionado se re-escribe en el próximo save.
export type StateLoadOutcome = 'loaded_v2' | 'upgraded' | 'reset_invalid' | 'empty'

export function upgradeConversationState(raw: unknown): { state: ConversationState | null; outcome: StateLoadOutcome } {
  if (raw === null || raw === undefined) return { state: null, outcome: 'empty' }
  if (typeof raw !== 'object') return { state: null, outcome: 'reset_invalid' }
  const o = raw as Record<string, unknown>
  if (o.version === CONVERSATION_STATE_VERSION) {
    const v = validateConversationState(o)
    return v ? { state: v, outcome: 'loaded_v2' } : { state: null, outcome: 'reset_invalid' }
  }
  if (o.version === 1) {
    // Coerción a la forma v2: se descartan las formas antiguas de pendingIntent/temporalScope (incompatibles)
    // y se re-valida. Lo demás (módulo/entidades/referentes/última consulta) lo conserva el validador.
    const coerced = { ...o, version: CONVERSATION_STATE_VERSION, pendingIntent: null, temporalScope: null }
    const v = validateConversationState(coerced)
    return v ? { state: v, outcome: 'upgraded' } : { state: null, outcome: 'reset_invalid' }
  }
  return { state: null, outcome: 'reset_invalid' }
}

// ── P71·F3.5 — proyección REDUCIDA del estado para el contrato n8n ────────────────────────────────────
// Un solo cerebro: n8n recibe el MISMO estado conversacional que local-first, en versión mínima y segura
// (tipos/ids/labels/periodo — jamás datos de negocio, valores, secretos ni respuestas). n8n lo usa como
// CONTEXTO para entender referencias; la verdad de datos siguen siendo sus tools (releen siempre).
export type N8nConversationStateLite = {
  activeModule: string | null
  activeCapability: string | null
  activeEntities: Array<{ type: ConvEntityType; id: string; label: string }>
  temporal: { start: string | null; end: string | null; interpretation: string | null } | null
  pendingIntent: { capability: string; missingSlots: string[] } | null
  lastQuery: { module: string; entityType: ConvEntityType | null } | null
}
export function reduceStateForN8n(s: ConversationState): N8nConversationStateLite {
  return {
    activeModule: s.activeModule,
    activeCapability: s.activeCapability,
    activeEntities: s.activeEntities.slice(0, 3).map((e) => ({ type: e.entityType, id: e.entityId, label: e.displayLabel.slice(0, 120) })),
    temporal: s.temporalScope ? { start: s.temporalScope.start, end: s.temporalScope.end, interpretation: s.temporalScope.interpretation } : null,
    pendingIntent: s.pendingIntent ? { capability: s.pendingIntent.capability, missingSlots: [...s.pendingIntent.requiredSlots] } : null,
    lastQuery: s.lastDataQuery ? { module: s.lastDataQuery.module, entityType: s.lastDataQuery.entityType } : null,
  }
}

// ── Persistencia (fail-soft, RLS por workspace+user; reutiliza assistant_agent_memory) ────────────────
export async function loadConversationState(supabase: SupabaseClient, threadId: string, userId: string): Promise<ConversationState> {
  if (!threadId || !userId) return emptyState()
  try {
    const { data } = await supabase
      .from('assistant_agent_memory')
      .select('metadata, expires_at')
      .eq('thread_id', threadId).eq('user_id', userId).eq('memory_type', 'conversation_state')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (!data) { logStateLoad('empty'); return emptyState() }
    const row = data as { metadata?: unknown; expires_at?: string | null }
    if (row.expires_at && Date.parse(row.expires_at) < Date.now()) { logStateLoad('empty'); return emptyState() }
    const { state, outcome } = upgradeConversationState((row.metadata as { state?: unknown } | null)?.state)
    logStateLoad(outcome)
    return state ?? emptyState()
  } catch {
    return emptyState()
  }
}

// Métrica segura del resultado de carga (SIN PII: solo el outcome). Alimenta dashboards de salud del estado.
function logStateLoad(outcome: StateLoadOutcome): void {
  console.log('[conversation-state.load]', { outcome })
}

export async function saveConversationState(
  supabase: SupabaseClient,
  params: { workspaceId: string; userId: string; threadId: string; state: ConversationState },
): Promise<void> {
  const { workspaceId, userId, threadId, state } = params
  if (!workspaceId || !userId || !threadId) return
  try {
    // delete+insert (patrón de saveActiveEntity): loadConversationState lee el más reciente, así que un
    // duplicado eventual por carrera es inofensivo. Nunca se guardan datos de negocio: solo referencias.
    await supabase.from('assistant_agent_memory').delete()
      .eq('thread_id', threadId).eq('user_id', userId).eq('memory_type', 'conversation_state')
    const { error } = await supabase.from('assistant_agent_memory').insert({
      workspace_id: workspaceId, user_id: userId, thread_id: threadId, memory_type: 'conversation_state',
      metadata: { state }, expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    })
    if (error) console.warn('[conversation-state] save failed (fail-soft):', String(error.message).slice(0, 120))
  } catch (e) {
    console.warn('[conversation-state] save threw (fail-soft):', String((e as Error).message).slice(0, 120))
  }
}
