import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type RowTone = 'neutral' | 'done' | 'waiting' | 'problem'

export interface RowProps {
  /** The one thing on the row — nearly always a family or guest name. */
  heading: string
  /** One muted line under it. Facts only, never a second heading. */
  meta?: string
  /**
   * The 40px avatar's letters. Omit it entirely when there is no meaningful
   * two-letter form (a room number is not initials) and pass `badge`
   * instead, or leave both out and the row starts at the text.
   */
  initials?: string
  /** A 40px box on the left holding a figure — a room number, a count. */
  badge?: ReactNode
  /** The status word on the right, one word. "Coming", "Empty", "Late". */
  status?: string
  /** The dot's colour, when there is a status to colour. */
  tone?: RowTone
  /** A chevron or any other trailing glyph, right of the status. */
  trailing?: ReactNode
  /** Whole-row press handler. Renders a `<button>` when set. */
  onPress?: () => void
  disabled?: boolean
  className?: string
}

type ButtonRowProps = RowProps &
  { onPress: () => void } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof RowProps>

type DivRowProps = RowProps & Omit<HTMLAttributes<HTMLDivElement>, keyof RowProps>

export type RowAllProps = ButtonRowProps | DivRowProps

const DOT_TONE: Record<RowTone, string> = {
  neutral: 'bg-subtle',
  done: 'bg-ledger-green',
  waiting: 'bg-ledger-amber',
  problem: 'bg-ledger-red',
}

/**
 * The register's row: a 40px avatar, an ellipsised name, one muted meta line,
 * and a status dot with a one-word status on the right.
 *
 * WHAT IT REPLACES. v2 rows ended in a wall of `StatusPill`s — a coloured
 * pill per row, in four tones, which read as a traffic-light board and made
 * "which of these needs me" a colour-matching exercise at arm's length in bad
 * light. Here the status is a WORD with a 10px dot next to it; the word is
 * what carries the meaning and the dot is what makes a column of them
 * scannable.
 *
 * 64px minimum, and the WHOLE row is the tap target — not a chevron in the
 * corner, not the name. On a phone, a row is a button.
 */
export function Row({
  heading,
  meta,
  initials,
  badge,
  status,
  tone = 'neutral',
  trailing,
  onPress,
  disabled,
  className,
  ...props
}: RowAllProps) {
  const hasLeading = Boolean(initials) || Boolean(badge)

  const inner = (
    <>
      {hasLeading ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center">
          {initials ? (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-ink">
              {initials}
            </span>
          ) : (
            badge
          )}
        </span>
      ) : null}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-base leading-snug font-medium text-ink">
          {heading}
        </span>
        {meta ? (
          <span className="mt-0.5 block truncate text-sm leading-snug text-muted">{meta}</span>
        ) : null}
      </span>

      {status ? (
        <span className="flex shrink-0 items-center gap-2 pl-2">
          <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', DOT_TONE[tone])} />
          <span className="text-sm font-medium text-muted">{status}</span>
        </span>
      ) : null}

      {trailing ? <span className="shrink-0 text-muted">{trailing}</span> : null}
    </>
  )

  const rowClass = cn(
    'tap flex min-h-16 w-full items-center gap-3 px-3 py-2.5 text-left',
    'border-b border-rule last:border-b-0',
    onPress && !disabled
      ? 'cursor-pointer transition-colors duration-press ease-ledger active:bg-surface-2'
      : undefined,
    disabled && 'opacity-60',
    className,
  )

  if (onPress) {
    return (
      <button
        type="button"
        onClick={onPress}
        disabled={disabled}
        className={rowClass}
        {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={rowClass} {...(props as HTMLAttributes<HTMLDivElement>)}>
      {inner}
    </div>
  )
}

export default Row
