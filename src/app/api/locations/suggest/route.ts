// /api/locations/suggest (P17) — autocompletado de ubicación tipo logística, seguro y con fallback.
//
// Capas (de mayor a menor prioridad): valores reales usados por la EMPRESA (RLS) → proveedor externo
// (si está configurado por env; la clave vive SOLO aquí, nunca en el cliente) → catálogo local.
// Si el proveedor no está configurado o falla, se degrada en silencio a empresa + local: nunca rompe.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { checkRateLimit } from '@/lib/assistant-guard'
import { foldAccents, normalizeLocationText } from '@/lib/locations/normalize-location'
import { searchCities, searchAreas } from '@/lib/locations/location-catalog'
import { getLocationProvider, locationCountry } from '@/lib/locations/providers.server'

export const runtime = 'nodejs'

type Kind = 'municipality' | 'neighborhood' | 'district' | 'locality' | 'province' | 'address' | 'custom'
type Source = 'workspace' | 'provider' | 'local'
type Item = { id: string; label: string; secondary?: string; kind: Kind; source: Source; province?: string }

const MAX = 8
const cache = new Map<string, { at: number; payload: unknown }>()
const TTL = 60_000

async function userClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const store = await cookies()
  return createServerClient(url, key, {
    cookies: { getAll() { return store.getAll() }, setAll(list) { try { list.forEach(({ name, value, options }) => store.set(name, value, options)) } catch { /* static */ } } },
  })
}

function rank(haystack: string, q: string): number {
  if (!q) return 3
  if (haystack === q) return 0
  if (haystack.startsWith(q)) return 1
  if (haystack.includes(q)) return 2
  return 99
}

export async function GET(req: NextRequest) {
  const supabase = await userClient()
  if (!supabase) return NextResponse.json({ items: [], providerActive: false })
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return NextResponse.json({ error: 'No autenticado', items: [] }, { status: 401 })

  if (!checkRateLimit(`loc:${userData.user.id}`, 90)) {
    return NextResponse.json({ items: [], capped: false, providerActive: false, rateLimited: true })
  }

  const { searchParams } = new URL(req.url)
  const rawQ = (searchParams.get('q') ?? '').trim().slice(0, 80)
  const type = searchParams.get('type') === 'area' ? 'area' : 'locality'
  const locality = (searchParams.get('locality') ?? '').trim().slice(0, 80)
  const country = locationCountry()
  const q = foldAccents(rawQ)

  const { data: profile } = await supabase.from('profiles').select('workspace_id').eq('id', userData.user.id).maybeSingle()
  const workspaceId = profile?.workspace_id ? String(profile.workspace_id) : null

  const cacheKey = `${workspaceId ?? '-'}:${type}:${foldAccents(locality)}:${q}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.payload)

  // 1) Valores reales de la empresa (RLS por workspace).
  const wsValues: string[] = []
  if (workspaceId) {
    let query = supabase.from('properties').select('city, area').eq('workspace_id', workspaceId).limit(2000)
    if (type === 'area' && locality) query = query.ilike('city', locality)
    const { data: rows } = await query
    const seen = new Set<string>()
    for (const r of (rows ?? []) as Array<{ city: string | null; area: string | null }>) {
      const v = normalizeLocationText((type === 'locality' ? r.city : r.area) ?? '')
      if (v && !seen.has(foldAccents(v))) { seen.add(foldAccents(v)); wsValues.push(v) }
    }
  }

  type Scored = Item & { score: number }
  const scored: Scored[] = []
  for (const v of wsValues) {
    const s = rank(foldAccents(v), q)
    if (s < 99) scored.push({ id: `ws:${v}`, label: v, kind: type === 'locality' ? 'municipality' : 'neighborhood', source: 'workspace', score: s })
  }

  // 2) Proveedor externo (si está configurado y q tiene ≥2 chars). Fallo → se ignora (fallback).
  const provider = getLocationProvider()
  let providerActive = false
  if (provider && rawQ.length >= 2) {
    providerActive = true
    try {
      const results = await provider.search(rawQ, { country, type, locality: locality || undefined })
      for (const r of results) {
        const s = rank(foldAccents(r.label), q)
        scored.push({ id: `pv:${r.providerPlaceId ?? r.label}`, label: r.label, secondary: r.secondary, province: r.province, kind: r.kind, source: 'provider', score: s + 0.25 })
      }
    } catch { /* fallback silencioso a empresa + local */ }
  }

  // 3) Catálogo local.
  if (type === 'locality') {
    for (const c of searchCities(rawQ, MAX)) {
      scored.push({ id: `lo:${c.value}`, label: c.value, secondary: c.hint, province: c.hint, kind: 'municipality', source: 'local', score: rank(foldAccents(c.value), q) + 0.5 })
    }
  } else {
    for (const a of searchAreas(locality, rawQ, MAX)) {
      scored.push({ id: `lo:${a}`, label: a, kind: 'neighborhood', source: 'local', score: rank(foldAccents(a), q) + 0.5 })
    }
  }

  // Dedup por etiqueta (gana la fuente de mayor prioridad = menor score) y top MAX.
  const sorted = scored.filter((s) => s.score < 99).sort((a, b) => a.score - b.score || a.label.localeCompare(b.label, 'es'))
  const seen = new Set<string>()
  const items: Item[] = []
  for (const s of sorted) {
    const k = foldAccents(s.label)
    if (seen.has(k)) continue
    seen.add(k)
    const { score: _score, ...item } = s
    void _score
    items.push(item)
    if (items.length >= MAX) break
  }

  const payload = { items, capped: sorted.length > items.length, providerActive }
  cache.set(cacheKey, { at: Date.now(), payload })
  if (cache.size > 2000) cache.clear()
  return NextResponse.json(payload)
}
