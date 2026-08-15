'use client'

import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageTitle } from '@/components/ui/PageTitle'
import { SectionHead } from '@/components/ui/SectionHead'
import { SearchIcon, CheckCircleIcon, AlertTriangleIcon } from '@/components/icons'
import { WhatsAppButton } from '@/components/ui/WhatsAppButton'
import { createClient } from '@/lib/supabase/client'
import { markArrived } from '@/lib/actions/event-day'
import { traceFetch } from '@/lib/perf'
import { useStableData } from '@/lib/use-stable-data'
import { cn, formatDate } from '@/lib/utils'
import { formatMobile } from '@/lib/phone'
import type { Database } from '@/lib/supabase/database.types'

type TravelLegRow = Database['public']['Tables']['travel_legs']['Row']
type GuestGroupRow = Database['public']['Tables']['guest_groups']['Row']

/**
 * Only the columns this screen actually paints.
 *
 * Derived with `Pick` from the generated row types rather than hand-written,
 * so a column rename still fails the build here — the narrowing is a
 * payload optimisation, not an escape from the schema. Keep these in step
 * with the `select()` lists below.
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

export interface ArrivalsClientProps {
  eventId: string
  eventCode: string
}

export function ArrivalsClient({ eventId, eventCode }: ArrivalsClientProps) {
  const supabase = useMemo(() => createClient(), [])

  const [search, setSearch] = useState('')
  const [todayOnly, setTodayOnly] = useState(false)
  const [pickupOnly, setPickupOnly] = useState(false)
  const [notArrivedOnly, setNotArrivedOnly] = useState(false)
  const [modeFilter, setModeFilter] = useState('')
  const [pendingGroup, setPendingGroup] = useState<string | null>(null)

  // Cache the raw fetch so the second visit to this tab renders from cache
  // (the module-level TTL survives tab switches). The processing below is
  // pure and cheap — it re-runs on every render over the cached rows.
  const { data: raw, loading, error, reload } = useStableData<ArrivalRow[] | null>(
    `arrivals:${eventId}`,
    async () => {
      // Columns are listed explicitly rather than `select('*')`. This screen
      // needs 8 of guest_groups' 27 columns; pulling the rest ships remarks,
      // hashes and lock state for every family down a venue 3G link for
      // nothing. Released assignments are filtered SERVER-side — sending
      // them just to `continue` past them is payload we pay for twice.
      const result = await traceFetch('arrivals :: load', () =>
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

      const [{ data: legs, error: legErr }, { data: groups }, { data: assignments }, { data: rooms }, { data: hotels }] =
        result

      if (legErr) {
        throw new Error('Could not load arrivals. Check your connection and try again.')
      }

      // Index once, then look up in constant time. The previous version ran
      // `rooms.find()` and `hotels.find()` INSIDE the loop over assignments,
      // which is O(assignments × rooms) — on a 677-family event with a few
      // hundred rooms that is hundreds of thousands of comparisons on the
      // main thread of a cheap Android phone, every single visit.
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
        .map((leg) => ({
          leg,
          group: groupById.get(leg.group_id)!,
          roomLabel: roomByGroup.get(leg.group_id) ?? '',
        }))
    },
  )

  const rows = raw
  const loadError = error instanceof Error ? error.message : error ? String(error) : null

  async function handleArrive(row: ArrivalRow) {
    if (pendingGroup) return
    setPendingGroup(row.group.id)
    const result = await markArrived(eventId, eventCode, row.group.id)
    setPendingGroup(null)
    if (!result.ok) {
      setErrorState(result.message)
      return
    }
    await reload()
  }

  function setErrorState(message: string) {
    // The cached rows stay visible; a failed mutation surfaces as a toast
    // rather than wiping the screen.
     
    console.error(message)
  }

  const today = new Date()
  const todayKey = toDateKey(today)

  const filtered = useMemo(() => {
    if (!rows) return []
    let list = rows
    if (todayOnly) list = list.filter((r) => r.leg.travel_date === todayKey)
    if (pickupOnly) list = list.filter((r) => r.group.needs_pickup)
    if (notArrivedOnly) list = list.filter((r) => r.leg.arrived_at === null)
    if (modeFilter) list = list.filter((r) => r.leg.mode === modeFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((r) => r.group.head_name.toLowerCase().includes(q))
    }
    return list
  }, [rows, todayOnly, pickupOnly, notArrivedOnly, modeFilter, search, todayKey])

  // Today's rows first, then later dates, each block visually separated.
  const todayRows = filtered.filter((r) => r.leg.travel_date === todayKey)
  const laterRows = filtered.filter((r) => r.leg.travel_date !== todayKey)

  const expectedToday = rows?.filter((r) => r.leg.travel_date === todayKey).length ?? 0
  const arrivedToday = rows?.filter((r) => r.leg.travel_date === todayKey && r.leg.arrived_at !== null).length ?? 0

  if (loadError && !rows) {
    return (
      <EmptyState
        title="Could not load arrivals"
        description={loadError}
        action={<Button onClick={() => void reload()}>Try again</Button>}
      />
    )
  }

  if (loading || !rows) {
    // Loading: skeleton rows shaped like the arrival cards, so the screen
    // does not flash a false "Nothing matches" empty state while the fetch
    // is in flight.
    return (
      <div className="flex flex-col gap-4">
        <div>
          <div className="h-6 w-24 rounded bg-rule-strong" />
          <div className="mt-1.5 h-4 w-40 rounded bg-rule" />
        </div>
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="h-8 w-16 rounded bg-rule" />
            <div className="h-8 w-16 rounded bg-rule" />
            <div className="h-8 w-16 rounded bg-rule" />
          </div>
        </div>
        <div className="h-12 rounded-xl border border-border bg-surface px-3" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="h-5 w-2/5 rounded bg-rule-strong" />
                <div className="mt-2 h-4 w-3/4 rounded bg-rule" />
                <div className="mt-1.5 h-4 w-1/2 rounded bg-rule" />
              </div>
              <div className="h-6 w-16 rounded-full bg-rule" />
            </div>
            <div className="mt-3 h-11 w-full rounded-xl bg-rule" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        right={`${arrivedToday} / ${expectedToday}`}
        note="Expected today first, then later dates."
      >
        Arrivals
      </PageTitle>

      {/* Counts */}
      <div className="flex items-center justify-between rounded-xl border border-rule bg-surface px-4 py-3">
        <Count label="Expected today" value={expectedToday} />
        <Count label="Arrived" value={arrivedToday} tone="success" />
        <Count
          label="Still pending"
          value={expectedToday - arrivedToday}
          tone={expectedToday - arrivedToday > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {/* Filters + search */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5 rounded-xl border border-rule-strong bg-surface px-4 focus-within:border-brand">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by family name"
            className="min-h-14 w-full bg-transparent text-base text-ink placeholder:text-subtle focus:outline-none"
            aria-label="Search arrivals"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip selected={todayOnly} onClick={() => setTodayOnly(!todayOnly)}>
            Today
          </Chip>
          <Chip selected={pickupOnly} onClick={() => setPickupOnly(!pickupOnly)}>
            Needs pickup
          </Chip>
          <Chip selected={notArrivedOnly} onClick={() => setNotArrivedOnly(!notArrivedOnly)}>
            Not arrived
          </Chip>
        </div>
        <div
          className="flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label="Filter by travel mode"
        >
          {['', 'air', 'train', 'bus', 'cab', 'self_drive'].map((m) => (
            <Chip key={m} selected={modeFilter === m} onClick={() => setModeFilter(m)}>
              {m === '' ? 'All modes' : MODE_LABELS[m]}
            </Chip>
          ))}
        </div>
      </div>

      {rows && rows.length === 0 ? (
        <EmptyState title="No expected arrivals" description="No arrival travel legs are on file for this event yet." />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing matches" description="No arrivals match these filters — try clearing one." />
      ) : (
        <div className="flex flex-col gap-4">
          {todayRows.length > 0 ? (
            <DayBlock
              title="Today"
              rows={todayRows}
              pendingGroup={pendingGroup}
              onArrive={handleArrive}
            />
          ) : null}
          {laterRows.length > 0 ? (
            <DayBlock
              title="Later"
              rows={laterRows}
              pendingGroup={pendingGroup}
              onArrive={handleArrive}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

function DayBlock({
  title,
  rows,
  pendingGroup,
  onArrive,
}: {
  title: string
  rows: ArrivalRow[]
  pendingGroup: string | null
  onArrive: (row: ArrivalRow) => void
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <SectionHead eyebrow={title} right={`${rows.length}`} inline />
      <ul className="flex flex-col gap-2.5">
        {rows.map((row, i) => (
          <ArrivalRowCard
            key={row.leg.id}
            row={row}
            index={i}
            pending={pendingGroup === row.group.id}
            onArrive={() => onArrive(row)}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * One expected arrival.
 *
 * The time is the identifier here, not the family — this screen is read by
 * someone standing at a hotel door working out what lands next, so the
 * clock gets its own column in tabular mono and everything else hangs off
 * it. A row without a room is the one thing on the screen that needs
 * fixing before the car pulls up, so it breaks into the leading-edge rule.
 */
function ArrivalRowCard({
  row,
  index,
  pending,
  onArrive,
}: {
  row: ArrivalRow
  index: number
  pending: boolean
  onArrive: () => void
}) {
  const arrived = row.leg.arrived_at !== null
  const noRoom = !row.roomLabel
  const adults = row.group.adults_confirmed ?? 0
  const children = row.group.children_confirmed ?? 0
  const mode = row.leg.mode ? (MODE_LABELS[row.leg.mode] ?? row.leg.mode) : null

  return (
    <li
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={cn(
        'list-fade overflow-hidden rounded-xl border bg-surface p-3.5',
        arrived
          ? 'border-rule border-l-[3px] border-l-ledger-green'
          : noRoom
            ? 'border-ledger-red/30 border-l-[3px] border-l-ledger-red'
            : 'border-rule border-l-[3px] border-l-rule-strong',
      )}
    >
      <div className="flex items-start gap-3.5">
        <div className="min-w-14 shrink-0 text-center">
          <div
            className={cn(
              'figure text-xl leading-none font-medium',
              arrived ? 'text-ledger-green' : 'text-ink',
            )}
          >
            {formatTime(row.leg.travel_time) || '—'}
          </div>
          <div className="mt-1.5 text-xs text-muted">{formatDate(row.leg.travel_date)}</div>
          {mode ? <Badge className="mt-1.5">{mode}</Badge> : null}
        </div>

        <div className="min-w-0 flex-1">
          {row.leg.reference ? (
            <p className="font-mono text-sm text-brand">{row.leg.reference}</p>
          ) : null}
          <p className="mt-1 text-base leading-snug font-medium text-ink">
            {row.group.head_name}
          </p>
          <p className="mt-1 text-sm text-muted">
            {adults + children > 0
              ? `${adults + children} pax`
              : `${row.group.expected_pax} expected pax`}
            {row.leg.point ? ` · ${row.leg.point}` : ''}
          </p>
          {row.roomLabel ? (
            <p className="mt-1 font-mono text-sm text-muted">Room {row.roomLabel}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {row.group.needs_pickup ? <Badge tone="warning">Pickup</Badge> : null}
            {row.group.primary_mobile ? (
              <a
                href={`tel:${row.group.primary_mobile}`}
                className="tap inline-flex min-h-11 items-center rounded-lg pr-2 font-mono text-sm font-medium text-brand active:opacity-70"
              >
                {formatMobile(row.group.primary_mobile)}
              </a>
            ) : null}
            {row.group.primary_mobile ? (
              <WhatsAppButton mobile={row.group.primary_mobile} name={row.group.head_name} />
            ) : null}
          </div>
        </div>
      </div>

      {noRoom ? (
        <p className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-red-tint px-2.5 py-2 text-xs font-medium text-ledger-red">
          <AlertTriangleIcon className="h-4 w-4 shrink-0" />
          No room allocated yet — sort this before they walk in.
        </p>
      ) : null}

      {arrived ? (
        // Still, solid, and carries no action: there is nothing left to do
        // to this row. Contrast with the button below, which breathes with
        // the rest of the outstanding work.
        <p className="mt-2.5 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ledger-green font-mono text-sm font-semibold tracking-eyebrow text-paper uppercase">
          <CheckCircleIcon className="h-4 w-4" />
          Arrived
        </p>
      ) : (
        <Button
          size="lg"
          fullWidth
          variant="secondary"
          loading={pending}
          onClick={onArrive}
          className="mt-2.5 border-ledger-green/40 bg-green-tint text-ledger-green"
        >
          Mark arrived
        </Button>
      )}
    </li>
  )
}

function Count({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'success' | 'warning'
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={cn(
          'figure text-2xl leading-none font-medium',
          tone === 'success'
            ? 'text-ledger-green'
            : tone === 'warning'
              ? 'text-brand'
              : 'text-ink',
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}

function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatTime(value: string | null): string {
  if (!value) return ''
  return value.length >= 5 ? value.slice(0, 5) : value
}
