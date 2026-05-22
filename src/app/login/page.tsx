'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowRight, Building2, KeyRound, Loader2, Lock, Mail, Shield, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { DEMO_MODE_KEY } from '@/lib/current-user'

type AuthMode = 'signin' | 'forgot'
type AuthFieldErrors = Partial<Record<'email' | 'password', string>>

const loginTransitionSteps = [
  'Verificando credenciales',
  'Preparando el espacio de trabajo',
  'Cargando datos del workspace',
]

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validateAuthFields(mode: AuthMode, values: { email: string; password: string }): AuthFieldErrors {
  const errors: AuthFieldErrors = {}
  const cleanEmail = values.email.trim()

  if (!cleanEmail) errors.email = 'Introduce tu email corporativo.'
  else if (!isValidEmail(cleanEmail)) errors.email = 'El email no tiene un formato válido.'

  if (mode !== 'forgot') {
    if (!values.password) errors.password = 'Introduce tu contraseña.'
    else if (values.password.length < 8) errors.password = 'Usa al menos 8 caracteres.'
  }

  return errors
}

function getAuthErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'No se ha podido completar la acción.'

  const message = error.message.toLowerCase()
  if (message.includes('invalid login credentials')) return 'Email o contraseña incorrectos.'
  if (message.includes('email not confirmed')) return 'Confirma tu email antes de entrar.'
  if (message.includes('invalid path specified')) return 'La URL de confirmación no es válida.'
  if (message.includes('password')) return 'Revisa la contraseña e inténtalo de nuevo.'

  return error.message
}

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [authTransition, setAuthTransition] = useState(false)
  const [transitionStep, setTransitionStep] = useState(0)
  const [formSubmitted, setFormSubmitted] = useState(false)

  const formErrors = useMemo(() => validateAuthFields(mode, { email, password }), [email, mode, password])
  const formCanSubmit = Object.keys(formErrors).length === 0
  const showErrors = formSubmitted
  const activeTransitionText = loginTransitionSteps[transitionStep] ?? loginTransitionSteps[0]
  const transitionProgress = ((transitionStep + 1) / loginTransitionSteps.length) * 100

  const resetFormState = (nextMode: AuthMode) => {
    setMode(nextMode)
    setPassword('')
    setFormSubmitted(false)
  }

  const runLoginTransition = async () => {
    setAuthTransition(true)
    for (let index = 0; index < loginTransitionSteps.length; index += 1) {
      setTransitionStep(index)
      await wait(index === 0 ? 320 : 420)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    const status = params.get('status')

    if (error === 'callback') {
      toast.error('No se pudo completar el acceso', { description: 'Solicita un nuevo enlace o inicia sesión.' })
      window.history.replaceState(null, '', '/login')
    }

    if (error === 'no_profile') {
      toast.error('Tu usuario no está vinculado a un workspace', {
        description: 'Contacta con el responsable interno o con NOWLabs para que te asignen acceso.',
      })
      window.history.replaceState(null, '', '/login')
    }

    if (status === 'password-updated') {
      toast.success('Contraseña actualizada', { description: 'Ya puedes iniciar sesión con la nueva contraseña.' })
      window.history.replaceState(null, '', '/login')
    }
  }, [])

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanEmail = email.trim()

    setFormSubmitted(true)
    const validationErrors = validateAuthFields(mode, { email, password })
    if (Object.keys(validationErrors).length > 0) {
      toast.error('Revisa los campos', { description: 'Hay datos obligatorios pendientes.' })
      return
    }

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      toast.error('Acceso no disponible', { description: 'Contacta con el responsable interno.' })
      return
    }

    setLoading(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
        if (error) throw error
        window.localStorage.removeItem(DEMO_MODE_KEY)
        toast.success('Sesión iniciada')
        await runLoginTransition()
        router.replace('/dashboard')
        router.refresh()
        return
      }

      const origin = window.location.origin
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${origin}/reset-password`,
      })
      if (error) throw error
      toast.success('Email enviado', { description: 'Revisa tu bandeja para restablecer la contraseña.' })
      setMode('signin')
    } catch (error) {
      const message = getAuthErrorMessage(error)
      toast.error('Acceso no completado', { description: message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f7f7f5] text-gray-900">
      {/* Fondo despacho profesional — color crema sutil con un acento gráfico mínimo */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(circle at 75% 18%, rgba(15,23,42,0.04), transparent 55%), linear-gradient(180deg, #fafaf7 0%, #f3f3ef 100%)',
        }}
      />

      {authTransition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/85 px-5 backdrop-blur-xl">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-xl shadow-gray-950/10"
          >
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gray-950 text-white">
              <Lock className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold tracking-tight text-gray-950">Accediendo al CRM</h2>
            <p className="mt-1 min-h-5 text-xs leading-5 text-gray-500">{activeTransitionText}</p>

            <div className="mt-5 overflow-hidden rounded-full bg-gray-100 p-0.5">
              <motion.div
                className="h-1 rounded-full bg-gray-950"
                animate={{ width: `${transitionProgress}%` }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
              />
            </div>

            <div className="mt-5 space-y-1.5 text-left">
              {loginTransitionSteps.map((step, index) => {
                const isDone = index < transitionStep
                const isActive = index === transitionStep
                return (
                  <div key={step} className="flex items-center gap-2.5 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-1.5">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-gray-700 ring-1 ring-gray-200">
                      {isDone ? <CheckCircle className="h-3 w-3 text-emerald-600" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-1 w-1 rounded-full bg-gray-400" />}
                    </span>
                    <span className={cn('text-[11px] font-medium', isActive || isDone ? 'text-gray-900' : 'text-gray-400')}>{step}</span>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </div>
      )}

      <main className="relative grid min-h-screen lg:grid-cols-[1fr_minmax(420px,520px)]">
        {/* Panel izquierdo — despacho serio: sólo marca, claim y firma. Sin tarjetas, sin métricas. */}
        <aside className="relative hidden flex-col justify-between px-12 py-14 lg:flex xl:px-20 xl:py-16">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-950 text-white">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <p className="text-base font-semibold tracking-tight text-gray-950">Costa del Sol Real Homes</p>
              <p className="text-[11px] uppercase tracking-[0.22em] text-gray-500">Acceso privado</p>
            </div>
          </div>

          <div className="relative max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-gray-500">
              CRM interno · uso autorizado
            </p>
            <h1 className="mt-5 text-[2.7rem] font-semibold leading-[1.05] tracking-tight text-gray-950 xl:text-[3.15rem]">
              Gestión interna de clientes, expedientes, visitas y documentación.
            </h1>
          </div>

          <footer className="flex items-center justify-between text-[11px] text-gray-500">
            <span>Tecnología por NOWLabs</span>
            <span>© {new Date().getFullYear()} Costa del Sol Real Homes</span>
          </footer>

          {/* Acento gráfico mínimo en esquina inferior */}
          <div
            className="pointer-events-none absolute bottom-0 right-0 h-64 w-64 opacity-[0.05]"
            aria-hidden
            style={{
              background:
                'radial-gradient(circle at center, rgba(15,23,42,1) 0%, transparent 70%)',
            }}
          />
        </aside>

        {/* Panel derecho — el formulario es el protagonista */}
        <section className="flex min-h-screen w-full items-center justify-center border-l border-gray-200/70 bg-white px-6 py-12 sm:px-12 lg:py-16">
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[420px]"
          >
            {/* Mobile brand */}
            <div className="mb-10 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-950 text-white">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="leading-tight">
                <p className="text-base font-semibold text-gray-950">Costa del Sol Real Homes</p>
                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Acceso privado</p>
              </div>
            </div>

            <h2 className="text-[2rem] font-semibold leading-[1.1] tracking-tight text-gray-950 sm:text-[2.15rem]">
              {mode === 'signin' ? 'Iniciar sesión' : 'Restablecer acceso'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              {mode === 'signin'
                ? 'Introduce tus credenciales para acceder al CRM interno.'
                : 'Te enviaremos un enlace seguro a tu email corporativo.'}
            </p>

            <form onSubmit={handleAuth} className="mt-8 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold tracking-wide text-gray-700">Email</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="nombre@costadelsol.com"
                    autoComplete="email"
                    className={cn(
                      'h-12 w-full rounded-xl border bg-white pl-11 pr-3.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10',
                      showErrors && formErrors.email ? 'border-red-300 ring-1 ring-red-100' : 'border-gray-200',
                    )}
                  />
                </div>
                {showErrors && formErrors.email && (
                  <span className="mt-1.5 block text-[11px] font-medium text-red-600">{formErrors.email}</span>
                )}
              </label>

              {mode !== 'forgot' && (
                <label className="block">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold tracking-wide text-gray-700">Contraseña</span>
                    <button
                      type="button"
                      onClick={() => resetFormState('forgot')}
                      className="text-[11px] font-medium text-gray-600 transition-colors hover:text-gray-900"
                    >
                      ¿La has olvidado?
                    </button>
                  </div>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Introduce tu contraseña"
                      autoComplete="current-password"
                      className={cn(
                        'h-12 w-full rounded-xl border bg-white pl-11 pr-3.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10',
                        showErrors && formErrors.password ? 'border-red-300 ring-1 ring-red-100' : 'border-gray-200',
                      )}
                    />
                  </div>
                  {showErrors && formErrors.password && (
                    <span className="mt-1.5 block text-[11px] font-medium text-red-600">{formErrors.password}</span>
                  )}
                </label>
              )}

              <Button
                className={cn(
                  'h-12 w-full gap-2 rounded-xl bg-gray-950 text-sm font-semibold text-white shadow-md shadow-gray-950/15 hover:bg-gray-900',
                  !formCanSubmit && 'cursor-not-allowed opacity-60',
                )}
                variant="primary"
                loading={loading}
                aria-disabled={!formCanSubmit}
              >
                {mode === 'signin' ? 'Iniciar sesión' : 'Enviar enlace'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            {mode === 'forgot' && (
              <button
                type="button"
                onClick={() => resetFormState('signin')}
                className="mt-5 text-xs font-medium text-gray-600 transition-colors hover:text-gray-900"
              >
                ← Volver al inicio de sesión
              </button>
            )}

            <div className="mt-10 flex items-start gap-2.5 border-t border-gray-100 pt-5">
              <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
              <p className="text-[11px] leading-5 text-gray-500">
                Acceso restringido al equipo autorizado. Si necesitas credenciales, contacta con el responsable interno.
              </p>
            </div>

            <p className="mt-6 text-[11px] text-gray-400 lg:hidden">Tecnología por NOWLabs</p>
          </motion.div>
        </section>
      </main>
    </div>
  )
}
