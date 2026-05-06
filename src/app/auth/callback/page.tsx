'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [message, setMessage] = useState('Confirmando sesion segura...')

  useEffect(() => {
    const completeAuth = async () => {
      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        setMessage('Supabase no esta configurado en este entorno.')
        setTimeout(() => router.replace('/login'), 1400)
        return
      }

      const params = new URLSearchParams(window.location.search)
      const errorDescription = params.get('error_description') || params.get('error')
      if (errorDescription) {
        setMessage('No se ha podido confirmar el enlace.')
        setTimeout(() => router.replace('/login'), 1600)
        return
      }

      const code = params.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setMessage('No se ha podido confirmar el enlace.')
          setTimeout(() => router.replace('/login'), 1600)
          return
        }
      }

      const { data, error } = await supabase.auth.getSession()
      if (error) {
        setMessage('No se ha podido recuperar la sesion.')
        setTimeout(() => router.replace('/login'), 1600)
        return
      }

      if (data.session) {
        setMessage('Sesion confirmada. Entrando en NowCRM...')
        setTimeout(() => router.replace('/dashboard'), 900)
        return
      }

      setMessage('Email confirmado. Ya puedes iniciar sesion.')
      setTimeout(() => router.replace('/login'), 900)
    }

    void completeAuth()
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050713] px-6 text-white">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.08] p-6 text-center shadow-2xl shadow-black/40 backdrop-blur-2xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-indigo-700">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-bold">Auth NowCRM</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">{message}</p>
        <Loader2 className="mx-auto mt-5 h-5 w-5 animate-spin text-indigo-200" />
      </div>
    </main>
  )
}
