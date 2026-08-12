'use client'

import { useEffect, useRef, type ReactNode } from 'react'

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
 * Dismissal has three routes — the scrim, Escape, and an explicit Close
 * button supplied by the caller — because this often opens over a list
 * someone is scanning and the fastest exit should never be a hunt.
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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-[#040f11]/70 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'sheet-in relative w-full rounded-t-2xl border-t border-brand/30 bg-surface',
          'max-h-[85dvh] overflow-y-auto px-5 pt-2 pb-6 outline-none pb-safe',
          'shadow-[0_-20px_50px_-12px_rgba(0,0,0,0.8)]',
          className,
        )}
      >
        {/* The grab handle. Decorative — the sheet is not draggable; it is
            there because a sheet without one reads as a stuck overlay. */}
        <div aria-hidden className="mx-auto mb-4 h-1 w-10 rounded-full bg-rule-strong" />
        {children}
      </div>
    </div>
  )
}

export default BottomSheet
