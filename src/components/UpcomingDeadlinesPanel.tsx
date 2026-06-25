'use client'

// "Vencen pronto" — panel lateral del calendario que conecta la agenda con el CRM: lista los
// trámites (service_cases) y tareas (tasks) abiertos con vencimiento próximo (o ya vencidos),
// con enlace a su inmueble o cliente. Self-contained: carga sus datos por workspace (RLS,
// Promise.all, mapeo por id, sin N+1, sin signed URLs). No toca el grid de eventos.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CalendarClock, FileText, ListChecks, AlertTriangle, ArrowRight, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEMO_MODE_KEY } from '@/lib/current-user'
import { listTasks, getClients, updateTask } from '@/lib/supabase-queries'
import { listServiceCases, listProperties, type ServiceCaseRow } from '@/lib/vertical-queries'

type Item = {
  id: string
  rawId: string
  kind: 'task' | 'case'
  title: string
  subtitle: string
  due: string
  href?: string
}

const WINDOW_DAYS = 14
const isOpenTask = (s: string) => !['done', 'completed', 'cancelled', 'archived'].includes(s)
const isOpenCase = (s: string) => !['closed', 'resolved', 'cancelled'].includes(s)

function daysFromToday(due: string, todayStr: string): number {
  const a = new Date(`${todayStr}T00:00:00`).getTime()
  const b = new Date(`${due}T00:00:00`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 999
  return Math.round((b - a) / 86_400_000)
}
function dueLabel(d: number): string {
  if (d < 0) return d === -1 ? 'venció ayer' : `venció hace ${-d} días`
  if (d === 0) return 'vence hoy'
  if (d === 1) return 'vence mañana'
  return `vence en ${d} días`
}

type TaskLike = { id: string; title: string; due_date?: string; status: string; client_id?: string; client_name?: string }

export function UpcomingDeadlinesPanel({ workspaceId, todayStr }: { workspaceId: string | null; todayStr: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [completingId, setCompletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return }
    setLoading(true)
    try {
      const [tasks, cases, clientList, props] = await Promise.all([
        listTasks(workspaceId).catch(() => [] as TaskLike[]),
        listServiceCases(workspaceId).catch(() => [] as ServiceCaseRow[]),
        getClients(workspaceId).catch(() => [] as { id: string; name: string }[]),
        listProperties(workspaceId).catch(() => [] as { id: string; title: string }[]),
      ])
      const clientName = new Map((clientList as { id: string; name: string }[]).map((c) => [c.id, c.name]))
      const propTitle = new Map((props as { id: string; title: string }[]).map((p) => [p.id, p.title]))
      const out: Item[] = []
      for (const t of tasks as TaskLike[]) {
        if (!t.due_date || !isOpenTask(t.status)) continue
        if (daysFromToday(t.due_date, todayStr) > WINDOW_DAYS) continue
        out.push({
          id: `task-${t.id}`, rawId: t.id, kind: 'task', title: t.title || 'Tarea', due: t.due_date,
          subtitle: (t.client_id ? clientName.get(t.client_id) : '') || t.client_name || '',
          href: t.client_id ? `/clients/${t.client_id}` : undefined,
        })
      }
      for (const c of cases as ServiceCaseRow[]) {
        if (!c.due_date || !isOpenCase(c.status)) continue
        if (daysFromToday(c.due_date, todayStr) > WINDOW_DAYS) continue
        const prop = c.property_id ? propTitle.get(c.property_id) : ''
        const cli = c.client_id ? clientName.get(c.client_id) : ''
        out.push({
          id: `case-${c.id}`, rawId: c.id, kind: 'case', title: c.title || 'Trámite', due: c.due_date,
          subtitle: [prop, cli].filter(Boolean).join(' · '),
          href: c.property_id ? `/opportunities/properties/${c.property_id}` : c.client_id ? `/clients/${c.client_id}` : '/opportunities',
        })
      }
      out.sort((a, b) => a.due.localeCompare(b.due))
      setItems(out)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId, todayStr])

  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])

  // Completar una tarea vencida/próxima sin salir del calendario. Optimista: la quitamos de la lista
  // y, si falla, recargamos para restaurar y mostramos la causa real. Solo modo real.
  const handleCompleteTask = async (rawId: string) => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
      toast.info('Modo demo (no se guarda)')
      return
    }
    if (!workspaceId) { toast.error('Sin workspace activo.'); return }
    setCompletingId(rawId)
    const prev = items
    setItems((list) => list.filter((i) => i.rawId !== rawId || i.kind !== 'task'))
    try {
      const updated = await updateTask(workspaceId, rawId, { status: 'done' })
      if (!updated) throw new Error('No se pudo guardar el cambio.')
      toast.success('Tarea completada')
    } catch (error) {
      setItems(prev) // rollback
      toast.error('No se pudo completar la tarea', { description: error instanceof Error ? error.message : '' })
    } finally {
      setCompletingId(null)
    }
  }

  const overdue = useMemo(() => items.filter((i) => daysFromToday(i.due, todayStr) < 0).length, [items, todayStr])
  const shown = items.slice(0, 5)
  const more = items.length - shown.length

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.035]">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">Vencen pronto</h3>
        </div>
        {overdue > 0 && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{overdue} vencido{overdue === 1 ? '' : 's'}</span>}
      </div>
      <div className="p-3">
        {loading ? (
          <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100/70" />)}</div>
        ) : shown.length === 0 ? (
          <p className="px-1 py-3 text-center text-[11px] text-gray-400">Sin vencimientos próximos.</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((it) => {
              const d = daysFromToday(it.due, todayStr)
              const overdueItem = d < 0
              const Icon = it.kind === 'case' ? FileText : ListChecks
              const busy = completingId === it.rawId
              const text = (
                <>
                  <p className="truncate text-xs font-semibold text-gray-900">{it.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px]">
                    <span className={cn('inline-flex items-center gap-0.5 font-medium', overdueItem ? 'text-rose-600' : d <= 1 ? 'text-amber-600' : 'text-gray-500')}>
                      {overdueItem && <AlertTriangle className="h-2.5 w-2.5" />}
                      {dueLabel(d)}
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-400">{it.kind === 'case' ? 'Trámite' : 'Tarea'}</span>
                    {it.subtitle && <><span className="text-gray-300">·</span><span className="max-w-[120px] truncate text-gray-500">{it.subtitle}</span></>}
                  </div>
                </>
              )
              return (
                <li key={it.id} className="group flex items-center gap-2.5 rounded-xl border border-gray-100 bg-white p-2.5 transition-colors hover:border-gray-200 hover:bg-gray-50/60">
                  <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg', it.kind === 'case' ? 'bg-violet-50 text-violet-600' : 'bg-indigo-50 text-indigo-600')}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  {it.href
                    ? <Link href={it.href} className="min-w-0 flex-1">{text}</Link>
                    : <div className="min-w-0 flex-1">{text}</div>}
                  {it.kind === 'task' ? (
                    <button
                      type="button"
                      onClick={() => handleCompleteTask(it.rawId)}
                      disabled={busy}
                      title="Marcar tarea como completada"
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Completar
                    </button>
                  ) : it.href ? (
                    <Link href={it.href} title="Abrir trámite" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 transition-colors hover:bg-gray-50">
                      Ver <ArrowRight className="h-3 w-3" />
                    </Link>
                  ) : null}
                </li>
              )
            })}
            {more > 0 && (
              <li className="px-1 pt-1 text-center text-[10px] font-medium text-gray-400">y {more} {more === 1 ? 'más' : 'más'}</li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
