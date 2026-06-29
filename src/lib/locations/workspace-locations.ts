'use client'

// Sugerencias de ubicación a partir de los datos REALES del workspace (P16). Si una inmobiliaria
// trabaja mucho en "Paterna" o "La Cañada", debe sugerirse aunque no esté en el catálogo. Se lee una
// vez (al abrir el drawer) bajo RLS con el cliente de navegador — NUNCA service_role — y se cachea en
// memoria durante la sesión. Si falla, se degrada en silencio al catálogo local.

import { getSupabaseBrowserClient } from '@/lib/supabase'
import { normalizeLocationText, foldAccents } from './normalize-location'

export type WorkspaceLocations = {
  /** Ciudades usadas en el workspace, normalizadas y sin duplicados. */
  cities: string[]
  /** Zonas por ciudad: clave = ciudad sin acentos/mayúsculas → barrios normalizados. */
  areasByCity: Record<string, string[]>
  /** Todas las zonas usadas (fallback cuando no se conoce la ciudad). */
  allAreas: string[]
}

const EMPTY: WorkspaceLocations = { cities: [], areasByCity: {}, allAreas: [] }
const cache = new Map<string, WorkspaceLocations>()

export async function getWorkspaceLocations(workspaceId: string | null | undefined): Promise<WorkspaceLocations> {
  if (!workspaceId) return EMPTY
  const cached = cache.get(workspaceId)
  if (cached) return cached
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return EMPTY
  const { data, error } = await supabase
    .from('properties')
    .select('city, area')
    .eq('workspace_id', workspaceId)
    .limit(2000)
  if (error || !Array.isArray(data)) {
    if (process.env.NODE_ENV === 'development') console.warn('[getWorkspaceLocations]', error?.message)
    return EMPTY
  }
  const cities = new Map<string, string>()
  const areasByCity = new Map<string, Map<string, string>>()
  const allAreas = new Map<string, string>()
  for (const row of data as Array<{ city: string | null; area: string | null }>) {
    const city = row.city ? normalizeLocationText(row.city) : ''
    const area = row.area ? normalizeLocationText(row.area) : ''
    if (city) cities.set(foldAccents(city), city)
    if (area) {
      allAreas.set(foldAccents(area), area)
      const ck = foldAccents(city)
      if (!areasByCity.has(ck)) areasByCity.set(ck, new Map())
      areasByCity.get(ck)!.set(foldAccents(area), area)
    }
  }
  const result: WorkspaceLocations = {
    cities: [...cities.values()].sort((a, b) => a.localeCompare(b, 'es')),
    areasByCity: Object.fromEntries([...areasByCity.entries()].map(([k, m]) => [k, [...m.values()]])),
    allAreas: [...allAreas.values()].sort((a, b) => a.localeCompare(b, 'es')),
  }
  cache.set(workspaceId, result)
  return result
}

export function clearWorkspaceLocationsCache(workspaceId?: string) {
  if (workspaceId) cache.delete(workspaceId)
  else cache.clear()
}

// Zonas del workspace para una ciudad concreta; si no hay ciudad conocida, devuelve todas las usadas.
export function workspaceAreasFor(loc: WorkspaceLocations, cityName: string): string[] {
  if (!cityName.trim()) return loc.allAreas
  return loc.areasByCity[foldAccents(cityName)] ?? []
}
