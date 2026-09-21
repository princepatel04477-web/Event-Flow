import 'server-only'

import { notFound, redirect } from 'next/navigation'

import { getStaffViewerContext } from '@/lib/auth/section-guard'
import { departmentHomePath, sectionAllowedForDepartment } from '@/lib/departments'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

/**
 * The guard for the two v2 hamper routes, and the reason it is not simply
 * `requireSection(..., 'hospitality')`.
 *
 * In v1 this ONE screen is reached through TWO section layouts with two
 * different gates: `(staff)/[eventCode]/hospitality/layout.tsx` allows the
 * hospitality department, and `(staff)/[eventCode]/hamper/layout.tsx` allows
 * the hamper department — and a hamper runner is deliberately NOT a member of
 * `hospitality` (see `DEPARTMENT_SECTIONS`), which is why `hamper/[id]/page.tsx`
 * has to pass `backTo="hamper"` to keep that runner off a `?denied=section`
 * bounce. v2 has one route for both audiences, so its guard has to allow the
 * union of the two, or the hamper team — the people whose whole job this is —
 * would be locked out of the screen that does it.
 *
 * It is not a weakening: a travel, production or client session is still turned
 * away, with the same redirect and the same `?denied=section` marker the section
 * guard uses.
 *
 * `_guard.ts` is underscore-prefixed so the App Router does not treat it as a
 * route. `_components/` under the same tree sets the precedent.
 */
export async function requireHamperScreen(eventCode: string) {
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const access = await requireStaff(event.id, event.code)
  const ctx = await getStaffViewerContext(event.id)
  if (!ctx) redirect(`/${eventCode}`)

  if (access === 'admin' || ctx.department === 'management') {
    return { event, canGenerate: access === 'admin' }
  }

  const allowed =
    sectionAllowedForDepartment('hospitality', ctx.department) ||
    sectionAllowedForDepartment('hamper', ctx.department)

  if (!allowed) {
    const home = ctx.department ? departmentHomePath(eventCode, ctx.department) : `/${eventCode}`
    redirect(`${home}?denied=section`)
  }

  return { event, canGenerate: false }
}
