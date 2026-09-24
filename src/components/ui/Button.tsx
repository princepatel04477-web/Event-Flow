import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

import { cn } from '@/lib/utils'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
/**
 * - `sm` 44px — the floor. An icon button, or a control inside a row.
 * - `md` 52px — the v3 secondary height, and the default for a secondary.
 * - `lg` 56px — the v3 primary height, and the default for a primary.
 *
 * The DEFAULT depends on the variant (`defaultButtonSize` below), because
 * "how tall is a primary" and "how tall is a secondary" are two decisions
 * the design makes, not one. A caller that wants a specific height passes
 * `size`; a caller that wants the design's own answer omits it.
 */
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** Defaults per variant: primary `lg` (56), everything else `md` (52). */
  size?: ButtonSize
  /**
   * FOR IRREVERSIBLE COMMITS ONLY.
   *
   * `loading` swaps the leading icon for a spinner AND sets `disabled`, so the
   * control goes dead for the length of the round trip. On venue Wi-Fi that is
   * the worst possible trade for anything the user could reasonably change their
   * mind about — docs/INTERACTION-CONTRACT.md T3 calls a disabled button a bug
   * unless the input is invalid.
   *
   * Reversible writes must NOT use this. They go through
   * `src/lib/mutate/useOptimisticAction.ts`, which changes the screen on the tap
   * and offers an UndoBar instead.
   *
   * The one screen that may use it: the delivery-proof seal in
   * `(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx`.
   * `delivery_proofs` is insert-only with `app.block_mutation()` triggers
   * (CLAUDE.md §5.2) — not even the service role can delete a row — so there is
   * nothing to undo, and blocking the double-tap is the honest behaviour.
   */
  loading?: boolean
  fullWidth?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

/**
 * A rounded rectangle, never a pill. The pill shape is spoken for: in this
 * design a fully-round element is a *chip* (a status, a filter, a segment),
 * and a chip is not pressable-to-commit. Keeping the two shapes apart means a
 * caller can tell what a control does before reading it.
 *
 * NEVER FADED AT REST (v3 rule). There is no `opacity` on the base and no
 * variant washes its own colour out, so a button merely sitting on a screen is
 * at full strength. A genuinely DISABLED button is not faded either: it drops
 * to a neutral surface with `text-muted` instead of `disabled:opacity-55`,
 * which composited to ~2:1 and read as a rendering glitch rather than a
 * control in a bright lobby (m5).
 */
const BASE =
  'tap inline-flex items-center justify-center gap-2 rounded-xl border font-semibold ' +
  'leading-none whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color] duration-press ease-ledger ' +
  'disabled:cursor-not-allowed disabled:border-rule disabled:bg-surface-2 disabled:text-muted ' +
  'aria-disabled:border-rule aria-disabled:bg-surface-2 aria-disabled:text-muted'

const VARIANTS: Record<ButtonVariant, string> = {
  // Maroon fill, white text (10.0:1), and the only solid maroon fill on any
  // screen, so "the commit" is never ambiguous. The shadow is a hairline lift
  // (shadow-e1) on the paper ground.
  primary:
    'border-transparent bg-brand text-brand-fg shadow-e1 ' +
    'hover:bg-brand-hover active:bg-brand-hover',
  // White on the paper ground with a 1.5px hairline. The hairline rather than
  // a fill is what keeps a secondary off the same visual plane as a primary.
  secondary:
    'border-[1.5px] border-rule-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
  danger:
    'border-transparent bg-ledger-red text-paper hover:bg-ledger-red-strong active:bg-ledger-red-strong',
  ghost: 'border-transparent bg-transparent text-ink hover:bg-surface-2 active:bg-surface-2',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3.5 py-2 text-sm',
  md: 'min-h-13 px-4 py-3 text-base',
  lg: 'min-h-14 px-5 py-3.5 text-base',
}

/** The design's own height for a variant, when the caller does not choose. */
export function defaultButtonSize(variant: ButtonVariant = 'primary'): ButtonSize {
  return variant === 'primary' ? 'lg' : 'md'
}

/**
 * The button look, without the `<button>`.
 *
 * Exported so a navigation target can be styled as a button without anyone
 * copying the class list into a page — a `<button>` nested in an `<a>` is
 * invalid HTML, and a `<button>` with an onClick router.push is not a link
 * (no middle-click, no long-press, no prefetch). See `LinkButton`.
 */
export function buttonClassName({
  variant = 'primary',
  size,
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
} = {}): string {
  return cn(
    BASE,
    VARIANTS[variant],
    SIZES[size ?? defaultButtonSize(variant)],
    fullWidth && 'w-full',
    className,
  )
}

export function Button({
  variant = 'primary',
  size,
  loading = false,
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ref,
  ...props
}: ButtonProps) {
  const resolved = size ?? defaultButtonSize(variant)

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[resolved], fullWidth && 'w-full', className)}
      {...props}
    >
      {loading ? (
        <Spinner size={resolved === 'sm' ? 'sm' : 'md'} label={null} />
      ) : (
        leadingIcon
      )}
      {children}
      {loading ? null : trailingIcon}
    </button>
  )
}

export default Button
