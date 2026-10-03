'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { UploadIcon, UsersIcon, XIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

export interface NoGuestListPopupProps {
  eventCode: string
  eventName?: string
  /**
   * Whether the event has any guests or families.
   * If true, the popup will not render.
   * Defaults to false (indicating no guests exist).
   */
  hasGuests?: boolean
  /**
   * Optional controlled open state.
   */
  open?: boolean
  /**
   * Callback fired when popup is closed or dismissed.
   */
  onClose?: () => void
  /**
   * If true, shows even if previously dismissed in this browser session.
   */
  forceShow?: boolean
  className?: string
}

/**
 * Popup modal alerting the user when an event has no guest list,
 * prompting them to add / import the guest list.
 *
 * Mobile-first: rises as a bottom sheet on handsets, centers as a dialog on tablets/desktops.
 * Dismissal is remembered in sessionStorage per event so it does not harass the user repeatedly
 * during the same session while navigating.
 */
export function NoGuestListPopup({
  eventCode,
  eventName,
  hasGuests = false,
  open: controlledOpen,
  onClose,
  forceShow = false,
  className,
}: NoGuestListPopupProps) {
  const pathname = usePathname()
  const panelRef = useRef<HTMLDivElement>(null)
  const [internalOpen, setInternalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Do not show the popup on the guest import screen itself.
  const isImportRoute = Boolean(pathname?.includes('/guests/import'))

  const sessionKey = `ef_dismiss_no_guest_popup_${eventCode.toUpperCase()}`

  useEffect(() => {
    setMounted(true)
    if (controlledOpen !== undefined) {
      setInternalOpen(controlledOpen)
      return
    }

    if (hasGuests || isImportRoute) {
      setInternalOpen(false)
      return
    }

    try {
      const isDismissed = sessionStorage.getItem(sessionKey) === '1'
      if (!isDismissed || forceShow) {
        setInternalOpen(true)
      }
    } catch {
      // If sessionStorage is restricted or unavailable
      setInternalOpen(true)
    }
  }, [controlledOpen, hasGuests, isImportRoute, sessionKey, forceShow])

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen

  const handleClose = useCallback(() => {
    try {
      sessionStorage.setItem(sessionKey, '1')
    } catch {
      // Ignore sessionStorage errors
    }
    setInternalOpen(false)
    onClose?.()
  }, [sessionKey, onClose])

  // Escape key and scroll lock
  useEffect(() => {
    if (!isOpen || !mounted) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleClose()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)

    // Focus popup for screen readers and keyboard navigation
    panelRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, mounted, handleClose])

  if (!mounted || !isOpen || hasGuests || isImportRoute) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center p-0 sm:p-4"
      role="presentation"
      data-testid="no-guest-list-popup-container"
    >
      {/* Backdrop scrim */}
      <button
        type="button"
        aria-label="Close dialog"
        onClick={handleClose}
        className="absolute inset-0 h-full w-full cursor-default bg-[#040f11]/70 backdrop-blur-[2px] transition-opacity"
      />

      {/* Modal dialog panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="no-guest-popup-title"
        aria-describedby="no-guest-popup-desc"
        tabIndex={-1}
        className={cn(
          'sheet-in relative z-10 w-full rounded-t-2xl sm:rounded-2xl border-t sm:border border-brand/30 bg-surface',
          'max-h-[90dvh] overflow-y-auto px-5 pt-3 pb-6 pb-safe sm:max-w-md sm:p-6 outline-none',
          'shadow-e3 flex flex-col gap-4 text-ink',
          className,
        )}
      >
        {/* Grab handle for touch devices */}
        <div aria-hidden className="mx-auto mb-1 h-1 w-10 rounded-full bg-rule-strong sm:hidden" />

        {/* Header row with icon & close button */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-tint text-brand shadow-xs">
            <UsersIcon className="h-6 w-6" aria-hidden />
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={handleClose}
            className="tap -mr-1 -mt-1 flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-2"
          >
            <XIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* Title and context */}
        <div>
          <span className="inline-block rounded-full bg-brand-tint px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-brand">
            Guest list needed
          </span>
          <h2 id="no-guest-popup-title" className="mt-2 text-xl font-semibold text-fg">
            Add guest list
          </h2>
          {eventName ? (
            <p className="mt-0.5 text-xs text-muted">
              {eventName} · <span className="font-mono">{eventCode}</span>
            </p>
          ) : null}
          <p id="no-guest-popup-desc" className="mt-2 text-sm leading-relaxed text-muted">
            This event does not have any guests or families added yet. Import your guest list spreadsheet to activate RSVPs, room allocations, arrival pickups, and hampers.
          </p>
        </div>

        {/* Feature summary card */}
        <div className="rounded-xl border border-rule-strong bg-surface-2 p-3 text-xs text-muted">
          <p className="font-medium text-fg">What happens when you import:</p>
          <ul className="mt-1.5 list-inside list-disc space-y-1">
            <li>Families and individual guests are created automatically</li>
            <li>RSVP calling queue is prepared with contact numbers</li>
            <li>Hotel room and transport assignment will be enabled</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="mt-2 flex flex-col gap-2.5">
          <Link
            href={`/${eventCode}/guests/import`}
            onClick={handleClose}
            className="tap flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-center text-base font-semibold text-brand-fg shadow-sm transition-colors active:opacity-90"
          >
            <UploadIcon className="h-5 w-5" aria-hidden />
            <span>Import guest list</span>
          </Link>
          <button
            type="button"
            onClick={handleClose}
            className="tap flex min-h-11 w-full items-center justify-center rounded-xl border border-rule-strong bg-surface px-4 text-center text-sm font-medium text-ink transition-colors hover:bg-surface-2 active:bg-surface-2"
          >
            I&apos;ll do this later
          </button>
        </div>
      </div>
    </div>
  )
}

export default NoGuestListPopup
