import {
  SECTIONS,
  type NavTab,
  type SectionChild,
  type SectionId,
  type TabAccess,
  childHref,
  visibleChildren,
} from './config'
import type { StaffDepartment } from '@/lib/departments'
import { sectionAllowedForDepartment } from '@/lib/departments'

/**
 * The v3 bottom bar: **Today · Calls · Rooms · Hampers · Travel**.
 *
 * WHY THIS IS NOT IN `config.tsx`. That module is shared with the v1 shell
 * (`(staff)/[eventCode]/layout.tsx` → `BottomTabs`), and its five tabs —
 * Home, Guests, Calls, Travel, Rooms — are pinned by `tests/nav-model.test.ts`
 * and `tests/v2-route-parity.test.ts` as v1's contract. v3 changes the SET,
 * the ORDER and two destinations, so the two models cannot share one
 * function without one of them becoming wrong. They DO share everything
 * underneath: the same `SECTIONS` table, the same role/department/flag
 * predicates, and the same `hidden` rule for a borrowed child.
 *
 * WHAT CHANGED FROM v2 AND WHY
 * ----------------------------
 * - `Guests` leaves the bar. It is reached through the search button in
 *   every `ScreenHeader` (see SPEC-V3 §3), which is also where a runner
 *   looks for a person. That frees the fifth slot.
 * - `Hampers` takes it, as a TAB rather than a borrowed child of Rooms.
 *   A hamper runner's whole job was one level down behind a Rooms tab they
 *   could not open — the tab is now named for the work.
 * - `Travel` moves above `Rooms`, so the bar reads in the order of the
 *   event: who is coming, where they sleep, what they get, how they leave.
 *
 * WHAT DID NOT CHANGE: who may see what. `management` sees all five; a
 * runner sees their own section's screens and nothing else; a department
 * whose section is a single screen (Hampers, Setup) gets no bar at all,
 * because one screen does not need navigation.
 */

/** A tab id is the section it belongs to. There is no second namespace. */
export type V3TabId = SectionId

export interface V3Tab extends NavTab {
  sectionId: SectionId
}

/**
 * Bar order. Any section not listed here never appears in the v3 bar —
 * including `guests`, which is the point of the whole redesign.
 */
const V3_BAR: readonly SectionId[] = [
  'dashboard',
  'rsvp',
  'hospitality',
  'hamper',
  'logistics',
]

/** What a section is called in the v3 bar. */
const V3_TAB_LABEL: Partial<Record<SectionId, string>> = {
  dashboard: 'Today',
  rsvp: 'Calls',
  hospitality: 'Rooms',
  hamper: 'Hampers',
  logistics: 'Travel',
}

/**
 * The href a section's own tab points at.
 *
 * `sectionRoot`, not `sectionHome` — the v3 bar lands on the section's
 * front door, not on one of its children. v2 sent Calls to `rsvp/queue` via
 * a special-case remap (`tabHrefFor`) because its Calls tab had to open the
 * call-next screen; here the whole section has one intended first screen
 * per viewer, and picking a child for them is how a tab ends up somewhere
 * the viewer did not ask for.
 */
function v3Href(eventCode: string, section: SectionId): string {
  const path = SECTIONS[section].path ?? section
  return path ? `/${eventCode}/${path}` : `/${eventCode}`
}

/** A tab the viewer may see, or null. */
function v3SectionTab(
  eventCode: string,
  section: SectionId,
  access: TabAccess,
  department: StaffDepartment | null,
): V3Tab | null {
  // The section-level department gate, FIRST. `visibleChildren` below filters
  // the children of a section the viewer may open; it has never filtered the
  // SECTION itself, and `requireSection` gates the section. Without this line a
  // name-skipping team session (`department === null`) was handed all five tabs
  // while only `dashboard` was open to it, so four taps bounced straight back
  // with `?denied=section` — live-looking controls that cannot work
  // (`docs/BUGS.md` M1). Management passes for every section and an admin is
  // exempt outright, so this only ever removes a tab that would bounce.
  if (access !== 'admin' && !sectionAllowedForDepartment(section, department)) return null

  // `visibleChildren` is reused rather than re-derived: it already encodes
  // the role check AND the department check for a borrowed child, and the
  // departments in question are only ever a subset of the parent's.
  const children = visibleChildren(SECTIONS[section], access, department)
  if (SECTIONS[section].children.length > 0 && children.length === 0) return null

  const label = V3_TAB_LABEL[section]
  if (!label) return null

  return {
    key: section,
    href: v3Href(eventCode, section),
    label,
    icon: SECTIONS[section].icon,
    sectionId: section,
    childSegment: null,
  }
}

/**
 * The v3 bottom bar for this viewer.
 *
 * Three shapes, same as v2:
 *
 * - A client gets nothing. They have one screen.
 * - An event lead (or an admin) gets the five sections they are allowed,
 *   in `V3_BAR` order.
 * - A runner gets their own section's screens as tabs. Two or more screens
 *   earns a bar; one screen does not.
 *
 * A TEAM SESSION WITH NO PICKED NAME IS NOT A LEAD. It used to be treated as
 * one (`department === null` was in `isLead`), which handed it five tabs while
 * `sectionAllowedForDepartment` admits it to `dashboard` alone — four taps that
 * only bounce back. It now falls through to the section filter and gets Today
 * alone, which is what v1 renders for the same session and the one screen it can
 * actually open (`docs/BUGS.md` M1).
 */
export function v3TabsFor(
  eventCode: string,
  access: TabAccess,
  department: StaffDepartment | null,
): V3Tab[] {
  if (access === 'client') return []

  const isLead = access === 'admin' || department === 'management'

  if (!isLead && department) {
    // A runner's bar is their section's real screens. `sectionAllowedForDepartment`
    // reads `DEPARTMENT_SECTIONS`, which is the same table `requireSection`
    // gates on — so a tab this function emits is a tab the page guard will
    // actually admit. `visibleChildren` then applies the role and
    // borrowed-child filters on top.
    const own = V3_BAR.map((id) => SECTIONS[id]).find(
      (section) =>
        sectionAllowedForDepartment(section.id, department) &&
        visibleChildren(section, access, department).length > 1,
    )
    if (!own) return []

    const kids = visibleChildren(own, access, department)

    return kids.map((child) => ({
      key: `${own.id}:${child.segment}`,
      href: childHref(eventCode, own.id, child),
      label: child.label,
      icon: child.icon,
      sectionId: own.id,
      childSegment: child.segment,
    }))
  }

  return V3_BAR.map((id) => v3SectionTab(eventCode, id, access, department)).filter(
    (tab): tab is V3Tab => tab !== null,
  )
}

/**
 * Which v3 tab a path belongs to, for highlighting.
 *
 * `rest` is the pathname with the event code stripped:
 * `/SHARMA26/logistics/arrivals` → `logistics/arrivals`.
 *
 * A BORROWED CHILD RESOLVES TO ITS HOST (`/{event}/hamper` → `hospitality`),
 * exactly as `resolveActive` does, and for the same reason: without it the
 * Rooms tab goes dark on a screen reached from it and the strip that leads
 * back out renders nothing.
 *
 * UNLIKE `resolveActive`, a section that is no longer IN the v3 bar
 * (`guests`) still resolves to itself. The header uses this answer to title
 * the screen, and a guest list reached from search is still "Guests" even
 * though nothing in the bar is lit.
 */
export function v3ActiveSection(rest: string): SectionId | null {
  const segment = rest.split('/').filter(Boolean)[0]
  if (!segment) return 'dashboard'

  // A real section id wins outright. In v3 that includes `hamper`, which is
  // now its own tab — the borrowed-child hop below would resolve it to
  // `hospitality` (as the v2 nav model does) and light the wrong tab.
  if (segment in SECTIONS) return segment as SectionId

  // Only for a section that is still borrowed: `/{event}/production` is
  // shown as a child of Rooms, so Rooms has to light.
  for (const section of Object.values(SECTIONS)) {
    for (const child of section.children) {
      if (child.href && child.href === segment) return section.id
    }
  }

  return null
}

/**
 * The child segment a path sits in, for a runner's child tabs.
 *
 * A runner's bar is four tabs inside one section, so `sectionId` alone lights
 * all four at once — the child has to match too. Returns null on a section
 * root (`/EVENT/logistics`), which is not a screen any tab points at.
 */
export function v3ActiveChild(rest: string): string | null {
  const segments = rest.split('/').filter(Boolean)
  return segments[1] ?? null
}

/**
 * The label for a screen's header, derived from the shared section table
 * rather than from a second list of names.
 *
 * `/{event}/hospitality/deliveries` has no matching child in
 * `SECTIONS.hospitality` (its children are `rooms`, `checkin`, and the
 * borrowed `hamper` / `production`), so without the override map the one
 * screen in Rooms that is not about rooms would title itself "Rooms".
 */
const V3_TITLE_OVERRIDES: Record<string, string> = {
  'hospitality/deliveries': 'Hampers',
  help: 'Help',
}

export function v3ScreenTitle(rest: string): string {
  const segments = rest.split('/').filter(Boolean)
  if (segments.length === 0) return 'Today'

  // Keyed on the first two segments, NOT the whole path: a detail route
  // (`hospitality/deliveries/abc-123`) resolves to the same section and child
  // as its list, and a whole-path key would miss the moment an id followed.
  // A one-segment path slices to itself, so `help` is covered by the same
  // lookup.
  const override = V3_TITLE_OVERRIDES[segments.slice(0, 2).join('/')]
  if (override) return override

  const sectionId = v3ActiveSection(rest)
  if (!sectionId) return 'EventFlow'

  if (segments.length > 1) {
    const child: SectionChild | undefined = SECTIONS[sectionId].children.find(
      (c) => c.segment === segments[1],
    )
    if (child) return child.label
  }

  // A detail screen (…/rooms/abc-123) keeps its section's name: "Rooms" is
  // the right header for a single room, and the record's own identity is the
  // first thing in the body.
  return V3_TAB_LABEL[sectionId] ?? SECTIONS[sectionId].label
}
