import { describe, expect, it } from 'vitest'

import { DENIED_MESSAGES, deniedMessage } from '@/lib/sections/denied'

/**
 * The `?denied=` sentences (`docs/BUGS.md` M3, M7).
 *
 * The note used to be rendered only by Today, but `requireSection` bounces a
 * denied viewer to their OWN department home — Rooms, Arrivals, Hampers — and
 * none of those read the marker. A refused tap therefore looked like a link that
 * did nothing. The shell now renders this lookup on every screen, and it is
 * deliberately a closed table so a query string cannot inject prose into the
 * app's own voice.
 */
describe('deniedMessage', () => {
  it('explains each reason in the app\u2019s own words', () => {
    expect(deniedMessage('import')).toBe(DENIED_MESSAGES.import)
    expect(deniedMessage('admin')).toBe(DENIED_MESSAGES.admin)
    expect(deniedMessage('section')).toBe(DENIED_MESSAGES.section)
  })

  it('says nothing when there is no marker', () => {
    expect(deniedMessage(null)).toBeNull()
    expect(deniedMessage(undefined)).toBeNull()
    expect(deniedMessage('')).toBeNull()
  })

  it('ignores free text from the query string', () => {
    // The value arrives in a URL, so anything could be in it. Unknown keys get
    // no note rather than echoing the caller's sentence back to the viewer.
    expect(deniedMessage('<script>alert(1)</script>')).toBeNull()
    expect(deniedMessage('../../etc/passwd')).toBeNull()
    expect(deniedMessage('IMPORT')).toBeNull()
  })
})
