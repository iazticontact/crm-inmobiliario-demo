// Evals del motor de búsqueda inmobiliaria (P29). EJECUTABLE y determinista, con fixtures SINTÉTICAS
// (sin datos reales). Valida taxonomía, operación, disponibilidad, presupuesto, habitaciones, ranking
// (exacto vs parcial, evitar falsos negativos) y que un mensaje inmobiliario con precio/comisión NO se
// clasifique como factura. `runRealEstateSearchEvals()` devuelve la lista de fallos (vacía = OK).

import {
  normalizePropertyType, normalizeOperation, isPropertyClosed, availabilityAllows,
  parseBudget, parseRooms, buildCriteriaFromText, rankProperties, type ScorableProperty,
} from '@/lib/real-estate-search'
import { detectAssistantIntent } from '@/lib/ai'

const P = (o: Partial<ScorableProperty>): ScorableProperty => ({
  property_type: null, operation_type: null, status: 'listed', city: null, area: null,
  address: null, title: null, notes: null, price: null, bedrooms: null, bathrooms: null, area_m2: null, ...o,
})

export function runRealEstateSearchEvals(): string[] {
  const fail: string[] = []
  const ok = (cond: boolean, msg: string) => { if (!cond) fail.push(msg) }

  // 1) Taxonomía de tipo (sinónimos → catálogo; genéricos no filtran)
  ok(normalizePropertyType('piso').canonical?.includes('piso') === true, 'piso→piso')
  ok(normalizePropertyType('apartamento').canonical?.includes('piso') === true, 'apartamento→piso')
  ok((normalizePropertyType('casa').canonical ?? []).includes('chalet'), 'casa incluye chalet')
  ok(normalizePropertyType('vivienda').generic === true, 'vivienda es genérico')
  ok(normalizePropertyType('inmuebles').generic === true, 'inmuebles es genérico')
  ok(normalizePropertyType('chalet').canonical?.join() === 'chalet', 'chalet→chalet')

  // 2) Operación
  ok(normalizeOperation('quiero comprar') === 'venta', 'comprar→venta')
  ok(normalizeOperation('busco para alquilar') === 'alquiler', 'alquilar→alquiler')
  ok(normalizeOperation('enséñame inmuebles') === null, 'sin señal→null')

  // 3) Disponibilidad
  ok(isPropertyClosed('sold') && isPropertyClosed('rented') && isPropertyClosed('archived'), 'cerrados')
  ok(!isPropertyClosed('listed') && !isPropertyClosed('prospecting'), 'activos no cerrados')
  ok(availabilityAllows('listed', 'available') && !availabilityAllows('sold', 'available'), 'available excluye vendidos')
  ok(availabilityAllows('sold', 'all'), 'all incluye todo')

  // 4) Presupuesto (es-ES)
  ok(parseBudget('hasta 300.000€').maxPrice === 300000, 'hasta 300.000€')
  ok(parseBudget('unos 250 mil').maxPrice === 250000, '250 mil')
  const between = parseBudget('entre 200 y 250 mil')
  ok(between.minPrice === 200000 && between.maxPrice === 250000, 'entre 200 y 250 mil')
  ok(parseBudget('1.200 €/mes').monthly === true, 'mensual')

  // 5) Habitaciones/baños
  ok(parseRooms('piso de 3 habitaciones y 2 baños').bedrooms === 3, '3 hab')
  ok(parseRooms('piso de 3 habitaciones y 2 baños').bathrooms === 2, '2 baños')

  // 6) Ranking: exactos vs parciales, sin falsos negativos, cerrados excluidos
  const stock: ScorableProperty[] = [
    P({ title: 'Piso Bilbao centro', property_type: 'piso', operation_type: 'venta', status: 'listed', city: 'Bilbao', price: 230000, bedrooms: 3 }),
    P({ title: 'Piso Bilbao caro', property_type: 'piso', operation_type: 'venta', status: 'listed', city: 'Bilbao', price: 500000, bedrooms: 3 }),
    P({ title: 'Piso Bilbao vendido', property_type: 'piso', operation_type: 'venta', status: 'sold', city: 'Bilbao', price: 200000 }),
    P({ title: 'Chalet Getxo', property_type: 'chalet', operation_type: 'venta', status: 'listed', city: 'Getxo', price: 600000 }),
  ]
  const c1 = buildCriteriaFromText('busco piso en Bilbao hasta 300.000€')
  const r1 = rankProperties(stock, c1)
  ok(r1.exact.some((x) => x.item.title === 'Piso Bilbao centro'), 'piso en presupuesto = exacto')
  ok(!r1.exact.concat(r1.partial).some((x) => x.item.title === 'Piso Bilbao vendido'), 'vendido excluido')
  ok(r1.partial.some((x) => x.item.title === 'Piso Bilbao caro') || r1.exact.every((x) => x.item.title !== 'Piso Bilbao caro'), 'piso caro no es exacto')

  // Consulta genérica "viviendas disponibles" → todo lo activo cuenta (sin falsos negativos)
  const r2 = rankProperties(stock, buildCriteriaFromText('qué viviendas tengo disponibles'))
  ok(r2.exact.length === 3, 'genérica disponible = 3 activos (excluye 1 vendido)')

  // Notas: coincidencia en notas suma (precio/condiciones mencionadas)
  const withNote = [P({ title: 'Local', property_type: 'local', operation_type: 'alquiler', status: 'listed', city: 'Sopelana', notes: 'Zona Larrabasterra, negociable' })]
  const rNote = rankProperties(withNote, buildCriteriaFromText('local en Larrabasterra'))
  ok(rNote.exact.length + rNote.partial.length === 1, 'match por notas')

  // 6.5) Extracción de ubicación: filler/presupuesto/atributos/intención/estado NO son localidad
  // (regresión del bug de falsos negativos de P29).
  const noLeak = (t: string) => buildCriteriaFromText(t).locationTokens ?? []
  ok(noLeak('qué viviendas tengo disponibles').length === 0, 'no leak: tengo/disponibles')
  ok(noLeak('busco un piso en venta hasta 300.000€').length === 0, 'no leak: hasta/venta')
  ok(noLeak('piso de 3 habitaciones y 2 baños').length === 0, 'no leak: habitaciones/baños')
  ok(noLeak('algo para invertir hasta 500 mil').length === 0, 'no leak: invertir/mil')
  ok(noLeak('inmuebles vendidos').length === 0, 'no leak: vendidos')
  ok(noLeak('algún piso en Bilbao').includes('bilbao'), 'localidad real sí se detecta (bilbao)')

  // 7) Detección de acción: precio/comisión/presupuesto NO son factura; factura explícita sí
  ok(detectAssistantIntent('busco un piso hasta 300.000€').intent !== 'invoice' && detectAssistantIntent('busco un piso hasta 300.000€').intent !== 'invoice_concrete', 'precio ≠ factura')
  ok(!String(detectAssistantIntent('¿qué comisión saco de esta venta?').intent).startsWith('invoice'), 'comisión ≠ factura')
  ok(!String(detectAssistantIntent('presupuesto de 250 mil para una casa').intent).startsWith('invoice'), 'presupuesto ≠ factura')
  ok(String(detectAssistantIntent('prepara una factura para Juan de 500€').intent).startsWith('invoice'), 'factura explícita sí')

  return fail
}
