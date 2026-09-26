'use client'

import { useMemo, useState } from 'react'

import { ChevronRightIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Row } from '@/components/ui/Row'
import { Stepper } from '@/components/ui/Stepper'
import { suggestRooms, type SuggestRoom } from '@/lib/allocate/suggest'
import { compareRoomNumbers } from '@/lib/rooms/board'
import { roomTypeLabel } from '@/lib/rooms/room-type'

/** The room facts this sheet needs — a subset of the grid row. */
export interface PlaceRoom {
  roomId: string
  hotelId: string
  hotelName: string
  roomNumber: string
  /** Stored vocabulary value (suite|standard|deluxe|king|queen), or null. */
  roomType: string | null
  floor: string | null
  capacity: number
  maxCapacity: number
  freeBeds: number
  occupiedBeds: number
  isBlocked: boolean
}

export interface PlaceFamily {
  groupId: string
  headName: string
  headcount: number
  placed: number
  shortfall: number
  side: string | null
}

export interface PlaceFamilySheetProps {
  family: PlaceFamily | null
  rooms: readonly PlaceRoom[]
  onClose: () => void
  /** Place `count` of this family's unplaced guests into one room. */
  onPlace: (input: { groupId: string; roomId: string; headName: string; count: number }) => void
}

/**
 * "Place Sharma family (6)" — the one-family version of the board's job.
 *
 * THE ORDER ON THIS SHEET IS THE POINT. The best room the engine can name is
 * first and takes ONE tap, because that is the answer nine times in ten. Under
 * it are the rooms that fit, for the tenth time. The split control — how many
 * of them go in this room — sits between the two, because it changes what
 * "fits" means and a stepper found after the list is a stepper nobody uses.
 *
 * The suggestion is `suggestRooms` from `src/lib/allocate/suggest.ts`, the same
 * scored engine with the same plain-language reason string the v1 panel shows.
 * It runs here, on rooms already in the cache, so opening this sheet costs no
 * round trip on venue Wi-Fi.
 *
 * v3 RESTYLE: the engine's answer is the only loud thing on the sheet (maroon
 * hairline), the count is the shared `Stepper`, the room list is `Row`s with
 * the room number as the heading, and the hotel filter is a `Chip` row that
 * only appears when there is more than one hotel to choose between.
 */
export function PlaceFamilySheet({ family, rooms, onClose, onPlace }: PlaceFamilySheetProps) {
  const [count, setCount] = useState(1)
  const [hotel, setHotel] = useState<string | null>(null)
  /** The family the stepper was last reset for — resets without an effect. */
  const [seededFor, setSeededFor] = useState<string | null>(null)

  if (family !== null && seededFor !== family.groupId) {
    setSeededFor(family.groupId)
    setCount(Math.max(1, family.shortfall))
    setHotel(null)
  }

  const open = rooms.filter((r) => !r.isBlocked)

  const hotels = useMemo(() => {
    const names = new Set(open.map((r) => r.hotelName))
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [open])

  /**
   * The engine's best room for the WHOLE family. Offered only when the whole
   * family still needs beds — once they are split across rooms by hand, "the
   * best single room for six" is an answer to a question nobody asked.
   */
  const best = useMemo(() => {
    if (!family) return null
    if (count !== family.shortfall) return null
    const candidates: SuggestRoom[] = open.map((r) => ({
      id: r.roomId,
      hotelId: r.hotelId,
      hotelName: r.hotelName,
      roomNumber: r.roomNumber,
      floor: r.floor,
      baseCapacity: r.capacity,
      maxCapacity: r.maxCapacity,
      occupied: r.occupiedBeds,
    }))
    const result = suggestRooms(
      {
        id: family.groupId,
        headName: family.headName,
        side: (family.side ?? null) as 'bride' | 'groom' | 'both' | 'other' | null,
        occupancy: family.shortfall,
        guests: [],
      },
      candidates,
    )
    return result.suggestions[0] ?? null
  }, [family, open, count])

  // The scored engine answers with a room id and a reason, not a room type, so
  // the type comes back off the row this sheet already holds.
  const bestTypeLabel = best
    ? roomTypeLabel(rooms.find((r) => r.roomId === best.room.id)?.roomType)
    : null

  const pickable = useMemo(() => {
    const list = hotel === null ? open : open.filter((r) => r.hotelName === hotel)
    return [...list].sort((a, b) => {
      const aFits = a.freeBeds >= count ? 1 : 0
      const bFits = b.freeBeds >= count ? 1 : 0
      if (aFits !== bFits) return bFits - aFits
      if (aFits === 1 && a.freeBeds !== b.freeBeds) return a.freeBeds - b.freeBeds
      const byHotel = a.hotelName.localeCompare(b.hotelName)
      if (byHotel !== 0) return byHotel
      return compareRoomNumbers(a.roomNumber, b.roomNumber)
    })
  }, [open, hotel, count])

  function place(roomId: string, howMany: number) {
    if (!family) return
    onPlace({ groupId: family.groupId, roomId, headName: family.headName, count: howMany })
    onClose()
  }

  return (
    <BottomSheet
      open={family !== null}
      onClose={onClose}
      label={family ? `Place ${family.headName}` : 'Place a family'}
    >
      {family === null ? null : (
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl leading-tight font-semibold text-ink">
              {family.headName}
            </h2>
            <p className="mt-1 text-sm leading-snug text-muted">
              {family.placed === 0
                ? `${family.headcount} in the family · ${family.shortfall} to place`
                : `${family.placed} placed, ${family.shortfall} to go`}
            </p>
          </div>

          {/* The engine's answer, and the only loud control on the sheet. */}
          {best ? (
            <button
              type="button"
              onClick={() => place(best.room.id, family.shortfall)}
              className="tap flex w-full items-center gap-3 rounded-2xl border border-brand bg-brand-tint px-3.5 py-3 text-left active:brightness-95"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base leading-snug font-semibold text-ink">
                  Room {best.room.roomNumber}{bestTypeLabel ? <span className="ml-1.5 align-middle text-xs font-medium text-subtle">{bestTypeLabel}</span> : null} · {best.room.hotelName}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-sm leading-snug text-muted">
                  {reasonTail(best.reason, best.room.roomNumber)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-brand">Best fit</span>
            </button>
          ) : null}

          <Stepper
            label="How many go in one room?"
            value={count}
            onChange={setCount}
            min={1}
            max={Math.max(1, family.shortfall)}
          />

          {hotels.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Which hotel">
              <Chip selected={hotel === null} onClick={() => setHotel(null)}>
                All
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
              No room is free here.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
              {pickable.map((room) => {
                const tight = room.freeBeds < count
                const type = roomTypeLabel(room.roomType)
                const heading = type ? `Room ${room.roomNumber} (${type})` : `Room ${room.roomNumber}`
                return (
                  <li key={room.roomId}>
                    <Row
                      heading={heading}
                      meta={`${room.hotelName}${room.floor ? ` · ${room.floor}` : ''}`}
                      status={tight ? (room.freeBeds <= 0 ? 'Full' : `${room.freeBeds} free`) : undefined}
                      tone={room.freeBeds <= 0 ? 'problem' : 'waiting'}
                      onPress={() => place(room.roomId, count)}
                      trailing={<ChevronRightIcon className="h-5 w-5" />}
                    />
                  </li>
                )
              })}
            </ul>
          )}

          <Button variant="ghost" size="lg" fullWidth onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
    </BottomSheet>
  )
}

export default PlaceFamilySheet

/**
 * The engine's reason, minus the clause the card already says out loud.
 *
 * `suggestRooms` always opens with "<hotel> Room <n>[(floor)]" — and that is
 * exactly what the line above this one shows. On a 360px card the repetition
 * pushes the part that answers "why this room?" into the ellipsis, so the
 * location clause is dropped when it is there. When it is NOT there (nothing
 * else scored, so the reason is only the location) the original is returned
 * rather than an empty line.
 *
 * Presentation only: the score, the ranking and the engine are untouched.
 */
function reasonTail(reason: string, roomNumber: string): string {
  const [first, ...rest] = reason.split(', ')
  if (rest.length === 0 || !first.includes(`Room ${roomNumber}`)) return reason
  return rest.join(', ')
}
