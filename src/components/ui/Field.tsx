// No 'use client' here on purpose: Field has no state and no hooks, so both
// server and client components can render it — and, more importantly, server
// code can import `fieldControlClasses` without it becoming a client
// reference it cannot call.
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface FieldProps {
  /** Id of the control this label points at. Input/Select/Textarea supply it. */
  id: string
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
  children: ReactNode
}

/**
 * The label / hint / error shell shared by Input, Select and Textarea.
 *
 * Ids follow one convention so `aria-describedby` can be assembled without
 * the control knowing anything: `${id}-hint` and `${id}-error`.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={id} className="eyebrow mb-0.5">
          {label}
          {required ? (
            <span className="ml-1 text-ledger-red" aria-hidden>
              *
            </span>
          ) : null}
        </label>
      ) : null}

      {children}

      {hint && !error ? (
        <p id={`${id}-hint`} className="text-sm leading-snug text-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-sm leading-snug font-medium text-ledger-red"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Shared control styling. 16px text is deliberate — smaller and iOS Safari
 * zooms the page on focus.
 *
 * The field is a lifted well rather than an outlined box: on the night
 * ground a 1px outline alone reads as a divider, so the surface is raised
 * a few percent to say "type here". Focus adds a brass ring, which is the
 * one place besides the primary button that brass appears as a fill.
 */
export function fieldControlClasses(hasError: boolean): string {
  return cn(
    'tap block w-full rounded-xl border bg-surface px-4 text-base text-ink',
    'placeholder:text-subtle transition-colors duration-press ease-ledger',
    'focus:border-brand focus:ring-3 focus:ring-brand/20 focus:outline-none',
    'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70',
    hasError ? 'border-ledger-red' : 'border-rule-strong',
  )
}

/** Builds the `aria-describedby` value for a control inside a Field. */
export function fieldDescribedBy(
  id: string,
  hint: unknown,
  error: string | null | undefined,
): string | undefined {
  const parts: string[] = []
  if (hint && !error) parts.push(`${id}-hint`)
  if (error) parts.push(`${id}-error`)
  return parts.length > 0 ? parts.join(' ') : undefined
}

export default Field
