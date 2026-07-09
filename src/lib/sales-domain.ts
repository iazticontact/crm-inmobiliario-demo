// Capa de dominio VENTAS/VENDIDOS (P58) — PURA. «Vendido/ventas/he vendido» es un concepto TRANSVERSAL:
// puede referirse a inmuebles con estado Vendido (Cartera) y/o a operaciones ganadas/cerradas
// (Operaciones). El clasificador de entidad no tenía vocab para estas frases → caían en n8n, que
// alucinaba «no consta ninguna operación vendida». Aquí decidimos QUÉ fuentes consultar y con qué métrica.
//
// Fuentes de verdad (auditadas, ver docs/P58_SALES_SOURCE_OF_TRUTH_AUDIT.md):
//   Cartera:      properties.status = 'sold' (Vendido) / 'rented' (Alquilado).
//   Operaciones:  opportunities.stage = 'won' (ganada = cerrada con éxito).
// No se asume que ventas = operaciones ni que vendidos = properties: se consultan ambas y se reconcilia.

import { foldText } from '@/lib/real-estate-search'

export type SalesScope = 'portfolio_only' | 'operations_only' | 'both'
export type SalesMetric = 'sold_properties' | 'rented_properties' | 'closed_operations' | 'sales_summary'
export type SalesOperationType = 'sale' | 'rent' | 'both'

export type SalesQueryIntent = {
  scope: SalesScope
  metric: SalesMetric
  operationType: SalesOperationType
  asksCount: boolean
  asksList: boolean
  asksYesNo: boolean
  asksExplanation: boolean
  forceLiveRead: boolean
  explicitCurrentMessageWins: boolean
  reason: string
}

// Formas de RESULTADO (no de proceso). «vendido/vendí/ventas» sí; «vender/vendo/vende» (infinitivo/
// presente = cómo se vende) NO — para no secuestrar preguntas de proceso/cómo-funciona.
const SOLD = /\b(vendid[oa]s?|vendi|vendio|vendieron|ventas?)\b/
const RENT_CLOSED = /\balquilad[oa]s?\b/
const OPS_WORD = /\b(operacion(es)?|oportunidad(es)?)\b/
const CLOSED_WORD = /\b(cerrad[oa]s?|ganad[oa]s?)\b/
const HE_CERRADO = /\bhe cerrado\b/

const PORTFOLIO_WORD = /\b(cartera|inmueble|inmuebles|piso|pisos|propiedad|propiedades|vivienda|viviendas|casa|casas|local|locales|chalet|chalets|adosado|adosados|atico|aticos|duplex)\b/

// Corrección de SOLO alcance («te he preguntado por cartera/operaciones»), sin palabra de venta: solo
// tiene sentido como seguimiento de una respuesta de ventas previa (opts.priorWasSales).
const SCOPE_CORRECTION = /\b(te he (preguntado|pedido) por (cartera|operaciones|inmuebles)|no te he (preguntado|pedido) por (cartera|operaciones))\b/

export function parseSalesIntent(text: string, opts: { priorWasSales?: boolean } = {}): SalesQueryIntent | null {
  const n = foldText(text)
  const hasSold = SOLD.test(n)
  const hasRentClosed = RENT_CLOSED.test(n)
  const hasOpsClosed = (OPS_WORD.test(n) && CLOSED_WORD.test(n)) || HE_CERRADO.test(n)
  if (!hasSold && !hasRentClosed && !hasOpsClosed) {
    // Solo se acepta como ventas si es una corrección de alcance TRAS una respuesta de ventas.
    if (!(opts.priorWasSales && SCOPE_CORRECTION.test(n))) return null
  }

  const mentionsPortfolio = PORTFOLIO_WORD.test(n)
  const mentionsOps = OPS_WORD.test(n)

  // Corrección de alcance: «no te he preguntado por operaciones, te he preguntado por cartera».
  // La negación aplica al alcance ANTES de la coma (no cruza a la cláusula afirmativa siguiente):
  // «no te he preguntado por cartera, te he preguntado por operaciones» → rechaza cartera, no operaciones.
  const rejectsOps = /\bno\b[^,.]*\b(operacion|operaciones|pipeline)\b/.test(n) && /\bcartera|inmueble/.test(n)
  const rejectsPortfolio = /\bno\b[^,.]*\b(cartera|inmueble|inmuebles)\b/.test(n) && /\boperacion/.test(n)
  const explicitCurrentMessageWins = rejectsOps || rejectsPortfolio

  let scope: SalesScope
  if (rejectsOps) scope = 'portfolio_only'
  else if (rejectsPortfolio) scope = 'operations_only'
  else if (mentionsPortfolio && mentionsOps) scope = 'both'
  else if (mentionsPortfolio) scope = 'portfolio_only'
  else if (mentionsOps || (hasOpsClosed && !hasSold && !hasRentClosed)) scope = 'operations_only'
  else if (hasRentClosed && !hasSold) scope = 'portfolio_only' // «alquilados» = estado de inmueble
  else scope = 'both' // «cuántos he vendido / ventas» sin alcance → transversal

  const operationType: SalesOperationType = hasSold && hasRentClosed ? 'both' : hasRentClosed && !hasSold ? 'rent' : 'sale'
  const metric: SalesMetric =
    scope === 'operations_only' ? 'closed_operations'
      : scope === 'both' ? 'sales_summary'
        : operationType === 'rent' ? 'rented_properties' : 'sold_properties'

  return {
    scope, metric, operationType,
    asksCount: /\b(cuant[oa]s?|numero de|cantidad)\b/.test(n),
    asksList: /\b(que|cuales|muestra|muestrame|ensena|ensename|lista|listame|dame|ver|dime)\b/.test(n),
    asksYesNo: /\b(algo|algun[oa]?|nada|tengo algo)\b/.test(n),
    asksExplanation: /\bdiferencia\b/.test(n) || /\bque diferencia\b/.test(n),
    forceLiveRead: /\b(mira(lo)? otra vez|revisa(lo)?|refresca|acabo de (cambiar|editar|guardar)|he (cambiado|editado|guardado)|otra vez)\b/.test(n),
    explicitCurrentMessageWins,
    reason: `sold=${hasSold} rentClosed=${hasRentClosed} opsClosed=${hasOpsClosed} scope=${scope}`,
  }
}

// Explicación honesta de la diferencia (no lee datos).
export const SALES_DIFFERENCE_EXPLANATION = [
  'Son dos cosas distintas y las dos son reales en el CRM:',
  '• **Inmueble vendido** (Cartera): un inmueble cuyo estado es «Vendido». Es el activo.',
  '• **Operación cerrada/ganada** (Operaciones): la operación comercial que terminó en éxito. Es el trato.',
  'Normalmente una venta cerrada corresponde a un inmueble en estado Vendido, pero puede haber operaciones ganadas sin un inmueble de la cartera asociado. ¿Quieres que te dé las dos cifras?',
].join('\n')
