import { describe, expect, it } from 'vitest'

import { EVENT_NAV } from '@/lib/admin/nav'
import { controlGroups } from '@/lib/admin/control'

/**
 * The admin nav contract.
 *
 * WHY THIS FILE EXISTS. The desktop sidebar and the phone's More sheet were two
 * hardcoded lists that drifted, leaving Hotels, Files and Settings reachable on
 * a laptop and MISSING on the handset — the pages existed, the door did not.
 * Both now render `EVENT_NAV`, so this pins the list: every admin event page
 * must appear here, and the phone's sheet lists every item except the event root
 * (which is already the Dashboard tab).
 */
describe('admin event nav', () => {
  const segments = EVENT_NAV.map((item) => item.href)

  it('lists every admin event page', () => {
    for (const page of ['hotels', 'codes', 'messages', 'ledger', 'files', 'settings']) {
      expect(segments, `missing admin page: ${page}`).toContain(page)
    }
  })

  it('includes the event root exactly once', () => {
    expect(segments.filter((s) => s === '').length).toBe(1)
  })

  it('has a unique segment per item', () => {
    expect(new Set(segments).size).toBe(segments.length)
  })

  it('puts every admin event page one tap from Control on a phone', () => {
    // UI4 Part S: the phone's admin tab bar and its More sheet are gone. An
    // admin on a phone reaches every event tool from the Control tab instead,
    // so every EVENT_NAV page except the root (the event itself) must be a
    // row there. This replaced "the More sheet lists every page".
    const controlHrefs = controlGroups('SHARMA26').flatMap((g) => g.rows.map((r) => r.href))
    for (const item of EVENT_NAV.filter((i) => i.href !== '')) {
      const href = `/admin/events/SHARMA26/${item.href}`
      expect(
        controlHrefs.some((h) => h === href || h.startsWith(`${href}/`)),
        `${item.label} is not reachable from Control`,
      ).toBe(true)
    }
  })

  it('also puts the staff roster on Control, which the sidebar lists elsewhere', () => {
    const keys = controlGroups('SHARMA26').flatMap((g) => g.rows.map((r) => r.key))
    expect(keys).toContain('staff')
    expect(new Set(keys).size).toBe(keys.length)
  })
})
