'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useBoundedPrefetch } from '@/lib/query/prefetch'
import { cn } from '@/lib/utils'
import { resolveActive, type NavTab, type TabAccess } from '@/lib/sections/config'

export type { TabAccess }

export interface AppTabsProps {
  /**
   * The tab SET, already resolved by the server layout.
   *
   * Who may see which section is `bottomTabsFor`'s business and stays there
   * untouched — this component only re-points the destinations, and a tab that
   * `bottomTabsFor` withholds must not be reinstated here by accident. The
   * shell resolves the list once (it needs the length for the `pb-nav`
   * clearance as well), so this renders that one list rather than calling
   * `bottomTabsFor` a second time: the bar and the page clearance reading the
   * SAME value is the invariant that stopped them disagreeing in v1.
   */
  tabs: NavTab[]
}

/**
 * New-shell destination for a tab the shared config points at.
 *
 * WHY THIS EXISTS AT ALL. `src/lib/sections/config.tsx` is shared with v1 and
 * is off limits, and it sends each section tab to that section's DEFAULT child:
 *
 *     Calls -> /{event}/rsvp/campaigns      (config.tsx, `isDefault: true`)
 *
 * v1's Calls tab landing on Auto-call is correct for v1 — that is the screen an
 * event lead works from. It is the wrong destination in the new UI, where the
 * bar's job is "call the next family in one tap" and the screen that does it is
 * `rsvp/queue`. Left alone, the new UI's most important tab opens a legacy
 * auto-call wizard.
 *
 * WHY NOT EDIT THE CONFIG. Three reasons, in order of how expensive they are to
 * be wrong about: the config is shared with v1, so a change there moves v1's tab
 * too; `tests/nav-model.test.ts` pins the legacy hrefs deliberately ("lands each
 * tab on its default child, not a bare section root"); and one mapping in one
 * place is the only version of this that can be tested. The tab SET still comes
 * from `bottomTabsFor` — this function maps destinations, it does not decide
 * access.
 *
 * A pure function with no React in it, so `tests/v2-route-parity.test.ts` can
 * assert it without a renderer.
 */
export function tabHrefFor(href: string): string {
  // The ONLY remap. Every other default child is either a real screen in the
  // new group (`guests/list`, `rooms`, `arrivals`) or a shim of the legacy one.
  if (href.endsWith('/rsvp/campaigns')) return href.replace(/\/rsvp\/campaigns$/, '/rsvp/queue')
  return href
}

/**
 * The bottom bar for the new shell.
 *
 * A near-copy of `src/components/nav/BottomTabs.tsx`, deliberately rather than
 * by import, because the two differ in exactly one thing: which href each tab
 * renders. Everything else — the classes, the `aria-label`, the active-tab rule,
 * the 44px targets and the V4 arm-on-touch prefetch — is copied verbatim so the
 * bar does not quietly develop two layouts. Keep them in step.
 *
 * The prefetch rules still apply unchanged and are the reason the copy carries
 * its warning: a full prefetch is a real server render of the destination, so an
 * armed tab must only READ. All five destinations the bar can reach do; the one
 * that used to write on render was `rsvp/campaigns` (`ensureCampaigns` inserted
 * the default draft waves), and the remap above moves the Calls tab off it
 * entirely. See `src/lib/query/prefetch.ts`.
 */
export function AppTabs({ tabs }: AppTabsProps) {
  const pathname = usePathname()
  // segments = [eventCode, ...rest]. The event code is slice(1)'d off because
  // this component is rendered inside the rewritten (internal) URL when the
  // proxy is on, and inside the plain one when it is not — the rest is the same
  // either way, and the rest is all `resolveActive` needs.
  const rest = pathname.split('/').filter(Boolean).slice(1).join('/')

  // Above the early return below, because hooks are.
  const { isArmed, arm } = useBoundedPrefetch()

  if (tabs.length === 0) return null

  const active = resolveActive(rest)

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 z-40 border-t border-rule-strong bg-nav pb-safe px-safe transition-[bottom] duration-press ease-ledger"
      style={{ bottom: 'var(--keyboard-offset, 0px)' }}
    >
      <ul className="mx-auto grid w-full max-w-[480px]" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const href = tabHrefFor(tab.href)

          // A section tab lights for anything inside its section; a runner's
          // child tab has to match the child too, since every tab they have is
          // in the same section.
          //
          // Keyed on the tab's OWN identifying fields, never on the mapped
          // href: the Calls tab renders `/rsvp/queue` while still being the
          // `rsvp` section tab, and matching it against `queue` would leave it
          // permanently unlit.
          const isActive = tab.childSegment === null
            ? active.sectionId === tab.sectionId
            : active.sectionId === tab.sectionId && active.childSegment === tab.childSegment

          return (
            <li key={tab.key} className="relative">
              <Link
                href={href}
                // FULL prefetch — the route AND its data — not Next's default.
                // The default for a dynamic route is a PARTIAL prefetch that
                // stops at the nearest `loading.tsx`, so it warms a skeleton and
                // the tap still crosses to Seoul. Armed on TOUCH, never on
                // mount: measured at n=5, five eager prefetches on the venue-Wi-Fi
                // profile made every route SLOWER, not faster. Numbers in
                // DECISIONS.md, 21 September 2026.
                //
                // `tabHrefFor` is applied here as well as to `href` above so the
                // armed key and the rendered href cannot drift apart — arming
                // one string and rendering another would silently disable the
                // prefetch it is meant to enable.
                prefetch={isArmed(href) ? true : undefined}
                onPointerDown={() => arm(href)}
                onTouchStart={() => arm(href)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'tap relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 py-2',
                  'text-xs leading-tight font-medium',
                  'transition-colors duration-press ease-ledger',
                  isActive ? 'text-brand' : 'text-muted active:text-ink',
                )}
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute top-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-b-sm bg-brand"
                  />
                ) : null}
                <span className={cn(isActive ? 'text-brand' : 'text-muted')}>
                  {tab.icon}
                </span>
                {/* `truncate` and `max-w-full` are load-bearing: a long tab
                    label ("Check in / out") would otherwise set the flex item's
                    min-content width and push the bar wider than the screen. */}
                <span className="max-w-full truncate">{tab.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default AppTabs
