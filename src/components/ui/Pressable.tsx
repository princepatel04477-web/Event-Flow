'use client'

import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/utils'

import { pressHandlers } from './press'

export interface PressableProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'onPointerDown' | 'onPointerUp' | 'onPointerCancel' | 'onPointerLeave'
  > {
  /**
   * Make the single child element pressable INSTEAD of rendering a `<button>`.
   *
   * The child keeps its own layout, its own semantics and its own behaviour —
   * a `next/link` `<Link>` stays a real link (middle-click, long-press, its own
   * prefetch) and is only given the pressed state. Pressable COMPOSES the
   * child's existing pointer handlers rather than replacing them, so a caller
   * that already arms a prefetch on `pointerdown` still does.
   */
  asChild?: boolean
  /**
   * In asChild mode this is the element to make pressable. In button mode it
   * is the label. A `Pressable` with `asChild` and more than one child throws
   * — there is no correct element to attach the state to.
   */
  children?: ReactNode
  disabled?: boolean
  /**
   * Button mode only. A link child navigates on its own; do not pass this in
   * asChild mode.
   */
  onPress?: () => void
}

/** The props Pressable reads off a child, and composes rather than drops. */
interface ChildProps {
  className?: string
  onPointerDown?: PointerEventHandler<HTMLElement>
  onPointerUp?: PointerEventHandler<HTMLElement>
  onPointerCancel?: PointerEventHandler<HTMLElement>
  onPointerLeave?: PointerEventHandler<HTMLElement>
  [key: string]: unknown
}

/**
 * Anything a runner taps that is not a `Button`: a tab, a row, a card, a tile,
 * a link.
 *
 * WHY THIS EXISTS. `:active` is a browser decision made on the browser's
 * schedule, and on a cheap Android WebView with a busy main thread that
 * schedule can miss the frame the finger landed on — the tap reads as dropped,
 * so the runner taps again (`docs/INTERACTION-CONTRACT.md` T1). Here the
 * `pointerdown` handler sets one attribute and CSS does the rest: the element
 * scales to 0.97 and takes the pressed surface, in the same frame, with no
 * re-render standing in the way. Release springs back in 90ms.
 *
 * The visual rules are on `.pressable` in `src/app/globals.css` — transform and
 * background only, so nothing here can trigger layout on the touch path.
 *
 * Disabled means NO press: a disabled control must not acknowledge a tap it
 * will not act on.
 */
export function Pressable({
  asChild = false,
  children,
  disabled,
  onPress,
  className,
  type = 'button',
  ...props
}: PressableProps) {
  const handlers = pressHandlers(disabled)

  if (asChild) {
    if (!isValidElement(children)) {
      throw new Error('Pressable with asChild expects exactly one element child.')
    }

    const child = children as ReactElement<ChildProps>
    const childProps = child.props

    return cloneElement(child, {
      className: cn('pressable', className, childProps.className),
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        childProps.onPointerDown?.(event)
        handlers.onPointerDown(event)
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        childProps.onPointerUp?.(event)
        handlers.onPointerUp(event)
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
        childProps.onPointerCancel?.(event)
        handlers.onPointerCancel(event)
      },
      onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => {
        childProps.onPointerLeave?.(event)
        handlers.onPointerLeave(event)
      },
    })
  }

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onPress}
      className={cn('pressable', className)}
      {...handlers}
      {...props}
    >
      {children}
    </button>
  )
}

export default Pressable
