'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

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
          // 30s stale window: the rooms grid is the only consumer, and two
          // staff allocating rooms at the same time need to see each other's
          // placements without a manual refresh. retry: 1 because venue Wi-Fi
          // failures are usually total, not transient — retrying three times
          // just delays the error state the user needs to see.
          queries: { staleTime: 30_000, retry: 1 },
        },
      }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

export default QueryProvider
