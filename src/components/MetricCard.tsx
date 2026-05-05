import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type MetricCardProps = {
  label: string
  value: string
  change: number
  changeLabel: string
  icon: React.ReactNode
  className?: string
}

export function MetricCard({ label, value, change, changeLabel, icon, className }: MetricCardProps) {
  const isPositive = change >= 0
  return (
    <div className={cn('bg-white rounded-xl border border-gray-100 shadow-sm p-5', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-gray-900">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          {icon}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-1.5">
        <span className={cn('flex items-center gap-0.5 text-xs font-semibold', isPositive ? 'text-emerald-600' : 'text-red-500')}>
          {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {isPositive ? '+' : ''}{change}%
        </span>
        <span className="text-xs text-gray-400">{changeLabel}</span>
      </div>
    </div>
  )
}
