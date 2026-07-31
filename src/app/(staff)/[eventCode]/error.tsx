'use client'

import { useEffect } from 'react'

import { RefreshIcon, ShieldAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Catches an unhandled throw anywhere in the event subtree.
 *
 * Without it, a dropped Supabase connection surfaces as Next's bare error
 * page: no header, no tab bar, no way back, and a stack trace in development.
 * A staff member on a phone at a venue cannot act on that.
 *
 * Deliberately does NOT print `error.message`. Everything reaching here is
 * infrastructure — a fetch that failed, a socket that closed — and its text
 * is Postgres or GoTrue wording, which CLAUDE.md's voice rule keeps off the
 * screen. `digest` is the server-side correlation id and is safe to show.
 *
 * NOTE: `redirect()` and `notFound()` are not errors. Next throws special
 * sentinels for both and re-catches them above this boundary, so the
 * `requireStaff` redirects pass straight through.
 */
export default function EventError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Server logs already hold the stack; this is for the browser console
    // when someone is debugging on a real device over USB.
    console.error('Event screen failed:', error)
  }, [error])

  return (
    <EmptyState
      icon={<ShieldAlertIcon className="h-7 w-7" />}
      title="This screen did not load"
      description={
        <>
          Something went wrong fetching this page. It is usually the connection — try
          again, and if it keeps happening tell your admin.
          {error.digest ? (
            <>
              {' '}
              <span className="font-mono text-xs text-subtle">({error.digest})</span>
            </>
          ) : null}
        </>
      }
      action={
        <Button
          fullWidth
          onClick={reset}
          leadingIcon={<RefreshIcon className="h-5 w-5" />}
        >
          Try again
        </Button>
      }
    />
  )
}
