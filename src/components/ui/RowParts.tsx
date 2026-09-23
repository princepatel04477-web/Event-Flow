import { cn } from '@/lib/utils'
import { initials as initialsOf } from '@/lib/ui/metrics'

export interface InitialsProps {
  /** The name to reduce. "Ravi Kumar Sharma" → "RK". */
  name: string | null | undefined
  className?: string
}

/**
 * The 40px circle at the head of a `Row`.
 *
 * Empty when the name has no usable characters, and it renders nothing at
 * all rather than an empty circle — a ring with nothing in it reads as a
 * broken image, which is worse than no avatar.
 *
 * The colour is deliberately not per-person. A stable colour derived from
 * the name would look like a status the moment two families' circles
 * differed, and this app has spent real effort keeping colour meaning one
 * thing. One tint, one shape.
 */
export function Initials({ name, className }: InitialsProps) {
  const letters = initialsOf(name)
  if (!letters) return null

  return (
    <span
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2',
        'text-sm font-semibold text-ink',
        className,
      )}
    >
      {letters}
    </span>
  )
}

export type StatusDotTone = 'neutral' | 'done' | 'waiting' | 'problem'

export interface StatusDotProps {
  tone?: StatusDotTone
  className?: string
}

const DOT: Record<StatusDotTone, string> = {
  neutral: 'bg-subtle',
  done: 'bg-ledger-green',
  waiting: 'bg-ledger-amber',
  problem: 'bg-ledger-red',
}

/**
 * The 10px dot that sits beside a row's status word.
 *
 * ALWAYS `aria-hidden`. The dot is a scan aid, never the message: every
 * place one appears there is also a word ("Coming", "Late", "Empty"), and a
 * screen reader announcing "green circle" before the word is noise. If a
 * screen ever wants a dot with no word, that screen wants a word.
 */
export function StatusDot({ tone = 'neutral', className }: StatusDotProps) {
  return (
    <span
      aria-hidden
      className={cn('h-2.5 w-2.5 shrink-0 rounded-full', DOT[tone], className)}
    />
  )
}

export default Initials
