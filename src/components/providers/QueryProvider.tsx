'use client'

import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { useOnline } from '@/lib/useOnline'

/**
 * The TanStack Query context, on the client side of the boundary.
 *
 * This exists because the root layout is a SERVER component. Rendering
 * `<QueryClientProvider client={queryClient}>` there fails the production
 * build outright — a QueryClient is a class instance, and React cannot
 * serialise one across the server/client boundary:
 *
 *   Error: Only plain objects, and a few built-ins, can be passed to Client
 *   Components from Server Components. Classes or null prototypes are not
 *   supported.
 *
 * It surfaces at prerender rather than at compile, so it is invisible in
 * `next dev` and only appears when someone runs `next build` — i.e. at deploy
 * time. Keeping the client construction inside a 'use client' module is the
 * whole fix: the layout now passes children, not an object.
 *
 * `useState(() => …)` rather than module scope: a module-scope client is
 * shared by every request the server process handles, so one user's cached
 * guest data can be served into another user's render. Per-mount state gives
 * each browser its own client while still being stable across re-renders,
 * which is the property the module-scope version was reaching for.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30s, matching the TTL cache in src/lib/actions/dashboard.ts and
            // the module cache this replaces (src/lib/use-stable-data.ts). Long
            // enough that a tab switch or a back-tap paints from memory, short
            // enough that two staff working the same floor never diverge for
            // longer than a coffee.
            staleTime: 30_000,

            // 15 minutes. The cache has to outlive a whole shift's worth of tab
            // hops — that is the entire point of T4 — but these are shared
            // handsets and a stale event's rows should not sit in one forever.
            gcTime: 15 * 60_000,

            // FALSE, and this one is not a tuning preference. `tel:` backgrounds
            // the WebView on EVERY call (CLAUDE.md §12), so the app is
            // backgrounded and refocused dozens of times an hour. Leaving this
            // on would re-fetch the whole screen every time a caller came back
            // from a dial — the exact round trip this session exists to remove.
            refetchOnWindowFocus: false,

            // Retry only while we believe there is a network. On venue Wi-Fi a
            // failure is usually total rather than transient, and retrying a
            // request that cannot succeed just delays the honest error state
            // the runner needs to see (docs/INTERACTION-CONTRACT.md T7).
            retry: (failureCount) => onlineManager.isOnline() && failureCount < 2,

            // Exponential backoff, capped at 8s. Uncapped doubling would leave
            // a runner staring at a spinner for over a minute on a bad link.
            retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 8_000),
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={client}>
      <OnlineBridge />
      {children}
    </QueryClientProvider>
  )
}

export default QueryProvider

/**
 * Mirrors `useOnline()` into TanStack's `onlineManager`, so `retry` above — and
 * TanStack's own behaviour when the network returns — agree with the banner the
 * user is looking at. Without this the app can show "Offline" while the query
 * client cheerfully retries, or vice versa: two sources of truth for one fact.
 *
 * Renders nothing; it exists only to hold the subscription.
 */
function OnlineBridge() {
  const online = useOnline()

  useEffect(() => {
    onlineManager.setOnline(online)
  }, [online])

  return null
}
