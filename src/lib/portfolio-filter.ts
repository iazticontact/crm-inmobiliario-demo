// Filtro y orden de la Cartera (P19) — lógica pura, testeable, sin dependencias de UI. Opera sobre los
// inmuebles ya cargados (RLS aplicada en la consulta). Búsqueda tolerante a acentos/mayúsculas por
// varios campos; filtros exactos por estado/operación/tipo/localidad; orden por recientes/precio/localidad.

export type PortfolioFilters = {
  search?: string
  estado?: string
  operacion?: string
  tipo?: string
  localidad?: string
}

export type PortfolioSort = 'recientes' | 'precio_desc' | 'precio_asc' | 'localidad'

export type PortfolioProperty = {
  title?: string | null
  city?: string | null
  area?: string | null
  property_type?: string | null
  operation_type?: string | null
  status?: string | null
  owner_name?: string | null
  owner_phone?: string | null
  notes?: string | null
  price?: number | null
}

export function foldText(s: unknown): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function propertyMatchesFilters(p: PortfolioProperty, f: PortfolioFilters): boolean {
  if (f.estado && p.status !== f.estado) return false
  if (f.operacion && p.operation_type !== f.operacion) return false
  if (f.tipo && p.property_type !== f.tipo) return false
  if (f.localidad && foldText(p.city) !== foldText(f.localidad)) return false
  const q = foldText(f.search).trim()
  if (q) {
    const hay = [p.title, p.city, p.area, p.property_type, p.operation_type, p.status, p.owner_name, p.owner_phone, p.notes].map(foldText).join(' ')
    if (!q.split(/\s+/).every((tok) => hay.includes(tok))) return false
  }
  return true
}

// Orden: 'recientes' conserva el orden de entrada (ya viene por estado + updated_at). El resto reordena.
export function sortPortfolio<T extends PortfolioProperty>(list: T[], sort: PortfolioSort): T[] {
  if (sort === 'recientes') return list
  const arr = [...list]
  if (sort === 'precio_desc') arr.sort((a, b) => (b.price ?? -1) - (a.price ?? -1))
  else if (sort === 'precio_asc') arr.sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER))
  else if (sort === 'localidad') arr.sort((a, b) => String(a.city ?? '').localeCompare(String(b.city ?? ''), 'es') || String(a.area ?? '').localeCompare(String(b.area ?? ''), 'es'))
  return arr
}
