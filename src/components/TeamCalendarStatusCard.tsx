'use client'

// Estado del equipo · Google Calendar.
//
// Solo client_admin / nowlabs_admin (mirror server-side en
// /api/integrations/google/calendar/team-status). El endpoint nunca expone
// tokens, channel ids, ni token expiry — esta card solo recibe
// { id, email, full_name, role, connected, lastSyncAt }.
//
// Si el endpoint reporta `schemaPending`, mostramos un banner honesto en vez
// de mentir con "conectado".

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock, Loader2, Users } from 'lucide-react'
import { Badge } from '@/components/Badge'
import { SectionCard } from '@/components/SectionCard'
import type { ProfileRole } from '@/lib/current-user'

type TeamConnection = {
  id: string
  email: string | null
  full_name: string | null
  role: string
  connected: boolean
  lastSyncAt: string | null
}

function formatDate(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function TeamCalendarStatusCard({ currentRole }: { currentRole: ProfileRole }) {
  const isWorkspaceAdmin = currentRole === 'client_admin' || currentRole === 'nowlabs_admin'

  const [team, setTeam] = useState<TeamConnection[]>([])
  const [schemaPending, setSchemaPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const loadTeam = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetch('/api/integrations/google/calendar/team-status')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTeam([])
        setLoadError(body?.error || `Error ${res.status}`)
        return
      }
      setTeam(Array.isArray(body?.team) ? body.team : [])
      setSchemaPending(Boolean(body?.schemaPending))
    } catch (err) {
      setTeam([])
      setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el estado del equipo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isWorkspaceAdmin) return
    const timeout = window.setTimeout(() => { void loadTeam() }, 0)
    return () => window.clearTimeout(timeout)
  }, [isWorkspaceAdmin, loadTeam])

  if (!isWorkspaceAdmin) return null

  return (
    <SectionCard
      title="Estado del equipo · Google Calendar"
      description="Quién tiene su calendario conectado. Sin tokens ni datos sensibles."
    >
      {schemaPending && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-[11px] leading-5 text-amber-800">
            Conexión individual por usuario pendiente de configuración técnica. Contacta con NOWLabs.
          </p>
        </div>
      )}

      {loadError && (
        <div className="mb-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-800">{loadError}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando estado del equipo…
        </div>
      ) : team.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 p-5 text-center">
          <Users className="mx-auto mb-2 h-5 w-5 text-gray-400" />
          <p className="text-sm text-gray-500">Aún no hay otros usuarios en el workspace.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {team.map((m) => {
            const lastSync = formatDate(m.lastSyncAt)
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-50 to-sky-50 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
                    {(m.full_name ?? m.email ?? 'U').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{m.full_name || m.email || 'Sin nombre'}</p>
                    <p className="truncate text-[11px] text-gray-500">{m.email ?? ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.connected && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                  <Badge variant={m.connected ? 'success' : 'default'} dot>
                    {m.connected ? 'Conectado' : 'No conectado'}
                  </Badge>
                  {m.connected && lastSync && <span className="hidden text-[10px] text-gray-400 sm:inline">sync · {lastSync}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}
