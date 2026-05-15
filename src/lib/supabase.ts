import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null = null

function getSupabasePublicKey() {
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  return publishableKey || anonKey
}

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && getSupabasePublicKey())
}

// Uses createBrowserClient from @supabase/ssr so the session is stored in cookies,
// making it readable server-side via createServerClient. The old createClient stored
// sessions only in localStorage — invisible to Route Handlers.
export function getSupabaseBrowserClient() {
  if (!isSupabaseConfigured()) return null
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      getSupabasePublicKey()!,
    )
  }
  return browserClient
}
