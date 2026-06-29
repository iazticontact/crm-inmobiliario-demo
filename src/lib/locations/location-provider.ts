// Abstracción de proveedor de ubicaciones (P16). Por defecto NO hay proveedor externo: el
// autocompletado funciona con catálogo local + valores reales del workspace, sin coste ni dependencias.
//
// Esta interfaz existe para poder enchufar en el futuro un proveedor externo (Google Places, Mapbox,
// Geoapify, Nominatim) SIN reescribir la UI ni los formularios. Reglas: apagado por defecto, no se
// activa sin env explícita, no incluye claves en el cliente, y si no hay proveedor todo sigue
// funcionando con local + workspace.
//
// Envs opcionales (futuras, NO necesarias hoy):
//   NEXT_PUBLIC_LOCATION_PROVIDER = google | mapbox | geoapify | nominatim   (vacío = sin proveedor)
//   La clave del proveedor debe vivir SOLO en el servidor (proxy /api), nunca en NEXT_PUBLIC_*.

export interface LocationProvider {
  name: string
  /** Sugerencias de ciudad/zona desde el proveedor externo (para una fase futura). */
  searchPlaces(query: string): Promise<Array<{ value: string; hint?: string }>>
}

// Devuelve un proveedor externo SOLO si está configurado; hoy siempre null (local + workspace).
export function getExternalLocationProvider(): LocationProvider | null {
  // Intencionadamente apagado: P16 no integra APIs externas. Cuando se implemente, este punto leerá
  // el provider configurado y devolverá una instancia que llame a un proxy /api server-side.
  return null
}

// ¿Hay algún proveedor externo activo? (para que la UI muestre/oculte estados de carga externos).
export function hasExternalLocationProvider(): boolean {
  return getExternalLocationProvider() !== null
}
