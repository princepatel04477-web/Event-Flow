'use client'

import { useLinkStatus } from 'next/link'

import { cn } from '@/lib/utils'

/**
 * The in-progress mark for a link that has just been tapped.
 *
 * WHY. Next paints the OLD screen until the destination commits. On a 3G-ish
 * venue link that is a second or more of "nothing happened", and the runner
 * taps again — the exact behaviour T1 exists to prevent. `useLinkStatus()`
 * reports when the enclosing `<Link>`'s navigation is pending, so this dot is
 * lit from the tap until the destination takes over.
 *
 * It carries NO text: it is an acknowledgement, not a message. It is
 * `aria-hidden` because the navigation itself is already announced by the
 * destination; a screen reader does not need "loading" on top of it.
 *
 * MUST BE RENDERED INSIDE A `<Link>`. Outside one, `useLinkStatus` reads the
 * default context and `pending` is permanently false (Next's behaviour, not a
 * bug here) — the dot simply never appears.
 *
 * The appearance is CSS (`.pending-dot` in `src/app/globals.css`): opacity
 * only, reserved space always, so it can never shift the row it lives in.
 */
export function PendingDot({ className }: { className?: string }) {
  const { pending } = useLinkStatus()

  return (
    <span
      aria-hidden
      data-pending={pending ? '' : undefined}
      className={cn('pending-dot', className)}
    />
  )
}

export default PendingDot
