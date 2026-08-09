import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface ListRowBaseProps {
  /**
   * The one thing on this row that matters — nearly always a family name.
   *
   * Set in the sans face, not the display serif: these names arrive off
   * the Excel sheet in Devanagari, and Cormorant Garamond has no
   * Devanagari cut, so a serif identifier would render half the register
   * in one family and half in a fallback. The display face is reserved
   * for screen titles and the seal, which are Latin by construction.
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
 * The register's row: identifier on the left, optional right meta, a
 * pressed state, and a minimum height that clears a thumb.
 *
 * A row carries at most one pill; secondary facts (a lock, a callback
 * time) belong in the meta line so every row in the register keeps the
 * same height and the eye can run down the column of pills.
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
        <span className="block text-lg leading-snug font-medium text-ink">
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
    'tap relative flex min-h-14 items-center gap-3 px-3 py-3 text-left',
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
        className={cn(rowClass, 'w-full')}
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
