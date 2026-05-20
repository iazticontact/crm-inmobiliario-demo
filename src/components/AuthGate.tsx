'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { featureFlags } from '@/lib/feature-flags'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let mounted = true

    // Demo mode via localStorage is a dev-only escape hatch. In a real client
    // deployment it must never grant access on its own — only a real Supabase
    // session does. The flag has to be set explicitly at build time.
    const DEMO_FALLBACK_ALLOWED = featureFlags.demoData
    // FORCE_OFFLINE_DEV is a developer-only bypass. Hard-gated to non-production
    // builds so a misconfigured NEXT_PUBLIC_FORCE_OFFLINE_DEV=true in a real
    // client deployment can never grant access on its own.
    const OFFLINE_FORCE_DEV =
      process.env.NODE_ENV !== 'production' &&
      process.env.NEXT_PUBLIC_FORCE_OFFLINE_DEV === 'true'

    const checkAccess = async () => {
      if (OFFLINE_FORCE_DEV && mounted) {
        setAllowed(true)
        return
      }

      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        if (DEMO_FALLBACK_ALLOWED && window.localStorage.getItem(DEMO_MODE_KEY) === 'true' && mounted) {
          setAllowed(true)
          return
        }
        window.localStorage.removeItem(DEMO_MODE_KEY)
        router.replace('/login')
        return
      }

      const { data, error } = await supabase.auth.getSession()
      if (!mounted) return

      if (data.session && !error) {
        window.localStorage.removeItem(DEMO_MODE_KEY)
        setAllowed(true)
        return
      }

      if (DEMO_FALLBACK_ALLOWED && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
        setAllowed(true)
        return
      }

      window.localStorage.removeItem(DEMO_MODE_KEY)
      router.replace('/login')
    }

    void checkAccess()

    return () => {
      mounted = false
    }
  }, [pathname, router])

  if (!allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070814] text-white">
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm shadow-2xl shadow-black/30">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-200" />
          Verificando acceso...
        </div>
      </div>
    )
  }

  return <>{children}</>
}
