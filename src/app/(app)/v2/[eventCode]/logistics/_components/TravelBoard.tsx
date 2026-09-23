'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

import { AlertTriangleIcon, CarIcon, InboxIcon, PhoneIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LinkButton } from '@/components/ui/LinkButton'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { NowCard } from '@/components/ui/NowCard'
import { Progress } from '@/components/ui/Progress'
import { Row, type RowTone } from '@/components/ui/Row'
import { Segmented } from '@/components/ui/Segmented'
import { markArrived, markDeparted } from '@/lib/actions/event-day'
import { useOptimisticAction } from '@/lib/mutate/useOptimisticAction'
import { traceFetch } from '@/lib/perf'
import { formatMobile } from '@/lib/phone'
import { queryKeys } from '@/lib/query/keys'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'

import {
  displayName,
  doneCount,
  groupBySlot,
  isCodeMode,
  isDone,
  modeLabel,
  nowContext,
  nowHeadline,
  paxCount,
  paxLabel,
  placeLabel,
  progressLabel,
  remainingRows,
  rowMeta,
  shortTime,
  slotHeading,
  statusLabel,
  type TravelDirection,
  type TravelGroupLike,
  type TravelLegLike,
  type TravelRow,
} from './_travel'

/** The columns this board paints. Listed so a rename still fails the build. */
const LEG_COLUMNS =
  'id, group_id, direction, mode, travel_date, travel_time, reference, point, pax_on_leg, arrived_at, departed_at'
const GROUP_COLUMNS =
  'id, head_name, primary_mobile, expected_pax, adults_confirmed, children_confirmed, needs_pickup, side'

export interface TravelBoardProps {
  eventId: string
  eventCode: string
  /**
   * Which direction this route is showing.
   *
   * The ROUTE decides it, not the board, so the v3 bar can light the tab a
   * runner actually tapped: `logistics/arrivals` and `logistics/departures` are
   * separate addresses and `AppTabs` matches on the child segment, so a board
   * that started on its own default would leave the tapped tab dark.
   */
  direction: TravelDirection
  /**
   * Where the Segmented switch goes. Absent only on the Travel root, where the
   * two directions are separate addresses too — see `logistics/page.tsx`.
   */
  otherHref?: string
}

/**
 * The Travel board: who is landing, and who is leaving.
 *
 * REBUILT TO SPEC-V3 §4. ONE JOB PER SCREEN — get the right family into the
 * right car. Top to bottom:
 *
 *   1. `Segmented` — Arrivals | Departures, the same ledger seen two ways.
 *   2. `Progress` — how much of this board is done.
 *   3. ONE `NowCard` — the next arrival, because that is the only "next" this
 *      app can actually know. Nothing here invents a departure order.
 *   4. "After that" — the rest of the board as `Row`s, grouped under their time
 *      slot, flight and train numbers in mono.
 *   5. A sheet per family: who, how many, where, a `tel:` to their number, and
 *      the commit — "Mark arrived" / "Mark departed".
 *
 * WHAT WAS REMOVED, because §3 lists it: `MeetArrivals`' second title, the
 * per-device hint banner, the "Updating…" line, the explanatory paragraph, the
 * three-counter card, the search field and the six-chip mode row (a filter row
 * above the first name is what this spec deletes everywhere), and the corner
 * filter sheet. `DeparturesBoard`'s `FleetAddCard` went with it — fleet is a
 * screen, and this is not it.
 *
 * WHAT IS NOT HERE: assigning a car. SPEC-V3 §4's sheet names "assign car", and
 * the app has no per-leg vehicle assignment action — `commitTrips(eventId,
 * proposal)` writes WHOLE trips from the packer, so calling it for one family
 * would mean inventing a proposal the engine never produced. §5 forbids
 * changing server actions, so the sheet's second control is the thing that DOES
 * exist and leads somewhere real: the trip planner. Recorded as an honest gap
 * in `.brain/report-travel.md` rather than papered over with a dead button.
 *
 * ONE PRIMARY CONTROL, AND IT IS THE NOW CARD'S. The two designs this replaced
 * each ended in a full-width commit button per row, which is a screen of
 * nineteen maroon buttons. Here the dark card carries the single primary, and
 * every other commit lives in a sheet behind a tap on the row — which is also
 * where SPEC-V3 §2 wants detail and edits to live.
 *
 * THE WRITES ARE UNCHANGED. `markArrived` / `markDeparted` are the same
 * server-side RPCs the v1 boards call, through the same optimistic path: the row
 * changes on the tap, Undo means nothing was sent (both timestamps are
 * forward-only and nothing clears them), and a write that cannot reach the
 * server is queued on the phone and reported as queued, never as saved.
 */
export function TravelBoard({ eventId, eventCode, direction, otherHref }: TravelBoardProps) {
  const [mode, setMode] = useState<string | null>(null)
  const [pickupOnly, setPickupOnly] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const { data, isPending, error, refetch } = useQuery({
    // SHARED WITH THE v1 ARRIVALS SCREEN: this is the key that board warms, so
    // the two agree on one cache entry instead of holding two copies of the
    // same rows. See the header of `src/lib/query/keys.ts`.
    queryKey: queryKeys.logistics.arrivals(eventId),
    queryFn: async () => {
      const legDirection = direction === 'arrival' ? 'arrival' : 'departure'
      const result = await traceFetch(`travel :: load(${legDirection})`, () =>
        Promise.all([
          supabase
            .from('travel_legs')
            .select(LEG_COLUMNS)
            .eq('event_id', eventId)
            .eq('direction', legDirection)
            .order('travel_date', { ascending: true })
            .order('travel_time', { ascending: true }),
          supabase.from('guest_groups').select(GROUP_COLUMNS).eq('event_id', eventId),
          supabase
            .from('room_assignments')
            .select('group_id, room_id')
            .eq('event_id', eventId)
            .is('released_at', null),
          supabase.from('rooms').select('id, hotel_id, room_number').eq('event_id', eventId),
          supabase.from('hotels').select('id, name').eq('event_id', eventId),
        ]),
      )

      const [
        { data: legs, error: legErr },
        { data: groups },
        { data: assignments },
        { data: rooms },
        { data: hotels },
      ] = result

      if (legErr) {
        throw new Error('Could not load travel. Check your connection and try again.')
      }

      // Index once, then look up in constant time. The v1 read ran
      // `rooms.find()` inside the loop over assignments, which is O(assignments
      // × rooms) on the main thread of a cheap phone, on every visit.
      const roomById = new Map((rooms ?? []).map((r) => [r.id, r]))
      const hotelById = new Map((hotels ?? []).map((h) => [h.id, h]))

      const roomByGroup = new Map<string, string>()
      for (const assignment of assignments ?? []) {
        const room = roomById.get(assignment.room_id)
        if (!room) continue
        const hotel = hotelById.get(room.hotel_id)
        roomByGroup.set(
          assignment.group_id,
          [hotel?.name, room.room_number].filter(Boolean).join(' '),
        )
      }

      const groupById = new Map((groups ?? []).map((g) => [g.id, g as unknown as TravelGroupLike]))
      return (legs ?? [])
        .filter((leg) => groupById.has(leg.group_id))
        .map(
          (leg): TravelRow => ({
            leg: leg as unknown as TravelLegLike,
            group: groupById.get(leg.group_id)!,
            roomLabel: roomByGroup.get(leg.group_id) ?? '',
          }),
        )
    },
  })

  const rows = useMemo(() => data ?? [], [data])

  /**
   * Marking one family met or gone.
   *
   * DEFERRED for the same reason as the v1 boards: `mark_arrived` and
   * `mark_departed` stamp a timestamp nothing can clear, so holding the write
   * until the undo window closes makes Undo mean NOTHING WAS SENT — the only
   * honest version. The accepted cost, stated where the decision is made: a
   * mark the app dies on before the window closes never reaches the server, and
   * the runner taps again.
   */
  const mark = useOptimisticAction<TravelRow[], { groupId: string; headName: string }, TravelLegLike>({
    queryKey: queryKeys.logistics.arrivals(eventId),
    callSite: direction === 'arrival' ? 'v3-travel-arrived' : 'v3-travel-departed',
    deferUntilCommit: true,
    message: (v) =>
      direction === 'arrival' ? `${v.headName} · Arrived` : `${v.headName} · Departed`,
    // Every leg this family has on THIS board is stamped, not only the row that
    // was tapped: leaving a second leg reading "Expected" for a family standing
    // in the lobby is a contradiction the runner would see at once.
    apply: (prev, v) => {
      const stamp = new Date().toISOString()
      return (prev ?? []).map((row) =>
        row.group.id === v.groupId
          ? {
              ...row,
              leg:
                direction === 'arrival'
                  ? { ...row.leg, arrived_at: stamp }
                  : { ...row.leg, departed_at: stamp },
            }
          : row,
      )
    },
    action: async (v) => {
      const result =
        direction === 'arrival'
          ? await markArrived(eventId, eventCode, v.groupId)
          : await markDeparted(eventId, eventCode, v.groupId)
      if (!result.ok) return { ok: false, message: result.message }
      // `EventDayResult` is shared by four event-day actions, so `ok` alone
      // does not narrow the union to the leg branch.
      if (!('leg' in result)) {
        return { ok: false, message: 'The server did not confirm that change.' }
      }
      return { ok: true, data: result.leg as unknown as TravelLegLike }
    },
    // The RPC returns the committed leg carrying the SERVER's clock, so the
    // phone-clock timestamp is replaced rather than left to age into a lie.
    reconcile: (server, optimistic) =>
      optimistic.map((row) =>
        row.leg.id === server.id ? { ...row, leg: { ...row.leg, ...server } } : row,
      ),
    queue: {
      eventId,
      kind: direction === 'arrival' ? 'mark-arrived' : 'mark-departed',
      what: direction === 'arrival' ? 'arrival' : 'departure',
    },
  })

  /**
   * The day formatter, resolved once.
   *
   * `formatDate` returns `null` for a value it cannot parse, and a slot heading
   * of "null · 10:30" is worse than the raw string — so the raw date is the
   * fallback. It is also why the helper takes the formatter as an argument
   * instead of importing the util: the helper stays assertion-free in vitest.
   */
  const todayKey = useMemo(() => toDateKey(new Date()), [])
  const dayLabel = useCallback((date: string) => formatDate(date) ?? date, [])

  const modes = useMemo(() => {
    const present = new Set(rows.map((r) => r.leg.mode).filter((m): m is string => Boolean(m)))
    return [...present].sort()
  }, [rows])

  const board = useMemo(
    () =>
      rows.filter((row) => {
        if (mode !== null && row.leg.mode !== mode) return false
        if (pickupOnly && !row.group.needs_pickup) return false
        return true
      }),
    [rows, mode, pickupOnly],
  )

  const done = doneCount(board, direction)
  const toGo = remainingRows(board, direction)
  const filtered = mode !== null || pickupOnly
  const anyPickup = rows.some((r) => r.group.needs_pickup)

  const next = toGo[0] ?? null
  const active = activeId ? (board.find((row) => row.leg.id === activeId) ?? null) : null
  const afterThat = next ? board.filter((row) => row !== next) : board

  function openSheet(row: TravelRow) {
    setActiveId(row.leg.id)
    setSheetOpen(true)
  }

  if (error && data === undefined) {
    return (
      <ErrorState
        title={error instanceof Error ? error.message : 'Could not load travel.'}
        onRetry={() => void refetch()}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* The switch between the two views of the same ledger. Both directions
          are their own address (the v3 bar highlights them), so this navigates
          rather than holding a second copy of the board in local state. */}
      {otherHref ? (
        <Segmented
          label="Travel direction"
          value={direction}
          onChange={() => {
            if (otherHref) router.push(otherHref)
          }}
          options={[
            { value: 'arrival', label: 'Arrivals' },
            { value: 'departure', label: 'Departures' },
          ]}
        />
      ) : null}

      <Progress label={progressLabel(direction)} done={done} total={board.length} tone="green" />

      {/* ONE filter row, and only when there is more than one thing to filter
          between. A row of chips above the first name is the clutter §3
          deletes; a board with two modes on it genuinely needs the choice. */}
      {modes.length > 1 || anyPickup ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter travel">
          {modes.length > 1 ? (
            <>
              <Chip selected={mode === null} onClick={() => setMode(null)}>
                All
              </Chip>
              {modes.map((m) => (
                <Chip key={m} selected={mode === m} onClick={() => setMode(m)}>
                  {modeLabel(m) ?? m}
                </Chip>
              ))}
            </>
          ) : null}
          {anyPickup ? (
            <Chip selected={pickupOnly} onClick={() => setPickupOnly((v) => !v)}>
              Needs pickup
            </Chip>
          ) : null}
        </div>
      ) : null}

      {mark.lastError ? (
        <p
          role="alert"
          className="rounded-xl bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {mark.lastError}
        </p>
      ) : null}

      {isPending ? (
        <LoadingRows count={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CarIcon className="h-7 w-7" />}
          title={direction === 'arrival' ? 'No arrivals on file' : 'No departures on file'}
          description={
            direction === 'arrival'
              ? 'Arrivals appear once the calling team has logged a flight or train.'
              : 'Departures appear once the calling team has logged a return.'
          }
          action={
            direction === 'departure' ? (
              <LinkButton
                href={`/${eventCode}/logistics/departures/new`}
                variant="secondary"
                fullWidth
              >
                Record a walk-up
              </LinkButton>
            ) : undefined
          }
        />
      ) : board.length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="h-7 w-7" />}
          title="Nothing in this filter"
          description="No family on this board matches it."
          action={
            filtered ? (
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  setMode(null)
                  setPickupOnly(false)
                }}
              >
                Clear the filter
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* The ONE dark card, and the screen's only primary control. The
              action opens the same family sheet a row tap does, so the commit
              and the detail are always in the same place. */}
          {next ? (
            <NowCard
              eyebrow={direction === 'arrival' ? 'Next in' : 'Next out'}
              headline={nowHeadline(next, { todayKey, dayLabel })}
              context={nowContext(next, direction, { todayKey, dayLabel })}
              actionLabel={direction === 'arrival' ? 'Mark arrived' : 'Mark departed'}
              onPress={() => openSheet(next)}
            />
          ) : (
            <p className="rounded-2xl border border-rule bg-surface px-4 py-3 text-sm text-muted">
              {direction === 'arrival'
                ? 'Every arrival on this board has been met.'
                : 'Every departure on this board is gone.'}
            </p>
          )}

          {afterThat.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="eyebrow">After that</h2>
              <div className="flex flex-col gap-4">
                {groupBySlot(afterThat).map((slot) => (
                  <div key={slot.key} className="flex flex-col gap-1.5">
                    <p className="text-sm text-muted">
                      {slotHeading(slot.rows[0].leg, todayKey, dayLabel)}
                      <span className="text-subtle">
                        {' · '}
                        {slot.rows.length} {slot.rows.length === 1 ? 'family' : 'families'}
                      </span>
                    </p>
                    <ul className="overflow-hidden rounded-2xl border border-rule bg-surface">
                      {slot.rows.map((row) => (
                        <li key={row.leg.id}>
                          <Row
                            heading={displayName(row, formatMobile)}
                            meta={rowMeta(row, direction, { todayKey, dayLabel })}
                            badge={<TimeBadge leg={row.leg} />}
                            status={statusLabel(row, direction)}
                            tone={toneFor(row, direction)}
                            onPress={() => openSheet(row)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {/* The family sheet. Every detail and every commit for one family, without
          leaving the board — SPEC-V3 §2: sheets for every detail/edit, and no
          page navigation mid-task. */}
      <BottomSheet
        open={sheetOpen && active !== null}
        onClose={() => setSheetOpen(false)}
        label={active ? `${displayName(active, formatMobile)} — travel` : 'Travel'}
      >
        {active ? (
          <div className="flex flex-col gap-5">
            <div className="min-w-0">
              <h2 className="font-display text-2xl leading-tight font-semibold text-ink">
                {displayName(active, formatMobile)}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {[
                  paxLabel(paxCount(active)) ?? 'Head count not recorded',
                  placeLabel(active.roomLabel) ?? 'No room yet',
                ].join(' · ')}
              </p>
            </div>

            {!placeLabel(active.roomLabel) ? (
              <p className="flex items-start gap-2 rounded-xl bg-red-tint px-3 py-2 text-sm font-medium text-ledger-red">
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>No room yet — sort this before they arrive.</span>
              </p>
            ) : null}

            <dl className="flex flex-col">
              <SheetRow
                label={direction === 'arrival' ? 'Arriving' : 'Leaving'}
                value={slotHeading(active.leg, todayKey, dayLabel)}
              />
              {modeLabel(active.leg.mode) ? (
                <SheetRow label="Mode" value={modeLabel(active.leg.mode)!} />
              ) : null}
              {active.leg.reference ? (
                <SheetRow
                  label={active.leg.mode === 'train' ? 'Train' : 'Flight'}
                  value={active.leg.reference}
                  mono
                />
              ) : null}
              {active.leg.point ? (
                <SheetRow
                  label={direction === 'arrival' ? 'Pickup at' : 'Drop at'}
                  value={active.leg.point}
                />
              ) : null}
              <SheetRow label="Pickup needed" value={active.group.needs_pickup ? 'Yes' : 'No'} />
            </dl>

            {active.group.primary_mobile ? (
              <a
                href={`tel:${active.group.primary_mobile}`}
                className="tap flex min-h-12 items-center gap-2 font-mono text-base font-medium text-brand active:opacity-70"
              >
                <PhoneIcon className="h-5 w-5" aria-hidden />
                {formatMobile(active.group.primary_mobile)}
              </a>
            ) : null}

            {/* Secondary, not primary: the screen's ONE maroon control is the
                Now card's. This is the commit for the family in the sheet, and
                it is the same call the card makes for the next one. */}
            {isDone(active, direction) ? (
              <p className="rounded-xl bg-green-tint px-3.5 py-3 text-sm font-medium text-ledger-green">
                {direction === 'arrival' ? 'Already met.' : 'Already gone.'}
              </p>
            ) : (
              <Button variant="secondary" size="lg" fullWidth onClick={() => commit(active)}>
                {direction === 'arrival' ? 'Mark arrived' : 'Mark departed'}
              </Button>
            )}

            <LinkButton href={`/${eventCode}/logistics/trips`} variant="ghost" fullWidth>
              Plan vehicles for this board
            </LinkButton>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  )

  function commit(row: TravelRow) {
    mark.run({ groupId: row.group.id, headName: displayName(row, formatMobile) })
    setSheetOpen(false)
  }
}

/**
 * The avatar slot: the scheduled time in the mono face.
 *
 * A runner at a hotel door is holding a list of times, so the time is the
 * identifier in the 40px slot and the name sits beside it — the same reasoning
 * that puts the room number there on the hamper run.
 */
function TimeBadge({ leg }: { leg: TravelLegLike }) {
  return (
    <span className="code-figure flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink">
      {shortTime(leg.travel_time) ?? '—'}
    </span>
  )
}

function SheetRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-2.5 last:border-b-0">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd
        className={
          mono
            ? 'code-figure min-w-0 text-right text-sm font-medium text-ink'
            : 'min-w-0 text-right text-sm font-medium text-ink'
        }
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * The status dot's colour.
 *
 * `isCodeMode` is reused from the helpers so the mono rule and "this one needs
 * a document" cannot drift apart: a flight still expected is the row that gets
 * eyes, and its dot is amber rather than the neutral grey of a bus.
 */
function toneFor(row: TravelRow, direction: TravelDirection): RowTone {
  if (isDone(row, direction)) return 'done'
  if (!placeLabel(row.roomLabel)) return 'problem'
  if (direction === 'arrival' && (row.group.needs_pickup || isCodeMode(row.leg.mode))) {
    return 'waiting'
  }
  return 'neutral'
}

/** The local calendar day as `YYYY-MM-DD`, matching `travel_date`. */
function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default TravelBoard
