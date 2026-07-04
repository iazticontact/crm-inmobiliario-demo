// Local-first answers for BASIC read intents (P47) — reliability layer for the CRM assistant.
//
// The assistant's default brain is n8n Agent V2 (calls back into /api/agent/tool). That whole path can
// fail on a demo (n8n down, CRM_BASE_URL wrong, tool timeout) and the LLM then apologises with a vague
// "no puedo acceder a los clientes". For the queries a validator ALWAYS tries — "qué clientes tengo",
// "qué pisos hay en cartera", "3 habs 2 baños +80 m²", "y el de Malasaña?" — we answer DIRECTLY here,
// deterministically, using the user's RLS Supabase session. No n8n, no OpenAI, no service_role.
//
// Everything is workspace-scoped and read-only. Detection + formatting are PURE (eval-tested); only the
// two `handle*` functions touch the DB. Errors return a human message + a stable code (logged server-side).

import type { SupabaseClient } from '@supabase/supabase-js'
import { foldText } from '@/lib/real-estate-search'
import { searchProperties, searchClients, type SearchPropertyItem } from '@/lib/agent-tool-readers'

export type LocalAnswer =
  | { handled: true; answer: string; usedTool: string }
  | { handled: false }

// Verbos de escritura: si el mensaje pide crear/editar/borrar/agendar, NO respondemos localmente
// (lo maneja el fallback determinista / n8n). Evita que "elimina el piso X" devuelva un listado.
const WRITE_VERBS = /\b(crea|crear|crea me|añad|anad|agrega|agregar|nuev[oa]|elimina|elimin|borra|borrar|actualiza|actualizar|cambia|cambiar|modifica|edita|editar|marca|marcar|mueve|mover|programa|programar|agenda|agendar|asigna|asignar|registra un|apunta|guarda)\b/

const PROPERTY_VOCAB = /\b(inmueble|inmuebles|piso|pisos|apartamento|apartamentos|casa|casas|chalet|chalets|adosado|adosados|atico|aticos|duplex|local|locales|garaje|garajes|trastero|trasteros|terreno|terrenos|nave|naves|oficina|oficinas|vivienda|viviendas|propiedad|propiedades|cartera)\b/
const OPERATION_HINT = /\ben (venta|alquiler)\b|\bde venta\b|\bde alquiler\b/
const OTHER_ENTITY = /\b(factura|facturas|cita|citas|tarea|tareas|evento|eventos|comision|comisiones|tramite|tramites|expediente|expedientes|conversacion|conversaciones)\b/

// ── Detección de intención de CLIENTES (listar) ──────────────────────────────
export function detectClientsListIntent(message: string): boolean {
  const n = foldText(message)
  if (!/\bclient(e|es|a|as)\b/.test(n)) return false
  if (PROPERTY_VOCAB.test(n) || OTHER_ENTITY.test(n)) return false
  return /\b(que|cuant[oa]s|list[ae]|listado|listar|muestra|muestrame|ensename|ensena|ver|dame|tengo|tienes|hay|mis|todos|todas|registrad[oa]s|dime|cuales)\b/.test(n)
    || n.replace(/[¿?¡!.\s]/g, '') === 'clientes'
}

// ── Detección de búsqueda de un CLIENTE concreto por nombre ──────────────────
const CLIENT_STOP = new Set([
  'busca', 'buscar', 'buscame', 'encuentra', 'encuentrame', 'localiza', 'localizame', 'dame', 'muestra',
  'muestrame', 'ensename', 'ensena', 'ver', 'abre', 'abreme', 'ficha', 'informacion', 'info', 'datos',
  'sobre', 'el', 'la', 'los', 'las', 'un', 'una', 'cliente', 'clienta', 'clientes', 'clientas', 'llamado',
  'llamada', 'que', 'se', 'llama', 'a', 'al', 'de', 'del', 'me', 'quiero', 'necesito', 'dime',
  // Palabras de "listado" (para que "qué clientes tengo" no deje un nombre residual):
  'tengo', 'tienes', 'tiene', 'hay', 'mis', 'tus', 'todos', 'todas', 'registrados', 'registradas',
  'cuantos', 'cuantas', 'lista', 'listame', 'listado', 'cuales', 'mios', 'mias', 'hola',
])
export function detectClientSearch(message: string): { name: string } | null {
  const n = foldText(message)
  if (!/\bcliente|\bbusca|\bencuentra|\blocaliza/.test(n)) return null
  if (PROPERTY_VOCAB.test(n) || OTHER_ENTITY.test(n)) return null
  const needle = n
    .replace(/[¿?¡!.,;:]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !CLIENT_STOP.has(w) && !/^\d+$/.test(w))
    .join(' ')
    .trim()
  if (needle.length < 2) return null
  return { name: needle.slice(0, 60) }
}

// ── Detección de intención de INMUEBLES (listar/filtrar/seguimiento) ─────────
export function detectPropertiesIntent(message: string, recentContext = ''): { query: string } | null {
  const n = foldText(message)
  if (PROPERTY_VOCAB.test(n) || OPERATION_HINT.test(n)) return { query: message }
  // Follow-up contextual: "y el de Malasaña?" cuando la conversación iba de inmuebles/cartera.
  const ctx = foldText(recentContext)
  const talkingProps = PROPERTY_VOCAB.test(ctx) || OPERATION_HINT.test(ctx)
  if (talkingProps && !OTHER_ENTITY.test(n)) {
    const nf = n.replace(/[¿?¡!.]/g, ' ').replace(/\s+/g, ' ').trim()
    const words = nf.split(' ')
    if (words.length <= 6 && /^(?:y|e)\s+/.test(nf)) {
      // "y el de Malasaña", "y en el centro", "y del barrio X" → quitar conector + artículos/preposiciones.
      let q = nf.replace(/^(?:y|e)\s+/, '')
      while (/^(?:el|la|los|las|lo|un|una|unos|unas|de|del|en)\s+/.test(q)) {
        q = q.replace(/^(?:el|la|los|las|lo|un|una|unos|unas|de|del|en)\s+/, '')
      }
      q = q.trim()
      if (q.length >= 2) return { query: q }
    }
  }
  return null
}

// ── Formateo (PURO, sin IDs) ─────────────────────────────────────────────────
function cap(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
function euro(n: number): string { return `${n.toLocaleString('es-ES')} €` }

export function formatPropertyLine(p: {
  title?: string | null; address?: string | null; property_type?: string | null; operation_type?: string | null
  price?: number | null; city?: string | null; area?: string | null
  bedrooms?: number | null; bathrooms?: number | null; area_m2?: number | null
}): string {
  const head = (p.title && p.title.trim()) || (p.address && p.address.trim()) || 'Inmueble'
  const loc = [p.city, p.area].map((s) => (s ? s.trim() : '')).filter(Boolean).join(' / ')
  const specs: string[] = []
  if (typeof p.bedrooms === 'number') specs.push(`${p.bedrooms} hab`)
  if (typeof p.bathrooms === 'number') specs.push(`${p.bathrooms} baños`)
  if (typeof p.area_m2 === 'number') specs.push(`${p.area_m2} m²`)
  const parts = [
    p.property_type ? cap(p.property_type) : null,
    p.operation_type ? cap(p.operation_type) : null,
    typeof p.price === 'number' ? euro(p.price) : null,
    loc || null,
    specs.length ? specs.join(' · ') : null,
  ].filter(Boolean)
  return `• ${head} — ${parts.join(' · ')}`
}

export function formatClientLine(c: {
  name?: string | null; company?: string | null; email?: string | null; phone?: string | null
}): string {
  const head = (c.name && c.name.trim()) || 'Cliente'
  const parts = [c.company, c.email, c.phone].map((s) => (s ? s.trim() : '')).filter(Boolean)
  return parts.length ? `• ${head} — ${parts.join(' · ')}` : `• ${head}`
}

// ── Ejecución (DB, RLS del usuario) ──────────────────────────────────────────
async function handleClientsList(supabase: SupabaseClient, workspaceId: string): Promise<LocalAnswer> {
  const { data, error, count } = await supabase
    .from('clients')
    .select('id, name, company, email, phone', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(12)
  if (error) {
    console.error('[assistant.local] CLIENTS_READ_FAILED', { ws: workspaceId, code: error.code })
    return { handled: true, usedTool: 'local_clients', answer: 'No he podido consultar los clientes por un problema de datos. Código: CLIENTS_READ_FAILED. Vuelve a intentarlo en unos segundos.' }
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const total = typeof count === 'number' ? count : rows.length
  if (total === 0) return { handled: true, usedTool: 'local_clients', answer: 'No hay clientes registrados todavía. Cuando añadas alguno aparecerá aquí.' }
  const lines = rows.map((c) => formatClientLine({
    name: c.name as string, company: c.company as string, email: c.email as string, phone: c.phone as string,
  }))
  const head = total === 1
    ? 'Tienes 1 cliente registrado:'
    : `Tienes ${total} clientes registrados${total > rows.length ? `. Te muestro los ${rows.length} más recientes:` : ':'}`
  return {
    handled: true, usedTool: 'local_clients',
    answer: `${head}\n${lines.join('\n')}\n\n¿Quieres que busque un cliente concreto o que abra su ficha?`,
  }
}

async function handleClientSearch(supabase: SupabaseClient, workspaceId: string, name: string): Promise<LocalAnswer> {
  const res = await searchClients(supabase, workspaceId, { query: name, limit: 8 })
  if ('error' in res) {
    if (res.error === 'invalid_input') return { handled: false } // deja que el cerebro general lo intente
    console.error('[assistant.local] CLIENTS_SEARCH_FAILED', { ws: workspaceId })
    return { handled: true, usedTool: 'local_clients', answer: 'No he podido buscar el cliente por un problema de datos. Código: CLIENTS_READ_FAILED.' }
  }
  if (!res.results.length) {
    return { handled: true, usedTool: 'local_clients', answer: `No he encontrado ningún cliente que coincida con «${name}». ¿Quieres que te liste todos los clientes?` }
  }
  const lines = res.results.map((c) => formatClientLine(c))
  const head = res.results.length === 1 ? 'He encontrado 1 cliente:' : `He encontrado ${res.results.length} clientes:`
  return { handled: true, usedTool: 'local_clients', answer: `${head}\n${lines.join('\n')}` }
}

async function handleProperties(supabase: SupabaseClient, workspaceId: string, query: string): Promise<LocalAnswer> {
  const res = await searchProperties(supabase, workspaceId, { query, availabilityMode: 'available' })
  if ('error' in res) {
    console.error('[assistant.local] PROPERTIES_READ_FAILED', { ws: workspaceId })
    return { handled: true, usedTool: 'local_properties', answer: 'No he podido consultar la cartera por un problema de datos. Código: PROPERTIES_READ_FAILED. Vuelve a intentarlo en unos segundos.' }
  }
  const exact = res.exactMatches
  const partial = res.partialMatches
  const bullet = (p: SearchPropertyItem) => formatPropertyLine(p)
  const followUp = '\n\n¿Quieres que filtre por zona, precio, habitaciones, baños o m²?'

  if (exact.length) {
    const head = exact.length === 1 ? 'Solo he encontrado un inmueble que encaja:' : `Encontré ${exact.length} inmuebles que encajan:`
    let answer = `${head}\n${exact.map(bullet).join('\n')}`
    if (partial.length) answer += `\n\nParecidos (no cumplen todo):\n${partial.slice(0, 4).map(bullet).join('\n')}`
    return { handled: true, usedTool: 'local_properties', answer: answer + followUp }
  }
  if (partial.length) {
    const head = partial.length === 1 ? 'No hay coincidencia exacta. Lo más cercano:' : 'No hay inmuebles que cumplan todos los criterios. Lo más cercano:'
    return { handled: true, usedTool: 'local_properties', answer: `${head}\n${partial.slice(0, 6).map(bullet).join('\n')}${followUp}` }
  }
  const warn = res.warnings[0]
  const base = warn
    ? (warn.includes('cerrados') ? 'No hay inmuebles disponibles con esos criterios; los que había están cerrados (vendidos/alquilados/archivados).' : 'No he encontrado inmuebles con esos criterios en la cartera activa.')
    : 'No he encontrado inmuebles con esos criterios en la cartera activa.'
  return { handled: true, usedTool: 'local_properties', answer: `${base}${followUp}` }
}

// Punto de entrada. Devuelve { handled:false } si el mensaje no es una consulta básica de lectura que
// sepamos responder localmente (entonces el llamante sigue con n8n / el cerebro general).
export async function tryLocalAnswer(
  supabase: SupabaseClient,
  workspaceId: string,
  message: string,
  recentContext = '',
): Promise<LocalAnswer> {
  const n = foldText(message)
  if (WRITE_VERBS.test(n)) return { handled: false }

  // Clientes: primero búsqueda por nombre, luego listado.
  const cs = detectClientSearch(message)
  if (cs) return handleClientSearch(supabase, workspaceId, cs.name)
  if (detectClientsListIntent(message)) return handleClientsList(supabase, workspaceId)

  // Inmuebles / cartera (incluye seguimiento contextual "y el de Malasaña?").
  const pi = detectPropertiesIntent(message, recentContext)
  if (pi) return handleProperties(supabase, workspaceId, pi.query)

  return { handled: false }
}
