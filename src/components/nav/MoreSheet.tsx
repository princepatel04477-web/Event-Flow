'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface MoreSheetItem {
  /** Path segment after /{eventCode}. Empty string is the dashboard. */
  segment: string
  label: string
  icon: ReactNode
}

export interface MoreSheetProps {
  eventCode: string
  open: boolean
  onClose: () => void
  items: MoreSheetItem[]
}

/**
 * The More sheet: every tab that did not earn a slot on the 5-tab bar.
 *
 * One tap from the bar, dismissible by swipe down, backdrop tap, or Escape.
 * Focus moves into the sheet on open and back to the bar trigger on close,
 * and the sheet is aria-modal so the rest of the app is inert while it is
 * up. The grab handle reads as an affordance, not a control.
 */
export function MoreSheet({ eventCode, open, onClose, items }: MoreSheetProps) {
  const pathname = usePathname()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const touchStartY = useRef<number | null>(null)

  const segments = pathname.split('/').filter(Boolean)
  const current = segments.length > 1 ? segments[1] : ''

  // Focus the panel when it opens (and restore nothing — the trigger in the
  // bar keeps its own focus styles). Escape closes it.
  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50"
      role="presentation"
      onTouchStart={(e) => {
        touchStartY.current = e.touches[0]?.clientY ?? null
      }}
      onTouchMove={(e) => {
        if (touchStartY.current === null) return
        const dy = (e.touches[0]?.clientY ?? 0) - touchStartY.current
        if (dy > 80) onClose()
      }}
      onTouchEnd={() => {
        touchStartY.current = null
      }}
    >
      {/* Backdrop */}
      <button
        ref={closeRef}
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-ink/40"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="More sections"
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 mx-auto max-w-[480px] rounded-t-2xl border-t border-border bg-surface pb-safe outline-none"
      >
        <div className="flex justify-center pt-2.5">
          <span className="h-1 w-10 rounded-full bg-rule-strong" aria-hidden />
        </div>

        <div className="px-4 pt-3 pb-2">
          <h2 className="text-base font-semibold text-fg">More</h2>
          <p className="mt-0.5 text-sm text-muted">Everything else for this event.</p>
        </div>

        <ul className="flex flex-col px-3 pb-3">
          {items.map((item) => {
            const href = item.segment ? `/${eventCode}/${item.segment}` : `/${eventCode}`
            const active = current === item.segment

            return (
              <li key={item.label}>
                <Link
                  href={href}
                  onClick={onClose}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'tap flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-medium transition-colors',
                    active ? 'bg-tint-neutral text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg active:bg-surface-2 active:opacity-80',
                  )}
                >
                  <span className="shrink-0 text-current" aria-hidden>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export default MoreSheet
