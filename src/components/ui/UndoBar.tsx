'use client'

import { useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/Button'
import {
  commitPendingUndo,
  extendPendingUndo,
  getUndoServerSnapshot,
  getUndoSnapshot,
  subscribeUndo,
  undoPendingUndo,
} from '@/lib/mutate/undo-store'

/**
 * "Sharma family · Confirmed" [Undo] — the undo window for a write that has
 * already taken effect.
 *
 * The rule it implements is docs/UX-RULES.md R5: undo, do not confirm. A
 * reversible action applies the moment it is tapped and offers a way back for
 * seven seconds, instead of stopping the user with a dialog to ask whether they
 * are sure. A dialog on every routine assignment is how a runner learns to tap
 * through dialogs without reading them, which is worse than having none.
 *
 * POSITION. It sits ABOVE the tab bar, not on it, using the existing
 * `bottom-nav` utility — the same offset the sticky action bars use, which
 * already accounts for the gesture bar and the on-screen keyboard. Without it
 * the bar would render underneath the tab bar and the Undo control would be
 * unreachable, which on a screen whose whole point is a way back would be a
 * cruel joke.
 *
 * LIGHT GROUND. Surface + hairline + `shadow-e3`, not a dark toast. This app has
 * no dark surfaces; a black bar would be the only one, and it would read as an
 * error rather than an offer.
 *
 * There is exactly one of these, backed by the module store in
 * `src/lib/mutate/undo-store.ts`. See that file for why "one at a time" is
 * enforced there rather than per screen.
 */
export function UndoBar() {
  const pending = useSyncExternalStore(subscribeUndo, getUndoSnapshot, getUndoServerSnapshot)

  return (
    // THE LIVE REGION IS PERSISTENT, and that is the point. Rendering it only
    // when something is pending inserts a region that already contains its text,
    // which screen readers commonly do not announce — the reliable pattern is a
    // region that is present and whose CONTENT changes.
    <div
      className="fixed inset-x-0 bottom-nav z-50 px-safe"
      role="status"
      aria-live="polite"
    >
      {pending ? (
        <div className="mx-auto w-full max-w-[480px] px-4 pb-2">
          <div
            className="flex items-center gap-2 rounded-xl border border-rule-strong bg-surface py-1.5 pl-4 pr-1.5 shadow-e3"
            // Hold the window open while the user is actually dealing with it.
            // Without this the offer can expire mid-interaction, and for a screen
            // reader user the seven seconds are spent before they reach it
            // (WCAG 2.2.1).
            onPointerEnter={extendPendingUndo}
            onPointerDown={extendPendingUndo}
            onFocus={extendPendingUndo}
          >
            {/* The message area is itself the "keep it" control: tapping the bar
                dismisses it and lets the write stand, which is the non-destructive
                of the two choices and therefore the one that gets the bigger
                target. */}
            <button
              type="button"
              onClick={commitPendingUndo}
              className="tap min-h-11 min-w-0 flex-1 text-left"
              aria-label={`Keep: ${pending.message}`}
            >
              <span className="block truncate text-sm font-medium text-ink">
                {pending.message}
              </span>
            </button>
            <Button
              size="md"
              variant="secondary"
              onClick={undoPendingUndo}
              className="shrink-0"
            >
              Undo
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default UndoBar
