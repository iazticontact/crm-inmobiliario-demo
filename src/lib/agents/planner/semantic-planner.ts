// PROTOTIPO AISLADO — GENERAL SEMANTIC PLANNER. Un ÚNICO modelo interpreta el lenguaje y produce un PLAN
// estructurado (multi-goal), validado por schema. NO ejecuta nada, NO decide permisos, NO confía en IDs del
// modelo: solo INTERPRETA. El executor determinista valida y ejecuta. NO cableado a la route.
//
// Llama a OpenAI Chat Completions por REST (mismo patrón fetch que el resto del repo; sin SDK nuevo).

import { ontologyForPrompt, CAPABILITY_IDS } from './capability-ontology'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

// Operador de SELECCIÓN/cardinalidad: cuántas/ cuáles instancias del conjunto autorizado quiere el usuario.
// Es DATO ESTRUCTURADO, no una keyword que el executor deba adivinar. «un cliente» = one; «uno al azar» =
// random; «los 3 con más...» = top(3); «todos» = all. El executor lo aplica DESPUÉS de obtener el dataset.
export type Selection = 'all' | 'one' | 'first' | 'last' | 'random' | 'top' | 'bottom' | 'n' | 'matching'
// Plan estructurado de una consulta CRM COMPONIBLE (solo cuando capability === 'crm.query'). El servidor lo
// valida contra allowlists; el modelo NO da SQL/tabla/campo/relación arbitrarios ni workspace/ids.
export type CrmQuerySpec = {
  entity: string                 // entidad SEMÁNTICA (clientes/cartera/operaciones/…); se mapea a allowlist
  operation: 'list' | 'search' | 'detail' | 'count' | 'filter' | 'relation' | 'aggregate'
  relation: string | null        // relación registrada (p. ej. operation/events/tasks) para operation=relation
  aggregateFn: 'count' | 'sum' | 'avg' | 'min' | 'max' | null
  aggregateField: string | null  // solo campos declarados agregables
  orderingField: string | null
  orderingDir: 'asc' | 'desc' | null
}
export type PlanGoal = {
  kind: 'read' | 'explain' | 'action'
  capability: string
  entityRef: string | null       // referencia LINGÜÍSTICA (nombre/pronombre/ordinal), NO un id
  filters: Record<string, string | number>
  temporal: string | null        // frase temporal literal («esta semana», «este mes»); el código la resuelve
  aggregation: 'count' | 'sum' | 'average' | 'min' | 'max' | null
  selection: Selection | null    // cardinalidad/selección pedida sobre el conjunto (default all)
  selectionCount: number | null  // para top/bottom/n
  requestedOutput: 'list' | 'detail' | 'count' | 'value' | 'explanation' | null // qué forma de salida quiere
  query: CrmQuerySpec | null      // SOLO para capability 'crm.query': consulta componible estructurada
}
export type Plan = {
  speechAct: 'greet' | 'read_request' | 'action_request' | 'explain_request' | 'confirm' | 'cancel'
    | 'correction' | 'smalltalk' | 'complaint' | 'accept_offer' | 'capability_question' | 'unknown'
  goals: PlanGoal[]
  needsClarification: boolean
  clarificationQuestion: string | null
  proposedStateUpdates: { activeModule?: string | null; offeredCapabilities?: string[] }
  rawModel?: string
}

export type DiscourseState = {
  activeModule: string | null
  activeEntities: Array<{ type: string; label: string }>
  lastListedEntityType: string | null
  offeredCapabilities: string[]     // capabilities que el asistente OFRECIÓ en el turno anterior
  pendingAction: { capability: string; missingSlots: string[] } | null
  temporalScope: string | null
}

const SYSTEM = `Eres el PLANNER de un asistente de CRM inmobiliario. Tu ÚNICA tarea es INTERPRETAR el mensaje del usuario en su contexto y producir un PLAN estructurado. NO ejecutas nada, NO inventas datos, NO decides permisos.

Principios:
- Un mensaje puede tener VARIOS objetivos compatibles a la vez (p. ej. EXPLICAR un módulo Y LEER un dato). Emite un goal por cada uno; no elijas solo uno.
- Distingue el acto comunicativo: saludo, pregunta de datos, petición de acción, pregunta de CAPACIDAD («¿puedo…?», «¿se puede…?» → NO es querer hacerlo), explicación, confirmación, cancelación, corrección, aceptación de una oferta previa, smalltalk, queja.
- Referencias: pronombres/elipsis/ordinales se refieren a las entidades del contexto (activeEntities / lastListedEntity). Devuelve la REFERENCIA lingüística en entityRef (nombre u «ordinal:1», «pronombre», «el más caro»); el código la resolverá contra datos reales. Nunca inventes un id.
- DETALLE vs BÚSQUEDA vs INSTANCIA (principio general): «.detail» SOLO cuando hay UNA entidad IDENTIFICADA (por nombre, pronombre u ordinal) → ponla en entityRef. Si el usuario quiere UNA instancia pero SIN identificarla («un cliente cualquiera», «algún piso», «uno al azar»), NO uses «.detail» (no hay a quién): usa la capability de LISTA («.list») con selection (one/random/first/last) y requestedOutput=detail; el código elegirá la instancia. Usa «.search» solo para localizar por término parcial. El detalle/instancia deja esa entidad como referente; la búsqueda no.
- SELECCIÓN/CARDINALIDAD (principio general): distingue CUÁNTAS instancias del conjunto quiere el usuario y ponlo en «selection» (no en el texto). «un cliente/algún piso» → one; «uno al azar/cualquiera» → random; «el primero/el último» → first/last; «un par/dos» → n con selectionCount=2; «los 3 con más valor/top 5» → top con selectionCount; «los peores» → bottom; «todos/la lista/en total» → all; sin pista → all.
- INTROSPECCIÓN DE CAPACIDADES (principio general): si el usuario pregunta QUÉ PUEDES HACER (en general, en un módulo, o con la entidad activa) o SI PUEDES hacer algo concreto («¿puedes cambiarle el teléfono?», «¿qué puedo hacer con este cliente?», «qué cosas haces»), es speechAct=capability_question y el ÚNICO goal es «capabilities.introspect» (NO una acción, NO una búsqueda, NO explain.module). Pon en filters.module el módulo si lo menciona, y en filters.about la acción concreta si pregunta por una. NO CONFUNDAS explain.module (explica CÓMO FUNCIONA / para qué sirve un módulo) con capabilities.introspect (QUÉ PUEDE HACER EL ASISTENTE: qué lee y qué acciones prepara). Toda pregunta sobre las habilidades del asistente → capabilities.introspect. El código deriva las capacidades reales del registro; tú NO las enumeras ni las inventas.
- ACTO vs OBJETIVO (principio general): separa DE QUÉ habla (entidad/módulo) de QUÉ hace lingüísticamente. Preguntar por capacidades SOBRE una entidad X NO es buscar X: es capabilities.introspect con esa entidad como contexto, nunca clients.search(X).
- Si el usuario ACEPTA una oferta previa («sí», «vale», «enséñamelas», «adelante») y hay offeredCapabilities en el estado, speechAct=accept_offer y crea un goal por cada capability ofrecida. Interpreta la aceptación/negación/corrección por SEMÁNTICA respecto a la oferta y al foco actual, no por palabras sueltas.
- FOCO Y CAMBIO DE TEMA (principio general): si el usuario cambia explícitamente de módulo/tema, el nuevo objetivo MANDA sobre el foco anterior incompatible; no arrastres la entidad/intención vieja a un follow-up que ya no le corresponde. Conserva un referente solo si sigue siendo compatible con el nuevo foco.
- CONSULTA COMPONIBLE (crm.query) — principio general, sin ejemplos de frases: PREFIERE siempre una capability ESPECIALIZADA cuando exista para lo que se pide (es la abstracción correcta y más clara: clients.count, calendar.list, operations.aggregate.value, commissions.aggregate, clients.relation.*, portfolio.list, etc.). Usa crm.query SOLO cuando el objetivo requiera COMPONER una lectura que ninguna capability fija cubre limpiamente (p. ej. una relación de una entidad + un filtro + un periodo + un agregado sobre un campo + una selección/orden concretos, todo a la vez). Cuando uses crm.query, rellena el campo «query»: entity (semántica, p. ej. «operaciones»/«cartera»), operation (list/search/detail/count/filter/relation/aggregate), relation si aplica, aggregateFn+aggregateField para agregados, orderingField+orderingDir para orden; y usa entityRef (entidad base para detail/relation), filters, temporal y selection del propio goal. NUNCA pongas SQL, nombre de tabla, campo o relación inventados: el servidor los valida contra allowlists y rechaza lo que no exista. crm.query es READ-ONLY (nunca escribe). No lo uses como catch-all ni para lo que ya tiene capability especializada.
- Elige capabilities SOLO de la ontología dada (por id exacto). Si ninguna encaja o falta un dato imprescindible y no puede inferirse, needsClarification=true con una pregunta ESPECÍFICA (no genérica).
- Datos económicos: distingue «operaciones/valor» de «comisiones» (generado/cobrado/pendiente). Comisiones NO es Facturación oficial. Si «cuánto hemos generado» es ambiguo entre valor de operaciones y comisiones, pide aclaración específica.
- temporal: copia la expresión temporal literal del usuario si la hay; no la conviertas a fechas.
- NUNCA uses una capability de Facturación (no existe en la ontología); si el usuario pide facturas, needsClarification o redirígelo, jamás inventes acceso.

Devuelve EXCLUSIVAMENTE el JSON del schema.`

// JSON schema estricto para structured output.
// strict:false — el structured output estricto de OpenAI no admite objetos abiertos (filters) ni enums
// nullable; en modo no estricto el schema SIGUE guiando al modelo y validamos nosotros tras el parseo.
const SCHEMA = {
  name: 'crm_plan', strict: false,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['speechAct', 'goals', 'needsClarification', 'clarificationQuestion', 'proposedStateUpdates'],
    properties: {
      speechAct: { type: 'string', enum: ['greet', 'read_request', 'action_request', 'explain_request', 'confirm', 'cancel', 'correction', 'smalltalk', 'complaint', 'accept_offer', 'capability_question', 'unknown'] },
      goals: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['kind', 'capability', 'entityRef', 'filters', 'temporal', 'aggregation', 'selection', 'selectionCount', 'requestedOutput', 'query'],
          properties: {
            kind: { type: 'string', enum: ['read', 'explain', 'action'] },
            capability: { type: 'string' },
            entityRef: { type: ['string', 'null'] },
            filters: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
            temporal: { type: ['string', 'null'] },
            aggregation: { type: ['string', 'null'], enum: ['count', 'sum', 'average', 'min', 'max', null] },
            selection: { type: ['string', 'null'], enum: ['all', 'one', 'first', 'last', 'random', 'top', 'bottom', 'n', 'matching', null] },
            selectionCount: { type: ['number', 'null'] },
            requestedOutput: { type: ['string', 'null'], enum: ['list', 'detail', 'count', 'value', 'explanation', null] },
            query: {
              type: ['object', 'null'], additionalProperties: false,
              properties: {
                entity: { type: 'string' },
                operation: { type: 'string', enum: ['list', 'search', 'detail', 'count', 'filter', 'relation', 'aggregate'] },
                relation: { type: ['string', 'null'] },
                aggregateFn: { type: ['string', 'null'], enum: ['count', 'sum', 'avg', 'min', 'max', null] },
                aggregateField: { type: ['string', 'null'] },
                orderingField: { type: ['string', 'null'] },
                orderingDir: { type: ['string', 'null'], enum: ['asc', 'desc', null] },
              },
            },
          },
        },
      },
      needsClarification: { type: 'boolean' },
      clarificationQuestion: { type: ['string', 'null'] },
      proposedStateUpdates: {
        type: 'object', additionalProperties: false, required: ['activeModule', 'offeredCapabilities'],
        properties: { activeModule: { type: ['string', 'null'] }, offeredCapabilities: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
}

export type PlanResult = { ok: true; plan: Plan; ms: number; usage?: unknown } | { ok: false; error: string; ms: number }

export async function planTurn(message: string, state: DiscourseState, opts: { apiKey: string; model?: string } ): Promise<PlanResult> {
  const t0 = Date.now()
  const userPrompt = `ONTOLOGÍA DE CAPABILITIES (elige por id exacto):\n${ontologyForPrompt()}\n\nESTADO DEL DISCURSO:\n${JSON.stringify(state)}\n\nMENSAJE DEL USUARIO:\n${message}`
  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model ?? 'gpt-4.1-mini', temperature: 0.1,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt }],
        response_format: { type: 'json_schema', json_schema: SCHEMA },
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) { return { ok: false, error: `fetch_error:${(e as Error).message.slice(0, 60)}`, ms: Date.now() - t0 } }
  if (!res.ok) return { ok: false, error: `http_${res.status}:${(await res.text().catch(() => '')).slice(0, 120)}`, ms: Date.now() - t0 }
  const j = await res.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown } | null
  const content = j?.choices?.[0]?.message?.content
  if (!content) return { ok: false, error: 'empty_completion', ms: Date.now() - t0 }
  let parsed: Plan
  try { parsed = JSON.parse(content) as Plan } catch { return { ok: false, error: 'invalid_json', ms: Date.now() - t0 } }
  // Validación de PLAN (defensa: el modelo propone, el código dispone): capabilities ∈ ontología.
  parsed.goals = (parsed.goals ?? []).filter((g) => CAPABILITY_IDS.has(g.capability))
  parsed.rawModel = opts.model ?? 'gpt-4.1-mini'
  return { ok: true, plan: parsed, ms: Date.now() - t0, usage: j?.usage }
}
