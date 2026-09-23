'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { BuildingIcon, ChevronRightIcon, InboxIcon, SearchIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LinkButton } from '@/components/ui/LinkButton'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { PageTitle } from '@/components/ui/PageTitle'
import { SectionHead } from '@/components/ui/SectionHead'
import { Spinner } from '@/components/ui/Spinner'
import { StatusPill } from '@/components/ui/StatusPill'
import { SyncChip } from '@/components/ui/SyncChip'
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
import {
  bedsLabel,
  boardSummary,
  groupRoomsByHotelFloor,
  matchesTerm,
  waitingLabel,
} from '@/lib/rooms/board'
import { cn } from '@/lib/utils'

import { AppHint } from '../../_components/AppHint'
import { AllocateReview } from './_components/AllocateReview'
import { PlaceFamilySheet, type PlaceFamily } from './_components/PlaceFamilySheet'
import { RoomSheet } from './_components/RoomSheet'
import { Segmented } from './_components/Segmented'

type GridData = Awaited<ReturnType<typeof readRoomsGrid>>
type WaitingFamily = GridData['underBedded'][number]

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
 * The Rooms board — the state of the room register in one screen.
 *
 * WHAT IT REPLACES. `GiveRoom.tsx` was forty identical full-width "Give a room"
 * buttons, one per waiting family, and nothing else: no view of the rooms, no
 * count of free beds, and no way to see that the allocator existed. Placing 238
 * families meant 238 taps into a sheet, in whatever order the list happened to
 * be in. The engine to do it in one pass had been in `src/lib/allocate/` the
 * whole time; v2 simply never called it.
 *
 * THE SHAPE. One line of state at the top, a switch between the two questions a
 * coordinator actually has (who has nowhere to sleep / what is in room 214), a
 * search that filters whichever one is showing, and ONE primary button:
 * auto-allocate. The proposal is reviewed before anything is written, and every
 * placement stays editable afterwards from the room sheet — the brief's Phase 2
 * asks for exactly that, a living assignment rather than a fixed one.
 */
export function RoomsBoard({ eventId, eventCode, canOpenCallList }: RoomsBoardProps) {
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<'waiting' | 'rooms'>('waiting')
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
  // The four reversible writes this screen makes
  // -------------------------------------------------------------------------

  /**
   * Place `count` of a family's unplaced guests in one room.
   *
   * DEFERRED, so Undo is real: a room assignment's id does not exist until the
   * server answers, and an Undo built on `releaseGuestFromRoom` could not name
   * what to release without a second read. Holding the write until the undo
   * window closes makes Undo mean NOTHING WAS SENT instead
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
    { assignmentId: string; guestName: string; fromRoomId: string; toRoomId: string; toRoomNumber: string },
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
  // Auto-allocate: plan, review, commit
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
      grid.rooms.filter((room) =>
        matchesTerm(
          term,
          room.roomNumber,
          room.hotelName,
          room.floor,
          ...room.occupants.map((o) => o.headName),
          ...room.occupants.map((o) => o.guestName),
        ),
      ),
    [grid.rooms, term],
  )

  const hotels = useMemo(() => groupRoomsByHotelFloor(roomsShown), [roomsShown])

  /** Where each waiting family already has beds — "2 in room 101". */
  const familyRooms = useMemo(() => {
    const map = new Map<string, { roomNumber: string; count: number }[]>()
    for (const room of grid.rooms) {
      const perFamily = new Map<string, number>()
      for (const occupant of room.occupants) {
        perFamily.set(occupant.groupId, (perFamily.get(occupant.groupId) ?? 0) + 1)
      }
      for (const [groupId, n] of perFamily) {
        const list = map.get(groupId) ?? []
        list.push({ roomNumber: room.roomNumber, count: n })
        map.set(groupId, list)
      }
    }
    return map
  }, [grid.rooms])

  const sheetRooms = useMemo(
    () =>
      grid.rooms.map((room) => ({
        roomId: room.roomId,
        hotelId: room.hotelId,
        hotelName: room.hotelName,
        roomNumber: room.roomNumber,
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

  const blockedCount = grid.rooms.filter((r) => r.isBlocked).length
  const loadError = error instanceof Error ? error.message : error ? String(error) : null
  const stale = isFetching && data !== undefined
  const lastError = place.lastError ?? move.lastError ?? remove.lastError ?? add.lastError
  const queuedCount = place.queuedCount + move.queuedCount + remove.queuedCount + add.queuedCount
  const canAutoAllocate = waiting.length > 0 && grid.totals.bedsFree > 0

  if (loadError && data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle>Rooms</PageTitle>
        <ErrorState title={loadError} onRetry={() => void refetch()} />
      </div>
    )
  }

  // The review takes over the screen. It is one job — look at the plan, keep
  // or skip each row, confirm — and a board underneath it would be two.
  if (plan !== null) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle className="min-w-0">Auto-allocate</PageTitle>
        <AllocateReview
          plan={plan}
          rooms={sheetRooms}
          committing={committing}
          onCancel={() => setPlan(null)}
          onConfirm={(items) => void confirmPlan(items)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle className="min-w-0">Rooms</PageTitle>

      <p className="text-sm leading-snug text-muted" role="status">
        {isPending ? 'Counting beds…' : boardSummary(grid.totals)}
      </p>

      {stale ? (
        <p role="status" className="-mt-2 text-xs text-muted">
          Updating…
        </p>
      ) : null}

      <AppHint screen="rooms-give">
        Auto-allocate proposes rooms for everyone waiting. Nothing is saved until you confirm.
      </AppHint>

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

      {commitResult ? (
        <CommitSummary result={commitResult} onDismiss={() => setCommitResult(null)} />
      ) : null}

      <SyncChip count={queuedCount} what="room change" />

      <Segmented
        label="Which list"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'waiting', label: 'Waiting', count: waiting.length },
          { value: 'rooms', label: 'Rooms', count: grid.rooms.length },
        ]}
      />

      <label className="flex min-h-14 items-center gap-2 rounded-xl border border-rule-strong bg-surface px-3.5">
        <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
        <span className="sr-only">Search families and rooms</span>
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={tab === 'waiting' ? 'Search a family' : 'Search a room or a name'}
          className="min-w-0 flex-1 bg-transparent py-3 text-base text-ink outline-none placeholder:text-muted"
        />
      </label>

      {/* THE one primary button on this screen. */}
      {canAutoAllocate ? (
        planning ? (
          <p
            role="status"
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-rule-strong bg-surface text-sm font-medium text-ink"
          >
            <Spinner size="sm" label={null} />
            Working out the best rooms…
          </p>
        ) : (
          <Button size="lg" fullWidth onClick={() => void startPlanning()}>
            Auto-allocate {waiting.length} {waiting.length === 1 ? 'family' : 'families'}
          </Button>
        )
      ) : null}

      {isPending ? (
        <LoadingRows count={5} />
      ) : tab === 'waiting' ? (
        <WaitingList
          families={waitingShown}
          total={waiting.length}
          familyRooms={familyRooms}
          hasRooms={grid.rooms.length > 0}
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
      ) : (
        <RoomsList hotels={hotels} eventCode={eventCode} onOpen={setOpenRoomId} />
      )}

      {blockedCount > 0 ? (
        <p className="text-center text-xs leading-relaxed text-muted">
          {blockedCount === 1
            ? '1 room is out of service and is never offered.'
            : `${blockedCount} rooms are out of service and are never offered.`}
        </p>
      ) : null}

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
    </div>
  )
}

// ---------------------------------------------------------------------------

interface WaitingListProps {
  families: readonly WaitingFamily[]
  total: number
  familyRooms: Map<string, { roomNumber: string; count: number }[]>
  hasRooms: boolean
  eventCode: string
  canOpenCallList: boolean
  onPick: (family: WaitingFamily) => void
}

/** Compact rows — name, what they still need, where they already are. */
function WaitingList({
  families,
  total,
  familyRooms,
  hasRooms,
  eventCode,
  canOpenCallList,
  onPick,
}: WaitingListProps) {
  if (!hasRooms) {
    return (
      <EmptyState
        icon={<BuildingIcon className="h-7 w-7" />}
        title="No rooms on this event yet"
        description="Rooms have not been added. Once they are, every confirmed family waiting for one appears here."
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
        icon={<InboxIcon className="h-7 w-7" />}
        title="Every family has a bed"
        description="No confirmed family is waiting. This fills in as the calling team confirms families."
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
    return (
      <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
        No waiting family matches that search.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="Families waiting for a room">
      {families.map((family) => {
        const here = familyRooms.get(family.groupId) ?? []
        return (
          <li key={family.groupId}>
            <button
              type="button"
              onClick={() => onPick(family)}
              className="tap flex min-h-16 w-full items-center gap-3 rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-left active:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base leading-snug font-medium text-ink">
                  {displayName(family.headName)}
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted">
                  {waitingLabel(family.headcount, family.placed)}
                  {here.length > 0
                    ? ` · ${here.map((r) => `${r.count} in ${r.roomNumber}`).join(', ')}`
                    : ''}
                </span>
              </span>
              {family.needsTopUp ? <StatusPill tone="neutral">Names to add</StatusPill> : null}
              <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

interface RoomsListProps {
  hotels: ReturnType<typeof groupRoomsByHotelFloor<GridData['rooms'][number]>>
  eventCode: string
  onOpen: (roomId: string) => void
}

/** Hotel → floor → room cards. Occupant names on the card, not behind a tap. */
function RoomsList({ hotels, eventCode, onOpen }: RoomsListProps) {
  if (hotels.length === 0) {
    return (
      <EmptyState
        icon={<BuildingIcon className="h-7 w-7" />}
        title="No room matches that search"
        description="Try a room number, a hotel, or a family name."
        action={
          <LinkButton href={`/${eventCode}/hospitality/rooms/new`} variant="secondary" fullWidth>
            Add rooms
          </LinkButton>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {hotels.map((hotel) => (
        <section key={hotel.hotelId} className="flex flex-col gap-3">
          <SectionHead
            eyebrow={hotel.hotelName}
            right={`${hotel.roomCount} ${hotel.roomCount === 1 ? 'room' : 'rooms'}`}
            inline
          />
          {hotel.floors.map((floor) => (
            <div key={floor.floor || 'none'} className="flex flex-col gap-2">
              {hotel.floors.length > 1 ? (
                <p className="eyebrow text-muted">{floor.label}</p>
              ) : null}
              <ul className="flex flex-col gap-2" aria-label={`${hotel.hotelName} ${floor.label}`}>
                {floor.rooms.map((room) => {
                  const occupied = room.occupants.length
                  const families = [...new Set(room.occupants.map((o) => o.headName))]
                  return (
                    <li key={room.roomId}>
                      <button
                        type="button"
                        onClick={() => onOpen(room.roomId)}
                        className={cn(
                          'tap flex min-h-16 w-full items-center gap-3 rounded-xl border bg-surface px-3.5 py-3 text-left active:bg-surface-2',
                          room.isBlocked ? 'border-rule' : 'border-rule-strong',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="figure block text-base leading-snug font-medium text-ink">
                            {room.roomNumber} · {bedsLabel(occupied, room.capacity)}
                          </span>
                          <span className="mt-0.5 block truncate text-sm text-muted">
                            {room.isBlocked
                              ? 'Out of service'
                              : families.length === 0
                                ? 'Empty'
                                : families.join(', ')}
                          </span>
                        </span>
                        {!room.isBlocked && room.freeBeds > 0 && occupied > 0 ? (
                          <StatusPill tone="attention">
                            {room.freeBeds} free
                          </StatusPill>
                        ) : null}
                        <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
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

/** A person's name first, never an id. */
function displayName(headName: string | null | undefined): string {
  return headName?.trim() || 'Unnamed family'
}

export default RoomsBoard
