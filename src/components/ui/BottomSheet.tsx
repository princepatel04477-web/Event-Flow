'use client'

import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode } from 'react'

import { pushSheet } from '@/lib/nav/sheet-stack'
import { cn } from '@/lib/utils'

export interface BottomSheetProps {
  open: boolean
  onClose: () => void
  label: string
  children: ReactNode
  className?: string
}

/** Dragged further than this share of its height, the sheet closes on release. */
const CLOSE_FRACTION = 0.3
/** Or flicked faster than this (px per ms), whatever the distance. */
const CLOSE_VELOCITY = 0.5

/**
 * A sheet that rises from the bottom and can be dragged back down.
 *
 * UI4 (§2.3, §3 F9). The grab handle used to be decorative ("the sheet is not
 * draggable"). It is real now: drag the top of the sheet down and it follows
 * the finger; release past 30% of its height, or with a flick, and it closes;
 * otherwise it springs back.
 *
 * HOW IT STAYS AT 60fps ON A CHEAP PHONE. The drag writes `transform` straight
 * onto the panel's style from the pointer handler — no React state per frame,
 * so nothing re-renders while the finger moves, and transform never triggers
 * layout. The scrim fades with the same distance via `opacity`. motion's drag
 * would need its larger feature bundle (`domMax`); this needs none.
 *
 * Only the top strip (handle + first 40px) starts a drag, so the body stays
 * scrollable and a scroll never becomes a dismissal. The body uses
 * `overscroll-behavior: contain` so reaching its end does not scroll the page
 * underneath.
 *
 * Android back closes the topmost open sheet before it touches history — the
 * sheet registers itself in `@/lib/nav/sheet-stack` while open (UI4 N4).
 */
export function BottomSheet({ open, onClose, label, children, className }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ startY: number; startT: number; dy: number } | null>(null)
  const closing = useRef(false)

  // Keep the latest onClose without re-running the open effect on every render
  // of a parent that passes an inline arrow.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  /** Slide out, then tell the parent. Used by drag and by the back button. */
  const animateClose = useCallback(() => {
    const panel = panelRef.current
    if (!panel || closing.current) {
      onCloseRef.current()
      return
    }
    closing.current = true
    // The entrance (`sheet-in`, fill-mode both) would otherwise keep winning
    // over the inline transform: an animation outranks an inline style.
    panel.style.animation = 'none'
    panel.style.transition = `transform var(--ef-duration-fade) var(--ef-ease)`
    panel.style.transform = 'translateY(100%)'
    if (scrimRef.current) {
      scrimRef.current.style.transition = `opacity var(--ef-duration-fade) linear`
      scrimRef.current.style.opacity = '0'
    }
    window.setTimeout(() => onCloseRef.current(), 160)
  }, [])

  // Escape closes, the body stops scrolling, focus moves in, and the sheet is
  // registered for the Android back button. Without the scroll lock, dragging
  // on the scrim scrolls the list behind the sheet and you lose your place in
  // a 168-room grid.
  useEffect(() => {
    if (!open) return
    closing.current = false

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    const unregister = pushSheet(animateClose)

    // Move focus into the sheet so a keyboard or screen-reader user is not
    // left behind on the list underneath.
    panelRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      unregister()
    }
  }, [open, animateClose])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    drag.current = { startY: event.clientY, startT: event.timeStamp, dy: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
    const panel = panelRef.current
    if (panel) {
      // See animateClose: drop the finished entrance so the inline transform
      // the drag writes is the one that applies.
      panel.style.animation = 'none'
      panel.style.transition = 'none'
    }
    if (scrimRef.current) scrimRef.current.style.transition = 'none'
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const panel = panelRef.current
    if (!d || !panel) return
    d.dy = Math.max(0, event.clientY - d.startY)
    panel.style.transform = `translateY(${d.dy}px)`
    if (scrimRef.current) {
      const h = panel.offsetHeight || 1
      scrimRef.current.style.opacity = String(Math.max(0, 1 - d.dy / h))
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const panel = panelRef.current
    drag.current = null
    if (!d || !panel) return
    const elapsed = Math.max(1, event.timeStamp - d.startT)
    const velocity = d.dy / elapsed
    if (d.dy > panel.offsetHeight * CLOSE_FRACTION || velocity > CLOSE_VELOCITY) {
      animateClose()
      return
    }
    // Spring back. The out-expo ease reads as a firm spring with no overshoot.
    panel.style.transition = `transform var(--ef-duration-enter) var(--ef-ease)`
    panel.style.transform = ''
    if (scrimRef.current) {
      scrimRef.current.style.transition = `opacity var(--ef-duration-enter) linear`
      scrimRef.current.style.opacity = ''
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      {/* The scrim is the ink token, not an off-palette tint, and it is NOT
          blurred: a backdrop blur re-renders everything behind it on every
          frame of the sheet's entrance (UI4 §3, F2). */}
      <button
        ref={scrimRef}
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-ink/50"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'sheet-in relative flex w-full flex-col rounded-t-3xl bg-surface outline-none',
          'max-h-[88dvh] shadow-e3',
          className,
        )}
      >
        {/* The grab strip: handle plus a generous 40px target. Dragging it
            moves the sheet; the body below scrolls normally. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="flex h-8 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        >
          <div aria-hidden className="h-1.5 w-11 rounded-full bg-rule-strong" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pb-safe">
          {children}
        </div>
      </div>
    </div>
  )
}

export default BottomSheet
