// Contrato ÚNICO de decisión por turno del Asistente (P50) — PURO.
//
// Regla absoluta: ninguna entidad del CRM provoca una consulta por sí sola. ANTES de leer/escribir/llamar
// a n8n, el sistema decide QUÉ acto comunicativo hace el usuario. Las clases "meta" (el usuario habla de la
// respuesta del Asistente, corrige, se queja o discrepa) NUNCA leen datos, aunque mencionen entidades.
//
// Este módulo absorbe P48 (intención/entidad) y P49 (pragmática) y añade la capa meta con prioridad máxima.
// No hardcodea frases: diccionarios de señales + orden de prioridad. Devuelve una decisión estructurada +
// traza segura para depurar por qué se hizo (o no) una lectura.

import { foldText } from '@/lib/real-estate-search'
import { classifyIntent, type CrmEntity } from './intent'
import { classifyPragmatics } from './assistant-pragmatics'
import { resolveModuleFromText, type CrmModuleId } from './crm-module-catalog'
import { classifySummaryIntent, isLearningContext, wantsFullTour } from '@/lib/summary-intent'

export type TurnType =
  | 'social' | 'help' | 'capability' | 'how_it_works' | 'hypothetical'
  // P53 — guía de producto (explican, NUNCA leen datos):
  | 'onboarding' | 'module_explanation' | 'navigation_help' | 'user_confused'
  | 'data_read' | 'data_write' | 'data_followup'
  | 'assistant_meta' | 'user_correction' | 'user_complaint' | 'disagreement'
  | 'clarification' | 'ambiguous' | 'unsupported'

export type TurnDomain =
  | 'clients' | 'properties' | 'operations' | 'commissions' | 'calendar'
  | 'tasks' | 'cases' | 'documents' | 'invoicing' | 'assistant' | 'general' | null

export type TurnAction =
  | 'answer' | 'explain' | 'guide' | 'read' | 'write_prepare' | 'clarify'
  | 'apologize' | 'use_context' | 'redirect' | 'handoff_n8n' | 'unsupported'

export type AssistantTurnDecision = {
  turnType: TurnType
  domain: TurnDomain
  module: CrmModuleId | null   // P53 — módulo del CRM al que se refiere el turno (para la guía de producto)
  action: TurnAction
  shouldReadData: boolean
  shouldWriteData: boolean
  shouldCallN8n: boolean
  shouldUseLastResult: boolean
  shouldAskClarification: boolean
  shouldExplainAssistantBehavior: boolean
  shouldExplainProduct: boolean // P53 — el turno pide guía/explicación de producto (no datos)
  confidence: number
  reason: string
}

// ── Señales META (prioridad máxima; el usuario habla DEL Asistente / corrige / se queja) ──────────────
const ASSISTANT_META = /\b(tu respuesta|tus respuestas|lo que (dijiste|has dicho|respondiste|pusiste)|por que (me |te |nos )?(respondes|respondiste|dices|dijiste|contestas|listas|listaste|das|muestras|pones|sacas|sacaste|hiciste|has hecho|has listado|has puesto)|que (haces|estas haciendo)|no (entiendes|razonas|piensas)|respondes mecanicamente|de forma mecanica|como un robot|no te (pedi|he pedido)|eso no es lo que|para que me (das|muestras|listas)|no (me )?(listes|muestres|ensenes|saques|des) (datos|listas|nada|mas datos))\b/
const USER_CORRECTION = /\b(no me refiero|me refiero a|me referia|estaba hablando de|queria decir|quiero decir|no era eso|no es eso|no,? no era|corrige|te has (confundido|liado|equivocado)|no es a eso)\b/

// ── Señales de GUÍA DE PRODUCTO (P53): aprender/navegar/entender el CRM. NUNCA leen datos. ────────────
const CONFUSED = /\b(no (lo |le |te )?entiendo|no entendi|no me (queda claro|entero|aclaro)|estoy perdid[oa]|me he perdido|me pierdo|esto me confunde|me confunde|no se que (es esto|significa esto|hace esto))\b/
const ONBOARDING = /\b(soy nuev[oa]|somos nuevos|acabo de (empezar|llegar|entrar|registrarme)|primera vez que (uso|entro)|nunca he usado|recien (empiezo|llegue)|empezar a usarlo|por donde (empiezo|se empieza)|como empiezo)\b/
const NAVIGATION = /\b(donde (esta|estan|encuentro|veo|puedo ver)|como (llego|accedo|entro|voy) a|en que (menu|apartado|pantalla|seccion|parte) (esta|estan|encuentro)|desde donde se)\b/
// «qué muestra/resume/significa X», «para qué sirve X», «qué es este apartado», «explícame X», «cómo se usa».
// OJO: NO incluye «qué hay en <entidad>» ni «muéstrame» (eso es lectura de datos).
const EXPLAIN_PRODUCT = /\b(que (muestra|muestran|resume|resumen|ensena|indica|refleja|significa|significan)|para que (sirve|es|vale)|que es (este|esta|ese|esa|el|la|un|una)\b|que son (los|las|estos|estas)|que hacen?\b(?! falta)|que se ve en|que aparece en|que hay en (este|esta|el apartado|la pantalla|la seccion)|me explicas|explicame|explica (este|esta|el|la|como)|como se usa|como uso|en que consiste)\b/
const USER_COMPLAINT = /\b(esto esta mal|no funciona|que mal|no sirve|es un desastre|otra vez lo mismo|siempre (haces|respondes|contestas) (lo mismo|igual)|muy mal|no me ayudas|vaya (fallo|desastre)|no vas bien|fatal)\b/
const DISAGREEMENT = /\b(no estoy de acuerdo|eso no es correcto|te equivocas|estas equivocado|eso es falso|no es verdad|es incorrecto|eso esta mal|no es asi)\b/

function domainOf(entity: CrmEntity): TurnDomain {
  switch (entity) {
    case 'clients': return 'clients'
    case 'properties': return 'properties'
    case 'operations': return 'operations'
    case 'commissions': return 'commissions'
    case 'calendar': return 'calendar'
    case 'tasks': return 'tasks'
    case 'service_cases': return 'cases'
    case 'documents': return 'documents'
    case 'invoicing': return 'invoicing'
    case 'help': return 'assistant'
    default: return 'general'
  }
}

function base(turnType: TurnType, domain: TurnDomain, action: TurnAction, reason: string, over: Partial<AssistantTurnDecision> = {}): AssistantTurnDecision {
  return {
    turnType, domain, module: null, action, reason, confidence: 0.8,
    shouldReadData: false, shouldWriteData: false, shouldCallN8n: false,
    shouldUseLastResult: false, shouldAskClarification: false, shouldExplainAssistantBehavior: false,
    shouldExplainProduct: false,
    ...over,
  }
}

export function decideTurn(
  message: string,
  ctx: { priorEntity?: CrmEntity; hasLastResult?: boolean; priorModule?: CrmModuleId | null } = {},
): AssistantTurnDecision {
  const d = decideTurnInner(message, ctx)
  // El módulo del CRM al que se refiere el mensaje se resuelve SIEMPRE (útil también para meta/corrección),
  // con fallback al módulo del contexto en turnos de guía sin módulo propio (p. ej. «no entiendo»).
  const own = resolveModuleFromText(message)
  const resolvedModule = own ?? (d.shouldExplainProduct ? ctx.priorModule ?? null : null)
  return resolvedModule ? { ...d, module: resolvedModule } : d
}

function decideTurnInner(
  message: string,
  ctx: { priorEntity?: CrmEntity; hasLastResult?: boolean; priorModule?: CrmModuleId | null } = {},
): AssistantTurnDecision {
  const n = foldText(message)
  const entity = classifyIntent(message, { priorEntity: ctx.priorEntity }).entity
  const domain = domainOf(entity)

  // 1) META (máxima prioridad): el usuario habla de la respuesta del Asistente / corrige / se queja /
  //    discrepa. NUNCA se lee dato, aunque el mensaje mencione cualquier entidad CRM.
  if (ASSISTANT_META.test(n)) return base('assistant_meta', 'assistant', 'explain', 'assistant-meta', { shouldExplainAssistantBehavior: true, confidence: 0.9 })
  if (USER_CORRECTION.test(n)) return base('user_correction', domain, 'clarify', 'user-correction', { shouldExplainAssistantBehavior: true, shouldAskClarification: true, confidence: 0.88 })
  if (USER_COMPLAINT.test(n)) return base('user_complaint', 'assistant', 'apologize', 'user-complaint', { shouldExplainAssistantBehavior: true, confidence: 0.85 })
  if (DISAGREEMENT.test(n)) return base('disagreement', 'assistant', 'apologize', 'disagreement', { shouldExplainAssistantBehavior: true, confidence: 0.85 })

  // 1a-P62) ALCANCE GLOBAL explícito («todo el CRM», «explícame todo», «en general»): SIEMPRE gana al
  //     módulo del contexto — una petición global no puede quedar atrapada en el módulo anterior
  //     (incidente: «explícame todo el crm resumido» tras Calendario explicaba solo Calendario).
  if (wantsFullTour(message) || /\b(en general|el crm entero|todo el sistema)\b/.test(n)) {
    return base('onboarding', 'general', 'guide', 'p62:global-scope', { shouldExplainProduct: true, confidence: 0.85 })
  }

  // 1b) P53 — GUÍA DE PRODUCTO (aprender/navegar/entender): SIEMPRE explica, NUNCA lee datos, aunque el
  //     mensaje mencione un módulo o entidad («¿qué muestra el dashboard?» ≠ «muéstrame los clientes»).
  if (CONFUSED.test(n)) return base('user_confused', domain, 'explain', 'p53:confused', { shouldExplainProduct: true, confidence: 0.85 })
  if (ONBOARDING.test(n)) return base('onboarding', 'general', 'guide', 'p53:onboarding', { shouldExplainProduct: true, confidence: 0.85 })
  if (NAVIGATION.test(n)) return base('navigation_help', domain, 'guide', 'p53:navigation', { shouldExplainProduct: true })
  if (EXPLAIN_PRODUCT.test(n)) return base('module_explanation', domain, 'explain', 'p53:explain-product', { shouldExplainProduct: true, confidence: 0.85 })

  // 1b-P60) RESUMEN conceptual vs operativo + LEARNING CONTEXT. «resumen»/«para entender»/«soy nuevo/
  //   estamos valorando» NO pueden leer datos a ciegas: conceptual/aprendizaje → tour de producto (explica,
  //   NUNCA lee); resumen ambiguo («hazme un resumen» a secas) → pide aclaración; resumen OPERATIVO
  //   («del día/con mis datos/qué tengo pendiente») cae al data_read normal. Va DESPUÉS de meta/corrección
  //   (esos ganan) y de la guía por módulo (p. ej. «¿qué muestra el dashboard?»).
  const summaryKind = classifySummaryIntent(message)
  if (isLearningContext(message) || summaryKind === 'conceptual') {
    return base('onboarding', 'general', 'guide', 'p60:learning-tour', { shouldExplainProduct: true, confidence: 0.85 })
  }
  if (summaryKind === 'ambiguous') {
    return base('ambiguous', 'general', 'clarify', 'p60:ambiguous-summary', { shouldAskClarification: true, confidence: 0.6 })
  }

  // 1c) P56 — LECTURA FRESCA: «mira otra vez», «acabo de editar», «revisa», «cambios recientes» →
  //     lectura EN VIVO del dominio (nunca responder desde lastResults/caché). Va ANTES de la pragmática
  //     para que «otra vez/revisa» no se trague como confirmación del resultado anterior.
  if (/\b(mira(lo)? otra vez|revisa(lo)?|refresca|vuelve a mirar|actualizad[oa]s?|acabo de (cambiar|editar|guardar|crear|anadir)|he (editado|cambiado|guardado|creado)|cambios recientes|ultim[oa]s cambios|recientemente)\b/.test(n)) {
    const freshDomain = domain !== 'general' && domain !== 'assistant' ? domain : (ctx.priorEntity ? domainOf(ctx.priorEntity) : domain)
    return base('data_read', freshDomain, 'read', 'p56:fresh-read', { shouldReadData: true, confidence: 0.85 })
  }

  // 2) Pragmática (P49): acto comunicativo antes que entidad.
  const prag = classifyPragmatics(message)
  switch (prag.speechAct) {
    case 'greeting':
    case 'smalltalk':
      return base('social', 'assistant', 'answer', `pragmatics:${prag.speechAct}`, { confidence: 0.75 })
    case 'help_request':
      return base('help', 'assistant', 'explain', 'pragmatics:help', { shouldExplainAssistantBehavior: true })
    case 'capability_question':
    case 'permission_or_can_you_question':
      return base('capability', domain, 'explain', 'pragmatics:capability', { shouldExplainAssistantBehavior: true })
    case 'how_it_works_question':
      return base('how_it_works', domain, 'explain', 'pragmatics:how', { shouldExplainAssistantBehavior: true })
    case 'hypothetical_future_question':
      return base('hypothetical', domain, 'explain', 'pragmatics:future', { shouldExplainAssistantBehavior: true })
    case 'data_write_request':
      return base('data_write', domain, 'write_prepare', 'pragmatics:write', { shouldWriteData: true, shouldCallN8n: true })
    case 'confirmation_request':
      return base('data_followup', domain, 'use_context', 'pragmatics:confirm', { shouldUseLastResult: true, confidence: 0.82 })
    case 'correction':
      return base('user_correction', domain, 'clarify', 'pragmatics:correction', { shouldExplainAssistantBehavior: true, shouldAskClarification: true })
    case 'follow_up_detail':
      return base('data_followup', domain, 'use_context', 'pragmatics:detail', { shouldUseLastResult: true, shouldReadData: ctx.hasLastResult !== false, confidence: 0.8 })
    case 'follow_up_filter':
      return base('data_followup', domain, 'read', 'pragmatics:filter', { shouldReadData: true, shouldUseLastResult: true, confidence: 0.8 })
    case 'data_read_request': {
      // Facturación NO se lee desde el Asistente general → redirección (sin tools).
      if (domain === 'invoicing') return base('data_read', 'invoicing', 'redirect', 'invoicing-isolated', { confidence: 0.85 })
      return base('data_read', domain, 'read', 'pragmatics:read', { shouldReadData: true, confidence: 0.85 })
    }
    default:
      break
  }

  // 2b) P55 — cambio de tema con SOLO el nombre del módulo («ahora cartera», «vale, y clientes»,
  //     «facturas»): mensaje corto sin verbo de datos → explicar ese módulo (nunca lectura a ciegas).
  const shortWords = n.replace(/[¿?¡!.,;:]/g, ' ').split(/\s+/).filter(Boolean)
  if (shortWords.length <= 3 && resolveModuleFromText(message)) {
    return base('module_explanation', domain, 'explain', 'p55:module-switch', { shouldExplainProduct: true, confidence: 0.7 })
  }

  // 3) Nada claro → aclaración / cerebro general (nunca lectura a ciegas).
  if (domain === 'invoicing') return base('data_read', 'invoicing', 'redirect', 'invoicing-isolated', {})
  return base('ambiguous', domain === 'general' ? 'general' : domain, 'clarify', 'no-signal', { shouldAskClarification: true, shouldCallN8n: true, confidence: 0.3 })
}

// ── Generadores de recuperación (meta/corrección/queja/discrepancia) — PUROS, sin leer datos ──────────
const DOMAIN_LABEL: Record<Exclude<TurnDomain, null>, string> = {
  clients: 'clientes', properties: 'inmuebles', operations: 'operaciones', commissions: 'comisiones',
  calendar: 'citas', tasks: 'tareas', cases: 'trámites', documents: 'documentos', invoicing: 'facturas',
  assistant: 'el CRM', general: 'el CRM',
}

function domainHint(domain: TurnDomain): string {
  return domain && domain !== 'assistant' && domain !== 'general' ? ` de ${DOMAIN_LABEL[domain]}` : ''
}

export function assistantMetaAnswer(domain: TurnDomain): string {
  return `Buena observación. Solo consulto datos${domainHint(domain)} cuando me lo pides explícitamente (listar, buscar, ver…). Si antes te mostré algo sin que lo pidieras, interpreté mal tu mensaje. ¿Quieres que consulte datos reales, que te explique cómo funciona algo, o seguimos con otra cosa?`
}

export function userCorrectionAnswer(domain: TurnDomain): string {
  return `Tienes razón, he interpretado mal tu mensaje. No volveré a listar nada${domainHint(domain)} salvo que me lo pidas. ¿Qué necesitas exactamente: que consulte datos, que te lo explique, o algo distinto?`
}

export function userComplaintAnswer(): string {
  return 'Lamento la confusión. Dime qué esperabas y lo hago bien: ¿consultar datos reales, explicarte cómo funciona algo, o corregir lo anterior?'
}

export function disagreementAnswer(): string {
  return 'Puede que me haya equivocado. ¿Me dices qué parte no cuadra y lo reviso? No repito nada hasta entender bien lo que necesitas.'
}
