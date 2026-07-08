// Pragmática conversacional del Asistente (P49) — PURO. Clasifica el ACTO COMUNICATIVO del usuario ANTES
// de detectar la entidad CRM. Mencionar "cliente/inmueble/trámite/factura" NO basta para leer datos: hay
// que saber si el usuario pide datos, pregunta una capacidad, pregunta cómo funciona algo, habla de una
// acción futura, saluda o pide ayuda. Solo si el acto es "leer datos" se ejecuta una consulta.
//
// No hardcodea frases: usa diccionarios de patrones + orden de prioridad. La entidad (para explicar la
// capacidad del módulo adecuado) la resuelve el llamante con classifyIntent.

import { foldText } from '@/lib/real-estate-search'
import type { CrmEntity } from './intent'

export type SpeechAct =
  | 'greeting' | 'smalltalk'
  | 'capability_question' | 'permission_or_can_you_question' | 'how_it_works_question'
  | 'hypothetical_future_question' | 'help_request'
  | 'data_read_request' | 'data_write_request'
  | 'confirmation_request' | 'correction' | 'follow_up_filter' | 'follow_up_detail'
  | 'ambiguous' | 'unsupported'

export type PragmaticResult = {
  speechAct: SpeechAct
  confidence: number
  shouldReadData: boolean
  shouldWriteData: boolean
  shouldUseLastContext: boolean
  shouldExplainCapability: boolean
  shouldAskClarification: boolean
  reason: string
}

// ── Patrones (sobre texto plegado: minúsculas, sin acentos) ──────────────────
const GREETING = /^\s*(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|ey|holi|que tal|como estas|como va|saludos)\b/
const THANKS = /\b(gracias|muchas gracias|te lo agradezco|genial|perfecto|estupendo|entendido|de acuerdo|okay)\b/
const HOW = /\b(como funciona|como funcionas|como se usa|como se hace esto|como trabajas|como lo haces|que es esto|en que consiste|para que sirve (el|la|los|las|este|esta|esto))\b/
const CAPABILITY_SELF = /\b(que puedes hacer|que sabes hacer|que haces|para que sirves|para que vales|cuales son tus (capacidades|limites|funciones)|tus (capacidades|limites)|en que me ayudas|con que me puedes ayudar|que mas puedes|que (puede|sabe) hacer (este|el) (asistente|chat|bot|copiloto|agente))\b/
const CAPABILITY_ABILITY = /\b(tienes acceso|puedes acceder|eres capaz|tienes la capacidad|sabes (leer|ver|acceder|consultar|mostrar|hacer)|puedes (leer|acceder|consultar|hacer|crear|modificar|actualizar|editar|borrar|eliminar|guardar|registrar))\b/
const FUTURE = /\b(si (creo|hago|añado|anado|pongo|guardo|registro|meto|agrego|subo|edito|cambio)|cuando (cree|haga|añada|anada|guarde|registre|ponga|suba|agregue|edite|cambie)|podras|podra|podre|leeras|veras|actualizaras|vas a (poder|leer|ver|actualizar)|en el futuro|mas adelante|una vez (que|guardado|creado)|despues de (crear|guardar|añadir|anadir|subir|registrar))\b/
const POLITE_READ = /\b(puedes|podrias|puedo|me puedes|podras|podrian)\b[^.?!]{0,40}\b(mostrar|listar|ense[nñ]ar|dar|decir|ver|contar|buscar|encontrar|sacar|indicar|enumerar|muestrame|listame|dime|dame|cuentame|cuantos|cuantas)(?:me|nos|los|las|le|lo|melo)?\b/
// Lectura CLARA de datos (fresca): interrogativo + verbo "tener/haber", verbo de listado al inicio, o
// sustantivos de lectura evidentes. Se comprueba ANTES que los marcadores de filtro (que comparten
// palabras como "abiertas"/"disponibles").
const STRONG_READ = /\b(que|cuantos|cuantas|cuales)\b[^?]{0,60}\b(tengo|tienes|tenemos|hay|existen|quedan)\b|^[\s¿]*(lista|listame|muestra|muestrame|ensename|dame|dime|busca|buscame|encuentra|sacame|enumera)\b|\b(proxim\w+ cita|cita\w* de hoy|tarea\w* pendiente|resumen|resume|listado de)\b/
const HELP = /\b(ayuda|ayudame|guiame|guia rapida|no se por donde|por donde (empiezo|empezar)|como empiezo)\b/
const CONFIRM = /\b(seguro|de verdad|confirma|confirmame|estas seguro|revisa|repite|otra vez|en serio|de nuevo)\b/
const CORRECTION = /\b(no me refiero|mejor los|en realidad|quiero decir|me referia|corrige|te equivocaste)\b/
const FOLLOWUP_DETAIL = /\b(dime mas|mas detalle|mas detalles|detalles|sus datos|su ficha|amplia|dame mas)\b/
const FOLLOWUP_FILTER = /\b(solo|unicamente|filtra|quita|sin los|con mas|con menos|mas de|menos de|en venta|en alquiler|disponibles|baratos|caros|abiertas|cerradas)\b/
const READ_SIGNALS = /\b(lista|listado|listame|muestra|muestrame|ensename|dame|dime|cuantos|cuantas|cuales|busca|buscame|encuentra|que (tengo|hay|tenemos|existen)|tengo|tenemos|hay|resumen|resume|proximas|proximos|pendientes|abiertas|disponibles)\b/
const WRITE = /\b(crea|crear|añad|anad|agrega|agregar|nuev[oa]s?\s+(cliente|inmueble|operacion|cita|tarea|tramite)|elimina|borra|borrar|actualiza|modifica|edita|editar|marca|mueve|programa|agenda(r| una| la)|asigna|apunta|guarda|envia|manda)\b/

function make(speechAct: SpeechAct, reason: string): PragmaticResult {
  const base: PragmaticResult = {
    speechAct, confidence: 0.8, reason,
    shouldReadData: false, shouldWriteData: false, shouldUseLastContext: false,
    shouldExplainCapability: false, shouldAskClarification: false,
  }
  switch (speechAct) {
    case 'data_read_request': return { ...base, shouldReadData: true }
    case 'data_write_request': return { ...base, shouldWriteData: true }
    case 'capability_question':
    case 'permission_or_can_you_question':
    case 'how_it_works_question':
    case 'hypothetical_future_question':
    case 'help_request': return { ...base, shouldExplainCapability: true }
    case 'confirmation_request':
    case 'correction':
    case 'follow_up_filter':
    case 'follow_up_detail': return { ...base, shouldUseLastContext: true }
    case 'greeting':
    case 'smalltalk': return { ...base, confidence: 0.7 }
    case 'ambiguous': return { ...base, confidence: 0.3, shouldAskClarification: true }
    default: return base
  }
}

export function classifyPragmatics(message: string): PragmaticResult {
  // Se pliega y se limpia la puntuación INICIAL («¿¡…») para que los anclajes de inicio funcionen con
  // ortografía española: «¿Y el de Malasaña?» debe activar el conector igual que «Y el de Malasaña».
  const n = foldText(message).replace(/^[\s¿¡!?.,;:]+/, '')
  const words = n.split(/\s+/).filter(Boolean)
  const hasRead = READ_SIGNALS.test(n)
  const hasWrite = WRITE.test(n)

  // 1) Saludo puro (no si además pide/hace algo).
  if (GREETING.test(n) && !hasRead && !hasWrite && words.length <= 4) return make('greeting', 'greeting-only')
  // 2) Agradecimiento / reconocimiento breve.
  if (THANKS.test(n) && !hasRead && !hasWrite && words.length <= 5) return make('smalltalk', 'thanks-ack')
  // 3) Cómo funciona (explicación, no datos).
  if (HOW.test(n)) return make('how_it_works_question', 'how-it-works')
  // 4) Futuro / hipotético (acción que aún no existe → no leer).
  if (FUTURE.test(n)) return make('hypothetical_future_question', 'future-hypothetical')
  // 5) Petición cortés de lectura ("¿puedes mostrarme…?") → SÍ es lectura.
  if (POLITE_READ.test(n)) return make('data_read_request', 'polite-read')
  // 6) Pregunta sobre capacidades del propio Asistente.
  if (CAPABILITY_SELF.test(n)) return make('capability_question', 'capability-self')
  // 7) Pregunta de permiso/habilidad ("¿tienes acceso a…?", "¿puedes acceder/crear…?").
  if (CAPABILITY_ABILITY.test(n)) return make('permission_or_can_you_question', 'capability-ability')
  // 8) Petición de ayuda / guía.
  if (HELP.test(n)) return make('help_request', 'help')
  // 9) Escritura.
  if (hasWrite) return make('data_write_request', 'write-verb')
  // 10) Confirmación / corrección / seguimiento.
  if (CONFIRM.test(n)) return make('confirmation_request', 'confirm')
  if (CORRECTION.test(n)) return make('correction', 'correction')
  if (FOLLOWUP_DETAIL.test(n)) return make('follow_up_detail', 'detail')
  // 11) Lectura CLARA de datos (antes que el filtro, que comparte palabras como "abiertas").
  if (STRONG_READ.test(n)) return make('data_read_request', 'strong-read')
  // 12) Seguimiento de filtro (refinamiento corto).
  const startsConnector = /^\s*(y|e|ademas|tambien|aparte)\b/.test(n)
  if ((FOLLOWUP_FILTER.test(n) || startsConnector) && words.length <= 7) return make('follow_up_filter', 'filter')
  // 13) Lectura de datos (señal débil).
  if (hasRead) return make('data_read_request', 'read-signal')
  // 12) Nada claro.
  return make('ambiguous', 'no-signal')
}

// ── Generadores de respuesta (contenido por módulo = datos, no frases del clasificador) ──────────────

const MODULE_HOW: Record<CrmEntity, string> = {
  clients: 'Clientes guarda a tus contactos (compradores, vendedores, inversores) con su ficha, operaciones y documentos. Yo puedo listarlos, buscarlos y resumir su estado.',
  properties: 'La cartera guarda tus inmuebles con tipo, operación, precio, zona y características (m²/habitaciones/baños). Yo busco y filtro por esos criterios.',
  operations: 'Operaciones es tu pipeline comercial: cada oportunidad tiene cliente, inmueble, etapa y valor. Yo te muestro las abiertas y su estado.',
  commissions: 'Comisiones controla los honorarios por operación (pendiente de facturar, facturado, cobrado, potencial). Se gestiona en Cartera → Comisiones.',
  calendar: 'El calendario reúne tus citas y visitas con fecha, cliente e inmueble. Yo te muestro las próximas.',
  tasks: 'Tareas son tus pendientes con fecha y prioridad. Yo te listo las que quedan por hacer.',
  service_cases: 'Trámites/expedientes son gestiones asociadas a un cliente o inmueble, con estado y vencimiento. Yo te muestro los abiertos.',
  documents: 'Documentos guarda archivos por cliente/inmueble/trámite. Yo veo su metadata (nombre, tipo, fecha), nunca el contenido.',
  invoicing: 'Facturación crea documentos oficiales: factura, IVA, PDF y estado de cobro. Se gestiona en su módulo; yo no leo facturas.',
  help: 'Soy tu asistente del CRM: leo datos básicos (clientes, inmuebles, operaciones, citas, tareas, trámites, documentos) de tu cuenta.',
  unknown: 'El CRM organiza clientes, inmuebles, operaciones, comisiones, citas, tareas, trámites y documentos.',
}

export function howItWorksAnswer(entity: CrmEntity): string {
  const body = MODULE_HOW[entity] ?? MODULE_HOW.unknown
  const next = entity === 'invoicing'
    ? 'Ábrelo desde el módulo Facturación.'
    : entity === 'commissions'
      ? '¿Quieres que te muestre las operaciones cerradas?'
      : entity === 'unknown' || entity === 'help'
        ? '¿Sobre qué módulo quieres saber más?'
        : '¿Quieres que te muestre los datos ahora?'
  return `${body} ${next}`
}

export function capabilityAnswer(entity: CrmEntity): string {
  if (entity === 'invoicing') {
    return 'No leo facturas desde aquí: la facturación (facturas, IVA, PDF y cobros oficiales) se gestiona en el módulo Facturación. Sí puedo ayudarte con clientes, inmuebles, operaciones, citas, tareas, trámites y documentos.'
  }
  if (entity === 'help' || entity === 'unknown') {
    return [
      'Puedo ayudarte con el CRM (solo lectura de tu cuenta):',
      '• Clientes — listar, buscar, ver su ficha.',
      '• Inmuebles — buscar por zona, precio, tipo, habitaciones, baños o m².',
      '• Operaciones, citas, tareas y trámites — ver los abiertos/próximos.',
      '• Documentos — su metadata (no el contenido).',
      'La facturación se gestiona en su módulo. ¿Qué quieres consultar?',
    ].join('\n')
  }
  const label = ENTITY_LABEL[entity]
  return `Sí: puedo consultar ${label} de tu cuenta actual (solo lectura, con tus permisos). Pídemelo con «lista/busca…» y te los muestro. No modifico datos: las creaciones y ediciones se hacen desde el módulo y, una vez guardadas, sí puedo consultarlas.`
}

export function futureAnswer(entity: CrmEntity): string {
  if (entity === 'invoicing') return capabilityAnswer('invoicing')
  const label = entity === 'unknown' || entity === 'help' ? 'ese dato' : ENTITY_LABEL[entity]
  return `Sí: en cuanto quede guardado en tu cuenta, podré consultarlo. Lo creas/editas desde el módulo correspondiente y luego me pides que te lo muestre. Ahora mismo no leo nada hasta que me lo pidas explícitamente (${label}).`
}

export function greetingAnswer(): string {
  return '¡Hola! Soy tu asistente del CRM. Puedo listar clientes, buscar inmuebles en cartera, ver tus operaciones, citas, tareas y trámites. ¿Qué necesitas?'
}

export function smalltalkAnswer(): string {
  // Reconocimiento neutro: vale tanto para «gracias» como para «perfecto/genial/de acuerdo».
  return '¡Genial! Si necesitas algo más del CRM —clientes, inmuebles, citas, tareas…— aquí estoy.'
}

const ENTITY_LABEL: Record<CrmEntity, string> = {
  clients: 'los clientes', properties: 'los inmuebles de la cartera', operations: 'las operaciones',
  commissions: 'las comisiones', calendar: 'las citas', tasks: 'las tareas', service_cases: 'los trámites',
  documents: 'los documentos (metadata)', invoicing: 'las facturas', help: 'el CRM', unknown: 'los datos',
}
