'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { EventPill } from '@/components/nav/EventPill'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import type { Membership } from '@/lib/events/paths'
import { adminHeaderFor } from '@/lib/admin/header'

export { adminHeaderFor }

/**
 * The header over every admin screen.
 *
 * UI4 Part S: on a phone the admin tools are Control's screens, not a second
 * app. The header therefore names the TOOL ("Access codes") and its back link
 * goes to the event's Control tab — where the admin came from — instead of the
 * old fixed "Admin" title with a back link labelled "App".
 */
export function AdminHeader({
  context,
  actions,
  memberships,
}: {
  context: string
  actions?: ReactNode
  memberships: Membership[]
}) {
  const pathname = usePathname()
  const { title, backHref, backLabel } = adminHeaderFor(pathname)
  // On an event's admin screen, the same event pill the event app shows —
  // the admin must never lose sight of which wedding they are editing.
  const seg = pathname.split('/').filter(Boolean)
  const current = seg[1] === 'events' && seg[2] ? memberships.find((m) => m.eventCode === seg[2]) : undefined
  return (
    <ScreenHeader
      title={title}
      context={context}
      eyebrow={
        current ? (
          <EventPill
            event={{ code: current.eventCode, name: current.eventName }}
            memberships={memberships}
            isAdmin
          />
        ) : undefined
      }
      backHref={backHref}
      backLabel={backLabel}
      // Admin has no Find (ScreenHeader would derive `/admin/find`, which does
      // not exist) — switched off rather than left pointing at a 404.
      search={false}
      actions={actions}
    />
  )
}

export default AdminHeader
