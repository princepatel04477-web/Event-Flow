import { type ReactNode } from 'react'
import {
  UsersIcon,
  PhoneIcon,
  CarIcon,
  BuildingIcon,
  GridIcon,
} from '@/components/icons'

export type SectionId = 'dashboard' | 'guests' | 'rsvp' | 'logistics' | 'hospitality'

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
      { segment: 'import', label: 'Import', roles: ['admin'] },
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
    id: 'logistics', label: 'Logistics', tabLabel: 'Logistics',
    icon: <CarIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    children: [
      { segment: 'arrivals', label: 'Arrivals', roles: ['admin','event_team'], isDefault: true },
      { segment: 'departures', label: 'Departures', roles: ['admin','event_team'] },
      { segment: 'fleet', label: 'Fleet', roles: ['admin','event_team'] },
      { segment: 'trips', label: 'Trips', roles: ['admin','event_team'] },
    ],
  },
  hospitality: {
    id: 'hospitality', label: 'Hospitality', tabLabel: 'Hospitality',
    icon: <BuildingIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    children: [
      { segment: 'rooms', label: 'Rooms', roles: ['admin','event_team'], isDefault: true },
      { segment: 'checkin', label: 'Check-in', roles: ['admin','event_team'] },
      { segment: 'deliveries', label: 'Deliveries', roles: ['admin','event_team'] },
    ],
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
