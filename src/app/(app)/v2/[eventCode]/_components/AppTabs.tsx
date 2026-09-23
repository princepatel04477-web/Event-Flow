'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useBoundedPrefetch } from '@/lib/query/prefetch'
import { cn } from '@/lib/utils'
import { resolveActive, type NavTab, type TabAccess } from '@/lib/sections/config'
import { v3ActiveChild, v3ActiveSection } from '@/lib/sections/v3'

export type { TabAccess }

export interface AppTabsProps {
  /**
   * The tab SET, already resolved by the server layout.
   *
   * Who may see which section stays in `src/lib/sections` — this component
   * only renders the list it is handed, and a tab the model withholds must
   * not be reinstated here by accident. The shell resolves the list once (it
   * needs the length for the `pb-nav` clearance as well), so this renders
   * that one list rather than resolving it a second time: the bar and the
   * page clearance reading the SAME value is the invariant that stopped them
   * disagreeing in v1.
   */
  tabs: NavTab[]
  /**
   * Which tab model produced `tabs`, and therefore how a destination is
   * mapped and which tab lights up.
   *
   * - `v3` (default) — the five-tab bar in `src/lib/sections/v3.ts`. Hrefs
   *   are rendered as the model built them, and highlighting uses
   *   `v3ActiveSection` / `v3ActiveChild`, which resolve a borrowed child to
   *   its host.
   * - `legacy` — the v1/v2 shared model. Kept because the v1 shell and its
   *   tests still run against it; the `rsvp/campaigns` → `rsvp/queue` remap
   *   below is v2's, not v3's.
   */
  model?: 'v3' | 'legacy'
}

/**
 * New-shell destination for a tab the shared config points at (the `legacy`
 * model only).
 *
 * WHY THIS EXISTS AT ALL. `src/lib/sections/config.tsx` is shared with v1 and
 * sends each section tab to that section's DEFAULT child:
 *
 *     Calls -> /{event}/rsvp/campaigns      (config.tsx, `isDefault: true`)
 *
 * v1's Calls tab landing on Auto-call is correct for v1 — that is the screen an
 * event lead works from. It is the wrong destination in the v2 UI, where the
 * bar's job is "call the next family in one tap" and the screen that does it is
 * `rsvp/queue`.
 *
 * WHY NOT EDIT THE CONFIG. Three reasons, in order of how expensive they are to
 * be wrong about: the config is shared with v1, so a change there moves v1's tab
 * too; `tests/nav-model.test.ts` pins the legacy hrefs deliberately ("lands each
 * tab on its default child, not a bare section root"); and one mapping in one
 * place is the only version of this that can be tested.
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
 * The bottom bar.
 *
 * A near-copy of `src/components/nav/BottomTabs.tsx` (which serves v1),
 * deliberately rather than by import, because the two differ in which href
 * each tab renders and in how the active tab is chosen. Everything else — the
 * classes, the `aria-label`, the 44px targets and the V4 arm-on-touch prefetch
 * — is copied verbatim so the bar does not quietly develop two layouts. Keep
 * them in step.
 *
 * The prefetch rules still apply unchanged and are the reason the copy carries
 * its warning: a full prefetch is a real server render of the destination, so an
 * armed tab must only READ. Every destination the v3 bar can reach is a read:
 * the one that used to write on render was `rsvp/campaigns` (`ensureCampaigns`
 * inserted the default draft waves), and no v3 tab points at it.
 */
export function AppTabs({ tabs, model = 'v3' }: AppTabsProps) {
  const pathname = usePathname()
  // segments = [eventCode, ...rest]. The event code is sliced off because this
  // component renders inside the rewritten (internal) URL when the proxy is on,
  // and inside the plain one when it is not — the rest is the same either way,
  // and the rest is all the highlight rules need.
  const rest = pathname.split('/').filter(Boolean).slice(1).join('/')

  // Above any early return below, because hooks are.
  const { isArmed, arm } = useBoundedPrefetch()

  if (tabs.length === 0) return null

  // The v3 model resolves a borrowed child to its host tab; the legacy model
  // reads the shared `resolveActive`. Both are pure.
  const active = model === 'v3' ? null : resolveActive(rest)
  const activeSection = model === 'v3' ? v3ActiveSection(rest) : active?.sectionId ?? null
  const activeChild = model === 'v3' ? v3ActiveChild(rest) : active?.childSegment ?? null

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 z-40 border-t border-rule bg-nav pb-safe px-safe transition-[bottom] duration-press ease-ledger"
      style={{ bottom: 'var(--keyboard-offset, 0px)' }}
    >
      <ul
        className="mx-auto grid w-full max-w-[480px]"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const href = model === 'v3' ? tab.href : tabHrefFor(tab.href)

          // A section tab lights for anything inside its section; a runner's
          // child tab has to match the child too, since every tab they have is
          // in the same section.
          //
          // Keyed on the tab's OWN identifying fields, never on the mapped
          // href: the legacy Calls tab renders `/rsvp/queue` while still being
          // the `rsvp` section tab, and matching it against `queue` would leave
          // it permanently unlit.
          const isActive =
            tab.childSegment === null
              ? activeSection === tab.sectionId
              : activeSection === tab.sectionId && activeChild === tab.childSegment

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
                prefetch={isArmed(href) ? true : undefined}
                onPointerDown={() => arm(href)}
                onTouchStart={() => arm(href)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'tap relative flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 py-2',
                  'text-xs leading-tight font-medium',
                  'transition-colors duration-press ease-ledger',
                  isActive ? 'text-brand' : 'text-muted active:text-ink',
                )}
              >
                {/* The active tab is a maroon icon in a tint pill (v3),
                    rather than a bar along the top edge (v2). The pill is
                    36px wide and 28px tall — wider than the 24px glyph, so
                    it reads as a seat for the icon rather than a box around
                    it — and it is the only tinted shape in the bar. */}
                <span
                  className={cn(
                    'flex h-7 w-9 items-center justify-center rounded-full transition-colors duration-press ease-ledger',
                    isActive ? 'bg-brand-tint text-brand' : 'text-muted',
                  )}
                >
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
