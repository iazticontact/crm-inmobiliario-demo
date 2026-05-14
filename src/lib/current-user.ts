'use client'

import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { getResolvedWorkspaceContext, type ProfileRecord, type WorkspaceRecord } from '@/lib/supabase-queries'

export type CurrentUser = {
  name: string
  email: string
  workspaceId?: string
  workspaceName: string
  initials: string
  isDemo: boolean
  trialLabel: string
}

export const DEMO_MODE_KEY = 'nowcrm-demo-mode'
const OFFLINE_FORCE_DEV = process.env.NEXT_PUBLIC_FORCE_OFFLINE_DEV === 'true'

const demoUser: CurrentUser = {
  name: 'NowCRM Demo',
  email: 'demo@nowcrm.local',
  workspaceName: 'NowCRM Demo',
  initials: 'N',
  isDemo: true,
  trialLabel: 'Modo demo',
}

const offlineCurrentUser: CurrentUser = {
  name: 'NowCRM Local',
  email: 'local@nowcrm.local',
  workspaceName: 'NowCRM Local',
  initials: 'NL',
  isDemo: true,
  trialLabel: 'Modo local',
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
          setCurrentUser(demoUser)
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

        if (mounted) {
          setCurrentUser({
            name,
            email,
            workspaceId: workspace?.id || profile?.workspace_id || undefined,
            workspaceName,
            initials: getInitials(name || workspaceName || email),
            isDemo: false,
            trialLabel: String(trialStatus) === 'active' ? 'Trial activo' : 'Cuenta real',
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

  return { currentUser: currentUser || demoUser, isLoading }
}
