'use client'

import { useId } from 'react'
import type { ReactNode, Ref, SelectHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'
import { ChevronDownIcon } from '@/components/icons'
import { Field, fieldControlClasses, fieldDescribedBy } from './Field'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  /** Convenience alternative to passing <option> children. */
  options?: SelectOption[]
  /** Rendered as a disabled, empty-valued first option. */
  placeholder?: string
  containerClassName?: string
  ref?: Ref<HTMLSelectElement>
}

/**
 * A native <select>. Deliberately native: the OS picker is the only control
 * that stays usable one-handed on a cheap Android phone, and it needs no JS.
 */
export function Select({
  label,
  hint,
  error,
  options,
  placeholder,
  id,
  className,
  containerClassName,
  required,
  children,
  ref,
  ...props
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId

  return (
    <Field
      id={selectId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <div className="relative">
        <select
          id={selectId}
          ref={ref}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(selectId, hint, error)}
          className={cn(
            fieldControlClasses(Boolean(error)),
            'min-h-12 appearance-none py-2.5 pr-11',
            className,
          )}
          {...props}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options?.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3.5 h-5 w-5 -translate-y-1/2 text-muted" />
      </div>
    </Field>
  )
}

export default Select
