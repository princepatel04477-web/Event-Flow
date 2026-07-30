'use client'

import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'

import { cn } from '@/lib/utils'
import { Field, fieldControlClasses, fieldDescribedBy } from './Field'

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  /** Applied to the Field wrapper rather than the <input>. */
  containerClassName?: string
  ref?: Ref<HTMLInputElement>
}

export function Input({
  label,
  hint,
  error,
  id,
  className,
  containerClassName,
  required,
  type = 'text',
  ref,
  ...props
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <Field
      id={inputId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <input
        id={inputId}
        ref={ref}
        type={type}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(inputId, hint, error)}
        className={cn(fieldControlClasses(Boolean(error)), 'min-h-12 py-2.5', className)}
        {...props}
      />
    </Field>
  )
}

export default Input
