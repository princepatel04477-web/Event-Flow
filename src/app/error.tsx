'use client'

import { useEffect } from 'react'

import { RefreshIcon, ShieldAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'

/**
 * The app-wide safety net.
 *
 * `[eventCode]/error.tsx` cannot catch a throw in its OWN layout — a React
 * error boundary never catches the segment it belongs to — so a failure in
 * `(staff)/[eventCode]/layout.tsx` (the viewer lookup, the event resolve, the
 * access check) bubbles past it. Without a boundary at this level it reaches
 * Next's built-in handler, which renders a BARE WHITE PAGE in production with
 * no header, no way back, and nothing to report.
 *
 * That is the difference between "the app is broken" and "tell your admin
 * this code". Staff at a venue can act on the second.
 *
 * Deliberately does NOT print `error.message`: everything reaching here is
 * infrastructure, and its text is Postgres or GoTrue wording, which the voice
 * rule keeps off the screen. `digest` is the server-side correlation id and is
 * safe — it is the thing that makes the failure diagnosable afterwards.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Server logs already hold the stack; this is for the browser console when
    // someone is debugging on a real handset over USB.
    console.error('App failed:', error)
  }, [error])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-paper px-6 py-10 text-center px-safe">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-full bg-red-tint text-ledger-red"
      >
        <ShieldAlertIcon className="h-7 w-7" />
      </span>

      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-medium text-balance text-ink">
          This screen did not load
        </h1>
        <p className="text-base leading-snug text-balance text-muted">
          Something went wrong before the page could be drawn. It is usually the
          connection — try again, and if it keeps happening tell your admin.
        </p>
        {error.digest ? (
          <p className="figure mt-1 text-xs text-muted">Reference {error.digest}</p>
        ) : null}
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2.5">
        <Button
          size="lg"
          fullWidth
          onClick={reset}
          leadingIcon={<RefreshIcon className="h-5 w-5" />}
        >
          Try again
        </Button>
        {/* An escape hatch that does not depend on whatever just failed. */}
        <LinkButton href="/" variant="secondary" size="lg" fullWidth>
          Back to my events
        </LinkButton>
      </div>
    </main>
  )
}
