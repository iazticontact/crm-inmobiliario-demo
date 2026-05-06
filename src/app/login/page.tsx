'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BarChart2,
  Bot,
  CheckCircle,
  CreditCard,
  DollarSign,
  Building2,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Shield,
  Sparkles,
  Star,
  User,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase'
import { DEMO_MODE_KEY } from '@/lib/current-user'

type AuthMode = 'signin' | 'signup' | 'forgot'
type AuthFieldErrors = Partial<Record<'name' | 'companyName' | 'email' | 'password', string>>

const loginMetrics = [
  { icon: Users, value: '+1.284', label: 'Clientes activos', detail: '+12,5% este mes', tone: 'from-indigo-400 to-sky-300' },
  { icon: Star, value: '94%', label: 'Satisfaccion', detail: 'soporte e IA', tone: 'from-emerald-300 to-teal-200' },
  { icon: Bot, value: '89%', label: 'Resuelto por IA', detail: 'sin intervencion', tone: 'from-violet-300 to-fuchsia-200' },
  { icon: DollarSign, value: '42.890 EUR', label: 'Gestionados', detail: 'facturacion demo', tone: 'from-blue-300 to-indigo-200' },
]

const proofPoints = ['Pipeline unificado', 'IA accionable', 'Cobros y agenda', 'Integraciones listas']

const productRows = [
  { name: 'Ana Rodriguez', stage: 'Demo Enterprise', score: '92', value: '12.400 EUR', color: 'bg-emerald-400' },
  { name: 'Carlos Mendez', stage: 'Pricing enviado', score: '74', value: '3.200 EUR', color: 'bg-amber-400' },
  { name: 'Laura Garcia', stage: 'Cliente activo', score: '88', value: '8.900 EUR', color: 'bg-sky-400' },
]

const cockpitMetrics = [
  { label: 'Leads hoy', value: '160', icon: Users, tone: 'bg-indigo-500/15 text-indigo-100 ring-indigo-300/15' },
  { label: 'IA resueltos', value: '47', icon: Bot, tone: 'bg-violet-500/15 text-violet-100 ring-violet-300/15' },
  { label: 'Cobrado', value: '8.234', icon: CreditCard, tone: 'bg-emerald-500/15 text-emerald-100 ring-emerald-300/15' },
]

const authBenefits = [
  'Auth real con Supabase preparado',
  'Modo demo sin tarjeta ni registro',
  'Workspace listo para migrar datos mock',
]

const loginTransitionSteps = [
  'Validando sesión segura...',
  'Cargando clientes y datos del workspace...',
  'Activando panel comercial...',
]

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function getPasswordStrength(password: string) {
  let score = 0
  if (password.length >= 8) score += 1
  if (/[A-Z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

function hasRequiredPasswordShape(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password)
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validateAuthFields(mode: AuthMode, values: { name: string; companyName: string; email: string; password: string }) {
  const errors: AuthFieldErrors = {}
  const cleanEmail = values.email.trim()

  if (mode === 'signup' && !values.name.trim()) errors.name = 'El nombre es obligatorio.'
  if (mode === 'signup' && !values.companyName.trim()) errors.companyName = 'La empresa o workspace es obligatorio.'
  if (!cleanEmail) errors.email = 'El email es obligatorio.'
  else if (!isValidEmail(cleanEmail)) errors.email = 'Introduce un email valido.'

  if (mode !== 'forgot') {
    if (!values.password) errors.password = 'La contraseña es obligatoria.'
    else if (values.password.length < 8) errors.password = 'Usa al menos 8 caracteres.'
    else if (!hasRequiredPasswordShape(values.password)) errors.password = 'Debe incluir mayuscula, minuscula y numero.'
  }

  return errors
}

function getAuthErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'No se ha podido completar la accion.'

  const message = error.message.toLowerCase()
  if (message.includes('invalid login credentials')) return 'Email o contraseña incorrectos'
  if (message.includes('email not confirmed')) return 'Confirma tu email antes de entrar'
  if (message.includes('user already registered') || message.includes('already registered')) return 'Esta cuenta ya existe. Inicia sesion o recupera tu contraseña.'
  if (message.includes('invalid path specified')) return 'La URL de confirmacion no es valida. Revisa las URLs permitidas en Supabase.'
  if (message.includes('signup is disabled')) return 'El registro con email esta desactivado en Supabase.'
  if (message.includes('password')) return 'Revisa la contraseña y vuelve a intentarlo'

  return error.message
}

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>('signin')
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [authTransition, setAuthTransition] = useState(false)
  const [transitionStep, setTransitionStep] = useState(0)
  const [formSubmitted, setFormSubmitted] = useState(false)

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password])
  const formErrors = useMemo(() => validateAuthFields(mode, { name, companyName, email, password }), [companyName, email, mode, name, password])
  const formCanSubmit = Object.keys(formErrors).length === 0
  const showErrors = formSubmitted || mode === 'signup'
  const supabaseReady = isSupabaseConfigured()
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
      await wait(index === 0 ? 420 : 520)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    const status = params.get('status')

    if (error === 'callback') {
      toast.error('Auth no completado', { description: 'No se ha podido confirmar el enlace. Solicita uno nuevo o inicia sesion.' })
      window.history.replaceState(null, '', '/login')
    }

    if (status === 'password-updated') {
      toast.success('Contraseña actualizada', { description: 'Ya puedes iniciar sesion con tu nueva contraseña.' })
      window.history.replaceState(null, '', '/login')
    }
  }, [])

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanEmail = email.trim()
    const cleanName = name.trim()
    const cleanCompanyName = companyName.trim()

    setFormSubmitted(true)
    const validationErrors = validateAuthFields(mode, { name, companyName, email, password })
    if (Object.keys(validationErrors).length > 0) {
      toast.error('Revisa los campos', { description: 'Faltan datos obligatorios o hay algun formato incorrecto.' })
      return
    }

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      toast.error('Faltan variables de Supabase', { description: 'Revisa las variables publicas del entorno antes de usar auth real.' })
      return
    }

    setLoading(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
        if (error) throw error
        window.localStorage.removeItem(DEMO_MODE_KEY)
        toast.success('Sesión iniciada', { description: 'Preparando tu workspace NowCRM.' })
        await runLoginTransition()
        router.replace('/dashboard')
        router.refresh()
        return
      }

      if (mode === 'signup') {
        const origin = window.location.origin
        const { error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: `${origin}/auth/callback`,
            data: {
              full_name: cleanName,
              workspace_name: cleanCompanyName,
              company_name: cleanCompanyName,
              trial_status: 'active',
              onboarding_completed: false,
            },
          },
        })
        if (error) throw error
        toast.success('Cuenta creada. Confirma tu email antes de entrar', { description: 'Revisa tu email para confirmar la cuenta.' })
        setMode('signin')
        return
      }

      const origin = window.location.origin
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${origin}/reset-password`,
      })
      if (error) throw error
      toast.success('Email enviado', { description: 'Te hemos enviado el enlace para restablecer tu password.' })
      setMode('signin')
    } catch (error) {
      const message = getAuthErrorMessage(error)
      toast.error('Auth no completado', { description: message })
    } finally {
      setLoading(false)
    }
  }

  const enterDemo = async () => {
    const supabase = getSupabaseBrowserClient()
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) toast.warning('No se pudo cerrar la sesión remota', { description: 'El modo demo se abrirá igualmente.' })
    }
    window.localStorage.setItem(DEMO_MODE_KEY, 'true')
    toast.success('Modo demo activado', { description: 'Entrando con datos mock y perfil preconfigurado.' })
    router.replace('/dashboard')
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#050713] text-white">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 30% 10%, rgba(99, 102, 241, 0.36), transparent 42%), radial-gradient(ellipse at 80% 24%, rgba(14, 165, 233, 0.16), transparent 34%), radial-gradient(ellipse at 48% 100%, rgba(124, 58, 237, 0.18), transparent 46%), linear-gradient(135deg, #050713 0%, #0b1022 48%, #050713 100%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-70"
        style={{
          background:
            'linear-gradient(115deg, rgba(255,255,255,0.08), transparent 20%, rgba(99,102,241,0.05) 52%, transparent 74%), linear-gradient(180deg, rgba(255,255,255,0.04), transparent 18%, rgba(0,0,0,0.24) 100%)',
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-200/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[#050713] to-transparent" />

      {authTransition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#050713]/90 px-5 text-white backdrop-blur-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(99,102,241,0.28),transparent_34%),radial-gradient(circle_at_62%_62%,rgba(14,165,233,0.12),transparent_32%)]" />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/12 bg-white/[0.09] p-6 text-center shadow-2xl shadow-black/45 ring-1 ring-white/[0.04]"
          >
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-indigo-200/70 to-transparent" />
            <motion.div
              animate={{ rotate: [0, 2, -2, 0], scale: [1, 1.04, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.4 }}
              className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-indigo-700 shadow-2xl shadow-indigo-950/30"
            >
              <Sparkles className="h-6 w-6" />
            </motion.div>
            <h2 className="text-xl font-bold">Preparando tu workspace</h2>
            <p className="mt-2 min-h-6 text-sm leading-6 text-slate-300">{activeTransitionText}</p>

            <div className="mt-5 overflow-hidden rounded-full bg-white/10 p-1">
              <motion.div
                className="h-2 rounded-full bg-gradient-to-r from-indigo-300 via-violet-300 to-sky-200 shadow-[0_0_18px_rgba(129,140,248,0.55)]"
                animate={{ width: `${transitionProgress}%` }}
                transition={{ duration: 0.32, ease: 'easeOut' }}
              />
            </div>

            <div className="mt-5 space-y-2 text-left">
              {loginTransitionSteps.map((step, index) => {
                const isDone = index < transitionStep
                const isActive = index === transitionStep
                return (
                  <div key={step} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08] text-indigo-100">
                      {isDone ? <CheckCircle className="h-3.5 w-3.5 text-emerald-200" /> : isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />}
                    </span>
                    <span className={cn('text-xs font-medium', isActive || isDone ? 'text-white' : 'text-slate-500')}>{step}</span>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </div>
      )}

      <main className="relative grid min-h-screen gap-0 lg:grid-cols-[minmax(0,1fr)_440px] xl:grid-cols-[minmax(0,1fr)_468px]">
        <section className="hidden min-h-screen flex-col px-8 py-7 lg:flex xl:px-10">
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-indigo-700 shadow-2xl shadow-indigo-950/30 ring-1 ring-white/60">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold text-white">NowCRM</span>
                  <span className="rounded-full border border-white/12 bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-indigo-100">Demo Pro</span>
                </div>
                <p className="text-xs text-slate-400">CRM con IA para negocios modernos</p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-slate-200 shadow-lg shadow-black/10 backdrop-blur-xl">
              <span className={cn('h-1.5 w-1.5 rounded-full shadow-[0_0_14px_rgba(110,231,183,0.9)]', supabaseReady ? 'bg-emerald-300' : 'bg-amber-300')} />
              {supabaseReady ? 'Supabase preparado' : 'Modo demo disponible'}
            </div>
          </motion.div>

          <div className="grid flex-1 items-center gap-7 py-8 xl:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1fr)] 2xl:gap-10 [@media(max-height:820px)]:py-5">
            <motion.div
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
              className="max-w-2xl"
            >
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-200/20 bg-white/[0.07] px-3.5 py-1.5 text-xs font-semibold text-indigo-100 shadow-xl shadow-black/10 backdrop-blur-xl">
                <Sparkles className="h-3.5 w-3.5 text-indigo-200" />
                NowCRM Intelligence CRM
              </div>

              <h1 className="text-5xl font-bold leading-[1.03] text-white xl:text-[3.35rem] 2xl:text-[4rem]">
                Convierte leads en ventas con una operacion inteligente.
              </h1>

              <p className="mt-4 max-w-xl text-[15px] leading-7 text-slate-300">
                Un CRM con IA para gestionar leads, agenda, facturacion y automatizaciones desde una experiencia comercial lista para presentar.
              </p>

              <div className="mt-4 hidden flex-wrap gap-2 [@media(min-height:820px)]:flex">
                {proofPoints.map((point) => (
                  <span key={point} className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-[11px] font-medium text-slate-300 shadow-lg shadow-black/10 backdrop-blur-xl">
                    {point}
                  </span>
                ))}
              </div>

              <div className="mt-5 grid max-w-xl grid-cols-2 gap-2.5 [@media(max-height:820px)]:hidden">
                {loginMetrics.map(({ icon: Icon, value, label, detail, tone }) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: 0.2 }}
                    className="group rounded-2xl border border-white/10 bg-white/[0.065] p-3.5 shadow-2xl shadow-black/10 backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white/[0.09]"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg ring-1 ring-white/15', tone)}>
                        <Icon className="h-4 w-4 text-white" />
                      </div>
                      <span className="text-[10px] font-medium text-slate-500 group-hover:text-slate-400">{detail}</span>
                    </div>
                    <p className="text-2xl font-bold text-white">{value}</p>
                    <p className="mt-1 text-xs text-slate-400">{label}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.16 }}
              className="relative mx-auto w-full max-w-[560px]"
            >
              <div className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-indigo-500/20 via-sky-500/10 to-transparent opacity-85 blur-2xl" />
              <div className="relative rounded-[1.7rem] border border-white/14 bg-white/[0.09] p-2.5 shadow-2xl shadow-black/45 backdrop-blur-2xl">
                <div className="rounded-[1.25rem] border border-white/10 bg-[#070b18]/92 p-3.5 shadow-inner shadow-white/[0.03]">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">NowCRM cockpit</p>
                      <p className="text-xs text-slate-400">Pipeline, IA y automatizaciones</p>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      Live demo
                    </div>
                  </div>

                  <div className="mb-3 flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.045] p-1">
                    {['Revenue', 'Conversaciones', 'Automations'].map((item, index) => (
                      <span
                        key={item}
                        className={cn(
                          'flex-1 rounded-xl px-3 py-1.5 text-center text-[10px] font-semibold',
                          index === 0 ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                        )}
                      >
                        {item}
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {cockpitMetrics.map(({ label, value, icon: Icon, tone }) => (
                      <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.055] p-3">
                        <div className={cn('mb-3 flex h-8 w-8 items-center justify-center rounded-xl ring-1', tone)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <p className="text-xl font-bold text-white">{value}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">{label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2.5 grid gap-2.5 xl:grid-cols-[1fr_0.8fr]">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3.5">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-200">Leads por canal</p>
                          <p className="text-[10px] text-slate-500">Ultimos 7 dias</p>
                        </div>
                        <BarChart2 className="h-4 w-4 text-slate-500" />
                      </div>
                      <div className="flex h-24 items-end gap-2">
                        {[42, 66, 49, 78, 58, 38, 52, 70].map((height, i) => (
                          <div key={i} className="flex flex-1 items-end overflow-hidden rounded-t-lg bg-white/[0.06]">
                            <div
                              className="w-full rounded-t-lg bg-gradient-to-t from-indigo-500 via-violet-400 to-sky-300 shadow-[0_0_18px_rgba(99,102,241,0.28)]"
                              style={{ height: `${height}%` }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3.5">
                      <p className="text-xs font-semibold text-slate-200">Automatizacion IA</p>
                      <div className="mt-4 space-y-3">
                        {[
                          { label: 'Lead captado', color: 'bg-indigo-300' },
                          { label: 'Score calculado', color: 'bg-sky-300' },
                          { label: 'Secuencia activa', color: 'bg-emerald-300' },
                        ].map((item, index) => (
                          <div key={item.label} className="flex items-center gap-2.5">
                            <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-slate-950', item.color)}>
                              {index + 1}
                            </span>
                            <span className="text-[11px] text-slate-300">{item.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 rounded-2xl border border-white/10 bg-white/[0.045] [@media(max-height:820px)]:hidden">
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                      <p className="text-xs font-semibold text-slate-200">Clientes prioritarios</p>
                      <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] text-slate-400">mock data</span>
                    </div>
                    <div className="divide-y divide-white/10">
                      {productRows.map((row) => (
                        <div key={row.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white">{row.name}</p>
                            <p className="truncate text-[10px] text-slate-500">{row.stage}</p>
                          </div>
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.08]">
                            <div className={cn('h-full rounded-full', row.color)} style={{ width: `${row.score}%` }} />
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-slate-100">{row.score}</p>
                            <p className="text-[9px] text-slate-500">{row.value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="flex min-h-screen w-full items-center justify-center border-white/10 px-5 py-8 lg:border-l lg:bg-white/[0.025] xl:px-6">
          <motion.div
            initial={false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[424px]"
          >
            <div className="mb-6 flex items-center gap-2.5 lg:hidden">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-indigo-700">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <span className="block text-lg font-bold text-white">NowCRM</span>
                <span className="text-xs text-slate-400">CRM con IA y auth real</span>
              </div>
            </div>

            <div className="overflow-hidden rounded-[1.6rem] border border-white/12 bg-white shadow-2xl shadow-black/45">
              <div className="bg-[#090d1b] px-7 py-6 text-white">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-3 py-1 text-[11px] font-semibold text-indigo-100">
                    <Lock className="h-3.5 w-3.5" />
                    Acceso seguro
                  </div>
                  <div className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold', supabaseReady ? 'bg-emerald-400/10 text-emerald-100' : 'bg-amber-400/10 text-amber-100')}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', supabaseReady ? 'bg-emerald-300' : 'bg-amber-300')} />
                    {supabaseReady ? 'Supabase' : 'Demo'}
                  </div>
                </div>
                <h2 className="text-3xl font-bold leading-tight">
                  {mode === 'signin' && 'Iniciar sesion'}
                  {mode === 'signup' && 'Crear cuenta'}
                  {mode === 'forgot' && 'Recuperar password'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {mode === 'signin' && 'Accede con tu cuenta o entra en modo demo para revisar el producto completo.'}
                  {mode === 'signup' && 'Crea tu workspace y confirma tu email desde Supabase antes de entrar.'}
                  {mode === 'forgot' && 'Recibe un enlace seguro para restablecer el acceso a tu workspace.'}
                </p>
              </div>

              <div className="p-6">
                {mode !== 'forgot' && (
                  <div className="mb-5 grid grid-cols-2 rounded-xl border border-gray-200 bg-gray-50 p-1">
                    {[
                      { id: 'signin' as const, label: 'Iniciar sesion' },
                      { id: 'signup' as const, label: 'Crear cuenta' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => resetFormState(item.id)}
                        className={cn(
                          'rounded-lg px-3 py-2 text-xs font-semibold transition-all',
                          mode === item.id ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}

                <form onSubmit={handleAuth} className="space-y-4">
                  {mode === 'signup' && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-gray-600">Nombre</span>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          placeholder="Tu nombre"
                          className={cn('h-11 w-full rounded-xl border bg-gray-50 pl-10 pr-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500', showErrors && formErrors.name ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-200')}
                        />
                      </div>
                      {showErrors && formErrors.name && <span className="mt-1.5 block text-[11px] font-medium text-red-600">{formErrors.name}</span>}
                    </label>
                  )}

                  {mode === 'signup' && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-gray-600">Empresa / workspace</span>
                      <div className="relative">
                        <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                          value={companyName}
                          onChange={(event) => setCompanyName(event.target.value)}
                          placeholder="Nombre de tu empresa"
                          className={cn('h-11 w-full rounded-xl border bg-gray-50 pl-10 pr-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500', showErrors && formErrors.companyName ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-200')}
                        />
                      </div>
                      {showErrors && formErrors.companyName && <span className="mt-1.5 block text-[11px] font-medium text-red-600">{formErrors.companyName}</span>}
                    </label>
                  )}

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-gray-600">Email</span>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="tu@email.com"
                        className={cn('h-11 w-full rounded-xl border bg-gray-50 pl-10 pr-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500', showErrors && formErrors.email ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-200')}
                      />
                    </div>
                    {showErrors && formErrors.email && <span className="mt-1.5 block text-[11px] font-medium text-red-600">{formErrors.email}</span>}
                  </label>

                  {mode !== 'forgot' && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-gray-600">Password</span>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          placeholder="Minimo 8 caracteres"
                          className={cn('h-11 w-full rounded-xl border bg-gray-50 pl-10 pr-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500', showErrors && formErrors.password ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-200')}
                        />
                      </div>
                      {showErrors && formErrors.password && <span className="mt-1.5 block text-[11px] font-medium text-red-600">{formErrors.password}</span>}
                    </label>
                  )}

                  {mode === 'signup' && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-[11px]">
                        <span className="text-gray-500">Fuerza de password</span>
                        <span className={cn('font-semibold', passwordStrength >= 3 ? 'text-emerald-600' : passwordStrength >= 2 ? 'text-amber-600' : 'text-gray-400')}>
                          {passwordStrength >= 3 ? 'Solida' : passwordStrength >= 2 ? 'Media' : 'Basica'}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[1, 2, 3, 4].map((step) => (
                          <span
                            key={step}
                            className={cn(
                              'h-1.5 rounded-full',
                              passwordStrength >= step ? 'bg-gradient-to-r from-indigo-500 to-violet-600' : 'bg-gray-200'
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    className={cn('h-11 w-full gap-2 text-sm font-semibold shadow-lg shadow-indigo-600/20', !formCanSubmit && 'cursor-not-allowed opacity-60')}
                    loading={loading}
                    aria-disabled={!formCanSubmit}
                  >
                    {mode === 'signin' && 'Iniciar sesion'}
                    {mode === 'signup' && 'Crear cuenta'}
                    {mode === 'forgot' && 'Enviar enlace'}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>

                <div className="mt-4 flex items-center justify-between gap-3 text-xs">
                  {mode !== 'forgot' ? (
                    <button type="button" onClick={() => resetFormState('forgot')} className="font-semibold text-indigo-600 transition-colors hover:text-indigo-700">
                      Olvidaste tu password?
                    </button>
                  ) : (
                    <button type="button" onClick={() => resetFormState('signin')} className="font-semibold text-indigo-600 transition-colors hover:text-indigo-700">
                      Volver al login
                    </button>
                  )}
                  <button type="button" onClick={enterDemo} className="font-semibold text-gray-500 transition-colors hover:text-gray-900">
                    Entrar en modo demo
                  </button>
                </div>

                <div className="mt-5 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-sky-50 p-4 [@media(max-height:820px)]:hidden">
                  <div className="mb-2 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-indigo-600" />
                    <span className="text-xs font-semibold text-indigo-950">Producto listo para demo comercial</span>
                  </div>
                  <ul className="space-y-1.5">
                    {authBenefits.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-[11px] leading-5 text-indigo-700">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        </section>
      </main>
    </div>
  )
}
