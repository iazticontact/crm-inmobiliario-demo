'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { BRAND } from '@/lib/brand'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [message, setMessage] = useState('Confirmando sesión segura…')

  useEffect(() => {
    const redirectToLoginError = (nextMessage: string) => {
      setMessage(nextMessage)
      setTimeout(() => router.replace('/login?error=callback'), 900)
    }

    const completeAuth = async () => {
      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        redirectToLoginError('Faltan variables de Supabase.')
        return
      }

      const searchParams = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const getParam = (key: string) => searchParams.get(key) || hashParams.get(key)
      const errorDescription = getParam('error_description') || getParam('error')
      if (errorDescription) {
        redirectToLoginError('No se ha podido confirmar el enlace.')
        return
      }

      const code = getParam('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          redirectToLoginError('No se ha podido crear la sesión de Supabase.')
          return
        }
      }

      const { data, error } = await supabase.auth.getSession()
      if (error) {
        redirectToLoginError('No se ha podido recuperar la sesión.')
        return
      }

      if (data.session) {
        window.localStorage.removeItem(DEMO_MODE_KEY)

        // Supabase añade `type` al callback link según el flujo:
        //   - invite     → primer acceso (usuario sin contraseña)
        //   - recovery   → reset password
        //   - signup/magiclink → entrada normal
        // En invite/recovery enviamos al usuario a /reset-password para que
        // defina (o cambie) su contraseña antes de entrar a la app.
        const flowType = (getParam('type') ?? '').toLowerCase()
        if (flowType === 'invite' || flowType === 'recovery') {
          setMessage(flowType === 'invite' ? 'Define tu contraseña para acceder…' : 'Sesión confirmada. Define tu nueva contraseña…')
          setTimeout(() => router.replace('/reset-password'), 600)
          return
        }

        setMessage('Sesión confirmada. Entrando al CRM…')
        setTimeout(() => router.replace('/dashboard'), 600)
        return
      }

      if (!code) {
        redirectToLoginError('El enlace no incluye código de confirmación.')
        return
      }

      setMessage('Email confirmado. Ya puedes iniciar sesión.')
      setTimeout(() => router.replace('/login'), 900)
    }

    void completeAuth()
  }, [router])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#050713] px-6 text-white">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.08] p-6 text-center shadow-2xl shadow-black/40 backdrop-blur-2xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-indigo-700">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-bold">{BRAND.appName}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">{message}</p>
        <Loader2 className="mx-auto mt-5 h-5 w-5 animate-spin text-indigo-200" />
      </div>
    </main>
  )
}
