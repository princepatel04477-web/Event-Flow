import { type ReactNode } from 'react'
import {
  UsersIcon,
  PhoneIcon,
  CarIcon,
  BuildingIcon,
  GridIcon,
  ClipboardCheckIcon,
} from '@/components/icons'

export type SectionId = 'dashboard' | 'guests' | 'rsvp' | 'logistics' | 'hospitality' | 'production'

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
   * Hospitality is the one section for everything that happens to a guest
   * once they are on the ground: what they receive, where they sleep, and
   * whether they are currently in the building.
   *
   * The tab used to read "Stay", which is now the name of a child — a parent
   * and one of its children sharing a name is how a person concludes the
   * other two screens live somewhere else. `rooms` stays the default landing
   * screen because it is the section's largest surface; the child order
   * follows the order they were asked for.
   */
  hospitality: {
    id: 'hospitality', label: 'Hospitality', tabLabel: 'Hospitality',
    icon: <BuildingIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    children: [
      { segment: 'deliveries', label: 'Hamper', roles: ['admin','event_team'] },
      { segment: 'rooms', label: 'Stay', roles: ['admin','event_team'], isDefault: true },
      { segment: 'checkin', label: 'Check-in / out', roles: ['admin','event_team'] },
    ],
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
