'use client'

import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BarChart2,
  Bot,
  CheckCircle,
  CreditCard,
  DollarSign,
  Globe,
  Mail,
  MessageSquare,
  Shield,
  Sparkles,
  Star,
  Users,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/Button'

const loginMetrics = [
  { icon: Users, value: '+1.284', label: 'clientes activos', tone: 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/20' },
  { icon: Star, value: '94%', label: 'satisfaccion', tone: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/20' },
  { icon: Bot, value: '89%', label: 'resuelto por IA', tone: 'bg-violet-500/15 text-violet-200 ring-violet-400/20' },
  { icon: DollarSign, value: '42.890 EUR', label: 'gestionados', tone: 'bg-sky-500/15 text-sky-200 ring-sky-400/20' },
]

const featurePills = [
  { icon: Bot, title: 'IA comercial', desc: 'Responde, cualifica y recomienda la siguiente accion.' },
  { icon: Zap, title: 'Automatizaciones', desc: 'Secuencias, cobros y webhooks simulados con feedback real.' },
  { icon: MessageSquare, title: 'CRM multicanal', desc: 'WhatsApp, Instagram, web y email en una vista coherente.' },
  { icon: Shield, title: 'Stack listo', desc: 'Preparado para Supabase, n8n y canales reales en la siguiente fase.' },
]

const trustSignals = ['Sin registro', 'Sin tarjeta', 'Datos demo', 'Stack SaaS real']

const productRows = [
  { name: 'Ana Rodriguez', stage: 'Demo Enterprise', score: '92', color: 'bg-emerald-400' },
  { name: 'Carlos Mendez', stage: 'Pricing enviado', score: '74', color: 'bg-amber-400' },
  { name: 'Laura Garcia', stage: 'Cliente activo', score: '88', color: 'bg-sky-400' },
]

const included = [
  'Dashboard comercial con metricas e insights de IA',
  'Asistente IA con conversaciones, quick actions y analisis',
  'Clientes, calendario, facturacion y automatizaciones completas',
  'Settings preparado para Supabase, n8n y WhatsApp Business',
]

export default function LoginPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] [background-size:56px_56px]" />
      <div className="relative flex min-h-screen flex-col lg:flex-row">
        <section className="hidden min-h-screen flex-1 flex-col justify-between px-10 py-8 lg:flex xl:px-14">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 shadow-lg shadow-indigo-600/25 ring-1 ring-white/10">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold">NowCRM</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-indigo-200">Demo Pro</span>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Entorno demo operativo
            </div>
          </motion.div>

          <div className="grid flex-1 items-center gap-10 xl:grid-cols-[0.9fr_1.1fr]">
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
            >
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-300/20 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-200">
                <Sparkles className="h-3.5 w-3.5" />
                CRM con IA para vender, atender y cobrar mejor
              </div>
              <h1 className="max-w-2xl text-5xl font-bold leading-[1.02] text-white xl:text-6xl">
                Tu operativa comercial, automatizada en una demo lista para vender.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
                NowCRM unifica clientes, conversaciones, agenda, facturacion y automatizaciones en una experiencia SaaS premium con datos mock y comportamiento realista.
              </p>

              <div className="mt-7 grid max-w-xl grid-cols-2 gap-3">
                {loginMetrics.map(({ icon: Icon, value, label, tone }) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: 0.2 }}
                    className="rounded-xl border border-white/10 bg-white/[0.055] p-4 shadow-2xl shadow-black/10 backdrop-blur"
                  >
                    <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ring-1 ${tone}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="text-2xl font-bold text-white">{value}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{label}</p>
                  </motion.div>
                ))}
              </div>

              <div className="mt-7 grid max-w-2xl grid-cols-2 gap-3">
                {featurePills.map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-indigo-200">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{title}</p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-400">{desc}</p>
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
              <div className="rounded-2xl border border-white/12 bg-white/[0.07] p-3 shadow-2xl shadow-black/40 backdrop-blur">
                <div className="rounded-xl border border-white/10 bg-slate-950/80 p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">NowCRM cockpit</p>
                      <p className="text-xs text-slate-400">Pipeline, IA y automatizaciones</p>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Live demo
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Leads hoy', value: '160', icon: Users, tone: 'text-indigo-200 bg-indigo-500/15' },
                      { label: 'IA resueltos', value: '47', icon: Bot, tone: 'text-violet-200 bg-violet-500/15' },
                      { label: 'Cobrado', value: '8.234', icon: CreditCard, tone: 'text-emerald-200 bg-emerald-500/15' },
                    ].map(({ label, value, icon: Icon, tone }) => (
                      <div key={label} className="rounded-xl border border-white/10 bg-white/[0.045] p-3">
                        <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-lg ${tone}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <p className="text-lg font-bold">{value}</p>
                        <p className="text-[10px] text-slate-400">{label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-200">Leads por canal</p>
                      <BarChart2 className="h-4 w-4 text-slate-500" />
                    </div>
                    <div className="flex h-28 items-end gap-2">
                      {[42, 66, 49, 78, 58, 38, 52, 70].map((height, i) => (
                        <div key={i} className="flex flex-1 items-end rounded-t bg-slate-800">
                          <div
                            className="w-full rounded-t bg-gradient-to-t from-indigo-500 to-sky-400"
                            style={{ height: `${height}%` }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04]">
                    <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
                      <p className="text-xs font-semibold text-slate-200">Clientes prioritarios</p>
                      <span className="text-[10px] text-slate-500">mock data</span>
                    </div>
                    <div className="divide-y divide-white/10">
                      {productRows.map((row) => (
                        <div key={row.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white">{row.name}</p>
                            <p className="truncate text-[10px] text-slate-500">{row.stage}</p>
                          </div>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                            <div className={`h-full ${row.color}`} style={{ width: `${row.score}%` }} />
                          </div>
                          <span className="text-xs font-bold text-slate-200">{row.score}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      { icon: MessageSquare, label: 'WhatsApp' },
                      { icon: Mail, label: 'Email IA' },
                      { icon: Globe, label: 'Web' },
                    ].map(({ icon: Icon, label }) => (
                      <div key={label} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-slate-300">
                        <Icon className="h-3.5 w-3.5 text-indigo-200" />
                        {label}
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
                <span key={item} className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1">
                  {item}
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-500">Prototipo funcional v2.0</p>
          </motion.div>
        </section>

        <section className="flex min-h-screen w-full items-center justify-center border-white/10 p-5 lg:w-[430px] lg:border-l xl:w-[470px]">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[430px]"
          >
            <div className="mb-6 flex items-center gap-2.5 lg:hidden">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <span className="block text-lg font-bold text-white">NowCRM</span>
                <span className="text-xs text-slate-400">Demo SaaS con IA</span>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/45">
              <div className="bg-slate-950 px-8 py-7 text-white">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-100">
                    <Sparkles className="h-3.5 w-3.5" />
                    Demo interactiva
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Activa
                  </div>
                </div>
                <h2 className="text-2xl font-bold">Acceder a NowCRM</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Entra directamente a una demo completa con clientes, facturas, IA y automatizaciones ya preparadas.
                </p>
              </div>

              <div className="p-8">
                <div className="mb-5 grid grid-cols-2 gap-2">
                  {[
                    { value: '7', label: 'pantallas clave' },
                    { value: '0 EUR', label: 'para probar' },
                  ].map(({ value, label }) => (
                    <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <p className="text-lg font-bold text-gray-950">{value}</p>
                      <p className="text-[11px] text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
                  <p className="mb-3 text-xs font-semibold text-gray-500">Que incluye</p>
                  <ul className="space-y-2.5">
                    {included.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" />
                        <span className="text-xs leading-5 text-gray-700">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                  <div className="mb-1 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-indigo-600" />
                    <span className="text-xs font-semibold text-indigo-900">Cuenta demo preconfigurada</span>
                  </div>
                  <p className="text-[11px] text-indigo-700">Sin registro, sin persistencia real y sin conectar proveedores externos todavia.</p>
                  <p className="mt-2 rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] text-indigo-700">demo@nowcrm.io</p>
                </div>

                <Button
                  className="h-11 w-full gap-2 text-sm font-semibold"
                  onClick={() => router.push('/dashboard')}
                >
                  Entrar a la demo
                  <ArrowRight className="h-4 w-4" />
                </Button>

                <p className="mt-4 text-center text-[11px] text-gray-400">
                  Demo preparada para evaluar producto y siguiente fase Supabase.
                </p>
              </div>
            </div>
          </motion.div>
        </section>
      </div>
    </div>
  )
}
