import { describe, it, expect } from 'vitest'

import {
  SECTIONS,
  bottomTabsFor,
  childrenAreInBottomBar,
  resolveActive,
  visibleChildren,
  type NavTab,
} from '@/lib/sections/config'

/**
 * The bottom bar is the only navigation most of these users have, and every
 * rule in it is a rule about who someone is rather than where they are. That
 * combination has already produced two shipped bugs — a whole section with no
 * way in, and a Home tab that redirected off itself — so the model is asserted
 * here rather than eyeballed on a handset.
 *
 * `EV` stands in for an event code; nothing in the model parses it.
 */
const EV = 'SHARMA26'

const labels = (tabs: NavTab[]) => tabs.map((t) => t.label)
const hrefs = (tabs: NavTab[]) => tabs.map((t) => t.href)

describe('bottomTabsFor — event lead', () => {
  it('gives an admin five tabs and no more', () => {
    const tabs = bottomTabsFor(EV, 'admin', 'management')
    expect(labels(tabs)).toEqual(['Home', 'Guests', 'Calls', 'Travel', 'Rooms'])
  })

  it('gives a management team member the same five', () => {
    const tabs = bottomTabsFor(EV, 'event_team', 'management')
    expect(labels(tabs)).toEqual(['Home', 'Guests', 'Calls', 'Travel', 'Rooms'])
  })

  it('lands each tab on its default child, not a bare section root', () => {
    const tabs = bottomTabsFor(EV, 'admin', 'management')
    expect(hrefs(tabs)).toEqual([
      `/${EV}`,
      `/${EV}/guests/list`,
      `/${EV}/rsvp/campaigns`,
      `/${EV}/logistics/arrivals`,
      `/${EV}/hospitality/rooms`,
    ])
  })

  it('never exceeds what the bar can lay out', () => {
    // Five is the budget. The `truncate` on the label was already load-bearing
    // at five, and the bar had seven before Hampers and Setup moved into Rooms.
    for (const dept of ['management', null] as const) {
      expect(bottomTabsFor(EV, 'admin', dept).length).toBeLessThanOrEqual(5)
    }
  })
})

describe('bottomTabsFor — runners', () => {
  it('gives a travel runner their four screens, not Home plus a dead tab', () => {
    const tabs = bottomTabsFor(EV, 'event_team', 'logistics')
    expect(labels(tabs)).toEqual(['Arrivals', 'Departures', 'Fleet', 'Trips'])
    expect(labels(tabs)).not.toContain('Home')
  })

  it('points a travel runner at real section routes', () => {
    expect(hrefs(bottomTabsFor(EV, 'event_team', 'logistics'))).toEqual([
      `/${EV}/logistics/arrivals`,
      `/${EV}/logistics/departures`,
      `/${EV}/logistics/fleet`,
      `/${EV}/logistics/trips`,
    ])
  })

  it('does not offer a rooms runner a section they are not allowed into', () => {
    // Hampers and Setup are borrowed children of Rooms for an event lead.
    // `requireSection` would bounce a hospitality runner off both, so a tab
    // for either would be a control that cannot work.
    const tabs = bottomTabsFor(EV, 'event_team', 'hospitality')
    expect(labels(tabs)).toEqual(['Rooms', 'Check in / out'])
  })

  it('gives a single-screen department no bar at all', () => {
    expect(bottomTabsFor(EV, 'event_team', 'hamper')).toEqual([])
    expect(bottomTabsFor(EV, 'event_team', 'production')).toEqual([])
  })

  it('shows only Home until a team member has picked their name', () => {
    // No department on the JWT yet. The welcome banner is what moves them on.
    expect(labels(bottomTabsFor(EV, 'event_team', null))).toEqual(['Home'])
  })
})

describe('bottomTabsFor — client', () => {
  it('gives a client no bar', () => {
    expect(bottomTabsFor(EV, 'client', null)).toEqual([])
    expect(bottomTabsFor(EV, 'client', 'management')).toEqual([])
  })
})

describe('resolveActive', () => {
  it('resolves a plain section path', () => {
    expect(resolveActive('logistics/arrivals')).toEqual({
      sectionId: 'logistics',
      childSegment: 'arrivals',
    })
  })

  it('keeps the child lit when drilling into a record', () => {
    expect(resolveActive('rsvp/status/abc-123')).toEqual({
      sectionId: 'rsvp',
      childSegment: 'status',
    })
  })

  it('resolves a borrowed child to the section that shows it', () => {
    // `/EVENT/hamper` starts with a real section id, but for navigation it has
    // to light Rooms — otherwise the tab goes dark and the strip that leads
    // back out renders nothing, stranding the user (R3).
    expect(resolveActive('hamper')).toEqual({
      sectionId: 'hospitality',
      childSegment: 'hamper',
    })
    expect(resolveActive('production')).toEqual({
      sectionId: 'hospitality',
      childSegment: 'production',
    })
  })

  it('treats the event root as Home', () => {
    expect(resolveActive('')).toEqual({ sectionId: 'dashboard', childSegment: null })
  })

  it('returns no section for a path outside the model', () => {
    expect(resolveActive('nonsense/page').sectionId).toBeNull()
  })
})

describe('the two navigation levels do not duplicate each other', () => {
  it('hides the second-level strip exactly when the bar already shows it', () => {
    expect(childrenAreInBottomBar('event_team', 'logistics')).toBe(true)
    expect(childrenAreInBottomBar('event_team', 'hospitality')).toBe(true)
    expect(childrenAreInBottomBar('event_team', 'management')).toBe(false)
    expect(childrenAreInBottomBar('admin', 'management')).toBe(false)
    expect(childrenAreInBottomBar('client', null)).toBe(false)
  })
})

describe('section definitions', () => {
  it('gives every section that takes a tab slot a default child or no children', () => {
    // A section with children but no default would land its tab on a bare
    // section root, which for most of these is not a page.
    for (const section of Object.values(SECTIONS)) {
      if (section.children.length === 0) continue
      expect(
        section.children.some((c) => c.isDefault),
        `${section.id} has children but none marked isDefault`,
      ).toBe(true)
    }
  })

  it('marks exactly the borrowed sections as out of the tab bar', () => {
    const outOfBar = Object.values(SECTIONS).filter((s) => !s.inTabBar).map((s) => s.id)
    expect(outOfBar.sort()).toEqual(['hamper', 'production'])
  })

  it('gives every borrowed child an href, since its route is elsewhere', () => {
    for (const section of Object.values(SECTIONS)) {
      for (const child of section.children) {
        if (child.segment === 'hamper' || child.segment === 'production') {
          expect(child.href, `${child.segment} must point at its own route`).toBe(child.segment)
        }
      }
    }
  })

  it('lets an event lead reach every section, tab or borrowed', () => {
    // The point of the five-tab budget is that nothing became unreachable.
    const tabs = bottomTabsFor(EV, 'admin', 'management')
    const reachable = new Set<string>(tabs.map((t) => t.sectionId))
    for (const section of Object.values(SECTIONS)) {
      if (section.inTabBar) {
        expect(reachable.has(section.id), `${section.id} has no tab`).toBe(true)
        continue
      }
      // Borrowed: must appear as a child of a section that DOES have a tab.
      const host = Object.values(SECTIONS).find((s) =>
        s.inTabBar && visibleChildren(s, 'admin', 'management').some((c) => c.href === section.id),
      )
      expect(host, `${section.id} is in no tab and is nobody's child`).toBeDefined()
    }
  })
})
