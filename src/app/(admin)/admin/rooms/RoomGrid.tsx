'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { assignGuest, moveGuest, releaseGuest } from '@/lib/actions/assignments'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { ShieldAlertIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { OCCUPANCY_LABELS, freeBeds, occupancyState, type OccupancyState } from '@/lib/rooms/parse'

export interface GridOccupant {
  guestId: string
  groupId: string
  name: string
  familyName: string
  isOverride: boolean
}

export interface GridRoom {
  id: string
  hotelId: string
  hotelName: string
  roomNumber: string
  roomType: string | null
  capacity: number
  isBlocked: boolean
  occupants: GridOccupant[]
}

export interface UnplacedGuest {
  guestId: string
  groupId: string
  name: string
  familyName: string
}

type Filter = 'all' | OccupancyState

const FILTERS: Filter[] = ['all', 'empty', 'partly', 'full', 'over']
const FILTER_LABELS: Record<Filter, string> = { all: 'All', ...OCCUPANCY_LABELS }
const STATE_TONE: Record<OccupancyState, BadgeTone> = {
  empty: 'neutral',
  partly: 'info',
  full: 'success',
  over: 'danger',
}

/** What the picker is currently doing: moving somebody, or placing somebody. */
type Pending =
  | { kind: 'move'; guest: GridOccupant; fromRoomId: string; fromRoomNumber: string }
  | { kind: 'assign'; guest: UnplacedGuest }

/** A capacity refusal waiting on a typed reason. */
interface OverridePrompt {
  pending: Pending
  room: GridRoom
  reason: string
}

export function RoomGrid({
  eventId,
  eventCode,
  rooms,
  unplaced,
}: {
  eventId: string
  eventCode: string
  rooms: GridRoom[]
  unplaced: UnplacedGuest[]
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [override, setOverride] = useState<OverridePrompt | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

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

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return withState.filter((room) => {
      if (filter !== 'all' && room.state !== filter) return false
      if (!term) return true
      return (
        room.roomNumber.toLowerCase().includes(term) ||
        room.hotelName.toLowerCase().includes(term) ||
        room.occupants.some(
          (o) => o.name.toLowerCase().includes(term) || o.familyName.toLowerCase().includes(term),
        )
      )
    })
  }, [withState, filter, search])

  function reset() {
    setPending(null)
    setOverride(null)
    setError(null)
    setBusy(false)
  }

  /** Second tap: the target room. */
  async function chooseRoom(room: GridRoom) {
    if (!pending) return
    setError(null)
    setBusy(true)

    const result =
      pending.kind === 'move'
        ? await moveGuest(
            eventId,
            eventCode,
            pending.guest.guestId,
            pending.guest.groupId,
            pending.fromRoomId,
            room.id,
            room.roomNumber,
          )
        : await assignGuest(
            eventId,
            eventCode,
            pending.guest.guestId,
            pending.guest.groupId,
            room.id,
            room.roomNumber,
          )

    setBusy(false)

    if (!result.ok) {
      // The database refused it for capacity — ask, then require a reason.
      if ('needsOverride' in result && result.needsOverride) {
        setOverride({ pending, room, reason: '' })
        return
      }
      setError(result.error)
      return
    }

    setNote(
      pending.kind === 'move'
        ? `Moved ${pending.guest.name} to room ${room.roomNumber}.`
        : `${pending.guest.name} is now in room ${room.roomNumber}.`,
    )
    reset()
    router.refresh()
  }

  async function confirmOverride() {
    if (!override) return
    setError(null)
    setBusy(true)

    const { pending: p, room, reason } = override
    const result =
      p.kind === 'move'
        ? await moveGuest(
            eventId,
            eventCode,
            p.guest.guestId,
            p.guest.groupId,
            p.fromRoomId,
            room.id,
            room.roomNumber,
            { reason },
          )
        : await assignGuest(
            eventId,
            eventCode,
            p.guest.guestId,
            p.guest.groupId,
            room.id,
            room.roomNumber,
            { reason },
          )

    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNote(`${p.guest.name} added to room ${room.roomNumber} over capacity.`)
    reset()
    router.refresh()
  }

  async function release(occupant: GridOccupant) {
    setError(null)
    setBusy(true)
    const result = await releaseGuest(eventId, eventCode, occupant.guestId)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNote(`${occupant.name} released. The record is kept.`)
    router.refresh()
  }

  // ------------------------------------------------------------------
  // Over-capacity prompt
  // ------------------------------------------------------------------
  if (override) {
    const tooShort = override.reason.trim().length < 3
    return (
      <Card className="border-danger/40">
        <CardBody className="flex flex-col gap-4">
          <div>
            <p className="flex items-center gap-2 text-base font-semibold text-danger">
              <ShieldAlertIcon className="h-5 w-5" />
              Room {override.room.roomNumber} is full. Add anyway?
            </p>
            <p className="mt-1 text-sm text-muted">
              {override.room.hotelName} · {override.room.occupants.length} of{' '}
              {override.room.capacity} beds taken. Adding {override.pending.guest.name} puts it over
              capacity.
            </p>
          </div>

          <Textarea
            label="Why?"
            required
            rows={2}
            hint="This is the only record of why the room was overfilled. It is not optional and nothing is pre-filled."
            value={override.reason}
            onChange={(e) => setOverride({ ...override, reason: e.target.value })}
          />

          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button variant="danger" fullWidth onClick={confirmOverride} loading={busy} disabled={tooShort || busy}>
              Add over capacity
            </Button>
            <Button variant="secondary" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Picking a target room — the second of the two taps. */}
      {pending ? (
        <Card className="border-brand bg-tint-info">
          <CardBody className="flex flex-col gap-2 py-3">
            <p className="text-sm font-semibold text-fg">
              {pending.kind === 'move' ? 'Move' : 'Place'} {pending.guest.name}
            </p>
            <p className="text-xs text-muted">
              {pending.kind === 'move'
                ? `Currently in room ${pending.fromRoomNumber}. Tap the room to move them to.`
                : 'Tap the room to put them in.'}
            </p>
            <Button variant="secondary" onClick={reset} disabled={busy} className="self-start">
              Cancel
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {note ? (
        <Card className="border-success/40 bg-tint-success">
          <CardBody className="py-2 text-sm text-success">{note}</CardBody>
        </Card>
      ) : null}
      {error ? (
        <Card className="border-danger/40 bg-tint-danger">
          <CardBody className="py-2 text-sm font-medium text-danger">{error}</CardBody>
        </Card>
      ) : null}

      {/* Unplaced guests */}
      {unplaced.length > 0 ? (
        <Card className="border-warning/40">
          <CardBody className="flex flex-col gap-2 py-3">
            <p className="text-sm font-semibold text-warning">
              {unplaced.length} guest{unplaced.length === 1 ? '' : 's'} with no room
            </p>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {unplaced.map((guest) => (
                <li key={guest.guestId}>
                  <button
                    type="button"
                    onClick={() => {
                      setNote(null)
                      setPending({ kind: 'assign', guest })
                    }}
                    disabled={busy}
                    className="tap flex min-h-11 w-full items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 text-left text-sm hover:bg-surface"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-fg">{guest.name}</span>
                      <span className="text-subtle"> · {guest.familyName}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-brand">Place</span>
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Input
        label="Search"
        placeholder="Room number, hotel, guest or family"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

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
              f === 'over' && counts.over > 0 && filter !== f && 'border-danger/50 text-danger',
            )}
          >
            {FILTER_LABELS[f]} ({counts[f]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No rooms match" description="Try another filter or clear the search." />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((room) => {
            const selectable = pending !== null
            return (
              <li key={room.id}>
                <Card className={cn(room.state === 'over' && 'border-danger', selectable && 'border-brand/40')}>
                  <CardBody className="flex flex-col gap-2 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-fg">
                          Room {room.roomNumber}
                          <span className="ml-2 text-sm font-normal text-muted">{room.hotelName}</span>
                        </p>
                        <p className="mt-0.5 text-sm text-muted">
                          {room.occupants.length} of {room.capacity}
                          {room.free > 0 ? ` · ${room.free} free` : ''}
                          {room.roomType ? ` · ${room.roomType}` : ''}
                          {room.isBlocked ? ' · blocked' : ''}
                        </p>
                      </div>
                      <Badge tone={STATE_TONE[room.state]}>
                        {room.state === 'over' ? 'Over capacity' : OCCUPANCY_LABELS[room.state]}
                      </Badge>
                    </div>

                    {room.occupants.length > 0 ? (
                      <ul className="flex flex-col gap-1">
                        {room.occupants.map((o) => (
                          <li key={o.guestId} className="flex items-center gap-2">
                            {/* First tap: pick the guest. */}
                            <button
                              type="button"
                              onClick={() => {
                                setNote(null)
                                setPending({
                                  kind: 'move',
                                  guest: o,
                                  fromRoomId: room.id,
                                  fromRoomNumber: room.roomNumber,
                                })
                              }}
                              disabled={busy || selectable}
                              className="tap min-h-11 min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 text-left text-sm hover:bg-surface disabled:opacity-60"
                            >
                              <span className="font-medium text-fg">{o.name}</span>
                              <span className="text-subtle"> · {o.familyName}</span>
                              {o.isOverride ? (
                                <span className="ml-1 text-xs font-semibold text-danger">
                                  (override)
                                </span>
                              ) : null}
                            </button>
                            <Button
                              variant="ghost"
                              onClick={() => release(o)}
                              disabled={busy || selectable}
                            >
                              Release
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-subtle">Empty.</p>
                    )}

                    {selectable ? (
                      <Button
                        fullWidth
                        variant={room.free > 0 ? 'primary' : 'secondary'}
                        onClick={() => chooseRoom(room)}
                        loading={busy}
                        disabled={busy}
                      >
                        {room.free > 0
                          ? `Put here (${room.free} free)`
                          : 'Put here — room is full'}
                      </Button>
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default RoomGrid
