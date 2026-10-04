'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

import { CameraIcon, CheckCircleIcon, GiftIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { StatusPill } from '@/components/ui/StatusPill'
import {
  assignHampersToRooms,
  readHamperRooms,
  unassignHampersFromRooms,
  type HamperRoomRow,
} from '@/lib/actions/deliveries'
import { groupRoomsByHotelFloor } from '@/lib/rooms/board'
import { cn } from '@/lib/utils'

export interface HamperByRoomProps {
  eventId: string
  eventCode: string
  /** Detail path for a proof, e.g. `hamper` or `hospitality/deliveries`. */
  detailBase: string
}

/**
 * F8b — hampers room-wise, the default view of the hamper screen.
 *
 * One hamper per room (the client's answer, 3 Oct 2026): a family split across
 * two rooms gets one in each. Rooms are grouped hotel → floor with the SAME
 * pure helper the Rooms tab uses (`groupRoomsByHotelFloor`); this is not a copy
 * of the Rooms grid — it is a selection list, and the shared piece is the
 * grouping, not the grid component.
 *
 * The write is optimistic: the row flips to "Assigned" on tap, the server
 * action follows, and a refused write rolls the row back and says so. A 5s
 * Undo removes the pending hampers it just created.
 */
export function HamperByRoom({ eventId, eventCode, detailBase }: HamperByRoomProps) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['deliveries', 'rooms', eventId],
    staleTime: 0,
    queryFn: async () => {
      const result = await readHamperRooms(eventId)
      if (!result.ok) throw new Error(result.error)
      return result.rows
    },
  })

  const [selected, setSelected] = useState<readonly string[]>([])
  // Rooms assigned in THIS session, so the row shows "Assigned" before the
  // refetch lands. Keyed by room id.
  const [justAssigned, setJustAssigned] = useState<readonly string[]>([])
  const [undoRooms, setUndoRooms] = useState<readonly string[] | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()

  const rows = useMemo(() => data ?? [], [data])

  const grouped = useMemo(
    // `groupRoomsByHotelFloor` needs a non-null hotel name; a room with no hotel
    // is grouped under "No hotel" rather than dropped.
    () => groupRoomsByHotelFloor(rows.map((r) => ({ ...r, hotelName: r.hotelName ?? 'No hotel' }))),
    [rows],
  )

  const assignable = rows.filter((r) => r.guests > 0 || r.families.length > 0)
  const selectedRooms = rows.filter((r) => selected.includes(r.roomId))
  const toAssign = selectedRooms.filter((r) => !r.hamper && !justAssigned.includes(r.roomId))

  function toggle(roomId: string) {
    setSelected((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId],
    )
  }

  async function assign() {
    const roomIds = toAssign.map((r) => r.roomId)
    if (roomIds.length === 0) return
    setErrorMsg(null)
    setJustAssigned((prev) => [...prev, ...roomIds])
    setSelected([])

    const result = await assignHampersToRooms(eventId, roomIds)
    if (!result.ok) {
      // Roll the optimistic rows back.
      setJustAssigned((prev) => prev.filter((id) => !roomIds.includes(id)))
      setErrorMsg(result.error ?? 'Could not assign the hampers.')
      return
    }
    setUndoRooms(roomIds)
    window.setTimeout(() => setUndoRooms((cur) => (cur === roomIds ? null : cur)), 5000)
    await refetch()
  }

  async function undo() {
    const roomIds = undoRooms
    if (!roomIds) return
    setUndoRooms(null)
    startTransition(() => {
      void unassignHampersFromRooms(eventId, roomIds).then(() => refetch())
    })
  }

  if (isPending) return <LoadingRows count={5} />
  if (error) {
    return (
      <ErrorState
        title="Could not load the rooms"
        description="The room list did not come back. Try again, and ask your event admin if it keeps failing."
        onRetry={() => void refetch()}
      />
    )
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<GiftIcon className="h-7 w-7" />}
        title="No rooms yet"
        description="Add hotels and rooms first, then assign a hamper to each room here."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {errorMsg ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {errorMsg}
        </p>
      ) : null}

      <p className="text-sm text-muted">
        One hamper per room. {assignable.length}{' '}
        {assignable.length === 1 ? 'room has' : 'rooms have'} guests.
      </p>

      {grouped.map((hotel) => (
        <section key={hotel.hotelId} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted">{hotel.hotelName}</h3>
          {hotel.floors.map((floor) => (
            <div key={floor.floor} className="flex flex-col gap-1">
              <p className="text-xs text-subtle">{floor.label}</p>
              <ul className="overflow-hidden rounded-2xl border border-rule bg-surface" role="list">
                {floor.rooms.map((room) => {
                  const r = room as HamperRoomRow
                  const assigned = r.hamper ?? (justAssigned.includes(r.roomId) ? { id: '', status: 'pending', quantity: 1 } : null)
                  const picked = selected.includes(r.roomId)
                  return (
                    <li key={r.roomId} className="flex items-stretch border-b border-rule last:border-b-0">
                      <button
                        type="button"
                        onClick={() => toggle(r.roomId)}
                        aria-pressed={picked}
                        className={cn(
                          'tap flex min-h-16 min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left',
                          'transition-colors duration-press ease-ledger active:bg-surface-2',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
                            picked ? 'border-brand bg-brand text-brand-fg' : 'border-rule-strong',
                          )}
                        >
                          {picked ? <CheckCircleIcon className="h-4 w-4" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base leading-snug font-medium text-ink">
                            Room {r.roomNumber}
                          </span>
                          <span className="mt-0.5 block truncate text-sm text-muted">
                            {[
                              r.families.length > 0 ? r.families.join(', ') : 'No family',
                              `${r.guests} ${r.guests === 1 ? 'guest' : 'guests'}`,
                            ].join(' · ')}
                          </span>
                        </span>
                        <StatusPill
                          tone={assigned?.status === 'delivered' ? 'done' : assigned ? 'active' : 'neutral'}
                        >
                          {assigned?.status === 'delivered'
                            ? `Delivered ×${assigned.quantity}`
                            : assigned
                              ? `Assigned ×${assigned.quantity}`
                              : 'Pending'}
                        </StatusPill>
                      </button>

                      {assigned && assigned.id ? (
                        <Link
                          href={`/${eventCode}/${detailBase}/${assigned.id}`}
                          aria-label={`Deliver the hamper in room ${r.roomNumber}`}
                          className="tap flex w-14 shrink-0 items-center justify-center text-brand active:bg-surface-2"
                        >
                          <CameraIcon className="h-5 w-5" />
                        </Link>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}

      {undoRooms ? (
        <div className="sticky bottom-2 z-10 mx-auto flex w-full max-w-[480px] items-center gap-2 rounded-xl border border-rule-strong bg-surface py-1.5 pl-4 pr-1.5 shadow-e3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            Assigned {undoRooms.length} {undoRooms.length === 1 ? 'hamper' : 'hampers'}
          </span>
          <Button size="md" variant="secondary" onClick={() => void undo()} disabled={busy} className="shrink-0">
            Undo
          </Button>
        </div>
      ) : null}

      {toAssign.length > 0 ? (
        <div className="sticky bottom-2 z-10 mx-auto w-full max-w-[480px]">
          <Button fullWidth onClick={() => void assign()}>
            {`Assign hamper to ${toAssign.length} ${toAssign.length === 1 ? 'room' : 'rooms'} · ${toAssign.length} ${
              toAssign.length === 1 ? 'hamper' : 'hampers'
            }`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default HamperByRoom
