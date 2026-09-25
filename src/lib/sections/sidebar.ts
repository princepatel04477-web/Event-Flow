import type { ReactNode } from 'react'

import type { StaffDepartment } from '@/lib/departments'
import { sectionAllowedForDepartment } from '@/lib/departments'

import {
  SECTIONS,
  type SectionId,
  type TabAccess,
  childHref,
  sectionRoot,
  visibleChildren,
} from './config'

/**
 * The desktop sidebar's navigation model.
 *
 * The desktop shell (>= 1024px) shows a persistent left sidebar instead of the
 * fixed bottom bar. Both are drawn from the SAME `SECTIONS` table and the same
 * role / department / feature-flag predicates — this module only *selects and
 * orders*; it never re-decides who may see a section. A second copy of the
 * access rules here is how the desktop entry and the phone tab would drift
 * apart, and the phone is the surface that must not change.
 *
 * WHY IT IS NOT `bottomTabsFor` / `v3TabsFor`. Those answer "what fits in a
 * five-slot bar for THIS viewer", and v3 deliberately drops Guests from the
 * bar and collapses a runner to their own section's screens. A sidebar has room
 * for the whole map, so it lists every section the viewer may open, not just
 * the five that fit, and it carries each section's visible children as a second
 * level rather than a separate strip.
 */

/** A link in the sidebar's second level (a child of a section). */
export interface SidebarItem {
  key: string
  href: string
  label: string
  icon: ReactNode
  sectionId: SectionId
  childSegment: string | null
}

/** A top-level section and the children of it the viewer may open. */
export interface SidebarGroup {
  id: SectionId
  href: string
  label: string
  icon: ReactNode
  items: SidebarItem[]
}

/**
 * Top-level order — reads in the order of the event: who is coming, where they
 * sleep, what they get, how they leave, then the reference screens. Any section
 * NOT in this list is appended after it (in `SECTIONS` declaration order) rather
 * than dropped, so a section added by a later ticket (T11's Files, a Settings
 * section) appears with no edit here.
 */
const SIDEBAR_ORDER: readonly SectionId[] = [
  'dashboard',
  'rsvp',
  'hospitality',
  'hamper',
  'logistics',
  'guests',
]
/**
 * May this viewer open this section, and is there somewhere to land?
 *
 * The three gates are the bar's three gates, in the bar's order: role, then
 * department (admins are exempt), then the feature flag. A feature-flagged
 * section is reached through its host section, never as a top-level entry —
 * `production` is a child of `hospitality`, which is how the phone renders it
 * too. The final check drops a section whose children are all filtered out,
 * because that is a section root the page guard would bounce.
 */
function isShown(section: SectionId, access: TabAccess, department: StaffDepartment | null): boolean {
  const def = SECTIONS[section]
  if (!def.roles.includes(access)) return false
  if (def.featureFlag) return false
  if (access !== 'admin' && !sectionAllowedForDepartment(section, department)) return false
  const children = visibleChildren(def, access, department)
  if (def.children.length > 0 && children.length === 0) return false
  return true
}
/**
 * The sidebar for this viewer, or `[]` for a viewer who has no nav at all.
 *
 * A client gets nothing, exactly as they get no bottom bar: they have one
 * screen, and a sidebar of one door is furniture. A runner whose department is
 * a single section still gets the sidebar — it carries Today and their own
 * section — but never a section the department guard would refuse.
 */
export function sidebarGroupsFor(
  eventCode: string,
  access: TabAccess,
  department: StaffDepartment | null,
): SidebarGroup[] {
  if (access === 'client') return []

  const known = Object.keys(SECTIONS) as SectionId[]
  const ordered: SectionId[] = [
    ...SIDEBAR_ORDER,
    ...known.filter((id) => !SIDEBAR_ORDER.includes(id)),
  ]

  // Decide membership in one pass so the second pass can de-duplicate a
  // borrowed child against a section that is already a top-level entry.
  const shown = ordered.filter((id) => isShown(id, access, department))
  const shownSet = new Set<SectionId>(shown)
  return shown.map((id) => {
    const def = SECTIONS[id]
    const href = sectionRoot(eventCode, id)
    const items = visibleChildren(def, access, department)
      .filter((child) => {
        // A borrowed child (`Hampers`, `Setup`) whose destination is itself a
        // top-level entry is not repeated a level down. Without this, Hampers
        // appears twice for an event lead: once as its own section and again
        // under Hospitality.
        if (!child.href) return true
        return !(child.href in SECTIONS && shownSet.has(child.href as SectionId))
      })
      .map((child) => ({
        key: `${id}:${child.segment}`,
        href: childHref(eventCode, id, child),
        label: child.label,
        icon: child.icon,
        sectionId: id,
        childSegment: child.segment,
      }))

    return { id, href, label: def.tabLabel, icon: def.icon, items }
  })
}