// Datos de país e idioma para los autocompletes de cliente (P29). Nombres canónicos es-ES.
// Búsqueda tolerante a acentos, por prefijo y por "contiene". Sin dependencias.

export type Option = { value: string; label: string; aliases?: string[] }

export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim()
}

// Idiomas frecuentes en una inmobiliaria española (co-oficiales + internacionales habituales).
export const LANGUAGES: Option[] = [
  { value: 'Español', label: 'Español', aliases: ['castellano', 'es', 'spanish'] },
  { value: 'Inglés', label: 'Inglés', aliases: ['english', 'en'] },
  { value: 'Francés', label: 'Francés', aliases: ['french', 'fr'] },
  { value: 'Alemán', label: 'Alemán', aliases: ['german', 'de', 'deutsch'] },
  { value: 'Italiano', label: 'Italiano', aliases: ['italian', 'it'] },
  { value: 'Portugués', label: 'Portugués', aliases: ['portuguese', 'pt'] },
  { value: 'Euskera', label: 'Euskera', aliases: ['vasco', 'euskara', 'eu'] },
  { value: 'Catalán', label: 'Catalán', aliases: ['catala', 'ca'] },
  { value: 'Gallego', label: 'Gallego', aliases: ['galego', 'gl'] },
  { value: 'Neerlandés', label: 'Neerlandés', aliases: ['holandes', 'dutch', 'nl'] },
  { value: 'Árabe', label: 'Árabe', aliases: ['arabic', 'ar'] },
  { value: 'Rumano', label: 'Rumano', aliases: ['romanian', 'ro'] },
  { value: 'Ruso', label: 'Ruso', aliases: ['russian', 'ru'] },
  { value: 'Chino', label: 'Chino', aliases: ['mandarin', 'zh'] },
  { value: 'Polaco', label: 'Polaco', aliases: ['polish', 'pl'] },
  { value: 'Ucraniano', label: 'Ucraniano', aliases: ['ukrainian', 'uk'] },
  { value: 'Sueco', label: 'Sueco', aliases: ['swedish', 'sv'] },
  { value: 'Noruego', label: 'Noruego', aliases: ['norwegian', 'no'] },
  { value: 'Otro', label: 'Otro', aliases: [] },
]

// Países (subconjunto amplio, con foco en Europa/Latam/Magreb, habituales en cartera es-ES).
export const COUNTRIES: Option[] = [
  'España', 'Portugal', 'Francia', 'Italia', 'Alemania', 'Reino Unido', 'Irlanda', 'Países Bajos',
  'Bélgica', 'Suiza', 'Austria', 'Luxemburgo', 'Andorra', 'Mónaco', 'Suecia', 'Noruega', 'Dinamarca',
  'Finlandia', 'Polonia', 'Rumanía', 'Bulgaria', 'Ucrania', 'Rusia', 'Grecia', 'Turquía', 'Marruecos',
  'Argelia', 'Túnez', 'Egipto', 'Senegal', 'Nigeria', 'Estados Unidos', 'Canadá', 'México', 'Argentina',
  'Colombia', 'Chile', 'Perú', 'Ecuador', 'Venezuela', 'Uruguay', 'Bolivia', 'Paraguay', 'Brasil',
  'República Dominicana', 'Cuba', 'China', 'Japón', 'India', 'Pakistán', 'Filipinas', 'Emiratos Árabes Unidos',
  'Catar', 'Arabia Saudí', 'Australia', 'Otro',
].map((c) => ({ value: c, label: c }))

// Filtro compartido: prioriza los que EMPIEZAN por la query, luego los que la CONTIENEN (nombre o alias).
export function filterOptions(options: Option[], query: string, limit = 8): Option[] {
  const q = fold(query)
  if (!q) return options.slice(0, limit)
  const starts: Option[] = []
  const contains: Option[] = []
  for (const o of options) {
    const name = fold(o.label)
    const inName = name.includes(q)
    const inAlias = (o.aliases ?? []).some((a) => fold(a).includes(q))
    if (name.startsWith(q)) starts.push(o)
    else if (inName || inAlias) contains.push(o)
  }
  return [...starts, ...contains].slice(0, limit)
}
