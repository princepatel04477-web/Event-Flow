'use client'

import { useId } from 'react'
import type { ReactNode, Ref, TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'
import { Field, fieldControlClasses, fieldDescribedBy } from './Field'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  containerClassName?: string
  ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({
  label,
  hint,
  error,
  id,
  className,
  containerClassName,
  required,
  rows = 4,
  ref,
  ...props
}: TextareaProps) {
  const generatedId = useId()
  const textareaId = id ?? generatedId

  return (
    <Field
      id={textareaId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <textarea
        id={textareaId}
        ref={ref}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(textareaId, hint, error)}
        className={cn(
          fieldControlClasses(Boolean(error)),
          'min-h-28 resize-y py-2.5 leading-relaxed',
          className,
        )}
        {...props}
      />
    </Field>
  )
}

export default Textarea
