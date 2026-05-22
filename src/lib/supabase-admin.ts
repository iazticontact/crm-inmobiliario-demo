// Server-only Supabase client backed by SUPABASE_SERVICE_ROLE_KEY.
//
// IMPORTANT — this client bypasses RLS. It is OK to use **only inside Next.js
// route handlers / server components** AFTER having authorised the request via
// a normal cookie-bound client (`auth.getUser()` + role check on profiles).
//
// Never import this module from `'use client'` components. The function below
// reads SUPABASE_SERVICE_ROLE_KEY from `process.env`; in client bundles that
// returns `undefined` and the helper returns `null`, so an accidental import
// from the client cannot leak the key — but it also won't work. Keep imports
// strictly in `route.ts` / `route handler` / server-side modules.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Returns a Supabase client with service_role privileges. Returns `null` when
 * SUPABASE_SERVICE_ROLE_KEY (or the Supabase URL) is missing — callers MUST
 * handle that case (typically returning `503`) and never proceed with a
 * partial operation.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
