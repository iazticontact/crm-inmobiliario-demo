// PROTOTIPO AISLADO (general-semantic-planner) — RESOLUCIÓN DE ENTIDAD UNIFICADA (FASE 4).
// UNA sola capa. Recibe una referencia LINGÜÍSTICA (nombre, pronombre, ordinal) + tipos esperados +
// workspace vivo + estado de discurso. Devuelve RESOLVED | AMBIGUOUS | NOT_FOUND. Resuelve SIEMPRE contra
// la BD real (nunca contra ids inventados por el modelo). Reglas duras:
//   · NOT_FOUND jamás degrada a lista global.
//   · AMBIGUOUS jamás auto-selecciona.
//   · si el tipo A no encuentra, NO se usa B en silencio (se prueba en orden y se reporta qué se intentó).
// No hay ninguna lista de sinónimos ni frases cableadas: matching por normalización + similitud de tokens.

import type { SupabaseClient } from '@supabase/supabase-js'
import { foldText } from '@/lib/real-estate-search'
import { crmReadQuery, isReaderError } from '@/lib/agent-tool-readers'
import type { EntityType } from './capability-ontology'

export type Candidate = { id: string; label: string; raw: Record<string, unknown> }
export type Resolution =
  | { status: 'RESOLVED'; type: EntityType; id: string; label: string; confidence: number; source: 'name' | 'context' | 'ordinal' }
  | { status: 'AMBIGUOUS'; type: EntityType; candidates: Candidate[] }
  | { status: 'NOT_FOUND'; triedTypes: EntityType[] }
  | { status: 'STALE'; type: EntityType; label: string }   // FASE 11: referencia previa que ya no existe

export type DiscourseRef = {
  activeEntities: Array<{ type: string; label: string; id?: string }>
  lastListed?: { type: string; items: Array<{ id: string; label: string }> } | null
}

// Cómo se lista/busca cada tipo con el reader universal (allowlist real de crmReadQuery).
const ENTITY_QUERY: Record<Exclude<EntityType, 'none' | 'commission'>, { entity: string; labelCol: string }> = {
  client: { entity: 'clients', labelCol: 'name' },
  property: { entity: 'properties', labelCol: 'title' },
  opportunity: { entity: 'opportunities', labelCol: 'title' },
  task: { entity: 'tasks', labelCol: 'title' },
  calendar_event: { entity: 'calendar_events', labelCol: 'title' },
  service_case: { entity: 'service_cases', labelCol: 'title' },
  document: { entity: 'activities', labelCol: 'title' }, // documentos no se resuelven por nombre aquí
}

const PRONOUN_RE = /^(él|ella|ellos|ellas|ese|esa|este|esta|eso|le|lo|la|su|sus|mismo|dicho|aquel|aquella|el mismo|la misma)$/i
const ORDINAL_RE = /^ordinal:(\d+)$/i
// también aceptamos ordinales en lenguaje por si el planner no normalizó
const ORDINAL_WORDS: Record<string, number> = {
  primero: 1, primer: 1, segundo: 2, tercero: 3, tercer: 3, cuarto: 4, quinto: 5, sexto: 6,
  'último': -1, ultimo: -1,
}

async function fetchCandidates(
  supabase: SupabaseClient, workspaceId: string, type: EntityType, searchText: string | null, limit: number,
): Promise<Candidate[]> {
  const cfg = ENTITY_QUERY[type as Exclude<EntityType, 'none' | 'commission'>]
  if (!cfg) return []
  const input: Record<string, unknown> = { entity: cfg.entity, limit }
  if (searchText) input.searchText = searchText
  const res = await crmReadQuery(supabase, workspaceId, input)
  if (isReaderError(res)) return []
  return res.rows.map((r) => ({ id: String(r.id), label: String((r as Record<string, unknown>)[cfg.labelCol] ?? ''), raw: r as Record<string, unknown> }))
}

// Similitud 0..1 entre la referencia y un candidato, insensible a acentos/mayúsculas, por tokens.
function similarity(ref: string, label: string): number {
  const a = foldText(ref), b = foldText(label)
  if (!a || !b) return 0
  if (a === b) return 1
  const at = new Set(a.split(/\s+/).filter(Boolean))
  const bt = new Set(b.split(/\s+/).filter(Boolean))
  if (!at.size || !bt.size) return 0
  // subconjunto fuerte: todos los tokens de la referencia están en el label (p. ej. "laura" ⊂ "laura gómez")
  let inter = 0
  for (const t of at) if (bt.has(t)) inter++
  const jaccard = inter / (at.size + bt.size - inter)
  const coverageRef = inter / at.size          // cuánta de la referencia está cubierta
  // contención de substring (nombres compuestos sin espacio, typos leves)
  const contains = b.includes(a) || a.includes(b) ? 0.6 : 0
  return Math.max(jaccard, coverageRef * 0.9, contains)
}

const RESOLVE_MIN = 0.5      // por debajo → NOT_FOUND
const AMBIGUOUS_MARGIN = 0.15 // si el 1º y 2º están a menos de este margen y el 1º no es exacto → AMBIGUOUS

export async function resolveEntity(args: {
  supabase: SupabaseClient
  workspaceId: string
  ref: string | null
  expectedTypes: EntityType[]
  discourse: DiscourseRef
}): Promise<Resolution> {
  const { supabase, workspaceId, discourse } = args
  const types = args.expectedTypes.filter((t) => t !== 'none' && t !== 'commission')
  const ref = (args.ref ?? '').trim()

  // 1) PRONOMBRE / elipsis (o ref vacía con contexto): usar activeEntities del discurso, verificando vivo.
  const isPronoun = !ref || PRONOUN_RE.test(ref)
  if (isPronoun && discourse.activeEntities.length) {
    for (const t of types) {
      const active = discourse.activeEntities.find((e) => e.type === t)
      if (!active) continue
      // Verificar contra BD real (FASE 11 stale check): re-resolver por label.
      const cands = await fetchCandidates(supabase, workspaceId, t, active.label, 10)
      const exact = cands.find((c) => foldText(c.label) === foldText(active.label))
      if (exact) return { status: 'RESOLVED', type: t, id: exact.id, label: exact.label, confidence: 1, source: 'context' }
      if (active.id) {
        // tenía id pero ya no aparece → puede ser stale
        const byId = cands.find((c) => c.id === active.id)
        if (byId) return { status: 'RESOLVED', type: t, id: byId.id, label: byId.label, confidence: 1, source: 'context' }
        return { status: 'STALE', type: t, label: active.label }
      }
      if (cands.length === 1) return { status: 'RESOLVED', type: t, id: cands[0].id, label: cands[0].label, confidence: 0.8, source: 'context' }
    }
    // pronombre sin antecedente resoluble
    if (!ref) return { status: 'NOT_FOUND', triedTypes: types }
  }

  // 2) ORDINAL sobre la última lista.
  const mOrd = ORDINAL_RE.exec(ref)
  const ordWord = ORDINAL_WORDS[foldText(ref)]
  const ordinal = mOrd ? Number(mOrd[1]) : (ordWord ?? null)
  if (ordinal != null && discourse.lastListed && discourse.lastListed.items.length) {
    const items = discourse.lastListed.items
    const idx = ordinal === -1 ? items.length - 1 : ordinal - 1
    const listType = discourse.lastListed.type as EntityType
    if (idx >= 0 && idx < items.length && (types.length === 0 || (types as EntityType[]).includes(listType))) {
      // Verificar que sigue existiendo (stale check).
      const live = await fetchCandidates(supabase, workspaceId, listType, items[idx].label, 5)
      const stillThere = live.find((c) => c.id === items[idx].id) ?? live.find((c) => foldText(c.label) === foldText(items[idx].label))
      if (stillThere) return { status: 'RESOLVED', type: listType, id: stillThere.id, label: stillThere.label, confidence: 0.95, source: 'ordinal' }
      return { status: 'STALE', type: listType, label: items[idx].label }
    }
  }

  // 3) NOMBRE. Probar tipos EN ORDEN; no mezclar en silencio.
  if (ref) {
    for (const t of types) {
      const cands = await fetchCandidates(supabase, workspaceId, t, ref, 20)
      if (!cands.length) continue
      const scored = cands.map((c) => ({ c, s: similarity(ref, c.label) })).sort((a, b) => b.s - a.s)
      const best = scored[0]
      if (best.s < RESOLVE_MIN) continue // este tipo no matchea; probar siguiente tipo
      const exact = best.s >= 0.999
      const second = scored[1]
      const ambiguous = !exact && second && (best.s - second.s) < AMBIGUOUS_MARGIN && second.s >= RESOLVE_MIN
      if (ambiguous) {
        const tie = scored.filter((x) => x.s >= second.s - 0.02).slice(0, 5).map((x) => x.c)
        return { status: 'AMBIGUOUS', type: t, candidates: tie }
      }
      return { status: 'RESOLVED', type: t, id: best.c.id, label: best.c.label, confidence: best.s, source: 'name' }
    }
  }

  return { status: 'NOT_FOUND', triedTypes: types }
}
