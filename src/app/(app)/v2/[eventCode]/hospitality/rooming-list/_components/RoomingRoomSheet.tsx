'use client'

import Link from 'next/link'

import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import {
  checkInLabel,
  familyLabel,
  guestNamesLabel,
  hamperLabel,
  type RoomingListRow,
} from '@/lib/rooms/rooming-list'

export interface RoomingRoomSheetProps {
  /** Every line of the open room — one per family, or a single empty-room line. */
  rows: readonly RoomingListRow[]
  eventCode: string
  onClose: () => void
}

/**
 * One room, as the rooming list holds it: who is in it, and what is still owed.
 *
 * READ-ONLY, DELIBERATELY. The rooming list is a sheet — a record of what the
 * hotel was told — and the screen that CHANGES a room is the Rooms board's
 * `RoomSheet`, behind `hospitality/rooms`. Duplicating the move/take-out/add
 * writes here would give the app two places that re-arrange beds, which is the
 * drift this repo has already paid for twice. So this panel opens the two
 * records a line points at — the family and the hamper proof — and then gets out
 * of the way.
 *
 * It is not a dead end either: the two doors out are the same two targets the
 * row itself carries, repeated here because a person who opened the room is
 * asking about the people in it.
 */
export function RoomingRoomSheet({ rows, eventCode, onClose }: RoomingRoomSheetProps) {
  // An unmounted sheet and a closed one look identical, and staying mounted on
  // a stale room is how a sheet shows yesterday's occupants.
  if (rows.length === 0) return null

  const first = rows[0]
  const families = rows.filter((row) => row.groupId !== null)
  const pax = rows.reduce((total, row) => total + row.pax, 0)

  const title = `${first.hotelName} · Room ${first.roomNumber}`
  const context = [
    first.floor,
    first.roomType,
    rows.length === 1 && families.length === 0
      ? 'no one assigned'
      : `${families.length} ${families.length === 1 ? 'family' : 'families'} · ${pax} ${
          pax === 1 ? 'guest' : 'guests'
        }`,
    first.isBlocked ? 'out of service' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <BottomSheet open onClose={onClose} label={title}>
      <div className="flex flex-col gap-4">
        <div className="min-w-0">
          <p className="figure text-3xl leading-none font-semibold text-ink">
            {first.roomNumber}
          </p>
          <p className="mt-1.5 text-sm text-muted">{first.hotelName}</p>
          <p className="mt-0.5 text-sm text-muted">{context}</p>
        </div>

        {families.length === 0 ? (
          <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
            Nobody is assigned to this room yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
            {families.map((row) => (
              <li key={row.key} className="border-b border-rule px-3 py-3 last:border-b-0">
                <p className="text-base leading-snug font-medium text-ink">{familyLabel(row)}</p>
                <p className="mt-0.5 text-sm leading-snug text-muted">{guestNamesLabel(row)}</p>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
                    {checkInLabel(row)}
                  </span>
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
                    {row.pax} pax
                  </span>

                  {row.hamperDeliverableId !== null ? (
                    <Link
                      href={`/${eventCode}/hospitality/deliveries/${row.hamperDeliverableId}`}
                      className="tap inline-flex min-h-11 items-center rounded-full border border-rule-strong px-3.5 text-xs font-semibold text-ink"
                    >
                      {hamperLabel(row)} · photo
                    </Link>
                  ) : (
                    <span className="px-1 text-xs font-medium text-subtle">
                      No hamper · {hamperLabel(row)}
                    </span>
                  )}

                  {row.groupId !== null ? (
                    <Link
                      href={`/${eventCode}/rsvp/status/${row.groupId}`}
                      className="tap inline-flex min-h-11 items-center rounded-full border border-rule-strong px-3.5 text-xs font-semibold text-ink"
                    >
                      Family details
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button variant="secondary" size="lg" fullWidth onClick={onClose}>
          Close
        </Button>
      </div>
    </BottomSheet>
  )
}

export default RoomingRoomSheet
