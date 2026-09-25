'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { ChevronRightIcon, SearchIcon } from '@/components/icons'
import { BottomBar } from '@/components/ui/BottomBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LinkButton } from '@/components/ui/LinkButton'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { Progress } from '@/components/ui/Progress'
import { Row } from '@/components/ui/Row'
import { Segmented } from '@/components/ui/Segmented'
import { Select } from '@/components/ui/Select'
import {
  assignGuestToRoom,
  assignGuestsToRoom,
  commitRoomPlan,
  moveGuestsToRoom,
  planRoomAllocation,
  readRoomsGrid,
  releaseGuestFromRoom,
  type RoomPlan,
  type RoomPlanCommitItem,
  type RoomPlanCommitResult,
} from '@/lib/actions/rooms'
import { roomGuardMessage } from '@/lib/errors'
import { useOptimisticAction } from '@/lib/mutate/useOptimisticAction'
import { queryKeys } from '@/lib/query/keys'
import { groupRoomsByHotelFloor, matchesTerm, waitingLabel } from '@/lib/rooms/board'
import {
  activeRoomFilterCount,
  matchesRoomFilters,
  OCCUPANCY_LABELS,
  OCCUPANCY_STATUSES,
  occupancyStatus,
  roomFilterCounts,
  toggleInList,
  type OccupancyStatus,
  type RoomFilterable,
  type RoomFilterCounts,
  type RoomFilters,
} from '@/lib/rooms/filters'
import { ROOM_TYPES, ROOM_TYPE_LABELS, roomTypeLabel, type RoomType } from '@/lib/rooms/room-type'
import { useStoredVenue } from '@/lib/rooms/venue'
import { initials } from '@/lib/ui/metrics'
import { cn } from '@/lib/utils'

import { AllocateReview } from './_components/AllocateReview'
import { PlaceFamilySheet, type PlaceFamily } from './_components/PlaceFamilySheet'
import { RoomSheet } from './_components/RoomSheet'

type GridData = Awaited<ReturnType<typeof readRoomsGrid>>
type WaitingFamily = GridData['underBedded'][number]
type GridRoom = GridData['rooms'][number]

const EMPTY_GRID: GridData = {
  rooms: [],
  unplaced: [],
  underBedded: [],
  totals: { confirmedGuests: 0, guestsWithBed: 0, bedsFree: 0, familiesWaiting: 0 },
}

export interface RoomsBoardProps {
  eventId: string
  eventCode: string
  /** Whether this viewer's department may open the call list — see the page. */
  canOpenCallList: boolean
}

/**
 * The Rooms board (SPEC-V3 §4).
 *
 * One job per screen. This one answers "who still has no bed, and can I put
 * them there in one pass?" — the state of the register in a percentage, one
 * switch between the two questions a coordinator actually has (what is in
 * room 214 / who is waiting), and ONE primary button: auto-fill.
 *
 * WHAT CHANGED FROM v2, AND WHY. v2 said the same things in more furniture: a
 * prose summary line, a hint banner, a sync chip, a full-width search row above
 * every list, a "legend" strip, an "Updating…" line, a "Go to the call list"
 * empty state and a per-family "Names to add" pill next to a chevron. All of
 * that is gone: the numbers are a `Progress` bar, the two lists are a
 * `Segmented`, the rooms are a 2-column grid of cards whose fill IS the
 * information, the waiting families are `Row`s, and one `BottomBar` carries the
 * commit. A row of helper text under the grid is the only prose left, and it
 * explains the one thing a coordinator must not learn the hard way (the
 * database enforces capacity, and going over needs a written reason).
 *
 * WHAT DID NOT CHANGE. Every action is the same server function through the
 * same `useOptimisticAction` hooks with the same `deferUntilCommit` semantics,
 * the same undo behaviour, the same offline queueing, the same guards and the
 * same plan → review → commit flow for auto-fill. This file is presentation.
 */
export function RoomsBoard({ eventId, eventCode, canOpenCallList }: RoomsBoardProps) {
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<'rooms' | 'waiting'>('waiting')
  const [term, setTerm] = useState('')
  const [plan, setPlan] = useState<RoomPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<RoomPlanCommitResult | null>(null)
  const [placeFor, setPlaceFor] = useState<PlaceFamily | null>(null)
  const [openRoomId, setOpenRoomId] = useState<string | null>(null)

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.rooms.grid(eventId),
    queryFn: () => readRoomsGrid(eventId),
  })

  const grid = data ?? EMPTY_GRID

  // -------------------------------------------------------------------------
  // Room filters (the one "Filter · n" sheet, plus the remembered venue)
  // -------------------------------------------------------------------------

  // `filters` deliberately never carries a hotel: the venue is a single,
  // device-remembered choice and lives in its own hook, so the two controls
  // (the selector at the top, the Venue chips in the sheet) cannot disagree.
  const [filters, setFilters] = useState<RoomFilters>({ types: [], hotels: [], statuses: [] })
  const [filterOpen, setFilterOpen] = useState(false)
  const [venue, chooseVenue] = useStoredVenue(eventId)

  const effectiveFilters = useMemo<RoomFilters>(
    () => ({ ...filters, hotels: venue ? [venue] : [] }),
    [filters, venue],
  )
  const activeFilters = activeRoomFilterCount(effectiveFilters)

  // -------------------------------------------------------------------------
  // The four reversible writes this screen makes — unchanged from v2
  // -------------------------------------------------------------------------

  /**
   * Place `count` of a family's unplaced guests in one room.
   *
   * DEFERRED, so Undo is real: a room assignment's id does not exist until the
   * server answers, and an Undo built on `releaseGuestFromRoom` could not name
   * what to release without a second read. Holding the write until the undo
   * window closes makes Undo mean NOTHING WAS SENT
   * (docs/UX-RULES.md R5). The cost is stated plainly: for seven seconds the
   * bed is not really taken, so a second coordinator can claim it and this
   * write then fails the room guard — visibly, on this screen.
   */
  const place = useOptimisticAction<
    GridData,
    { groupId: string; roomId: string; headName: string; count: number },
    { assigned: number; remaining: number }
  >({
    queryKey: queryKeys.rooms.grid(eventId),
    callSite: 'v2-rooms-board-place',
    deferUntilCommit: true,
    message: (v) => `${v.headName} · ${v.count === 1 ? '1 guest' : `${v.count} guests`} placed`,
    apply: (prev, v) => {
      const base = prev ?? EMPTY_GRID
      return {
        ...base,
        rooms: base.rooms.map((room) =>
          room.roomId === v.roomId
            ? { ...room, freeBeds: Math.max(0, room.freeBeds - v.count) }
            : room,
        ),
        underBedded: base.underBedded
          .map((f) =>
            f.groupId === v.groupId
              ? { ...f, placed: f.placed + v.count, shortfall: Math.max(0, f.shortfall - v.count) }
              : f,
          )
          .filter((f) => f.shortfall > 0),
        totals: {
          ...base.totals,
          guestsWithBed: base.totals.guestsWithBed + v.count,
          bedsFree: Math.max(0, base.totals.bedsFree - v.count),
          familiesWaiting: base.underBedded.filter((f) =>
            f.groupId === v.groupId ? f.shortfall - v.count > 0 : f.shortfall > 0,
          ).length,
        },
      }
    },
    action: async (v) => {
      const result = await assignGuestsToRoom(eventId, v.groupId, v.roomId, v.count)
      if (result.ok) {
        return { ok: true, data: { assigned: result.assigned, remaining: result.remaining } }
      }
      if (result.code === 'capacity') {
        return {
          ok: false,
          message:
            roomGuardMessage(result.cause ?? null, { roomNumber: result.roomNumber }) ??
            `Room ${result.roomNumber ?? ''} took none of them. Try fewer guests, or another room.`,
        }
      }
      return { ok: false, message: result.error }
    },
    queue: { eventId, kind: 'assign-guests-room', what: 'room assignment' },
  })

  /** Move one occupant to another room. */
  const move = useOptimisticAction<
    GridData,
    {
      assignmentId: string
      guestName: string
      fromRoomId: string
      toRoomId: string
      toRoomNumber: string
    },
    { count: number }
  >({
    queryKey: queryKeys.rooms.grid(eventId),
    callSite: 'v2-rooms-board-move',
    deferUntilCommit: true,
    message: (v) => `${v.guestName} · moved to room ${v.toRoomNumber}`,
    apply: (prev, v) => {
      const base = prev ?? EMPTY_GRID
      const from = base.rooms.find((r) => r.roomId === v.fromRoomId)
      const occupant = from?.occupants.find((o) => o.assignmentId === v.assignmentId)
      if (!occupant) return base
      return {
        ...base,
        rooms: base.rooms.map((room) => {
          if (room.roomId === v.fromRoomId) {
            const occupants = room.occupants.filter((o) => o.assignmentId !== v.assignmentId)
            return { ...room, occupants, freeBeds: Math.max(0, room.capacity - occupants.length) }
          }
          if (room.roomId === v.toRoomId) {
            const occupants = [...room.occupants, occupant]
            return { ...room, occupants, freeBeds: Math.max(0, room.capacity - occupants.length) }
          }
          return room
        }),
      }
    },
    action: async (v) => {
      const result = await moveGuestsToRoom(eventId, [v.assignmentId], v.toRoomId)
      if (result.ok) return { ok: true, data: { count: result.count } }
      if (result.code === 'capacity') {
        return {
          ok: false,
          message:
            roomGuardMessage(result.cause ?? null, { roomNumber: result.roomNumber }) ??
            result.error,
        }
      }
      return { ok: false, message: result.error }
    },
    queue: { eventId, kind: 'move-guest-room', what: 'room move' },
  })

  /** Take one occupant out of a room. Releases; never deletes. */
  const remove = useOptimisticAction<
    GridData,
    { assignmentId: string; guestId: string; guestName: string; roomId: string },
    { ok: true }
  >({
    queryKey: queryKeys.rooms.grid(eventId),
    callSite: 'v2-rooms-board-remove',
    deferUntilCommit: true,
    message: (v) => `${v.guestName} · taken out of the room`,
    apply: (prev, v) => {
      const base = prev ?? EMPTY_GRID
      const room = base.rooms.find((r) => r.roomId === v.roomId)
      const occupant = room?.occupants.find((o) => o.assignmentId === v.assignmentId)
      return {
        ...base,
        rooms: base.rooms.map((r) => {
          if (r.roomId !== v.roomId) return r
          const occupants = r.occupants.filter((o) => o.assignmentId !== v.assignmentId)
          return { ...r, occupants, freeBeds: Math.max(0, r.capacity - occupants.length) }
        }),
        unplaced: occupant
          ? [
              ...base.unplaced,
              {
                guestId: occupant.guestId,
                guestName: occupant.guestName,
                groupId: occupant.groupId,
                headName: occupant.headName,
                groupType: occupant.groupType,
                side: occupant.side,
              },
            ]
          : base.unplaced,
        totals: {
          ...base.totals,
          guestsWithBed: Math.max(0, base.totals.guestsWithBed - 1),
          bedsFree: base.totals.bedsFree + 1,
        },
      }
    },
    action: async (v) => {
      const result = await releaseGuestFromRoom(v.assignmentId, 'Taken out from the rooms board')
      return result.ok ? { ok: true, data: { ok: true } } : { ok: false, message: result.error }
    },
    queue: { eventId, kind: 'release-guest-room', what: 'room release' },
  })

  /** Put one waiting guest into this room — "Add a guest" and the share offer. */
  const add = useOptimisticAction<
    GridData,
    { guestId: string; guestName: string; roomId: string; roomNumber: string },
    { ok: true }
  >({
    queryKey: queryKeys.rooms.grid(eventId),
    callSite: 'v2-rooms-board-add',
    deferUntilCommit: true,
    message: (v) => `${v.guestName} · added to room ${v.roomNumber}`,
    apply: (prev, v) => {
      const base = prev ?? EMPTY_GRID
      const guest = base.unplaced.find((g) => g.guestId === v.guestId)
      if (!guest) return base
      return {
        ...base,
        rooms: base.rooms.map((room) => {
          if (room.roomId !== v.roomId) return room
          const occupants = [
            ...room.occupants,
            {
              guestId: guest.guestId,
              guestName: guest.guestName,
              groupId: guest.groupId,
              headName: guest.headName,
              primaryMobile: null,
              hamperDelivered: false,
              ageBand: 'adult',
              isHead: false,
              // Optimistic only: the real id arrives with the next read, and
              // the row is not actionable until it does.
              assignmentId: `pending-${guest.guestId}`,
              groupType: guest.groupType,
              side: guest.side,
            },
          ]
          return { ...room, occupants, freeBeds: Math.max(0, room.capacity - occupants.length) }
        }),
        unplaced: base.unplaced.filter((g) => g.guestId !== v.guestId),
        totals: {
          ...base.totals,
          guestsWithBed: base.totals.guestsWithBed + 1,
          bedsFree: Math.max(0, base.totals.bedsFree - 1),
        },
      }
    },
    action: async (v) => {
      const result = await assignGuestToRoom(eventId, v.guestId, v.roomId, null)
      if (result.ok) return { ok: true, data: { ok: true } }
      return {
        ok: false,
        message:
          result.code === 'capacity'
            ? `Room ${v.roomNumber} has no bed left. Move somebody out first, or pick another room.`
            : result.error,
      }
    },
    queue: { eventId, kind: 'assign-guest-room', what: 'room assignment' },
  })

  // -------------------------------------------------------------------------
  // Auto-fill: plan, review, commit — unchanged
  // -------------------------------------------------------------------------

  const startPlanning = useCallback(async () => {
    setPlanError(null)
    setCommitResult(null)
    setPlanning(true)
    try {
      const result = await planRoomAllocation(eventId)
      if (result.ok) setPlan(result.plan)
      else setPlanError(result.error)
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : 'The plan could not be built.')
    } finally {
      setPlanning(false)
    }
  }, [eventId])

  const confirmPlan = useCallback(
    async (items: RoomPlanCommitItem[]) => {
      setCommitting(true)
      try {
        const result = await commitRoomPlan(eventId, items)
        setCommitResult(result)
        setPlan(null)
        await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.grid(eventId) })
      } catch (cause) {
        setPlanError(cause instanceof Error ? cause.message : 'Nothing was saved.')
      } finally {
        setCommitting(false)
      }
    },
    [eventId, queryClient],
  )

  // -------------------------------------------------------------------------
  // Derived lists
  // -------------------------------------------------------------------------

  const waiting = useMemo(
    () =>
      [...grid.underBedded].sort((a, b) => {
        if ((a.placed === 0) !== (b.placed === 0)) return a.placed === 0 ? -1 : 1
        if (a.shortfall !== b.shortfall) return b.shortfall - a.shortfall
        return a.headName.localeCompare(b.headName)
      }),
    [grid.underBedded],
  )

  const waitingShown = useMemo(
    () => waiting.filter((f) => matchesTerm(term, f.headName)),
    [waiting, term],
  )

  const roomsShown = useMemo(
    () =>
      grid.rooms.filter(
        (room) =>
          matchesTerm(
            term,
            room.roomNumber,
            room.roomType,
            room.hotelName,
            room.floor,
            ...room.occupants.map((o) => o.headName),
            ...room.occupants.map((o) => o.guestName),
          ) && matchesRoomFilters(roomFacts(room), effectiveFilters),
      ),
    [grid.rooms, term, effectiveFilters],
  )

  const hotels = useMemo(() => groupRoomsByHotelFloor(roomsShown), [roomsShown])

  // The venue selector's options, in first-seen order, from EVERY room — a
  // venue must not vanish from the list just because the current filter hides
  // all of its rooms, or it could never be un-chosen.
  const venueOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const room of grid.rooms) if (!seen.has(room.hotelId)) seen.set(room.hotelId, room.hotelName)
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  }, [grid.rooms])

  // The numbers on every chip, faceted against the filters on the other
  // dimensions (see `roomFilterCounts`).
  const filterFacets = useMemo(
    () => roomFilterCounts(grid.rooms.map(roomFacts), effectiveFilters),
    [grid.rooms, effectiveFilters],
  )

  // What the sheet's primary button promises: the rooms left after the filters,
  // before the search box (which the sheet does not touch).
  const filteredRoomCount = useMemo(
    () => grid.rooms.filter((room) => matchesRoomFilters(roomFacts(room), effectiveFilters)).length,
    [grid.rooms, effectiveFilters],
  )

  const sheetRooms = useMemo(
    () =>
      grid.rooms.map((room) => ({
        roomId: room.roomId,
        hotelId: room.hotelId,
        hotelName: room.hotelName,
        roomNumber: room.roomNumber,
        roomType: room.roomType,
        floor: room.floor,
        capacity: room.capacity,
        maxCapacity: room.maxCapacity,
        freeBeds: room.freeBeds,
        occupiedBeds: room.occupants.length,
        isBlocked: room.isBlocked,
        occupants: room.occupants,
      })),
    [grid.rooms],
  )

  const openRoom = openRoomId ? (sheetRooms.find((r) => r.roomId === openRoomId) ?? null) : null

  const loadError = error instanceof Error ? error.message : error ? String(error) : null
  const stale = isFetching && data !== undefined
  const lastError = place.lastError ?? move.lastError ?? remove.lastError ?? add.lastError
  const queuedCount = place.queuedCount + move.queuedCount + remove.queuedCount + add.queuedCount
  const canAutoFill = waiting.length > 0 && grid.totals.bedsFree > 0
  const hasRooms = grid.rooms.length > 0

  if (loadError && data === undefined) {
    return <ErrorState title={loadError} onRetry={() => void refetch()} />
  }

  // The review takes over the screen. It is one job — look at the plan, keep or
  // skip each family, confirm — and a board underneath it would be two.
  if (plan !== null) {
    return (
      <AllocateReview
        plan={plan}
        rooms={sheetRooms}
        committing={committing}
        onCancel={() => setPlan(null)}
        onConfirm={(items) => void confirmPlan(items)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5 pb-nav-bottombar">
      {/* The screen's state in one bar. Rooms is maroon (SPEC-V3 §2), and the
          bar is the label + done/total + a line of what is left. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-rule-strong bg-surface p-4 shadow-e1">
        {isPending ? (
          <p role="status" className="text-base text-muted">
            Counting beds…
          </p>
        ) : (
          <>
            <Progress
              label="Guests with a bed"
              done={grid.totals.guestsWithBed}
              total={grid.totals.confirmedGuests}
              tone="brand"
            />
            {/* The two figures in this card are the screen's count tiles, and
                each is a door into the list behind it: the bar into the rooms
                (a bed is a room), the waiting line into the families still to
                place. They were prose before — the numbers a coordinator reads
                first and could not act on. Two buttons, never nested: the
                second is a sibling, not a child of the first. */}
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => setTab('rooms')}
                aria-pressed={tab === 'rooms'}
                className="tap min-h-11 min-w-0 flex-1 rounded-xl border border-rule-strong px-3 py-2 text-left text-sm text-muted transition-colors duration-press ease-ledger active:bg-surface-2"
              >
                {grid.totals.bedsFree} {grid.totals.bedsFree === 1 ? 'bed' : 'beds'} free
              </button>
              <button
                type="button"
                onClick={() => setTab('waiting')}
                aria-pressed={tab === 'waiting'}
                className="tap min-h-11 min-w-0 flex-1 rounded-xl border border-rule-strong px-3 py-2 text-left text-sm text-muted transition-colors duration-press ease-ledger active:bg-surface-2"
              >
                {waiting.length === 0
                  ? 'Every family has a bed'
                  : `${waiting.length} ${waiting.length === 1 ? 'family' : 'families'} waiting`}
              </button>
            </div>
          </>
        )}
      </section>

      {/* The venue you are standing in — one choice, remembered on this
          device, because on a two-hotel event the coordinator at the Grand is
          rarely the one at the Sea View. Hidden on a single-venue event, where
          it would be a control with one answer. */}
      {venueOptions.length > 1 ? (
        <Select
          label="Venue"
          value={venue ?? ''}
          onChange={(event) => chooseVenue(event.target.value || null)}
          options={[{ value: '', label: 'All venues' }, ...venueOptions]}
        />
      ) : null}

      {planError ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {planError}
        </p>
      ) : null}

      {lastError ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {lastError}
        </p>
      ) : null}

      {queuedCount > 0 ? (
        <p
          role="status"
          className="rounded-xl border border-rule-strong bg-amber-tint px-3.5 py-3 text-sm font-medium text-ledger-amber"
        >
          {queuedCount === 1 ? '1 room change is' : `${queuedCount} room changes are`} saved on this
          phone — they send when there is signal.
        </p>
      ) : null}

      {commitResult ? (
        <CommitSummary result={commitResult} onDismiss={() => setCommitResult(null)} />
      ) : null}

      <Segmented
        label="Which list"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'rooms', label: 'By room', count: grid.rooms.length },
          { value: 'waiting', label: 'Waiting', count: waiting.length },
        ]}
      />

      {/* Searching a 168-room grid by scrolling is not a plan, and a
          coordinator holding a key card is looking for one number. One field
          for both tabs: it filters whichever list is showing. */}
      <label className="flex min-h-12 items-center gap-2 rounded-xl border border-rule-strong bg-surface px-3.5">
        <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
        <span className="sr-only">Search families and rooms</span>
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={tab === 'waiting' ? 'Search a family' : 'Search a room or a name'}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-ink outline-none placeholder:text-subtle"
        />
      </label>

      {/* One control for every room filter, and the count is the number of
          active choices, so a filter that is on is never invisible. It stays
          visible on the Waiting tab too — the two share one selection. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          aria-haspopup="dialog"
          className="tap inline-flex min-h-11 items-center gap-2 rounded-full border border-rule-strong bg-surface px-4 text-sm font-semibold text-ink transition-colors duration-press ease-ledger active:bg-surface-2"
        >
          Filter{activeFilters > 0 ? ` · ${activeFilters}` : ''}
        </button>
        {activeFilters > 0 ? (
          <button
            type="button"
            onClick={() => {
              setFilters({ types: [], hotels: [], statuses: [] })
              chooseVenue(null)
            }}
            className="tap min-h-11 px-3 text-sm font-medium text-muted underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      {stale ? (
        <p role="status" className="text-xs text-muted">
          Updating…
        </p>
      ) : null}

      {tab === 'waiting' ? (
        isPending ? (
          <LoadingRows count={5} />
        ) : (
          <WaitingList
            families={waitingShown}
            total={waiting.length}
            hasRooms={hasRooms}
            eventCode={eventCode}
            canOpenCallList={canOpenCallList}
            onPick={(family) =>
              setPlaceFor({
                groupId: family.groupId,
                headName: family.headName,
                headcount: family.headcount,
                placed: family.placed,
                shortfall: family.shortfall,
                side: family.side ?? null,
              })
            }
          />
        )
      ) : isPending ? (
        <LoadingRows count={5} />
      ) : (
        <RoomsGrid hotels={hotels} hasRooms={hasRooms} onOpen={setOpenRoomId} />
      )}

      <PlaceFamilySheet
        family={placeFor}
        rooms={sheetRooms}
        onClose={() => setPlaceFor(null)}
        onPlace={place.run}
      />

      <RoomSheet
        room={openRoom}
        rooms={sheetRooms}
        unplaced={grid.unplaced}
        onClose={() => setOpenRoomId(null)}
        onMove={move.run}
        onRemove={remove.run}
        onAdd={add.run}
      />

      <RoomFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={effectiveFilters}
        facet={filterFacets}
        resultCount={filteredRoomCount}
        venue={venue}
        venueOptions={venueOptions}
        onToggleType={(type) => setFilters((f) => ({ ...f, types: toggleInList(f.types, type) }))}
        onToggleStatus={(status) =>
          setFilters((f) => ({ ...f, statuses: toggleInList(f.statuses, status) }))
        }
        onChooseVenue={chooseVenue}
        onClear={() => {
          setFilters({ types: [], hotels: [], statuses: [] })
          chooseVenue(null)
        }}
      />

      <BottomBar
        summary={
          isPending
            ? 'Counting beds…'
            : canAutoFill
              ? // NOT the same numbers as the card above. The card already
                // says "5 beds free · 2 families waiting" and repeating it
                // here is two lines saying one thing; this line says what the
                // button does, which is the one thing the card cannot.
                'Nothing is saved until you confirm'
              : bedLine(grid.totals.bedsFree, waiting.length)
        }
        primary={
          !hasRooms
            ? { label: 'Add rooms', href: `/${eventCode}/hospitality/rooms/new` }
            : canAutoFill
              ? {
                  label: planning
                    ? 'Working out rooms…'
                    : `Auto-fill ${waiting.length} ${waiting.length === 1 ? 'family' : 'families'}`,
                  onPress: () => void startPlanning(),
                  disabled: planning,
                }
              : { label: 'Nothing to fill', onPress: () => {}, disabled: true }
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Body pieces
// ---------------------------------------------------------------------------

/** "38 beds free · 14 waiting" — the one line of state, with zeroes dropped. */
function bedLine(bedsFree: number, waiting: number): string {
  const parts: string[] = []
  parts.push(`${bedsFree} ${bedsFree === 1 ? 'bed' : 'beds'} free`)
  if (waiting > 0) {
    parts.push(`${waiting} ${waiting === 1 ? 'family' : 'families'} waiting`)
  } else {
    parts.push('every family has a bed')
  }
  return parts.join(' · ')
}

interface WaitingListProps {
  families: readonly WaitingFamily[]
  total: number
  hasRooms: boolean
  eventCode: string
  canOpenCallList: boolean
  onPick: (family: WaitingFamily) => void
}

/** Waiting families as rows — name, what they still need, and where they are. */
function WaitingList({
  families,
  total,
  hasRooms,
  eventCode,
  canOpenCallList,
  onPick,
}: WaitingListProps) {
  if (!hasRooms) {
    return (
      <EmptyState
        title="No rooms yet"
        description="Add the rooms first — every family waiting for one appears here."
        action={
          <LinkButton href={`/${eventCode}/hospitality/rooms/new`} variant="secondary" fullWidth>
            Add rooms
          </LinkButton>
        }
      />
    )
  }

  if (total === 0) {
    return (
      <EmptyState
        title="Every family has a bed"
        description="This fills in as the calling team confirms families."
        action={
          canOpenCallList ? (
            <LinkButton href={`/${eventCode}/rsvp/queue`} variant="secondary" fullWidth>
              Go to the call list
            </LinkButton>
          ) : null
        }
      />
    )
  }

  if (families.length === 0) {
    return <NoMatch />
  }

  return (
    <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
      {families.map((family) => (
        <li key={family.groupId}>
          <Row
            heading={displayName(family.headName)}
            meta={waitingLabel(family.headcount, family.placed)}
            initials={initials(family.headName)}
            status={family.needsTopUp ? 'Names' : undefined}
            tone="waiting"
            onPress={() => onPick(family)}
            trailing={<ChevronRightIcon className="h-5 w-5" />}
          />
        </li>
      ))}
    </ul>
  )
}

interface RoomsGridProps {
  hotels: ReturnType<typeof groupRoomsByHotelFloor<GridRoom>>
  hasRooms: boolean
  onOpen: (roomId: string) => void
}

/**
 * Hotel → floor → a 2-column grid of room cards.
 *
 * The card is the room: its number, one square per bed (filled = taken), and
 * the names in it. A coordinator standing in a corridor reads the shape of a
 * floor without opening anything.
 */
function RoomsGrid({ hotels, hasRooms, onOpen }: RoomsGridProps) {
  if (!hasRooms) {
    return (
      <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
        No rooms on this event yet.
      </p>
    )
  }

  if (hotels.length === 0) return <NoMatch />

  return (
    <div className="flex flex-col gap-6">
      <OccupancyLegend />
      {hotels.map((hotel) => (
        <section key={hotel.hotelId} className="flex flex-col gap-3">
          {hotels.length > 1 || hotel.floors.length > 1 ? (
            <h2 className="eyebrow text-muted">
              {hotel.hotelName} · {hotel.roomCount}{' '}
              {hotel.roomCount === 1 ? 'room' : 'rooms'}
            </h2>
          ) : null}

          {hotel.floors.map((floor) => (
            <div key={floor.floor || 'none'} className="flex flex-col gap-2">
              {hotel.floors.length > 1 ? (
                <p className="text-sm font-medium text-ink">{floor.label}</p>
              ) : null}
              <ul
                className="grid grid-cols-2 gap-2.5"
                aria-label={`${hotel.hotelName} ${floor.label}`}
              >
                {floor.rooms.map((room) => (
                  <li key={room.roomId}>
                    <RoomCard room={room} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

/** One room in the grid. Whole card is the tap target. */
function RoomCard({ room, onOpen }: { room: GridRoom; onOpen: (roomId: string) => void }) {
  const occupied = room.occupants.length
  const typeLabel = roomTypeLabel(room.roomType)
  const beds = Math.max(room.capacity, occupied)
  const heads = [...new Set(room.occupants.map((o) => o.headName))]
  const names = [...new Set(room.occupants.map((o) => firstName(o.guestName)))]
  const status = occupancyStatus(roomFacts(room))

  return (
    <button
      type="button"
      onClick={() => onOpen(room.roomId)}
      aria-label={`Room ${room.roomNumber}${typeLabel ? ` ${typeLabel}` : ''}, ${
        occupied === 0 ? 'empty' : `${OCCUPANCY_LABELS[status]}, ${occupied} of ${room.capacity} beds`
      }${names.length === 0 ? '' : `, ${names.join(', ')}`}`}
      className={cn(
        'tap flex h-full min-h-[6.5rem] w-full flex-col gap-2 rounded-2xl border bg-surface p-3 text-left',
        'transition-colors duration-press ease-ledger active:bg-surface-2',
        room.isBlocked ? 'border-rule opacity-70' : OCCUPANCY_BORDER[status],
      )}
    >
      {/* `min-w-0 truncate` on the number and `shrink-0` on the status: a
          fixture room number ("G3-HOTEL-MSKI51VD") is far wider than half a
          360px card, and without these the flex row pushes its own status
          label out of the card instead of ellipsising the number. */}
      <span className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="figure min-w-0 truncate text-xl leading-none font-semibold text-ink">
            {room.roomNumber}
          </span>
          {typeLabel ? (
            <span className="shrink-0 text-xs font-medium text-subtle">{typeLabel}</span>
          ) : null}
        </span>
        {room.isBlocked ? (
          <span className="shrink-0 text-xs font-medium text-muted">Out</span>
        ) : (
          <span className={cn('shrink-0 text-xs font-semibold', OCCUPANCY_TEXT[status])}>
            {OCCUPANCY_LABELS[status]}
          </span>
        )}
      </span>

      {/* One square per bed: filled = taken, outlined = free. A blocked room
          gets a dash — there are no beds to offer. */}
      <span aria-hidden className="flex flex-wrap gap-1">
        {room.isBlocked ? (
          <span className="h-2.5 w-2.5 rounded-xs border border-rule-strong" />
        ) : (
          Array.from({ length: beds }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-2.5 w-2.5 rounded-xs',
                i < occupied ? 'bg-brand' : 'border border-rule-strong',
              )}
            />
          ))
        )}
      </span>

      <span className="min-w-0">
        {room.isBlocked ? (
          <span className="block text-sm text-muted">Out of service</span>
        ) : names.length === 0 ? (
          <span className="block text-sm text-muted">{room.capacity} beds free</span>
        ) : (
          <>
            <span className="block truncate text-sm leading-snug text-ink">
              {names.slice(0, 2).join(', ')}
              {names.length > 2 ? ` +${names.length - 2}` : ''}
            </span>
            {heads.length > 1 ? (
              <span className="mt-0.5 block text-xs text-muted">Shared</span>
            ) : null}
          </>
        )}
        {/* The exact bed count, because the squares are a shape you read at a
            glance and "3 of 3 beds" is the number a coordinator repeats back. */}
        {room.isBlocked ? null : (
          <span className="mt-0.5 block text-xs text-muted">
            {occupied}/{room.capacity} beds
          </span>
        )}
      </span>
    </button>
  )
}

/** What the commit actually did — placed, and every failure by name. */
function CommitSummary({
  result,
  onDismiss,
}: {
  result: RoomPlanCommitResult
  onDismiss: () => void
}) {
  const failures = result.outcomes.filter((o) => !o.placed)
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-rule-strong bg-surface p-4 shadow-e1">
      <p className="text-base font-medium text-ink">
        {result.families === 0
          ? 'Nothing was saved.'
          : `${result.families} ${result.families === 1 ? 'family' : 'families'} placed · ${result.guests} ${result.guests === 1 ? 'guest' : 'guests'} now have a bed.`}
      </p>
      {failures.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Families that could not be placed">
          {failures.map((outcome) => (
            <li key={outcome.groupId} className="text-sm leading-snug">
              <span className="font-medium text-ink">{outcome.headName}</span>
              <span className="text-muted"> — {outcome.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Button variant="secondary" fullWidth onClick={onDismiss}>
        Done
      </Button>
    </div>
  )
}

/** A search that matched nothing, in the same voice on both tabs. */
function NoMatch() {
  return (
    <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
      Nothing matches that search.
    </p>
  )
}

/** A person's name first, never an id. */
function displayName(headName: string | null | undefined): string {
  return headName?.trim() || 'Unnamed family'
}

/** The first word of a name — what fits on a 164px card. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

// ---------------------------------------------------------------------------
// Room filters — the pure parts live in `@/lib/rooms/filters`; these are the
// pixels: the colour key, the "Filter · n" sheet, and the row adapter.
// ---------------------------------------------------------------------------

/**
 * A room, as the filter arithmetic sees it. `GridRoom` carries `occupants`
 * (the rows) but no bed count, so the two are reconciled here, once, and both
 * the filter test and the chip counts read the same shape.
 */
function roomFacts(room: GridRoom): RoomFilterable {
  return {
    roomType: room.roomType,
    hotelId: room.hotelId,
    capacity: room.capacity,
    occupied: room.occupants.length,
  }
}

/** Occupancy -> the ledger colour the card's status word takes. */
const OCCUPANCY_TEXT: Record<OccupancyStatus, string> = {
  empty: 'text-ledger-green',
  partly: 'text-ledger-amber',
  full: 'text-ledger-red',
}

/**
 * Occupancy -> the card's border. A tint, not a fill: the bed squares are the
 * data, and a card washed in colour behind them fights its own contents.
 */
const OCCUPANCY_BORDER: Record<OccupancyStatus, string> = {
  empty: 'border-ledger-green/45',
  partly: 'border-ledger-amber/50',
  full: 'border-ledger-red/45',
}

/** The solid dot for the key below the grid. */
const OCCUPANCY_DOT: Record<OccupancyStatus, string> = {
  empty: 'bg-ledger-green',
  partly: 'bg-ledger-amber',
  full: 'bg-ledger-red',
}

/** Three words and three swatches, so the border colours are not a guess. */
function OccupancyLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Room occupancy key">
      {OCCUPANCY_STATUSES.map((status) => (
        <li key={status} className="flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', OCCUPANCY_DOT[status])} />
          {OCCUPANCY_LABELS[status]}
        </li>
      ))}
    </ul>
  )
}

interface RoomFilterSheetProps {
  open: boolean
  onClose: () => void
  /** What is currently applied, including the venue. */
  filters: RoomFilters
  facet: RoomFilterCounts
  /** Rooms left after the filters — the promise on the primary button. */
  resultCount: number
  venue: string | null
  venueOptions: readonly { value: string; label: string }[]
  onToggleType: (type: RoomType) => void
  onToggleStatus: (status: OccupancyStatus) => void
  onChooseVenue: (venueId: string | null) => void
  onClear: () => void
}

/**
 * The one filter sheet (SPEC A5).
 *
 * A single sheet rather than a row of chips on the board: with three dimensions
 * and up to six values each, an inline chip row is a wall that pushes the grid
 * below the fold on a 390px screen. The count on every chip is a facet count
 * (see `roomFilterCounts`), so choosing "Deluxe" leaves the "Suite" and "King"
 * chips showing what they would still find.
 */
function RoomFilterSheet({
  open,
  onClose,
  filters,
  facet,
  resultCount,
  venue,
  venueOptions,
  onToggleType,
  onToggleStatus,
  onChooseVenue,
  onClear,
}: RoomFilterSheetProps) {
  const active = activeRoomFilterCount(filters)

  return (
    <BottomSheet open={open} onClose={onClose} label="Filter rooms">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Filter rooms</h2>
          {active > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="tap min-h-11 px-2 text-sm font-medium text-brand underline"
            >
              Clear all
            </button>
          ) : null}
        </div>

        <FilterSection title="Type">
          {ROOM_TYPES.map((type) => (
            <Chip
              key={type}
              selected={filters.types.includes(type)}
              onClick={() => onToggleType(type)}
            >
              {ROOM_TYPE_LABELS[type]}
              <span className="figure ml-1.5 font-normal">({facet.types[type]})</span>
            </Chip>
          ))}
        </FilterSection>

        {venueOptions.length > 1 ? (
          <FilterSection title="Venue">
            {venueOptions.map((option) => (
              <Chip
                key={option.value}
                selected={venue === option.value}
                onClick={() => onChooseVenue(venue === option.value ? null : option.value)}
              >
                {option.label}
                <span className="figure ml-1.5 font-normal">
                  ({facet.hotels[option.value] ?? 0})
                </span>
              </Chip>
            ))}
          </FilterSection>
        ) : null}

        <FilterSection title="Status">
          {OCCUPANCY_STATUSES.map((status) => (
            <Chip
              key={status}
              selected={filters.statuses.includes(status)}
              onClick={() => onToggleStatus(status)}
            >
              {OCCUPANCY_LABELS[status]}
              <span className="figure ml-1.5 font-normal">({facet.statuses[status]})</span>
            </Chip>
          ))}
        </FilterSection>

        <Button variant="primary" fullWidth onClick={onClose}>
          {resultCount === 1 ? 'Show 1 room' : `Show ${resultCount} rooms`}
        </Button>
      </div>
    </BottomSheet>
  )
}

/** A titled group of chips. */
function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="eyebrow text-muted">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  )
}

export default RoomsBoard
