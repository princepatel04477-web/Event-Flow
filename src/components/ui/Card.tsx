import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes the border and background — useful for a bare grouping wrapper. */
  flat?: boolean
}

export function Card({ flat = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl',
        !flat && 'border border-border bg-surface shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

export function CardHeader({ className, children, ...props }: CardSectionProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 border-b border-border px-4 py-3',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardBody({ className, children, ...props }: CardSectionProps) {
  return (
    <div className={cn('px-4 py-4', className)} {...props}>
      {children}
    </div>
  )
}

export function CardFooter({ className, children, ...props }: CardSectionProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-t border-border px-4 py-3',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/** Convenience title/subtitle pair for use inside CardHeader. */
export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('min-w-0', className)} {...props}>
      {children}
    </div>
  )
}

export default Card
