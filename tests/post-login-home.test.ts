import { describe, it, expect } from 'vitest'

import {
  departmentHomePath,
  postLoginHome,
  v2DepartmentHome,
  type StaffDepartment,
} from '@/lib/departments'

/**
 * The landing after a staff member picks their name in
 * `src/app/pick-staff/StaffPicker.tsx` — the one hop that happens before any
 * screen renders, and therefore the one place a department-home fix cannot
 * reach through the page it is used to living in.
 *
 * The bug this pins: under `NEXT_PUBLIC_UI=v2`, an event lead
 * (`management`) tapped their own name and landed on `/rsvp/campaigns`
 * (Auto-call), because `StaffPicker` called the v1-shared
 * `departmentHomePath` unconditionally. The v2 home page already redirected
 * a lead back to the dashboard on every later visit; only this first hop
 * disagreed, which is exactly the kind of one-screen inconsistency that
 * reads as "the fix did not work".
 *
 * `postLoginHome` takes the UI version as an argument rather than calling
 * `getUiVersion()` itself, so this file needs no `process.env` mutation and
 * no module re-import: the caller is the one that knows which shell is on
 * screen.
 */
const EV = 'SHARMA26'

const ALL: StaffDepartment[] = [
  'management',
  'logistics',
  'hospitality',
  'hamper',
  'production',
]

describe('postLoginHome, v2', () => {
  it('lands an event lead on the dashboard, never on Auto-call', () => {
    expect(postLoginHome('v2', EV, 'management')).toBe(`/${EV}`)
    expect(postLoginHome('v2', EV, 'management')).not.toBe(`/${EV}/rsvp/campaigns`)
  })

  it('lands a hamper runner on the v2 hamper screen, not the stale re-export', () => {
    expect(postLoginHome('v2', EV, 'hamper')).toBe(`/${EV}/hospitality/deliveries`)
  })

  it('agrees with v2DepartmentHome everywhere, resolving its null contract', () => {
    // `v2DepartmentHome` returns null for management to mean "stay on the
    // dashboard already rendering". There is no page rendering yet at the
    // picker, so the only correct reading of that null at THIS call site is
    // the dashboard path itself.
    for (const dept of ALL) {
      expect(postLoginHome('v2', EV, dept)).toBe(v2DepartmentHome(EV, dept) ?? `/${EV}`)
    }
  })

  it('never resolves to the bare event root for an unfinished department', () => {
    // A non-null return of `/{event}` is right for management (the dashboard
    // IS that path) and wrong for everyone else — it would hand a logistics
    // runner the board instead of arrivals.
    for (const dept of ['logistics', 'hospitality', 'hamper', 'production'] as StaffDepartment[]) {
      expect(postLoginHome('v2', EV, dept)).not.toBe(`/${EV}`)
    }
  })
})

describe('postLoginHome, v1 — unchanged', () => {
  it('keeps the v1 answer for every department, management included', () => {
    for (const dept of ALL) {
      expect(postLoginHome('v1', EV, dept)).toBe(departmentHomePath(EV, dept))
    }
  })

  it('still sends v1 management to Auto-call, on purpose', () => {
    // Not a bug to fix later: v1's dashboard runs the same
    // redirect-on-department check through the same shared function, so
    // pointing this at the dashboard path would send v1 into a redirect loop.
    expect(postLoginHome('v1', EV, 'management')).toBe(`/${EV}/rsvp/campaigns`)
  })

  it('points v1 at the path v1 actually serves, stale re-export and all', () => {
    // `/{event}/hamper` is a live screen under `(staff)`. v2 remaps it for
    // the same department (`v2DepartmentHome`) — that divergence is the one
    // this function exists to encode, so it is asserted from both sides.
    expect(postLoginHome('v1', EV, 'hamper')).toBe(`/${EV}/hamper`)
    expect(postLoginHome('v1', EV, 'hamper')).not.toBe(postLoginHome('v2', EV, 'hamper'))
  })
})
