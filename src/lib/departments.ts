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

export const DEPARTMENT_LABELS: Record<StaffDepartment, string> = {
  management: 'Management',
  logistics: 'Logistics',
  hospitality: 'Hospitality',
  hamper: 'Hamper',
  production: 'Production',
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

/** Map URL segment to section id (handles legacy aliases). */
export function pathSegmentToSection(segment: string): SectionId | null {
  const map: Record<string, SectionId> = {
    dashboard: 'dashboard',
    guests: 'guests',
    rsvp: 'rsvp',
    queue: 'rsvp',
    call: 'rsvp',
    logistics: 'logistics',
    arrivals: 'logistics',
    departures: 'logistics',
    fleet: 'logistics',
    trips: 'logistics',
    hospitality: 'hospitality',
    rooms: 'hospitality',
    checkin: 'hospitality',
    hamper: 'hamper',
    deliveries: 'hamper',
    production: 'production',
    export: 'guests',
    import: 'guests',
  }
  return map[segment] ?? null
}
