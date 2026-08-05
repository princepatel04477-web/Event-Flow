import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface ListRowBaseProps {
  /**
   * The one thing on this row that matters. Rendered large (display face)
   * so it is readable at arm's length in a corridor.
   */
  identifier: ReactNode
  /** Secondary line under the identifier — meta, never a number. */
  meta?: ReactNode
  /** Right-hand meta column. Pass a single `StatusPill` here. */
  right?: ReactNode
  /** Whole-row press handler. Renders a `<button>` when set. */
  onPress?: () => void
  disabled?: boolean
  className?: string
}

type ButtonListRowProps = ListRowBaseProps & { onPress: () => void } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    keyof ListRowBaseProps
  >

type DivListRowProps = ListRowBaseProps & Omit<HTMLAttributes<HTMLDivElement>, keyof ListRowBaseProps>

export type ListRowProps = ButtonListRowProps | DivListRowProps

/**
 * The ledger's row: alternating paper bands, the identifier on the left in
 * the display face, optional right meta, and a pressed state. The red
 * margin rule lives on the list container, not on the rows — one continuous
 * rule, not a per-row decoration. A row carries at most one pill; secondary
 * facts (a lock, a callback time) belong in the meta line so every row in
 * the register keeps the same height.
 */
export function ListRow({
  identifier,
  meta,
  right,
  onPress,
  disabled,
  className,
  children,
  ...props
}: ListRowProps) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <span className="block font-display text-lg leading-snug text-ink">
          {identifier}
        </span>
        {meta ? (
          <span className="mt-0.5 block text-sm leading-snug text-muted">{meta}</span>
        ) : null}
      </div>

      {right ? (
        <div className="flex shrink-0 flex-col items-end gap-1">{right}</div>
      ) : null}

      {children ? <div className="min-w-0">{children}</div> : null}
    </>
  )

  const rowClass = cn(
    'tap relative flex min-h-14 items-center gap-3 px-3 py-2.5',
    'bg-paper text-left',
    onPress && !disabled
      ? 'cursor-pointer transition-colors duration-100 active:bg-paper-band'
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

export default ListRow
