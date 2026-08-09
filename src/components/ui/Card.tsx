import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { StatusTone } from '@/lib/status'

/**
 * The card's ground.
 *
 * - `default` — a card on the night ground. Every list row, every panel.
 * - `hero`    — the one figure a screen exists to show, lifted off the
 *               ground with a brass wash. At most one per screen; two
 *               heroes is no hero.
 * - `attention` / `done` — a panel that IS a status (the "needs eyes on
 *               it" block, a sealed proof). Not decoration: the tint
 *               carries the same meaning as the pill inside it.
 * - `queued`  — outstanding work. Dashed, unfilled, deliberately
 *               unfinished-looking.
 */
export type CardTone = 'default' | 'hero' | 'attention' | 'done' | 'queued'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes the border and background — useful for a bare grouping wrapper. */
  flat?: boolean
  tone?: CardTone
  /**
   * A 3px status rule down the leading edge — the register's margin. Use
   * for a row whose state matters at a glance while scrolling.
   */
  edge?: StatusTone
}

const TONES: Record<CardTone, string> = {
  default: 'border border-rule bg-surface',
  hero:
    'border border-brand/25 bg-surface ' +
    'bg-[linear-gradient(158deg,var(--ef-brand-tint),transparent_62%)] ' +
    'shadow-[0_16px_40px_-22px_rgba(0,0,0,0.85)]',
  attention: 'border border-ledger-red/35 bg-red-tint',
  done: 'border border-ledger-green/35 bg-green-tint',
  queued: 'border-2 border-dashed border-muted/45 bg-transparent',
}

const EDGES: Record<StatusTone, string> = {
  neutral: 'border-l-[3px] border-l-rule-strong',
  active: 'border-l-[3px] border-l-brand',
  attention: 'border-l-[3px] border-l-ledger-red',
  done: 'border-l-[3px] border-l-ledger-green',
}

export function Card({
  flat = false,
  tone = 'default',
  edge,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl',
        !flat && TONES[tone],
        edge && EDGES[edge],
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
        'flex items-start justify-between gap-3 border-b border-rule px-4 py-3',
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
        'flex flex-wrap items-center gap-2 border-t border-rule px-4 py-3',
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

/**
 * Stagger helper for a list of cards.
 *
 * Rows enter 45ms apart, which reads as the list *arriving* rather than
 * appearing. Capped at 8 so row 40 of a 238-row queue is not still waiting
 * two seconds after the scroll — past the first screenful the delay is
 * pure cost.
 */
export function staggerDelay(index: number, step = 45): CSSProperties {
  return { animationDelay: `${Math.min(index, 8) * step}ms` }
}

export default Card
