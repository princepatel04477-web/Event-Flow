import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

import { cn } from '@/lib/utils'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** `md` is 48px tall, `lg` is 56px. Never go below `md` — thumbs, gloves, rain. */
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

/**
 * A rounded rectangle, never a pill. The pill shape is spoken for: in this
 * design a fully-round element is a *chip* (a status, a filter), and a chip
 * is not pressable-to-commit. Keeping the two shapes apart means a caller
 * can tell what a control does before reading it.
 */
const BASE =
  'tap inline-flex items-center justify-center gap-2 rounded-xl border font-semibold ' +
  'leading-none whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,transform] duration-press ease-ledger ' +
  'active:scale-[0.988] ' +
  'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100 ' +
  'aria-disabled:opacity-55'

const VARIANTS: Record<ButtonVariant, string> = {
  // Brass on the ground with dark type — 8:1, and the only solid brass
  // fill on any screen, so "the commit" is never ambiguous. The shadow is
  // a brass glow rather than a black drop: on a #071A1D ground a black
  // shadow is invisible.
  primary:
    'border-transparent bg-brand text-brand-fg shadow-[0_10px_30px_-12px] shadow-brand/70 ' +
    'hover:bg-brand-hover active:bg-brand-hover',
  secondary:
    'border-rule-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
  danger:
    'border-transparent bg-ledger-red text-paper hover:bg-ledger-red-strong active:bg-ledger-red-strong',
  ghost: 'border-transparent bg-transparent text-ink hover:bg-surface-2 active:bg-surface-2',
}

const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-12 px-4 py-2.5 text-base',
  lg: 'min-h-14 px-5 py-3.5 text-base',
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
  size = 'md',
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
} = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)
}

export function Button({
  variant = 'primary',
  size = 'md',
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
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...props}
    >
      {loading ? (
        <Spinner size={size === 'lg' ? 'md' : 'sm'} label={null} />
      ) : (
        leadingIcon
      )}
      {children}
      {loading ? null : trailingIcon}
    </button>
  )
}

export default Button
