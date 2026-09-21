'use client'

import Link from 'next/link'
import { useSyncExternalStore } from 'react'

import { type StaffDepartment } from '@/lib/departments'

const DISMISS_KEY = 'ef.staff-name-nudge.dismissed'

/**
 * `sessionStorage` as an external store, rather than state synced into React
 * inside an effect.
 *
 * The effect version tripped `react-hooks/set-state-in-effect`, and the rule is
 * right about this one: it has to start with a guess (shown or hidden), read
 * storage after paint, then set state — so the banner either flashes for
 * someone who already dismissed it or flashes absent for someone who has not.
 * `useSyncExternalStore` reads the real value during render on the client and
 * takes `getServerSnapshot` on the server, so there is no second pass.
 *
 * `subscribe` exists for `dismiss()` — nothing else writes this key, so there
 * is no `storage` listener. A different tab is a different session anyway.
 */
const listeners = new Set<() => void>()

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

function getSnapshot(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    // Private window, or site data blocked. Show the nudge — an unattributed
    // shift cannot be repaired afterwards (CLAUDE.md §6), so erring towards
    // asking is the cheaper mistake.
    return false
  }
}

/** Hidden during SSR, so a dismissed nudge never flashes in before hydration. */
function getServerSnapshot(): boolean {
  return true
}

function dismissNudge() {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // Blocked. The re-render below still hides it for this session in memory.
  }
  listeners.forEach((l) => l())
}

/**
 * One job: get an unnamed team member to pick their name.
 *
 * That matters more than it looks. `call_attempts` freezes the moment an
 * outcome is written and `delivery_proofs` are insert-only, so a shift worked
 * without a name selected lands unattributed and can never be back-filled —
 * not by an admin, not by the service role (CLAUDE.md §6).
 *
 * Dismissible, and shown once per session rather than on every screen, which
 * was reading as the app "bugging" people who were mid-task.
 */
export function StaffWelcomeBanner({
  department,
  staffMemberId,
}: {
  eventCode: string
  department: StaffDepartment | null
  staffMemberId: string | null
}) {
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  if (staffMemberId || dismissed) return null

  return (
    <div className="mb-3 flex items-start gap-2 rounded-xl border border-brand/25 bg-brand-tint px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">Choose your name once</p>
        <p className="mt-0.5 text-xs leading-snug text-muted">
          {department
            ? 'So calls and photos show who did them.'
            : 'Until then you only see Home.'}
        </p>
        <Link
          href="/pick-staff"
          className="tap mt-2 inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-base font-semibold text-white"
        >
          Choose your name
        </Link>
      </div>
      <button
        type="button"
        onClick={dismissNudge}
        className="tap -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted active:bg-surface-2"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
