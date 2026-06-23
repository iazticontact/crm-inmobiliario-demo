// Presentación de inmuebles (es-ES): etiquetas, estados, orden y precio. Compartido por la pestaña
// Inmuebles (/opportunities) y la ficha de inmueble (/opportunities/properties/[id]) para no
// duplicar copy ni que las etiquetas deriven entre vistas.
import type { PropertyRow } from '@/lib/vertical-queries'

export const PROPERTY_TYPE_LABEL: Record<string, string> = {
  piso: 'Piso', atico: 'Ático', duplex: 'Dúplex', chalet: 'Chalet', adosado: 'Adosado',
  casa: 'Casa', local: 'Local', oficina: 'Oficina', nave: 'Nave', terreno: 'Terreno',
  garaje: 'Garaje', trastero: 'Trastero', edificio: 'Edificio',
}

export const PROPERTY_OPERATION_LABEL: Record<string, string> = {
  venta: 'Venta', alquiler: 'Alquiler', captacion: 'Captación', inversion: 'Inversión',
  traspaso: 'Traspaso', alquiler_opcion_compra: 'Alquiler con opción a compra',
}

// Estado del inmueble → etiqueta + tono de badge. Claves internas intactas; solo mejora visible.
export const PROPERTY_STATUS_META: Record<string, { label: string; tone: string }> = {
  prospecting:    { label: 'En preparación', tone: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  listed:         { label: 'Publicado',  tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  available:      { label: 'Disponible', tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  under_contract: { label: 'Reservado',  tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  reserved:       { label: 'Reservado',  tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  sold:           { label: 'Vendido',    tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  rented:         { label: 'Alquilado',  tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  archived:       { label: 'Archivado',  tone: 'bg-gray-50 text-gray-400 border-gray-100' },
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export function propLabel(map: Record<string, string>, value: string | null): string {
  if (!value) return ''
  return map[value] ?? cap(value)
}

// Opciones de alta/edición. Claves en es-ES coherentes con PROPERTY_TYPE_LABEL/OPERATION_LABEL
// (antes el alta guardaba claves en inglés tipo "apartment"/"sale" que se mostraban mal).
export const PROPERTY_TYPE_OTHER = 'otro'
export const PROPERTY_TYPE_OPTIONS: { id: string; label: string }[] = [
  { id: 'piso', label: 'Piso' },
  { id: 'atico', label: 'Ático' },
  { id: 'chalet', label: 'Chalet' },
  { id: 'casa', label: 'Casa' },
  { id: 'local', label: 'Local' },
  { id: 'oficina', label: 'Oficina' },
  { id: 'garaje', label: 'Garaje' },
  { id: 'terreno', label: 'Terreno' },
  { id: PROPERTY_TYPE_OTHER, label: 'Otro' },
]
export const PROPERTY_OPERATION_OPTIONS: { id: string; label: string }[] = [
  { id: 'venta', label: 'Venta' },
  { id: 'alquiler', label: 'Alquiler' },
]

// Etiqueta de tipo para mostrar: si es "otro" (o un tipo no catalogado) y hay tipo libre en
// metadata.custom_property_type, se muestra ese texto; si no, la etiqueta del catálogo.
export function propertyTypeText(p: { property_type: string | null; metadata: Record<string, unknown> | null }): string {
  const custom = typeof p?.metadata?.custom_property_type === 'string' ? p.metadata.custom_property_type.trim() : ''
  if (custom && (p.property_type === PROPERTY_TYPE_OTHER || !p.property_type || !PROPERTY_TYPE_LABEL[p.property_type])) return custom
  return propLabel(PROPERTY_TYPE_LABEL, p.property_type)
}

// Lee un numérico del inmueble desde columna real o, en su defecto, de metadata (datos demo).
export function propNum(p: PropertyRow, col: 'bedrooms' | 'bathrooms' | 'area_m2', metaKey: string): number | null {
  const direct = p[col]
  if (typeof direct === 'number') return direct
  const meta = p.metadata?.[metaKey]
  return typeof meta === 'number' ? meta : null
}

export function isRentalProperty(operationType: string | null): boolean {
  return operationType === 'alquiler' || operationType === 'alquiler_opcion_compra'
}

// Histórico = ya no está en cartera activa (cerrado): vendido, alquilado o archivado.
export function isClosedPropertyStatus(status: string | null): boolean {
  return status === 'sold' || status === 'rented' || status === 'archived'
}

// Orden de la cartera activa: reservados → publicados → captación. Histórico: vendidos → alquilados
// → archivados. Empates / estados desconocidos: por updated_at descendente (más reciente primero).
export const ACTIVE_STATUS_RANK: Record<string, number> = {
  under_contract: 0, reserved: 0, listed: 1, available: 1, prospecting: 2,
}
export const HISTORY_STATUS_RANK: Record<string, number> = {
  sold: 0, rented: 1, archived: 2,
}

export function sortPropertiesByStatus(list: PropertyRow[], rank: Record<string, number>): PropertyRow[] {
  return [...list].sort((a, b) => {
    const ra = rank[a.status] ?? 99
    const rb = rank[b.status] ?? 99
    if (ra !== rb) return ra - rb
    const ta = new Date(a.updated_at).getTime() || 0
    const tb = new Date(b.updated_at).getTime() || 0
    return tb - ta
  })
}

export function formatPropertyPrice(price: number | null, currency: string | null, isRent: boolean): string {
  if (price == null || !Number.isFinite(price)) return '—'
  let base: string
  try {
    base = new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency ?? 'EUR', maximumFractionDigits: 0 }).format(price)
  } catch {
    base = `${price} ${currency ?? 'EUR'}`
  }
  return isRent ? `${base}/mes` : base
}
