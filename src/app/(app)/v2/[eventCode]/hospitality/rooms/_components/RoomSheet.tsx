'use client'

import { useMemo, useState } from 'react'

import { ChevronRightIcon, SearchIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Row } from '@/components/ui/Row'
import { bedsLabel, compareRoomNumbers, matchesTerm } from '@/lib/rooms/board'
import { roomTypeLabel } from '@/lib/rooms/room-type'
import { initials } from '@/lib/ui/metrics'
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
  /** Stored vocabulary value (suite|standard|deluxe|king|queen), or null. */
  roomType: string | null
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
  onRemove: (input: {
    assignmentId: string
    guestId: string
    guestName: string
    roomId: string
  }) => void
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
 * v3 RESTYLE ONLY. The writes, the order of the modes and the share rule are
 * untouched; what changed is the furniture — occupant cards with two buttons
 * each are now `Row`s with two 44px actions under them (a name is not a
 * "Move" button), the room pickers are `Row`s with the room number in the
 * avatar slot, and the sheet has ONE primary ("Add a guest") instead of a
 * primary plus three equally loud secondaries.
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
  /** The occupant the action bar is currently about — "Move" needs a subject. */
  const [picked, setPicked] = useState<string | null>(null)

  if (room !== null && seededFor !== room.roomId) {
    setSeededFor(room.roomId)
    setMode({ kind: 'occupants' })
    setTerm('')
    setPicked(null)
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
    return pool.filter((g) => matchesTerm(term, g.guestName, g.headName)).slice(0, 40)
  }, [mode, unplaced, term])

  // Nothing to show and nothing to keep mounted: the sheet has no open/close
  // animation state of its own, so an unmounted sheet and a closed one look
  // identical to the user and this way the room's state cannot go stale.
  if (room === null) return null

  const occupied = room.occupants.length
  const typeLabel = roomTypeLabel(room.roomType)
  const title = `${room.hotelName} · Room ${room.roomNumber}`
  const pickedOccupant = room.occupants.find((o) => o.assignmentId === picked) ?? null
  const lonelySingle =
    occupied === 1 && room.occupants[0].groupType === 'single' && room.freeBeds > 0
      ? room.occupants[0]
      : null

  return (
    <BottomSheet open onClose={onClose} label={title}>
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-baseline gap-2">
              <span className="figure text-3xl leading-none font-semibold text-ink">
                {room.roomNumber}
              </span>
              {typeLabel ? (
                <span className="text-sm font-medium text-subtle">{typeLabel}</span>
              ) : null}
            </p>
            <p className="mt-1.5 truncate text-sm text-muted">
              {room.hotelName}
              {room.floor ? ` · ${room.floor}` : ''} · {bedsLabel(occupied, room.capacity)}
              {room.isBlocked ? ' · out of service' : ''}
            </p>
          </div>
        </div>

        {mode.kind === 'occupants' ? (
          <>
            {occupied === 0 ? (
              <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
                This room is empty.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
                {room.occupants.map((occupant) => (
                  <li key={occupant.assignmentId}>
                    <Row
                      heading={occupant.guestName}
                      meta={`${occupant.headName}${occupant.isHead ? ' · family head' : ''}`}
                      initials={initials(occupant.guestName)}
                      onPress={() =>
                        setPicked((prev) =>
                          prev === occupant.assignmentId ? null : occupant.assignmentId,
                        )
                      }
                      trailing={
                        picked === occupant.assignmentId ? (
                          <span className="text-sm font-medium text-brand">Picked</span>
                        ) : (
                          <ChevronRightIcon className="h-5 w-5" />
                        )
                      }
                      className={cn(picked === occupant.assignmentId && 'bg-brand-tint')}
                    />
                  </li>
                ))}
              </ul>
            )}

            {pickedOccupant ? (
              <div className="flex items-stretch gap-2.5">
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onClick={() => setMode({ kind: 'move', occupant: pickedOccupant })}
                >
                  Move {firstName(pickedOccupant.guestName)}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onClick={() => {
                    onRemove({
                      assignmentId: pickedOccupant.assignmentId,
                      guestId: pickedOccupant.guestId,
                      guestName: pickedOccupant.guestName,
                      roomId: room.roomId,
                    })
                    setPicked(null)
                  }}
                >
                  Take out
                </Button>
              </div>
            ) : occupied > 0 ? (
              <p className="text-center text-xs text-muted">
                Tap a name to move or take them out.
              </p>
            ) : null}

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
                Share with another single
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
          </>
        ) : null}

        {mode.kind === 'move' ? (
          <>
            <p className="text-sm leading-snug text-muted">
              Move {mode.occupant.guestName} to which room?
            </p>
            <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
              {moveTargets.map((target) => (
                <li key={target.roomId}>
                  <Row
                    heading={`Room ${target.roomNumber}`}
                    meta={`${target.hotelName} · ${bedsLabel(
                      target.occupants.length,
                      target.capacity,
                    )}`}
                    status={target.freeBeds > 0 ? `${target.freeBeds} free` : 'Full'}
                    tone={target.freeBeds > 0 ? 'done' : 'problem'}
                    onPress={() => {
                      onMove({
                        assignmentId: mode.occupant.assignmentId,
                        guestName: mode.occupant.guestName,
                        fromRoomId: room.roomId,
                        toRoomId: target.roomId,
                        toRoomNumber: target.roomNumber,
                      })
                      onClose()
                    }}
                  />
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
            <p className="text-sm leading-snug text-muted">
              {mode.kind === 'share'
                ? `Singles on the ${sideWord(mode.with.side)} with no room yet.`
                : 'Guests with no room yet.'}
            </p>

            <label className="flex min-h-12 items-center gap-2 rounded-xl border border-rule-strong bg-surface px-3.5">
              <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
              <span className="sr-only">Search guests</span>
              <input
                type="search"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search by name"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-ink outline-none placeholder:text-subtle"
              />
            </label>

            {addable.length === 0 ? (
              <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
                {mode.kind === 'share'
                  ? 'No single on that side is waiting for a room.'
                  : 'Nobody is waiting for a room under that name.'}
              </p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
                {addable.map((guest) => (
                  <li key={guest.guestId}>
                    <Row
                      heading={guest.guestName}
                      meta={guest.headName}
                      initials={initials(guest.guestName)}
                      status={guest.groupType === 'single' ? 'Single' : undefined}
                      tone="neutral"
                      onPress={() => {
                        onAdd({
                          guestId: guest.guestId,
                          guestName: guest.guestName,
                          roomId: room.roomId,
                          roomNumber: room.roomNumber,
                        })
                        onClose()
                      }}
                    />
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

/** The first word of a name — "Move Ravi", not "Move Ravi Kumar Patel". */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function sideWord(side: string | null): string {
  if (side === 'bride') return "bride's side"
  if (side === 'groom') return "groom's side"
  return 'same side'
}

export default RoomSheet
