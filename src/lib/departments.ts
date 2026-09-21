import type { SectionId } from '@/lib/sections/config'

/** Field team department — stored on staff_members and in the code-auth JWT. */
export type StaffDepartment =
  | 'management'
  | 'logistics'
  | 'hospitality'
  | 'hamper'
  | 'production'

export const STAFF_DEPARTMENTS: StaffDepartment[] = [
  'management',
  'logistics',
  'hospitality',
  'hamper',
  'production',
]

/** Plain labels for runners — not org-chart jargon. */
export const DEPARTMENT_LABELS: Record<StaffDepartment, string> = {
  management: 'Event lead',
  logistics: 'Travel',
  hospitality: 'Rooms',
  hamper: 'Hampers',
  production: 'Setup',
}

/** Sections each department may open. Management sees everything. */
export const DEPARTMENT_SECTIONS: Record<StaffDepartment, SectionId[]> = {
  management: ['dashboard', 'guests', 'rsvp', 'logistics', 'hospitality', 'hamper', 'production'],
  logistics: ['dashboard', 'logistics'],
  hospitality: ['dashboard', 'hospitality'],
  hamper: ['dashboard', 'hamper'],
  production: ['dashboard', 'production'],
}

export function isStaffDepartment(value: string | null | undefined): value is StaffDepartment {
  return value != null && (STAFF_DEPARTMENTS as string[]).includes(value)
}

/** Default landing path after sign-in for a department. */
export function departmentHomePath(eventCode: string, department: StaffDepartment): string {
  switch (department) {
    case 'management':
      return `/${eventCode}/rsvp/campaigns`
    case 'logistics':
      return `/${eventCode}/logistics/arrivals`
    case 'hospitality':
      return `/${eventCode}/hospitality/rooms`
    case 'hamper':
      return `/${eventCode}/hamper`
    case 'production':
      return `/${eventCode}/production`
    default:
      return `/${eventCode}`
  }
}

export function sectionAllowedForDepartment(
  sectionId: SectionId,
  department: StaffDepartment | null,
): boolean {
  if (!department) return sectionId === 'dashboard'
  return DEPARTMENT_SECTIONS[department].includes(sectionId)
}

/**
 * Map the first URL segment under the event code to the section that guards it.
 *
 * Only real routes appear here. This used to also carry aliases for the flat
 * copies of these screens — `arrivals`, `queue`, `checkin`, `deliveries`,
 * `import`, `export` and the rest — which were deleted along with the routes
 * themselves. `next.config.ts` redirects those paths to their section route
 * before filesystem routing runs, so nothing reaches this function holding
 * one, and leaving them here would suggest a screen still lives there.
 */
export function pathSegmentToSection(segment: string): SectionId | null {
  const map: Record<string, SectionId> = {
    dashboard: 'dashboard',
    guests: 'guests',
    rsvp: 'rsvp',
    logistics: 'logistics',
    hospitality: 'hospitality',
    hamper: 'hamper',
    production: 'production',
  }
  return map[segment] ?? null
}
