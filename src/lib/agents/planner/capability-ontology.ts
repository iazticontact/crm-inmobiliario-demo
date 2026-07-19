// PROTOTIPO AISLADO (general-semantic-planner) — ONTOLOGÍA DE CAPABILITIES.
// NO está cableado a la route ni a producción. Describe QUÉ puede hacer el asistente como un catálogo
// estructurado (no una lista de preguntas). El planner LLM recibe esta ontología y SELECCIONA capabilities;
// el executor determinista VALIDA y ejecuta. Las capabilities de acción se DERIVAN del registry P65 real
// (ASSISTANT_ACTIONS) para no duplicar la verdad. Las de lectura se alinean con los readers reales.

import { ASSISTANT_ACTIONS, type AssistantActionDefinition } from '../action-registry'

export type OperationClass =
  | 'list' | 'search' | 'detail' | 'count' | 'aggregate' | 'relation' | 'summarize' | 'compare' | 'explain'
  | 'create' | 'update' | 'schedule' | 'automate'

export type EntityType =
  | 'client' | 'property' | 'opportunity' | 'task' | 'calendar_event' | 'service_case' | 'document' | 'commission' | 'none'

export type CapabilitySpec = {
  id: string
  description: string            // descripción SEMÁNTICA (para que el modelo entienda cuándo aplica)
  module: string
  operation: OperationClass
  entityTypes: EntityType[]
  requiredSlots: string[]        // qué necesita para ejecutarse
  optionalFilters: string[]
  temporal: { field: string; supported: boolean } | null
  reader: string | null          // reader/tool determinista que la implementa (o el actionType)
  mutation: boolean
  confirmation: 'none' | 'preview_confirm'
  freshness: 'live'              // el dato SIEMPRE se lee en vivo
  permission: 'read' | 'write'
}

// ── Lecturas (alineadas con agent-tool-readers + composición temporal P71) ────────────────────────────
const READ_CAPABILITIES: CapabilitySpec[] = [
  { id: 'clients.list', description: 'Listar o contar los clientes del workspace (opcionalmente por estado o búsqueda).', module: 'clients', operation: 'list', entityTypes: ['client'], requiredSlots: [], optionalFilters: ['status', 'query'], temporal: null, reader: 'crmReadQuery:clients', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'clients.count', description: 'Cuántos clientes hay (agregado de conteo).', module: 'clients', operation: 'count', entityTypes: ['client'], requiredSlots: [], optionalFilters: ['status'], temporal: null, reader: 'crmReadQuery:clients', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'clients.search', description: 'Buscar un cliente concreto por nombre/empresa/email/teléfono.', module: 'clients', operation: 'search', entityTypes: ['client'], requiredSlots: ['query'], optionalFilters: [], temporal: null, reader: 'searchClients', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'clients.detail', description: 'Ficha 360 de UN cliente concreto (datos + tareas + citas + documentos).', module: 'clients', operation: 'detail', entityTypes: ['client'], requiredSlots: ['entity'], optionalFilters: [], temporal: null, reader: 'getClient360', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'clients.relation.operations', description: 'Operaciones de UN cliente concreto.', module: 'operations', operation: 'relation', entityTypes: ['client', 'opportunity'], requiredSlots: ['entity'], optionalFilters: [], temporal: { field: 'expected_close_date', supported: true }, reader: 'getClientOpportunities', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'clients.relation.tasks', description: 'Tareas de UN cliente concreto (opcionalmente en un periodo).', module: 'tasks', operation: 'relation', entityTypes: ['client', 'task'], requiredSlots: ['entity'], optionalFilters: ['status'], temporal: { field: 'due_date', supported: true }, reader: 'tasks.byClient', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'clients.relation.events', description: 'Citas de UN cliente concreto (opcionalmente en un periodo).', module: 'calendar', operation: 'relation', entityTypes: ['client', 'calendar_event'], requiredSlots: ['entity'], optionalFilters: [], temporal: { field: 'date', supported: true }, reader: 'calendar.byClient', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'clients.relation.properties', description: 'Inmuebles vinculados a UN cliente concreto.', module: 'portfolio', operation: 'relation', entityTypes: ['client', 'property'], requiredSlots: ['entity'], optionalFilters: [], temporal: null, reader: 'properties.byClient', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'portfolio.list', description: 'Listar/contar inmuebles de la cartera (por estado, ciudad, tipo, operación, precio).', module: 'portfolio', operation: 'list', entityTypes: ['property'], requiredSlots: [], optionalFilters: ['status', 'city', 'type', 'operation', 'minPrice', 'maxPrice'], temporal: null, reader: 'searchProperties', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'portfolio.detail', description: 'Detalle de UN inmueble concreto.', module: 'portfolio', operation: 'detail', entityTypes: ['property'], requiredSlots: ['entity'], optionalFilters: [], temporal: null, reader: 'searchProperties', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'portfolio.summary', description: 'Resumen de la cartera por estado (conteos).', module: 'portfolio', operation: 'summarize', entityTypes: ['property'], requiredSlots: [], optionalFilters: [], temporal: null, reader: 'crmReadQuery:properties', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'operations.list', description: 'Listar/contar operaciones/oportunidades (por etapa; abiertas/ganadas/perdidas).', module: 'operations', operation: 'list', entityTypes: ['opportunity'], requiredSlots: [], optionalFilters: ['stage'], temporal: { field: 'expected_close_date', supported: true }, reader: 'crmReadQuery:opportunities', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'operations.aggregate.value', description: 'Sumar el VALOR de operaciones (p. ej. valor total de ventas ganadas en un periodo).', module: 'operations', operation: 'aggregate', entityTypes: ['opportunity'], requiredSlots: [], optionalFilters: ['stage'], temporal: { field: 'expected_close_date', supported: true }, reader: 'crmReadQuery:opportunities', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'commissions.aggregate', description: 'Métricas de COMISIONES/honorarios (generado, cobrado, pendiente) — NO es Facturación oficial; es la comisión comercial de las operaciones.', module: 'commissions', operation: 'aggregate', entityTypes: ['commission', 'opportunity'], requiredSlots: [], optionalFilters: ['commission_status'], temporal: { field: 'expected_close_date', supported: true }, reader: 'crmReadQuery:opportunities', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'tasks.list', description: 'Listar/contar tareas pendientes (opcionalmente en un periodo).', module: 'tasks', operation: 'list', entityTypes: ['task'], requiredSlots: [], optionalFilters: ['priority'], temporal: { field: 'due_date', supported: true }, reader: 'getPendingTasks', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'calendar.list', description: 'Citas/agenda (hoy, esta semana, un periodo).', module: 'calendar', operation: 'list', entityTypes: ['calendar_event'], requiredSlots: [], optionalFilters: ['type'], temporal: { field: 'date', supported: true }, reader: 'getCalendarSummary', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'cases.list', description: 'Trámites/expedientes (por estado, vencimiento en un periodo).', module: 'cases', operation: 'list', entityTypes: ['service_case'], requiredSlots: [], optionalFilters: ['status'], temporal: { field: 'due_date', supported: true }, reader: 'crmReadQuery:service_cases', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'findings.list', description: 'Qué requiere atención: incidencias de calidad de datos abiertas.', module: 'findings', operation: 'list', entityTypes: ['none'], requiredSlots: [], optionalFilters: [], temporal: null, reader: 'automation:run_data_quality', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'crm.summary', description: 'Resumen operativo del día con datos reales (multi-fuente).', module: 'dashboard', operation: 'summarize', entityTypes: ['none'], requiredSlots: [], optionalFilters: [], temporal: null, reader: 'executiveSummary', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  // Explicaciones de producto (NO leen datos): un goal legítimo, compatible con lecturas en el mismo turno.
  { id: 'explain.module', description: 'Explicar cómo funciona un módulo del CRM o para qué sirve (guía de producto; NO lee datos).', module: 'any', operation: 'explain', entityTypes: ['none'], requiredSlots: ['module'], optionalFilters: [], temporal: null, reader: 'moduleCatalog', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  { id: 'onboarding.tour', description: 'Bienvenida/tour para un usuario nuevo (guía; NO lee datos).', module: 'any', operation: 'explain', entityTypes: ['none'], requiredSlots: [], optionalFilters: [], temporal: null, reader: 'onboarding', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
  // INTROSPECCIÓN: qué puede hacer el asistente (global / en un módulo / con la entidad activa / si puede
  // una acción concreta). La respuesta se DERIVA de los registries (ontología + acciones), nunca de texto.
  { id: 'capabilities.introspect', description: 'Explicar QUÉ puede hacer el asistente (leer/preparar acciones) en general, en un módulo o sobre una entidad; o si puede realizar una acción concreta. Deriva las capacidades reales del registro; no ejecuta nada.', module: 'any', operation: 'explain', entityTypes: ['none'], requiredSlots: [], optionalFilters: ['module', 'about'], temporal: null, reader: 'introspect', mutation: false, confirmation: 'none', freshness: 'live', permission: 'read' },
]

// ── Acciones (DERIVADAS del registry P65 real; jamás inventadas) ──────────────────────────────────────
const OP_BY_KIND: Record<string, OperationClass> = { insert: 'create', update: 'update' }
function actionCapability(def: AssistantActionDefinition): CapabilitySpec {
  const et = (def.table === 'clients' ? 'client' : def.table === 'properties' ? 'property' : def.table === 'opportunities' ? 'opportunity' : def.table === 'tasks' ? 'task' : def.table === 'calendar_events' ? 'calendar_event' : def.table === 'service_cases' ? 'service_case' : 'none') as EntityType
  const op: OperationClass = def.module === 'calendar' && def.kind === 'insert' ? 'schedule' : OP_BY_KIND[def.kind]
  return {
    id: def.id, description: def.description, module: def.module, operation: op,
    entityTypes: def.requiredEntity ? [et] : [et].filter((x) => x !== 'none') as EntityType[],
    requiredSlots: [...(def.requiredEntity ? ['entity'] : []), ...def.allowedFields.filter((f) => !['start_at', 'end_at'].includes(f))],
    optionalFilters: [], temporal: null, reader: def.id, mutation: true,
    confirmation: 'preview_confirm', freshness: 'live', permission: 'write',
  }
}
const ACTION_CAPABILITIES: CapabilitySpec[] = Object.values(ASSISTANT_ACTIONS).map(actionCapability)

export const CAPABILITY_ONTOLOGY: CapabilitySpec[] = [...READ_CAPABILITIES, ...ACTION_CAPABILITIES]
export const CAPABILITY_IDS: ReadonlySet<string> = new Set(CAPABILITY_ONTOLOGY.map((c) => c.id))

// Proyección COMPACTA para el prompt del planner (sin ruido): id · op · entidades · descripción · slots.
export function ontologyForPrompt(): string {
  return CAPABILITY_ONTOLOGY.map((c) =>
    `${c.id} [${c.operation}${c.mutation ? '·MUTA' : ''}${c.temporal?.supported ? '·temporal' : ''}] (${c.entityTypes.join('/')}) — ${c.description}${c.requiredSlots.length ? ` · req:${c.requiredSlots.join(',')}` : ''}`,
  ).join('\n')
}
export function getCapability(id: string): CapabilitySpec | null {
  return CAPABILITY_ONTOLOGY.find((c) => c.id === id) ?? null
}

// ── Introspección DERIVADA de los registries (single source of truth) ─────────────────────────────────
// Responde «qué puedes hacer» (global / por módulo / por tipo de entidad) o «puedes X» sin texto manual.
// El módulo del prompt y del executor consumen ESTO; jamás una descripción paralela que pueda divergir.
export type CapabilityIntrospection = {
  scope: { module: string | null; entityType: EntityType | null; about: string | null }
  read: Array<{ id: string; description: string }>
  write: Array<{ id: string; description: string; confirmation: string; fields: string[] }>
  can: boolean | null            // respuesta a «¿puedes X?» si `about` matchea una capability
  note: string
}
export function introspectCapabilities(args: { module?: string | null; entityType?: EntityType | null; about?: string | null } = {}): CapabilityIntrospection {
  const mod = args.module ? args.module.toLowerCase() : null
  const et = args.entityType ?? null
  const matchScope = (c: CapabilitySpec) =>
    (!mod || c.module === mod || c.module === 'any') && (!et || c.entityTypes.includes(et))
  const isInternal = (c: CapabilitySpec) => c.id === 'capabilities.introspect' || c.reader === 'onboarding'
  const relevant = CAPABILITY_ONTOLOGY.filter((c) => matchScope(c) && !isInternal(c))
  const read = relevant.filter((c) => !c.mutation).map((c) => ({ id: c.id, description: c.description }))
  const write = relevant.filter((c) => c.mutation).map((c) => {
    const def = ASSISTANT_ACTIONS[c.id as keyof typeof ASSISTANT_ACTIONS]
    return { id: c.id, description: c.description, confirmation: c.confirmation, fields: def ? def.allowedFields : [] }
  })
  // «¿puedes X?» → ¿existe una capability (de acción o lectura) que encaje con `about` dentro del scope?
  let can: boolean | null = null
  if (args.about) {
    const about = args.about.toLowerCase()
    can = relevant.some((c) => c.id.toLowerCase().includes(about) || c.description.toLowerCase().includes(about))
  }
  return { scope: { module: mod, entityType: et, about: args.about ?? null }, read, write, can, note: 'Derivado del registro real; las acciones requieren tu confirmación.' }
}
