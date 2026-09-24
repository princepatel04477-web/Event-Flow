'use client'

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { EventStoreEngine } from './engine'
import { emptyState } from './snapshot'
import type { EventState } from './types'

/**
 * The React surface over `EventStoreEngine`.
 *
 * `useSyncExternalStore`, not a Context value holding the state. A context
 * whose value is the state re-renders every consumer on every change — every
 * write on the floor would re-render the tab bar, the header, and every
 * screen's every row. `useSyncExternalStore` subscribes each COMPONENT to the
 * engine and re-renders only those whose selected slice changed, which is what
 * makes "the tap paints now" true on a cheap Android instead of "the tap
 * schedules a lot of work".
 *
 * SELECTORS MUST BE CHEAP. The selector is called on every engine change (and
 * on every render), so all the expensive derivations live in `selectors.ts`
 * behind a WeakMap keyed on the state object. A screen passes
 * `selectRoomsGrid`, which is a map lookup on the second and later calls.
 */

const EventStoreContext = createContext<EventStoreEngine | null>(null)

/** Rendered when a component is outside the provider (a test, or a stray page). */
const DETACHED_STATE = emptyState('detached')

const NOOP_SUBSCRIBE = (): (() => void) => () => {}

/** `useLayoutEffect` on the client, `useEffect` on the server (no SSR warning). */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Own the engine for one event.
 *
 * `key={eventId}` on the inner component is what makes an event switch safe:
 * `EventSwitcher` navigates to another `[eventCode]` under the SAME layout, so
 * without a key the engine would keep serving the previous event's rows under
 * the new event's header — a cross-tenant leak of exactly the kind the
 * event-scoped query keys exist to prevent (see `lib/query/keys.ts`).
 */
export function EventStoreProvider({
  eventId,
  children,
}: {
  eventId: string
  children: ReactNode
}) {
  return (
    <EngineForEvent key={eventId} eventId={eventId}>
      {children}
    </EngineForEvent>
  )
}

function EngineForEvent({ eventId, children }: { eventId: string; children: ReactNode }) {
  const [engine] = useState(() => new EventStoreEngine(eventId))

  // LAYOUT EFFECT, so hydration starts before the browser paints. The
  // IndexedDB read is still asynchronous — no first frame after a cold reopen
  // can contain the data — but nothing on the path touches the network, and a
  // warm cache lands one frame later rather than after a round trip to Seoul.
  useIsomorphicLayoutEffect(() => {
    engine.start()
    return () => engine.stop()
  }, [engine])

  return <EventStoreContext.Provider value={engine}>{children}</EventStoreContext.Provider>
}

/** The engine, or null outside the provider. */
export function useEventStoreEngine(): EventStoreEngine | null {
  return useContext(EventStoreContext)
}

/**
 * Subscribe to one slice of the event.
 *
 * `isEqual` exists for the selectors that return a fresh array or object every
 * time (search results, the rooms grid). Without it, `useSyncExternalStore`
 * would see a new value on every call and re-render in a loop; with it, a
 * recomputation that produces an equal value keeps the previous identity and
 * skips the render. The default is `Object.is`, which is right for the
 * primitives (`state.mode`, `state.status`) most callers need.
 */
export function useEventStore<T>(
  selector: (state: EventState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const engine = useContext(EventStoreContext)
  const last = useRef<{ state: EventState; value: T } | null>(null)

  const getSnapshot = (): T => {
    const state = engine ? engine.getState() : DETACHED_STATE
    const previous = last.current
    if (previous && previous.state === state) return previous.value
    const value = selector(state)
    if (previous && isEqual(previous.value, value)) {
      // Keep the PREVIOUS value's identity, not just its equality. React
      // compares what `getSnapshot` returns between calls, so returning `value`
      // here (equal but a different reference) would re-render on every engine
      // change even when the slice did not move.
      last.current = { state, value: previous.value }
      return previous.value
    }
    last.current = { state, value }
    return value
  }

  return useSyncExternalStore(
    engine ? engine.subscribe : NOOP_SUBSCRIBE,
    getSnapshot,
    // The same function for the server snapshot: the engine's initial state is
    // deterministic and identical on both sides, so hydration never has to
    // reconcile two different trees.
    getSnapshot,
  )
}

/**
 * Which data source the screens should use.
 *
 * `fallback` means the `event_snapshot` RPC is not in this database, so the
 * screens read exactly as they did before this job existed. Screens branch on
 * this and NOT on `status`: a screen must still run its old `useQuery` (with
 * `enabled: false` while the store is live) so that flipping to fallback is a
 * render, not a code path nobody has exercised.
 */
export function useEventStoreMode(): EventState['mode'] {
  return useEventStore((state) => state.mode)
}

/** One small pill, and only after the silence has lasted. */
export function useEventStoreStale(): number | null {
  return useEventStore((state) => state.staleForMs)
}

/** Rows the payload parser refused. Non-zero means a shape change to look at. */
export function useEventStoreDropped(): number {
  return useEventStore((state) => state.dropped)
}
