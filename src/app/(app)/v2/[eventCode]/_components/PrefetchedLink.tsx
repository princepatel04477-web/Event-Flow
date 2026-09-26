'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { pressHandlers } from '@/components/ui/press'
import { useBoundedPrefetch } from '@/lib/query/prefetch'
import { cn } from '@/lib/utils'

/**
 * A list-row link that warms its destination on TOUCH (G2).
 *
 * WHY IT EXISTS AS A COMPONENT. `useBoundedPrefetch` is a hook, and the rows it
 * belongs on are rendered by a SERVER component (Today's "Needs attention"
 * list), so the arming has to live in a client component the server can render.
 * This is that component, and it carries the row's press feedback too, so the
 * `pressable` class and the prefetch arming stay in one handler rather than two
 * wrappers fighting over `pointerdown`.
 *
 * WHY THE TAB BAR ALREADY HAD THIS AND LIST ROWS DID NOT. `AppTabs` arms on
 * pointerdown and touchstart already. The guest list deliberately does NOT —
 * its destination is `rsvp/status/[groupId]`, which claims the 15-minute caller
 * lock on render, and there is no manual override for a lock (CLAUDE.md §11b).
 * The call queue's rows do not navigate at all; they select in place. So the
 * rows this belongs on are the ones that are both LISTED and SAFE, which is
 * Today's attention list, whose destinations are section roots.
 *
 * The blocklist is enforced in the hook's header, not here — read it before
 * pointing this at a new list.
 */
export function PrefetchedLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  const { isArmed, arm } = useBoundedPrefetch()
  const handlers = pressHandlers()

  return (
    <Link
      href={href}
      // `true`, not the default: the default is a PARTIAL prefetch that stops at
      // the nearest loading.tsx, which warms the skeleton and leaves the tap
      // waiting. See the hook's header.
      prefetch={isArmed(href) ? true : undefined}
      className={cn('pressable', className)}
      onPointerDown={(event) => {
        arm(href)
        handlers.onPointerDown(event)
      }}
      onTouchStart={() => arm(href)}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onPointerLeave={handlers.onPointerLeave}
    >
      {children}
    </Link>
  )
}

export default PrefetchedLink
