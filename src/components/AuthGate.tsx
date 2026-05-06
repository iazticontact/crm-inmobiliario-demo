'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { getSupabaseBrowserClient } from '@/lib/supabase'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let mounted = true

    const checkAccess = async () => {
      const isDemoMode = window.localStorage.getItem(DEMO_MODE_KEY) === 'true'
      if (isDemoMode) {
        if (mounted) setAllowed(true)
        return
      }

      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        router.replace('/login')
        return
      }

      const { data, error } = await supabase.auth.getSession()
      if (!mounted) return

      if (error || !data.session) {
        router.replace('/login')
        return
      }

      setAllowed(true)
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

