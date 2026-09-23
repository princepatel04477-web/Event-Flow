'use client'

import { useMemo, useState } from 'react'

import { ChevronRightIcon } from '@/components/icons'
import { BottomBar } from '@/components/ui/BottomBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { Row } from '@/components/ui/Row'
import type { RoomPlan, RoomPlanCommitItem, RoomPlanFamily } from '@/lib/actions/rooms'
import { compareRoomNumbers } from '@/lib/rooms/board'
import { initials } from '@/lib/ui/metrics'

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
 *
 * v3 RESTYLE: one `Progress` bar instead of a three-clause prose summary, one
 * `Row` per family with a single "Keep / Skip" switch (the row itself) and a
 * "Change room" button that appears only for the row you tapped, and a footer
 * with the ONE primary. v2 gave every family two buttons plus two pills, which
 * is 30 loud controls on one screen.
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
  /** Which family's "Change room" is showing under its row. */
  const [openRow, setOpenRow] = useState<string | null>(null)

  const accepted = useMemo(
    () => plan.proposals.filter((p) => !skipped.has(p.groupId)),
    [plan.proposals, skipped],
  )

  const acceptedGuests = accepted.reduce((n, p) => n + p.pax, 0)

  function toggle(groupId: string) {
    setOpenRow(null)
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
    <div className="flex flex-col gap-5 pb-nav-bottombar">
      <section className="flex flex-col gap-3 rounded-2xl border border-rule-strong bg-surface p-4 shadow-e1">
        <Progress
          label="Families the plan can place"
          done={plan.summary.families}
          total={plan.summary.families + plan.blocked.length}
          tone="brand"
        />
        <p className="text-sm leading-snug text-muted">
          {plan.summary.guests} {plan.summary.guests === 1 ? 'guest' : 'guests'} would get a bed ·{' '}
          {plan.summary.bedsSpare} still free. Nothing is saved yet.
        </p>
      </section>

      {plan.proposals.length === 0 ? (
        <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
          The plan could not place anybody. Each family that needs a bed is listed below with the
          reason.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
          {plan.proposals.map((family) => {
            const skip = skipped.has(family.groupId)
            const replacement = changed.get(family.groupId)
            const roomsText = replacement
              ? `${replacement.hotelName} ${replacement.roomNumber} · changed by you`
              : family.rooms.map((r) => r.roomNumber).join(', ')
            const canChange = !family.splitAcrossRooms || Boolean(replacement)
            return (
              <li key={family.groupId}>
                <Row
                  heading={family.headName}
                  meta={`${family.pax} ${family.pax === 1 ? 'guest' : 'guests'} · ${roomsText}${
                    family.shared ? ' · shared' : ''
                  }`}
                  initials={initials(family.headName)}
                  status={skip ? 'Skipped' : 'Keep'}
                  tone={skip ? 'waiting' : 'done'}
                  trailing={
                    openRow === family.groupId ? undefined : (
                      <ChevronRightIcon className="h-5 w-5" />
                    )
                  }
                  onPress={() => {
                    setOpenRow((prev) => (prev === family.groupId ? null : family.groupId))
                  }}
                />
                {openRow === family.groupId ? (
                  <div className="flex gap-2.5 border-b border-rule px-3 pb-3">
                    <Button
                      variant={skip ? 'secondary' : 'ghost'}
                      size="sm"
                      fullWidth
                      onClick={() => toggle(family.groupId)}
                    >
                      {skip ? 'Put back' : 'Skip this family'}
                    </Button>
                    {canChange ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        onClick={() => setChanging(family)}
                      >
                        Change room
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {plan.blocked.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="eyebrow text-muted">
            Cannot be placed · {plan.blocked.length}
          </h2>
          <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
            {plan.blocked.map((family) => (
              <li key={family.groupId}>
                <Row
                  heading={family.headName}
                  meta={family.reason}
                  initials={initials(family.headName)}
                  status="No room"
                  tone="problem"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <BottomSheet
        open={changing !== null}
        onClose={() => setChanging(null)}
        label="Change the room"
      >
        {changing === null ? null : (
          <div className="flex flex-col gap-4">
            <div className="min-w-0">
              <h2 className="truncate font-display text-2xl leading-tight font-semibold text-ink">
                Another room
              </h2>
              <p className="mt-1 text-sm leading-snug text-muted">
                {changing.headName} · {changing.pax}{' '}
                {changing.pax === 1 ? 'guest' : 'guests'} · only rooms that take all of them
              </p>
            </div>

            {alternatives.length === 0 ? (
              <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
                No other room has {changing.pax} free beds. Skip this family and place them across
                rooms from the Waiting list.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
                {alternatives.map((room) => (
                  <li key={room.roomId}>
                    <Row
                      heading={`Room ${room.roomNumber}`}
                      meta={`${room.hotelName}${room.floor ? ` · ${room.floor}` : ''}`}
                      status={`${room.freeBeds} free`}
                      tone="done"
                      onPress={() => {
                        setChanged((prev) => {
                          const next = new Map(prev)
                          next.set(changing.groupId, room)
                          return next
                        })
                        setChanging(null)
                        setOpenRow(null)
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}

            <Button variant="ghost" size="lg" fullWidth onClick={() => setChanging(null)}>
              Keep the suggested room
            </Button>
          </div>
        )}
      </BottomSheet>

      {/* The screen's ONE primary, in the shared bar, so it sits exactly where
          every other screen's commit sits and clears the tab bar by the same
          arithmetic. v2 hand-rolled this bar; using `BottomBar` keeps the
          clearance and the 50/50 split from drifting away from the rest of
          the app. While the commit is in flight both controls are disabled and
          the primary says so, rather than swapping the bar for a spinner. */}
      <BottomBar
        summary={`${acceptedGuests} ${acceptedGuests === 1 ? 'guest' : 'guests'} now have a bed`}
        secondary={{ label: 'Cancel', onPress: onCancel, disabled: committing }}
        primary={{
          label: committing ? 'Saving…' : `Confirm ${accepted.length}`,
          onPress: confirm,
          disabled: committing,
        }}
      />
    </div>
  )
}

export default AllocateReview
