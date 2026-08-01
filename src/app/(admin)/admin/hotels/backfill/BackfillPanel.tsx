'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { applyBackfill } from '@/lib/actions/backfill'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { ChevronDownIcon, ShieldAlertIcon } from '@/components/icons'
import { PROBLEM_LABELS, type BackfillPlan, type ProblemKind } from '@/lib/rooms/backfill'

export interface BackfillPanelProps {
  eventId: string
  eventCode: string
  hotelId: string
  hotelName: string
  defaultCapacity: number
  plan: BackfillPlan
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'muted' }) {
  return (
    <div className="flex flex-col rounded-lg bg-surface-2 px-3 py-2">
      <span
        className={
          tone === 'danger'
            ? 'text-lg font-semibold text-danger'
            : 'text-lg font-semibold text-fg'
        }
      >
        {value}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}

export function BackfillPanel({
  eventId,
  eventCode,
  hotelId,
  hotelName,
  defaultCapacity,
  plan,
}: BackfillPanelProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const nothingToDo = plan.counts.guestsToAssign === 0 && plan.counts.roomsToCreate === 0

  async function confirm() {
    setError(null)
    setResult(null)
    setBusy(true)
    const r = await applyBackfill(eventId, eventCode, hotelId, defaultCapacity)
    setBusy(false)

    if (!r.ok) {
      setError(r.error)
      return
    }

    setResult(
      `Created ${r.roomsCreated} room${r.roomsCreated === 1 ? '' : 's'} and allocated ` +
        `${r.guestsAssigned} guest${r.guestsAssigned === 1 ? '' : 's'} across ` +
        `${r.familiesTouched} famil${r.familiesTouched === 1 ? 'y' : 'ies'}.` +
        (r.skippedByDatabase > 0
          ? ` ${r.skippedByDatabase} were already allocated and were left alone.`
          : ''),
    )
    router.refresh()
  }

  // Group problems by kind so a hundred blank rooms read as one line, not a
  // hundred. The detail is still there, one level down.
  const byKind = new Map<ProblemKind, typeof plan.problems>()
  for (const p of plan.problems) {
    const list = byKind.get(p.kind) ?? []
    list.push(p)
    byKind.set(p.kind, list)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <p className="font-semibold text-fg">What the sheet says</p>
            <p className="text-xs text-muted">
              Read from {plan.counts.rowsRead} stored import row
              {plan.counts.rowsRead === 1 ? '' : 's'}. Nothing is written until you confirm.
            </p>
          </CardTitle>
        </CardHeader>
        <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Families to allocate" value={plan.counts.familiesToAssign} />
          <Stat label="Guests to allocate" value={plan.counts.guestsToAssign} />
          <Stat label="Rooms to create" value={plan.counts.roomsToCreate} />
          <Stat
            label="Need your attention"
            value={plan.counts.problems}
            tone={plan.counts.problems > 0 ? 'danger' : undefined}
          />
        </CardBody>
      </Card>

      {plan.counts.unchanged > 0 ? (
        <Card className="border-success/40 bg-tint-success">
          <CardBody className="py-3 text-sm text-success">
            <p className="font-semibold">
              {plan.counts.unchanged} famil{plan.counts.unchanged === 1 ? 'y is' : 'ies are'}{' '}
              already in the right room.
            </p>
            <p className="mt-0.5">
              They are matched on their existing active allocation and will not be touched — this is
              what makes running the backfill twice safe.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {plan.roomsToCreate.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <p className="font-semibold text-fg">
                Rooms to create in {hotelName} ({plan.roomsToCreate.length})
              </p>
            </CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              Capacity marked <span className="font-semibold">from sheet</span> came from the{' '}
              <code>bed</code> column. That column looks like a bed count per family, which may not
              be the room&apos;s real size — check these against the hotel&apos;s own list.
            </p>
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
              {plan.roomsToCreate.map((room) => (
                <li
                  key={room.roomNumber}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-1.5"
                >
                  <span className="font-medium text-fg">Room {room.roomNumber}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted">{room.capacity} beds</span>
                    <Badge tone={room.capacityFromBed ? 'warning' : 'neutral'} size="sm">
                      {room.capacityFromBed ? 'from sheet' : 'default'}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {plan.families.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <p className="font-semibold text-fg">
                Families to allocate ({plan.families.length})
              </p>
            </CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {plan.families.map((family) => (
                <li key={`${family.groupId}-${family.rowNumber}`} className="rounded-lg bg-surface-2 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-fg">
                        {family.familyName}
                      </span>
                      <span className="text-xs text-muted">
                        Row {family.rowNumber} · room {family.roomNumbers.join(' + ')}
                        {family.bedHint !== null ? ` · sheet says ${family.bedHint} beds` : ''}
                      </span>
                    </span>
                    <Badge size="sm">{family.assignments.length} people</Badge>
                  </div>

                  {family.fromSplit ? (
                    <p className="mt-1 text-xs text-warning">
                      The sheet gave this family more than one room. People are filled in listed
                      order, up to each room&apos;s capacity.
                    </p>
                  ) : null}

                  {family.sharedWith.length > 0 ? (
                    <p className="mt-1 flex items-start gap-1 text-xs text-warning">
                      <ShieldAlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                      The sheet puts {family.sharedWith.join(', ')} in the same room.
                    </p>
                  ) : null}

                  {family.alreadyAssigned > 0 ? (
                    <p className="mt-1 text-xs text-success">
                      {family.alreadyAssigned} already in place, left alone.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {plan.problems.length > 0 ? (
        <Card className="border-danger/40">
          <CardHeader>
            <CardTitle>
              <p className="font-semibold text-danger">
                Needs your attention ({plan.problems.length})
              </p>
              <p className="text-xs text-muted">
                These rows are not guessed at and will not be written. Fix the sheet, or allocate
                them by hand.
              </p>
            </CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {[...byKind.entries()].map(([kind, items]) => (
              <details key={kind} className="group rounded-lg bg-surface-2">
                <summary className="tap flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm font-medium text-fg">
                    {PROBLEM_LABELS[kind]}
                    <span className="ml-2 text-muted">({items.length})</span>
                  </span>
                  <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
                </summary>
                <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto border-t border-border px-3 py-2 text-xs">
                  {items.map((p, i) => (
                    <li key={`${p.rowNumber}-${i}`} className="text-muted">
                      <span className="font-medium text-fg">Row {p.rowNumber}</span>
                      {p.familyName ? ` · ${p.familyName}` : ''}
                      {p.rawValue ? ` · sheet said "${p.rawValue}"` : ''}
                      <span className="block">{p.detail}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
          {result ? <p className="text-sm font-medium text-success">{result}</p> : null}

          <Button size="lg" fullWidth onClick={confirm} loading={busy} disabled={busy || nothingToDo}>
            {nothingToDo
              ? 'Nothing to backfill'
              : `Create ${plan.counts.roomsToCreate} rooms and allocate ${plan.counts.guestsToAssign} guests`}
          </Button>

          <p className="text-xs text-subtle">
            Safe to run more than once. Guests already in the room the sheet names are counted, not
            re-inserted, so a second run changes nothing.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

export default BackfillPanel
