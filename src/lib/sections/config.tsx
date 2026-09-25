import { type ReactNode } from 'react'
import {
  UsersIcon,
  PhoneIcon,
  CarIcon,
  BuildingIcon,
  GridIcon,
  GiftIcon,
  ClipboardCheckIcon,
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  MapPinIcon,
  ListIcon,
  FileTextIcon,
  UploadIcon,
  DownloadIcon,
} from '@/components/icons'
import { type StaffDepartment } from '@/lib/departments'

export type SectionId = 'dashboard' | 'guests' | 'rsvp' | 'logistics' | 'hospitality' | 'hamper' | 'production'

export type TabAccess = 'admin' | 'event_team' | 'client'

export interface SectionChild {
  segment: string
  label: string
  icon: ReactNode
  roles: TabAccess[]
  isDefault?: boolean
  /**
   * Absolute path, when the screen does NOT live under its parent section's
   * URL. Hampers and Setup are reachable as children of Rooms but their routes
   * are `/{event}/hamper` and `/{event}/production` — moving those folders to
   * sit under `hospitality/` would churn every link and bookmark for a purely
   * presentational grouping, so the nav points at them where they already are.
   */
  href?: string
  /**
   * Departments permitted to see this child, when it is narrower than the
   * parent section. Omitted means "same as the parent".
   *
   * Load-bearing for the borrowed children above: `requireSection` gates on
   * `sectionAllowedForDepartment`, and a Rooms runner is NOT allowed into the
   * `hamper` section. Showing them a Hampers tab would render a tab that
   * bounces them to `?denied=section` — a visible control that cannot work.
   */
  departments?: StaffDepartment[]
}

export interface SectionDef {
  id: SectionId
  label: string
  tabLabel: string
  icon: ReactNode
  roles: TabAccess[]
  /** Departments that may see this section (management always sees all). */
  departments: StaffDepartment[]
  /**
   * The section's own route under the event, when it is not the section id.
   * Home is the event root (`/{event}`), not `/{event}/dashboard` — that path
   * was a second copy of this screen and is now a redirect, so pointing the
   * tab at it would cost every visit a round trip.
   */
  path?: string
  children: SectionChild[]
  /**
   * False for a section that is reachable only as a borrowed child of another
   * section (see `SectionChild.href`). It is still a real section with a real
   * route and its own department home — it just does not take a slot in the
   * bottom bar, because five slots is the whole budget.
   */
  inTabBar: boolean
  /** Set when the section is defined but gated behind this feature flag. Flag-off means
   *  the section renders nowhere — no tab, no sidebar entry, no placeholder route. */
  featureFlag?: 'production'
}

const ALL_DEPTS: StaffDepartment[] = [
  'management',
  'logistics',
  'hospitality',
  'hamper',
  'production',
]

/**
 * Five tabs, and every screen two taps away.
 *
 * The bottom bar had seven entries for an event lead, which is past what the
 * bar can lay out — the `truncate` on the label was already load-bearing at
 * five. Hamper and Setup move into Hospitality as borrowed children rather than
 * losing their routes, which is only safe now that `SectionTabs` renders a
 * second level; before it existed, a non-default child was unreachable and
 * promoting Hamper to a section was the only way to get to it.
 */
export const SECTIONS: Record<SectionId, SectionDef> = {
  dashboard: {
    id: 'dashboard', label: 'Home', tabLabel: 'Home',
    icon: <GridIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team', 'client'],
    departments: ALL_DEPTS,
    path: '',
    inTabBar: true,
    children: [],
  },
  guests: {
    id: 'guests', label: 'Guests', tabLabel: 'Guests',
    icon: <UsersIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    departments: ['management'],
    inTabBar: true,
    children: [
      { segment: 'list', label: 'Guest list', icon: <UsersIcon className="h-6 w-6" />, roles: ['admin','event_team','client'], isDefault: true },
      // Import is event_team too, not admin-only. It was admin-only, which is
      // why staff reported the button "missing": a code-auth session is
      // event_team, so the nav entry rendered nowhere for the people actually
      // holding the phones. The preview-before-write step in the wizard is
      // what protects the data here, not the role gate.
      { segment: 'import', label: 'Import', icon: <UploadIcon className="h-6 w-6" />, roles: ['admin', 'event_team'] },
      { segment: 'export', label: 'Export', icon: <DownloadIcon className="h-6 w-6" />, roles: ['admin','event_team'] },
    ],
  },
  rsvp: {
    id: 'rsvp', label: 'RSVP calls', tabLabel: 'Calls',
    icon: <PhoneIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    departments: ['management'],
    inTabBar: true,
    children: [
      { segment: 'campaigns', label: 'Auto-call', icon: <PhoneIcon className="h-6 w-6" />, roles: ['admin','event_team'], isDefault: true },
      { segment: 'queue', label: 'Call list', icon: <ListIcon className="h-6 w-6" />, roles: ['admin','event_team'] },
      { segment: 'review', label: 'Call notes', icon: <FileTextIcon className="h-6 w-6" />, roles: ['admin','event_team'] },
    ],
  },
  logistics: {
    id: 'logistics', label: 'Logistics', tabLabel: 'Logistics',
    icon: <CarIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    departments: ['management', 'logistics'],
    inTabBar: true,
    children: [
      { segment: 'arrivals', label: 'Arrivals', icon: <ArrowDownCircleIcon className="h-6 w-6" />, roles: ['admin','event_team'], isDefault: true },
      { segment: 'departures', label: 'Departures', icon: <ArrowUpCircleIcon className="h-6 w-6" />, roles: ['admin','event_team'] },
      { segment: 'fleet', label: 'Fleet', icon: <CarIcon className="h-6 w-6" />, roles: ['admin','event_team'] },
      { segment: 'trips', label: 'Trips', icon: <MapPinIcon className="h-6 w-6" />, roles: ['admin','event_team'] },
    ],
  },
  hospitality: {
    id: 'hospitality', label: 'Hospitality', tabLabel: 'Hospitality',
    icon: <BuildingIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    departments: ['management', 'hospitality'],
    inTabBar: true,
    children: [
      { segment: 'rooms', label: 'Hospitality', icon: <BuildingIcon className="h-6 w-6" />, roles: ['admin','event_team'], isDefault: true },
      { segment: 'checkin', label: 'Check in / out', icon: <ClipboardCheckIcon className="h-6 w-6" />, roles: ['admin','event_team'] },
      // ADMIN ONLY, DELIBERATELY. Every row of this sheet is a door out of the
      // section — the family head opens RSVP status, the hamper opens the hamper
      // proof — and an `event_team` hospitality runner belongs to neither. Marked
      // `['admin']` it renders only for an admin, so nothing on it is a control
      // that bounces. A code-auth session is `event_team`, which means the people
      // on the phones do NOT see this child; that is the intended audience, and
      // the page guard repeats the same check so a typed URL cannot reach it.
      { segment: 'rooming-list', label: 'Rooming list', icon: <ListIcon className="h-6 w-6" />, roles: ['admin'] },
      // Borrowed: lives at /{event}/hamper, shown here so an event lead does
      // not need a sixth tab to reach it.
      {
        segment: 'hamper', label: 'Hampers', icon: <GiftIcon className="h-6 w-6" />,
        roles: ['admin','event_team'], href: 'hamper',
        departments: ['management', 'hamper'],
      },
      // Borrowed likewise, and flag-gated by the `production` section below.
      {
        segment: 'production', label: 'Setup', icon: <ClipboardCheckIcon className="h-6 w-6" />,
        roles: ['admin','event_team'], href: 'production',
        departments: ['management', 'production'],
      },
    ],
  },
  hamper: {
    id: 'hamper', label: 'Hampers', tabLabel: 'Hampers',
    icon: <GiftIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    departments: ['management', 'hamper'],
    // Reached as a child of Rooms for an event lead, and as their whole app
    // for the hamper team. Either way it is one screen at /{event}/hamper.
    inTabBar: false,
    children: [],
  },
  production: {
    id: 'production', label: 'Setup', tabLabel: 'Setup',
    icon: <ClipboardCheckIcon className="h-6 w-6" />,
    roles: ['admin', 'event_team'],
    departments: ['management', 'production'],
    inTabBar: false,
    children: [],
    featureFlag: 'production',
  },
} as const

/** The section's own route: '/EVENT/rsvp', or '/EVENT' for Home. */
export function sectionRoot(eventCode: string, section: SectionId): string {
  const path = SECTIONS[section].path ?? section
  return path ? `/${eventCode}/${path}` : `/${eventCode}`
}

/** sectionHome(eventCode, 'rsvp') → '/EVENT/rsvp/campaigns' (default child) */
export function sectionHome(eventCode: string, section: SectionId): string {
  const dc = SECTIONS[section].children.find(c => c.isDefault)
  return dc ? childHref(eventCode, section, dc) : sectionRoot(eventCode, section)
}

/** sectionPath(eventCode, 'rsvp', 'queue') → '/EVENT/rsvp/queue' */
export function sectionPath(eventCode: string, section: SectionId, child?: string): string {
  return child ? `/${eventCode}/${section}/${child}` : sectionRoot(eventCode, section)
}

/** Where a child actually points — its own route when it is borrowed. */
export function childHref(eventCode: string, section: SectionId, child: SectionChild): string {
  return child.href
    ? `/${eventCode}/${child.href}`
    : `/${eventCode}/${section}/${child.segment}`
}

// ---------------------------------------------------------------------------
// The nav model
//
// One function decides what the bottom bar is, and the layout and the bar both
// read it. Splitting that decision across the two is how the bar ended up
// rendering a Home tab that redirected straight back off itself, and how the
// page kept `pb-nav` clearance for a bar that was not there.
// ---------------------------------------------------------------------------

export interface NavTab {
  key: string
  href: string
  label: string
  icon: ReactNode
  /** The section this tab belongs to. */
  sectionId: SectionId
  /** Set on a runner's child tab; null on a section tab. */
  childSegment: string | null
}

/**
 * Which section and child the current path belongs to, for nav highlighting.
 *
 * `rest` is the pathname with the event code stripped:
 * `/SHARMA26/logistics/arrivals` → `logistics/arrivals`.
 *
 * A borrowed child is why this is not just `rest.split('/')`. `/EVENT/hamper`
 * starts with `hamper`, which IS a real section id — but for navigation it has
 * to resolve to Rooms, or the Rooms tab goes dark and the strip that would
 * lead back out renders nothing. That is a screen you can reach and not
 * leave (R3).
 */
export function resolveActive(rest: string): { sectionId: SectionId | null; childSegment: string | null } {
  const segments = rest.split('/').filter(Boolean)
  if (segments.length === 0) return { sectionId: 'dashboard', childSegment: null }

  // Borrowed children first: their href shadows a real section id.
  for (const section of Object.values(SECTIONS)) {
    for (const child of section.children) {
      if (!child.href) continue
      if (segments[0] === child.href) {
        return { sectionId: section.id, childSegment: child.segment }
      }
    }
  }

  const sectionId = (segments[0] in SECTIONS ? segments[0] : null) as SectionId | null
  return { sectionId, childSegment: segments[1] ?? null }
}

function flagOk(s: SectionDef, access: TabAccess, department: StaffDepartment | null): boolean {
  if (!s.featureFlag) return true
  if (s.featureFlag === 'production') {
    return access === 'admin' || department === 'management' || department === 'production'
  }
  return false
}

function roleOk(s: SectionDef, access: TabAccess): boolean {
  return s.roles.includes(access)
}

function deptOk(s: SectionDef, access: TabAccess, department: StaffDepartment | null): boolean {
  if (access === 'admin' || access === 'client') return true
  if (!department) return s.id === 'dashboard'
  if (department === 'management') return true
  return s.departments.includes(department)
}

/** Children of a section this viewer may actually open. */
export function visibleChildren(
  section: SectionDef,
  access: TabAccess,
  department: StaffDepartment | null,
): SectionChild[] {
  return section.children.filter((c) => {
    if (!c.roles.includes(access)) return false
    // A borrowed child carries its own department list, because the section it
    // really belongs to has a different one.
    if (c.departments && access !== 'admin' && department !== 'management') {
      if (!department || !c.departments.includes(department)) return false
    }
    if (c.segment === 'production' && !flagOk(SECTIONS.production, access, department)) return false
    return true
  })
}

/**
 * The bottom bar, for this viewer.
 *
 * Three shapes, because there are three kinds of user:
 *
 * - A client gets nothing. They have one screen.
 * - An event lead (or admin) gets the five sections.
 * - A runner on a single department gets THEIR SECTION'S SCREENS as the bar.
 *   They used to get `[Home] [Logistics]`, where Home redirected to Logistics — a
 *   two-tab bar with one working tab. Their four real screens sat in the strip
 *   above it instead. Promoting those to the bar means every tab a runner has
 *   is a place they actually work.
 * - A runner whose section is a single screen (Hampers, Setup) gets no bar at
 *   all. One screen does not need navigation.
 */
export function bottomTabsFor(
  eventCode: string,
  access: TabAccess,
  department: StaffDepartment | null,
): NavTab[] {
  if (access === 'client') return []

  const isLead = access === 'admin' || department === 'management'

  if (!isLead && department) {
    // The one section this runner works in — dashboard is not it.
    const own = Object.values(SECTIONS).find(
      (s) => s.id !== 'dashboard'
        && flagOk(s, access, department)
        && roleOk(s, access)
        && deptOk(s, access, department),
    )
    if (!own) return []

    const kids = visibleChildren(own, access, department)
    if (kids.length < 2) return []

    return kids.map((c) => ({
      key: `${own.id}:${c.segment}`,
      href: childHref(eventCode, own.id, c),
      label: c.label,
      icon: c.icon,
      sectionId: own.id,
      childSegment: c.segment,
    }))
  }

  return Object.values(SECTIONS)
    .filter((s) => s.inTabBar && flagOk(s, access, department) && roleOk(s, access) && deptOk(s, access, department))
    .map((s) => ({
      key: s.id,
      href: sectionHome(eventCode, s.id),
      label: s.tabLabel,
      icon: s.icon,
      sectionId: s.id,
      childSegment: null,
    }))
}

/**
 * True when the bottom bar is already showing this viewer's child screens, so
 * the second-level strip would repeat it.
 */
export function childrenAreInBottomBar(
  access: TabAccess,
  department: StaffDepartment | null,
): boolean {
  if (access === 'client' || access === 'admin') return false
  return department !== null && department !== 'management'
}
