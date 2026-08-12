'use client'

import { useState, useCallback, useRef } from 'react'

import { allocate } from '@/lib/allocate/allocator'
import { adaptData } from '@/lib/allocate/run'
import type {
  AllocationResult,
} from '@/lib/allocate/allocator'
import type { AllocationData } from '@/lib/actions/rooms'
import { commitAllocations } from '@/lib/actions/rooms'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import {
  CheckCircleIcon,
  ShieldAlertIcon,
  UsersIcon,
} from '@/components/icons'

import { RoomSuggestPanel } from './RoomSuggestPanel'

interface Props {
  eventId: string
  eventCode: string
  data: AllocationData
}

type Phase =
  | { stage: 'loading' }
  | { stage: 'ready'; result: AllocationResult; committed: boolean; commitError: string | null }
  | { stage: 'error'; message: string }
  | { stage: 'empty'; message: string }

export function AllocateClient({ eventId, eventCode, data }: Props) {
  const [phase, setPhase] = useState<Phase>(() => {
    if (data.groups.length === 0 || data.rooms.length === 0) {
      return { stage: 'empty', message: getEmptyMessage(data) }
    }

    const { groups, rooms } = adaptData(data)

    return { stage: 'ready', result: allocate(groups, rooms), committed: false, commitError: null }
  })

  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const handleCommit = useCallback(async () => {
    const current = phaseRef.current
    if (current.stage !== 'ready' || current.committed) return

    const proposal = current.result
    setPhase({ ...current, stage: 'loading' })

    // Build assignment map: for each placed group, for each room, assign all guests
    const assignments: Record<string, string> = {}
    const overrides: Record<string, string> = {}

    for (const pg of proposal.placed) {
      if (!pg.placed) continue
      // Map guests to rooms from the proposal
      let guestOffset = 0
      const groupGuests = data.guests.filter((g) => data.groups.find(
        (gr) => gr.id === pg.groupId,
      )?.guestIds.includes(g.id))

      for (const room of pg.rooms) {
        if (room.alreadyHeld) continue
        for (let i = 0; i < room.paxInRoom && guestOffset < groupGuests.length; i++, guestOffset++) {
          assignments[groupGuests[guestOffset].id] = room.roomId
        }
        if (room.bedsRemaining < 0) {
          // Negative remaining means we pushed over capacity — record override
        }
      }
    }

    const commitResult = await commitAllocations(eventId, { assignments, overrides })

    if (!commitResult.ok) {
      setPhase({ stage: 'ready', result: proposal, committed: false, commitError: commitResult.error })
      return
    }

    setPhase({ stage: 'ready', result: proposal, committed: true, commitError: null })
  }, [eventId, data])

  if (phase.stage === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  if (phase.stage === 'error') {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not build the plan"
        description={phase.message}
      />
    )
  }

  if (phase.stage === 'empty') {
    return (
      <EmptyState
        icon={<UsersIcon className="h-7 w-7" />}
        title="Nothing to allocate"
        description={phase.message}
      />
    )
  }

  const { result, committed, commitError } = phase

  return (
    <div className="flex flex-col gap-4">
      {/* R2: top-3 suggestions per unallocated family — the engine suggests,
          a human confirms. Rendered above the single-plan review. */}
      <RoomSuggestPanel eventId={eventId} />

      <div>
        <h2 className="text-xl font-semibold text-fg">Room allocation</h2>
        <p className="mt-0.5 text-sm text-muted">
          {committed
            ? 'Plan committed — the guest list now shows room assignments.'
            : 'Review the plan below, then press Commit. Nothing is written until you commit.'}
        </p>
      </div>

      {/* Summary bar */}
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex items-baseline gap-4 text-sm">
          <span>
            <span className="font-semibold text-success">{result.summary.familiesPlaced}</span>
            <span className="text-muted"> placed</span>
          </span>
          {result.summary.familiesUnplaced > 0 && (
            <span>
              <span className="font-semibold text-danger">{result.summary.familiesUnplaced}</span>
              <span className="text-muted"> unplaced</span>
            </span>
          )}
          <span>
            <span className="font-semibold">{result.summary.bedsSpare}</span>
            <span className="text-muted"> beds spare</span>
          </span>
        </div>
      </div>

      {commitError && (
        <div className="rounded-xl border border-tint-danger bg-tint-danger px-4 py-3 text-sm text-danger">
          {commitError}
        </div>
      )}

      {/* Proposed shares warning */}
      {result.proposedShares.length > 0 && (
        <Card>
          <CardBody>
            <h3 className="mb-2 font-semibold text-warning">Proposed shares</h3>
            <p className="mb-3 text-sm text-muted">
              These single guests would share rooms. This is a proposal only — nothing
              is committed until you approve.
            </p>
            <ul className="flex flex-col gap-2">
              {result.proposedShares.map((share) => (
                <li
                  key={share.roomId}
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{share.hotelName} · Room {share.roomNumber}</span>
                  {' — '}
                  {share.headNames.join(' + ')} ({share.side})
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Empty rooms */}
      {result.emptyRooms.length > 0 && (
        <Card>
          <CardBody>
            <h3 className="mb-1 font-semibold text-muted">Empty rooms</h3>
            <p className="text-sm text-muted">
              {result.emptyRooms.length} room{result.emptyRooms.length !== 1 ? 's' : ''} with
              no proposals: {result.emptyRooms.map((r) => `${r.hotelName} Room ${r.roomNumber}`).join(', ')}
            </p>
          </CardBody>
        </Card>
      )}

      {/* Placed families */}
      <div className="flex flex-col gap-3">
        {result.placed.map((pg) => (
          <Card key={pg.groupId}>
            <CardBody>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="font-semibold text-fg">{pg.headName}</h3>
                <Badge tone="info" size="sm">{pg.side}</Badge>
                <Badge tone="neutral" size="sm">{pg.groupType}</Badge>
                <Badge tone="neutral" size="sm">{pg.paxToPlace} PAX</Badge>
                <CheckCircleIcon className="ml-auto h-5 w-5 text-success" />
              </div>
              {pg.rooms.length === 0 ? (
                <p className="text-sm text-muted">Already placed — no new rooms needed.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {pg.rooms.map((room) => (
                    <li
                      key={room.roomId}
                      className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {room.hotelName} · Room {room.roomNumber}
                      </span>
                      <span className="shrink-0 text-muted">
                        {room.paxInRoom} {room.paxInRoom === 1 ? 'person' : 'people'}
                      </span>
                      {room.adjacentToPrevious && (
                        <Badge tone="info" size="sm">adjacent</Badge>
                      )}
                      {room.bedsRemaining > 0 && (
                        <span className="shrink-0 text-xs text-muted">
                          {room.bedsRemaining} free
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ))}

        {/* Unplaced families */}
        {result.unplaced.map((pg) => (
          <Card key={pg.groupId}>
            <CardBody>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="font-semibold text-fg">{pg.headName}</h3>
                <Badge tone="info" size="sm">{pg.side}</Badge>
                <Badge tone="neutral" size="sm">{pg.groupType}</Badge>
                <Badge tone="neutral" size="sm">{pg.paxToPlace} PAX</Badge>
              </div>
              <p className="text-sm text-danger">{pg.failureReason}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {result.placed.length === 0 && result.unplaced.length === 0 && (
        <p className="text-sm text-muted">No confirmed families found for this event.</p>
      )}

      <div className="flex gap-3 pt-2">
        {!committed && (
          <Button fullWidth onClick={handleCommit}>
            Commit plan
          </Button>
        )}
        {committed && (
          <LinkButton
            fullWidth
            variant="secondary"
            href={`/${eventCode}`}
          >
            Back to dashboard
          </LinkButton>
        )}
      </div>
    </div>
  )
}

function getEmptyMessage(data: AllocationData): string {
  if (data.groups.length === 0 && data.rooms.length === 0) {
    return 'No confirmed families and no rooms have been set up yet. Import the guest list and add hotels and rooms first.'
  }
  if (data.groups.length === 0) {
    return 'No confirmed families yet for this event. RSVPs need to be confirmed before rooms can be allocated.'
  }
  return 'No rooms have been added yet for this event. Set up hotels and rooms first.'
}
