// Evals del layer local-first del Asistente (P47) — PURAS (detección + formato; sin DB).
// Cubren las consultas que un validador SIEMPRE prueba: clientes e inmuebles en lenguaje natural, el
// seguimiento contextual "Y el de Malasaña?", y que el formato no filtre IDs.

import {
  detectClientsListIntent, detectClientSearch, detectPropertiesIntent,
  formatPropertyLine, formatClientLine,
} from '@/lib/agents/local-answers'
import { buildCriteriaFromText } from '@/lib/real-estate-search'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export function runLocalAnswersEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // ── Intención CLIENTES (listar) ──
  for (const q of ['Qué clientes tengo?', 'qué clientes hay', 'lista de clientes', 'clientes registrados', 'muéstrame mis clientes', 'cuántos clientes tengo', 'dime los clientes']) {
    ok(detectClientsListIntent(q), `clientes-list debería detectar: "${q}"`)
  }
  for (const q of ['qué pisos tengo', 'enséñame la cartera', 'cuánto he facturado', 'próximas citas']) {
    ok(!detectClientsListIntent(q), `clientes-list NO debería detectar: "${q}"`)
  }

  // ── Búsqueda de un CLIENTE por nombre ──
  ok(detectClientSearch('busca el cliente Javier')?.name === 'javier', 'buscar cliente Javier')
  ok(detectClientSearch('cliente llamado Soler')?.name === 'soler', 'cliente llamado Soler')
  ok(detectClientSearch('muéstrame el cliente Ortega')?.name === 'ortega', 'muéstrame el cliente Ortega')
  ok(detectClientSearch('qué clientes tengo') === null, 'listar clientes NO es búsqueda por nombre')
  ok(detectClientSearch('qué pisos hay') === null, 'inmuebles NO es búsqueda de cliente')

  // ── Intención INMUEBLES / cartera ──
  for (const q of ['Dime qué pisos tenemos en cartera', 'qué inmuebles tengo', 'enséñame las casas en venta', 'qué hay en alquiler', 'Qué pisos hay con 3 habs, 2 baños y más de 80 m²?', 'viviendas disponibles', 'qué propiedades pueden bajar de precio']) {
    ok(detectPropertiesIntent(q)?.query != null, `inmuebles debería detectar: "${q}"`)
  }
  ok(detectPropertiesIntent('qué clientes tengo') === null, 'clientes NO es inmuebles')

  // ── Seguimiento contextual "Y el de Malasaña?" ──
  const fu = detectPropertiesIntent('Y el de Malasaña?', 'dime qué pisos tenemos en cartera')
  ok(fu?.query === 'malasana', `follow-up Malasaña → "malasana" (got ${JSON.stringify(fu)})`)
  ok(detectPropertiesIntent('Y el de Malasaña?', 'qué clientes tengo') === null, 'follow-up sin contexto inmobiliario → null')
  ok(detectPropertiesIntent('¿y en el centro?', 'qué pisos hay en venta')?.query === 'centro', 'follow-up "¿y en el centro?"')

  // ── Los filtros del validador se traducen a criterios correctos (sin precio fantasma por m²) ──
  const c = buildCriteriaFromText('Qué pisos hay con 3 habs, 2 baños y más de 80 m²?')
  ok(c.bedrooms === 3 && c.bathrooms === 2 && c.minArea === 80, 'criterio 3 habs/2 baños/+80 m²')
  ok(c.maxPrice === null && c.minPrice === null, 'sin precio fantasma en "más de 80 m²"')
  ok(buildCriteriaFromText('pisos hasta 315.000').maxPrice === 315000, 'hasta 315.000 → maxPrice')
  ok((buildCriteriaFromText('inmuebles con urgencia por vender').locationTokens ?? []).includes('urgencia'), 'urgencia → token buscable en notas')

  // ── Formato: útil y SIN IDs ──
  const propLine = formatPropertyLine({ title: 'Piso - Avenida San Pedro 66', property_type: 'piso', operation_type: 'venta', price: 375000, city: 'Madrid', area: 'Malasaña', bedrooms: 3, bathrooms: 2, area_m2: 110 })
  ok(propLine.includes('375.000 €'), 'precio formateado es-ES')
  ok(propLine.includes('3 hab') && propLine.includes('2 baños') && propLine.includes('110 m²'), 'incluye habs/baños/m²')
  ok(propLine.includes('Malasaña'), 'incluye zona')
  ok(!UUID.test(propLine), 'línea de inmueble sin UUID')

  const cliLine = formatClientLine({ name: 'Javier Ortega Ruiz', company: null, email: 'javier.ortega@example.com', phone: '+34 600 109 209' })
  ok(cliLine.includes('Javier Ortega Ruiz') && cliLine.includes('@'), 'cliente con nombre y email')
  ok(!UUID.test(cliLine), 'línea de cliente sin UUID')

  return fail
}
