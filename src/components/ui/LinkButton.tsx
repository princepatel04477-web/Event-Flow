import Link from 'next/link'
import type { ReactNode } from 'react'

import { buttonClassName, type ButtonSize, type ButtonVariant } from './Button'

export interface LinkButtonProps {
  href: string
  variant?: ButtonVariant
  /** `md` is 44px tall, `lg` is 56px. Never go below `md`. */
  size?: ButtonSize
  fullWidth?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * A navigation target that looks like a Button.
 *
 * Exists so nothing has to choose between two wrong options: a `<button>`
 * inside an `<a>` (invalid HTML) or a `<button onClick={router.push}>` (loses
 * prefetch, middle-click and long-press-to-open, and is announced as a button
 * when it is really a link). Shares `buttonClassName` with Button, so the two
 * cannot drift apart.
 */
export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={buttonClassName({ variant, size, fullWidth, className })}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </Link>
  )
}

export default LinkButton
