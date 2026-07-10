// Capa RESUMEN + LEARNING CONTEXT (P60) — PURA. Root-cause de una clase de fallo: «resumen» es una
// keyword débil que secuestraba la intención → «hazme un resumen de todo el CRM para entenderlo» leía
// datos. Aquí se separa RESUMEN CONCEPTUAL (entender el producto → NO lee) de RESUMEN OPERATIVO (mis
// datos de hoy → SÍ lee), y se detecta el CONTEXTO DE APRENDIZAJE (usuario nuevo/evaluando → guía, no datos).
//
// Regla de oro: ninguna keyword suelta («resumen», «dashboard», «vendido», «tareas») decide sola. El acto
// comunicativo (entender vs consultar) manda. En ambigüedad NO se lee: se pregunta.

import { foldText } from '@/lib/real-estate-search'

export type SummaryKind = 'conceptual' | 'operational' | 'ambiguous'

const IS_SUMMARY = /\b(resumen|resumeme|resumir|resumeme|panorama|vision general|vista general|overview|ponme al dia|puesta al dia)\b/
const CONCEPTUAL = /\b(para entender|entenderlo|entenderla|entender (el|la|esto|como)|de todo el crm|de como (va|funciona)|como funciona|del producto|del sistema|de la (app|aplicacion|herramienta|plataforma)|para aprender|para conocer|guia|tour|recorrido|que es (esto|el crm)|generales del crm)\b/
// Operativo = datos actuales. El POSESIVO sobre una entidad del CRM («mi cartera», «mis clientes», «mi
// agenda») indica datos actuales del módulo, no explicación de producto (P61: «resumen de MI cartera»).
const OPERATIONAL = /\b(del dia|de hoy|de la semana|semanal|con mis datos|de mis datos|mi(s)? (cartera|inmuebles|clientes|operaciones|ventas|agenda|negocio|cuenta|tareas|citas|pipeline)|pendiente|pendientes|actividad|agenda de hoy|que tengo|proximas|como (esta|van|va) (mi|la|el|las|los))\b/

export function classifySummaryIntent(text: string): SummaryKind | null {
  const n = foldText(text)
  if (!IS_SUMMARY.test(n)) return null
  // Operativo tiene prioridad sobre conceptual si ambos aparecen SOLO cuando pide datos explícitos suyos:
  // «resumen del día con mis datos» es operativo aunque diga «para verlo».
  if (OPERATIONAL.test(n)) return 'operational'
  if (CONCEPTUAL.test(n)) return 'conceptual'
  return 'ambiguous'
}

// Contexto de aprendizaje: usuario nuevo / evaluando / quiere entender. Mientras esté activo, el Asistente
// guía y NO lee datos por defecto (hasta que el usuario pida datos explícitos: «muéstrame/cuántos/lista»).
const LEARNING = /\b(soy nuev[oa]|nuevo usuario|usuaria nueva|acabo de (empezar|llegar|registrarme|entrar)|no se (como|por donde)|no se como (va|funciona)|no entiendo como va|me han dado (la cuenta|acceso|el acceso)|nos han dado (la cuenta|acceso)|estamos valorando|estoy valorando|para probar(lo)?|probando (el|la)|quiero (entender|aprender|conocer)|para entender|para aprender|explicame el (crm|producto|sistema)|ensename el (crm|producto)|hazme un tour|dame un tour|guia rapida|primeros pasos|empezar a usar(lo)?)\b/

export function isLearningContext(text: string): boolean {
  return LEARNING.test(foldText(text))
}

// ¿Pide un recorrido COMPLETO del producto (todos los módulos) frente a una bienvenida corta?
const FULL_TOUR = /\b(de todo el crm|todo el crm|todos los modulos|recorrido completo|tour|resumen de todo|explicame el (crm|producto|sistema|todo)|como funciona todo|vista general del crm)\b/

export function wantsFullTour(text: string): boolean {
  return FULL_TOUR.test(foldText(text))
}
