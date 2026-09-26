'use client'

import { AnimatePresence, m } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'

import { DURATION, EASE, SPRING } from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'

export interface BottomSheetProps {
  open: boolean
  onClose: () => void
  /** Announced as the dialog's name. Required — a nameless dialog is a trap. */
  label: string
  children: ReactNode
  className?: string
}

/**
 * A sheet that rises from the bottom edge.
 *
 * Bottom-anchored because the content it carries is always something you
 * act on, and the bottom third of a 6" phone is the only part a thumb
 * reaches without regripping. Detail that arrives at the top of the screen
 * makes you move the hand that is holding the phone.
 *
 * Dismissal has four routes — the scrim, Escape, an explicit Close button
 * supplied by the caller, and the hardware Back button — because this often
 * opens over a list someone is scanning and the fastest exit should never be
 * a hunt.
 *
 * ── MOTION (M1) ────────────────────────────────────────────────────────────
 * The scrim fades with the house fade (DURATION.fade / EASE.ledger); the panel
 * rises from translateY(100%) with THE spring, the one critically damped
 * spring in `src/lib/motion/tokens.ts`. `AnimatePresence` is what makes the
 * close animate — the component returns null when closed, so without it the
 * panel would vanish rather than settle. Reduced motion is handled by
 * `MotionConfig reducedMotion="user"` in MotionProvider: transform animations
 * hold at their final value, so the sheet is instant rather than half-open.
 *
 * ── BACK (M1) ──────────────────────────────────────────────────────────────
 * Opening pushes ONE history entry marked `efSheet`; the hardware Back button
 * therefore navigates back instead of exiting the app (`NativeBridge` already
 * routes `backButton` through `history.back()`), which fires `popstate` and
 * closes the sheet. Closing by any other route pops that entry again, so Back
 * is never left needing two presses.
 */
export function BottomSheet({ open, onClose, label, children, className }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes, and the body underneath stops scrolling. Without the
  // scroll lock, dragging on the scrim scrolls the list behind the sheet
  // and you lose your place in a 168-room grid.
  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)

    // Move focus into the sheet so a keyboard or screen-reader user is not
    // left behind on the list underneath.
    panelRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  // Hardware Back / browser Back closes the sheet. See the header.
  useEffect(() => {
    if (!open) return

    let poppedByBack = false
    window.history.pushState({ ...(window.history.state ?? {}), efSheet: true }, '')

    function onPopState() {
      poppedByBack = true
      onClose()
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      // Guarded on OUR marker: if something else already popped the entry (or
      // one was never pushed) this must not navigate the app backwards.
      const state = window.history.state as { efSheet?: boolean } | null
      if (!poppedByBack && state?.efSheet) window.history.back()
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end">
          {/* The scrim is the ink token at 70%, not an off-palette dark teal:
              the retired night palette left #040f11 here, and against v3's warm
              paper ground it read as a blue cast over the whole screen. */}
          <m.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fade, ease: EASE.ledger }}
            className="absolute inset-0 h-full w-full cursor-default bg-ink/70 backdrop-blur-[2px]"
          />

          <m.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={SPRING}
            className={cn(
              'relative w-full rounded-t-2xl border-t border-rule bg-surface',
              'max-h-[85dvh] overflow-y-auto px-5 pt-2 pb-6 outline-none pb-safe',
              'shadow-e3',
              className,
            )}
          >
            {/* The grab handle. Decorative — the sheet is not draggable; it is
                there because a sheet without one reads as a stuck overlay. */}
            <div aria-hidden className="mx-auto mb-4 h-1 w-10 rounded-full bg-rule-strong" />
            {children}
          </m.div>
        </div>
      ) : null}
    </AnimatePresence>
  )
}

export default BottomSheet
