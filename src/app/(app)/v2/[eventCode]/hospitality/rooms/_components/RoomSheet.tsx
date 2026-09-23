'use client'

import { useMemo, useState } from 'react'

import { SearchIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'
import { bedsLabel, compareRoomNumbers, matchesTerm } from '@/lib/rooms/board'
import { cn } from '@/lib/utils'

export interface SheetOccupant {
  guestId: string
  guestName: string
  groupId: string
  headName: string
  groupType: string
  side: string | null
  assignmentId: string
  isHead: boolean
}

export interface SheetRoom {
  roomId: string
  hotelId: string
  hotelName: string
  roomNumber: string
  floor: string | null
  capacity: number
  freeBeds: number
  isBlocked: boolean
  occupants: SheetOccupant[]
}

export interface SheetUnplacedGuest {
  guestId: string
  guestName: string
  groupId: string
  headName: string
  groupType: string
  side: string | null
}

export interface RoomSheetProps {
  room: SheetRoom | null
  /** Every room, for the Move target list. */
  rooms: readonly SheetRoom[]
  /** Confirmed guests with no bed, for "Add a guest" and the share offer. */
  unplaced: readonly SheetUnplacedGuest[]
  onClose: () => void
  onMove: (input: {
    assignmentId: string
    guestName: string
    fromRoomId: string
    toRoomId: string
    toRoomNumber: string
  }) => void
  onRemove: (input: { assignmentId: string; guestId: string; guestName: string; roomId: string }) => void
  onAdd: (input: { guestId: string; guestName: string; roomId: string; roomNumber: string }) => void
}

type Mode =
  | { kind: 'occupants' }
  | { kind: 'move'; occupant: SheetOccupant }
  | { kind: 'add' }
  /** The same picker as `add`, narrowed to singles who may share this room. */
  | { kind: 'share'; with: SheetOccupant }

/**
 * One room, and everything a coordinator standing outside its door can do:
 * see who is in it, move one of them, take one out, put somebody in, and pair
 * a single with another single.
 *
 * REMOVE RELEASES, IT DOES NOT DELETE. `releaseGuestFromRoom` stamps
 * `released_at`, so the row survives as history and the client profile card can
 * still answer "where did they sleep on the 20th". Nothing in this app deletes
 * a room assignment.
 *
 * THE SHARE OFFER IS A FILTER, NOT A DIFFERENT WRITE. "Share with another
 * single" lists the unplaced guests whose family is a single on the SAME side,
 * and then adds one exactly the way "Add a guest" would. The brief asks for
 * that pairing to be editable rather than fixed (Phase 2), and the cheapest way
 * to keep it editable is for it never to have been a special kind of row.
 */
export function RoomSheet({
  room,
  rooms,
  unplaced,
  onClose,
  onMove,
  onRemove,
  onAdd,
}: RoomSheetProps) {
  const [mode, setMode] = useState<Mode>({ kind: 'occupants' })
  const [term, setTerm] = useState('')
  const [seededFor, setSeededFor] = useState<string | null>(null)

  if (room !== null && seededFor !== room.roomId) {
    setSeededFor(room.roomId)
    setMode({ kind: 'occupants' })
    setTerm('')
  }

  const moveTargets = useMemo(() => {
    if (!room) return []
    return [...rooms]
      .filter((r) => r.roomId !== room.roomId && !r.isBlocked)
      .sort((a, b) => {
        const aFits = a.freeBeds > 0 ? 1 : 0
        const bFits = b.freeBeds > 0 ? 1 : 0
        if (aFits !== bFits) return bFits - aFits
        const sameHotel = (r: SheetRoom) => (r.hotelId === room.hotelId ? 0 : 1)
        if (sameHotel(a) !== sameHotel(b)) return sameHotel(a) - sameHotel(b)
        return compareRoomNumbers(a.roomNumber, b.roomNumber)
      })
  }, [rooms, room])

  const addable = useMemo(() => {
    if (mode.kind !== 'add' && mode.kind !== 'share') return []
    const pool =
      mode.kind === 'share'
        ? unplaced.filter(
            (g) =>
              g.groupType === 'single' &&
              g.side !== null &&
              g.side === mode.with.side &&
              g.groupId !== mode.with.groupId,
          )
        : unplaced
    return pool
      .filter((g) => matchesTerm(term, g.guestName, g.headName))
      .slice(0, 40)
  }, [mode, unplaced, term])

  // Nothing to show and nothing to keep mounted: the sheet has no open/close
  // animation state of its own, so an unmounted sheet and a closed one look
  // identical to the user and this way the room's state cannot go stale.
  if (room === null) return null

  const occupied = room.occupants.length
  const title = `${room.hotelName} · Room ${room.roomNumber}`
  const lonelySingle =
    occupied === 1 && room.occupants[0].groupType === 'single' && room.freeBeds > 0
      ? room.occupants[0]
      : null

  return (
    <BottomSheet open onClose={onClose} label={title}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <p className="figure text-sm text-muted">
            {bedsLabel(occupied, room.capacity)}
            {room.floor ? ` · ${room.floor}` : ''}
            {room.isBlocked ? ' · out of service' : ''}
          </p>
        </div>

        {mode.kind === 'occupants' ? (
          <>
            {occupied === 0 ? (
              <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
                This room is empty.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Who is in this room">
                {room.occupants.map((occupant) => (
                  <li
                    key={occupant.assignmentId}
                    className="flex flex-col gap-2 rounded-xl border border-rule-strong bg-surface px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-base leading-snug font-medium text-ink">
                        {occupant.guestName}
                      </p>
                      <p className="truncate text-sm text-muted">
                        {occupant.headName}
                        {occupant.isHead ? ' · family head' : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        className="flex-1"
                        onClick={() => setMode({ kind: 'move', occupant })}
                      >
                        Move
                      </Button>
                      <Button
                        variant="ghost"
                        className="flex-1"
                        onClick={() =>
                          onRemove({
                            assignmentId: occupant.assignmentId,
                            guestId: occupant.guestId,
                            guestName: occupant.guestName,
                            roomId: room.roomId,
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {lonelySingle ? (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => {
                  setTerm('')
                  setMode({ kind: 'share', with: lonelySingle })
                }}
              >
                Share with another single…
              </Button>
            ) : null}

            <Button
              size="lg"
              fullWidth
              onClick={() => {
                setTerm('')
                setMode({ kind: 'add' })
              }}
            >
              Add a guest
            </Button>

            <Button variant="ghost" size="lg" fullWidth onClick={onClose}>
              Close
            </Button>
          </>
        ) : null}

        {mode.kind === 'move' ? (
          <>
            <p className="text-sm text-muted">
              Move {mode.occupant.guestName} to which room?
            </p>
            <ul className="flex flex-col gap-2" aria-label="Move to which room">
              {moveTargets.map((target) => (
                <li key={target.roomId}>
                  <button
                    type="button"
                    onClick={() => {
                      onMove({
                        assignmentId: mode.occupant.assignmentId,
                        guestName: mode.occupant.guestName,
                        fromRoomId: room.roomId,
                        toRoomId: target.roomId,
                        toRoomNumber: target.roomNumber,
                      })
                      onClose()
                    }}
                    className="tap flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-left active:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-lg leading-none font-medium text-ink">
                        {target.roomNumber}
                      </span>
                      <span className="mt-1 block truncate text-sm text-muted">
                        {target.hotelName}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'figure shrink-0 text-sm',
                        target.freeBeds <= 0 ? 'text-ledger-red' : 'text-muted',
                      )}
                    >
                      {bedsLabel(target.occupants.length, target.capacity)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setMode({ kind: 'occupants' })}
            >
              Back
            </Button>
          </>
        ) : null}

        {mode.kind === 'add' || mode.kind === 'share' ? (
          <>
            <p className="text-sm text-muted">
              {mode.kind === 'share'
                ? `Singles on the ${sideWord(mode.with.side)} with no room yet.`
                : 'Guests with no room yet.'}
            </p>

            <label className="flex min-h-14 items-center gap-2 rounded-xl border border-rule-strong bg-surface px-3.5">
              <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
              <span className="sr-only">Search guests</span>
              <input
                type="search"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search by name"
                className="min-w-0 flex-1 bg-transparent py-3 text-base text-ink outline-none placeholder:text-muted"
              />
            </label>

            {addable.length === 0 ? (
              <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
                {mode.kind === 'share'
                  ? 'No single on that side is waiting for a room.'
                  : 'Nobody is waiting for a room under that name.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Guests to add">
                {addable.map((guest) => (
                  <li key={guest.guestId}>
                    <button
                      type="button"
                      onClick={() => {
                        onAdd({
                          guestId: guest.guestId,
                          guestName: guest.guestName,
                          roomId: room.roomId,
                          roomNumber: room.roomNumber,
                        })
                        onClose()
                      }}
                      className="tap flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-left active:bg-surface-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base leading-snug font-medium text-ink">
                          {guest.guestName}
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-muted">
                          {guest.headName}
                        </span>
                      </span>
                      {guest.groupType === 'single' ? (
                        <StatusPill tone="neutral">Single</StatusPill>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setMode({ kind: 'occupants' })}
            >
              Back
            </Button>
          </>
        ) : null}
      </div>
    </BottomSheet>
  )
}

function sideWord(side: string | null): string {
  if (side === 'bride') return "bride's side"
  if (side === 'groom') return "groom's side"
  return 'same side'
}

export default RoomSheet
