'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  InboxIcon,
  PhoneIcon,
} from '@/components/icons'
import { Badge } from '@/components/ui/Badge'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageTitle } from '@/components/ui/PageTitle'
import { StampPill, StatusPill } from '@/components/ui/StatusPill'
import { SyncChip } from '@/components/ui/SyncChip'
import { markArrived } from '@/lib/actions/event-day'
import { useOptimisticAction } from '@/lib/mutate/useOptimisticAction'
import { traceFetch } from '@/lib/perf'
import { formatMobile } from '@/lib/phone'
import { queryKeys } from '@/lib/query/keys'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/database.types'
import { cn, formatDate } from '@/lib/utils'

type TravelLegRow = Database['public']['Tables']['travel_legs']['Row']
type GuestGroupRow = Database['public']['Tables']['guest_groups']['Row']

/**
 * Only the columns this screen paints, derived with `Pick` from the generated
 * row types so a rename still fails the build.
 *
 * THE SHAPE IS SHARED WITH `(staff)/[eventCode]/logistics/arrivals`, because
 * both screens read the SAME cache entry (`queryKeys.logistics.arrivals`). Two
 * shapes under one key would be the "two keys for one dataset" drift recorded
 * in DECISIONS.md (V3 wiring handoff), with the cache handing one screen the
 * other's rows. Keep the two `select()` lists and these picks in step.
 */
type ArrivalLeg = Pick<
  TravelLegRow,
  | 'id'
  | 'group_id'
  | 'direction'
  | 'mode'
  | 'travel_date'
  | 'travel_time'
  | 'reference'
  | 'point'
  | 'pax_on_leg'
  | 'arrived_at'
>

type ArrivalGroup = Pick<
  GuestGroupRow,
  | 'id'
  | 'head_name'
  | 'primary_mobile'
  | 'expected_pax'
  | 'adults_confirmed'
  | 'children_confirmed'
  | 'needs_pickup'
  | 'side'
>

interface ArrivalRow {
  leg: ArrivalLeg
  group: ArrivalGroup
  roomLabel: string
}

const MODE_LABELS: Record<string, string> = {
  air: 'Air',
  train: 'Train',
  bus: 'Bus',
  cab: 'Cab',
  self_drive: 'Self-drive',
}

const MODES = ['', 'air', 'train', 'bus', 'cab', 'self_drive']

export interface MeetArrivalsProps {
  eventId: string
  eventCode: string
}

export function MeetArrivals({ eventId, eventCode }: MeetArrivalsProps) {
  const supabase = useMemo(() => createClient(), [])

  const [mode, setMode] = useState('')
  const [pickupOnly, setPickupOnly] = useState(false)
  const [todayOnly, setTodayOnly] = useState(false)
  const [showMet, setShowMet] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const {
    data: raw,
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.logistics.arrivals(eventId),
    queryFn: async () => {
      // Columns are listed explicitly rather than `select('*')`: this screen
      // needs 8 of guest_groups' 27, and the rest (remarks, hashes, lock state)
      // would cross a venue 3G link for nothing. Released assignments are
      // filtered server-side.
      const result = await traceFetch('arrivals-next :: load', () =>
        Promise.all([
          supabase
            .from('travel_legs')
            .select(
              'id, group_id, direction, mode, travel_date, travel_time, reference, point, pax_on_leg, arrived_at',
            )
            .eq('event_id', eventId)
            .eq('direction', 'arrival')
            .order('travel_date', { ascending: true })
            .order('travel_time', { ascending: true }),
          supabase
            .from('guest_groups')
            .select(
              'id, head_name, primary_mobile, expected_pax, adults_confirmed, children_confirmed, needs_pickup, side',
            )
            .eq('event_id', eventId),
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
        throw new Error('Could not load arrivals. Check your connection and try again.')
      }

      // Index once, then look up in constant time. The v1 read did this after
      // an O(assignments x rooms) scan that cost hundreds of thousands of
      // comparisons on a large event; the fix is kept.
      const roomById = new Map((rooms ?? []).map((r) => [r.id, r]))
      const hotelById = new Map((hotels ?? []).map((h) => [h.id, h]))

      const roomByGroup = new Map<string, string>()
      for (const a of assignments ?? []) {
        const room = roomById.get(a.room_id)
        if (!room) continue
        const hotel = hotelById.get(room.hotel_id)
        roomByGroup.set(a.group_id, [hotel?.name, room.room_number].filter(Boolean).join(' '))
      }

      const groupById = new Map((groups ?? []).map((g) => [g.id, g]))
      return (legs ?? [])
        .filter((leg) => groupById.has(leg.group_id))
        .map(
          (leg): ArrivalRow => ({
            leg,
            group: groupById.get(leg.group_id)!,
            roomLabel: roomByGroup.get(leg.group_id) ?? '',
          }),
        )
    },
  })

  const rows = raw ?? null
  const loadError = error instanceof Error ? error.message : error ? String(error) : null
  const stale = isFetching && rows !== null

  /**
   * Marking an arrival, through V3's optimistic path.
   *
   * DEFERRED, because `mark_arrived` has no reverse — it stamps `arrived_at`
   * and nothing clears it. Holding the write until the undo window closes
   * makes Undo mean NOTHING WAS SENT, which is the only honest version. The
   * accepted cost, recorded where the decision is made: an arrival the app
   * dies on before the window closes never reaches the server.
   */
  const arrive = useOptimisticAction<ArrivalRow[], { groupId: string; headName: string }, TravelLegRow>(
    {
      queryKey: queryKeys.logistics.arrivals(eventId),
      callSite: 'markArrived',
      deferUntilCommit: true,
      message: (v) => `${v.headName} · Arrived`,
      // Every arrival leg this family has is stamped, not just the row that was
      // tapped: leaving a second leg reading "expected" for a family that is
      // standing in the lobby is a contradiction the user would see at once.
      apply: (prev, v) =>
        (prev ?? []).map((r) =>
          r.group.id === v.groupId
            ? { ...r, leg: { ...r.leg, arrived_at: new Date().toISOString() } }
            : r,
        ),
      action: async (v) => {
        const result = await markArrived(eventId, eventCode, v.groupId)
        if (!result.ok) return { ok: false, message: result.message }
        // `EventDayResult` is shared by four event-day actions, so `ok` alone
        // does not narrow the union to the leg branch.
        if (!('leg' in result)) {
          return { ok: false, message: 'The server did not confirm that arrival.' }
        }
        return { ok: true, data: result.leg }
      },
      // The RPC returns the committed leg, including the SERVER's clock, so the
      // phone-clock timestamp is replaced rather than left to age into a lie.
      reconcile: (server, optimistic) =>
        optimistic.map((r) =>
          r.leg.id === server.id ? { ...r, leg: { ...r.leg, arrived_at: server.arrived_at } } : r,
        ),
      queue: { eventId, kind: 'mark-arrived', what: 'arrival' },
    },
  )

  const writeError = arrive.lastError

  // The only offline surface on this screen is the SyncChip below, and that is
  // deliberate: it says "n waiting to upload · arrival" from the hook's own
  // queued count, so there is no second sentence to keep in agreement with it
  // (docs/INTERACTION-CONTRACT.md T7: a write is saved, saved on this phone, or
  // not saved — never ambiguously).

  const todayKey = toDateKey(new Date())

  const filterLabel = [
    mode ? (MODE_LABELS[mode] ?? mode) : 'Everyone',
    pickupOnly ? 'Pickup' : null,
    todayOnly ? 'Today' : null,
    showMet ? 'Met too' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const filtered = useMemo(() => {
    if (!rows) return []
    let list = rows
    if (mode) list = list.filter((r) => r.leg.mode === mode)
    if (pickupOnly) list = list.filter((r) => r.group.needs_pickup)
    if (todayOnly) list = list.filter((r) => r.leg.travel_date === todayKey)
    if (!showMet) list = list.filter((r) => r.leg.arrived_at === null)
    return list
  }, [rows, mode, pickupOnly, todayOnly, showMet, todayKey])

  // "Who lands next" is the first row that is not already in the lobby. With
  // `showMet` off that is simply the head of the list.
  const next = filtered.find((r) => r.leg.arrived_at === null) ?? null
  const rest = filtered.filter((r) => r !== next)

  if (loadError && rows === null) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle>Meet an arrival</PageTitle>
        <ErrorState title={loadError} onRetry={() => void refetch()} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <PageTitle className="min-w-0 flex-1">Meet an arrival</PageTitle>
        {/* ONE control, in the title row. The v1 arrivals board opened with
            three counters, a search box, three toggle chips and a scrolling
            row of five mode chips, all above the first name. */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="tap inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-rule-strong bg-surface px-3 text-sm font-medium text-ink active:bg-surface-2"
        >
          {filterLabel}
          <ChevronDownIcon className="h-4 w-4 text-muted" aria-hidden />
        </button>
      </div>

      {stale ? (
        <p role="status" className="-mt-1 text-xs text-muted">
          Updating…
        </p>
      ) : null}

      {writeError ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {writeError}
        </p>
      ) : null}

      {/* No `onPress`: the queue drains itself on reconnect and on the app
          returning to the foreground, so this is a status readout rather than a
          button that pretends to send (see the note on `writeError` above). */}
      <SyncChip count={arrive.queuedCount} what="arrival" />

      {isPending ? (
        <ul className="flex flex-col gap-2.5" aria-busy>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="rounded-2xl border border-rule-strong bg-surface p-4">
              <div className="h-5 w-2/5 rounded bg-rule-strong" />
              <div className="mt-2 h-4 w-3/5 rounded bg-rule" />
              <div className="mt-3 h-12 w-full rounded-xl bg-rule" />
            </li>
          ))}
        </ul>
      ) : rows === null ? null : filtered.length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="h-7 w-7" />}
          title={showMet ? 'No arrivals in this view' : 'Nobody left to meet'}
          description={
            rows.length === 0
              ? 'No arrival is on file for this event yet. They arrive once the calling team has logged flight or train details.'
              : 'Every arrival in this view has already been marked. Families already met are still there under “Met too”.'
          }
          action={
            <Button variant="secondary" fullWidth onClick={() => setSheetOpen(true)}>
              Choose what to see
            </Button>
          }
        />
      ) : (
        <>
          {next ? (
            <NextArrival
              row={next}
              onArrive={() => arrive.run({ groupId: next.group.id, headName: displayName(next) })}
            />
          ) : null}

          {rest.length > 0 ? (
            <section className="flex flex-col gap-2.5">
              <h3 className="eyebrow">After that</h3>
              <ul className="flex flex-col gap-2.5">
                {rest.map((row) => (
                  <ArrivalLine
                    key={row.leg.id}
                    row={row}
                    onArrive={() =>
                      arrive.run({ groupId: row.group.id, headName: displayName(row) })
                    }
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        label="Choose what to see"
      >
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">Choose what to see</h2>

          <div className="flex flex-col gap-2">
            <h3 className="eyebrow">How they travel</h3>
            <div className="flex flex-wrap gap-2" role="group" aria-label="How they travel">
              {MODES.map((m) => (
                <Chip key={m || 'all'} selected={mode === m} onClick={() => setMode(m)}>
                  {m === '' ? 'Everyone' : (MODE_LABELS[m] ?? m)}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="eyebrow">Narrow it down</h3>
            <div className="flex flex-wrap gap-2">
              <Chip selected={pickupOnly} onClick={() => setPickupOnly((v) => !v)}>
                Needs pickup
              </Chip>
              <Chip selected={todayOnly} onClick={() => setTodayOnly((v) => !v)}>
                Today only
              </Chip>
              <Chip selected={showMet} onClick={() => setShowMet((v) => !v)}>
                Show families already met
              </Chip>
            </div>
          </div>

          <Button size="lg" fullWidth onClick={() => setSheetOpen(false)}>
            Done
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * Who lands next.
 *
 * The time gets the top line because this screen is read by someone standing at
 * a hotel door working out what is about to pull up. A family with no room
 * allocated is the one thing that has to be fixed before they walk in, so it
 * breaks into the leading edge.
 */
function NextArrival({ row, onArrive }: { row: ArrivalRow; onArrive: () => void }) {
  const name = displayName(row)
  const guests = guestCount(row)
  const mode = row.leg.mode ? (MODE_LABELS[row.leg.mode] ?? row.leg.mode) : null
  const noRoom = row.roomLabel === ''

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-rule-strong bg-surface p-4 shadow-e2',
        noRoom && 'border-l-[3px] border-l-ledger-red',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-brand">Next in</p>
          <p className="figure mt-1 text-2xl leading-none font-medium text-ink">
            {whenLabel(row.leg.travel_date, row.leg.travel_time)}
          </p>
        </div>
        <StatusPill tone="active">Expected</StatusPill>
      </div>

      <div className="min-w-0">
        <h2 className="text-2xl leading-tight font-semibold text-ink">{name}</h2>
        <p className="mt-1 text-sm text-muted">
          {guests > 0 ? `${guests} ${guests === 1 ? 'guest' : 'guests'}` : 'Head count not recorded'}
          {mode ? ` · ${mode}` : ''}
          {row.leg.reference ? ` · ${row.leg.reference}` : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {row.group.needs_pickup ? <Badge tone="warning">Needs pickup</Badge> : <Badge>No pickup</Badge>}
        {row.leg.point ? <span className="text-sm text-muted">{row.leg.point}</span> : null}
      </div>

      <p className="text-sm text-muted">
        {row.roomLabel ? `Room ${row.roomLabel}` : 'No room allocated yet'}
      </p>

      {noRoom ? (
        <p className="flex items-start gap-2 rounded-lg bg-red-tint px-3 py-2 text-sm font-medium text-ledger-red">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>No room yet — sort this before they walk in.</span>
        </p>
      ) : null}

      {row.group.primary_mobile ? (
        <a
          href={`tel:${row.group.primary_mobile}`}
          className="tap inline-flex min-h-11 items-center gap-2 self-start rounded-lg pr-2 font-mono text-sm font-medium text-brand active:opacity-70"
        >
          <PhoneIcon className="h-4 w-4" aria-hidden />
          {formatMobile(row.group.primary_mobile)}
        </a>
      ) : null}

      <Button
        size="lg"
        fullWidth
        variant="secondary"
        leadingIcon={<CheckCircleIcon className="h-5 w-5" aria-hidden />}
        onClick={onArrive}
        className="border-ledger-green/45 text-ledger-green"
      >
        Mark arrived
      </Button>
    </section>
  )
}

/** One of the arrivals behind the next one — met in passing, not studied. */
function ArrivalLine({ row, onArrive }: { row: ArrivalRow; onArrive: () => void }) {
  const met = row.leg.arrived_at !== null
  const guests = guestCount(row)

  return (
    <li className="list-fade flex flex-col gap-2.5 rounded-xl border border-rule bg-surface px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base leading-snug font-medium text-ink">{displayName(row)}</p>
          <p className="figure mt-0.5 text-sm text-muted">
            {whenLabel(row.leg.travel_date, row.leg.travel_time)}
            {guests > 0 ? ` · ${guests} ${guests === 1 ? 'guest' : 'guests'}` : ''}
          </p>
          <p className="mt-1 text-sm text-muted">
            {row.group.needs_pickup ? 'Needs pickup' : 'No pickup'}
            {row.roomLabel ? ` · Room ${row.roomLabel}` : ' · No room yet'}
          </p>
        </div>
        {met ? <StampPill>Met</StampPill> : null}
      </div>

      {met ? null : (
        <Button variant="secondary" fullWidth onClick={onArrive}>
          Mark arrived
        </Button>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A person's name first, never an id. */
function displayName(row: ArrivalRow): string {
  const name = row.group.head_name?.trim()
  if (name) return name
  const mobile = row.group.primary_mobile?.trim()
  if (mobile) return formatMobile(mobile)
  return 'Unnamed family'
}

function guestCount(row: ArrivalRow): number {
  const adults = row.group.adults_confirmed ?? 0
  const children = row.group.children_confirmed ?? 0
  const counted = adults + children
  return counted > 0 ? counted : (row.group.expected_pax ?? 0)
}

/** "Today · 14:30", "23 Sep · 09:15" — the way a door runner reads a clock. */
function whenLabel(date: string | null, time: string | null): string {
  const clock = time && time.length >= 5 ? time.slice(0, 5) : null
  const day = date ? formatDate(date) : null
  const word = date === toDateKey(new Date()) ? 'Today' : day
  return [word, clock].filter(Boolean).join(' · ') || 'Time not recorded'
}

function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default MeetArrivals
