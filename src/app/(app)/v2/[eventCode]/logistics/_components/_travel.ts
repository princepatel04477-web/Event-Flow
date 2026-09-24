/**
 * Pure view helpers for the Travel board (SPEC-V3 §4).
 *
 * These are deliberately NOT React: every one answers a question the screen
 * asks in passing — "which time slot is this row in", "what is the status
 * word", "how many people is this" — and keeping them here means vitest can
 * assert them without a renderer. The board itself is a client component with
 * a Supabase read in it; the grouping rules are not.
 *
 * Browser-safe and dependency-free: no `server-only`, no Supabase, no `next/*`.
 */

/** The two directions `travel_legs` stores. Same table, same reconciliation. */
export type TravelDirection = 'arrival' | 'departure'

/** The columns this board paints. Structurally typed so a test needs no DB. */
export interface TravelLegLike {
  id: string
  group_id: string
  mode: string | null
  travel_date: string | null
  travel_time: string | null
  reference: string | null
  point: string | null
  pax_on_leg: number | null
  arrived_at: string | null
  departed_at: string | null
}

/** The slice of `guest_groups` the board reads. */
export interface TravelGroupLike {
  id: string
  head_name: string | null
  primary_mobile: string | null
  expected_pax: number | null
  adults_confirmed: number | null
  children_confirmed: number | null
  needs_pickup: boolean | null
}

/** One row of the board: a leg, the family it belongs to, and their room. */
export interface TravelRow {
  leg: TravelLegLike
  group: TravelGroupLike
  roomLabel: string
}

const MODE_LABELS: Record<string, string> = {
  air: 'Air',
  train: 'Train',
  bus: 'Bus',
  cab: 'Cab',
  self_drive: 'Self-drive',
}

/** "Air", "Train", "Self-drive" — or the raw value if the enum grows. */
export function modeLabel(mode: string | null | undefined): string | null {
  if (!mode) return null
  return MODE_LABELS[mode] ?? mode
}

/**
 * The two modes whose `reference` is a travel document a runner reads off a
 * board and dictates.
 *
 * Only these get the mono face (README: "`code-figure` — mono for phone /
 * flight / train numbers"). A cab's reference is a vendor name and a bus's is
 * often blank; setting those in mono would spend the one visual signal mono has
 * on text that is not a code.
 */
export function isCodeMode(mode: string | null | undefined): boolean {
  return mode === 'air' || mode === 'train'
}

/**
 * The time-slot key a row is grouped under.
 *
 * `date|time`, and empty times collapse to `date|` so every untimed row on a
 * day lands in ONE slot at that day's end rather than fragmenting into one
 * group per row. The value is a map key only — the human heading is built by
 * `slotHeading`.
 */
export function slotKey(leg: TravelLegLike): string {
  return `${leg.travel_date ?? ''}|${leg.travel_time ?? ''}`
}

/** The first five characters — `travel_time` is stored as `HH:MM:SS`. */
export function shortTime(time: string | null | undefined): string | null {
  if (!time) return null
  return time.length >= 5 ? time.slice(0, 5) : time
}

/**
 * "Today · 10:30", "23 Sep · 09:15", "10:30", "Date not set".
 *
 * The `today` key is passed in rather than read from the clock, so the caller
 * decides what "today" means once per render and every row in that render
 * agrees. `dayLabel` is the caller's formatter for a date that is not today —
 * this module carries no date library and no locale assumptions.
 */
export function slotHeading(
  leg: TravelLegLike,
  todayKey: string,
  dayLabel: (date: string) => string,
): string {
  const clock = shortTime(leg.travel_time)
  if (!leg.travel_date) return clock ? `No date · ${clock}` : 'Date not set'
  const day = leg.travel_date === todayKey ? 'Today' : dayLabel(leg.travel_date)
  return clock ? `${day} · ${clock}` : day
}

/**
 * The groups of rows in the order they are painted.
 *
 * A RUN-BASED grouping, not a sort. The read already orders by `travel_date`
 * then `travel_time` server-side, and re-sorting here would be a second opinion
 * about that order — the one thing this codebase forbids (`queryKeys`'s header
 * argues it at length for cache identity). Consecutive rows sharing a slot key
 * form one group, so a family landing at the same minute as another shares a
 * heading, and a late-added untimed row stays where the read put it.
 */
export function groupBySlot(rows: readonly TravelRow[]): { key: string; rows: TravelRow[] }[] {
  const groups: { key: string; rows: TravelRow[] }[] = []
  for (const row of rows) {
    const key = slotKey(row.leg)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(row)
    else groups.push({ key, rows: [row] })
  }
  return groups
}

/**
 * How many people are travelling.
 *
 * The confirmed split wins when it exists; otherwise the RSVP's expected count;
 * otherwise positive `pax_on_leg`. Zero means "nobody wrote a number down",
 * and the caller renders that as a dash rather than as "0 guests" — a family
 * standing in a lobby with "0 guests" on the screen is worse than a blank.
 */
export function paxCount(row: TravelRow): number {
  const confirmed = (row.group.adults_confirmed ?? 0) + (row.group.children_confirmed ?? 0)
  if (confirmed > 0) return confirmed
  if ((row.group.expected_pax ?? 0) > 0) return row.group.expected_pax ?? 0
  return row.leg.pax_on_leg ?? 0
}

/** "6 guests", "1 guest", or `null` when nobody recorded a number. */
export function paxLabel(count: number): string | null {
  if (count <= 0) return null
  return `${count} ${count === 1 ? 'guest' : 'guests'}`
}

/** Has this leg been met / waved off? The column depends on the direction. */
export function isDone(row: TravelRow, direction: TravelDirection): boolean {
  return direction === 'arrival' ? row.leg.arrived_at !== null : row.leg.departed_at !== null
}

/** The one status WORD on a row: "Met", "Expected", "Gone", "To go". */
export function statusLabel(row: TravelRow, direction: TravelDirection): string {
  if (isDone(row, direction)) return direction === 'arrival' ? 'Met' : 'Gone'
  return direction === 'arrival' ? 'Expected' : 'To go'
}

/** How many of these rows are already done, for the Progress bar. */
export function doneCount(rows: readonly TravelRow[], direction: TravelDirection): number {
  return rows.reduce((n, row) => n + (isDone(row, direction) ? 1 : 0), 0)
}

/** Rows still to handle — what the "N to go" summary counts. */
export function remainingRows(
  rows: readonly TravelRow[],
  direction: TravelDirection,
): TravelRow[] {
  return rows.filter((row) => !isDone(row, direction))
}

/**
 * A person's name first, never an id, and never the word "Unknown".
 *
 * Falls back to the mobile number because six identical rows reading "Unnamed
 * family" tell a runner standing in a car park nothing about who to look for.
 * `fallback` is the caller's phone formatter so this module stays free of it.
 */
export function displayName(row: TravelRow, fallback?: (mobile: string) => string): string {
  const name = row.group.head_name?.trim()
  if (name) return name
  const mobile = row.group.primary_mobile?.trim()
  if (mobile) return fallback ? fallback(mobile) : mobile
  return 'Unnamed family'
}

/** "Room 104", "Hotel Grand 104", or a dash when they are not placed yet. */
export function placeLabel(roomLabel: string): string | null {
  const label = roomLabel.trim()
  return label ? `Room ${label}` : null
}

/**
 * The row's one muted line: time, mode, reference and head count in the order a
 * door runner reads them.
 *
 * Built here rather than in JSX so the order is asserted by a test rather than
 * by reading the component — the order is the thing that keeps changing.
 */
export function rowMeta(
  row: TravelRow,
  direction: TravelDirection,
  opts: { todayKey: string; dayLabel: (date: string) => string },
): string {
  const parts: string[] = []
  if (direction === 'departure') parts.push(slotHeading(row.leg, opts.todayKey, opts.dayLabel))
  const mode = modeLabel(row.leg.mode)
  if (mode) parts.push(mode)
  if (row.leg.reference) parts.push(row.leg.reference)
  const pax = paxLabel(paxCount(row))
  if (pax) parts.push(pax)
  const where = placeLabel(row.roomLabel)
  parts.push(where ?? (direction === 'arrival' ? 'No room yet' : 'No room'))
  return parts.join(' · ')
}

/** "Today at 10:30" for the Now card's context line. */
export function nowContext(
  row: TravelRow,
  direction: TravelDirection,
  opts: { todayKey: string; dayLabel: (date: string) => string },
): string {
  const name = displayName(row)
  const pax = paxLabel(paxCount(row))
  const where = placeLabel(row.roomLabel)
  const when = slotHeading(row.leg, opts.todayKey, opts.dayLabel)
  const bits = [name, pax, when, where ?? 'no room yet'].filter(Boolean)
  return bits.join(' · ')
}

/** The Now card's headline: the time, because that is what a runner is watching. */
export function nowHeadline(
  row: TravelRow,
  opts: { todayKey: string; dayLabel: (date: string) => string },
): string {
  const clock = shortTime(row.leg.travel_time)
  if (clock) return clock
  if (row.leg.travel_date === opts.todayKey) return 'Today'
  if (row.leg.travel_date) return opts.dayLabel(row.leg.travel_date)
  return 'No time set'
}

/** The Progress label for a direction. */
export function progressLabel(direction: TravelDirection): string {
  return direction === 'arrival' ? 'Arrivals met' : 'Departures gone'
}

/** Which of the board's two walk-up doors is the live one. */
export type WalkUpDoor = 'header' | 'empty-state' | 'none'

/**
 * WHERE THE WALK-UP FORM IS REACHED FROM — exactly ONE door, never two.
 *
 * Recording a walk-up departure (a family who tells the desk they are leaving
 * and was never called about it) is its own screen. It is a real screen on a day
 * when nobody phoned ahead, so it must always be reachable; and it is not the
 * board's job, so it must never be the loudest thing on it.
 *
 * BOTH facts have been got wrong here, in opposite directions:
 *
 *   - "only from the empty state" meant that the moment the event had a single
 *     departure on file, the form could only be opened by typing its URL — and
 *     inside the APK there is no URL bar (docs/BUGS.md M30).
 *   - "a permanent link as well" then showed the same control TWICE on an empty
 *     board: the header link and the empty state's button, one above the other.
 *
 * So the choice is a single value read by both call sites, rather than two
 * independent conditions that can (and did) disagree:
 *
 *   'empty-state'  nothing on file — the empty state carries the button
 *   'header'       there are rows — a quiet link above the board
 *   'none'         arrivals have no walk-up form; an arrival is not a walk-up
 *
 * The count is the number of ROWS, not the number of rows after filtering: a
 * filter that matches nothing is not an empty event, and hiding the door then
 * would strand the walk-up exactly as M30 did.
 */
export function walkUpDoor(direction: TravelDirection, rowCount: number): WalkUpDoor {
  if (direction !== 'departure') return 'none'
  return rowCount > 0 ? 'header' : 'empty-state'
}
