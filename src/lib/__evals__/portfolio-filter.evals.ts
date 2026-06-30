// Evals del filtro/orden de Cartera (P19). Sin runner en el repo; `runPortfolioFilterEvals()` verifica
// la lógica pura: búsqueda tolerante a acentos, filtros exactos y orden por precio/localidad.

import { propertyMatchesFilters, sortPortfolio, type PortfolioProperty } from '@/lib/portfolio-filter'

const PROPS: PortfolioProperty[] = [
  { title: 'Piso Centro', city: 'Bilbao', area: 'Abando', property_type: 'piso', operation_type: 'venta', status: 'listed', owner_name: 'Ana', owner_phone: '600111222', notes: 'exterior', price: 250000 },
  { title: 'Ático con terraza', city: 'Málaga', area: 'Centro', property_type: 'atico', operation_type: 'venta', status: 'prospecting', owner_name: 'Luis', price: 420000 },
  { title: 'Local comercial', city: 'Bilbao', area: 'Deusto', property_type: 'local', operation_type: 'alquiler', status: 'listed', owner_name: 'Marta', price: 1200 },
]

export function runPortfolioFilterEvals(): string[] {
  const fail: string[] = []
  const f = (filters: Parameters<typeof propertyMatchesFilters>[1]) => PROPS.filter((p) => propertyMatchesFilters(p, filters))

  // Filtro por localidad (exacto, tolerante a acentos/mayúsculas).
  if (f({ localidad: 'bilbao' }).length !== 2) fail.push('filtro localidad=bilbao debería dar 2')
  if (f({ localidad: 'Málaga' }).length !== 1) fail.push('filtro localidad=Málaga debería dar 1')
  // Filtro por estado / operación / tipo.
  if (f({ estado: 'listed' }).length !== 2) fail.push('filtro estado=listed debería dar 2')
  if (f({ operacion: 'alquiler' }).length !== 1) fail.push('filtro operacion=alquiler debería dar 1')
  if (f({ tipo: 'atico' }).length !== 1) fail.push('filtro tipo=atico debería dar 1')
  // Búsqueda por texto (título, zona, propietario, teléfono) sin acentos.
  if (f({ search: 'atico' }).length !== 1) fail.push('búsqueda "atico" (sin tilde) debería encontrar el Ático')
  if (f({ search: 'deusto' }).length !== 1) fail.push('búsqueda "deusto" (zona) debería dar 1')
  if (f({ search: '600111222' }).length !== 1) fail.push('búsqueda por teléfono debería dar 1')
  if (f({ search: 'ana' }).length !== 1) fail.push('búsqueda por propietario debería dar 1')
  // Combinación localidad + búsqueda.
  if (f({ localidad: 'Bilbao', search: 'local' }).length !== 1) fail.push('Bilbao + "local" debería dar 1')
  // Sin coincidencias.
  if (f({ localidad: 'Madrid' }).length !== 0) fail.push('filtro localidad=Madrid debería dar 0')

  // Orden por precio.
  const desc = sortPortfolio(PROPS, 'precio_desc').map((p) => p.price)
  if (JSON.stringify(desc) !== JSON.stringify([420000, 250000, 1200])) fail.push('orden precio_desc incorrecto: ' + JSON.stringify(desc))
  const asc = sortPortfolio(PROPS, 'precio_asc').map((p) => p.price)
  if (JSON.stringify(asc) !== JSON.stringify([1200, 250000, 420000])) fail.push('orden precio_asc incorrecto: ' + JSON.stringify(asc))
  // 'recientes' conserva el orden de entrada.
  if (sortPortfolio(PROPS, 'recientes') !== PROPS) fail.push('orden recientes debería conservar la referencia/orden')

  return fail
}
