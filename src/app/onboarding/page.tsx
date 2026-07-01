'use client'

// /onboarding — primer arranque de un cliente nuevo. Un usuario autenticado que
// todavía no tiene workspace crea aquí su espacio de trabajo VACÍO (sin demo).
// Esta ruta vive fuera de (saas), así que NO pasa por AuthGate (que es justo
// quien redirige aquí cuando detecta sesión válida sin workspace).

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { BRAND } from '@/lib/brand'

export default function OnboardingPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Verificamos la sesión al entrar: sin sesión → login; si ya tiene workspace
  // → dashboard (evita re-onboarding y bucles si navegan aquí a mano).
  useEffect(() => {
    let mounted = true
    const check = async () => {
      const supabase = getSupabaseBrowserClient()
      if (!supabase) { router.replace('/login'); return }
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      if (!data.session) { router.replace('/login'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('workspace_id, full_name')
        .eq('id', data.session.user.id)
        .maybeSingle()
      if (!mounted) return
      if (profile?.workspace_id) { router.replace('/dashboard'); return }

      setChecking(false)
    }
    void check()
    return () => { mounted = false }
  }, [router])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) {
      toast.error('Pon el nombre de tu inmobiliaria', { description: 'Así personalizamos tu espacio de trabajo.' })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/onboarding/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName }),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error('No se pudo crear tu espacio', {
          description: payload.error ?? 'Inténtalo de nuevo o contacta con el responsable.',
        })
        return
      }
      toast.success('Espacio de trabajo listo', { description: 'Tu CRM está vacío y listo para empezar.' })
      router.replace('/dashboard')
      router.refresh()
    } catch {
      toast.error('No se pudo conectar', { description: 'Revisa tu conexión e inténtalo de nuevo.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f7f7f5] text-gray-900">
        <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
          Preparando tu espacio…
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#f7f7f5] text-gray-900">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(circle at 75% 18%, rgba(15,23,42,0.04), transparent 55%), linear-gradient(180deg, #fafaf7 0%, #f3f3ef 100%)',
        }}
      />
      <main className="relative flex min-h-dvh items-center justify-center px-6 py-12">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-950 text-white">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <p className="text-base font-semibold tracking-tight text-gray-950">{BRAND.appName}</p>
              <p className="text-[11px] uppercase tracking-[0.22em] text-gray-500">Primer arranque</p>
            </div>
          </div>

          <h1 className="text-[2rem] font-semibold leading-[1.1] tracking-tight text-gray-950">
            Crea tu espacio de trabajo
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            Tu CRM empezará vacío y limpio, listo para añadir tus clientes y operaciones reales.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold tracking-wide text-gray-700">Nombre de tu inmobiliaria</span>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ej. Inmobiliaria Costa Norte"
                  autoFocus
                  maxLength={80}
                  className="h-12 w-full rounded-xl border border-gray-200 bg-white pl-11 pr-3.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
            </label>

            <Button
              className={cn(
                'h-12 w-full gap-2 rounded-xl bg-gray-950 text-sm font-semibold text-white shadow-md shadow-gray-950/15 hover:bg-gray-900',
                !name.trim() && 'cursor-not-allowed opacity-60',
              )}
              variant="primary"
              loading={submitting}
              aria-disabled={!name.trim()}
            >
              Crear y empezar
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <ul className="mt-8 space-y-2.5 border-t border-gray-100 pt-6">
            {[
              'Sin datos de ejemplo: empiezas de cero, solo lo tuyo.',
              'Asistente IA incluido desde el primer día.',
              'Tus clientes, operaciones y calendario en un único lugar.',
            ].map((text) => (
              <li key={text} className="flex items-start gap-2.5 text-sm text-gray-600">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                {text}
              </li>
            ))}
          </ul>

          <p className="mt-6 flex items-center gap-1.5 text-[11px] text-gray-400">
            <Sparkles className="h-3.5 w-3.5" />
            Podrás cambiar el nombre y la configuración más adelante.
          </p>
        </div>
      </main>
    </div>
  )
}
