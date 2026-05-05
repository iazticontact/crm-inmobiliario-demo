'use client'

import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Activity,
  ArrowRight,
  BarChart2,
  Bot,
  Calendar,
  CheckCircle,
  CreditCard,
  DollarSign,
  MessageSquare,
  Settings,
  Shield,
  Sparkles,
  Star,
  Users,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'

const loginMetrics = [
  { icon: Users, value: '+1.284', label: 'Clientes activos', detail: '+12,5% este mes', tone: 'from-indigo-400 to-sky-300' },
  { icon: Star, value: '94%', label: 'Satisfacción', detail: 'soporte e IA', tone: 'from-emerald-300 to-teal-200' },
  { icon: Bot, value: '89%', label: 'Resuelto por IA', detail: 'sin intervención', tone: 'from-violet-300 to-fuchsia-200' },
  { icon: DollarSign, value: '42.890 EUR', label: 'Gestionados', detail: 'facturación demo', tone: 'from-blue-300 to-indigo-200' },
]

const featurePills = [
  { icon: Bot, title: 'IA comercial', desc: 'Cualifica, responde y propone la siguiente acción.' },
  { icon: Zap, title: 'Automatizaciones', desc: 'Secuencias, cobros y webhooks con feedback simulado.' },
  { icon: MessageSquare, title: 'CRM multicanal', desc: 'WhatsApp, Instagram, web y email en una operación limpia.' },
  { icon: Shield, title: 'Stack preparado', desc: 'Listo para Supabase, n8n y canales reales en la siguiente fase.' },
]

const trustSignals = ['Sin registro', 'Sin tarjeta', 'Datos demo', 'Preparado para Supabase']

const productRows = [
  { name: 'Ana Rodríguez', stage: 'Demo Enterprise', score: '92', value: '12.400 EUR', color: 'bg-emerald-400' },
  { name: 'Carlos Méndez', stage: 'Pricing enviado', score: '74', value: '3.200 EUR', color: 'bg-amber-400' },
  { name: 'Laura García', stage: 'Cliente activo', score: '88', value: '8.900 EUR', color: 'bg-sky-400' },
]

const cockpitMetrics = [
  { label: 'Leads hoy', value: '160', icon: Users, tone: 'bg-indigo-500/15 text-indigo-100 ring-indigo-300/15' },
  { label: 'IA resueltos', value: '47', icon: Bot, tone: 'bg-violet-500/15 text-violet-100 ring-violet-300/15' },
  { label: 'Cobrado', value: '8.234', icon: CreditCard, tone: 'bg-emerald-500/15 text-emerald-100 ring-emerald-300/15' },
]

const included = [
  'Dashboard comercial con métricas, actividad e insights de IA',
  'Asistente con conversaciones, quick actions y análisis de intención',
  'Clientes, calendario, facturación y automatizaciones funcionales',
  'Settings claro para Supabase, n8n, WhatsApp Business e integraciones',
]

const systemSignals = [
  { icon: Activity, label: 'IA activa', value: '94% resolución' },
  { icon: Calendar, label: 'Agenda', value: '7 eventos' },
  { icon: Settings, label: 'Integraciones', value: 'modo demo' },
]

export default function LoginPage() {
  const router = useRouter()

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050713] text-white">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 34% 16%, rgba(79, 70, 229, 0.36), transparent 42%), radial-gradient(ellipse at 78% 28%, rgba(14, 165, 233, 0.18), transparent 36%), radial-gradient(ellipse at 52% 100%, rgba(124, 58, 237, 0.16), transparent 44%), linear-gradient(135deg, #050713 0%, #0b1022 48%, #050713 100%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            'linear-gradient(115deg, rgba(255,255,255,0.08), transparent 22%, rgba(99,102,241,0.05) 48%, transparent 72%), linear-gradient(180deg, rgba(255,255,255,0.04), transparent 18%, rgba(0,0,0,0.22) 100%)',
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-200/45 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#050713] to-transparent" />

      <div className="relative flex min-h-screen flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_430px] xl:grid-cols-[minmax(0,1fr)_470px]">
        <section className="hidden min-h-screen flex-col justify-between px-8 py-7 lg:flex xl:px-12">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
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
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.9)]" />
              Entorno demo operativo
            </div>
          </motion.div>

          <div className="grid flex-1 items-center gap-8 py-8 xl:grid-cols-[minmax(390px,0.86fr)_minmax(450px,1fr)] 2xl:gap-12">
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
              className="max-w-2xl"
            >
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-200/20 bg-white/[0.07] px-3.5 py-1.5 text-xs font-semibold text-indigo-100 shadow-xl shadow-black/10 backdrop-blur-xl">
                <Sparkles className="h-3.5 w-3.5 text-indigo-200" />
                Intelligence Suite para ventas, atención y cobros
              </div>

              <h1 className="text-5xl font-bold leading-[1.03] text-white xl:text-[4.15rem]">
                Un CRM con IA que convierte operación en crecimiento.
              </h1>

              <p className="mt-5 max-w-xl text-[15px] leading-7 text-slate-300">
                Centraliza leads, conversaciones, agenda, facturación y automatizaciones en una demo SaaS elegante, funcional y lista para presentar a clientes.
              </p>

              <div className="mt-7 grid max-w-xl grid-cols-2 gap-3">
                {loginMetrics.map(({ icon: Icon, value, label, detail, tone }) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: 0.2 }}
                    className="group rounded-2xl border border-white/10 bg-white/[0.065] p-4 shadow-2xl shadow-black/10 backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white/[0.09]"
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

              <div className="mt-6 grid max-w-2xl grid-cols-2 gap-3">
                {featurePills.map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/25 p-3.5 shadow-lg shadow-black/10 backdrop-blur-xl">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.08] text-indigo-100">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 26, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.16 }}
              className="relative"
            >
              <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-indigo-500/18 via-sky-500/10 to-transparent opacity-80 blur-2xl" />
              <div className="relative rounded-[1.7rem] border border-white/14 bg-white/[0.09] p-3 shadow-2xl shadow-black/45 backdrop-blur-2xl">
                <div className="rounded-[1.25rem] border border-white/10 bg-[#070b18]/92 p-4 shadow-inner shadow-white/[0.03]">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">NowCRM cockpit</p>
                      <p className="text-xs text-slate-400">Pipeline, IA y automatizaciones en tiempo real</p>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      Live demo
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    {cockpitMetrics.map(({ label, value, icon: Icon, tone }) => (
                      <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.055] p-3.5">
                        <div className={cn('mb-3 flex h-8 w-8 items-center justify-center rounded-xl ring-1', tone)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <p className="text-xl font-bold text-white">{value}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">{label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_0.78fr]">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-200">Leads por canal</p>
                          <p className="text-[10px] text-slate-500">Últimos 7 días</p>
                        </div>
                        <BarChart2 className="h-4 w-4 text-slate-500" />
                      </div>
                      <div className="flex h-32 items-end gap-2">
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

                    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                      <p className="text-xs font-semibold text-slate-200">Automatización IA</p>
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
                      <div className="mt-4 rounded-xl border border-indigo-300/10 bg-indigo-400/10 p-3">
                        <p className="text-[10px] text-indigo-100">Siguiente acción</p>
                        <p className="mt-1 text-xs font-semibold text-white">Enviar propuesta y agendar llamada</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.045]">
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <p className="text-xs font-semibold text-slate-200">Clientes prioritarios</p>
                      <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] text-slate-400">mock data</span>
                    </div>
                    <div className="divide-y divide-white/10">
                      {productRows.map((row) => (
                        <div key={row.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3">
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

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {systemSignals.map(({ icon: Icon, label, value }) => (
                      <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                        <div className="flex items-center gap-2 text-slate-300">
                          <Icon className="h-3.5 w-3.5 text-indigo-200" />
                          <span className="text-[10px] font-medium">{label}</span>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45, delay: 0.45 }}
            className="flex items-center justify-between border-t border-white/10 pt-5"
          >
            <div className="flex items-center gap-2 text-xs text-slate-400">
              {trustSignals.map((item) => (
                <span key={item} className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 shadow-lg shadow-black/10 backdrop-blur-xl">
                  {item}
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-500">Prototipo funcional v2.0</p>
          </motion.div>
        </section>

        <section className="flex min-h-screen w-full items-center justify-center border-white/10 p-5 lg:border-l lg:bg-white/[0.025] xl:p-7">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[430px]"
          >
            <div className="mb-6 flex items-center gap-2.5 lg:hidden">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-indigo-700">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <span className="block text-lg font-bold text-white">NowCRM</span>
                <span className="text-xs text-slate-400">Demo SaaS con IA</span>
              </div>
            </div>

            <div className="overflow-hidden rounded-[1.6rem] border border-white/12 bg-white shadow-2xl shadow-black/45">
              <div className="bg-[#090d1b] px-8 py-7 text-white">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-3 py-1 text-[11px] font-semibold text-indigo-100">
                    <Sparkles className="h-3.5 w-3.5" />
                    Demo interactiva
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                    Activa
                  </div>
                </div>
                <h2 className="text-3xl font-bold leading-tight">Acceder a NowCRM</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Recorre una demo completa con clientes, IA, facturas, calendario y automatizaciones preparadas.
                </p>
              </div>

              <div className="p-8">
                <div className="mb-5 grid grid-cols-3 gap-2">
                  {[
                    { value: '7', label: 'pantallas' },
                    { value: '0 EUR', label: 'coste' },
                    { value: '100%', label: 'mock' },
                  ].map(({ value, label }) => (
                    <div key={label} className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-center">
                      <p className="text-lg font-bold text-gray-950">{value}</p>
                      <p className="text-[11px] text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-950/[0.03]">
                  <p className="mb-3 text-xs font-semibold text-gray-500">Incluido en la demo</p>
                  <ul className="space-y-2.5">
                    {included.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" />
                        <span className="text-xs leading-5 text-gray-700">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mb-5 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-sky-50 p-4">
                  <div className="mb-1 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-indigo-600" />
                    <span className="text-xs font-semibold text-indigo-950">Cuenta demo preconfigurada</span>
                  </div>
                  <p className="text-[11px] leading-5 text-indigo-700">Sin registro, sin persistencia real y sin conectar proveedores externos todavía.</p>
                  <p className="mt-2 rounded-xl bg-white px-2.5 py-2 font-mono text-[11px] text-indigo-700 shadow-sm">demo@nowcrm.io</p>
                </div>

                <Button
                  className="h-12 w-full gap-2 text-sm font-semibold shadow-lg shadow-indigo-600/20"
                  onClick={() => router.push('/dashboard')}
                >
                  Entrar a la demo
                  <ArrowRight className="h-4 w-4" />
                </Button>

                <p className="mt-4 text-center text-[11px] leading-5 text-gray-400">
                  Demo lista para evaluar producto. La siguiente fase natural es Supabase.
                </p>
              </div>
            </div>
          </motion.div>
        </section>
      </div>
    </div>
  )
}
