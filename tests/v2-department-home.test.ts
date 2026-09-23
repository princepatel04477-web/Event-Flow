import { describe, it, expect } from 'vitest'

import { departmentHomePath, v2DepartmentHome, type StaffDepartment } from '@/lib/departments'

/**
 * `v2DepartmentHome` is the v2 shell's own answer to "where does this
 * department land", asserted separately from `departmentHomePath` because
 * the two must disagree on exactly two departments and agree on the rest.
 *
 * The bug this pins: an event lead (`management`) tapping Home landed back
 * on Auto-call every time (`departmentHomePath('management')` is
 * `rsvp/campaigns`) instead of staying on the dashboard already rendering —
 * "the first thing a runner sees", per DECISIONS.md. `null` is the contract
 * for "do not redirect", not a path string, because the v1 dashboard
 * (`(staff)/[eventCode]/page.tsx`) runs the same redirect-on-department
 * check against the same route: if this function returned the dashboard's
 * own path, v1's guard would redirect to itself forever.
 */
const EV = 'SHARMA26'

describe('v2DepartmentHome', () => {
  it('sends management nowhere — it stays on the dashboard already rendering', () => {
    expect(v2DepartmentHome(EV, 'management')).toBeNull()
  })

  it('sends hamper to the real v2 screen, not the stale legacy re-export', () => {
    expect(v2DepartmentHome(EV, 'hamper')).toBe(`/${EV}/hospitality/deliveries`)
    // The legacy path the shared function still returns for v1 must NOT be
    // where v2 sends this department — that mismatch is the whole point.
    expect(v2DepartmentHome(EV, 'hamper')).not.toBe(departmentHomePath(EV, 'hamper'))
  })

  it('defers to departmentHomePath for every other department', () => {
    const untouched: StaffDepartment[] = ['logistics', 'hospitality', 'production']
    for (const dept of untouched) {
      expect(v2DepartmentHome(EV, dept)).toBe(departmentHomePath(EV, dept))
    }
  })

  it('never returns the bare dashboard path — that would still redirect off it', () => {
    // A caller does `if (dest) redirect(dest)`. A non-null dest of `/{event}`
    // would pass that check and immediately redirect to the page already
    // rendering, which is observably identical to the loop this exists to
    // avoid. `null` is the only safe "stay here" value.
    for (const dept of ['management', 'logistics', 'hospitality', 'hamper', 'production'] as StaffDepartment[]) {
      const dest = v2DepartmentHome(EV, dept)
      expect(dest).not.toBe(`/${EV}`)
    }
  })
})
