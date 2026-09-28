'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { EVENT_NAV } from '@/lib/admin/nav'

/** Screens under /admin/events/{code}/ that EVENT_NAV does not list. */
const EXTRA_LABELS: Record<string, string> = {
  staff: 'Staff',
  'import-hotels': 'Import hotels',
}

/**
 * Where an admin screen sits, and where its back link goes.
 *
 * Pure, so the header's one decision is testable without a router. Paths:
 * - `/admin/events/{code}/{tool}`       → back to the event's Control tab
 * - `/admin/events/{code}/{tool}/…`     → back to that tool's first screen
 * - `/admin/events/{code}`              → back to Control
 * - `/admin/events`                     → "All events", back to the app
 * - anything else under /admin          → back to the app
 */
export function adminHeaderFor(pathname: string): { title: string; backHref: string; backLabel: string } {
  const seg = pathname.split('/').filter(Boolean) // ['admin', 'events', code?, tool?, ...]
  if (seg[1] === 'events' && seg[2]) {
    const code = seg[2]
    const tool = seg[3]
    if (!tool) return { title: 'Dashboard', backHref: `/${code}/control`, backLabel: 'Control' }
    const label = EVENT_NAV.find((i) => i.href === tool)?.label ?? EXTRA_LABELS[tool] ?? 'Control'
    if (seg.length > 4) {
      return { title: label, backHref: `/admin/events/${code}/${tool}`, backLabel: label }
    }
    return { title: label, backHref: `/${code}/control`, backLabel: 'Control' }
  }
  if (seg[1] === 'events') return { title: 'All events', backHref: '/', backLabel: 'Today' }
  if (seg[1] === 'harvest-debug') return { title: 'Developer tools', backHref: '/', backLabel: 'Today' }
  return { title: 'Admin', backHref: '/', backLabel: 'Today' }
}

/**
 * The header over every admin screen.
 *
 * UI4 Part S: on a phone the admin tools are Control's screens, not a second
 * app. The header therefore names the TOOL ("Access codes") and its back link
 * goes to the event's Control tab — where the admin came from — instead of the
 * old fixed "Admin" title with a back link labelled "App".
 */
export function AdminHeader({ context, actions }: { context: string; actions?: ReactNode }) {
  const pathname = usePathname()
  const { title, backHref, backLabel } = adminHeaderFor(pathname)
  return (
    <ScreenHeader
      title={title}
      context={context}
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
