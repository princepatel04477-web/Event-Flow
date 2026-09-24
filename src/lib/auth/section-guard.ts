import 'server-only'

import { redirect } from 'next/navigation'

import {
  departmentHomePath,
  pathSegmentToSection,
  sectionAllowedForDepartment,
  type StaffDepartment,
} from '@/lib/departments'
import type { SectionId } from '@/lib/sections/config'
import { getSessionClaims } from '@/lib/auth/server'
import {
  getEventAccess,
  requireStaff,
  type StaffAccess,
} from '@/lib/supabase/queries'

export type StaffViewerContext = {
  access: StaffAccess
  department: StaffDepartment | null
}

/**
 * Resolve staff access plus department for nav gating.
 * Admin: all sections. Code-auth without a picked name: dashboard only.
 *
 * ACCESS AND CLAIMS ARE RESOLVED TOGETHER. They used to be two awaited calls in
 * sequence, and both of them read the code-auth session — `getEventAccess()`
 * through `getSessionClaims()` and the department through `getSessionClaims()`
 * again. With the claims memoised per request (see `src/lib/auth/server.ts`) the
 * second read is free, so running the two together removes a sequential hop
 * without adding a round trip. The department is only READ when access turns out
 * to be `event_team`; resolving it for an admin is a null and costs nothing.
 */
export async function getStaffViewerContext(eventId: string): Promise<StaffViewerContext | null> {
  const [access, claims] = await Promise.all([getEventAccess(eventId), getSessionClaims()])
  if (access !== 'admin' && access !== 'event_team') return null

  if (access === 'admin') {
    return { access, department: 'management' }
  }

  return { access, department: claims?.department ?? null }
}

/** Page guard: staff on this event AND allowed to open this section. */
export async function requireSection(
  eventId: string,
  eventCode: string,
  sectionId: SectionId,
): Promise<StaffViewerContext> {
  const access = await requireStaff(eventId, eventCode)
  const ctx = await getStaffViewerContext(eventId)
  if (!ctx) redirect(`/${eventCode}`)

  if (access === 'admin' || ctx.department === 'management') return ctx

  if (!sectionAllowedForDepartment(sectionId, ctx.department)) {
    const home = ctx.department
      ? departmentHomePath(eventCode, ctx.department)
      : `/${eventCode}`
    redirect(`${home}?denied=section`)
  }

  return ctx
}

/** Infer section from the second URL segment and guard it. */
export async function requireSectionFromPath(
  eventId: string,
  eventCode: string,
  pathSegment: string,
): Promise<StaffViewerContext> {
  const sectionId = pathSegmentToSection(pathSegment)
  if (!sectionId) {
    await requireStaff(eventId, eventCode)
    return (await getStaffViewerContext(eventId))!
  }
  return requireSection(eventId, eventCode, sectionId)
}

/**
 * Page guard: staff on this event AND allowed into AT LEAST ONE of these
 * sections.
 *
 * The one screen that needs it is the hamper run, which two departments reach
 * through two different sections (see `mayOpenHamperRun`). `requireSection`
 * takes one id; the hamper run's callers need the union, and writing that union
 * three times is how the hospitality copy of the run ended up gated by the
 * hamper section alone and bounced (`docs/BUGS.md` M7). Everything else about
 * the deny path is identical to `requireSection`, including the
 * `?denied=section` marker.
 */
export async function requireAnySection(
  eventId: string,
  eventCode: string,
  sectionIds: SectionId[],
): Promise<StaffViewerContext> {
  const access = await requireStaff(eventId, eventCode)
  const ctx = await getStaffViewerContext(eventId)
  if (!ctx) redirect(`/${eventCode}`)

  if (access === 'admin' || ctx.department === 'management') return ctx

  if (!sectionIds.some((id) => sectionAllowedForDepartment(id, ctx.department))) {
    const home = ctx.department
      ? departmentHomePath(eventCode, ctx.department)
      : `/${eventCode}`
    redirect(`${home}?denied=section`)
  }

  return ctx
}
