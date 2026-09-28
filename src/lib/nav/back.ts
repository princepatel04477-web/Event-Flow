import { adminHeaderFor } from '@/lib/admin/header'

/**
 * What the Android back button does (UI4 Part S, rule N4).
 *
 * WHY. `NativeBridge` used to call `history.back()` whenever the WebView could
 * go back, and exit otherwise. Three failures fell out of that:
 * - with a sheet open, back navigated the page underneath away;
 * - after hopping Today → Calls → Hospitality → Calls, back walked through
 *   every tab switch instead of leaving the tab;
 * - a screen opened by a deep link (no history) exited the app outright.
 *
 * The order, first match wins:
 * 1. a sheet is open            → close it
 * 2. the previous screen is in the SAME tab → history back
 * 3. this is a detail screen    → go up to the list it belongs to
 * 4. this is a tab's screen, not the landing tab → go to the landing tab
 * 5. on the landing tab         → "press back again to close" (2s), then exit
 *
 * Pure: every input is passed in, so each branch has a test.
 */

export type BackAction =
  | { type: 'close-sheet' }
  | { type: 'history-back' }
  | { type: 'go'; href: string }
  | { type: 'confirm-exit' }
  | { type: 'exit' }

export interface BackState {
  /** Open sheets and dialogs (see `sheet-stack`). */
  openSheets: number
  /** The current pathname. */
  current: string
  /** The pathname before this one in THIS session, if the app recorded one. */
  previous: string | null
  /** Where this viewer lands (Today for a lead, their section for a runner). */
  landing: string | null
  /** Timestamp of the last back press that asked to confirm exit. */
  lastExitPromptAt: number | null
  now: number
}

/** Two presses within this window close the app. */
export const EXIT_WINDOW_MS = 2000

/** Paths outside the event URL space. */
const NON_EVENT = ['login', 'admin', 'auth', 'pick-staff', 'api', 'debug', 'design-system', 'v2']

/**
 * Where "up" goes from a detail screen when dropping the last segment would
 * land on a route that does not exist, or on the wrong list.
 */
const PARENT_OVERRIDES: Record<string, string> = {
  'rsvp/call': 'rsvp/queue',
  'rsvp/status': 'rsvp/queue',
}

function segments(path: string): string[] {
  return path.split('?')[0].split('#')[0].split('/').filter(Boolean)
}

/** `/{e}/hospitality/rooms/12` → { event: 'E', rest: ['hospitality','rooms','12'] }, or null off-event. */
function eventPath(path: string): { event: string; rest: string[] } | null {
  const seg = segments(path)
  if (seg.length === 0 || NON_EVENT.includes(seg[0])) return null
  return { event: seg[0], rest: seg.slice(1) }
}

/** The tab a path belongs to: its first segment after the event ('' = Today). */
export function tabOf(path: string): string | null {
  const ep = eventPath(path)
  if (ep) return ep.rest[0] ?? ''
  const seg = segments(path)
  // Admin tools are Control's screens on a phone.
  if (seg[0] === 'admin' && seg[1] === 'events' && seg[2]) return 'control'
  return null
}

/** The screen one level up from a detail screen, or null if this is not a detail. */
export function parentOf(path: string): string | null {
  const seg = segments(path)
  if (seg[0] === 'admin') {
    if (seg.length <= 1) return null
    return adminHeaderFor(`/${seg.join('/')}`).backHref
  }
  const ep = eventPath(path)
  if (!ep) return null
  // Tab-level screens: Today, a section, or a section's list (depth <= 2).
  if (ep.rest.length <= 2) return null
  const key = ep.rest.slice(0, 2).join('/')
  const up = PARENT_OVERRIDES[key] ?? ep.rest.slice(0, -1).join('/')
  return `/${ep.event}/${up}`
}

export function resolveBack(state: BackState): BackAction {
  if (state.openSheets > 0) return { type: 'close-sheet' }

  const { current, previous } = state
  const tab = tabOf(current)

  if (previous && previous !== current && tab !== null && tabOf(previous) === tab) {
    return { type: 'history-back' }
  }

  const up = parentOf(current)
  if (up) return { type: 'go', href: up }

  if (tab !== null && state.landing) {
    const onLanding =
      segments(current).join('/') === segments(state.landing).join('/') ||
      (tabOf(state.landing) === tab && (eventPath(current)?.rest.length ?? 0) <= 2)
    if (!onLanding) return { type: 'go', href: state.landing }
  } else if (tab === null && previous && previous !== current) {
    // Off the event (sign-in, pick-staff): plain history is the right answer.
    return { type: 'history-back' }
  }

  if (state.lastExitPromptAt !== null && state.now - state.lastExitPromptAt < EXIT_WINDOW_MS) {
    return { type: 'exit' }
  }
  return { type: 'confirm-exit' }
}

// ---------------------------------------------------------------------------
// Session state the native handler reads. Module-level because the back
// button is a native event that arrives outside any component tree.
// ---------------------------------------------------------------------------

const visited: string[] = []
let landingHref: string | null = null

/** Record a navigation. Called by `NavTracker` on every pathname change. */
export function recordVisit(path: string): void {
  if (visited[visited.length - 1] === path) return
  visited.push(path)
  if (visited.length > 50) visited.shift()
}

/** Forget the newest entry — the back handler calls this after history.back(). */
export function dropLastVisit(): void {
  visited.pop()
}

export function previousVisit(): string | null {
  return visited.length >= 2 ? visited[visited.length - 2] : null
}

export function setLanding(href: string): void {
  landingHref = href
}

export function getLanding(): string | null {
  return landingHref
}
