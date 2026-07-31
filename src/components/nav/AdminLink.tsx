import Link from 'next/link'

import { SlidersIcon } from '@/components/icons'

export interface AdminLinkProps {
  /**
   * Render only for an admin. Passed in rather than resolved here so this
   * stays a dumb presentational component and the caller — always a server
   * component that already holds the viewer — owns the single source of truth.
   */
  show: boolean
}

/**
 * The only way into /admin/events.
 *
 * Without it that route is reachable by typing the URL and nothing else:
 * `/admin` is a static segment that Next resolves ahead of `/[eventCode]`,
 * BottomTabs has no admin entry, and the event switcher only lists events.
 * On a fresh database the one person who can create the first event would
 * otherwise have to guess where the form lives.
 *
 * Not a tab: it is not event-scoped, and it would be the only item in the bar
 * that leaves the event.
 */
export function AdminLink({ show }: AdminLinkProps) {
  if (!show) return null

  return (
    <Link
      href="/admin/events"
      aria-label="Admin"
      title="Admin"
      className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg"
    >
      <SlidersIcon className="h-5 w-5" />
    </Link>
  )
}

export default AdminLink
