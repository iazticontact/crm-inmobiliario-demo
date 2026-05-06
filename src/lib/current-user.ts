'use client'

import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase'

export type CurrentUser = {
  name: string
  email: string
  workspaceName: string
  initials: string
  isDemo: boolean
  trialLabel: string
}

const demoUser: CurrentUser = {
  name: 'NowCRM Demo',
  email: 'demo@nowcrm.local',
  workspaceName: 'NowCRM Demo',
  initials: 'N',
  isDemo: true,
  trialLabel: 'Modo demo',
}

function getInitials(value: string) {
  const cleanValue = value.trim()
  if (!cleanValue) return 'N'

  const parts = cleanValue.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return cleanValue.slice(0, 2).toUpperCase()
}

function getEmailPrefix(email?: string) {
  return email?.split('@')[0] || 'Usuario'
}

export function useCurrentUser() {
  const [currentUser, setCurrentUser] = useState<CurrentUser>(demoUser)

  useEffect(() => {
    let mounted = true
    const supabase = getSupabaseBrowserClient()

    if (!supabase) {
      return
    }

    const loadUser = async () => {
      const { data, error } = await supabase.auth.getUser()
      if (!mounted) return

      if (error || !data.user) {
        setCurrentUser(demoUser)
        return
      }

      const metadata = data.user.user_metadata ?? {}
      const email = data.user.email ?? ''
      const name = String(metadata.full_name || metadata.name || getEmailPrefix(email))
      const workspaceName = String(metadata.workspace_name || metadata.company_name || 'Workspace')

      setCurrentUser({
        name,
        email,
        workspaceName,
        initials: getInitials(name || workspaceName || email),
        isDemo: false,
        trialLabel: String(metadata.trial_status) === 'active' ? 'Trial activo' : 'Cuenta real',
      })
    }

    void loadUser()

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      void loadUser()
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  return { currentUser, loading: false }
}
