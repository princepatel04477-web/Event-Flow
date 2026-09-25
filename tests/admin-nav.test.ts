import { describe, expect, it } from 'vitest'

import { EVENT_NAV } from '@/lib/admin/nav'

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

  it('gives the phone every page except the root', () => {
    // Mirrors AdminMobileNav's `EVENT_NAV.filter((item) => item.href !== '')`.
    const phoneItems = EVENT_NAV.filter((item) => item.href !== '')
    expect(phoneItems.length).toBe(EVENT_NAV.length - 1)
    for (const page of ['hotels', 'files', 'settings']) {
      expect(phoneItems.map((i) => i.href)).toContain(page)
    }
  })
})
