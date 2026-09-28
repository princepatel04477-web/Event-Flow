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

