import type { PointerEventHandler } from 'react'

/**
 * The pressed-state attribute. One name, used by CSS and by JS, so a change
 * to it is a change in exactly two places.
 */
export const PRESSED_ATTR = 'data-pressed'

/**
 * Toggle the pressed attribute on the element the finger landed on.
 *
 * IMPERATIVE AND SYNCHRONOUS, ON PURPOSE. No React state, so no re-render is
 * scheduled before the browser paints. That is what makes the response land in
 * the same frame as the touch even while the main thread is mid-work — a
 * `setState` here would queue behind whatever is running.
 *
 * Lives in a module with no `'use client'` because `Row` and `ListRow` are
 * rendered from BOTH trees: a client component may import a plain module, but a
 * server component calling a function out of a `'use client'` module is a build
 * error — and Home renders `Row` on the server.
 */
export function setPressed(target: EventTarget | null, on: boolean): void {
  if (!(target instanceof HTMLElement)) return
  if (on) target.setAttribute(PRESSED_ATTR, '')
  else target.removeAttribute(PRESSED_ATTR)
}

/**
 * The four pointer handlers that maintain the pressed state on an element.
 *
 * `pointerdown` rather than `:active`: `:active` waits for the browser's own
 * activation timing and can lag a busy main thread, which is exactly the case
 * this exists for. A disabled control gets no handlers at all.
 */
export function pressHandlers(disabled?: boolean): {
  onPointerDown: PointerEventHandler<HTMLElement>
  onPointerUp: PointerEventHandler<HTMLElement>
  onPointerCancel: PointerEventHandler<HTMLElement>
  onPointerLeave: PointerEventHandler<HTMLElement>
} {
  if (disabled) {
    const noop: PointerEventHandler<HTMLElement> = () => {}
    return {
      onPointerDown: noop,
      onPointerUp: noop,
      onPointerCancel: noop,
      onPointerLeave: noop,
    }
  }
  const down: PointerEventHandler<HTMLElement> = (event) => {
    setPressed(event.currentTarget, true)
  }
  const release: PointerEventHandler<HTMLElement> = (event) => {
    setPressed(event.currentTarget, false)
  }
  return {
    onPointerDown: down,
    onPointerUp: release,
    onPointerCancel: release,
    onPointerLeave: release,
  }
}
