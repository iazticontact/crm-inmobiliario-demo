// Evals del catálogo y la normalización de ubicaciones (P15). Sin runner en el repo; documenta el
// comportamiento esperado y permite verificarlo con `runLocationEvals()` (vacío = todo OK).

import { normalizeLocationText, normalizeLocationForSave, foldAccents, hasLetters } from '@/lib/locations/normalize-location'
import { searchCities, searchAreas, findCity, isKnownArea } from '@/lib/locations/location-catalog'

export const NORMALIZE_CASES: Array<{ input: string; expected: string }> = [
  { input: ' bilbao ', expected: 'Bilbao' },
  { input: 'BILBAO', expected: 'Bilbao' },
  { input: 'deusto', expected: 'Deusto' },
  { input: '  plaza   españa ', expected: 'Plaza España' },
  { input: 'vitoria-gasteiz', expected: 'Vitoria-Gasteiz' },
  { input: 'donostia / san sebastián', expected: 'Donostia / San Sebastián' },
  { input: 'el grao', expected: 'El Grao' },
  { input: 'casco viejo', expected: 'Casco Viejo' },
]

export function runLocationEvals(): string[] {
  const fail: string[] = []

  for (const c of NORMALIZE_CASES) {
    const got = normalizeLocationText(c.input)
    if (got !== c.expected) fail.push(`normalize("${c.input}") = "${got}", esperado "${c.expected}"`)
  }

  // Sugerir Bilbao al escribir "bil".
  if (!searchCities('bil').some((s) => s.value === 'Bilbao')) fail.push('searchCities("bil") no incluye Bilbao')
  // Encontrar Donostia por alias "san sebastián".
  if (!searchCities('san sebas').some((s) => s.value.startsWith('Donostia'))) fail.push('searchCities("san sebas") no incluye Donostia')
  if (findCity('san sebastián')?.name?.startsWith('Donostia') !== true) fail.push('findCity("san sebastián") no resuelve a Donostia')
  // Provincia como pista.
  if (searchCities('bilbao')[0]?.hint !== 'Bizkaia') fail.push('searchCities("bilbao") sin pista de provincia Bizkaia')

  // Zonas dependientes de la ciudad: Bilbao + "de" → Deusto.
  if (!searchAreas('Bilbao', 'de').includes('Deusto')) fail.push('searchAreas("Bilbao","de") no incluye Deusto')
  // Sin query, devuelve la lista de barrios de la ciudad.
  if (searchAreas('Bilbao', '').length === 0) fail.push('searchAreas("Bilbao","") vacío')
  // Ciudad desconocida → sin sugerencias de barrio (pero no rompe).
  if (searchAreas('Bilbaooo', 'de').length !== 0) fail.push('searchAreas(ciudad desconocida) debería ser vacío')

  // Zona conocida vs personalizada.
  if (!isKnownArea('Bilbao', 'deusto')) fail.push('isKnownArea("Bilbao","deusto") debería ser true')
  if (isKnownArea('Bilbao', 'Zona Inventada')) fail.push('isKnownArea zona inexistente debería ser false')

  // Helpers de soporte.
  if (foldAccents('Málaga') !== 'malaga') fail.push('foldAccents no quita acentos')
  if (hasLetters('123 #@!')) fail.push('hasLetters("123 #@!") debería ser false')
  if (!hasLetters('Bilbao')) fail.push('hasLetters("Bilbao") debería ser true')

  // Guardado: solo símbolos/números → cadena vacía (no ensuciar BD); texto válido → normalizado.
  if (normalizeLocationForSave('123 ###') !== '') fail.push('normalizeLocationForSave(symbols) debería ser ""')
  if (normalizeLocationForSave('  bilbao ') !== 'Bilbao') fail.push('normalizeLocationForSave("  bilbao ") debería ser "Bilbao"')

  return fail
}
