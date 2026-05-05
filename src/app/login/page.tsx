'use client'

import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Sparkles, Bot, Zap, Users, CheckCircle, ArrowRight, DollarSign, Star, BarChart2, Shield } from 'lucide-react'
import { Button } from '@/components/Button'

const loginMetrics = [
  { icon: Users, value: '+1.284', label: 'Clientes activos', color: 'text-indigo-300', bg: 'bg-indigo-500/20' },
  { icon: Star, value: '94%', label: 'Satisfacción', color: 'text-emerald-300', bg: 'bg-emerald-500/20' },
  { icon: Bot, value: '89%', label: 'Resuelto por IA', color: 'text-violet-300', bg: 'bg-violet-500/20' },
  { icon: DollarSign, value: '€42.890', label: 'Gestionados', color: 'text-blue-300', bg: 'bg-blue-500/20' },
]

const features = [
  { icon: Bot, title: 'Asistente IA 24/7', desc: 'Responde, cualifica y convierte leads automáticamente sin intervención manual.' },
  { icon: Zap, title: 'Automatizaciones', desc: 'Email marketing, cobros automáticos y secuencias de seguimiento configuradas.' },
  { icon: Users, title: 'CRM Multicanal', desc: 'WhatsApp, Instagram, Web y Email unificados en una sola bandeja.' },
  { icon: BarChart2, title: 'Analítica en tiempo real', desc: 'Dashboard con métricas, insights de IA y alertas accionables.' },
  { icon: DollarSign, title: 'Facturación IA', desc: 'Gestión y cobro automatizado de facturas con recordatorios inteligentes.' },
  { icon: Shield, title: 'Integraciones', desc: 'Conecta con n8n, Stripe, Supabase y cualquier herramienta de tu stack.' },
]

const stats = [
  { value: '1.200+', label: 'Empresas activas' },
  { value: '94%', label: 'Satisfacción' },
  { value: '3×', label: 'Más conversiones' },
  { value: '<2min', label: 'Setup inicial' },
]

export default function LoginPage() {
  const router = useRouter()

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
      {/* LEFT — branding + visuals */}
      <div className="hidden lg:flex lg:w-[58%] shrink-0 flex-col justify-between p-12 xl:p-16">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-3"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 shadow-lg shadow-indigo-600/30">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">NowCRM</span>
          <span className="rounded-full bg-indigo-500/20 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 uppercase tracking-wider">Demo</span>
        </motion.div>

        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="flex-1 flex flex-col justify-center"
        >
          <h2 className="text-4xl xl:text-5xl font-bold leading-tight text-white">
            El CRM con IA que
            <br />
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              cierra más ventas.
            </span>
          </h2>
          <p className="mt-4 text-base text-slate-400 max-w-md leading-relaxed">
            Automatiza tu atención al cliente, gestiona leads y cobra más rápido — todo desde un solo lugar con inteligencia artificial.
          </p>

          {/* Metric cards 2×2 */}
          <div className="mt-8 grid grid-cols-2 gap-3 max-w-sm">
            {loginMetrics.map(({ icon: Icon, value, label, color, bg }) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3 }}
                className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4"
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg} mb-2`}>
                  <Icon className={`h-3.5 w-3.5 ${color}`} />
                </div>
                <p className="text-lg font-bold text-white">{value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{label}</p>
              </motion.div>
            ))}
          </div>

          {/* Feature grid */}
          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 max-w-lg">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">{title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="flex items-center gap-8 border-t border-white/10 pt-6"
        >
          {stats.map(({ value, label }) => (
            <div key={label}>
              <p className="text-xl font-bold text-white">{value}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{label}</p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* RIGHT — login card */}
      <div className="flex flex-1 items-center justify-center p-6 lg:border-l lg:border-white/5">
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[420px]"
        >
          {/* Mobile logo */}
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600">
              <Sparkles className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="text-lg font-bold text-white">NowCRM</span>
          </div>

          <div className="rounded-2xl bg-white shadow-2xl shadow-black/50 overflow-hidden">
            {/* Card header */}
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-6">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-indigo-200" />
                <span className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">Demo interactiva</span>
              </div>
              <h1 className="text-xl font-bold text-white">Acceder a NowCRM</h1>
              <p className="mt-1 text-sm text-indigo-200">
                Explora todas las funcionalidades con datos de ejemplo reales.
              </p>
            </div>

            <div className="p-8">
              {/* What's included */}
              <div className="mb-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Qué incluye esta demo</p>
                <ul className="space-y-2">
                  {[
                    { item: 'Dashboard con métricas e insights de IA', hot: false },
                    { item: 'Asistente IA con análisis de conversaciones', hot: true },
                    { item: 'Automatizaciones de email activas y configurables', hot: false },
                    { item: 'Facturación con cobros automáticos por IA', hot: false },
                    { item: 'Calendario de reuniones y eventos', hot: false },
                    { item: 'Configuración n8n, WhatsApp y Supabase', hot: true },
                  ].map(({ item, hot }) => (
                    <li key={item} className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                      <span className="text-xs text-gray-700">{item}</span>
                      {hot && <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 uppercase">Nuevo</span>}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Demo credentials info */}
              <div className="mb-5 rounded-xl bg-gray-50 border border-gray-100 p-3.5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-semibold text-gray-700">Demo activa</span>
                </div>
                <p className="text-[11px] text-gray-500">Cuenta demo preconfigurada · Sin registro · Sin tarjeta de crédito</p>
                <p className="text-[11px] text-indigo-600 font-mono mt-1">demo@nowcrm.io</p>
              </div>

              <Button
                className="w-full h-11 text-sm font-semibold gap-2 shadow-lg shadow-indigo-500/25"
                onClick={() => router.push('/dashboard')}
              >
                Entrar a la demo
                <ArrowRight className="h-4 w-4" />
              </Button>

              <p className="mt-4 text-center text-[11px] text-gray-400">
                ¿Quieres NowCRM para tu negocio?{' '}
                <button
                  onClick={() => window.open('mailto:iazti.contact@gmail.com', '_blank')}
                  className="text-indigo-600 font-medium hover:underline"
                >
                  Contáctanos
                </button>
              </p>
            </div>
          </div>

          <p className="mt-4 text-center text-[11px] text-slate-600">
            NowCRM · Prototipo funcional · v2.0
          </p>
        </motion.div>
      </div>
    </div>
  )
}
