import { cn } from '@/lib/utils'

type CardProps = {
  children: React.ReactNode
  className?: string
  padding?: boolean
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
    <div className={cn('rounded-xl border border-gray-200/70 bg-white shadow-sm shadow-gray-950/[0.03]', padding && 'p-5', className)}>
      {children}
    </div>
  )
}
