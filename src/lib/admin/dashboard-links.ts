import { FILTER_CHIPS, type FilterChipId } from '@/lib/rsvp-queue'
import type { RsvpBucketId } from '@/lib/rsvp-buckets'

/**
 * Where every figure on the admin dashboard leads.
 *
 * The owner asked for every item on the dashboard to be tappable: a counter is
 * a question, and the answer is always on another screen. Kept here, pure, so
 * `tests/admin-dashboard-links.test.ts` pins each destination and a renamed
 * route fails a test instead of shipping a dead tile.
 *
 * THE CALLS SCREEN, NOT THE FAMILY RECORD. A family row opens the calling
 * screen on that family (`?family=`), never `/rsvp/status/{id}`: the record
 * CLAIMS THE CALLER LOCK on open (CLAUDE.md §6), so an admin browsing the
 * dashboard would lock families away from the people phoning them.
 */

/** The confirmation bucket each Calls filter chip corresponds to. */
const BUCKET_TO_CHIP: Record<RsvpBucketId, FilterChipId> = {
  confirmed: 'coming',
  not_coming: 'not_coming',
  // No "Maybe" chip exists on the Calls screen; "All" is the honest superset.
  maybe: 'all',
  no_answer: 'no_answer',
  not_called: 'to_call',
}

export function callsHref(eventCode: string, filter?: FilterChipId): string {
  const base = `/${eventCode}/rsvp/queue`
  return filter ? `${base}?filter=${filter}` : base
}

export function bucketHref(eventCode: string, bucket: RsvpBucketId): string {
  return callsHref(eventCode, BUCKET_TO_CHIP[bucket])
}

export function familyHref(eventCode: string, groupId: string): string {
  return `/${eventCode}/rsvp/queue?family=${encodeURIComponent(groupId)}`
}

export function dashboardLinks(eventCode: string) {
  const at = (path: string) => `/${eventCode}/${path}`
  return {
    guests: at('guests'),
    families: at('guests'),
    confirmed: callsHref(eventCode, 'coming'),
    pending: callsHref(eventCode, 'to_call'),
    roomed: at('hospitality/rooming-list'),
    rooms: at('hospitality/rooms'),
    hampersDone: at('hospitality/deliveries'),
    hampersPending: at('hospitality/deliveries'),
    spend: at('logistics/trips'),
    arrivals: at('logistics/arrivals'),
    departures: at('logistics/departures'),
  } as const
}

/** `?filter=` from the URL, or null when it is missing or not a real chip. */
export function parseFilterParam(value: string | string[] | undefined): FilterChipId | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  return FILTER_CHIPS.some((chip) => chip.id === raw) ? (raw as FilterChipId) : null
}

/** `?family=` from the URL: a uuid, or null. Anything else is ignored. */
export function parseFamilyParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null
}
