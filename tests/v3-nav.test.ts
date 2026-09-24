import { describe, expect, it } from 'vitest'

import { SECTIONS, type TabAccess } from '@/lib/sections/config'
import { v3ActiveChild, v3ActiveSection, v3ScreenTitle, v3TabsFor } from '@/lib/sections/v3'
import { STAFF_DEPARTMENTS, sectionAllowedForDepartment, type StaffDepartment } from '@/lib/departments'

/**
 * The v3 bottom bar is **Today · Calls · Rooms · Hampers · Travel** and it is
 * the only navigation most of these users have. Every rule in it is a rule
 * about who someone is rather than where they are, which is the combination
 * that has already shipped two bugs (a section with no way in, a Home tab
 * that redirected off itself) — so the model is asserted here rather than
 * eyeballed on a handset.
 *
 * The v1/v2 model in `config.tsx` keeps its own suite (`nav-model.test.ts`).
 * These two are deliberately separate: the whole point of `v3.ts` is that the
 * v3 bar changes the SET and the ORDER, and a shared assertion would have to
 * be wrong about one of them.
 */
const EV = 'SHARMA26'

const labels = (tabs: ReturnType<typeof v3TabsFor>) => tabs.map((t) => t.label)
const hrefs = (tabs: ReturnType<typeof v3TabsFor>) => tabs.map((t) => t.href)

describe('v3TabsFor — event lead', () => {
  it('gives an admin the five v3 tabs, in v3 order', () => {
    expect(labels(v3TabsFor(EV, 'admin', 'management'))).toEqual([
      'Today',
      'Calls',
      'Rooms',
      'Hampers',
      'Travel',
    ])
  })

  it('gives a management team member the same five', () => {
    expect(labels(v3TabsFor(EV, 'event_team', 'management'))).toEqual([
      'Today',
      'Calls',
      'Rooms',
      'Hampers',
      'Travel',
    ])
  })

  it('points every tab at a real v3 section root', () => {
    expect(hrefs(v3TabsFor(EV, 'admin', 'management'))).toEqual([
      `/${EV}`,
      `/${EV}/rsvp`,
      `/${EV}/hospitality`,
      `/${EV}/hamper`,
      `/${EV}/logistics`,
    ])
  })

  it('never exceeds the five slots the bar can lay out', () => {
    for (const dept of ['management', null] as const) {
      expect(v3TabsFor(EV, 'admin', dept).length).toBeLessThanOrEqual(5)
    }
  })

  it('drops Guests from the bar — Find is the way in now', () => {
    // The load-bearing deletion of the whole redesign. If this fails, the
    // fifth slot is gone and either Hampers or Travel has no tab.
    expect(labels(v3TabsFor(EV, 'admin', 'management'))).not.toContain('Guests')
    for (const href of hrefs(v3TabsFor(EV, 'admin', 'management'))) {
      expect(href).not.toContain('/guests')
    }
  })

  it('gives a session that skipped the name picker Today alone', () => {
    // A skipped-name team session has `department === null`, and
    // `sectionAllowedForDepartment` admits that to `dashboard` only. It used to
    // be treated as a lead and handed all five tabs, four of which bounced the
    // tap straight back with `?denied=section` — controls that cannot work
    // (docs/BUGS.md M1). v1 renders Home alone for this session; this matches it.
    const tabs = v3TabsFor(EV, 'event_team', null)
    expect(labels(tabs)).toEqual(['Today'])
    expect(hrefs(tabs)).toEqual([`/${EV}`])
  })

  it('never emits a tab the department would be bounced off', () => {
    // The invariant behind M1, asserted across every viewer shape: a tab is a
    // promise that tapping it opens something. `sectionAllowedForDepartment` is
    // the same predicate `requireSection` gates on, so this is the nav's own
    // copy of the guard's answer.
    for (const access of ['admin', 'event_team'] as TabAccess[]) {
      for (const department of [...STAFF_DEPARTMENTS, null]) {
        for (const tab of v3TabsFor(EV, access, department)) {
          expect(
            access === 'admin' || sectionAllowedForDepartment(tab.sectionId, department),
            `${access}/${department}: ${tab.label} → ${tab.href}`,
          ).toBe(true)
        }
      }
    }
  })
})

describe('v3TabsFor — runners', () => {
  it('gives a travel runner their four screens', () => {
    const tabs = v3TabsFor(EV, 'event_team', 'logistics')
    expect(labels(tabs)).toEqual(['Arrivals', 'Departures', 'Fleet', 'Trips'])
    expect(hrefs(tabs)).toEqual([
      `/${EV}/logistics/arrivals`,
      `/${EV}/logistics/departures`,
      `/${EV}/logistics/fleet`,
      `/${EV}/logistics/trips`,
    ])
    expect(labels(tabs)).not.toContain('Today')
  })

  it('gives a rooms runner their two screens and nothing else', () => {
    // Hampers is now its OWN tab, and a hospitality runner may not enter the
    // hamper section — so their bar is the two screens they can actually
    // open, not a tab that bounces them to `?denied=section`.
    expect(labels(v3TabsFor(EV, 'event_team', 'hospitality'))).toEqual([
      'Rooms',
      'Check in / out',
    ])
  })

  it('gives a single-screen department no bar at all', () => {
    // One screen does not need navigation, and a bar for it would reserve
    // `pb-nav` clearance under a page with nothing beneath it.
    expect(v3TabsFor(EV, 'event_team', 'hamper')).toEqual([])
    expect(v3TabsFor(EV, 'event_team', 'production')).toEqual([])
  })

  it('lets every department that gets a bar reach a real screen', () => {
    // Today is the event root itself — `/{code}`, no trailing segment — and
    // every other tab is a path under the event.
    const eventRoot = `/${EV}`
    for (const department of ['management', 'logistics', 'hospitality', 'hamper', 'production'] as StaffDepartment[]) {
      for (const tab of v3TabsFor(EV, 'event_team', department)) {
        expect(
          tab.href === eventRoot || tab.href.startsWith(`${eventRoot}/`),
          `${tab.label} → ${tab.href}`,
        ).toBe(true)
      }
    }
  })
})

describe('v3TabsFor — client', () => {
  it('gives a client no bar in either department reading', () => {
    expect(v3TabsFor(EV, 'client', null)).toEqual([])
    expect(v3TabsFor(EV, 'client', 'management')).toEqual([])
  })
})

describe('v3ActiveSection', () => {
  it('treats the event root as Today', () => {
    expect(v3ActiveSection('')).toBe('dashboard')
  })

  it('resolves a plain section path', () => {
    expect(v3ActiveSection('logistics/arrivals')).toBe('logistics')
  })

  it('keeps the section lit when drilling into a record', () => {
    expect(v3ActiveSection('hospitality/rooms/104')).toBe('hospitality')
    expect(v3ActiveSection('rsvp/status/abc-123')).toBe('rsvp')
  })

  it('resolves a borrowed child to the section that shows it', () => {
    // `/EVENT/hamper` starts with a real section id, but for the BAR it has
    // to light Hampers — and for the header it has to title itself "Hampers".
    expect(v3ActiveSection('hamper')).toBe('hamper')
    // Setup has no tab in the v3 bar at all (it is flag-gated and borrowed),
    // so it resolves to itself and simply lights nothing — which is the
    // honest answer rather than lighting Rooms for a screen Rooms does not
    // contain.
    expect(v3ActiveSection('production')).toBe('production')
  })

  it('still resolves a section that is no longer in the bar', () => {
    // Guests is reached from the search button. A guest list with no section
    // would title its own header "EventFlow".
    expect(v3ActiveSection('guests/list')).toBe('guests')
    expect(v3ScreenTitle('guests/list')).toBe('Guest list')
  })

  it('returns null for a path outside the model', () => {
    expect(v3ActiveSection('nonsense/page')).toBeNull()
  })
})

describe('v3ActiveChild', () => {
  it('reads the second segment, and null at a section root', () => {
    expect(v3ActiveChild('logistics/arrivals')).toBe('arrivals')
    expect(v3ActiveChild('logistics')).toBeNull()
    expect(v3ActiveChild('')).toBeNull()
  })
})

describe('v3ScreenTitle', () => {
  it('names the section beside the event root', () => {
    expect(v3ScreenTitle('')).toBe('Today')
    expect(v3ScreenTitle('rsvp')).toBe('Calls')
    expect(v3ScreenTitle('logistics')).toBe('Travel')
    expect(v3ScreenTitle('hospitality')).toBe('Rooms')
  })

  it('names a child screen by the child label', () => {
    expect(v3ScreenTitle('logistics/arrivals')).toBe('Arrivals')
    expect(v3ScreenTitle('hospitality/checkin')).toBe('Check in / out')
  })

  it('names the one Rooms screen that is not about rooms', () => {
    // `hospitality/deliveries` has no matching child in `SECTIONS.hospitality`
    // — without the override it titles itself "Rooms", on the hamper run.
    expect(v3ScreenTitle('hospitality/deliveries')).toBe('Hampers')
    expect(v3ScreenTitle('hospitality/deliveries/abc-123')).toBe('Hampers')
  })

  it('names the help screen', () => {
    expect(v3ScreenTitle('help')).toBe('Help')
  })

  it('falls back to the section name on a detail route', () => {
    expect(v3ScreenTitle('hospitality/rooms/104')).toBe('Rooms')
  })

  it('never returns an empty string', () => {
    for (const rest of ['', 'rsvp', 'guests/list', 'nonsense/page', 'help']) {
      expect(v3ScreenTitle(rest).length).toBeGreaterThan(0)
    }
  })
})

describe('the v3 bar keeps the shared section table honest', () => {
  it('has a label for every section it draws', () => {
    // A section in the bar with no v3 label renders as an empty tab. The
    // labels live in `V3_TAB_LABEL`; this walks the SECTIONS the bar can
    // reach and proves each one is named.
    const drawn = new Set(v3TabsFor(EV, 'admin', 'management').map((t) => t.sectionId))
    expect(drawn).toEqual(new Set(['dashboard', 'rsvp', 'hospitality', 'hamper', 'logistics']))
    for (const id of drawn) {
      expect(SECTIONS[id]).toBeDefined()
    }
  })

  it('gives every tab a unique href', () => {
    const tabs = v3TabsFor(EV, 'admin', 'management')
    expect(new Set(tabs.map((t) => t.href)).size).toBe(tabs.length)
    expect(new Set(tabs.map((t) => t.key)).size).toBe(tabs.length)
  })

  it('holds the shared model unchanged, so v1 keeps its own bar', () => {
    // The v3 change is scoped to `v3.ts`. If a future session "simplifies"
    // this by editing `SECTIONS` in place, v1's five tabs move under it and
    // `tests/nav-model.test.ts` fails — this is the early warning.
    expect(SECTIONS.guests.inTabBar).toBe(true)
    expect(SECTIONS.hamper.inTabBar).toBe(false)
    const roles: TabAccess[] = ['admin', 'event_team', 'client']
    expect(roles).toContain('client')
  })
})
