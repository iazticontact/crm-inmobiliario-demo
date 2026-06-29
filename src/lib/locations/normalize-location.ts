// Normalización de texto de ubicación (P15). Objetivo: que ciudad/zona se guarden limpias y
// consistentes sin sobreingeniería. No usa APIs externas. Preserva acentos, guiones de nombres
// oficiales (Vitoria-Gasteiz) y barras (Donostia / San Sebastián).

// Conectores que van en minúscula cuando NO son la primera palabra (de, del, la…).
const MINOR_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'a', 'o', 'u'])

// Quita acentos y baja a minúsculas para comparar/buscar (no para mostrar).
export function foldAccents(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// ¿El texto tiene al menos una letra? (evita guardar solo símbolos/números absurdos como ubicación).
export function hasLetters(value: string): boolean {
  return /\p{L}/u.test(value || '')
}

function capitalizeWord(word: string): string {
  if (!word) return word
  // Nombres con guion: capitaliza cada parte (Vitoria-Gasteiz).
  if (word.includes('-')) return word.split('-').map(capitalizeWord).join('-')
  const lower = word.toLocaleLowerCase('es')
  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1)
}

// "  bilbao " → "Bilbao" · "BILBAO" → "Bilbao" · "  plaza   españa " → "Plaza España" ·
// "vitoria-gasteiz" → "Vitoria-Gasteiz" · "donostia / san sebastián" → "Donostia / San Sebastián".
export function normalizeLocationText(input: string): string {
  if (!input) return ''
  const collapsed = input.trim().replace(/\s+/g, ' ')
  if (!collapsed) return ''
  return collapsed
    .split(' ')
    .map((word, i) => {
      if (word === '/') return '/'
      const lower = word.toLocaleLowerCase('es')
      if (i !== 0 && MINOR_WORDS.has(lower)) return lower
      return capitalizeWord(word)
    })
    .join(' ')
}

// Igualdad de ubicación ignorando acentos/mayúsculas/espacios (para detectar duplicados/coincidencias).
export function sameLocation(a: string, b: string): boolean {
  return foldAccents(normalizeLocationText(a)) === foldAccents(normalizeLocationText(b))
}

// Valor listo para guardar: normalizado, o cadena vacía si es solo símbolos/números (no ensuciar BD).
export function normalizeLocationForSave(input: string): string {
  return hasLetters(input) ? normalizeLocationText(input) : ''
}
