// Catálogo local de ubicaciones (P15). MVP ampliable, sin APIs externas ni coste. Da autocompletado
// de ciudades y de zonas/barrios dependientes de la ciudad. NO pretende ser un nomenclátor nacional
// completo: es un punto de partida mantenible. Los valores que un usuario escriba y no estén aquí se
// admiten igualmente como "personalizados" (no se bloquea al comercial).
//
// Mejora futura: catálogo completo de municipios, códigos postales, geocoding, API externa opcional.

import { foldAccents, normalizeLocationText } from './normalize-location'

export type City = {
  /** Nombre canónico para mostrar y guardar. */
  name: string
  /** Provincia (se muestra como pista: "Bilbao · Bizkaia"). */
  province?: string
  /** Comunidad autónoma. */
  region?: string
  /** País (por defecto España). */
  country?: string
  /** Variantes/alias para que la búsqueda encuentre la ciudad (p. ej. "San Sebastián"). */
  aliases?: string[]
  /** Zonas/barrios principales. */
  areas?: string[]
}

export const DEFAULT_COUNTRY = 'España'

export const CITIES: City[] = [
  {
    name: 'Bilbao', province: 'Bizkaia', region: 'País Vasco',
    areas: ['Abando', 'Indautxu', 'Ensanche', 'Casco Viejo', 'Deusto', 'Santutxu', 'Begoña', 'San Ignazio', 'Uribarri', 'Rekalde', 'Basurto', 'Zorrotza', 'Miribilla'],
  },
  {
    name: 'Donostia / San Sebastián', province: 'Gipuzkoa', region: 'País Vasco',
    aliases: ['San Sebastián', 'Donostia', 'Donostia-San Sebastián'],
    areas: ['Centro', 'Gros', 'Amara', 'Antiguo', 'Egia', 'Intxaurrondo', 'Aiete', 'Ibaeta'],
  },
  {
    name: 'Vitoria-Gasteiz', province: 'Álava', region: 'País Vasco',
    aliases: ['Vitoria', 'Gasteiz'],
    areas: ['Centro', 'Casco Viejo', 'Lovaina', 'Zaramaga', 'Salburua', 'Lakua', 'Zabalgana'],
  },
  {
    name: 'Madrid', province: 'Madrid', region: 'Comunidad de Madrid',
    areas: ['Centro', 'Salamanca', 'Chamberí', 'Retiro', 'Chamartín', 'Tetuán', 'Arganzuela', 'Moncloa', 'Latina', 'Carabanchel', 'Chueca', 'Malasaña'],
  },
  {
    name: 'Barcelona', province: 'Barcelona', region: 'Cataluña',
    areas: ['Eixample', 'Ciutat Vella', 'Gràcia', 'Sarrià-Sant Gervasi', 'Sants-Montjuïc', 'Sant Martí', 'Les Corts', 'Horta-Guinardó', 'El Born', 'Poblenou'],
  },
  {
    name: 'Valencia', province: 'Valencia', region: 'Comunidad Valenciana',
    areas: ['Ciutat Vella', 'Eixample', 'Ruzafa', 'El Carmen', 'Benimaclet', 'El Grao', 'Campanar', 'Patraix'],
  },
  {
    name: 'Málaga', province: 'Málaga', region: 'Andalucía',
    areas: ['Centro', 'La Malagueta', 'El Palo', 'Pedregalejo', 'Teatinos', 'Huelin', 'Cerrado de Calderón'],
  },
  {
    name: 'Marbella', province: 'Málaga', region: 'Andalucía',
    areas: ['Centro', 'Nueva Andalucía', 'San Pedro de Alcántara', 'Puerto Banús', 'Las Chapas', 'Milla de Oro', 'Nagüeles'],
  },
  {
    name: 'Sevilla', province: 'Sevilla', region: 'Andalucía',
    areas: ['Casco Antiguo', 'Triana', 'Nervión', 'Los Remedios', 'Macarena', 'Santa Cruz', 'Bami'],
  },
  {
    name: 'Zaragoza', province: 'Zaragoza', region: 'Aragón',
    areas: ['Centro', 'Delicias', 'Actur', 'Casco Histórico', 'Universidad', 'Las Fuentes', 'Valdespartera'],
  },
  {
    name: 'Santander', province: 'Cantabria', region: 'Cantabria',
    areas: ['Centro', 'El Sardinero', 'Puertochico', 'Cuatro Caminos', 'Valdenoja', 'Cazoña'],
  },
  {
    name: 'Pamplona', province: 'Navarra', region: 'Navarra',
    aliases: ['Iruña'],
    areas: ['Casco Viejo', 'Ensanche', 'Iturrama', 'Rochapea', 'San Juan', 'Mendebaldea', 'Txantrea'],
  },
  {
    name: 'Logroño', province: 'La Rioja', region: 'La Rioja',
    areas: ['Centro', 'El Cubo', 'La Estrella', 'Yagüe', 'Valdegastea', 'Cascajos'],
  },
]

export type CitySuggestion = { value: string; hint?: string }

// Ranking simple para sugerencias: coincidencia exacta > prefijo > contiene > alfabético.
function rank(haystack: string, q: string): number {
  if (!q) return 3
  if (haystack === q) return 0
  if (haystack.startsWith(q)) return 1
  if (haystack.includes(q)) return 2
  return 99
}

// Sugerencias de ciudad por nombre o alias (sin acentos/mayúsculas). hint = provincia.
export function searchCities(query: string, limit = 8): CitySuggestion[] {
  const q = foldAccents(query)
  const scored = CITIES.map((c) => {
    const candidates = [c.name, ...(c.aliases ?? [])].map(foldAccents)
    const best = Math.min(...candidates.map((h) => rank(h, q)))
    return { city: c, score: best }
  })
    .filter((s) => s.score < 99)
    .sort((a, b) => a.score - b.score || a.city.name.localeCompare(b.city.name, 'es'))
  return scored.slice(0, limit).map((s) => ({ value: s.city.name, hint: s.city.province }))
}

// Encuentra la ciudad por nombre/alias exacto (ignorando acentos/mayúsculas y normalizando).
export function findCity(name: string | null | undefined): City | undefined {
  if (!name) return undefined
  const q = foldAccents(normalizeLocationText(name))
  return CITIES.find((c) => [c.name, ...(c.aliases ?? [])].some((n) => foldAccents(n) === q))
}

// Sugerencias de zona/barrio para una ciudad dada (si la conocemos). Devuelve strings de barrio.
export function searchAreas(cityName: string | null | undefined, query: string, limit = 8): string[] {
  const city = findCity(cityName)
  if (!city?.areas?.length) return []
  const q = foldAccents(query)
  return city.areas
    .map((a) => ({ a, score: rank(foldAccents(a), q) }))
    .filter((s) => s.score < 99)
    .sort((x, y) => x.score - y.score || x.a.localeCompare(y.a, 'es'))
    .slice(0, limit)
    .map((s) => s.a)
}

// ¿La zona pertenece al catálogo de esa ciudad? (para avisar de "zona personalizada" sin bloquear).
export function isKnownArea(cityName: string | null | undefined, area: string): boolean {
  const city = findCity(cityName)
  if (!city?.areas?.length || !area.trim()) return false
  const q = foldAccents(normalizeLocationText(area))
  return city.areas.some((a) => foldAccents(a) === q)
}
