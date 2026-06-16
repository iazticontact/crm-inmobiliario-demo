'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import {
  loadIdentity,
  getFallbackCurrentUser,
  type CurrentUser,
  type ProfileRole,
} from '@/lib/current-user'
import { clearWorkspaceIdentityCache, type ResolvedWorkspaceContext } from '@/lib/supabase-queries'

// Single client-side source of truth for session + profile + workspace.
//
// Why this exists (S3): Sidebar and Topbar each used to run their own
// useCurrentUser chain (auth.getUser -> profiles -> workspaces) on every page,
// and each page re-resolved identity again. This provider resolves identity
// ONCE for the authenticated layout — Sidebar/Topbar read it from context with
// zero extra queries — and it sits on top of the cached resolver in
// supabase-queries, so even page-level getWorkspaceContext() calls share the
// same in-memory result. Multi-tenant safety (cache keyed by user.id, cleared
// on auth changes, bypassed server-side) lives in that cached resolver.

type WorkspaceIdentityValue = {
  /** Always non-null (falls back to a placeholder) for easy consumption. */
  currentUser: CurrentUser
  user: ResolvedWorkspaceContext['user']
  profile: ResolvedWorkspaceContext['profile']
  workspace: ResolvedWorkspaceContext['workspace']
  workspaceId: string | null
  role: ProfileRole
  isDemo: boolean
  isAuthenticated: boolean
  isLoading: boolean
  /** Resolution error string (e.g. "Profile has no workspace_id"), if any. */
  error: string | null
  /** Force a fresh resolution (bypasses the session cache). */
  refresh: () => void
}

const WorkspaceIdentityContext = createContext<WorkspaceIdentityValue | null>(null)

type State = {
  currentUser: CurrentUser | null
  context: ResolvedWorkspaceContext | null
  isLoading: boolean
}

export function WorkspaceIdentityProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ currentUser: null, context: null, isLoading: true })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let mounted = true

    const run = async () => {
      if (mounted) setState((s) => ({ ...s, isLoading: true }))
      const { currentUser, context } = await loadIdentity()
      if (!mounted) return
      setState({ currentUser, context, isLoading: false })
    }

    void run()

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      return () => {
        mounted = false
      }
    }

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      // Any auth transition (login/logout/user switch/token refresh) busts the
      // cache BEFORE we re-resolve, so we can never re-read another user's
      // cached context regardless of listener registration order.
      clearWorkspaceIdentityCache()
      void run()
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [reloadKey])

  const value = useMemo<WorkspaceIdentityValue>(() => {
    const currentUser = state.currentUser ?? getFallbackCurrentUser()
    return {
      currentUser,
      user: state.context?.user ?? null,
      profile: state.context?.profile ?? null,
      workspace: state.context?.workspace ?? null,
      workspaceId: state.context?.workspaceId ?? currentUser.workspaceId ?? null,
      role: currentUser.role,
      isDemo: currentUser.isDemo,
      isAuthenticated: currentUser.isAuthenticated,
      isLoading: state.isLoading,
      error: state.context?.error ?? null,
      refresh: () => {
        clearWorkspaceIdentityCache()
        setReloadKey((k) => k + 1)
      },
    }
  }, [state])

  return <WorkspaceIdentityContext.Provider value={value}>{children}</WorkspaceIdentityContext.Provider>
}

/** Read the shared identity. Must be used under a WorkspaceIdentityProvider. */
export function useWorkspaceIdentity() {
  const ctx = useContext(WorkspaceIdentityContext)
  if (!ctx) {
    throw new Error('useWorkspaceIdentity must be used within a WorkspaceIdentityProvider')
  }
  return ctx
}
