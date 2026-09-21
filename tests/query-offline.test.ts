import { describe, it, expect, afterEach } from 'vitest'
import { QueryClient, onlineManager } from '@tanstack/react-query'

/**
 * Guards the reasoning behind `networkMode: 'always'` in
 * `src/components/providers/QueryProvider.tsx`.
 *
 * This is a regression guard for a defect that was invisible from the outside. With
 * TanStack's DEFAULT `networkMode: 'online'`, a fetch issued while offline is
 * PAUSED, not failed: the query stays `pending` with `fetchStatus: 'paused'`, no
 * error is ever set, and nothing tells the screen to stop waiting. Every screen
 * that renders a skeleton on `isPending` — which is all three of the screens V2
 * converted — would then show that skeleton for as long as the phone stayed
 * offline, with no error and no retry button.
 *
 * That is the indefinite spinner docs/INTERACTION-CONTRACT.md T7 forbids, and it
 * was worse than the TTL cache it replaced, which caught the failure and rendered
 * an ErrorState. The `retry` guard written for the offline case could not fire,
 * because a paused fetch is not a failure — so the fix had to be the network
 * mode, not the retry policy.
 *
 * These two cases assert exactly that difference. If a future change drops
 * `networkMode: 'always'`, the second case still passes (it is asserting library
 * behaviour) — so read them as the DOCUMENTED REASON, and change the provider
 * only with this file open.
 */

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('offline fetch semantics (why QueryProvider sets networkMode: always)', () => {
  it("the library default PAUSES a fetch while offline — it never rejects", async () => {
    onlineManager.setOnline(false)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pending = qc.fetchQuery({
      queryKey: ['paused-probe'],
      queryFn: async () => 'would only run online',
    })
    // The fetch is never attempted, so this promise never settles. Stop vitest
    // treating it as an unhandled rejection if a later case flips the manager.
    pending.catch(() => {})

    await Promise.resolve()

    const state = qc.getQueryState(['paused-probe'])
    expect(state?.fetchStatus, 'default networkMode pauses rather than failing').toBe('paused')
    expect(state?.status, 'and the query stays pending forever').toBe('pending')

    const settled = await Promise.race([
      pending.then(
        () => 'resolved',
        () => 'rejected',
      ),
      Promise.resolve('still-pending'),
    ])
    expect(settled, 'a paused fetch is neither resolved nor rejected').toBe('still-pending')

    qc.clear()
  })

  it("networkMode 'always' FAILS instead, which is what lets a screen show an error", async () => {
    onlineManager.setOnline(false)

    const qc = new QueryClient({
      defaultOptions: { queries: { networkMode: 'always', retry: false } },
    })

    await expect(
      qc.fetchQuery({
        queryKey: ['always-probe'],
        queryFn: async () => {
          // What a real offline fetch does: the transport rejects immediately.
          throw new Error('Could not reach the server.')
        },
      }),
    ).rejects.toThrow('Could not reach the server.')

    qc.clear()
  })
})
