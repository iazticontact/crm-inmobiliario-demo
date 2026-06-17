'use client'

import { useEffect, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { featureFlags } from '@/lib/feature-flags'
import { getResolvedWorkspaceContext, clearWorkspaceIdentityCache, type ResolvedWorkspaceContext } from '@/lib/supabase-queries'
import { BRAND } from '@/lib/brand'

export type ProfileRole = 'nowlabs_admin' | 'client_admin' | 'member'

export type CurrentUser = {
  /** Supabase auth.user.id when there is a real session, undefined otherwise. */
  id?: string
  name: string
  email: string
  workspaceId?: string
  workspaceName: string
  initials: string
  isDemo: boolean
  // True only when there is a real Supabase session backing this user.
  // Consumers that must distinguish "real user" from "fallback placeholder"
  // (Settings, Dashboard, Sidebar, Assistant) should branch on this — never
  // assume isDemo===false means "authenticated".
  isAuthenticated: boolean
  // True when the returned object is a UI placeholder (no real session and no
  // demoData flag): name/email/etc are filler so the UI doesn't crash, but
  // they MUST NOT be persisted or shown as if they were the logged-in user.
  isFallback: boolean
  trialLabel: string
  // The role from public.profiles. Defaults to 'member' if no profile exists.
  // UI gating uses this — but the real enforcement happens server-side in
  // /api/team/users routes. NEVER trust this field for security decisions.
  role: ProfileRole
  // True when the authenticated user has NO row in public.profiles. AuthGate
  // uses this to route to /login?error=no_profile so we don't render the app
  // chrome for someone who has no workspace assignment.
  hasProfile: boolean
}

export const DEMO_MODE_KEY = 'nowcrm-demo-mode'
// FORCE_OFFLINE_DEV is a developer-only escape hatch. Hard-gated to non-prod
// builds so a misconfigured NEXT_PUBLIC_FORCE_OFFLINE_DEV=true in a real
// client deployment never grants a synthetic session.
const OFFLINE_FORCE_DEV =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_FORCE_OFFLINE_DEV === 'true'

const demoUser: CurrentUser = {
  name: BRAND.workspaceName,
  email: 'demo@crm-demo.local',
  workspaceName: BRAND.workspaceName,
  initials: 'DI',
  isDemo: true,
  isAuthenticated: false,
  isFallback: false,
  trialLabel: 'Modo demo',
  role: 'member',
  hasProfile: false,
}

const offlineCurrentUser: CurrentUser = {
  name: BRAND.workspaceName,
  email: 'local@crm-demo.local',
  workspaceName: BRAND.workspaceName,
  initials: 'DI',
  isDemo: true,
  isAuthenticated: false,
  isFallback: false,
  trialLabel: 'Modo local',
  role: 'member',
  hasProfile: false,
}

function getInitials(value: string) {
  const cleanValue = value.trim()
  if (!cleanValue) return 'N'

  const parts = cleanValue.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return cleanValue.slice(0, 2).toUpperCase()
}

function cleanDisplayName(value?: string | null) {
  if (!value?.trim()) return ''
  const withoutDomain = value.includes('@') ? value.split('@')[0] : value
  const readable = withoutDomain
    .replace(/[._-]+/g, ' ')
    .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2')
    .replace(/\d+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!readable) return ''
  return readable
    .split(' ')
    .map((part) => part.charAt(0).toLocaleUpperCase('es-ES') + part.slice(1))
    .join(' ')
}

function getMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key]
  return typeof value === 'string' ? value : ''
}

// Map a resolved workspace context (real session) into the display-ready
// CurrentUser shape. Pure — no I/O — so the provider and useCurrentUser share
// exactly one mapping. Caller must pass a context with a non-null user.
export function buildCurrentUser(context: ResolvedWorkspaceContext): CurrentUser {
  const user = context.user
  if (!user) return getFallbackCurrentUser()
  const profile = context.profile
  const workspace = context.workspace
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
  const email = user.email ?? ''
  const name = cleanDisplayName(
    profile?.full_name ||
    getMetadataString(metadata, 'full_name') ||
    getMetadataString(metadata, 'name') ||
    getMetadataString(metadata, 'display_name') ||
    email
  ) || 'Usuario'
  const workspaceName = String(
    workspace?.name ||
    getMetadataString(metadata, 'workspace_name') ||
    getMetadataString(metadata, 'company_name') ||
    'Workspace'
  )
  const trialStatus = workspace?.trial_status || profile?.trial_status || getMetadataString(metadata, 'trial_status')
  const role: ProfileRole =
    profile?.role === 'nowlabs_admin' || profile?.role === 'client_admin' || profile?.role === 'member'
      ? profile.role
      : 'member'

  return {
    id: user.id,
    name,
    email,
    workspaceId: workspace?.id || profile?.workspace_id || undefined,
    workspaceName,
    initials: getInitials(name || workspaceName || email),
    isDemo: false,
    isAuthenticated: true,
    isFallback: false,
    trialLabel: String(trialStatus) === 'active' ? 'Trial activo' : 'Cuenta real',
    role,
    hasProfile: Boolean(profile),
  }
}

// The placeholder returned when there is no authenticated session and demo data
// is not enabled for this build. Keeps isDemo:true for back-compat but exposes
// isAuthenticated:false / isFallback:true so security-sensitive paths can tell a
// real session from a placeholder.
export function getFallbackCurrentUser(): CurrentUser {
  return featureFlags.demoData
    ? demoUser
    : { ...demoUser, name: 'Usuario', trialLabel: 'Sin sesion', isFallback: true }
}

// Single source of identity resolution for the UI. Resolves the display user
// AND the raw workspace context in ONE shared (cached) round-trip. Used by both
// useCurrentUser and WorkspaceIdentityProvider so identity is resolved once per
// session instead of re-fetched from every component on every navigation.
export async function loadIdentity(): Promise<{ currentUser: CurrentUser | null; context: ResolvedWorkspaceContext | null }> {
  if (OFFLINE_FORCE_DEV) {
    return { currentUser: offlineCurrentUser, context: null }
  }
  // Explicit demo mode (botón "Ver demo" en /login) takes priority over Supabase.
  if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
    return { currentUser: demoUser, context: null }
  }
  const supabase = getSupabaseBrowserClient()
  if (!supabase) {
    return { currentUser: null, context: null }
  }

  let context: ResolvedWorkspaceContext | null = null
  try {
    context = await getResolvedWorkspaceContext()
  } catch {
    context = null
  }

  if (!context || !context.user) {
    // Only fall back to the demo profile when demo mode is enabled for this
    // build. In a real client deployment keep currentUser null so pages never
    // render mock data as if the user were authenticated.
    return { currentUser: featureFlags.demoData ? demoUser : null, context }
  }

  if (typeof window !== 'undefined') window.localStorage.removeItem(DEMO_MODE_KEY)
  return { currentUser: buildCurrentUser(context), context }
}

export function useCurrentUser() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const resolvedUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    let mounted = true

    const run = async () => {
      // Show skeleton on every re-run (including auth-state-change re-runs) so we
      // never flash the demo workspace name while the real profile resolves.
      if (mounted) setIsLoading(true)
      try {
        const { currentUser: resolved, context } = await loadIdentity()
        if (mounted) {
          resolvedUserIdRef.current = context?.user?.id ?? null
          setCurrentUser(resolved)
        }
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    void run()

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      return () => {
        mounted = false
      }
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id ?? null
      // Only re-resolve on a real identity change (sign-out or different user).
      // TOKEN_REFRESHED / repeated SIGNED_IN for the SAME user (fired on tab
      // refocus) are ignored — re-resolving there caused the return-to-tab lag.
      if (event === 'SIGNED_OUT' || nextUserId !== resolvedUserIdRef.current) {
        clearWorkspaceIdentityCache()
        void run()
      }
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  return { currentUser: currentUser || getFallbackCurrentUser(), isLoading }
}
