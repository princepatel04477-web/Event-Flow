'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { commitAllocation, queueRoomMessages } from '@/lib/actions/allocate'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { ChevronDownIcon, ShieldAlertIcon } from '@/components/icons'
import { UNPLACED_LABELS, type AllocationPlan } from '@/lib/rooms/allocate'

export interface AllocationProposalProps {
  eventId: string
  eventCode: string
  plan: AllocationPlan
  fullyPlaced: number
  familiesWithoutGuests: { id: string; headName: string }[]
}

export function AllocationProposal({
  eventId,
  eventCode,
  plan,
  fullyPlaced,
  familiesWithoutGuests,
}: AllocationProposalProps) {
  const router = useRouter()

  // Shares default to OFF. Auto-committing two strangers into one room is
  // the mistake that reaches the client before it reaches you.
  const [approvedShares, setApprovedShares] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [committed, setCommitted] = useState<{ guests: number; families: number } | null>(null)
  const [queued, setQueued] = useState<string | null>(null)

  const sharedRoomIds = useMemo(() => new Set(plan.shares.map((s) => s.roomId)), [plan.shares])

  // What will actually be written, given which shares are ticked.
  const committable = useMemo(() => {
    let guests = 0
    const families = new Set<string>()
    for (const family of plan.placements) {
      for (const room of family.rooms) {
        if (sharedRoomIds.has(room.roomId) && !approvedShares.has(room.roomId)) continue
        guests += room.guests.length
        families.add(family.groupId)
      }
    }
    return { guests, families: families.size }
  }, [plan.placements, sharedRoomIds, approvedShares])

  const heldBack = plan.summary.guestsPlaced - committable.guests

  function toggleShare(roomId: string, on: boolean) {
    setApprovedShares((prev) => {
      const next = new Set(prev)
      if (on) next.add(roomId)
      else next.delete(roomId)
      return next
    })
  }

  async function commit() {
    setError(null)
    setBusy(true)
    const result = await commitAllocation(eventId, eventCode, [...approvedShares])
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setCommitted({ guests: result.guestsAssigned, families: result.familiesAssigned })
    router.refresh()
  }

  async function queue() {
    setError(null)
    setBusy(true)
    const result = await queueRoomMessages(eventId, eventCode)
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setQueued(
      result.queued === 0
        ? 'Every allocated family already has a room message waiting.'
        : `${result.queued} room message${result.queued === 1 ? '' : 's'} queued. Nothing is sent yet.`,
    )
  }

  if (committed) {
    return (
      <div className="flex flex-col gap-4">
        <Card className="border-success/40 bg-tint-success">
          <CardBody className="py-4 text-sm text-success">
            <p className="text-base font-semibold">Allocation committed.</p>
            <p className="mt-1">
              {committed.guests} guest{committed.guests === 1 ? '' : 's'} across{' '}
              {committed.families} famil{committed.families === 1 ? 'y' : 'ies'} now have rooms.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <p className="font-semibold text-fg">Tell the families?</p>
              <p className="text-xs text-muted">
                Queues a <code>room_allocated</code> WhatsApp message per family head. Queued only —
                nothing is sent until Phase 5.
              </p>
            </CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {queued ? <p className="text-sm font-medium text-success">{queued}</p> : null}
            {error ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}
            <Button fullWidth variant="secondary" onClick={queue} loading={busy} disabled={busy}>
              Queue room messages
            </Button>
            <Button fullWidth onClick={() => router.push(`/admin/rooms?event=${eventCode}`)}>
              Go to the room grid
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <Card>
        <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Families placed" value={plan.summary.familiesPlaced} />
          <Stat
            label="Unplaced"
            value={plan.summary.familiesUnplaced}
            tone={plan.summary.familiesUnplaced > 0 ? 'danger' : undefined}
          />
          <Stat label="Beds spare" value={plan.summary.bedsSpare} />
          <Stat label="Rooms empty" value={plan.summary.roomsEmpty} />
        </CardBody>
      </Card>

      {fullyPlaced > 0 ? (
        <Card className="border-success/40 bg-tint-success">
          <CardBody className="py-3 text-sm text-success">
            {fullyPlaced} confirmed famil{fullyPlaced === 1 ? 'y already has' : 'ies already have'} a
            room and {fullyPlaced === 1 ? 'is' : 'are'} not in this proposal. Re-running never moves
            somebody who already has a bed.
          </CardBody>
        </Card>
      ) : null}

      {/* Shares — the one thing that needs approving room by room */}
      {plan.shares.length > 0 ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>
              <p className="flex items-center gap-2 font-semibold text-warning">
                <ShieldAlertIcon className="h-4 w-4" />
                Proposed shares ({plan.shares.length})
              </p>
              <p className="text-xs text-muted">
                Different guests in one room. These are <strong>excluded</strong> from the commit
                unless you tick them.
              </p>
            </CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {plan.shares.map((share) => (
              <label
                key={share.roomId}
                className="tap flex cursor-pointer items-start gap-3 rounded-lg bg-surface-2 px-3 py-2"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0 rounded border-border-strong accent-warning"
                  checked={approvedShares.has(share.roomId)}
                  onChange={(e) => toggleShare(share.roomId, e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">
                    Room {share.roomNumber}
                    <span className="ml-2 font-normal text-muted">{share.hotelName}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {share.occupants.map((o) => `${o.guest.fullName} (${o.headName})`).join(' + ')}
                  </span>
                  {share.side ? (
                    <span className="mt-0.5 block text-xs text-subtle">
                      Both {share.side} side.
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-xs font-medium text-warning">
                      Different sides — check this is wanted.
                    </span>
                  )}
                </span>
              </label>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {/* Unplaced */}
      {plan.unplaced.length > 0 ? (
        <Card className="border-danger/40">
          <CardHeader>
            <CardTitle>
              <p className="font-semibold text-danger">
                Could not be placed ({plan.unplaced.length})
              </p>
              <p className="text-xs text-muted">Each one says why. None are silently dropped.</p>
            </CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
              {plan.unplaced.map((u) => (
                <li key={u.groupId} className="rounded-lg bg-surface-2 px-3 py-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-fg">{u.headName}</span>
                    <Badge tone="danger" size="sm">
                      {u.pax} pax
                    </Badge>
                  </span>
                  <span className="mt-0.5 block text-xs font-medium text-danger">
                    {UNPLACED_LABELS[u.reason]}
                  </span>
                  <span className="block text-xs text-muted">{u.detail}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {familiesWithoutGuests.length > 0 ? (
        <Card className="border-warning/40 bg-tint-warning">
          <CardBody className="py-3 text-sm text-warning">
            <p className="font-semibold">
              {familiesWithoutGuests.length} confirmed famil
              {familiesWithoutGuests.length === 1 ? 'y has' : 'ies have'} no guest records.
            </p>
            <p className="mt-0.5">
              Rooms are allocated to guests, so these cannot be placed:{' '}
              {familiesWithoutGuests.slice(0, 6).map((f) => f.headName).join(', ')}
              {familiesWithoutGuests.length > 6 ? ` and ${familiesWithoutGuests.length - 6} more` : ''}.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {/* The plan itself */}
      {plan.placements.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <p className="font-semibold text-fg">Proposed placements ({plan.placements.length})</p>
            </CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
              {plan.placements.map((family) => {
                const held = family.rooms.filter(
                  (r) => sharedRoomIds.has(r.roomId) && !approvedShares.has(r.roomId),
                )
                return (
                  <li key={family.groupId} className="rounded-lg bg-surface-2 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-fg">
                          {family.headName}
                        </span>
                        <span className="text-xs text-muted">
                          {family.pax} to place
                          {family.placedAlready > 0 ? ` · ${family.placedAlready} already in` : ''}
                          {family.priority > 0 ? ` · priority ${family.priority}` : ''}
                        </span>
                      </span>
                      <Badge size="sm" tone={family.groupType === 'couple' ? 'info' : 'neutral'}>
                        {family.groupType}
                      </Badge>
                    </div>

                    <div className="mt-1 flex flex-wrap gap-1">
                      {family.rooms.map((room) => (
                        <span
                          key={room.roomId}
                          className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs text-fg"
                        >
                          {room.hotelName} {room.roomNumber}
                          <span className="text-subtle">×{room.guests.length}</span>
                        </span>
                      ))}
                      {family.spareBeds > 0 ? (
                        <span className="text-xs text-subtle">
                          {family.spareBeds} spare bed{family.spareBeds === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </div>

                    {family.childrenSplit ? (
                      <p className="mt-1 text-xs font-medium text-warning">
                        Children split across rooms — no single room was big enough.
                      </p>
                    ) : null}
                    {held.length > 0 ? (
                      <p className="mt-1 text-xs font-medium text-warning">
                        Held back: room {held.map((r) => r.roomNumber).join(', ')} is a share you
                        have not ticked.
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {plan.emptyRooms.length > 0 ? (
        <details className="group rounded-xl border border-border bg-surface">
          <summary className="tap flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
            <span className="text-sm font-semibold text-fg">
              {plan.emptyRooms.length} room{plan.emptyRooms.length === 1 ? '' : 's'} left empty
            </span>
            <ChevronDownIcon className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <p className="border-t border-border px-4 py-3 text-xs break-words text-muted">
            {plan.emptyRooms
              .map((r) => `${r.hotelName} ${r.roomNumber} (${r.capacity})`)
              .join(', ')}
          </p>
        </details>
      ) : null}

      {/* Commit */}
      <Card>
        <CardBody className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}

          {heldBack > 0 ? (
            <p className="text-xs text-warning">
              {heldBack} guest{heldBack === 1 ? '' : 's'} held back in unticked shares.
            </p>
          ) : null}

          <Button
            size="lg"
            fullWidth
            onClick={commit}
            loading={busy}
            disabled={busy || committable.guests === 0}
          >
            {committable.guests === 0
              ? 'Nothing to commit'
              : `Commit ${committable.guests} guest${committable.guests === 1 ? '' : 's'} into rooms`}
          </Button>

          <p className="text-xs text-subtle">
            Nothing has been written yet. Committing writes every assignment in one statement — all
            of it lands, or none of it does.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="flex flex-col rounded-lg bg-surface-2 px-3 py-2">
      <span
        className={tone === 'danger' ? 'text-lg font-semibold text-danger' : 'text-lg font-semibold text-fg'}
      >
        {value}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}

export default AllocationProposal
