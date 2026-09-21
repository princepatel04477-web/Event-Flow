import type { Database } from '@/lib/supabase/database.types'

/**
 * One factory for every cache key in the app.
 *
 * WHY THIS FILE EXISTS. TanStack Query dedupes and invalidates by key identity,
 * so two call sites that build "the same" key by hand in two shapes silently
 * stop sharing a cache entry and stop invalidating each other. Hand-built keys
 * are how a cache layer rots: it keeps working, it just quietly re-fetches, and
 * nobody can see it from the outside. So the shape lives in exactly one place.
 *
 * EVERY KEY BEGINS WITH THE EVENT ID, and `tests/query-keys.test.ts` enforces
 * it. This is a tenancy boundary, not tidiness: the same browser can hold two
 * events (`EventSwitcher`), and a key that is not event-scoped would let one
 * event's rows paint under another event's header. The prefix makes that
 * unrepresentable rather than merely unlikely.
 */

type RsvpStatus = Database['app']['Enums']['rsvp_status']
type Side = Database['app']['Enums']['side']
/** The calling-queue filters, as they appear in the URL. */
export type QueueFiltersKey = {
  statuses: readonly RsvpStatus[]
  side: Side | null
  callbackScheduled: boolean
  hideLocked: boolean
}

/** Anything that can sit in a query key. Matches TanStack's own constraint. */
type KeyPart =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly KeyPart[]
  | { readonly [key: string]: KeyPart }

/** `['event', <eventId>, ...]` — the shape every key in this app must have. */
export type EventQueryKey = readonly ['event', string, ...ReadonlyArray<KeyPart>]

function eventKey<T extends ReadonlyArray<KeyPart>>(
  eventId: string,
  ...parts: T
): readonly ['event', string, ...T] {
  return ['event', eventId, ...parts] as const
}

/**
 * The filter object is normalised before it enters the key, so two filter sets
 * that mean the same thing produce the same cache entry. Without this, a
 * `statuses: []` and a `statuses: undefined` — or the same chips selected in a
 * different order — would be different keys for identical rows, and the cache
 * would miss every time the URL round-tripped.
 */
function normalizeQueueFilters(filters: QueueFiltersKey): KeyPart {
  return {
    // Sorted AND deduped. `['confirmed','confirmed']` and `['confirmed']` produce
    // the identical SQL `.in`, so they must produce the identical key — sorting
    // alone left them as two entries for one query.
    statuses: [...new Set(filters.statuses)].sort(),
    // `?? null`, because `undefined` and `null` mean the same thing here but
    // stringify differently: `{side: undefined}` drops the property entirely
    // while `{side: null}` keeps it, so the two would be different cache
    // entries for the same filter state.
    side: filters.side ?? null,
    callbackScheduled: filters.callbackScheduled,
    hideLocked: filters.hideLocked,
  }
}

export const queryKeys = {
  dashboard: {
    board: (eventId: string) => eventKey(eventId, 'dashboard', 'board'),
  },

  guests: {
    list: (eventId: string) => eventKey(eventId, 'guests', 'list'),
    search: (eventId: string, term: string) => eventKey(eventId, 'guests', 'search', term),
  },

  families: {
    /** One family's RSVP record — the screen the caller logs an outcome on. */
    detail: (eventId: string, groupId: string) => eventKey(eventId, 'family', groupId),
  },

  rsvp: {
    queue: (eventId: string, filters: QueueFiltersKey) =>
      eventKey(eventId, 'rsvp', 'queue', normalizeQueueFilters(filters)),
  },

  logistics: {
    arrivals: (eventId: string) => eventKey(eventId, 'logistics', 'arrivals'),
  },

  hospitality: {
    /** The check-in / check-out board. */
    checkIn: (eventId: string) => eventKey(eventId, 'hospitality', 'checkin'),
  },

  rooms: {
    /** The grid. Already a Query consumer before this file existed. */
    grid: (eventId: string) => eventKey(eventId, 'rooms', 'grid'),
  },

  deliveries: {
    list: (eventId: string) => eventKey(eventId, 'deliveries', 'list'),
    detail: (eventId: string, deliverableId: string) =>
      eventKey(eventId, 'deliveries', 'detail', deliverableId),
  },
} as const

export default queryKeys
