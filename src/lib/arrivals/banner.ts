/**
 * The arrival banner's arithmetic, as pure functions.
 *
 * WHY THIS IS A MODULE AND NOT INLINE IN THE COMPONENT. Two sentences carry
 * the whole feature — "3 arriving in the next 60 min" and "Sharma family
 * arrived · Room 705" — and every way they go wrong is a wrong NUMBER or a
 * wrong MINUTE, which is exactly what `tests/arrival-banner.test.ts` can pin
 * without a database, a clock or a React renderer.
 *
 * The window is 60 minutes and the arrival highlight is 15. Both are named
 * constants because they are the two dials this feature has.
 */

/** How far ahead "arriving" looks. */
export const ARRIVAL_WINDOW_MINS = 60

/** How long after an arrival the banner keeps naming the family. */
export const ARRIVED_HIGHLIGHT_MINS = 15

/** One arrival leg, flattened to what the banner reads. */
export interface ArrivalLeg {
  legId: string
  groupId: string
  headName: string
  /** `YYYY-MM-DD` — `travel_legs.travel_date`. */
  travelDate: string | null
  /** `HH:MM` or `HH:MM:SS` — `travel_legs.travel_time`. */
  travelTime: string | null
  /** Server-stamped arrival instant, ISO. Null = not yet arrived. */
  arrivedAt: string | null
  /** The family's room number, when they have one. */
  roomNumber: string | null
}

export interface ArrivalBannerData {
  /** Legs not yet arrived whose scheduled time is inside the window. */
  arrivingCount: number
  windowMins: number
  /** The most recent arrival inside the highlight window, if any. */
  latest: { groupId: string; headName: string; roomNumber: string | null } | null
}

/** The exact instant a leg is due, or null when it has no usable time. */
function legInstant(leg: ArrivalLeg): number | null {
  if (!leg.travelDate || !leg.travelTime) return null
  // `HH:MM:SS` and `HH:MM` both parse; anything else is treated as no time.
  const match = /^(\d{1,2}):(\d{2})/.exec(leg.travelTime)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  const iso = `${leg.travelDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
  const instant = Date.parse(iso)
  return Number.isNaN(instant) ? null : instant
}

/**
 * What the banner says, or null when it has nothing to say.
 *
 * A RECENT ARRIVAL BEATS AN UPCOMING COUNT: "Sharma family arrived" is news the
 * coordinator acts on now (greet them, note the room), and it is the rarer
 * event, so it takes the banner while it is fresh. After the highlight window
 * the banner falls back to the count.
 *
 * A family with no recorded time is never "arriving" — an absent time is not
 * "now", and counting it would put a permanent false number on the banner.
 */
export function arrivalBanner(legs: readonly ArrivalLeg[], now: Date): ArrivalBannerData | null {
  const nowMs = now.getTime()
  const windowEnd = nowMs + ARRIVAL_WINDOW_MINS * 60_000

  let arrivingCount = 0
  let latest: ArrivalBannerData['latest'] = null
  let latestMs = -Infinity

  for (const leg of legs) {
    if (leg.arrivedAt === null) {
      const due = legInstant(leg)
      if (due !== null && due > nowMs && due <= windowEnd) arrivingCount += 1
      continue
    }

    const arrivedMs = Date.parse(leg.arrivedAt)
    if (Number.isNaN(arrivedMs)) continue
    const ageMins = (nowMs - arrivedMs) / 60_000
    if (ageMins < 0 || ageMins > ARRIVED_HIGHLIGHT_MINS) continue

    if (arrivedMs > latestMs) {
      latestMs = arrivedMs
      latest = { groupId: leg.groupId, headName: leg.headName, roomNumber: leg.roomNumber }
    }
  }

  if (!latest && arrivingCount === 0) return null
  return { arrivingCount, windowMins: ARRIVAL_WINDOW_MINS, latest }
}

/** The one sentence the banner shows. */
export function bannerText(data: ArrivalBannerData): string {
  if (data.latest) {
    const room = data.latest.roomNumber ? ` · Room ${data.latest.roomNumber}` : ''
    return `${data.latest.headName} family arrived${room}`
  }
  const n = data.arrivingCount
  return `${n} ${n === 1 ? 'family' : 'families'} arriving in the next ${data.windowMins} min`
}
