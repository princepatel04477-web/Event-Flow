'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { SidebarGroup } from '@/lib/sections/sidebar'
import { v3ActiveChild, v3ActiveSection } from '@/lib/sections/v3'
import { cn } from '@/lib/utils'

/**
 * The desktop sidebar, shown at >= 1024px only.
 *
 * STRUCTURE, NOT A SECOND NAV. It renders the groups the server resolved from
 * `SECTIONS` (`sidebarGroupsFor`) and nothing else — it never decides who may
 * see a section, so the sidebar and the phone's bottom bar cannot disagree
 * about access.
 *
 * MOBILE IS UNTOUCHED. The root is `hidden ... lg:flex`, so below 1024px this
 * element generates no box at all; the bottom bar it replaces is hidden with
 * `lg:hidden`. Both changes are `lg:`-prefixed, so the phone path paints the
 * same pixels it did before this file existed.
 *
 * KEYBOARD AND MOUSE. Every entry is a real `<Link>`, so tab order follows DOM
 * order, Enter activates and Escape needs no handling (nothing here opens an
 * overlay to dismiss). Each row carries a visible focus ring and a hover state
 * at the 44px target the rest of the app uses.
 */
export function AppSidebar({ groups }: { groups: SidebarGroup[] }) {
  const pathname = usePathname()
  // segments = [eventCode, ...rest]. The event code is sliced off for the same
  // reason AppTabs slices it: the highlight rules only need what follows it.
  const rest = pathname.split('/').filter(Boolean).slice(1).join('/')

  if (groups.length === 0) return null

  const activeSection = v3ActiveSection(rest)
  const activeChild = v3ActiveChild(rest)

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-rule bg-nav px-3 py-4 lg:flex"
    >
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">        {groups.map((group) => {
          const groupActive = activeSection === group.id
          const childActive = groupActive ? activeChild : null
          return (
            <li key={group.id}>
              <Link
                href={group.href}
                aria-current={groupActive && childActive === null ? 'page' : undefined}
                className={cn(
                  'tap flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium',
                  'transition-colors duration-press ease-ledger',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
                  groupActive ? 'bg-brand-tint text-brand' : 'text-ink hover:bg-surface-2',
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">{group.icon}</span>
                <span className="truncate">{group.label}</span>
              </Link>              {group.items.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5 pl-9">
                  {group.items.map((item) => {
                    const itemActive = groupActive && childActive === item.childSegment
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          aria-current={itemActive ? 'page' : undefined}
                          className={cn(
                            'flex min-h-11 items-center rounded-lg px-3 text-sm',
                            'transition-colors duration-press ease-ledger',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
                            itemActive ? 'text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink',
                          )}
                        >
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default AppSidebar