'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'

import { deleteRoom } from '@/lib/actions/hotels'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import {
  OCCUPANCY_LABELS,
  freeBeds,
  occupancyState,
  type OccupancyState,
} from '@/lib/rooms/parse'
import { exportFilename, sheetFromColumns, type Column } from '@/lib/export/workbook'

export interface RoomOccupant {
  guestId: string
  name: string
  familyName: string
}

export interface RoomRow {
  id: string
  roomNumber: string
  roomType: string | null
  capacity: number
  floor: string | null
  occupants: RoomOccupant[]
}

type Filter = 'all' | OccupancyState

const FILTERS: Filter[] = ['all', 'empty', 'partly', 'full', 'over']

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  ...OCCUPANCY_LABELS,
}

const STATE_TONE: Record<OccupancyState, BadgeTone> = {
  empty: 'neutral',
  partly: 'info',
  full: 'success',
  over: 'danger',
}

export function RoomList({
  hotelId,
  hotelName,
  eventId,
  eventCode,
  rooms,
}: {
  hotelId: string
  hotelName: string
  eventId: string
  eventCode: string
  rooms: RoomRow[]
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const withState = useMemo(
    () =>
      rooms.map((room) => ({
        ...room,
        state: occupancyState(room.occupants.length, room.capacity),
        free: freeBeds(room.occupants.length, room.capacity),
      })),
    [rooms],
  )

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: withState.length, empty: 0, partly: 0, full: 0, over: 0 }
    for (const r of withState) c[r.state] += 1
    return c
  }, [withState])

  const visible = filter === 'all' ? withState : withState.filter((r) => r.state === filter)

  async function remove(room: RoomRow) {
    setError(null)
    setBusyId(room.id)
    const result = await deleteRoom(room.id, hotelId, eventId, eventCode)
    setBusyId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  /** The front-desk list: one row per room, with who is in it. */
  function exportRooms() {
    const columns: Column<(typeof withState)[number]>[] = [
      { header: 'room_id', value: (r) => r.id, hidden: true, text: true },
      { header: 'Room', value: (r) => r.roomNumber, text: true, width: 10 },
      { header: 'Type', value: (r) => r.roomType ?? '', width: 14 },
      { header: 'Floor', value: (r) => r.floor ?? '', text: true, width: 8 },
      { header: 'Capacity', value: (r) => r.capacity, width: 10 },
      { header: 'Occupied', value: (r) => r.occupants.length, width: 10 },
      { header: 'Free beds', value: (r) => r.free, width: 10 },
      { header: 'Status', value: (r) => OCCUPANCY_LABELS[r.state], width: 14 },
      { header: 'Families', value: (r) => [...new Set(r.occupants.map((o) => o.familyName))].join(', '), width: 28 },
      { header: 'Occupants', value: (r) => r.occupants.map((o) => o.name).join(', '), width: 40 },
    ]

    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheetFromColumns(columns, withState), 'Rooms')
    XLSX.writeFile(book, exportFilename(eventCode, `${hotelName}-rooms`, new Date()), {
      bookType: 'xlsx',
      compression: true,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'tap min-h-11 rounded-full border px-3 text-sm font-semibold transition-colors',
              filter === f
                ? 'border-transparent bg-brand text-brand-fg'
                : 'border-border bg-surface text-fg hover:bg-surface-2',
              // Over-capacity is a real state, caused by deliberate overrides.
              // Tint the chip so it reads as a problem even unselected.
              f === 'over' && counts.over > 0 && filter !== f && 'border-danger/50 text-danger',
            )}
          >
            {FILTER_LABELS[f]} ({counts[f]})
          </button>
        ))}
      </div>

      {error ? (
        <Card className="border-danger/40 bg-tint-danger">
          <CardBody className="py-3 text-sm font-medium text-danger">{error}</CardBody>
        </Card>
      ) : null}

      {rooms.length === 0 ? (
        <EmptyState
          title="No rooms yet"
          description="Add rooms with the form above — a range is quickest for a numbered floor."
        />
      ) : visible.length === 0 ? (
        <EmptyState title={`No ${FILTER_LABELS[filter].toLowerCase()} rooms`} description="Try another filter." />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((room) => (
            <li key={room.id}>
              <Card className={cn(room.state === 'over' && 'border-danger/40')}>
                <CardBody className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-fg">
                        Room {room.roomNumber}
                        {room.roomType ? (
                          <span className="ml-2 text-sm font-normal text-muted">{room.roomType}</span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-sm text-muted">
                        {room.occupants.length} of {room.capacity} beds
                        {room.free > 0 ? ` · ${room.free} free` : ''}
                        {room.floor ? ` · floor ${room.floor}` : ''}
                      </p>
                    </div>
                    <Badge tone={STATE_TONE[room.state]}>{OCCUPANCY_LABELS[room.state]}</Badge>
                  </div>

                  {room.occupants.length > 0 ? (
                    <ul className="flex flex-col gap-0.5 text-sm text-fg">
                      {room.occupants.map((o) => (
                        <li key={o.guestId} className="truncate">
                          {o.name}
                          <span className="text-subtle"> · {o.familyName}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-subtle">Nobody allocated yet.</p>
                  )}

                  {room.occupants.length === 0 ? (
                    <Button
                      variant="ghost"
                      onClick={() => remove(room)}
                      loading={busyId === room.id}
                      disabled={busyId !== null}
                      className="self-start"
                    >
                      Delete room
                    </Button>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {rooms.length > 0 ? (
        <Button variant="secondary" fullWidth onClick={exportRooms}>
          Export room list for the front desk
        </Button>
      ) : null}
    </div>
  )
}

export default RoomList
