'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { SlidersIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

export interface AccountMenuProps {
  /** The session controls: event switcher, admin link, sign out. */
  children: ReactNode
}

/**
 * The session controls, folded behind one 44px button.
 *
 * WHY THEY ARE NOT IN THE HEADER ANY MORE. v2's header put the search button,
 * a help glyph, the event switcher, the admin link and a sign-out control in
 * one row beside the title. At 360px that left the TITLE about 90px — it
 * truncated to "CALL QU…" on the screen whose whole job is to say where you
 * are. v3's rule is one loud thing per row: the title, and the search button.
 * Everything that is about the SESSION rather than about this screen lives
 * here, one tap away, and none of it competes with the screen's own name.
 *
 * A dialog-less popover, not a `BottomSheet`. These are four small controls,
 * not a form: a sheet that covers two thirds of the screen to reach Sign out
 * is a heavier interaction than the action deserves, and the header button
 * that opened it must stay visible so the menu can be closed the same way.
 *
 * Closing: the trigger toggles, Escape closes, and a tap anywhere outside
 * closes. Focus returns to the trigger on Escape so a keyboard user is not
 * dropped at the top of the document.
 */
export function AccountMenu({ children }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    function onPointerDown(event: PointerEvent) {
      if (containerRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Account and event"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
          'border border-rule-strong bg-surface text-ink shadow-e1',
          'transition-colors duration-press ease-ledger hover:bg-surface-2 active:bg-surface-2',
          open && 'bg-surface-2',
        )}
      >
        <SlidersIcon className="h-5 w-5" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account and event"
          // Fixed and right-anchored to the viewport — NOT absolute inside the
          // header. The header is `overflow` -prone at 360px and a panel
          // positioned inside it gets clipped the moment a long event name
          // widens the title column. `top-14` clears the 56px header row.
          className={cn(
            'fixed top-14 right-4 z-50 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1',
            'rounded-2xl border border-rule-strong bg-surface p-2 shadow-e3',
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

export default AccountMenu
