'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, KeyRound, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'
import { getSupabaseBrowserClient } from '@/lib/supabase'

function getPasswordStrength(password: string) {
  let score = 0
  if (password.length >= 8) score += 1
  if (/[A-Z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [checking, setChecking] = useState(true)

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password])

  useEffect(() => {
    const prepareSession = async () => {
      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        setChecking(false)
        return
      }

      const searchParams = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const getParam = (key: string) => searchParams.get(key) || hashParams.get(key)
      const errorDescription = getParam('error_description') || getParam('error')
      if (errorDescription) {
        setSessionReady(false)
        setChecking(false)
        return
      }

      const code = getParam('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setSessionReady(false)
          setChecking(false)
          return
        }
      }

      const { data, error } = await supabase.auth.getSession()
      if (error) {
        setSessionReady(false)
        setChecking(false)
        return
      }
      setSessionReady(Boolean(data.session))
      setChecking(false)
    }

    void prepareSession()
  }, [])

  const handleUpdatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password.length < 8) {
      toast.error('Password demasiado corta', { description: 'Usa al menos 8 caracteres.' })
      return
    }
    if (password !== confirmPassword) {
      toast.error('Los passwords no coinciden')
      return
    }

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      toast.error('Faltan variables de Supabase')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      toast.error('No se pudo actualizar', { description: error.message })
      return
    }

    toast.success('Contraseña actualizada', { description: 'Ya puedes acceder al CRM con la nueva contraseña.' })
    router.replace('/login?status=password-updated')
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden bg-[#050713] px-5 py-10 text-white">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 35% 12%, rgba(99, 102, 241, 0.34), transparent 42%), radial-gradient(ellipse at 78% 30%, rgba(14, 165, 233, 0.14), transparent 36%), linear-gradient(135deg, #050713 0%, #0b1022 52%, #050713 100%)',
        }}
      />
      <section className="relative w-full max-w-md overflow-hidden rounded-[1.6rem] border border-white/12 bg-white shadow-2xl shadow-black/45">
        <div className="bg-[#090d1b] px-7 py-6 text-white">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-3 py-1 text-[11px] font-semibold text-indigo-100">
              <Sparkles className="h-3.5 w-3.5" />
              Costa del Sol CRM
            </div>
            <ShieldCheck className="h-4 w-4 text-emerald-200" />
          </div>
          <h1 className="text-3xl font-bold leading-tight">Nuevo password</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">Define un acceso seguro para volver a tu workspace.</p>
        </div>

        <div className="p-7 text-gray-900">
          {checking ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verificando enlace seguro...
            </div>
          ) : !sessionReady ? (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">Enlace no activo</p>
              <p className="mt-1 text-xs leading-5 text-amber-700">Solicita un nuevo enlace desde la pantalla de login. Si acabas de abrir el email, comprueba que la URL permitida en Supabase apunta a esta ruta.</p>
              <Button className="mt-4 w-full" size="sm" onClick={() => router.replace('/login')}>Volver al login</Button>
            </div>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-600">Nuevo password</span>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-3 text-sm outline-none transition-all focus:border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500"
                    placeholder="Minimo 8 caracteres"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-600">Confirmar password</span>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-3 text-sm outline-none transition-all focus:border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500"
                    placeholder="Repite el password"
                  />
                </div>
              </label>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-gray-500">Fuerza de password</span>
                  <span className={cn('font-semibold', passwordStrength >= 3 ? 'text-emerald-600' : passwordStrength >= 2 ? 'text-amber-600' : 'text-gray-400')}>
                    {passwordStrength >= 3 ? 'Solida' : passwordStrength >= 2 ? 'Media' : 'Basica'}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {[1, 2, 3, 4].map((step) => (
                    <span key={step} className={cn('h-1.5 rounded-full', passwordStrength >= step ? 'bg-gradient-to-r from-indigo-500 to-violet-600' : 'bg-gray-200')} />
                  ))}
                </div>
              </div>

              <Button className="h-11 w-full gap-2" loading={loading}>
                Actualizar password
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          )}
        </div>
      </section>
    </main>
  )
}
