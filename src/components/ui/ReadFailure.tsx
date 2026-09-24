'use client'

import { useCallback } from 'react'

import { ErrorState } from '@/components/ui/ErrorState'

/**
 * The honest load-failure face for a SERVER-rendered list (M11, M15, M27, M28,
 * M42).
 *
 * WHY THIS EXISTS AT ALL. Every one of these reads had the same bug in the same
 * shape: `const { data } = await supabase…` with the `error` destructured away,
 * so a transport failure, an RLS refusal or a timeout produced an empty array
 * and the screen rendered its EMPTY state — as a statement of fact about the
 * data. "Every family has been called." "No rooms on this event yet." "Nothing
 * scheduled for Today." On a live event each of those sentences stops work, and
 * two of them actively invite duplicate data entry.
 *
 * The `error` is now checked, and this is what the screen shows instead. It is a
 * client component only because `ErrorState`'s Retry is an `onClick`; the check
 * itself is server-side, so the wrong message is never sent to the browser in
 * the first place.
 *
 * `location.reload()` RATHER THAN `router.refresh()`. These screens are server
 * components whose whole body comes from the failed read, and the failure is
 * usually the network. A soft refresh re-runs the same fetch inside the router
 * and, on a dead link, resolves to the same error with no visible change — the
 * runner taps Retry and nothing happens, which is the "dead control" this app
 * treats as a blocker. A reload is one request and it always shows either the
 * data or the same honest message.
 */
export function ReadFailure({
  what,
  detail,
}: {
  /** What could not be loaded, in the runner's words: "the calling list". */
  what: string
  /** Optional one-line detail. Never a raw PostgREST string. */
  detail?: string
}) {
  const retry = useCallback(() => {
    window.location.reload()
  }, [])

  return (
    <ErrorState
      title={`Could not load ${what}.`}
      description={
        detail ??
        'This is a connection problem on this phone, not an empty list. Everything else still works — try again in a moment.'
      }
      onRetry={retry}
    />
  )
}

export default ReadFailure
