import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface ActionBarProps {
  /** The one primary action of the screen. */
  primary?: ReactNode
  /** A secondary action, visually subordinate. */
  secondary?: ReactNode
  className?: string
}

/**
 * The fixed bottom action area. One primary action per screen, in the thumb
 * zone — a hand is already at the bottom of the phone. Safe-area aware so
 * the gesture bar never eats the button.
 *
 * The bar itself is paper (not a contrasting surface): the ledger has no
 * floating chrome. The action lifts off the paper by being the only filled,
 * ink-toned element in the lower third.
 */
export function ActionBar({ primary, secondary, className }: ActionBarProps) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper pb-safe px-safe',
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[480px] items-center gap-3 px-4 py-3">
        {secondary ? <div className="shrink-0">{secondary}</div> : null}
        {primary ? <div className="min-w-0 flex-1">{primary}</div> : null}
      </div>
    </div>
  )
}

export default ActionBar
