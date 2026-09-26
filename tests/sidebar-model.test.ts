import { describe, it, expect } from 'vitest'

import { DEPARTMENT_SECTIONS } from '@/lib/departments'
import { sidebarGroupsFor, type SidebarGroup } from '@/lib/sections/sidebar'

/**
 * The desktop sidebar is drawn from the same `SECTIONS` access rules as the
 * phone's bottom bar, and its whole risk is a section that renders for someone
 * the page guard would then bounce — a visible control that cannot work. These
 * assert the two properties that keep that from happening: no nav for a client,
 * and no section outside the viewer's own department list.
 *
 * `EV` stands in for an event code; nothing in the model parses it.
 */
const EV = 'SHARMA26'
const ids = (groups: SidebarGroup[]) => groups.map((g) => g.id)
const hrefs = (groups: SidebarGroup[]) => [
  ...groups.map((g) => g.href),
  ...groups.flatMap((g) => g.items.map((i) => i.href)),
]

describe('sidebarGroupsFor', () => {
  it('gives an event lead the whole map, Guests included', () => {
    expect(ids(sidebarGroupsFor(EV, 'admin', 'management'))).toEqual([
      'dashboard',
      'rsvp',
      'hospitality',
      'hamper',
      'logistics',
      'guests',
    ])
  })

  it('gives a client no sidebar at all', () => {
    expect(sidebarGroupsFor(EV, 'client', null)).toEqual([])
  })
  it('never offers a section the department may not open', () => {
    for (const dept of ['logistics', 'hospitality', 'hamper', 'production'] as const) {
      for (const group of sidebarGroupsFor(EV, 'event_team', dept)) {
        expect(DEPARTMENT_SECTIONS[dept]).toContain(group.id)
      }
    }
  })

  it('gives a hospitality runner Today and Hospitality, and not Calls', () => {
    expect(ids(sidebarGroupsFor(EV, 'event_team', 'hospitality'))).toEqual([
      'dashboard',
      'hospitality',
    ])
  })

  it('links Hampers once for an event lead, not also under Hospitality', () => {
    const hampers = hrefs(sidebarGroupsFor(EV, 'admin', 'management')).filter(
      (h) => h === `/${EV}/hamper`,
    )
    expect(hampers).toHaveLength(1)
  })
})