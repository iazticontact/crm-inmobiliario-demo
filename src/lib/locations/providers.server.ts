// Proveedores externos de ubicación (P17) — SOLO servidor. Lee las claves de entorno y nunca las
// expone al cliente: el frontend llama a /api/locations/suggest, que usa esto. Apagado por defecto:
// si no hay LOCATION_PROVIDER o falta la clave, devuelve null y la ruta cae a workspace + catálogo
// local. Arquitectura intercambiable: google | mapbox | geoapify | local.

export type ProviderKind = 'municipality' | 'neighborhood' | 'district' | 'locality' | 'address'

export type ProviderResult = {
  label: string
  secondary?: string
  province?: string
  region?: string
  kind: ProviderKind
  providerPlaceId?: string
}

export interface LocationProvider {
  name: string
  search(query: string, opts: { country: string; type: 'locality' | 'area'; locality?: string }): Promise<ProviderResult[]>
}

const num = (v: string | undefined) => (v ?? '').trim()

// --- Google Places Autocomplete (legacy REST) ----------------------------------------------------
function googleProvider(key: string): LocationProvider {
  return {
    name: 'google',
    async search(query, { country, type }) {
      const params = new URLSearchParams({
        input: query,
        key,
        language: 'es',
        components: `country:${country.toLowerCase()}`,
        // (cities) para localidad; geocode (más amplio) para zona/barrio.
        types: type === 'locality' ? '(cities)' : 'geocode',
      })
      const res = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`)
      if (!res.ok) return []
      const data = await res.json() as { predictions?: Array<{ description?: string; place_id?: string; structured_formatting?: { main_text?: string; secondary_text?: string }; types?: string[] }> }
      return (data.predictions ?? []).map((p) => {
        const main = p.structured_formatting?.main_text ?? p.description ?? ''
        const secondary = p.structured_formatting?.secondary_text
        const t = p.types ?? []
        const kind: ProviderKind = t.includes('neighborhood') ? 'neighborhood' : t.includes('sublocality') ? 'district' : t.includes('locality') ? 'municipality' : 'locality'
        return { label: main, secondary, kind, providerPlaceId: p.place_id }
      }).filter((r) => r.label)
    },
  }
}

// --- Geoapify Autocomplete -----------------------------------------------------------------------
function geoapifyProvider(key: string): LocationProvider {
  return {
    name: 'geoapify',
    async search(query, { country, type }) {
      const params = new URLSearchParams({
        text: query,
        apiKey: key,
        lang: 'es',
        limit: '8',
        filter: `countrycode:${country.toLowerCase()}`,
        type: type === 'locality' ? 'city' : 'amenity',
      })
      const res = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params}`)
      if (!res.ok) return []
      const data = await res.json() as { features?: Array<{ properties?: Record<string, unknown> }> }
      return (data.features ?? []).map((f) => {
        const pr = (f.properties ?? {}) as Record<string, string | undefined>
        const label = pr.city || pr.suburb || pr.district || pr.name || ''
        return {
          label: String(label),
          secondary: [pr.state, pr.country].filter(Boolean).join(', ') || undefined,
          province: pr.state,
          region: pr.state,
          kind: (pr.suburb || pr.district ? 'neighborhood' : 'municipality') as ProviderKind,
          providerPlaceId: pr.place_id,
        }
      }).filter((r) => r.label)
    },
  }
}

// --- Mapbox Geocoding ----------------------------------------------------------------------------
function mapboxProvider(key: string): LocationProvider {
  return {
    name: 'mapbox',
    async search(query, { country, type }) {
      const params = new URLSearchParams({
        access_token: key,
        country,
        language: 'es',
        autocomplete: 'true',
        limit: '8',
        types: type === 'locality' ? 'place,locality' : 'neighborhood,locality',
      })
      const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`)
      if (!res.ok) return []
      const data = await res.json() as { features?: Array<{ text?: string; place_name?: string; place_type?: string[]; context?: Array<{ id?: string; text?: string }> }> }
      return (data.features ?? []).map((f) => {
        const region = f.context?.find((c) => c.id?.startsWith('region'))?.text
        const kindRaw = f.place_type?.[0]
        const kind: ProviderKind = kindRaw === 'neighborhood' ? 'neighborhood' : kindRaw === 'locality' ? 'district' : 'municipality'
        return { label: f.text ?? '', secondary: region, province: region, region, kind }
      }).filter((r) => r.label)
    },
  }
}

// Devuelve el proveedor activo según env, o null (→ la ruta usa workspace + catálogo local).
export function getLocationProvider(): LocationProvider | null {
  if (num(process.env.LOCATION_AUTOCOMPLETE_ENABLED).toLowerCase() === 'false') return null
  const provider = num(process.env.LOCATION_PROVIDER).toLowerCase()
  if (provider === 'google') {
    const key = num(process.env.GOOGLE_PLACES_API_KEY) || num(process.env.GOOGLE_MAPS_API_KEY)
    return key ? googleProvider(key) : null
  }
  if (provider === 'geoapify') {
    const key = num(process.env.GEOAPIFY_API_KEY)
    return key ? geoapifyProvider(key) : null
  }
  if (provider === 'mapbox') {
    const key = num(process.env.MAPBOX_ACCESS_TOKEN)
    return key ? mapboxProvider(key) : null
  }
  // 'local', vacío o desconocido → sin proveedor externo.
  return null
}

export function locationCountry(): string {
  return (num(process.env.LOCATION_COUNTRY) || 'ES').toUpperCase()
}
