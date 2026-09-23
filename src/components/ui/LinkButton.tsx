import Link from 'next/link'
import type { ReactNode } from 'react'

import { buttonClassName, type ButtonSize, type ButtonVariant } from './Button'

export interface LinkButtonProps {
  href: string
  variant?: ButtonVariant
  /**
   * Omit for the design's own height for the variant — `lg` (56px) for a
   * primary, `md` (52px) otherwise. Pass it only when a specific screen
   * needs a specific height. Never go below `sm` (44px).
   */
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
  size,
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
