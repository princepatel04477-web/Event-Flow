'use client'

import { useMemo, useState } from 'react'

import { AlertTriangleIcon, CheckCircleIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { SectionHead } from '@/components/ui/SectionHead'
import { Spinner } from '@/components/ui/Spinner'
import { StatusPill } from '@/components/ui/StatusPill'
import type { RoomPlan, RoomPlanCommitItem, RoomPlanFamily } from '@/lib/actions/rooms'
import { bedsLabel, compareRoomNumbers } from '@/lib/rooms/board'
import { cn } from '@/lib/utils'

/** The room facts the "change the room" picker needs. */
export interface ReviewRoom {
  roomId: string
  hotelId: string
  hotelName: string
  roomNumber: string
  floor: string | null
  capacity: number
  freeBeds: number
  occupiedBeds: number
  isBlocked: boolean
}

export interface AllocateReviewProps {
  plan: RoomPlan
  rooms: readonly ReviewRoom[]
  /** True while the commit is in flight. */
  committing: boolean
  onCancel: () => void
  onConfirm: (items: RoomPlanCommitItem[]) => void
}

/**
 * The proposal, one family per row, before anything is written.
 *
 * ACCEPT IS ON BY DEFAULT and skip is one tap, which is the right way round:
 * the engine's answer is usually right, and a review screen that starts with
 * everything off is a review screen where fourteen families get typed in by
 * hand anyway. What it must never do is write before the human looks — this is
 * the same rule as the RSVP review screen (CLAUDE.md section 5.8).
 *
 * CHANGE IS OFFERED ONLY WHERE IT MEANS SOMETHING. A family in one room can be
 * moved to another room that fits, in two taps. A family SPLIT across rooms
 * cannot: "change" would have to mean re-planning the split, and the honest
 * control for that is skip it here and place them by hand on the Waiting tab,
 * where the split stepper lives.
 */
export function AllocateReview({
  plan,
  rooms,
  committing,
  onCancel,
  onConfirm,
}: AllocateReviewProps) {
  /** Group ids the planner switched OFF. Accept is the default. */
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  /** Group id → the single room the planner chose instead. */
  const [changed, setChanged] = useState<ReadonlyMap<string, ReviewRoom>>(new Map())
  const [changing, setChanging] = useState<RoomPlanFamily | null>(null)

  const accepted = useMemo(
    () => plan.proposals.filter((p) => !skipped.has(p.groupId)),
    [plan.proposals, skipped],
  )

  const acceptedGuests = accepted.reduce((n, p) => n + p.pax, 0)

  function toggle(groupId: string) {
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  function confirm() {
    const items: RoomPlanCommitItem[] = accepted.map((family) => {
      const replacement = changed.get(family.groupId)
      return {
        groupId: family.groupId,
        headName: family.headName,
        rooms: replacement
          ? [{ roomId: replacement.roomId, roomNumber: replacement.roomNumber, pax: family.pax }]
          : family.rooms.map((r) => ({ roomId: r.roomId, roomNumber: r.roomNumber, pax: r.pax })),
      }
    })
    onConfirm(items)
  }

  /** Rooms that could take this family whole, best (tightest) first. */
  const alternatives = useMemo(() => {
    if (!changing) return []
    return [...rooms]
      .filter((r) => !r.isBlocked && r.freeBeds >= changing.pax)
      .sort(
        (a, b) =>
          a.freeBeds - b.freeBeds ||
          a.hotelName.localeCompare(b.hotelName) ||
          compareRoomNumbers(a.roomNumber, b.roomNumber),
      )
      .slice(0, 30)
  }, [rooms, changing])

  return (
    <div className="flex flex-col gap-4">
      <SectionHead
        eyebrow="Review the plan"
        title={`${plan.summary.families} ${plan.summary.families === 1 ? 'family' : 'families'} · ${plan.summary.guests} ${plan.summary.guests === 1 ? 'guest' : 'guests'} · ${plan.summary.bedsSpare} beds would still be free`}
      />

      <p className="text-sm leading-snug text-muted">
        Nothing is saved yet. Skip any row you want to do by hand, then confirm.
      </p>

      {plan.proposals.length === 0 ? (
        <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
          The plan could not place anybody. Every family that needs a bed is listed below with
          the reason.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="Proposed placements">
          {plan.proposals.map((family) => {
            const skip = skipped.has(family.groupId)
            const replacement = changed.get(family.groupId)
            return (
              <li
                key={family.groupId}
                className={cn(
                  'flex flex-col gap-3 rounded-2xl border bg-surface p-4',
                  skip ? 'border-rule opacity-60' : 'border-rule-strong shadow-e1',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base leading-snug font-medium text-ink">
                      {family.headName}
                    </h3>
                    <p className="mt-0.5 text-sm text-muted">
                      {replacement
                        ? `${family.pax} ${family.pax === 1 ? 'guest' : 'guests'} · ${replacement.hotelName} room ${replacement.roomNumber} (changed by you).`
                        : family.reason}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill tone={skip ? 'neutral' : 'done'}>
                      {skip ? 'Skipped' : 'Will place'}
                    </StatusPill>
                    {family.shared ? <StatusPill tone="attention">Shared</StatusPill> : null}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={skip ? 'secondary' : 'ghost'}
                    className="flex-1"
                    onClick={() => toggle(family.groupId)}
                  >
                    {skip ? 'Put back' : 'Skip'}
                  </Button>
                  {family.splitAcrossRooms && !replacement ? null : (
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setChanging(family)}
                    >
                      Change room
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {plan.blocked.length > 0 ? (
        <div className="flex flex-col gap-2">
          <SectionHead
            eyebrow="Cannot be placed"
            right={`${plan.blocked.length}`}
            inline
          />
          <ul className="flex flex-col gap-2" aria-label="Families the plan cannot place">
            {plan.blocked.map((family) => (
              <li
                key={family.groupId}
                className="flex gap-3 rounded-xl border border-rule-strong bg-surface px-3.5 py-3"
              >
                <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-ledger-red" />
                <div className="min-w-0">
                  <p className="text-base leading-snug font-medium text-ink">{family.headName}</p>
                  <p className="mt-0.5 text-sm leading-snug text-muted">{family.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The sticky footer clears the bottom tab bar via `bottom-nav`. */}
      <div className="sticky bottom-nav z-20 -mx-4 mt-2 border-t border-rule bg-paper px-4 py-3">
        {committing ? (
          <p
            role="status"
            className="flex items-center justify-center gap-2 text-sm font-medium text-ink"
          >
            <Spinner size="sm" label={null} />
            Placing {accepted.length} {accepted.length === 1 ? 'family' : 'families'}…
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Button size="lg" fullWidth onClick={confirm} leadingIcon={<CheckCircleIcon className="h-5 w-5" />}>
              Confirm {accepted.length} {accepted.length === 1 ? 'family' : 'families'}
            </Button>
            <p className="text-center text-xs text-muted">
              {acceptedGuests} {acceptedGuests === 1 ? 'guest' : 'guests'} will get a bed ·{' '}
              <button
                type="button"
                onClick={onCancel}
                className="tap underline underline-offset-2"
              >
                Cancel
              </button>
            </p>
          </div>
        )}
      </div>

      <BottomSheet
        open={changing !== null}
        onClose={() => setChanging(null)}
        label="Change the room"
      >
        {changing === null ? null : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-ink">
                Another room for {changing.headName}
              </h2>
              <p className="text-sm text-muted">
                {changing.pax} {changing.pax === 1 ? 'guest' : 'guests'} · only rooms that take
                all of them are listed.
              </p>
            </div>

            {alternatives.length === 0 ? (
              <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
                No other room has {changing.pax} free beds. Skip this family and place them across
                rooms from the Waiting list.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Rooms that fit">
                {alternatives.map((room) => (
                  <li key={room.roomId}>
                    <button
                      type="button"
                      onClick={() => {
                        setChanged((prev) => {
                          const next = new Map(prev)
                          next.set(changing.groupId, room)
                          return next
                        })
                        setChanging(null)
                      }}
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
                      <span className="figure shrink-0 text-sm text-muted">
                        {bedsLabel(room.occupiedBeds, room.capacity)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Button variant="secondary" size="lg" fullWidth onClick={() => setChanging(null)}>
              Keep the suggested room
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}

export default AllocateReview
