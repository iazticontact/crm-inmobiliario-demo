// Catálogo local de ubicaciones (P15, ampliado en P16). MVP ampliable, sin APIs externas ni coste.
// Da autocompletado de ciudades y de zonas/barrios dependientes de la ciudad. NO pretende ser un
// nomenclátor nacional completo: es un punto de partida mantenible. Los valores que un usuario escriba
// y no estén aquí se admiten igualmente como "personalizados" (no se bloquea al comercial).
//
// P17 — el autocompletado real vive en /api/locations/suggest (empresa + proveedor externo opcional +
// este catálogo local como fallback). Aquí están el catálogo y las funciones de búsqueda/mezcla que
// usa la ruta en servidor (searchCities/searchAreas) y los evals (suggestCities/suggestAreas).

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
  /** Variantes/alias para que la búsqueda encuentre la ciudad (p. ej. "San Sebastián", "Barna"). */
  aliases?: string[]
  /** Zonas/barrios principales. */
  areas?: string[]
}

export const DEFAULT_COUNTRY = 'España'

// Origen de una sugerencia (para mostrar etiqueta discreta y para el ranking).
export type SuggestionSource = 'workspace' | 'catalog'
export type LocationSuggestion = { value: string; hint?: string; source: SuggestionSource }

const PV = 'País Vasco'

export const CITIES: City[] = [
  // --- Bizkaia / País Vasco ---
  {
    name: 'Bilbao', province: 'Bizkaia', region: PV, aliases: ['Bilbo'],
    areas: ['Abando', 'Indautxu', 'Ensanche', 'Casco Viejo', 'Deusto', 'San Ignazio', 'Ibarrekolanda', 'Santutxu', 'Begoña', 'Uribarri', 'Castaños', 'Matiko', 'Rekalde', 'Basurto', 'Zorrotza', 'Miribilla', 'Ametzola', 'Irala', 'Txurdinaga', 'Otxarkoaga', 'Zurbaranbarri', 'Bolueta'],
  },
  { name: 'Barakaldo', province: 'Bizkaia', region: PV, areas: ['Centro', 'Cruces', 'Lutxana', 'Burtzeña', 'San Vicente', 'Llano'] },
  { name: 'Getxo', province: 'Bizkaia', region: PV, areas: ['Algorta', 'Las Arenas', 'Neguri', 'Romo', 'Andra Mari'] },
  { name: 'Leioa', province: 'Bizkaia', region: PV, areas: ['Lamiako', 'Pinueta', 'Txorierri', 'Artaza'] },
  { name: 'Portugalete', province: 'Bizkaia', region: PV, areas: ['Casco Viejo', 'Repélega', 'Buena Vista'] },
  { name: 'Santurtzi', province: 'Bizkaia', region: PV, areas: ['Centro', 'Mamariga', 'Cabieces'] },
  { name: 'Basauri', province: 'Bizkaia', region: PV, areas: ['Centro', 'Ariz', 'Pozokoetxe', 'San Miguel'] },
  // --- Resto País Vasco / Navarra / Rioja / Cantabria ---
  {
    name: 'Donostia / San Sebastián', province: 'Gipuzkoa', region: PV,
    aliases: ['San Sebastián', 'Donostia', 'Donostia-San Sebastián', 'Donosti'],
    areas: ['Centro', 'Gros', 'Amara', 'Antiguo', 'Egia', 'Intxaurrondo', 'Aiete', 'Ibaeta', 'Loiola'],
  },
  {
    name: 'Vitoria-Gasteiz', province: 'Álava', region: PV, aliases: ['Vitoria', 'Gasteiz'],
    areas: ['Centro', 'Casco Viejo', 'Lovaina', 'Zaramaga', 'Salburua', 'Lakua', 'Zabalgana', 'Judimendi'],
  },
  {
    name: 'Pamplona', province: 'Navarra', region: 'Navarra', aliases: ['Iruña', 'Iruñea'],
    areas: ['Casco Viejo', 'Ensanche', 'Iturrama', 'Rochapea', 'San Juan', 'Mendebaldea', 'Txantrea', 'Milagrosa'],
  },
  { name: 'Logroño', province: 'La Rioja', region: 'La Rioja', areas: ['Centro', 'El Cubo', 'La Estrella', 'Yagüe', 'Valdegastea', 'Cascajos'] },
  { name: 'Santander', province: 'Cantabria', region: 'Cantabria', areas: ['Centro', 'El Sardinero', 'Puertochico', 'Cuatro Caminos', 'Valdenoja', 'Cazoña'] },
  // --- Aragón ---
  { name: 'Zaragoza', province: 'Zaragoza', region: 'Aragón', areas: ['Centro', 'Delicias', 'Actur', 'Casco Histórico', 'Universidad', 'Las Fuentes', 'Valdespartera'] },
  // --- Madrid ---
  {
    name: 'Madrid', province: 'Madrid', region: 'Comunidad de Madrid',
    areas: ['Salamanca', 'Chamberí', 'Centro', 'Chamartín', 'Retiro', 'Tetuán', 'Moncloa-Aravaca', 'Arganzuela', 'Latina', 'Carabanchel', 'Usera', 'Hortaleza', 'Fuencarral-El Pardo', 'Vallecas', 'Malasaña', 'Chueca', 'La Latina', 'Lavapiés'],
  },
  // --- Cataluña ---
  {
    name: 'Barcelona', province: 'Barcelona', region: 'Cataluña', aliases: ['Barna'],
    areas: ['Eixample', 'Gràcia', 'Ciutat Vella', 'Sarrià-Sant Gervasi', 'Les Corts', 'Sants-Montjuïc', 'Sant Martí', 'Poblenou', 'Horta-Guinardó', 'Sant Andreu', 'Nou Barris', 'El Born', 'Barceloneta'],
  },
  { name: 'Girona', province: 'Girona', region: 'Cataluña', aliases: ['Gerona'], areas: ['Barri Vell', 'Eixample', 'Santa Eugènia', 'Pont Major'] },
  { name: 'Tarragona', province: 'Tarragona', region: 'Cataluña', areas: ['Part Alta', 'Eixample', 'Serrallo', 'Sant Pere i Sant Pau'] },
  // --- Comunidad Valenciana / Murcia ---
  { name: 'Valencia', province: 'Valencia', region: 'Comunidad Valenciana', areas: ['Ciutat Vella', 'Eixample', 'Ruzafa', 'El Carmen', 'Benimaclet', 'El Grao', 'Campanar', 'Patraix'] },
  { name: 'Alicante', province: 'Alicante', region: 'Comunidad Valenciana', aliases: ['Alacant'], areas: ['Centro', 'Ensanche-Diputación', 'San Juan', 'Playa de San Juan', 'Albufereta', 'Carolinas'] },
  { name: 'Murcia', province: 'Murcia', region: 'Murcia', areas: ['Centro', 'El Carmen', 'La Flota', 'Vistabella', 'Santa María de Gracia', 'Infante Juan Manuel'] },
  // --- Andalucía ---
  {
    name: 'Málaga', province: 'Málaga', region: 'Andalucía',
    areas: ['Málaga Centro', 'Teatinos', 'El Limonar', 'Pedregalejo', 'Huelin', 'La Malagueta', 'El Palo', 'Cerrado de Calderón'],
  },
  {
    name: 'Marbella', province: 'Málaga', region: 'Andalucía',
    areas: ['Marbella Centro', 'Nueva Andalucía', 'Puerto Banús', 'San Pedro de Alcántara', 'Golden Mile', 'Los Monteros', 'Elviria', 'La Cala', 'Nagüeles', 'Las Chapas'],
  },
  { name: 'Estepona', province: 'Málaga', region: 'Andalucía', areas: ['Estepona Centro', 'Cancelada', 'El Padrón', 'Valle Romano'] },
  { name: 'Benahavís', province: 'Málaga', region: 'Andalucía', areas: ['Centro', 'La Quinta', 'La Zagaleta'] },
  { name: 'Sevilla', province: 'Sevilla', region: 'Andalucía', areas: ['Casco Antiguo', 'Triana', 'Nervión', 'Los Remedios', 'Macarena', 'Santa Cruz', 'Bami', 'Sevilla Este'] },
  { name: 'Granada', province: 'Granada', region: 'Andalucía', areas: ['Centro', 'Albaicín', 'Realejo', 'Zaidín', 'Ronda', 'Chana'] },
  { name: 'Córdoba', province: 'Córdoba', region: 'Andalucía', areas: ['Centro', 'Judería', 'Ciudad Jardín', 'El Brillante', 'Levante'] },
  // --- Galicia / Asturias ---
  { name: 'A Coruña', province: 'A Coruña', region: 'Galicia', aliases: ['La Coruña', 'Coruña'], areas: ['Ciudad Vieja', 'Ensanche', 'Riazor', 'Los Rosales', 'Monte Alto'] },
  { name: 'Vigo', province: 'Pontevedra', region: 'Galicia', areas: ['Casco Vello', 'Centro', 'Bouzas', 'Teis', 'Coia', 'Navia'] },
  { name: 'Oviedo', province: 'Asturias', region: 'Asturias', aliases: ['Uviéu'], areas: ['Centro', 'El Antiguo', 'La Corredoria', 'Vallobín', 'Teatinos'] },
  { name: 'Gijón', province: 'Asturias', region: 'Asturias', aliases: ['Xixón'], areas: ['Centro', 'Cimadevilla', 'El Bibio', 'La Calzada', 'El Llano', 'Somió'] },
  // --- Castilla y León ---
  { name: 'Valladolid', province: 'Valladolid', region: 'Castilla y León', areas: ['Centro', 'La Rondilla', 'Delicias', 'Parquesol', 'Huerta del Rey'] },
  { name: 'Salamanca', province: 'Salamanca', region: 'Castilla y León', areas: ['Centro', 'Garrido', 'Pizarrales', 'San Bernardo', 'Capuchinos'] },
  { name: 'Burgos', province: 'Burgos', region: 'Castilla y León', areas: ['Centro', 'Gamonal', 'San Pedro de la Fuente', 'Las Huelgas', 'Villímar'] },
  // --- Baleares ---
  { name: 'Palma', province: 'Illes Balears', region: 'Illes Balears', aliases: ['Palma de Mallorca'], areas: ['Centro', 'Santa Catalina', 'Son Espanyolet', 'El Terreno', 'Portixol', 'Son Vida'] },
]

// Ranking simple: coincidencia exacta > prefijo > contiene > (no coincide).
function rank(haystack: string, q: string): number {
  if (!q) return 3
  if (haystack === q) return 0
  if (haystack.startsWith(q)) return 1
  if (haystack.includes(q)) return 2
  return 99
}

// Mejor score de una ciudad considerando nombre + alias.
function cityScore(c: City, q: string): number {
  return Math.min(...[c.name, ...(c.aliases ?? [])].map((n) => rank(foldAccents(n), q)))
}

// --- Búsqueda solo-catálogo (base; usada por las funciones de mezcla y por los evals) -------------

export type CitySuggestion = { value: string; hint?: string }

export function searchCities(query: string, limit = 8): CitySuggestion[] {
  const q = foldAccents(query)
  return CITIES
    .map((c) => ({ c, score: cityScore(c, q) }))
    .filter((s) => s.score < 99)
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name, 'es'))
    .slice(0, limit)
    .map((s) => ({ value: s.c.name, hint: s.c.province }))
}

export function findCity(name: string | null | undefined): City | undefined {
  if (!name) return undefined
  const q = foldAccents(normalizeLocationText(name))
  return CITIES.find((c) => [c.name, ...(c.aliases ?? [])].some((n) => foldAccents(n) === q))
}

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

export function isKnownArea(cityName: string | null | undefined, area: string): boolean {
  const city = findCity(cityName)
  if (!city?.areas?.length || !area.trim()) return false
  const q = foldAccents(normalizeLocationText(area))
  return city.areas.some((a) => foldAccents(a) === q)
}

// --- Mezcla catálogo + valores del workspace (P16) -----------------------------------------------
// Orden: exacto workspace > exacto catálogo > prefijo workspace > prefijo catálogo > contiene workspace
// > contiene catálogo. Dedup por valor (sin acentos/mayúsculas); el valor del workspace gana.

export const SUGGESTION_LIMIT = 8

type Scored = { value: string; hint?: string; source: SuggestionSource; score: number }

function mergeRanked(items: Scored[], limit: number): { items: LocationSuggestion[]; capped: boolean } {
  const seen = new Set<string>()
  const sorted = items
    .filter((it) => it.score < 99)
    .sort((a, b) => a.score - b.score || a.value.localeCompare(b.value, 'es'))
  const out: LocationSuggestion[] = []
  for (const it of sorted) {
    const key = foldAccents(it.value)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ value: it.value, hint: it.hint, source: it.source })
    if (out.length >= limit) break
  }
  return { items: out, capped: sorted.length > out.length }
}

// Sugerencias de ciudad combinando catálogo + ciudades usadas en el workspace. Workspace prioriza.
export function suggestCities(query: string, workspaceCities: string[] = [], limit = SUGGESTION_LIMIT) {
  const q = foldAccents(query)
  const ws: Scored[] = workspaceCities.map((value) => ({
    value,
    source: 'workspace' as const,
    score: rank(foldAccents(value), q),
  }))
  const cat: Scored[] = CITIES.map((c) => ({
    value: c.name,
    hint: c.province,
    source: 'catalog' as const,
    // El catálogo va siempre detrás del mismo nivel de workspace (+0.5).
    score: cityScore(c, q) + 0.5,
  }))
  return mergeRanked([...ws, ...cat], limit)
}

// Sugerencias de zona/barrio combinando barrios del catálogo de la ciudad + zonas usadas en el workspace.
export function suggestAreas(
  cityName: string | null | undefined,
  query: string,
  workspaceAreas: string[] = [],
  limit = SUGGESTION_LIMIT,
) {
  const q = foldAccents(query)
  const city = findCity(cityName)
  const ws: Scored[] = workspaceAreas.map((value) => ({
    value,
    source: 'workspace' as const,
    score: rank(foldAccents(value), q),
  }))
  const cat: Scored[] = (city?.areas ?? []).map((value) => ({
    value,
    source: 'catalog' as const,
    score: rank(foldAccents(value), q) + 0.5,
  }))
  return mergeRanked([...ws, ...cat], limit)
}
