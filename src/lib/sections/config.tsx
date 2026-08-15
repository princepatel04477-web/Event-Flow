import { type ReactNode } from 'react'
import {
  UsersIcon,
  PhoneIcon,
  CarIcon,
  BuildingIcon,
  GridIcon,
  GiftIcon,
  ClipboardCheckIcon,
} from '@/components/icons'

export type SectionId = 'dashboard' | 'guests' | 'rsvp' | 'logistics' | 'hospitality' | 'hamper' | 'production'

export type TabAccess = 'admin' | 'event_team' | 'client'

export interface SectionChild {
  segment: string
  label: string
  roles: TabAccess[]
  isDefault?: boolean
}

export interface SectionDef {
  id: SectionId
  label: string
  tabLabel: string
  icon: ReactNode
  roles: TabAccess[]
  children: SectionChild[]
  /** Set when the section is defined but gated behind this feature flag. Flag-off means
   *  the section renders nowhere — no tab, no sidebar entry, no placeholder route. */
  featureFlag?: 'production'
}

export const SECTIONS: Record<SectionId, SectionDef> = {
  dashboard: {
    id: 'dashboard', label: 'Dashboard', tabLabel: 'Board',
    icon: <GridIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team', 'client'],
    children: [],
  },
  guests: {
    id: 'guests', label: 'Guests', tabLabel: 'Guests',
    icon: <UsersIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    children: [
      { segment: 'list', label: 'Guest list', roles: ['admin','event_team','client'], isDefault: true },
      // Import is event_team too, not admin-only. It was admin-only, which is
      // why staff reported the button "missing": a code-auth session is
      // event_team, so the nav entry rendered nowhere for the people actually
      // holding the phones. The preview-before-write step in the wizard is
      // what protects the data here, not the role gate.
      { segment: 'import', label: 'Import', roles: ['admin', 'event_team'] },
      { segment: 'export', label: 'Export', roles: ['admin','event_team'] },
    ],
  },
  rsvp: {
    id: 'rsvp', label: 'RSVP', tabLabel: 'RSVP',
    icon: <PhoneIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    children: [
      { segment: 'queue', label: 'Call queue', roles: ['admin','event_team'], isDefault: true },
      { segment: 'status', label: 'RSVP status', roles: ['admin','event_team'] },
      { segment: 'review', label: 'Review', roles: ['admin','event_team'] },
      { segment: 'unmatched', label: 'Unmatched', roles: ['admin','event_team'] },
    ],
  },
  logistics: {
    id: 'logistics', label: 'Logistics', tabLabel: 'Travel',
    icon: <CarIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    children: [
      { segment: 'arrivals', label: 'Arrivals', roles: ['admin','event_team'], isDefault: true },
      { segment: 'departures', label: 'Departures', roles: ['admin','event_team'] },
      { segment: 'fleet', label: 'Fleet', roles: ['admin','event_team'] },
      { segment: 'trips', label: 'Trips', roles: ['admin','event_team'] },
    ],
  },
  /**
   * Hotel and Hamper are SEPARATE TOP-LEVEL SECTIONS, and that is not a
   * styling preference — it is the only level of this navigation that a
   * person can reach.
   *
   * `children` looks like a sub-navigation and is not one. BottomTabs reads
   * it for exactly one purpose: to pick which screen a tab lands on
   * (`children.find(isDefault)`). Nothing renders a child tab strip — not the
   * bottom bar, not MoreSheet, nothing. So a screen listed as a non-default
   * child of a section is unreachable, no matter what it is labelled.
   *
   * That is why hampers were reported missing while being fully built: they
   * were a child of Hospitality, whose default child is `rooms`, so the tab
   * always landed on rooms and there was no second step to take. Renaming the
   * child "Hamper" changed nothing, because the label was never displayed.
   * CLAUDE.md §12 already warns about this class of bug; this is a second
   * instance of it with a different cause.
   *
   * Promoting Hamper to a section makes it a tab, which is the one thing that
   * is actually navigable. If a real child tab strip is ever built, these two
   * can go back to being one section — until then, one section means one
   * reachable screen.
   */
  hospitality: {
    id: 'hospitality', label: 'Hotel', tabLabel: 'Hotel',
    icon: <BuildingIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    children: [
      { segment: 'rooms', label: 'Stay', roles: ['admin','event_team'], isDefault: true },
      { segment: 'checkin', label: 'Check-in / out', roles: ['admin','event_team'] },
    ],
  },
  hamper: {
    id: 'hamper', label: 'Hamper', tabLabel: 'Hamper',
    icon: <GiftIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    // No children: the section IS the screen, at /{eventCode}/hamper.
    children: [],
  },
  production: {
    id: 'production', label: 'Production', tabLabel: 'Prep',
    icon: <ClipboardCheckIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    children: [],
    featureFlag: 'production',
  },
} as const

/** sectionHome(eventCode, 'rsvp') → '/EVENT/rsvp/queue' (default child) */
export function sectionHome(eventCode: string, section: SectionId): string {
  const def = SECTIONS[section]
  const dc = def.children.find(c => c.isDefault)
  return dc ? `/${eventCode}/${section}/${dc.segment}` : `/${eventCode}/${section}`
}

/** sectionPath(eventCode, 'rsvp', 'queue') → '/EVENT/rsvp/queue' */
export function sectionPath(eventCode: string, section: SectionId, child?: string): string {
  return child ? `/${eventCode}/${section}/${child}` : `/${eventCode}/${section}`
}
