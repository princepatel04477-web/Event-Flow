import { describe, expect, it } from 'vitest'

import {
  STAFF_DEPARTMENTS,
  mayOpenHamperRun,
  sectionAllowedForDepartment,
  v2DepartmentHome,
  type StaffDepartment,
} from '@/lib/departments'

/**
 * The hamper run is the one screen in v2 with TWO doors and TWO audiences: the
 * hamper team (via `/{event}/hamper`) and the hospitality team (via
 * `/{event}/hospitality/deliveries`, which redirects to the same screen).
 *
 * `mayOpenHamperRun` is the single predicate for that union. It replaces three
 * copies of `sectionAllowedForDepartment('hospitality', d) ||
 * sectionAllowedForDepartment('hamper', d)` that had already drifted: the
 * hospitality section layout was omitted, so a hospitality runner opening the
 * hamper run was bounced to the Rooms board with a `?denied=section` marker
 * nothing renders — a silent teleport (`docs/BUGS.md` M7). Keeping the rule in
 * one tested function is what stops the next drift.
 */
const EV = 'SHARMA26'

describe('mayOpenHamperRun', () => {
  it('admits exactly the two departments the run belongs to, plus management', () => {
    expect(mayOpenHamperRun('hospitality')).toBe(true)
    expect(mayOpenHamperRun('hamper')).toBe(true)
    expect(mayOpenHamperRun('management')).toBe(true)
  })

  it('refuses every department with no copy of the run', () => {
    expect(mayOpenHamperRun('logistics')).toBe(false)
    expect(mayOpenHamperRun('production')).toBe(false)
    // A skipped-name session may open nothing but Today.
    expect(mayOpenHamperRun(null)).toBe(false)
  })

  it('is the union of the two sections, never a third rule', () => {
    for (const department of [...STAFF_DEPARTMENTS, null] as (StaffDepartment | null)[]) {
      expect(mayOpenHamperRun(department)).toBe(
        sectionAllowedForDepartment('hospitality', department) ||
          sectionAllowedForDepartment('hamper', department),
      )
    }
  })

  it('admits every department the shell actually sends to the run', () => {
    // The cross-check that matters: if `v2DepartmentHome` ever routes a new
    // department to the run, this fails until the union admits them too.
    for (const department of STAFF_DEPARTMENTS) {
      const dest = v2DepartmentHome(EV, department)
      const routedToRun =
        dest !== null && (dest.includes('/deliveries') || dest.endsWith('/hamper'))
      if (routedToRun) {
        expect(mayOpenHamperRun(department), `${department} → ${dest}`).toBe(true)
      }
    }
  })
})
