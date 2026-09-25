import Link from 'next/link'
import { FileText, Mail, MessageSquare, Phone, Star } from 'lucide-react'
import type { ActivityType } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { WeekDay } from '@/features/dashboard/model'

export const activityIcons: Record<ActivityType, React.ReactNode> = {
  deal: <Star className="h-3.5 w-3.5 text-indigo-600" />,
  message: <MessageSquare className="h-3.5 w-3.5 text-blue-500" />,
  email: <Mail className="h-3.5 w-3.5 text-violet-500" />,
  call: <Phone className="h-3.5 w-3.5 text-emerald-500" />,
  note: <FileText className="h-3.5 w-3.5 text-gray-500" />,
}

export const activityBg: Record<ActivityType, string> = {
  deal: 'bg-indigo-50',
  message: 'bg-blue-50',
  email: 'bg-violet-50',
  call: 'bg-emerald-50',
  note: 'bg-gray-100',
}

type MetricTileProps = {
  label: string
  value: string
  detail?: string
  icon: React.ReactNode
  href?: string
  hint?: string
  tone?: 'indigo' | 'emerald' | 'amber' | 'sky' | 'violet' | 'slate'
}

const TONE_STYLES: Record<NonNullable<MetricTileProps['tone']>, string> = {
  indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  sky: 'bg-sky-50 text-sky-600 ring-sky-100',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100',
  slate: 'bg-gray-50 text-gray-600 ring-gray-100',
}

const TONE_BAR: Record<NonNullable<MetricTileProps['tone']>, string> = {
  indigo: 'from-indigo-400 to-violet-400',
  emerald: 'from-emerald-400 to-teal-400',
  amber: 'from-amber-400 to-orange-400',
  sky: 'from-sky-400 to-indigo-400',
  violet: 'from-violet-400 to-fuchsia-400',
  slate: 'from-gray-300 to-gray-400',
}

export function MetricTile({ label, value, detail, icon, href, hint, tone = 'indigo' }: MetricTileProps) {
  const content = (
    <div
      title={hint}
      className="group relative h-full overflow-hidden rounded-2xl border border-gray-200/70 bg-white px-4 py-3.5 shadow-sm shadow-gray-950/[0.03] transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/[0.05]"
    >
      <span className={cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-80', TONE_BAR[tone])} aria-hidden />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
          <p className="mt-1 text-[1.7rem] font-bold leading-none tracking-tight text-gray-900">{value}</p>
        </div>
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1', TONE_STYLES[tone])}>
          {icon}
        </div>
      </div>
      {detail && <p className="mt-1.5 truncate text-xs text-gray-500">{detail}</p>}
    </div>
  )

  return href ? <Link href={href} className="block">{content}</Link> : content
}

type EcoStatProps = {
  label: string
  value: string
  variation?: number | null
  hint?: string
  tone?: 'emerald' | 'amber' | 'indigo' | 'gray'
}

const ECO_TONES: Record<NonNullable<EcoStatProps['tone']>, string> = {
  emerald: 'border-emerald-100 bg-emerald-50/50',
  amber: 'border-amber-100 bg-amber-50/50',
  indigo: 'border-indigo-100 bg-indigo-50/50',
  gray: 'border-gray-100 bg-gray-50/50',
}

export function EcoStat({ label, value, variation, hint, tone = 'gray' }: EcoStatProps) {
  return (
    <div className={cn('rounded-xl border px-2.5 py-2', ECO_TONES[tone], hint && 'cursor-help')} title={hint}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-gray-900">{value}</p>
      {variation != null && (
        <p className={cn('text-[10px] font-semibold', variation >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
          {variation >= 0 ? '↑' : '↓'} {Math.abs(variation)}% vs anterior
        </p>
      )}
    </div>
  )
}

export function WeekRail({ days }: { days: WeekDay[] }) {
  const nextActiveIndex = days.findIndex((day, index) => index > 0 && day.events + day.tasks > 0)
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map((day, index) => {
        const total = day.events + day.tasks
        const isToday = index === 0
        const isNextActive = index === nextActiveIndex
        return (
          <Link
            key={`${day.label}-${index}`}
            href="/calendar"
            title={day.tooltip}
            aria-label={day.tooltip}
            className={cn(
              'group relative flex flex-col items-center gap-0.5 overflow-hidden rounded-xl border px-0.5 py-1.5 transition-all hover:-translate-y-0.5 hover:shadow-sm',
              isToday
                ? 'border-indigo-200 bg-indigo-50/70'
                : total > 0
                  ? 'border-gray-200 bg-white'
                  : 'border-gray-100 bg-gray-50/40',
            )}
          >
            {total > 0 && !isToday && (
              <span className={cn('absolute inset-x-0 top-0 h-0.5', isNextActive ? 'bg-indigo-400' : 'bg-gray-200')} aria-hidden />
            )}
            <span className={cn('text-[10px] font-semibold', isToday ? 'text-indigo-600' : 'text-gray-400')}>{day.label}</span>
            <span className={cn('text-sm font-bold leading-none tabular-nums', isToday ? 'text-indigo-700' : 'text-gray-900')}>{day.dayNum}</span>
            <div className="flex min-h-[22px] flex-col items-center justify-center gap-0.5" aria-hidden="true">
              {day.events > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-sky-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />{day.events}
                </span>
              )}
              {day.tasks > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{day.tasks}
                </span>
              )}
              {total === 0 && <span className="text-[11px] leading-none text-gray-300">·</span>}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
