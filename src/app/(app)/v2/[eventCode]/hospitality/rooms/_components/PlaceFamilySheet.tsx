'use client'

import { useMemo, useState } from 'react'

import { MinusIcon, PlusIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { StatusPill } from '@/components/ui/StatusPill'
import { suggestRooms, type SuggestRoom } from '@/lib/allocate/suggest'
import { bedsLabel, compareRoomNumbers } from '@/lib/rooms/board'
import { cn } from '@/lib/utils'

/** The room facts this sheet needs — a subset of the grid row. */
export interface PlaceRoom {
  roomId: string
  hotelId: string
  hotelName: string
  roomNumber: string
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
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-ink">
              Place {family.headName} ({family.headcount})
            </h2>
            <p className="text-sm leading-snug text-muted">
              {family.placed === 0
                ? `${family.shortfall} to place. You can split them across rooms.`
                : `${family.placed} already placed, ${family.shortfall} to go.`}
            </p>
          </div>

          {best ? (
            <button
              type="button"
              onClick={() => place(best.room.id, family.shortfall)}
              className="tap flex w-full flex-col gap-1 rounded-xl border border-brand bg-brand-tint px-3.5 py-3 text-left active:bg-surface-2"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="figure text-lg leading-none font-semibold text-ink">
                  {best.room.hotelName} · {best.room.roomNumber}
                </span>
                <StatusPill tone="active">Best fit</StatusPill>
              </span>
              <span className="text-sm leading-snug text-muted">{best.reason}</span>
            </button>
          ) : null}

          <div
            role="group"
            aria-label="How many guests"
            className="flex items-center justify-between gap-3 rounded-xl border border-rule-strong bg-surface px-3.5 py-2.5"
          >
            <span className="text-base font-medium text-ink">How many guests?</span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setCount((c) => Math.max(1, c - 1))}
                aria-label="One fewer guest"
                className="tap flex h-11 w-11 items-center justify-center rounded-lg border border-rule-strong text-ink active:bg-surface-2 disabled:opacity-40"
                disabled={count <= 1}
              >
                <MinusIcon className="h-5 w-5" />
              </button>
              <span
                className="figure w-10 text-center text-xl leading-none font-medium text-ink"
                aria-live="polite"
              >
                {count}
              </span>
              <button
                type="button"
                onClick={() => setCount((c) => Math.min(family.shortfall, c + 1))}
                aria-label="One more guest"
                className="tap flex h-11 w-11 items-center justify-center rounded-lg border border-rule-strong text-ink active:bg-surface-2 disabled:opacity-40"
                disabled={count >= family.shortfall}
              >
                <PlusIcon className="h-5 w-5" />
              </button>
            </span>
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
              No room is free here. Pick another hotel, or ask your event lead to add rooms.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Rooms to choose from">
              {pickable.map((room) => {
                const tight = room.freeBeds < count
                return (
                  <li key={room.roomId}>
                    <button
                      type="button"
                      onClick={() => place(room.roomId, count)}
                      className="tap flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-left active:bg-surface-2"
                    >
                      <span className="min-w-0">
                        <span className="block text-lg leading-none font-medium text-ink">
                          {room.roomNumber}
                        </span>
                        <span className="mt-1 block truncate text-sm text-muted">
                          {room.hotelName}
                          {room.floor ? ` · ${room.floor}` : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={cn(
                            'figure text-sm',
                            room.freeBeds <= 0 ? 'text-ledger-red' : 'text-muted',
                          )}
                        >
                          {bedsLabel(room.occupiedBeds, room.capacity)}
                        </span>
                        {tight ? (
                          <StatusPill tone="attention">
                            {room.freeBeds <= 0 ? 'Full' : `Only ${room.freeBeds} free`}
                          </StatusPill>
                        ) : null}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <Button variant="secondary" size="lg" fullWidth onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
    </BottomSheet>
  )
}

export default PlaceFamilySheet
