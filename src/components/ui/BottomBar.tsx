'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { Button } from './Button'
import { LinkButton } from './LinkButton'

export interface BarAction {
  label: string
  /** Navigation. Mutually exclusive with `onPress`; exactly one is required. */
  href?: string
  /** A write. Mutually exclusive with `href`. */
  onPress?: () => void
  /** Leading glyph — usually a camera on the proof screen. */
  icon?: ReactNode
  disabled?: boolean
}

export interface BottomBarProps {
  /**
   * ONE line above the buttons. A fact the person needs at the moment of
   * committing: "3 families left", "Room 104 · 2 hampers".
   */
  summary?: string
  /** The screen's single primary action. Required — a bar with no action is a footer. */
  primary: BarAction
  /** At most one secondary. A third button in this bar is a design failure. */
  secondary?: BarAction
  className?: string
}

/**
 * The floating action bar. It holds the screen's ONE primary action, one
 * optional secondary, and a one-line summary.
 *
 * FIXED, NOT STICKY, and stacked directly above the tab bar — the `bottom-bar`
 * utility computes that offset from the same `--ef-tabbar-h` the layout
 * reserves clearance with, so the two cannot drift apart. It is fixed rather
 * than sticky because on a phone the primary action must be under the thumb
 * the whole time, not only once the page has been scrolled to its end.
 *
 * A SCREEN THAT MOUNTS THIS MUST ALSO CLEAR IT. Add `pb-nav-bottombar` when
 * the screen has a tab bar, or `pb-bottombar` when it does not, to the
 * scrolling element — otherwise the last row of the list sits under this bar
 * and the thing the list is about becomes unreachable.
 *
 * At most two controls, and the secondary is on the LEFT with a hairline
 * border while the primary is a maroon fill on the right. That is the whole
 * hierarchy: one filled control per screen, always in the same place.
 */
export function BottomBar({ summary, primary, secondary, className }: BottomBarProps) {
  return (
    // z-40 matches the tab bar's layer, and this element is later in the tree
    // so it paints over it. Every other overlay in the app is z-50 — the
    // UndoBar, the bottom sheet, the first-run cards — so an undo offer or a
    // failed-write notice always covers this bar rather than the other way
    // round, which is the right precedence: a Save button must never hide the
    // one control that takes a wrong save back.
    <div
      className={cn(
        'fixed inset-x-0 bottom-bar z-40 border-t border-rule bg-surface px-safe shadow-e3',
        className,
      )}
    >
      <div className="mx-auto w-full max-w-[480px] px-4 py-3">
        {summary ? (
          <p className="mb-2 truncate text-sm leading-snug text-muted">{summary}</p>
        ) : null}

        {/* EQUAL HALVES, not a third and two thirds. Two reasons, and the
            second is the load-bearing one:
            1. A 1/3 column at 360px is 108px, and `Button` is
               `whitespace-nowrap` with a flex item's default
               `min-width: auto` — so a secondary label longer than about ten
               characters ("Not in room · 2 left") made the ROW wider than the
               screen instead of truncating, and a fixed bar cannot scroll
               horizontally. Late in this session that is a clipped screen with
               no way to reach the missing half.
            2. `flex-1` gives each control 159px at 360px, which fits every
               label the spec names. The primary is still unmistakably
               dominant: it is the maroon fill, the secondary is a hairline. */}
        <div className="flex items-stretch gap-2.5">
          {secondary ? (
            <div className="min-w-0 flex-1">
              <BarControl action={secondary} variant="secondary" fullWidth />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <BarControl action={primary} variant="primary" fullWidth />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * One control in the bar. A navigation target stays a link (it keeps
 * prefetch, middle-click and the right announcement); an action is a button.
 * The choice is made from the props rather than by the caller, so no screen
 * can accidentally render a `<button>` that navigates.
 */
function BarControl({
  action,
  variant,
  fullWidth,
}: {
  action: BarAction
  variant: 'primary' | 'secondary'
  fullWidth?: boolean
}) {
  if (action.href) {
    return (
      <LinkButton
        href={action.href}
        variant={variant}
        size="lg"
        fullWidth={fullWidth}
        leadingIcon={action.icon}
        className="min-w-0"
      >
        {action.label}
      </LinkButton>
    )
  }

  return (
    <Button
      variant={variant}
      size="lg"
      fullWidth={fullWidth}
      onClick={action.onPress}
      disabled={action.disabled}
      leadingIcon={action.icon}
      className="min-w-0"
    >
      {action.label}
    </Button>
  )
}

export default BottomBar
