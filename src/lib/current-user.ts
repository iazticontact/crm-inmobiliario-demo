'use client'

import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { featureFlags } from '@/lib/feature-flags'
import { getResolvedWorkspaceContext, type ProfileRecord, type WorkspaceRecord } from '@/lib/supabase-queries'

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
  name: 'NowCRM Demo',
  email: 'demo@nowcrm.local',
  workspaceName: 'NowCRM Demo',
  initials: 'N',
  isDemo: true,
  isAuthenticated: false,
  isFallback: false,
  trialLabel: 'Modo demo',
  role: 'member',
  hasProfile: false,
}

const offlineCurrentUser: CurrentUser = {
  name: 'NowCRM Local',
  email: 'local@nowcrm.local',
  workspaceName: 'NowCRM Local',
  initials: 'NL',
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

export function useCurrentUser() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const initializeUser = async () => {
      if (OFFLINE_FORCE_DEV) {
        if (mounted) {
          setCurrentUser(offlineCurrentUser)
          setIsLoading(false)
        }
        return
      }

      // Show skeleton on every re-run (including auth-state-change re-runs) so we never
      // flash "NowCRM Demo" while the real profile resolves in the background.
      if (mounted) setIsLoading(true)

      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        if (mounted) setIsLoading(false)
        return
      }

      try {
        const { data, error } = await supabase.auth.getUser()
        if (!mounted) return

        if (error || !data.user) {
          // Only fall back to the demo profile when demo mode is explicitly
          // enabled for this build. In a real client deployment we keep
          // currentUser null so pages don't render mock data as if the user
          // were authenticated.
          if (featureFlags.demoData) {
            setCurrentUser(demoUser)
          } else {
            setCurrentUser(null)
          }
          setIsLoading(false)
          return
        }

        window.localStorage.removeItem(DEMO_MODE_KEY)

        let profile: ProfileRecord | null = null
        let workspace: WorkspaceRecord | null = null
        try {
          const context = await getResolvedWorkspaceContext()
          profile = context?.profile ?? null
          workspace = context?.workspace ?? null
        } catch {
          profile = null
          workspace = null
        }

        const metadata = (data.user.user_metadata ?? {}) as Record<string, unknown>
        const email = data.user.email ?? ''
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

        if (mounted) {
          setCurrentUser({
            id: data.user.id,
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
          })
          setIsLoading(false)
        }
      } catch {
        if (mounted) setIsLoading(false)
      }
    }

    void initializeUser()

    const supabase = getSupabaseBrowserClient()
    if (!supabase) return

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      void initializeUser()
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  // In real-client builds (demoData flag off) we must NOT fall back to demoUser
  // when there is no authenticated session — AuthGate handles the redirect and
  // consumers should treat currentUser as effectively unauthenticated.
  //
  // The fallback object keeps isDemo:true for back-compat with consumers that
  // already branch on isDemo, BUT also exposes isAuthenticated:false and
  // isFallback:true so security-sensitive code paths can distinguish a real
  // session from a placeholder.
  const fallback: CurrentUser = featureFlags.demoData
    ? demoUser
    : { ...demoUser, name: 'Usuario', trialLabel: 'Sin sesion', isFallback: true }
  return { currentUser: currentUser || fallback, isLoading }
}
