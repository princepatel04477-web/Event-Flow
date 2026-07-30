import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

import { cn } from '@/lib/utils'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** `md` is 44px tall, `lg` is 56px. Never go below `md` — thumbs, gloves, rain. */
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

const BASE =
  'tap inline-flex items-center justify-center gap-2 rounded-xl border font-semibold ' +
  'leading-none whitespace-nowrap transition-colors select-none ' +
  'disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:opacity-55'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-brand text-brand-fg hover:bg-brand-hover active:bg-brand-hover',
  secondary: 'border-border bg-surface text-fg hover:bg-surface-2 active:bg-surface-2',
  danger: 'border-transparent bg-danger text-danger-fg hover:bg-danger-hover active:bg-danger-hover',
  ghost: 'border-transparent bg-transparent text-fg hover:bg-surface-2 active:bg-surface-2',
}

const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-11 px-4 py-2.5 text-base',
  lg: 'min-h-14 px-5 py-3.5 text-lg',
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
