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
 */
export async function getStaffViewerContext(eventId: string): Promise<StaffViewerContext | null> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') return null

  if (access === 'admin') {
    return { access, department: 'management' }
  }

  const claims = await getSessionClaims()
  const department = claims?.department ?? null
  return { access, department }
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
