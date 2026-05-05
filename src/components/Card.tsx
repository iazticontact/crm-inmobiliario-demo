import { cn } from '@/lib/utils'

type CardProps = {
  children: React.ReactNode
  className?: string
  padding?: boolean
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
    <div className={cn('bg-white rounded-xl border border-gray-100 shadow-sm', padding && 'p-5', className)}>
      {children}
    </div>
  )
}
