'use client'

import { useState, useEffect, useCallback } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { BuildingIcon, ShieldAlertIcon } from '@/components/icons'
import {
  readRoomsGrid,
  moveGuestToRoom,
  releaseGuestFromRoom,
  assignGuestToRoom,
  type RoomsGridData,
  type RoomGridRow,
  type RoomGridGuest,
} from '@/lib/actions/rooms'
import { cn } from '@/lib/utils'

interface Props {
  eventId: string
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; data: RoomsGridData }
  | { phase: 'error'; message: string }

export function RoomsGridClient({ eventId }: Props) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [selectedGuest, setSelectedGuest] = useState<RoomGridGuest | null>(null)
  const [selectedUnplaced, setSelectedUnplaced] = useState<string | null>(null)
  const [overrideRoom, setOverrideRoom] = useState<{ roomId: string; roomNumber: string } | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [pendingAction, setPendingAction] = useState<{ guestId: string; targetId: string; overrideReason: string | null } | null>(null)
  const [releaseReason, setReleaseReason] = useState<string | null>(null)
  const [releasingAssignment, setReleasingAssignment] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const data = await readRoomsGrid(eventId)
      setState({ phase: 'ready', data })
    } catch {
      setState({ phase: 'error', message: 'Could not load room data. Pull down to refresh.' })
    }
  }, [eventId])

  useEffect(() => { void load() }, [load])

  const handleSelectGuest = (guest: RoomGridGuest) => {
    setSelectedGuest(guest)
    setSelectedUnplaced(null)
    setActionError(null)
  }

  const handleSelectUnplaced = (guestId: string) => {
    setSelectedUnplaced(guestId)
    setSelectedGuest(null)
    setActionError(null)
  }

  const handleTapRoom = async (room: RoomGridRow) => {
    if (selectedGuest) {
      // Moving an assigned guest to this room
      await attemptMove(selectedGuest.assignmentId, room.roomId)
    } else if (selectedUnplaced) {
      // Assigning unplaced guest to this room
      await attemptAssign(selectedUnplaced, room.roomId)
    }
  }

  const attemptMove = async (assignmentId: string, roomId: string) => {
    setLoading(true)
    setActionError(null)
    const result = await moveGuestToRoom(assignmentId, roomId, null)

    if (result.ok) {
      setSelectedGuest(null)
      await load()
    } else if (result.code === 'capacity' && 'roomId' in result) {
      setOverrideRoom({ roomId: result.roomId, roomNumber: result.roomNumber })
      setOverrideReason('')
      setPendingAction({ guestId: '', targetId: roomId, overrideReason: null })
      setActionError(null)
    } else {
      setActionError(result.error)
    }
    setLoading(false)
  }

  const attemptAssign = async (guestId: string, roomId: string) => {
    setLoading(true)
    setActionError(null)
    const result = await assignGuestToRoom(eventId, guestId, roomId, null)

    if (result.ok) {
      setSelectedUnplaced(null)
      await load()
    } else if (result.code === 'capacity' && 'roomId' in result) {
      setOverrideRoom({ roomId: result.roomId, roomNumber: result.roomNumber })
      setOverrideReason('')
      setPendingAction({ guestId, targetId: roomId, overrideReason: null })
      setActionError(null)
    } else {
      setActionError(result.error)
    }
    setLoading(false)
  }

  const handleOverride = async () => {
    if (!overrideRoom || !overrideReason.trim()) return

    setLoading(true)
    setActionError(null)

    if (selectedGuest) {
      const result = await moveGuestToRoom(selectedGuest.assignmentId, overrideRoom.roomId, overrideReason.trim())
      if (result.ok) {
        setSelectedGuest(null)
        setOverrideRoom(null)
        setOverrideReason('')
        await load()
      } else {
        setActionError(result.error)
      }
    } else if (selectedUnplaced) {
      const result = await assignGuestToRoom(eventId, selectedUnplaced, overrideRoom.roomId, overrideReason.trim())
      if (result.ok) {
        setSelectedUnplaced(null)
        setOverrideRoom(null)
        setOverrideReason('')
        await load()
      } else {
        setActionError(result.error)
      }
    }
    setLoading(false)
  }

  const handleRelease = async (assignmentId: string) => {
    if (!releaseReason?.trim()) {
      setReleasingAssignment(assignmentId)
      return
    }

    setLoading(true)
    setActionError(null)
    const result = await releaseGuestFromRoom(assignmentId, releaseReason.trim())
    if (result.ok) {
      setReleasingAssignment(null)
      setReleaseReason(null)
      await load()
    } else {
      setActionError(result.error)
    }
    setLoading(false)
  }

  const handleReleaseConfirm = async () => {
    if (!releasingAssignment) return
    await handleRelease(releasingAssignment)
  }

  if (state.phase === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load rooms"
        description={state.message}
        action={<Button onClick={load}>Retry</Button>}
      />
    )
  }

  const { data } = state

  if (data.rooms.length === 0) {
    return (
      <EmptyState
        icon={<BuildingIcon className="h-7 w-7" />}
        title="No rooms set up"
        description="Add hotels and rooms first from the admin area. Without rooms there is nothing to allocate."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Rooms</h2>
        <p className="mt-0.5 text-sm text-muted">
          {selectedGuest
            ? `Moving ${selectedGuest.guestName} → tap a room to place them`
            : selectedUnplaced
              ? 'Tap a room to assign this guest'
              : 'Tap a guest, then tap a room. Two taps to move.'}
        </p>
      </div>

      {actionError && (
        <div className="rounded-xl border border-tint-danger bg-tint-danger px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      )}

      {/* Unplaced guests */}
      {data.unplaced.length > 0 && (
        <Card>
          <CardBody>
            <h3 className="mb-2 font-semibold text-fg">Unplaced guests</h3>
            <div className="flex flex-wrap gap-2">
              {data.unplaced.map((u) => (
                <button
                  key={u.guestId}
                  onClick={() => handleSelectUnplaced(u.guestId)}
                  className={cn(
                    'tap rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    selectedUnplaced === u.guestId
                      ? 'border-brand bg-tint-info text-brand'
                      : 'border-border bg-surface hover:bg-surface-2',
                  )}
                >
                  <span className="font-medium">{u.guestName}</span>
                  <span className="ml-2 text-muted">{u.headName}</span>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Override dialog */}
      {overrideRoom && (
        <Card>
          <CardBody>
            <h3 className="mb-1 font-semibold text-warning">
              Room {overrideRoom.roomNumber} is full. Add anyway?
            </h3>
            <p className="mb-3 text-sm text-muted">
              Overfilling requires a reason — it becomes the audit trail.
            </p>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Why this room is over capacity"
              className="mb-3 w-full min-h-[60px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle"
              rows={2}
            />
            <div className="flex gap-3">
              <Button
                variant="primary"
                onClick={handleOverride}
                disabled={!overrideReason.trim() || loading}
                loading={loading}
              >
                Add anyway
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOverrideRoom(null)
                  setOverrideReason('')
                  setPendingAction(null)
                }}
              >
                Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Release dialog */}
      {releasingAssignment && (
        <Card>
          <CardBody>
            <h3 className="mb-1 font-semibold text-fg">Release from room</h3>
            <p className="mb-3 text-sm text-muted">
              The assignment row is kept — only released_at is set. Give a reason for the record.
            </p>
            <textarea
              value={releaseReason ?? ''}
              onChange={(e) => setReleaseReason(e.target.value || null)}
              placeholder="Why is this guest being released"
              className="mb-3 w-full min-h-[60px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle"
              rows={2}
            />
            <div className="flex gap-3">
              <Button
                variant="danger"
                onClick={handleReleaseConfirm}
                disabled={!releaseReason?.trim() || loading}
                loading={loading}
              >
                Release
              </Button>
              <Button
                variant="ghost"
                onClick={() => setReleasingAssignment(null)}
              >
                Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Room grid */}
      <div className="flex flex-col gap-3">
        {data.rooms.map((room) => {
          const isTarget = selectedGuest || selectedUnplaced

          return (
            <Card key={room.roomId}>
              <button
                type="button"
                disabled={!isTarget}
                onClick={() => isTarget && handleTapRoom(room)}
                className={cn(
                  'w-full text-left',
                  isTarget ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <CardBody>
                  {/* Room header */}
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="font-semibold text-fg">
                      {room.hotelName} · Room {room.roomNumber}
                    </h3>
                    <Badge
                      tone={room.isOverCapacity ? 'danger' : 'neutral'}
                      size="sm"
                    >
                      {room.occupants.length}/{room.capacity}
                      {room.freeBeds > 0 && !room.isOverCapacity
                        ? ` · ${room.freeBeds} free`
                        : room.isOverCapacity
                          ? ' · OVER'
                          : ''}
                    </Badge>
                    {room.isOverCapacity && (
                      <span className="text-xs font-semibold text-danger">Over capacity</span>
                    )}
                  </div>

                  {/* Occupants */}
                  {room.occupants.length === 0 ? (
                    <p className="text-sm text-muted">Empty</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {room.occupants.map((occ) => (
                        <li key={occ.assignmentId} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSelectGuest(occ)
                            }}
                            className={cn(
                              'tap flex-1 rounded-md px-3 py-1.5 text-left text-sm',
                              selectedGuest?.assignmentId === occ.assignmentId
                                ? 'bg-tint-info text-brand font-medium'
                                : 'bg-surface-2 hover:bg-surface',
                            )}
                          >
                            <span className="font-medium">{occ.guestName}</span>
                            <span className="ml-2 text-muted">{occ.headName}</span>
                            {occ.isHead && (
                              <Badge tone="info" size="sm" className="ml-2">
                                head
                              </Badge>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setReleasingAssignment(occ.assignmentId)
                              setReleaseReason('')
                            }}
                            className="tap shrink-0 rounded-md px-2 py-1 text-xs text-muted hover:text-danger"
                          >
                            Release
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </button>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
