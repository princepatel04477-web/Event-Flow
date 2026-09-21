'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { BuildingIcon, InboxIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LinkButton } from '@/components/ui/LinkButton'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { PageTitle } from '@/components/ui/PageTitle'
import { StatusPill } from '@/components/ui/StatusPill'
import { SyncChip } from '@/components/ui/SyncChip'
import { assignGroupToRoom, readRoomsGrid } from '@/lib/actions/rooms'
import { roomGuardMessage } from '@/lib/errors'
import { useOptimisticAction } from '@/lib/mutate/useOptimisticAction'
import { queryKeys } from '@/lib/query/keys'
import { cn } from '@/lib/utils'

import { AppHint } from '../../_components/AppHint'

export interface GiveRoomProps {
  eventId: string
  /**
   * Needed by the empty state, not by the flow: "there are no rooms yet" has to
   * point somewhere the reader can act. The shell already knows the code and
   * the page already has it — passing it is cheaper than a hook per link.
   */
  eventCode: string
  /**
   * Whether this viewer's department may open the call list.
   *
   * Answered by the page's guard, not guessed here. `hospitality` is not in
   * `DEPARTMENT_SECTIONS.rsvp`, so for the runner this screen is built for the
   * link would bounce off `rsvp/queue`'s own guard and land back here with a
   * `?denied=section` marker nothing renders — the empty state's only control,
   * doing nothing. Offered only when the guard would let them in.
   */
  canOpenCallList: boolean
}

type GridData = Awaited<ReturnType<typeof readRoomsGrid>>
type NeedingFamily = GridData['underBedded'][number]

/**
 * Job 2's screen: pick a family, then pick a room.
 *
 * THE ORDER IS THE WHOLE CHANGE. The v1 rooms screen is a grid of numbered
 * tiles with dots and a five-state legend — nothing on it is a person's name,
 * and its own footnote explains database capacity enforcement. A coordinator
 * standing in a lobby does not know that room 412 needs filling; they know that
 * Mrs Sharma's six people have nowhere to sleep. So this screen leads with the
 * families, by name, and the room list is the second step of that one flow.
 *
 * WHAT COUNTS AS "NEEDS A ROOM". `readRoomsGrid`'s `underBedded` is every
 * confirmed family whose placed head count is below its headcount — that is the
 * whole population this job is for. `placed === 0` is "nowhere to sleep" and
 * gets the full write; a family that already has a room but not enough beds is
 * reported honestly instead of being offered a write that cannot work (see the
 * note at the foot of the list).
 *
 * The read is the SAME server action and the SAME cache key the v1 grid uses,
 * so the two screens share one entry rather than holding two copies of the room
 * register that can disagree.
 */
export function GiveRoom({ eventId, eventCode, canOpenCallList }: GiveRoomProps) {
  const [pickerFor, setPickerFor] = useState<NeedingFamily | null>(null)
  const [hotel, setHotel] = useState<string | null>(null)

  const {
    data,
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.rooms.grid(eventId),
    queryFn: () => readRoomsGrid(eventId),
  })

  /**
   * Placing a whole family in one room.
   *
   * `assignGroupToRoom` is the only action here that can do the job correctly:
   * it tops the family's `guests` rows up to its headcount FIRST — the Excel
   * import creates one row per family, so assigning "the family" without that
   * placed one person out of six and reported success — and then inserts every
   * member in ONE statement, so the merged room guard either fits them all or
   * rejects the lot. A loop of single-guest assigns would leave a half-placed
   * family on the first refusal.
   *
   * DEFERRED, so Undo is real. A room assignment is reversible in principle,
   * but the reverse (`releaseGuestFromRoom`) is per ASSIGNMENT and this write
   * creates the family's assignments in one statement whose ids do not exist
   * until the server answers — an Undo built on that could not name what to
   * release without a second read. Holding the write until the window closes
   * makes Undo mean NOTHING WAS SENT instead (docs/UX-RULES.md R5).
   *
   * The trade is stated where the decision is made: for seven seconds the bed
   * is not really taken, so a second coordinator can claim it, and the deferred
   * write then fails the room guard and says so on the list. That is a visible
   * failure rather than a silent one.
   */
  const assign = useOptimisticAction<GridData, { groupId: string; roomId: string; headName: string }, { assigned: number }>(
    {
      queryKey: queryKeys.rooms.grid(eventId),
      callSite: 'v2-assign-group-to-room',
      deferUntilCommit: true,
      message: (v) => `${v.headName} · Room given`,
      // The family leaves the list on the tap. `apply` can run before the first
      // read has landed, so the empty branch has to be a value of the same
      // shape rather than `undefined` — the write is only reachable from a
      // family row, which means the real data was on screen a moment ago.
      apply: (prev, v) =>
        prev
          ? { ...prev, underBedded: prev.underBedded.filter((f) => f.groupId !== v.groupId) }
          : { rooms: [], unplaced: [], underBedded: [] },
      action: async (v) => {
        const result = await assignGroupToRoom(eventId, v.groupId, v.roomId)
        if (result.ok) return { ok: true, data: { assigned: result.assigned } }

        // 23514 from the merged guard is the ONE failure this screen has to
        // explain, and it is NOT one failure. The guard raises the same
        // SQLSTATE for a room at its bed ceiling and for a room that already
        // holds an overlapping stay, and the second cannot be forced through at
        // all — so saying "either" was the old copy's problem, and offering an
        // override for an overlap would be worse. The action now hands back
        // WHICH cause it was, read from the trigger's own message;
        // `roomGuardMessage` turns that into the sentence and the next step, and
        // returns null for a cause it does not recognise — which is when the old
        // either/or sentence is shown, now as a genuine fallback rather than as
        // the answer to every failure.
        if (result.code === 'capacity') {
          return {
            ok: false,
            message:
              roomGuardMessage(result.cause ?? null, { roomNumber: result.roomNumber }) ??
              `Room ${result.roomNumber ?? v.roomId} cannot take this family — it is either full for those dates or has no bed left. Choose another room.`,
          }
        }
        return { ok: false, message: result.error }
      },
      queue: { eventId, kind: 'assign-group-room', what: 'room assignment' },
    },
  )

  const rooms = useMemo(() => data?.rooms ?? [], [data])
  const needing = useMemo(
    () =>
      (data?.underBedded ?? [])
        .filter((f) => f.placed === 0)
        .sort((a, b) => a.headName.localeCompare(b.headName)),
    [data],
  )
  const partlyPlaced = (data?.underBedded ?? []).filter((f) => f.placed > 0)

  const hotels = useMemo(() => {
    const names = new Set(rooms.filter((r) => !r.isBlocked).map((r) => r.hotelName))
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [rooms])

  const pickable = useMemo(() => {
    const open = rooms.filter((r) => !r.isBlocked)
    const list = hotel === null ? open : open.filter((r) => r.hotelName === hotel)
    const beds = pickerFor ? Math.max(1, pickerFor.shortfall) : 1
    // Most headroom first, then the hotel/room order a person walking a
    // corridor reads. Rooms that LOOK too small stay in the list: `freeBeds` is
    // measured against `rooms.capacity`, and the database's own ceiling is
    // `max_capacity`, which this read does not carry — so the room that fits a
    // family of six may well be the one that reads "4 of 4 taken", and hiding it
    // would remove the only room that works.
    return [...list].sort((a, b) => {
      const aRoom = a.capacity - a.occupants.length
      const bRoom = b.capacity - b.occupants.length
      const aFits = aRoom >= beds ? 1 : 0
      const bFits = bRoom >= beds ? 1 : 0
      if (aFits !== bFits) return bFits - aFits
      if (aFits === 1 && bFits === 1 && aRoom !== bRoom) return bRoom - aRoom
      const h = a.hotelName.localeCompare(b.hotelName)
      if (h !== 0) return h
      return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
    })
  }, [rooms, hotel, pickerFor])

  const blockedCount = rooms.filter((r) => r.isBlocked).length
  const loadError = error instanceof Error ? error.message : error ? String(error) : null
  const stale = isFetching && data !== undefined

  if (loadError && data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle>Give a family a room</PageTitle>
        <ErrorState title={loadError} onRetry={() => void refetch()} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* One title row and nothing else above the first name: no grid, no
          legend, no capacity footnote. */}
      <PageTitle className="min-w-0">Give a family a room</PageTitle>

      {stale ? (
        <p role="status" className="-mt-1 text-xs text-muted">
          Updating…
        </p>
      ) : null}

      {/* One line, once per device, above the work. Tap anywhere to clear it. */}
      <AppHint screen="rooms-give">Tap Give a room to place a family</AppHint>

      {assign.lastError ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {assign.lastError}
        </p>
      ) : null}

      <SyncChip count={assign.queuedCount} what="room assignment" />

      {isPending ? (
        <LoadingRows count={5} />
      ) : rooms.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon className="h-7 w-7" />}
          title="No rooms on this event yet"
          description="Rooms have not been added to this event. Once they are, every confirmed family waiting for one appears here."
          action={
            // A dead end is the one thing R3 forbids, and "ask your event lead"
            // is an instruction, not an action. `rooms/new` is where rooms are
            // added and it is a real screen in this group (a shim of the v1
            // adder), reachable by both an event lead and a Rooms runner — the
            // two people who can act on this line. The bare section root is NOT
            // the destination: under v2 it is this same screen, i.e. a link
            // back to itself.
            <LinkButton href={`/${eventCode}/hospitality/rooms/new`} variant="secondary" fullWidth>
              Add rooms
            </LinkButton>
          }
        />
      ) : needing.length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="h-7 w-7" />}
          title="Every family has a room"
          description="No confirmed family is waiting for one. This fills in as the calling team confirms families."
          action={
            // The screen that feeds this one: a family appears here after it is
            // confirmed on a call. Offered ONLY to a viewer the call list's own
            // guard would admit — for a Rooms runner that link bounced straight
            // back to this page, silently, and this empty state is where they
            // land every time they clear their queue.
            canOpenCallList ? (
              <LinkButton href={`/${eventCode}/rsvp/queue`} variant="secondary" fullWidth>
                Go to the call list
              </LinkButton>
            ) : null
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="Families waiting for a room">
          {needing.map((family) => (
            <li
              key={family.groupId}
              className="list-fade flex flex-col gap-3 rounded-2xl border border-rule-strong bg-surface p-4 shadow-e1"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg leading-snug font-medium text-ink">
                    {displayName(family)}
                  </h2>
                  <p className="mt-0.5 text-sm text-muted">
                    {family.headcount === 1
                      ? '1 guest, no room yet'
                      : `${family.headcount} guests, no room yet`}
                  </p>
                </div>
                {family.memberRows < family.headcount ? (
                  <StatusPill tone="neutral">Names to add</StatusPill>
                ) : null}
              </div>

              <Button
                size="lg"
                fullWidth
                onClick={() => {
                  setHotel(null)
                  setPickerFor(family)
                }}
              >
                Give a room
              </Button>
            </li>
          ))}
        </ul>
      )}

      {partlyPlaced.length > 0 ? (
        <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm leading-snug text-muted">
          {partlyPlaced.length === 1
            ? '1 family already has a room but not enough beds for everyone. Tell your event lead which family it is.'
            : `${partlyPlaced.length} families already have a room but not enough beds for everyone. Tell your event lead which family it is.`}
        </p>
      ) : null}

      {blockedCount > 0 ? (
        <p className="text-center text-xs leading-relaxed text-muted">
          {blockedCount === 1
            ? '1 room is marked out of service and is not offered.'
            : `${blockedCount} rooms are marked out of service and are not offered.`}
        </p>
      ) : null}

      <BottomSheet
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        label="Pick a room"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-ink">
              Room for {pickerFor ? displayName(pickerFor) : 'this family'}
            </h2>
            <p className="text-sm leading-snug text-muted">
              {pickerFor
                ? `${pickerFor.shortfall === 1 ? '1 guest' : `${pickerFor.shortfall} guests`} to place.`
                : ''}
            </p>
          </div>

          {hotels.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Which hotel">
              <Chip selected={hotel === null} onClick={() => setHotel(null)}>
                All hotels
              </Chip>
              {hotels.map((name) => (
                <Chip key={name} selected={hotel === name} onClick={() => setHotel(name)}>
                  {name}
                </Chip>
              ))}
            </div>
          ) : null}

          {pickable.length === 0 ? (
            <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
              No room is free in this hotel. Pick another hotel, or ask your event lead to add
              rooms.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pickable.map((room) => {
                const beds = pickerFor ? Math.max(1, pickerFor.shortfall) : 1
                const free = room.capacity - room.occupants.length
                const tight = free < beds
                return (
                  <li key={room.roomId}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!pickerFor) return
                        assign.run({
                          groupId: pickerFor.groupId,
                          roomId: room.roomId,
                          headName: displayName(pickerFor),
                        })
                        setPickerFor(null)
                      }}
                      className="tap flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-left active:bg-surface-2"
                    >
                      <span className="min-w-0">
                        <span className="figure block text-lg leading-none font-medium text-ink">
                          {room.roomNumber}
                        </span>
                        <span className="mt-1 block truncate text-sm text-muted">
                          {room.hotelName}
                          {room.occupants.length === 0 ? ' · empty' : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={cn(
                            'figure text-sm',
                            free <= 0 ? 'text-ledger-red' : 'text-muted',
                          )}
                        >
                          {room.occupants.length} of {room.capacity} beds
                        </span>
                        {tight ? <StatusPill tone="attention">May be too small</StatusPill> : null}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <Button variant="secondary" size="lg" fullWidth onClick={() => setPickerFor(null)}>
            Cancel
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}

/** A person's name first, never an id. */
function displayName(family: NeedingFamily): string {
  const name = family.headName?.trim()
  return name || 'Unnamed family'
}

export default GiveRoom
