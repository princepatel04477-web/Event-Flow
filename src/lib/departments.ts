import type { SectionId } from '@/lib/sections/config'
import type { UiVersion } from '@/lib/ui-version'

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

/**
 * Where a department lands under the v2 shell (`(app)/v2/[eventCode]/page.tsx`)
 * specifically — `null` means "stay on the dashboard, do not redirect".
 *
 * Two remaps on top of `departmentHomePath`, kept as a SEPARATE function
 * rather than changes to it:
 *
 * - `management` gets no redirect. Every other place in the nav model
 *   (`bottomTabsFor`'s `isLead`) already treats this department as an admin
 *   equivalent, so v2's dashboard — the render this department is already
 *   getting — is the right destination, not `rsvp/campaigns`.
 *   `departmentHomePath('management')` cannot become the dashboard path
 *   itself: `(staff)/[eventCode]/page.tsx` (v1) runs the identical
 *   redirect-on-department check against that same route, and pointing the
 *   shared function at it would send v1's dashboard into a redirect loop —
 *   v1 has no other screen at that path for this case to land on.
 * - `hamper` goes to `hospitality/deliveries`, the real v2 build (Job 3,
 *   `HamperRun`). `/{event}/hamper` under the v2 route group is a stale
 *   re-export of the v1 screen (see `(app)/v2/[eventCode]/hamper/page.tsx`)
 *   — correct for v1, a dead end here.
 *
 * Every other department is unaffected: `departmentHomePath` already sends
 * `logistics` and `hospitality` to real v2 screens (`logistics/arrivals`,
 * `hospitality/rooms`), so this defers to it for them.
 */
export function v2DepartmentHome(
  eventCode: string,
  department: StaffDepartment,
): string | null {
  if (department === 'management') return null
  if (department === 'hamper') return `/${eventCode}/hospitality/deliveries`
  return departmentHomePath(eventCode, department)
}

/**
 * Where a staff member lands the moment they pick their name — the one hop
 * `StaffPicker` makes after it re-mints the JWT, before any screen has
 * rendered.
 *
 * The UI version is a PARAMETER rather than a `getUiVersion()` call inside,
 * for two reasons: this module stays pure, so the test does not have to
 * mutate `process.env` and re-import it; and the caller already knows which
 * shell it is rendering.
 *
 * Under v1 the version argument selects the shared `departmentHomePath` and
 * nothing else — including `management → rsvp/campaigns`. That answer is
 * deliberately unchanged: v1's dashboard at `/{event}` redirects any
 * department away from itself through that same shared function, so
 * changing this side alone would trade a wrong landing for a redirect loop.
 *
 * v2 uses the shell's own answer. For `management` that is the dashboard
 * (`/{event}`), not Auto-call — see `v2DepartmentHome`, which returns `null`
 * there to mean "stay put", a contract that only makes sense to a caller
 * already standing on that page. Here there is no page yet, so `null` is
 * resolved to the dashboard path explicitly.
 */
export function postLoginHome(
  ui: UiVersion,
  eventCode: string,
  department: StaffDepartment,
): string {
  if (ui !== 'v2') return departmentHomePath(eventCode, department)
  return v2DepartmentHome(eventCode, department) ?? `/${eventCode}`
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
