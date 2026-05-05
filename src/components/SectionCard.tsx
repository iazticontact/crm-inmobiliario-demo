import { cn } from '@/lib/utils'

type SectionCardProps = {
  title?: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  noPadding?: boolean
}

export function SectionCard({ title, description, action, children, className, bodyClassName, noPadding }: SectionCardProps) {
  return (
    <div className={cn('rounded-xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.035]', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-gradient-to-b from-white to-gray-50/35 px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-gray-900">{title}</h2>}
            {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={cn(!noPadding && 'p-5', bodyClassName)}>{children}</div>
    </div>
  )
}
