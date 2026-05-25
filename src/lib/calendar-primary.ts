// Google Calendar "primary" alias normalisation.
//
// Google exposes the user's main calendar under TWO different identifiers
// depending on the endpoint and timing of the call:
//
//   1. The literal string `"primary"` — used by the API as an alias whenever
//      no concrete calendar ID is supplied.
//   2. The real id (typically the user's email, e.g. `user@gmail.com`) —
//      returned by `calendarList.list` and `events.list`.
//
// Both refer to the same calendar but if we treat them as distinct anywhere
// in the stack we will:
//   - duplicate `selected_calendar_ids` entries,
//   - sync the same events twice,
//   - duplicate rows in `calendar_events` (different `google_calendar_id` per
//     row defeats the partial unique index),
//   - desync visibility filters (hiding email-id leaves "primary" visible),
//   - render two "Principal" rows in the modal.
//
// These helpers are the single source of truth for alias equivalence. Both the
// 'use client' page and the server-side sync engine import from here, so the
// logic can never drift.

export type CalendarLike = {
  id: string
  primary?: boolean
}

/** Returns the real id (typically email) of the user's primary calendar, or
 *  null when only the literal alias is available. */
export function getPrimaryCalendarRealId(calendars: CalendarLike[]): string | null {
  const real = calendars.find((c) => c.primary === true && c.id !== 'primary')
  return real?.id ?? null
}

/** True when `id` refers to the user's primary calendar — either via the
 *  literal `"primary"` alias or via the calendar's real id. */
export function isPrimaryAlias(id: string | null | undefined, primaryRealId: string | null): boolean {
  if (!id) return false
  if (id === 'primary') return true
  return primaryRealId !== null && id === primaryRealId
}

/** Canonicalises a calendar id. When we know the real primary id we always
 *  prefer it; otherwise we fall back to the `"primary"` alias so the engine
 *  can still call Google. Other calendar ids pass through unchanged. */
export function canonicalCalendarId(id: string, primaryRealId: string | null): string {
  if (isPrimaryAlias(id, primaryRealId)) return primaryRealId ?? 'primary'
  return id
}

/** True when `a` and `b` refer to the same calendar, accounting for the
 *  primary alias. Both null/empty inputs return false (never assume identity
 *  between two unknowns). */
export function areSameCalendarId(
  a: string | null | undefined,
  b: string | null | undefined,
  primaryRealId: string | null,
): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return isPrimaryAlias(a, primaryRealId) && isPrimaryAlias(b, primaryRealId)
}

/** Dedupes a list of calendar ids by canonical equivalence. Preserves order:
 *  the first occurrence wins, subsequent aliases are dropped. */
export function dedupeCalendarIds(ids: readonly string[], primaryRealId: string | null): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (!id) continue
    const canonical = canonicalCalendarId(id, primaryRealId)
    if (seen.has(canonical)) continue
    seen.add(canonical)
    out.push(canonical)
  }
  return out
}

/** Extracts the primary real id from the engine's Google calendarList metadata
 *  map (keys = calendar ids, values = { primary, ... }). */
export function getPrimaryRealIdFromMetadata(
  metadata: Record<string, { primary?: boolean }>,
): string | null {
  for (const [id, item] of Object.entries(metadata)) {
    if (item?.primary === true && id !== 'primary') return id
  }
  return null
}
